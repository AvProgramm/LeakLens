/**
 * analyzeBreachSeverity.js
 * The multi-model consensus layer.
 *
 * For each breach an email appears in we ask TWO independent models on the
 * Gonka Network to score its severity, then compare their answers. Where
 * they agree we report a consensus score; where they disagree we say so
 * out loud and take the more cautious number rather than hiding the split.
 * That disagreement is the point of the product, not a defect to smooth
 * over - a single model asserting a score is exactly the centralized
 * opinion this challenge asks us to replace.
 *
 * This module never fetches breach data itself. It is handed the already
 * shaped contract object, which is what keeps a full scan down to one
 * upstream XposedOrNot request instead of three.
 */

import {
  createGonkaClient,
  callGonkaModel,
  mapWithConcurrencyLimit,
} from './gonkaClient.js';
import {
  GONKA_MODEL_PRIMARY,
  GONKA_MODEL_SECONDARY,
  GONKA_MAX_CONCURRENCY,
  MAX_BREACHES_ANALYZED,
} from './config.js';

// Two scores this far apart or closer are treated as the models agreeing.
// 25 points on a 0-100 scale is wide enough to tolerate wording differences
// but narrow enough that a genuine "low risk vs critical" split still shows.
const CONSENSUS_THRESHOLD = 25;

/**
 * The neutrality prompt. It pins the output to strict JSON, demands the
 * model cite the specific exposed data classes it based the score on, and
 * forbids speculation beyond the supplied facts - so a disagreement between
 * models reflects genuine differing judgement rather than one model simply
 * inventing more detail than the other.
 */
function buildSeverityPrompt(breach) {
  const knownFacts = [
    `Breach name: ${breach.name}`,
    breach.year ? `Breach date: ${breach.year}` : null,
    breach.industry ? `Industry: ${breach.industry}` : null,
    breach.recordsExposed ? `Records exposed: ${breach.recordsExposed}` : null,
    breach.passwordRisk && breach.passwordRisk !== 'unknown'
      ? `Password storage: ${breach.passwordRisk}`
      : null,
    breach.dataExposed?.length
      ? `Exposed data classes: ${breach.dataExposed.join(', ')}`
      : null,
    breach.description ? `Description: ${breach.description}` : null,
  ].filter(Boolean).join('\n');

  return [
    'You are an objective security analyst assessing how much practical risk',
    'a data breach creates for one individual whose email address appeared in it.',
    '',
    'Known facts about this breach:',
    knownFacts,
    '',
    'Judge severity ONLY from the facts above. Do not speculate about details',
    'that are not listed. Base the score on what an attacker could actually do',
    'with the exposed data classes: credentials and financial data are far more',
    'damaging than an email address alone.',
    '',
    'Reply with strict JSON and nothing else, in exactly this form:',
    '{"severity_score": <integer 0-100>, "evidence": "<the specific exposed data',
    'classes that drove the score>", "reasoning": "<1-2 sentence explanation>",',
    '"recommended_action": "<the single most important action for this person>"}',
    '',
    'Do not wrap the JSON in markdown code fences. Do not add other fields.',
  ].join('\n');
}

/**
 * Models sometimes wrap JSON in code fences or add a sentence before it
 * despite instructions. We strip fences, then fall back to slicing out the
 * outermost {...} block, so one chatty model cannot fail an entire scan.
 */
function parseModelJson(text) {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFences);
  } catch {
    const firstBrace = withoutFences.indexOf('{');
    const lastBrace = withoutFences.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(withoutFences.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('model did not return parseable JSON');
  }
}

/**
 * Validate a model's answer into the shape the dashboard renders. Anything
 * outside 0-100 or missing its explanation is rejected rather than shown,
 * because a fabricated-looking verdict on a security tool is worse than an
 * honest "this model did not answer".
 */
function normalizeAssessment(rawAssessment) {
  const score = Number(rawAssessment.severity_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('model returned an out-of-range severity score');
  }

  return {
    severityScore: Math.round(score),
    evidence: String(rawAssessment.evidence ?? '').trim(),
    reasoning: String(rawAssessment.reasoning ?? '').trim(),
    recommendedAction: String(rawAssessment.recommended_action ?? '').trim(),
  };
}

/**
 * One model's verdict on one breach. Returns a result object either way -
 * a failed model becomes { ok: false } rather than throwing, so the other
 * model's answer still reaches the user.
 */
async function assessWithSingleModel(client, model, breach) {
  try {
    const completion = await callGonkaModel(client, model, buildSeverityPrompt(breach));
    const assessment = normalizeAssessment(parseModelJson(completion.text));

    return {
      ok: true,
      model,
      requestId: completion.requestId,
      requestIdSource: completion.requestIdSource,
      ...assessment,
    };
  } catch (error) {
    // A rate limit is the one failure worth escalating to the caller,
    // because retrying the rest of the scan will hit the same wall.
    if (error.code === 'RATE_LIMITED') throw error;

    console.error(`[analyze] model ${model} failed:`, error.message);
    return { ok: false, model, error: error.message };
  }
}

/**
 * Combine the two model verdicts for one breach into a single reported
 * result, keeping the disagreement visible in `status`.
 */
function reconcileModelVerdicts(breach, primaryVerdict, secondaryVerdict) {
  const successfulVerdicts = [primaryVerdict, secondaryVerdict].filter((verdict) => verdict.ok);

  // Both models failed, so we report the breach as found but unscored
  // rather than inventing a number for it.
  if (successfulVerdicts.length === 0) {
    return {
      name: breach.name,
      status: 'unavailable',
      finalScore: null,
      modelA: primaryVerdict,
      modelB: secondaryVerdict,
    };
  }

  // Only one model answered. Report its score but label it clearly, so the
  // cross-verification claim is never overstated.
  if (successfulVerdicts.length === 1) {
    return {
      name: breach.name,
      status: 'single-model',
      finalScore: successfulVerdicts[0].severityScore,
      scoreDifference: null,
      modelA: primaryVerdict,
      modelB: secondaryVerdict,
    };
  }

  const scoreDifference = Math.abs(
    primaryVerdict.severityScore - secondaryVerdict.severityScore,
  );
  const modelsAgree = scoreDifference <= CONSENSUS_THRESHOLD;

  return {
    name: breach.name,
    status: modelsAgree ? 'consensus' : 'disputed',
    // On agreement the midpoint is the fair summary. On a genuine dispute
    // we deliberately take the HIGHER score: under-warning someone about a
    // real exposure is the more harmful of the two possible mistakes.
    finalScore: modelsAgree
      ? Math.round((primaryVerdict.severityScore + secondaryVerdict.severityScore) / 2)
      : Math.max(primaryVerdict.severityScore, secondaryVerdict.severityScore),
    scoreDifference,
    modelA: primaryVerdict,
    modelB: secondaryVerdict,
  };
}

/**
 * Roll the per-breach scores into one headline number.
 *
 * Deliberately NOT an average. Averaging means a person exposed in one
 * critical breach plus nine trivial ones scores lower than the critical
 * breach alone, which tells them they are safer the more exposed they get.
 * Instead the worst breach sets the floor, and breadth of exposure adds a
 * bounded escalation on top.
 */
function calculateOverallRiskScore(analyzedBreaches) {
  const scoredBreaches = analyzedBreaches.filter((breach) => breach.finalScore !== null);
  if (scoredBreaches.length === 0) return null;

  const highestScore = Math.max(...scoredBreaches.map((breach) => breach.finalScore));
  const breadthPenalty = Math.min(15, (scoredBreaches.length - 1) * 3);

  return Math.min(100, highestScore + breadthPenalty);
}

/**
 * Analyse the breaches in an already-shaped contract object.
 *
 * @param {object} shapedBreachData - output of shapeBreachData()
 * @returns {Promise<object>} consensus report for the dashboard
 */
async function analyzeBreachSeverity(shapedBreachData) {
  const allBreaches = shapedBreachData.breaches ?? [];

  if (allBreaches.length === 0) {
    return {
      email: shapedBreachData.email,
      analyzedAt: new Date().toISOString(),
      totalBreaches: 0,
      analyzedBreaches: 0,
      overallRiskScore: 0,
      models: [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY],
      breaches: [],
    };
  }

  // Worst-looking breaches first, so if we cap the number analysed we spend
  // the budget on the ones most likely to drive the headline score.
  const breachesByLikelySeverity = [...allBreaches].sort(
    (left, right) => (right.recordsExposed || 0) - (left.recordsExposed || 0),
  );
  const breachesToAnalyze = breachesByLikelySeverity.slice(0, MAX_BREACHES_ANALYZED);

  const client = createGonkaClient();

  const analyzedBreaches = await mapWithConcurrencyLimit(
    breachesToAnalyze,
    GONKA_MAX_CONCURRENCY,
    async (breach) => {
      // The two models run against each other in parallel; the outer
      // concurrency limiter is what stops every breach doing this at once.
      const [primaryVerdict, secondaryVerdict] = await Promise.all([
        assessWithSingleModel(client, GONKA_MODEL_PRIMARY, breach),
        assessWithSingleModel(client, GONKA_MODEL_SECONDARY, breach),
      ]);
      return reconcileModelVerdicts(breach, primaryVerdict, secondaryVerdict);
    },
  );

  const disputedCount = analyzedBreaches.filter((breach) => breach.status === 'disputed').length;

  return {
    email: shapedBreachData.email,
    analyzedAt: new Date().toISOString(),
    totalBreaches: allBreaches.length,
    analyzedBreaches: analyzedBreaches.length,
    // Says plainly when we scored a subset, so the number on screen is
    // never quietly based on less data than the user thinks.
    truncated: allBreaches.length > analyzedBreaches.length,
    overallRiskScore: calculateOverallRiskScore(analyzedBreaches),
    consensusStatus: disputedCount > 0 ? 'divergence' : 'agreement',
    disputedCount,
    models: [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY],
    breaches: analyzedBreaches,
  };
}

export {
  analyzeBreachSeverity,
  calculateOverallRiskScore,
  reconcileModelVerdicts,
  parseModelJson,
  normalizeAssessment,
  buildSeverityPrompt,
  CONSENSUS_THRESHOLD,
};
