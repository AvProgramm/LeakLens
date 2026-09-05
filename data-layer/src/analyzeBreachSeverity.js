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
 * Both models routed through Gonka are REASONING models: they emit a long
 * <think>…</think> block before answering, and that block quotes our own
 * prompt back - including the example JSON in it. Naively slicing from the
 * first "{" to the last "}" would therefore capture the model's scratch
 * work rather than its answer.
 *
 * So we remove closed reasoning blocks first, and when we do have to scan
 * the raw text (a truncated response leaves <think> unclosed) we take the
 * LAST balanced object that actually parses and carries a severity_score -
 * the model's final answer, not an earlier draft of it.
 */
function stripReasoningBlocks(text) {
  return text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Find every balanced {...} region, ignoring braces that appear inside
 * strings. A plain indexOf/lastIndexOf pair cannot do this: it merges two
 * separate objects into one unparseable span.
 */
function findBalancedJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let startIndex = -1;
  let insideString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (insideString) {
      if (escapeNext) escapeNext = false;
      else if (character === '\\') escapeNext = true;
      else if (character === '"') insideString = false;
      continue;
    }

    if (character === '"') insideString = true;
    else if (character === '{') {
      if (depth === 0) startIndex = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && startIndex !== -1) {
        objects.push(text.slice(startIndex, index + 1));
        startIndex = -1;
      }
      if (depth < 0) depth = 0;
    }
  }

  return objects;
}

/**
 * Return the last candidate that parses and looks like an assessment.
 */
function selectAssessmentObject(candidates) {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]);
      if (parsed && typeof parsed === 'object' && 'severity_score' in parsed) return parsed;
    } catch {
      // Not valid JSON - keep looking further back.
    }
  }
  return null;
}

function parseModelJson(text) {
  const withoutReasoning = stripCodeFences(stripReasoningBlocks(text));

  // The clean case: the answer is the whole remaining string.
  try {
    const parsed = JSON.parse(withoutReasoning);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Fall through to scanning.
  }

  // Prose around the answer, or an unclosed reasoning block. Scan the
  // reasoning-stripped text first, then the raw text as a last resort.
  const fromStripped = selectAssessmentObject(findBalancedJsonObjects(withoutReasoning));
  if (fromStripped) return fromStripped;

  const fromRaw = selectAssessmentObject(findBalancedJsonObjects(text));
  if (fromRaw) return fromRaw;

  throw new Error('model did not return parseable JSON');
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
    let completion = await callGonkaModel(client, model, buildSeverityPrompt(breach));

    // The router sometimes answers with a different model than the one we
    // asked for, which would cost us the independence that makes this
    // cross-verification meaningful. Misrouting is intermittent, so one
    // retry usually lands on the right model. We only pay for this retry
    // when a misroute actually happened.
    if (completion.misrouted) {
      console.warn(
        `[analyze] ${model} was misrouted to ${completion.actualModel}; retrying once`,
      );
      completion = await callGonkaModel(client, model, buildSeverityPrompt(breach));
    }

    const assessment = normalizeAssessment(parseModelJson(completion.text));

    return {
      ok: true,
      model,
      // Who actually answered, which is not always who we asked for.
      actualModel: completion.actualModel,
      misrouted: completion.misrouted,
      requestId: completion.requestId,
      requestIdSource: completion.requestIdSource,
      ...assessment,
    };
  } catch (error) {
    // Even a 429 stays contained. The router's 429 is usually a concurrency
    // ceiling rather than an exhausted quota, so failing this one call and
    // keeping the other verdicts is far better than discarding a whole scan
    // that is most of the way done.
    console.error(`[analyze] model ${model} failed:`, error.message);
    return {
      ok: false,
      model,
      error: error.code === 'RATE_LIMITED'
        ? 'router was busy (concurrency limit)'
        : error.message,
    };
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

  // If the router served the same model for both requests, there was no
  // cross-verification - two answers from one model are not independent.
  // We report that honestly rather than presenting it as consensus, because
  // the whole claim of this product is that two models checked each other.
  if (primaryVerdict.actualModel === secondaryVerdict.actualModel) {
    return {
      name: breach.name,
      status: 'unverified',
      finalScore: Math.max(primaryVerdict.severityScore, secondaryVerdict.severityScore),
      scoreDifference,
      note: `The router answered both requests with ${primaryVerdict.actualModel}, so these two verdicts are not independent.`,
      modelA: primaryVerdict,
      modelB: secondaryVerdict,
    };
  }

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

  // Flatten to one task per MODEL CALL rather than per breach. The router
  // limits concurrent requests per account, and that limit counts calls -
  // so limiting breaches (each of which fires two calls) would quietly
  // allow twice the parallelism we asked for and trip a 429.
  const modelCallTasks = breachesToAnalyze.flatMap((breach) => [
    { breach, model: GONKA_MODEL_PRIMARY },
    { breach, model: GONKA_MODEL_SECONDARY },
  ]);

  const completedCalls = await mapWithConcurrencyLimit(
    modelCallTasks,
    GONKA_MAX_CONCURRENCY,
    async (task) => ({
      breach: task.breach,
      model: task.model,
      verdict: await assessWithSingleModel(client, task.model, task.breach),
    }),
  );

  // Regroup the flat results back into one entry per breach, preserving the
  // original order so the most severe breach stays first.
  const analyzedBreaches = breachesToAnalyze.map((breach) => {
    const callsForBreach = completedCalls.filter((call) => call.breach === breach);
    const primaryVerdict = callsForBreach.find((call) => call.model === GONKA_MODEL_PRIMARY)?.verdict;
    const secondaryVerdict = callsForBreach.find((call) => call.model === GONKA_MODEL_SECONDARY)?.verdict;

    return reconcileModelVerdicts(
      breach,
      primaryVerdict ?? { ok: false, model: GONKA_MODEL_PRIMARY, error: 'no result' },
      secondaryVerdict ?? { ok: false, model: GONKA_MODEL_SECONDARY, error: 'no result' },
    );
  });

  const disputedCount = analyzedBreaches.filter((breach) => breach.status === 'disputed').length;

  // Breaches where the router gave us the same model twice were not really
  // cross-verified, and saying "agreement" about them would overstate what
  // happened. They get their own count so the dashboard can be honest.
  const unverifiedCount = analyzedBreaches.filter((breach) => breach.status === 'unverified').length;
  const crossVerifiedCount = analyzedBreaches.filter(
    (breach) => breach.status === 'consensus' || breach.status === 'disputed',
  ).length;

  return {
    email: shapedBreachData.email,
    analyzedAt: new Date().toISOString(),
    totalBreaches: allBreaches.length,
    analyzedBreaches: analyzedBreaches.length,
    // Says plainly when we scored a subset, so the number on screen is
    // never quietly based on less data than the user thinks.
    truncated: allBreaches.length > analyzedBreaches.length,
    overallRiskScore: calculateOverallRiskScore(analyzedBreaches),
    consensusStatus: disputedCount > 0
      ? 'divergence'
      : crossVerifiedCount > 0 ? 'agreement' : 'unverified',
    disputedCount,
    crossVerifiedCount,
    unverifiedCount,
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
