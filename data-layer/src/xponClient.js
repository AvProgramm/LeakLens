/**
 * xponClient.js
 * Thin wrapper around the XposedOrNot breach-analytics API.
 * No API key required. Rate limits (per IP): 2 req/sec, 25/hour, 100/day.
 * Docs: https://xposedornot.com/api_doc
 */

import fetch from 'node-fetch';

const API_BASE_URL = 'https://api.xposedornot.com/v1';
const MAX_RETRIES = 3;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, label) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 10000,
      });

      if (res.status === 429) {
        if (attempt === MAX_RETRIES - 1) {
          const err = new Error(`${label} rate limit exceeded`);
          err.code = 'RATE_LIMITED';
          throw err;
        }
        await wait(500 * (2 ** attempt));
        continue;
      }

      if (!res.ok) {
        const err = new Error(`${label} API error: ${res.status}`);
        err.code = 'XON_ERROR';
        err.status = res.status;
        throw err;
      }

      return await res.json();
    } catch (err) {
      if (err.code === 'RATE_LIMITED' || err.code === 'XON_ERROR') throw err;
      if (attempt === MAX_RETRIES - 1) throw err;
      await wait(250 * (2 ** attempt));
    }
  }
}

function getBreachNames(data) {
  const names = data?.breaches ?? data?.Breaches ?? data?.breach_names ?? data?.BreachNames;
  if (!Array.isArray(names)) return [];
  const flattenedNames = names.flat();
  return flattenedNames.map((name) => typeof name === 'string' ? name : name?.name ?? name?.breach)
    .filter(Boolean);
}

/**
 * Fetch raw breach analytics for an email from XposedOrNot.
 * Returns the raw parsed JSON exactly as XON sends it - no shaping here.
 * Shaping happens in shapeBreachData.js so the two concerns stay separate
 * and testable independently.
 *
 * @param {string} email
 * @returns {Promise<object>} raw XON response
 * @throws {Error} on network failure or non-2xx response
 */
async function fetchBreachAnalytics(email) {
  return requestJson(`${API_BASE_URL}/breach-analytics?email=${encodeURIComponent(email)}`, 'XposedOrNot');
}

async function fetchBreachNames(email) {
  let data;
  try {
    data = await requestJson(`${API_BASE_URL}/check-email/${encodeURIComponent(email)}`, 'XposedOrNot');
  } catch (error) {
    if (error.code === 'XON_ERROR' && error.status === 404) return [];
    throw error;
  }
  return getBreachNames(data);
}

export { fetchBreachAnalytics, fetchBreachNames };