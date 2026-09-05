/**
 * xponClient.js
 * Thin wrapper around the XposedOrNot breach-analytics API.
 * No API key required. Rate limits (per IP): 2 req/sec, 25/hour, 100/day.
 * Docs: https://xposedornot.com/api_doc
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://api.xposedornot.com/v1/breach-analytics';

/**
 * Fetch raw breach analytics for an email from XposedOrNot.
 * Returns the raw parsed JSON exactly as XON sends it — no shaping here.
 * Shaping happens in shapeBreachData.js so the two concerns stay separate
 * and testable independently.
 *
 * @param {string} email
 * @returns {Promise<object>} raw XON response
 * @throws {Error} on network failure or non-2xx response
 */
async function fetchBreachAnalytics(email) {
  const url = `${BASE_URL}?email=${encodeURIComponent(email)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeout: 10000,
  });

  // XON returns 200 even for "no breaches found" — everything is null
  // except BreachesSummary.site, which is "". We still guard on status
  // for actual API failures / rate-limit responses.
  if (!res.ok) {
    if (res.status === 429) {
      const err = new Error('XposedOrNot rate limit exceeded');
      err.code = 'RATE_LIMITED';
      throw err;
    }
    const err = new Error(`XposedOrNot API error: ${res.status}`);
    err.code = 'XON_ERROR';
    throw err;
  }

  const data = await res.json();
  if (process.env.DEBUG_XON) {
    console.log('[xponClient] raw BreachMetrics:', JSON.stringify(data.BreachMetrics, null, 2));
  }
  return data;
}

module.exports = { fetchBreachAnalytics };