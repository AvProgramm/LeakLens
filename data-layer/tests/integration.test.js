/**
 * integration.test.js
 * Proves the whole Gonka path works without spending real credits.
 *
 * We stand up a local server that speaks the same OpenAI-compatible
 * protocol the Gonka Router does - POST /v1/chat/completions, bearer auth,
 * { choices: [{ message: { content } }] } responses - and point the real
 * client at it. That exercises the actual SDK call, the actual JSON
 * parsing, the actual consensus logic and the actual Request ID extraction.
 *
 * This is the test that would have caught the original bug, where the code
 * spoke Anthropic's protocol to an OpenAI-compatible gateway.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Scores the stub returns, keyed by model, so we can drive agreement and
// disagreement deterministically from the test body.
const scoresByModel = {
  'test/model-a': 80,
  'test/model-b': 85,
};

let receivedAuthorizationHeader = null;
let receivedRequestBodies = [];

/**
 * A minimal stand-in for the Gonka Router.
 */
function startStubRouter() {
  const server = createServer((req, res) => {
    receivedAuthorizationHeader = req.headers.authorization ?? null;

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [{ id: 'test/model-a' }, { id: 'test/model-b' }],
      }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsedBody = JSON.parse(body || '{}');
      receivedRequestBodies.push(parsedBody);

      const severityScore = scoresByModel[parsedBody.model] ?? 50;
      // Echo the requested model back, as a correctly-routing gateway does.

      res.writeHead(200, {
        'content-type': 'application/json',
        // The routing header the dashboard displays as on-chain proof.
        'x-gonka-request-id': `gonka-${parsedBody.model}-req`,
      });
      res.end(JSON.stringify({
        id: `chatcmpl-${parsedBody.model}`,
        model: parsedBody.model,
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              truth_score: severityScore,
              evidence: 'Passwords and email addresses',
              reasoning: 'Credentials were exposed.',
              recommended_action: 'Change the password and enable 2FA.',
            }),
          },
        }],
      }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const stubServer = await startStubRouter();
const stubPort = stubServer.address().port;

// config.js reads the environment once at import time, so these must be set
// before the modules under test are imported.
process.env.GONKA_API_KEY = 'sk-test-key';
process.env.GONKA_BASE_URL = `http://127.0.0.1:${stubPort}/v1`;
process.env.GONKA_MODEL_PRIMARY = 'test/model-a';
process.env.GONKA_MODEL_SECONDARY = 'test/model-b';
process.env.MAX_BREACHES_ANALYZED = '5';

const { analyzeBreachSeverity } = await import('../src/analyzeBreachSeverity.js');
const { createGonkaClient, listAvailableModels } = await import('../src/gonkaClient.js');

test.after(() => stubServer.close());

// A shaped contract object, exactly as shapeBreachData would produce it.
const shapedBreachData = {
  email: 'user@example.com',
  breaches: [
    {
      name: 'ExampleBreach',
      year: '2015',
      industry: 'Retail',
      recordsExposed: 500000,
      passwordRisk: 'plaintext',
      dataExposed: ['Email addresses', 'Passwords'],
      description: 'A retail breach.',
    },
  ],
};

test('a full analysis runs against an OpenAI-compatible router', async () => {
  receivedRequestBodies = [];
  const report = await analyzeBreachSeverity(shapedBreachData);

  assert.equal(report.totalBreaches, 1);
  assert.equal(report.analyzedBreaches, 1);
  assert.equal(report.truncated, false);

  // Each model returns its OWN Truth Score; 80 and 85 are within the
  // agreement threshold, so the reconciled headline is their mean.
  assert.equal(report.truthScores.length, 2);
  assert.ok(report.truthScores.every((verdict) => verdict.ok));
  assert.deepEqual(
    report.truthScores.map((verdict) => verdict.truthScore).sort(),
    [80, 85],
  );
  assert.equal(report.overallRiskScore, 83);
  assert.equal(report.consensusStatus, 'agreement');
  assert.equal(report.riskTier, 'High');
});

test('the request actually hit the chat-completions endpoint with bearer auth', () => {
  assert.equal(receivedAuthorizationHeader, 'Bearer sk-test-key');
  assert.ok(receivedRequestBodies.length >= 2, 'expected one call per model');

  // The OpenAI protocol shape - this is what the original Anthropic-SDK
  // version got wrong.
  for (const body of receivedRequestBodies) {
    assert.ok(Array.isArray(body.messages), 'expected OpenAI messages array');
    assert.equal(body.messages[0].role, 'user');
    assert.equal(body.temperature, 0);
  }
});

test('both models are actually consulted, not just one', () => {
  const modelsCalled = new Set(receivedRequestBodies.map((body) => body.model));
  assert.ok(modelsCalled.has('test/model-a'));
  assert.ok(modelsCalled.has('test/model-b'));
});

test('every model verdict carries its Gonka Request ID', async () => {
  const report = await analyzeBreachSeverity(shapedBreachData);

  // The brief requires a Request ID per inference step, so every verdict
  // must carry one and say which header it came from.
  for (const verdict of report.truthScores) {
    assert.ok(verdict.ok);
    assert.equal(verdict.requestId, `gonka-${verdict.model}-req`);
    assert.equal(verdict.requestIdSource, 'x-gonka-request-id');
  }
});

test('a wide disagreement is reported as divergence, taking the higher score', async () => {
  scoresByModel['test/model-b'] = 20;
  try {
    const report = await analyzeBreachSeverity(shapedBreachData);

    assert.equal(report.consensusStatus, 'divergence');
    assert.equal(report.overallRiskScore, 80);
    assert.equal(report.scoreDifference, 60);
  } finally {
    scoresByModel['test/model-b'] = 85;
  }
});

test('the model catalogue is readable, as verify-gonka relies on', async () => {
  const client = createGonkaClient();
  const models = await listAvailableModels(client);
  assert.deepEqual(models, ['test/model-a', 'test/model-b']);
});

test('a clean email short-circuits without calling any model', async () => {
  receivedRequestBodies = [];
  const report = await analyzeBreachSeverity({ email: 'clean@example.com', breaches: [] });

  assert.equal(report.totalBreaches, 0);
  assert.equal(report.overallRiskScore, 0);
  assert.deepEqual(report.breaches, []);
  assert.equal(receivedRequestBodies.length, 0, 'should not spend credits on a clean email');
});

test('analysis is capped so a heavily-breached email cannot stall the demo', async () => {
  const manyBreaches = {
    email: 'user@example.com',
    breaches: Array.from({ length: 20 }, (unused, index) => ({
      name: `Breach${index}`,
      recordsExposed: index * 1000,
      dataExposed: ['Email addresses'],
    })),
  };

  const report = await analyzeBreachSeverity(manyBreaches);

  assert.equal(report.totalBreaches, 20);
  assert.equal(report.analyzedBreaches, 5, 'should respect MAX_BREACHES_ANALYZED');
  assert.equal(report.truncated, true, 'must tell the user it judged a subset');
  // One call per model regardless of breach count - that is what keeps a
  // live demo fast and bounds the token spend.
  assert.equal(receivedRequestBodies.length, 2, 'expected exactly one call per model');
});


test('a repeated analysis is served from cache without calling any model', async () => {
  // The demo depends on this: a warmed scan must be instant because WE
  // cached it, not because the router happened to cache the prompt.
  const { app } = await import('../src/server.js');
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const url = `http://127.0.0.1:${port}/api/analyze-breach?email=cachetest@example.com`;

    receivedRequestBodies = [];
    const first = await fetch(url).then((r) => r.json());
    const callsAfterFirst = receivedRequestBodies.length;

    const second = await fetch(url).then((r) => r.json());

    assert.equal(second.cached, true, 'second call should report cached');
    assert.equal(first.overallRiskScore, second.overallRiskScore);
    assert.equal(
      receivedRequestBodies.length,
      callsAfterFirst,
      'a cached analysis must not call the models again',
    );
  } finally {
    server.close();
  }
});
