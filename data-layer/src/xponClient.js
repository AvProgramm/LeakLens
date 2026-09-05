/**
 * xponClient.js
 * Thin wrapper around the XposedOrNot breach-analytics API.
 * No API key required. Rate limits (per IP): 2 req/sec, 25/hour, 100/day.
 * Docs: https://xposedornot.com/api_doc
 *
 * Uses Node's built-in fetch (Node 18+), so there is no node-fetch
 * dependency to install or keep current.
 */

const API_BASE_URL = 'https://api.xposedornot.com/v1';

// Only the 2-requests-per-second ceiling is recoverable by waiting. The
// hourly and daily quotas are not, so we retry ONCE with a short pause and
// then surface the limit. Hammering a 25/hour quota with more retries just
// spends the remaining allowance to learn what the first reply already said.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1100;
const REQUEST_TIMEOUT_MS = 10000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  if (status !== undefined) error.status = status;
  return error;
}

async function requestJson(url, label) {
  let lastNetworkError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Retry a 429 exactly once, spaced past the per-second window.
      if (response.status === 429) {
        if (attempt === MAX_ATTEMPTS - 1) {
          throw createError(`${label} rate limit exceeded`, 'RATE_LIMITED', 429);
        }
        await wait(RETRY_DELAY_MS);
        continue;
      }

      if (!response.ok) {
        throw createError(`${label} API error: ${response.status}`, 'XON_ERROR', response.status);
      }

      return await response.json();
    } catch (error) {
      // Deliberate API errors are final - only genuine network faults retry.
      if (error.code === 'RATE_LIMITED' || error.code === 'XON_ERROR') throw error;

      lastNetworkError = error;
      if (attempt === MAX_ATTEMPTS - 1) break;
      await wait(RETRY_DELAY_MS);
    }
  }

  throw createError(
    `${label} unreachable: ${lastNetworkError?.message ?? 'unknown network error'}`,
    'XON_UNREACHABLE',
  );
}

/**
 * Fetch raw breach analytics for an email from XposedOrNot.
 * Returns the raw parsed JSON exactly as XON sends it - no shaping here.
 * Shaping happens in shapeBreachData.js so the two concerns stay separate
 * and testable independently.
 *
 * A 404 from XON means "this email is not in any known breach", which is a
 * successful clean result rather than an error, so it maps to an empty
 * object that shapeBreachData turns into the standard clean contract.
 *
 * @param {string} email
 * @returns {Promise<object>} raw XON response
 */
async function fetchBreachAnalytics(email) {
  try {
    return await requestJson(
      `${API_BASE_URL}/breach-analytics?email=${encodeURIComponent(email)}`,
      'XposedOrNot',
    );
  } catch (error) {
    if (error.code === 'XON_ERROR' && error.status === 404) return {};
    throw error;
  }
}

export { fetchBreachAnalytics };
