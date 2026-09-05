/**
 * config.js
 * Every environment-dependent value in one place, read exactly once at
 * startup. Nothing else in the codebase touches process.env directly, so
 * there is a single answer to "where does this setting come from?" and a
 * single place to look when the demo machine behaves differently.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Resolve data-layer/.env relative to THIS FILE, not the working directory.
// `npm start` from the repo root launches the server with cwd set to the
// root, so the bare `dotenv/config` import silently found no .env and the
// server reported Gonka as unconfigured despite the key being present.
loadDotenv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

// The Gonka Router is OpenAI-compatible, so the base URL must keep the
// /v1 suffix - the OpenAI SDK appends only "/chat/completions" to it.
// Confirmed live: https://api.gonkarouter.io/v1 answers 401 without a key.
const GONKA_BASE_URL = process.env.GONKA_BASE_URL || 'https://api.gonkarouter.io/v1';

// Two independent models are what makes the cross-verification claim real.
// They are env-overridable because model IDs are case-sensitive and the
// router's catalogue can change between now and judging - `npm run
// verify-gonka` prints the live list if either of these ever 404s.
const GONKA_MODEL_PRIMARY = process.env.GONKA_MODEL_PRIMARY || 'MiniMaxAI/MiniMax-M2.7';
const GONKA_MODEL_SECONDARY = process.env.GONKA_MODEL_SECONDARY || 'deepseek-ai/DeepSeek-V4-Flash-0731';

// The API key is intentionally NOT defaulted. A missing key must surface as
// a clear 503 from the analysis endpoint, never as a confusing auth error
// from deep inside the SDK.
const GONKA_API_KEY = process.env.GONKA_API_KEY || '';

// Maximum MODEL CALLS in flight at once (not breaches - each breach makes
// two calls). The router returns 429 "too many concurrent requests for this
// account" above roughly this level, so keep it conservative.
const GONKA_MAX_CONCURRENCY = Number(process.env.GONKA_MAX_CONCURRENCY) || 6;

// A single model call that hangs must not hang the whole scan. The router
// is normally sub-ten-seconds; 45s is generous headroom before we give up.
const GONKA_TIMEOUT_MS = Number(process.env.GONKA_TIMEOUT_MS) || 120000;

// Both routed models are REASONING models: they emit a long <think> block
// before their answer. At 400 tokens they were being cut off mid-thought
// (finish_reason "length") and never reached the JSON at all. This budget
// has to cover the reasoning AND the answer, so it is deliberately large.
const GONKA_MAX_TOKENS = Number(process.env.GONKA_MAX_TOKENS) || 4000;

// Analysing every breach an email appears in is slow and rarely changes the
// verdict, so we assess the most severe-looking ones and report the rest as
// counted-but-unanalysed. Keeps a live demo inside a sensible time budget.
const MAX_BREACHES_ANALYZED = Number(process.env.MAX_BREACHES_ANALYZED) || 3;

// XposedOrNot allows only 25 requests/hour per IP with no key, so cached
// results are what keeps a repeated demo alive. 15 minutes comfortably
// covers a judging session without holding data any longer than needed.
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 15 * 60 * 1000;

// Our own public rate limit. This is the guardrail the project README
// promises ("add rate limiting before public deployment") and it is what
// stops a stranger draining the shared XON quota or the token credits.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 60;
const RATE_LIMIT_MAX_ANALYSES = Number(process.env.RATE_LIMIT_MAX_ANALYSES) || 20;

const PORT = Number(process.env.PORT) || 4000;

// An empty list means "allow any origin", which is what a hackathon demo
// needs while the dashboard is served from a file:// URL or a random
// static host. Set CORS_ORIGINS in production to lock it down.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Reported by /health so the dashboard can show the AI panel's true state
// instead of waiting for a request to fail before telling the user.
function isGonkaConfigured() {
  return Boolean(GONKA_API_KEY);
}

export {
  GONKA_BASE_URL,
  GONKA_MODEL_PRIMARY,
  GONKA_MODEL_SECONDARY,
  GONKA_API_KEY,
  GONKA_MAX_CONCURRENCY,
  GONKA_TIMEOUT_MS,
  GONKA_MAX_TOKENS,
  MAX_BREACHES_ANALYZED,
  CACHE_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_MAX_ANALYSES,
  PORT,
  CORS_ORIGINS,
  isGonkaConfigured,
};
