/**
 * consensus.test.js
 * The multi-model consensus logic is the heart of the submission, so this
 * is the suite that proves the "we surface disagreement instead of hiding
 * it" claim is actually true in code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileModelVerdicts,
  calculateOverallRiskScore,
  parseModelJson,
  normalizeAssessment,
  buildSeverityPrompt,
  CONSENSUS_THRESHOLD,
} from '../src/analyzeBreachSeverity.js';

const exampleBreach = { name: 'ExampleBreach' };

function successfulVerdict(model, severityScore) {
  return {
    ok: true,
    model,
    severityScore,
    reasoning: 'reason',
    recommendedAction: 'action',
    evidence: 'passwords',
    requestId: `req-${model}-${severityScore}`,
  };
}

function failedVerdict(model) {
  return { ok: false, model, error: 'timeout' };
}

test('close scores are reported as consensus and averaged', () => {
  const result = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('A', 60),
    successfulVerdict('B', 70),
  );

  assert.equal(result.status, 'consensus');
  assert.equal(result.finalScore, 65);
  assert.equal(result.scoreDifference, 10);
});

test('a wide split is reported as disputed, not averaged away', () => {
  const result = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('A', 20),
    successfulVerdict('B', 90),
  );

  assert.equal(result.status, 'disputed');
  // The cautious choice: warn at the higher score rather than split the
  // difference and under-warn someone about a real exposure.
  assert.equal(result.finalScore, 90);
  assert.equal(result.scoreDifference, 70);
});

test('the consensus boundary is inclusive', () => {
  const atThreshold = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('A', 40),
    successfulVerdict('B', 40 + CONSENSUS_THRESHOLD),
  );
  assert.equal(atThreshold.status, 'consensus');

  const justOver = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('A', 40),
    successfulVerdict('B', 41 + CONSENSUS_THRESHOLD),
  );
  assert.equal(justOver.status, 'disputed');
});

test('one model failing still yields a labelled single-model result', () => {
  const result = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('A', 55),
    failedVerdict('B'),
  );

  assert.equal(result.status, 'single-model');
  assert.equal(result.finalScore, 55);
});

test('both models failing yields no invented score', () => {
  const result = reconcileModelVerdicts(exampleBreach, failedVerdict('A'), failedVerdict('B'));

  assert.equal(result.status, 'unavailable');
  assert.equal(result.finalScore, null);
});

test('more breaches never lowers the overall score', () => {
  const oneCriticalBreach = [{ finalScore: 90 }];
  const sameBreachPlusTrivialOnes = [
    { finalScore: 90 },
    { finalScore: 10 },
    { finalScore: 10 },
    { finalScore: 10 },
  ];

  const scoreAlone = calculateOverallRiskScore(oneCriticalBreach);
  const scoreWithMore = calculateOverallRiskScore(sameBreachPlusTrivialOnes);

  // This is the averaging bug this scoring model exists to prevent: adding
  // exposure must never make someone look safer.
  assert.ok(
    scoreWithMore >= scoreAlone,
    `expected >= ${scoreAlone} with more exposure, got ${scoreWithMore}`,
  );
  assert.equal(scoreAlone, 90);
});

test('overall score is capped at 100 and ignores unscored breaches', () => {
  assert.equal(calculateOverallRiskScore([{ finalScore: 100 }, { finalScore: 95 }]), 100);
  assert.equal(calculateOverallRiskScore([{ finalScore: 40 }, { finalScore: null }]), 40);
  assert.equal(calculateOverallRiskScore([{ finalScore: null }]), null);
  assert.equal(calculateOverallRiskScore([]), null);
});

test('model JSON survives markdown fences and surrounding prose', () => {
  assert.deepEqual(parseModelJson('{"severity_score": 50}'), { severity_score: 50 });
  assert.deepEqual(
    parseModelJson('```json\n{"severity_score": 50}\n```'),
    { severity_score: 50 },
  );
  assert.deepEqual(
    parseModelJson('Here is my assessment:\n{"severity_score": 50}\nHope that helps.'),
    { severity_score: 50 },
  );
});

test('unparseable model output raises rather than returning junk', () => {
  assert.throws(() => parseModelJson('I cannot help with that.'));
});

test('out-of-range or missing scores are rejected', () => {
  assert.throws(() => normalizeAssessment({ severity_score: 150 }));
  assert.throws(() => normalizeAssessment({ severity_score: -1 }));
  assert.throws(() => normalizeAssessment({ severity_score: 'high' }));
  assert.throws(() => normalizeAssessment({}));

  const valid = normalizeAssessment({
    severity_score: 72.6,
    reasoning: 'r',
    recommended_action: 'a',
    evidence: 'e',
  });
  assert.equal(valid.severityScore, 73);
});

test('the prompt states the facts and demands evidence-backed JSON', () => {
  const prompt = buildSeverityPrompt({
    name: 'TestBreach',
    year: '2015',
    dataExposed: ['Passwords', 'Email addresses'],
    passwordRisk: 'plaintext',
  });

  assert.match(prompt, /TestBreach/);
  assert.match(prompt, /Passwords, Email addresses/);
  assert.match(prompt, /severity_score/);
  assert.match(prompt, /evidence/);
  // The neutrality instruction the hackathon brief asks for.
  assert.match(prompt, /Do not speculate/);
});
