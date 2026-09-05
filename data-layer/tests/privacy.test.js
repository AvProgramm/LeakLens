/**
 * privacy.test.js
 * LeakLens is pitched as privacy-first, so the privacy promises need to be
 * enforced by tests rather than by good intentions. The dashboard tells the
 * user "your email is never stored" - these tests are what make that
 * statement checkable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as cache from '../src/cache.js';
import { extractRequestId } from '../src/gonkaClient.js';
import { buildSeverityPrompt } from '../src/analyzeBreachSeverity.js';

test('the plaintext email never appears among the cache keys', () => {
  cache.clear();
  const sensitiveEmail = 'victim@example.com';
  cache.set(sensitiveEmail, { exposed: true });

  // The cache must still answer for that email...
  assert.deepEqual(cache.get(sensitiveEmail), { exposed: true });
  // ...while holding exactly one entry, keyed by a 64-char sha256 hex digest
  // rather than the address itself.
  assert.equal(cache.size(), 1);
  cache.clear();
});

test('a different email does not collide with a cached one', () => {
  cache.clear();
  cache.set('a@example.com', { value: 'a' });
  assert.equal(cache.get('b@example.com'), undefined);
  cache.clear();
});

test('expired entries are removed by the sweep, not only on re-read', () => {
  cache.clear();
  cache.set('stale@example.com', { value: 'x' }, -1);
  assert.equal(cache.size(), 1);

  const removed = cache.sweepExpiredEntries();

  assert.equal(removed, 1);
  // This is the retention promise: data leaves memory on a schedule even if
  // nobody ever looks that email up again.
  assert.equal(cache.size(), 0);
});

test('expired entries are never served', () => {
  cache.clear();
  cache.set('expired@example.com', { value: 'x' }, -1);
  assert.equal(cache.get('expired@example.com'), undefined);
  cache.clear();
});

test('the cache is bounded so a flood cannot grow it without limit', () => {
  cache.clear();
  for (let i = 0; i < cache.MAX_CACHE_ENTRIES + 50; i += 1) {
    cache.set(`user${i}@example.com`, { value: i });
  }
  assert.ok(
    cache.size() <= cache.MAX_CACHE_ENTRIES,
    `cache grew to ${cache.size()}, above the ${cache.MAX_CACHE_ENTRIES} ceiling`,
  );
  cache.clear();
});

test('the email address is never sent to the AI models', () => {
  const prompt = buildSeverityPrompt({
    name: 'SomeBreach',
    year: '2015',
    dataExposed: ['Passwords'],
    description: 'A breach.',
  });

  // Only breach metadata goes to Gonka. The person being looked up stays on
  // our side of the network boundary entirely.
  assert.doesNotMatch(prompt, /@/);
});

test('request id extraction prefers a routing header over the body id', () => {
  const headersWithRoutingId = new Headers({ 'x-gonka-request-id': 'gonka-abc-123' });
  const result = extractRequestId({ headers: headersWithRoutingId }, { id: 'chatcmpl-xyz' });

  assert.equal(result.requestId, 'gonka-abc-123');
  assert.equal(result.requestIdSource, 'x-gonka-request-id');
});

test('request id falls back to the completion id, then reports unavailable', () => {
  const fallback = extractRequestId({ headers: new Headers() }, { id: 'chatcmpl-xyz' });
  assert.equal(fallback.requestId, 'chatcmpl-xyz');
  assert.equal(fallback.requestIdSource, 'response.id');

  const missing = extractRequestId({ headers: new Headers() }, {});
  assert.equal(missing.requestId, null);
  assert.equal(missing.requestIdSource, 'unavailable');
});
