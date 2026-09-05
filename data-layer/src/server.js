/**
 * server.js
 * The LeakLens API. Two endpoints the dashboard depends on, plus a health
 * check the dashboard uses to know whether the AI layer is live before it
 * asks for an analysis.
 *
 * Response shapes are documented in README.md - do not change field names
 * without telling the team, three other areas code against this contract.
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fetchBreachAnalytics } from './xponClient.js';
import { shapeBreachData } from './shapeBreachData.js';
import { analyzeBreachSeverity } from './analyzeBreachSeverity.js';
import * as cache from './cache.js';
import {
  PORT,
  CORS_ORIGINS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_MAX_ANALYSES,
  GONKA_MODEL_PRIMARY,
  GONKA_MODEL_SECONDARY,
  isGonkaConfigured,
} from './config.js';

const app = express();

// Behind a hosting proxy (Render, Railway, Fly) the client IP arrives in
// X-Forwarded-For. Trusting one hop lets the rate limiter see real client
// IPs instead of counting every visitor as the same proxy address.
app.set('trust proxy', 1);

app.use(cors(CORS_ORIGINS.length > 0 ? { origin: CORS_ORIGINS } : {}));
app.use(express.json({ limit: '16kb' }));

/**
 * Rate limiting. The project README lists this as a hard requirement before
 * public deployment, and it protects two shared resources: the XposedOrNot
 * quota (25/hour for our whole server IP) and the Gonka token credits.
 * Analysis is capped harder than lookup because each call costs real
 * inference on the network.
 */
const generalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});

const analysisRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_ANALYSES,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please wait a moment and try again.' },
});

app.use('/api/', generalRateLimiter);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pull a validated email out of the query string, or null if it is missing
 * or malformed. Lowercased so "A@x.com" and "a@x.com" share a cache entry.
 */
function readEmailParam(req) {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/**
 * Fetch-and-shape with caching, shared by both endpoints. This is the only
 * place that touches XposedOrNot, so a scan costs exactly one upstream
 * request no matter how many of our endpoints the dashboard calls.
 */
async function getShapedBreachData(email) {
  const cachedResult = cache.get(email);
  if (cachedResult) return { data: cachedResult, cached: true };

  const rawBreachData = await fetchBreachAnalytics(email);
  const shaped = shapeBreachData(email, rawBreachData);
  cache.set(email, shaped);
  return { data: shaped, cached: false };
}

/**
 * Turn an upstream failure into the documented status code. Centralised so
 * both endpoints answer identically and the dashboard only has one set of
 * cases to handle.
 */
function sendUpstreamError(res, err, context) {
  if (err.code === 'RATE_LIMITED') {
    return res.status(429).json({ error: 'Upstream rate limit hit, try again shortly.' });
  }
  if (err.code === 'GONKA_CONFIG') {
    return res.status(503).json({
      error: 'AI severity analysis is not configured on the server.',
    });
  }
  if (err.code === 'GONKA_AUTH') {
    return res.status(503).json({
      error: 'The Gonka API key was rejected. Check GONKA_API_KEY.',
    });
  }

  console.error(`[${context}] failed:`, err.message);
  return res.status(502).json({ error: 'Could not reach the breach data provider.' });
}

/**
 * Health and capability probe. The dashboard calls this on load so it can
 * disable or explain the AI panel up front rather than after a failed scan.
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    gonkaConfigured: isGonkaConfigured(),
    models: [GONKA_MODEL_PRIMARY, GONKA_MODEL_SECONDARY],
    cachedEntries: cache.size(),
  });
});

/**
 * GET /api/check-email?email=user@example.com
 * The breach lookup every other area builds on.
 */
app.get('/api/check-email', async (req, res) => {
  const email = readEmailParam(req);
  if (!email) {
    return res.status(400).json({ error: 'A valid email query param is required.' });
  }

  try {
    const { data, cached } = await getShapedBreachData(email);
    return res.json({ ...data, cached });
  } catch (err) {
    return sendUpstreamError(res, err, 'check-email');
  }
});

/**
 * GET /api/analyze-breach?email=user@example.com
 * Multi-model Gonka consensus over the same breach data. Reuses the cached
 * lookup, so calling this after /api/check-email costs no extra XON quota.
 */
app.get('/api/analyze-breach', analysisRateLimiter, async (req, res) => {
  const email = readEmailParam(req);
  if (!email) {
    return res.status(400).json({ error: 'A valid email query param is required.' });
  }

  try {
    const { data } = await getShapedBreachData(email);
    return res.json(await analyzeBreachSeverity(data));
  } catch (err) {
    return sendUpstreamError(res, err, 'analyze-breach');
  }
});

const server = app.listen(PORT, () => {
  console.log(`LeakLens data-layer listening on http://localhost:${PORT}`);
  console.log(
    isGonkaConfigured()
      ? `Gonka configured - models: ${GONKA_MODEL_PRIMARY}, ${GONKA_MODEL_SECONDARY}`
      : 'Gonka NOT configured - set GONKA_API_KEY in data-layer/.env to enable AI analysis',
  );
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Set a different PORT in your .env file, or stop the process using it.`,
    );
    process.exit(1);
  }

  // Any other listen error is fatal too, and exiting with a logged reason
  // beats throwing inside an event handler where the stack is unhelpful.
  console.error('Server failed to start:', err.message);
  process.exit(1);
});

export { app };
