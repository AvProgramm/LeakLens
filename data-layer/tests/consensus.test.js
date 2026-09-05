/**
 * consensus.test.js
 * The pipeline the hackathon brief asks for is:
 *
 *     email -> models -> each model returns its OWN Truth Score
 *
 * These tests lock that shape: the headline number must come from the
 * models and the two models must be genuinely comparable to each other.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileTruthScores,
  matchesFlaggedRisk,
  normalizeBreachKey,
  parseModelJson,
  normalizeAssessment,
  buildTruthScorePrompt,
  riskTier,
  CONSENSUS_THRESHOLD,
} from '../src/analyzeBreachSeverity.js';

function verdict(model, truthScore, actualModel = model) {
  return {
    ok: true,
    model,
    actualModel,
    misrouted: actualModel !== model,
    truthScore,
    reasoning: 'reason',
    recommendedAction: 'action',
    evidence: 'passwords',
    topRisks: [],
    requestId: `req-${model}-${truthScore}`,
  };
}

const failed = (model) => ({ ok: false, model, error: 'timeout' });

test('close Truth Scores are reported as agreement and averaged', () => {
  const result = reconcileTruthScores(verdict('A', 60), verdict('B', 70));
  assert.equal(result.status, 'consensus');
  assert.equal(result.finalScore, 65);
  assert.equal(result.scoreDifference, 10);
});

test('a wide split is reported as disputed, not averaged away', () => {
  const result = reconcileTruthScores(verdict('A', 20), verdict('B', 90));
  assert.equal(result.status, 'disputed');
  // The cautious choice: warn at the higher score rather than split the
  // difference and under-warn about a real exposure.
  assert.equal(result.finalScore, 90);
  assert.equal(result.scoreDifference, 70);
});

test('the agreement boundary is inclusive', () => {
  assert.equal(
    reconcileTruthScores(verdict('A', 40), verdict('B', 40 + CONSENSUS_THRESHOLD)).status,
    'consensus',
  );
  assert.equal(
    reconcileTruthScores(verdict('A', 40), verdict('B', 41 + CONSENSUS_THRESHOLD)).status,
    'disputed',
  );
});

// The router was observed answering one model's request with another model.
test('two scores from the same actual model are not called agreement', () => {
  const result = reconcileTruthScores(
    verdict('A', 80, 'MiniMaxAI/MiniMax-M2.7'),
    verdict('B', 82, 'MiniMaxAI/MiniMax-M2.7'),
  );
  assert.equal(result.status, 'unverified');
  assert.match(result.note, /not independent/);
  assert.equal(result.finalScore, 82);
});

test('genuinely different models still reach agreement', () => {
  const result = reconcileTruthScores(
    verdict('A', 80, 'MiniMaxAI/MiniMax-M2.7'),
    verdict('B', 85, 'deepseek-ai/DeepSeek-V4-Flash-0731'),
  );
  assert.equal(result.status, 'consensus');
  assert.equal(result.finalScore, 83);
});

test('one model failing still yields a labelled single-model score', () => {
  const result = reconcileTruthScores(verdict('A', 55), failed('B'));
  assert.equal(result.status, 'single-model');
  assert.equal(result.finalScore, 55);
});

test('both models failing invents no score', () => {
  const result = reconcileTruthScores(failed('A'), failed('B'));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.finalScore, null);
});

test('risk tiers map to the documented bands', () => {
  assert.equal(riskTier(90), 'High');
  assert.equal(riskTier(75), 'High');
  assert.equal(riskTier(50), 'Medium');
  assert.equal(riskTier(10), 'Low');
  assert.equal(riskTier(null), 'Unknown');
});

test('the prompt states the facts and demands evidence-backed JSON', () => {
  const prompt = buildTruthScorePrompt([
    { name: 'TestBreach', year: '2015', dataExposed: ['Passwords'], recordsExposed: 500 },
  ]);
  assert.match(prompt, /TestBreach/);
  assert.match(prompt, /truth_score/);
  assert.match(prompt, /evidence/);
  assert.match(prompt, /Do not speculate/);
  // The email address must never reach a model.
  assert.doesNotMatch(prompt, /@/);
});

test('more breaches must never read as less risk in the prompt', () => {
  const prompt = buildTruthScorePrompt([{ name: 'A' }, { name: 'B' }]);
  assert.match(prompt, /More\s+breaches means more exposure, never less/);
});

// Reasoning models emit <think> blocks that quote our prompt back.
test('a closed <think> block is stripped before parsing', () => {
  const reply = `<think>They want {"truth_score": 0-100}. I will say 92.</think>
{"truth_score": 92, "evidence": "e", "reasoning": "r", "recommended_action": "a"}`;
  assert.equal(parseModelJson(reply).truth_score, 92);
});

test('a draft inside reasoning does not beat the final answer', () => {
  const reply = `<think>Maybe {"truth_score": 40}, too low.</think>
{"truth_score": 88, "reasoning": "r", "recommended_action": "a"}`;
  assert.equal(parseModelJson(reply).truth_score, 88);
});

test('an unclosed <think> still yields the last complete assessment', () => {
  const truncated = `<think>Weighing it. Thus produce:

{"truth_score": 92, "evidence": "e", "reasoning": "r", "recommended_action": "a"}

Check format: correct.`;
  assert.equal(parseModelJson(truncated).truth_score, 92);
});

test('braces inside strings do not break object detection', () => {
  const reply = '{"truth_score": 70, "reasoning": "a { brace } literally", "recommended_action": "a"}';
  assert.equal(parseModelJson(reply).reasoning, 'a { brace } literally');
});

test('unparseable output raises rather than returning junk', () => {
  assert.throws(() => parseModelJson('I cannot help with that.'));
});

test('out-of-range or unexplained scores are rejected', () => {
  assert.throws(() => normalizeAssessment({ truth_score: 150, reasoning: 'r' }));
  assert.throws(() => normalizeAssessment({ truth_score: -1, reasoning: 'r' }));
  assert.throws(() => normalizeAssessment({ truth_score: 'high', reasoning: 'r' }));
  assert.throws(() => normalizeAssessment({ truth_score: 50 }), /no reasoning/);
  assert.throws(() => normalizeAssessment({}));
});

test('a valid assessment is rounded and normalised', () => {
  const assessment = normalizeAssessment({
    truth_score: 72.6,
    reasoning: 'r',
    recommended_action: 'a',
    evidence: 'e',
    top_risks: ['Collection-1', 42],
  });
  assert.equal(assessment.truthScore, 73);
  assert.equal(assessment.recommendedAction, 'a');
  // Non-string entries are dropped rather than rendered as "42".
  assert.deepEqual(assessment.topRisks, ['Collection-1']);
});

test('the legacy severity_score key is still accepted', () => {
  assert.equal(normalizeAssessment({ severity_score: 61, reasoning: 'r' }).truthScore, 61);
});


// Models paraphrase breach names. Exact string comparison meant a paraphrase
// produced no flag at all, which reads as "nothing was flagged" rather than
// as a matching failure.
test('flagged-risk matching survives the ways models rewrite a name', () => {
  const flagged = ['Collection #1', 'the ExploitIN dump'].map(normalizeBreachKey);

  assert.equal(matchesFlaggedRisk('Collection-1', flagged), true);
  assert.equal(matchesFlaggedRisk('ExploitIN', flagged), true);
  assert.equal(matchesFlaggedRisk('collection 1', flagged), true);
});

test('flagged-risk matching does not flag unrelated breaches', () => {
  const flagged = ['Collection-1'].map(normalizeBreachKey);

  assert.equal(matchesFlaggedRisk('AntiPublicCombo', flagged), false);
  assert.equal(matchesFlaggedRisk('Verifications', flagged), false);
  assert.equal(matchesFlaggedRisk('', flagged), false);
});

test('a short key cannot match half the list by containment', () => {
  // "AI" normalises to a 2-char key; without the length floor it would be a
  // substring of almost every breach name.
  const flagged = ['AI'].map(normalizeBreachKey);
  assert.equal(matchesFlaggedRisk('AlienStealerLogs', flagged), false);
  assert.equal(matchesFlaggedRisk('Chain-AI', flagged), false);
});

test('normalizeBreachKey strips punctuation, case and spacing', () => {
  assert.equal(normalizeBreachKey('Collection #1'), 'collection1');
  assert.equal(normalizeBreachKey('Anti-Public Combo'), 'antipubliccombo');
  assert.equal(normalizeBreachKey(null), '');
});
