# data-layer

XposedOrNot integration, email input, and the shared breach JSON contract for LeakLens.

## Run it

```bash
npm install
npm start          # http://localhost:4000
# or: npm run dev   # auto-restart on save
```

## Endpoint

```
GET /api/check-email?email=user@example.com
```

AI severity analysis is available at:

```
GET /api/analyze-breach?email=user@example.com
```

Set `GONKA_API_KEY` in a local `.env` file before using the analysis endpoint.
The endpoint calls both `moonshotai/Kimi-K2.6` and `MiniMaxAI/MiniMax-M2.7` through Gonka Router and returns the consensus/dispute report, including each Gonka response ID.

### Response — the contract

```json
{
  "email": "user@example.com",
  "checkedAt": "2026-08-31T10:00:00.000Z",
  "cached": false,
  "exposed": true,
  "breachCount": 1,
  "riskScore": 2,
  "riskLabel": "Low",
  "breaches": [
    {
      "name": "SweClockers",
      "domain": "sweclockers.com",
      "year": "2015",
      "industry": "Electronics",
      "recordsExposed": 254967,
      "passwordRisk": "hardtocrack",
      "dataExposed": ["Usernames", "Email addresses", "Passwords"],
      "description": "..."
    }
  ],
  "passwordStrength": { "strongHash": 1, "easyToCrack": 0, "plainText": 0, "unknown": 0 },
  "yearlyBreakdown": { "2015": 1 },
  "pastes": { "count": 0 }
}
```

- `exposed: false` and empty arrays/zeros for a clean email — never `null`. Downstream code should never have to null-check this contract.
- `riskScore`/`riskLabel` here are a **placeholder heuristic** (breach count-based), not the real severity score — that's the AI/Gonka layer's job. They exist so the field is never missing while that layer is being built.
- Errors: `400` bad/missing email, `429` upstream rate limit, `502` upstream unreachable — all return `{ "error": "..." }`.

## Known gaps / things to double check before demo

1. **XON's exact `BreachMetrics` risk-score key isn't confirmed** — their docs describe a risk score in prose but the field name isn't in their public SDK type defs. Run one real request against a known-breached email and `console.log(JSON.stringify(raw.BreachMetrics))` in `xponClient.js`, then simplify `getRiskScore()` in `shapeBreachData.js` once you see the real key.
2. **Rate limits**: XON allows 2 req/sec, 25/hour, 100/day per IP (no key). `cache.js` gives a 15-min in-memory cache per email so repeated demo checks don't burn the quota — this resets on server restart and isn't shared across multiple dev machines, so don't all hammer the same test email at once during testing.
3. No API key needed for `breach-analytics` — it's the free public endpoint.

## Files

- `src/xponClient.js` — raw fetch from XposedOrNot, no shaping
- `src/shapeBreachData.js` — turns raw XON response into the contract above
- `src/cache.js` — in-memory TTL cache (rate-limit protection)
- `src/server.js` — Express route, validation, error handling