# data-layer

Breach lookup (XposedOrNot) **and** the Gonka Router multi-model consensus
layer for LeakLens.

## Quick start

```bash
cd data-layer
npm install
cp .env.example .env      # then paste your Gonka key into .env
npm run verify-gonka      # confirms the key + model IDs work
npm start                 # http://localhost:4000
```

`npm run dev` restarts on save. `npm test` runs the suite (34 tests, no
network or API key required).

The server runs **without** a Gonka key: breach lookup works fully and the
dashboard shows the AI panel as unavailable rather than breaking.

---

## Gonka Router integration

This is the part the hackathon grades, so it is documented in full.

### The protocol

The Gonka Router is an **OpenAI-compatible** inference gateway. It is *not*
Anthropic-compatible — that distinction matters, and getting it wrong is a
silent failure where every request returns an empty completion.

| | Value |
|---|---|
| Base URL | `https://api.gonkarouter.io/v1` (keep the `/v1`) |
| Endpoint | `POST /v1/chat/completions` |
| Auth | `Authorization: Bearer <GONKA_API_KEY>` |
| SDK | the official `openai` npm package, pointed at the base URL |
| Response | `{ id, choices: [{ message: { content } }] }` |

Because it speaks the OpenAI protocol, we use the official OpenAI SDK rather
than a hand-rolled HTTP client:

```js
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.GONKA_API_KEY,
  baseURL: 'https://api.gonkarouter.io/v1',
});

const { data, response } = await client.chat.completions
  .create({ model, messages, temperature: 0 })
  .withResponse();
```

`.withResponse()` is used deliberately: it returns the raw HTTP response
alongside the parsed body, which is the only way to read the **Gonka Request
ID** out of the response headers.

### Request IDs (on-chain proof)

The brief requires showing a Gonka Request ID for every inference step, to
prove the verdict came from the decentralized network and not from our own
server. `src/gonkaClient.js` looks for the routing identifier across the
header names a gateway might use, in order:

```
x-gonka-request-id → gonka-request-id → x-inference-id
→ x-gonka-id → x-request-id → request-id
```

and falls back to the completion `id` from the response body. Every verdict
carries both the ID and a `requestIdSource` saying which header supplied it,
so the transparency claim stays honest instead of showing an opaque string.

### Models

Two independent models cross-verify every breach. IDs are **case-sensitive**
and configurable:

```
GONKA_MODEL_PRIMARY=MiniMaxAI/MiniMax-M2.7
GONKA_MODEL_SECONDARY=deepseek-ai/DeepSeek-V4-Flash-0731
```

If either 404s, run `npm run verify-gonka` — it prints the exact catalogue
your key can reach, then paste the correct IDs into `.env`.

### Consensus logic

> **Router caveat, verified live.** `moonshotai/Kimi-K2.6` is listed in the
> catalogue but requests for it are answered by MiniMax, and DeepSeek is
> occasionally misrouted the same way. Every response is checked against the
> model that actually answered (`actualModel`); a misroute is retried once,
> and if both verdicts still come from one model the breach is reported as
> `unverified` rather than being passed off as cross-verified.

| Condition | `status` | `finalScore` |
|---|---|---|
| scores within 25 points | `consensus` | mean of the two |
| scores more than 25 apart | `disputed` | **the higher score** |
| only one model answered | `single-model` | that model's score |
| the router served one model twice | `unverified` | the higher score, clearly labelled |
| neither answered | `unavailable` | `null` — never invented |

On a genuine dispute we take the *higher* score on purpose: under-warning
someone about a real exposure is the more harmful of the two mistakes. The
disagreement is always surfaced in the UI rather than averaged away.

The headline `overallRiskScore` is **not** an average. Averaging would mean
one critical breach plus nine trivial ones scores lower than the critical
breach alone — telling someone they are safer the more exposed they get.
Instead the worst breach sets the floor and breadth adds a bounded
escalation, capped at 100.

---

## Endpoints

```
GET /health
GET /api/check-email?email=user@example.com
GET /api/analyze-breach?email=user@example.com
```

`/health` reports whether Gonka is configured, so the dashboard can explain
the AI panel's state before a scan rather than after one fails.

Both data endpoints share one cached upstream lookup, so a full scan costs
**one** XposedOrNot request, not three.

### `/api/check-email` — the shared contract

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

- `exposed: false` with empty arrays/zeros for a clean email — never `null`.
  Downstream code never has to null-check this contract; `tests/contract.test.js`
  enforces it.
- `riskScore`/`riskLabel` are a placeholder breach-count heuristic (0-10).
  The real severity number is `overallRiskScore` (0-100) from the AI layer.

### `/api/analyze-breach` — the consensus report

```json
{
  "email": "user@example.com",
  "totalBreaches": 214,
  "analyzedBreaches": 8,
  "truncated": true,
  "overallRiskScore": 92,
  "consensusStatus": "divergence",
  "disputedCount": 3,
  "models": ["moonshotai/Kimi-K2.6", "MiniMaxAI/MiniMax-M2.7"],
  "breaches": [
    {
      "name": "Collection-1",
      "status": "disputed",
      "finalScore": 92,
      "scoreDifference": 41,
      "modelA": {
        "ok": true,
        "model": "moonshotai/Kimi-K2.6",
        "severityScore": 92,
        "evidence": "Passwords stored in plain text",
        "reasoning": "...",
        "recommendedAction": "...",
        "requestId": "gonka-...",
        "requestIdSource": "x-gonka-request-id"
      },
      "modelB": { "...": "same shape" }
    }
  ]
}
```

Only the largest `MAX_BREACHES_ANALYZED` breaches are analysed (default 8);
`truncated` says so plainly so the headline number is never quietly based on
less data than the breach list shows.

### Errors

`400` bad/missing email · `429` rate limited · `502` upstream unreachable ·
`503` Gonka not configured or key rejected. All return `{ "error": "..." }`.

---

## Privacy

- The submitted address is **never written to disk** and never logged.
- The cache keys on a **SHA-256 hash** of the email, not the address itself,
  and is swept on a timer so entries leave memory on schedule.
- Only breach *metadata* is sent to the models — never the email address.
  `tests/privacy.test.js` asserts each of these.

## Rate limiting

Per IP, per 15-minute window: 60 requests overall, 20 analyses. This protects
the shared XposedOrNot quota (25/hour for the whole server IP) and the Gonka
token credits from being drained by a stranger who finds the deployed URL.

## Known limits

1. **XON's `BreachMetrics` risk-score key isn't confirmed.** `getRiskScore()`
   checks the plausible keys and falls back to a breach-count heuristic. This
   only affects the placeholder 0-10 score, not the AI score.
2. **XposedOrNot allows 2 req/sec, 25/hour, 100/day per IP.** The 15-minute
   cache is what keeps a repeated demo alive; it resets on restart and is not
   shared between machines.
3. `MAX_BREACHES_ANALYZED` trades completeness for demo speed. Raise it if
   you have time budget to spare.

## Files

- `src/config.js` — every env-dependent value, read once
- `src/gonkaClient.js` — Gonka Router client, Request ID capture, concurrency
- `src/analyzeBreachSeverity.js` — prompts, consensus and scoring
- `src/xponClient.js` — raw fetch from XposedOrNot, no shaping
- `src/shapeBreachData.js` — raw XON → the contract above
- `src/cache.js` — hashed-key TTL cache
- `src/server.js` — routes, validation, rate limiting, error mapping
- `scripts/verifyGonka.js` — pre-demo key and model check
- `tests/` — contract, consensus, privacy and integration suites
