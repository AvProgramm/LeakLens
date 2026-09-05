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

function successfulVerdict(model, severityScore, actualModel = model) {
  return {
    ok: true,
    model,
    // Who actually answered. Defaults to the requested model; pass a
    // different value to simulate the router misrouting the request.
    actualModel,
    misrouted: actualModel !== model,
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

// The Gonka Router was observed serving one model's answer for a different
// model's request. If that happens, the two verdicts are not independent and
// we must not present them as cross-verified.
test('two verdicts from the same actual model are not called consensus', () => {
  const result = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('modelA', 80, 'MiniMaxAI/MiniMax-M2.7'),
    // Requested modelB, but the router answered with MiniMax again.
    successfulVerdict('modelB', 82, 'MiniMaxAI/MiniMax-M2.7'),
  );

  assert.equal(result.status, 'unverified');
  assert.match(result.note, /not independent/);
  // Still reports a score, but the cautious one.
  assert.equal(result.finalScore, 82);
});

test('genuinely different models still reach consensus', () => {
  const result = reconcileModelVerdicts(
    exampleBreach,
    successfulVerdict('modelA', 80, 'MiniMaxAI/MiniMax-M2.7'),
    successfulVerdict('modelB', 85, 'deepseek-ai/DeepSeek-V4-Flash-0731'),
  );

  assert.equal(result.status, 'consensus');
  assert.equal(result.finalScore, 83);
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

// The models Gonka routes to are reasoning models. These are the exact
// shapes they were observed producing against the live router.
test('a closed <think> block is stripped before parsing', () => {
  const reply = `<think>The user wants {"severity_score": 0-100, ...}. I will say 92.</think>
{"severity_score": 92, "evidence": "plaintext passwords", "reasoning": "r", "recommended_action": "a"}`;

  const parsed = parseModelJson(reply);
  // 92 is the answer; the 0-100 inside the reasoning must not be mistaken
  // for it, and the two objects must not be merged into one bad span.
  assert.equal(parsed.severity_score, 92);
  assert.equal(parsed.evidence, 'plaintext passwords');
});

test('a draft inside reasoning does not beat the final answer', () => {
  const reply = `<think>Maybe {"severity_score": 40} … on reflection that is too low.</think>
{"severity_score": 88, "reasoning": "r", "recommended_action": "a"}`;

  assert.equal(parseModelJson(reply).severity_score, 88);
});

test('an unclosed <think> still yields the last complete assessment', () => {
  // What a truncated reasoning model leaves behind: no closing tag, with the
  // candidate answer sitting inside the reasoning.
  const truncated = `<think>Weighing it up. Thus produce:

{"severity_score": 92, "evidence": "e", "reasoning": "r", "recommended_action": "a"}

Check format: fields are correct.`;

  assert.equal(parseModelJson(truncated).severity_score, 92);
});

test('braces inside strings do not break object detection', () => {
  const reply = '{"severity_score": 70, "reasoning": "uses a { brace } literally", "recommended_action": "a"}';
  assert.equal(parseModelJson(reply).reasoning, 'uses a { brace } literally');
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
