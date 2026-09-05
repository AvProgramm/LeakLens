/**
 * gonkaClient.js
 * The one place LeakLens talks to the Gonka Network.
 *
 * WHY THE OPENAI SDK: the Gonka Router is an OpenAI-compatible gateway.
 * It exposes POST {base}/v1/chat/completions, authenticates with
 * `Authorization: Bearer <key>`, and replies in OpenAI's response shape
 * ({ id, choices: [{ message: { content } }] }). The official OpenAI SDK
 * speaks exactly that protocol, so pointing it at the router's base URL is
 * the supported integration path - no custom HTTP client needed.
 *
 * REQUEST IDs: the hackathon brief requires displaying a Gonka Request ID
 * for every inference step as proof the answer came from the decentralized
 * network rather than our own server. We therefore capture the response
 * HEADERS as well as the body, because the routing identifier lives in a
 * header and only the completion identifier lives in the body. Both are
 * returned so the dashboard can show whichever the router actually sends.
 */

import OpenAI from 'openai';
import {
  GONKA_API_KEY,
  GONKA_BASE_URL,
  GONKA_TIMEOUT_MS,
} from './config.js';

// Header names that gateways commonly use for the per-request identifier,
// most specific first. We do not know which one Gonka populates until a
// real key is used, so we look for all of them rather than guessing one.
const REQUEST_ID_HEADER_CANDIDATES = [
  'x-gonka-request-id',
  'gonka-request-id',
  'x-inference-id',
  'x-gonka-id',
  'x-request-id',
  'request-id',
];

/**
 * Build the Gonka client, or fail with a code the server can turn into a
 * clear 503. Throwing here rather than letting the SDK raise a generic 401
 * later is what makes a missing key diagnosable in one glance at the logs.
 */
function createGonkaClient() {
  if (!GONKA_API_KEY) {
    const error = new Error('GONKA_API_KEY is not configured');
    error.code = 'GONKA_CONFIG';
    throw error;
  }

  return new OpenAI({
    apiKey: GONKA_API_KEY,
    baseURL: GONKA_BASE_URL,
    timeout: GONKA_TIMEOUT_MS,
    maxRetries: 2,
  });
}

/**
 * Pull the routing identifier out of the raw HTTP response, remembering
 * which header supplied it. Surfacing the source alongside the value keeps
 * the transparency claim honest - we can show judges where the ID came
 * from instead of asking them to trust an opaque string.
 */
function extractRequestId(rawResponse, completionBody) {
  if (rawResponse?.headers) {
    for (const headerName of REQUEST_ID_HEADER_CANDIDATES) {
      const headerValue = rawResponse.headers.get(headerName);
      if (headerValue) {
        return { requestId: headerValue, requestIdSource: headerName };
      }
    }
  }

  // No routing header present, so fall back to the completion id from the
  // response body - still a genuine server-issued identifier for this
  // inference, just scoped to the completion rather than the route.
  if (completionBody?.id) {
    return { requestId: completionBody.id, requestIdSource: 'response.id' };
  }

  return { requestId: null, requestIdSource: 'unavailable' };
}

/**
 * Run one prompt against one model and return the text plus its proof of
 * origin. Errors keep their original `code` and `status` so the server can
 * still tell a rate limit apart from an outage further up the stack.
 */
async function callGonkaModel(client, model, prompt) {
  try {
    // .withResponse() gives us the parsed body AND the raw fetch Response,
    // which is the only way to read the routing headers we need.
    const { data, response } = await client.chat.completions
      .create({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })
      .withResponse();

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      const error = new Error(`Gonka model ${model} returned an empty completion`);
      error.code = 'GONKA_EMPTY';
      throw error;
    }

    const { requestId, requestIdSource } = extractRequestId(response, data);

    return {
      model,
      text,
      requestId,
      requestIdSource,
      finishReason: data?.choices?.[0]?.finish_reason ?? null,
    };
  } catch (error) {
    // Preserve the diagnosis while adding which model failed. Re-throwing a
    // bare `new Error(...)` here would erase status/code and make every
    // failure look identical to the route handler.
    if (!error.code && error.status === 429) error.code = 'RATE_LIMITED';
    if (!error.code && error.status === 401) error.code = 'GONKA_AUTH';
    error.gonkaModel = model;
    error.message = `Gonka ${model}: ${error.message}`;
    throw error;
  }
}

/**
 * Run an async worker over a list with a hard ceiling on how many run at
 * once. A plain Promise.all over every breach would open two sockets per
 * breach simultaneously; this keeps the fan-out bounded without giving up
 * parallelism entirely.
 */
async function mapWithConcurrencyLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNextItem() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNextItem));
  return results;
}

/**
 * Ask the router which models this key can actually reach. Used by
 * `npm run verify-gonka` so a wrong model ID is caught before the demo
 * rather than during it.
 */
async function listAvailableModels(client) {
  const models = await client.models.list();
  return (models?.data ?? []).map((model) => model.id).sort();
}

export {
  createGonkaClient,
  callGonkaModel,
  mapWithConcurrencyLimit,
  listAvailableModels,
  extractRequestId,
};
