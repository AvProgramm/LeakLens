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

## Confirmed against a live request (2026-09-05)

`riskScore`/`riskLabel` now come directly from XON's real `BreachMetrics.risk[0]` — no longer a placeholder heuristic (that only kicks in as a fallback if XON ever omits the field). `passwordStrength` and `yearlyBreakdown` are also fixed to match the real response shape, which turned out to differ from XON's own docs:
- `passwords_strength` and `yearwise_details` are each a **1-element array containing one flat object**, not arrays of `[label, count]` pairs as the docs implied
- `risk` is `[{ risk_label, risk_score }]`, score is **0-100** (not 0-10)

## Known gaps

1. **Rate limits**: XON allows 2 req/sec, 25/hour, 100/day per IP (no key). `cache.js` gives a 15-min in-memory cache per email so repeated demo checks don't burn the quota — this resets on server restart and isn't shared across multiple dev machines, so don't all hammer the same test email at once during testing.
2. No API key needed for `breach-analytics` — it's the free public endpoint.
3. `riskScore` is now XON's own score, not an AI-derived one — confirm with the AI-orchestration owner whether they want this field kept as a fast non-AI fallback, or dropped once their scoring lands.

## Files

- `src/xponClient.js` — raw fetch from XposedOrNot, no shaping
- `src/shapeBreachData.js` — turns raw XON response into the contract above
- `src/cache.js` — in-memory TTL cache (rate-limit protection)
- `src/server.js` — Express route, validation, error handling