import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fetchBreachAnalytics } from './xponClient.js';
import { shapeBreachData } from './shapeBreachData.js';
import { analyzeBreachSeverity } from './analyzeBreachSeverity.js';
import * as cache from './cache.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/check-email?email=user@example.com
 *
 * This is THE contract endpoint everyone else builds on.
 * Response shape is documented in README.md - do not change field
 * names without telling the team, they're coding against this.
 */
app.get('/api/check-email', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email query param is required.' });
  }

  const cached = cache.get(email);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const raw = await fetchBreachAnalytics(email);
    const shaped = shapeBreachData(email, raw);
    cache.set(email, shaped);
    return res.json({ ...shaped, cached: false });
  } catch (err) {
    if (err.code === 'RATE_LIMITED') {
      return res.status(429).json({ error: 'Upstream rate limit hit, try again shortly.' });
    }
    console.error('[check-email] failed:', err.message);
    return res.status(502).json({ error: 'Could not reach breach data provider.' });
  }
});

app.get('/api/analyze-breach', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email query param is required.' });
  }

  try {
    return res.json(await analyzeBreachSeverity(email));
  } catch (err) {
    if (err.code === 'RATE_LIMITED') {
      return res.status(429).json({ error: 'Upstream rate limit hit, try again shortly.' });
    }
    if (err.code === 'GONKA_CONFIG') {
      return res.status(503).json({ error: 'AI severity analysis is not configured.' });
    }
    console.error('[analyze-breach] failed:', err.message);
    return res.status(502).json({ error: 'Could not complete breach severity analysis.' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try setting a different PORT in your .env file, or stop the process currently using it.`);
    process.exit(1);
  }

  throw err;
});