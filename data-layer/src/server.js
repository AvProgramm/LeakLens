const express = require('express');
const cors = require('cors');
const { fetchBreachAnalytics } = require('./xponClient');
const { shapeBreachData } = require('./shapeBreachData');
const cache = require('./cache');

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
 * Response shape is documented in README.md — do not change field
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

app.listen(PORT, () => {
  console.log(`data-layer listening on http://localhost:${PORT}`);
});