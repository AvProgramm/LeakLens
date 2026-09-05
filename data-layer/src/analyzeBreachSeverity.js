/**
 * analyzeBreachSeverity.js
 * The pipeline the hackathon brief asks for:
 *
 *     email  ->  breach profile  ->  N models on the Gonka Network
 *            ->  each model returns its OWN Truth Score (0-100)
 *            ->  cross-verification of those scores
 *
 * The important design point: the headline number is a MODEL'S judgment,
 * not our arithmetic. Each model receives the whole breach profile at once
 * and returns a single Truth Score for this person's exposure, plus the
 * reasoning behind it. We then compare the models against each other.
 *
 * An earlier version scored each breach separately and averaged the results
 * into a number no model had ever produced. That inverted the brief - the
 * score has to come from the network, and the models have to be comparable
 * to each other at the top level for cross-verification to mean anything.
 *
 * Asking each model once (rather than once per breach) is also what keeps a
 * live demo fast: two inference calls total, regardless of breach count.
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

// Two Truth Scores within this many points count as agreement. Wider than
// this and we report a genuine dispute rather than splitting the difference.
const CONSENSUS_THRESHOLD = 25;

/**
 * Render the breach profile the models judge. Only breach metadata goes in;
 * the person's email address never leaves our side of the boundary.
 */
function buildBreachProfile(breaches) {
  return breaches
    .map((breach, index) => {
      const facts = [
        breach.year ? `year ${breach.year}` : null,
        breach.industry ? `industry ${breach.industry}` : null,
        breach.recordsExposed ? `${breach.recordsExposed} records` : null,
        breach.passwordRisk && breach.passwordRisk !== 'unknown'
          ? `passwords ${breach.passwordRisk}`
          : null,
        breach.dataExposed?.length ? `exposed: ${breach.dataExposed.join(', ')}` : null,
      ].filter(Boolean).join('; ');

      return `${index + 1}. ${breach.name} - ${facts}`;
    })
    .join('\n');
}

/**
 * The neutrality prompt. It states the facts, forbids speculation, and
 * demands the model cite the evidence behind its own score - the brief
 * asks for objectivity and cited evidence, so both are required here.
 */
function buildTruthScorePrompt(breaches) {
  return [
    'You are an objective security analyst. One person\'s email address appeared',
    'in the following known data breaches. Judge the TOTAL practical risk to that',
    'person and return a single Truth Score.',
    '',
    'Breaches:',
    buildBreachProfile(breaches),
    '',
    'Scoring guide: 0 = no meaningful risk, 100 = severe, immediate risk.',
    'Judge ONLY from the facts above. Do not speculate about details that are not',
    'listed. Weigh what an attacker could actually do: exposed credentials and',
    'financial data are far more damaging than an email address alone. More',
    'breaches means more exposure, never less.',
    '',
    'Reply with strict JSON and nothing else, in exactly this form:',
    '{"truth_score": <integer 0-100>, "evidence": "<the specific exposed data',
    'classes and breaches that drove your score>", "reasoning": "<2-3 sentence',
    'explanation of how you reached this score>", "recommended_action": "<the',
    'single most important action this person should take first>",',
    '"top_risks": ["<breach name>", "<breach name>"]}',
    '',
    'Do not wrap the JSON in markdown code fences. Do not add other fields.',
  ].join('\n');
}

// Kept for the per-breach prompt shape used by older callers and tests.
function buildSeverityPrompt(breach) {
  return buildTruthScorePrompt([breach]);
}

/**
 * The models routed through Gonka are REASONING models: they emit a long
 * <think>…</think> block before answering, and that block quotes our own
 * prompt back - including the example JSON in it. Naively slicing from the
 * first "{" to the last "}" would capture the model's scratch work rather
 * than its answer.
 *
 * So we remove closed reasoning blocks first, and when we do have to scan
 * the raw text (a truncated response leaves <think> unclosed) we take the
 * LAST balanced object that parses and carries a score - the model's final
 * answer, not an earlier draft of it.
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
 * Find every balanced {...} region, ignoring braces inside strings. A plain
 * indexOf/lastIndexOf pair cannot do this: it merges two separate objects
 * into one unparseable span.
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

// A model's answer carries a score under one of these keys.
function readScoreField(candidate) {
  return candidate?.truth_score ?? candidate?.severity_score;
}

function selectAssessmentObject(candidates) {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]);
      if (parsed && typeof parsed === 'object' && readScoreField(parsed) !== undefined) {
        return parsed;
      }
    } catch {
      // Not valid JSON - keep looking further back.
    }
  }
  return null;
}

function parseModelJson(text) {
  const withoutReasoning = stripCodeFences(stripReasoningBlocks(text));

  try {
    const parsed = JSON.parse(withoutReasoning);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Fall through to scanning.
  }

  const fromStripped = selectAssessmentObject(findBalancedJsonObjects(withoutReasoning));
  if (fromStripped) return fromStripped;

  const fromRaw = selectAssessmentObject(findBalancedJsonObjects(text));
  if (fromRaw) return fromRaw;

  throw new Error('model did not return parseable JSON');
}

/**
 * Validate a model's answer. A score outside 0-100, or a missing
 * explanation, is rejected rather than coerced - a fabricated number
 * presented as a model verdict is worse than an honest failure.
 */
function normalizeAssessment(rawAssessment) {
  const score = Number(readScoreField(rawAssessment));
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('model returned an invalid truth score');
  }
  if (typeof rawAssessment.reasoning !== 'string' || !rawAssessment.reasoning.trim()) {
    throw new Error('model returned no reasoning');
  }

  return {
    truthScore: Math.round(score),
    // Kept so existing consumers of the per-breach shape keep working.
    severityScore: Math.round(score),
    evidence: typeof rawAssessment.evidence === 'string' ? rawAssessment.evidence : '',
    reasoning: rawAssessment.reasoning,
    recommendedAction: typeof rawAssessment.recommended_action === 'string'
      ? rawAssessment.recommended_action
      : '',
    topRisks: Array.isArray(rawAssessment.top_risks)
      ? rawAssessment.top_risks.filter((risk) => typeof risk === 'string')
      : [],
  };
}

/**
 * Ask ONE model for its Truth Score over the whole breach profile.
 * Failures are returned rather than thrown, so one model going down still
 * leaves the other model's verdict intact.
 */
async function getTruthScoreFromModel(client, model, breaches) {
  try {
    let completion = await callGonkaModel(client, model, buildTruthScorePrompt(breaches));

    // The router sometimes answers with a different model than requested,
    // which would cost us the independence that makes cross-verification
    // meaningful. Misrouting is intermittent, so one retry usually lands on
    // the right model, and we only pay for it when it actually happens.
    if (completion.misrouted) {
      console.warn(`[analyze] ${model} was misrouted to ${completion.actualModel}; retrying once`);
      completion = await callGonkaModel(client, model, buildTruthScorePrompt(breaches));
    }

    const assessment = normalizeAssessment(parseModelJson(completion.text));

    return {
      ok: true,
      model,
      actualModel: completion.actualModel,
      misrouted: completion.misrouted,
      requestId: completion.requestId,
      requestIdSource: completion.requestIdSource,
      ...assessment,
    };
  } catch (error) {
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
 * Compare the models' Truth Scores. Disagreement is a first-class outcome
 * here, not an error: showing that two independent models reached different
 * conclusions is the point of running more than one.
 */
function reconcileTruthScores(primaryVerdict, secondaryVerdict) {
  const successfulVerdicts = [primaryVerdict, secondaryVerdict].filter((verdict) => verdict?.ok);

  if (successfulVerdicts.length === 0) {
    return { status: 'unavailable', finalScore: null, scoreDifference: null };
  }

  if (successfulVerdicts.length === 1) {
    return {
      status: 'single-model',
      finalScore: successfulVerdicts[0].truthScore,
      scoreDifference: null,
    };
  }

  const scoreDifference = Math.abs(
    primaryVerdict.truthScore - secondaryVerdict.truthScore,
  );

  // If the router served the same model for both requests there was no
  // cross-verification - two answers from one model are not independent, and
  // presenting them as consensus would be the one dishonest thing this
  // dashboard must never do.
  if (primaryVerdict.actualModel === secondaryVerdict.actualModel) {
    return {
      status: 'unverified',
      finalScore: Math.max(primaryVerdict.truthScore, secondaryVerdict.truthScore),
      scoreDifference,
      note: `The router answered both requests with ${primaryVerdict.actualModel}, so these two scores are not independent.`,
    };
  }

  if (scoreDifference <= CONSENSUS_THRESHOLD) {
    return {
      status: 'consensus',
      finalScore: Math.round((primaryVerdict.truthScore + secondaryVerdict.truthScore) / 2),
      scoreDifference,
    };
  }

  // On a genuine dispute take the HIGHER score: under-warning someone about
  // a real exposure is the more harmful of the two possible mistakes.
  return {
    status: 'disputed',
    finalScore: Math.max(primaryVerdict.truthScore, secondaryVerdict.truthScore),
    scoreDifference,
  };
}

function riskTier(score) {
  if (score === null) return 'Unknown';
  if (score >= 75) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

/**
 * Run the full pipeline for one already-shaped breach lookup.
 *
 * @param {object} shapedBreachData - output of shapeBreachData()
 * @returns {Promise<object>} the multi-model Truth Score report
 */
async function analyzeBreachSeverity(shapedBreachData) {
  const email = shapedBreachData?.email ?? '';
  const allBreaches = shapedBreachData?.breaches ?? [];

  if (allBreaches.length === 0) {
    return {
      email,
      totalBreaches: 0,
      analyzedBreaches: 0,
      truncated: false,
      overallRiskScore: 0,
      riskTier: 'Low',
      consensusStatus: 'agreement',
      scoreDifference: 0,
      models: [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY],
      truthScores: [],
      breaches: [],
    };
  }

  // Largest first, so if we do cap the profile it is the most consequential
  // breaches the models see.
  const breachesBySeverity = [...allBreaches].sort(
    (left, right) => (right.recordsExposed || 0) - (left.recordsExposed || 0),
  );
  const breachesToAnalyze = breachesBySeverity.slice(0, MAX_BREACHES_ANALYZED);

  const client = createGonkaClient();

  // One call per model, both in flight together. Two inference calls total,
  // whatever the breach count - which is what keeps this demo-fast.
  const [primaryVerdict, secondaryVerdict] = await mapWithConcurrencyLimit(
    [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY],
    GONKA_MAX_CONCURRENCY,
    (model) => getTruthScoreFromModel(client, model, breachesToAnalyze),
  );

  const reconciled = reconcileTruthScores(primaryVerdict, secondaryVerdict);

  // Which breaches the models themselves called out as the worst.
  const flaggedRisks = [primaryVerdict, secondaryVerdict]
    .filter((verdict) => verdict?.ok)
    .flatMap((verdict) => verdict.topRisks);

  return {
    email,
    totalBreaches: allBreaches.length,
    analyzedBreaches: breachesToAnalyze.length,
    truncated: breachesToAnalyze.length < allBreaches.length,

    // The headline number, produced by the models rather than by us.
    overallRiskScore: reconciled.finalScore,
    riskTier: riskTier(reconciled.finalScore),
    consensusStatus: reconciled.status === 'consensus' ? 'agreement'
      : reconciled.status === 'disputed' ? 'divergence'
        : reconciled.status,
    scoreDifference: reconciled.scoreDifference,
    consensusNote: reconciled.note ?? null,

    models: [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY],

    // One entry per model: its own Truth Score, its reasoning, and the
    // Gonka Request ID proving where that score came from.
    truthScores: [primaryVerdict, secondaryVerdict],

    // The breaches the models judged, annotated with any they flagged.
    breaches: breachesToAnalyze.map((breach) => ({
      name: breach.name,
      year: breach.year,
      industry: breach.industry,
      recordsExposed: breach.recordsExposed,
      passwordRisk: breach.passwordRisk,
      dataExposed: breach.dataExposed,
      flaggedByModel: flaggedRisks.some(
        (risk) => risk.toLowerCase() === String(breach.name).toLowerCase(),
      ),
    })),
  };
}

export {
  analyzeBreachSeverity,
  getTruthScoreFromModel,
  reconcileTruthScores,
  buildTruthScorePrompt,
  buildSeverityPrompt,
  parseModelJson,
  normalizeAssessment,
  riskTier,
  CONSENSUS_THRESHOLD,
};
