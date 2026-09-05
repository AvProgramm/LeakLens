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

`npm run dev` restarts on save. `npm test` runs the suite (41 tests, no
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

Two independent models each judge the whole breach profile and return their
own Truth Score. IDs are **case-sensitive** and configurable:

```
GONKA_MODEL_PRIMARY=MiniMaxAI/MiniMax-M2.7
GONKA_MODEL_SECONDARY=deepseek-ai/DeepSeek-V4-Flash-0731
```

If either 404s, run `npm run verify-gonka` — it prints the exact catalogue
your key can reach, then paste the correct IDs into `.env`.

### The pipeline

```
email  ->  breach profile  ->  N models on Gonka
       ->  each model returns its OWN Truth Score (0-100)
       ->  cross-verification of those scores
```

The headline number is a **model's judgment**, not our arithmetic. Each model
receives the whole breach profile in one call and returns a single Truth
Score for that person's exposure, with the evidence and reasoning behind it.
We then compare the two models against each other.

An earlier version scored each breach separately and averaged the results
into a number no model had ever produced. That inverted the brief: the score
has to come from the network, and the models have to be comparable to each
other at the top level for cross-verification to mean anything.

Asking each model once rather than once per breach is also what keeps the
demo fast: **two inference calls total, whatever the breach count.**

### Reconciling the two scores

> **Router caveat, verified live.** `moonshotai/Kimi-K2.6` is listed in the
> catalogue but requests for it are answered by MiniMax, and DeepSeek is
> occasionally misrouted the same way. Every response is checked against the
> model that actually answered (`actualModel`); a misroute is retried once,
> and if both scores still come from one model the result is reported as
> `unverified` rather than being passed off as cross-verified.

| Condition | `consensusStatus` | `overallRiskScore` |
|---|---|---|
| scores within 25 points | `agreement` | mean of the two |
| scores more than 25 apart | `divergence` | **the higher score** |
| only one model answered | `single-model` | that model's score |
| the router served one model twice | `unverified` | higher score, clearly labelled |
| neither answered | `unavailable` | `null` — never invented |

On a genuine divergence we take the *higher* score on purpose: under-warning
someone about a real exposure is the more harmful of the two mistakes. The
disagreement is always surfaced in the UI rather than averaged away.

### Reasoning models

Both routed models emit a long `<think>…</think>` block before answering, and
that block quotes our own prompt back — including the example JSON in it. The
parser strips reasoning blocks and, when it must scan, takes the **last**
balanced object carrying a score, so a draft from inside the model's scratch
work can never be mistaken for its final answer. `GONKA_MAX_TOKENS` (default
4000) has to cover the reasoning *and* the answer; below that the models were
being cut off mid-thought and never reached their JSON.

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
  "riskScore": 100,
  "riskLabel": "Critical",
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
- `riskScore`/`riskLabel` come straight from XON's own `BreachMetrics.risk[0]`
  and are **0-100** (`risk_label` is XON's wording: Low/Medium/High/Critical).
  The breach-count heuristic remains only as a fallback if XON omits the field.
  This is a fast, non-AI number; the AI layer's `overallRiskScore` is the
  Truth Score the product leads with.

### `/api/analyze-breach` — the Truth Score report

```json
{
  "email": "user@example.com",
  "totalBreaches": 214,
  "analyzedBreaches": 3,
  "truncated": true,
  "overallRiskScore": 81,
  "riskTier": "High",
  "consensusStatus": "agreement",
  "scoreDifference": 18,
  "consensusNote": null,
  "models": ["MiniMaxAI/MiniMax-M2.7", "deepseek-ai/DeepSeek-V4-Flash-0731"],
  "truthScores": [
    {
      "ok": true,
      "model": "MiniMaxAI/MiniMax-M2.7",
      "actualModel": "MiniMaxAI/MiniMax-M2.7",
      "misrouted": false,
      "truthScore": 90,
      "evidence": "Plaintext passwords exposed in Collection-1 and ExploitIN...",
      "reasoning": "The individual's email appears in three large breaches...",
      "recommendedAction": "Change any reused password and enable 2FA.",
      "topRisks": ["Collection-1", "ExploitIN"],
      "requestId": "req-1788609085967652852-1148162",
      "requestIdSource": "x-request-id"
    },
    { "...": "one entry per model, same shape" }
  ],
  "breaches": [
    {
      "name": "Collection-1",
      "year": "2019",
      "industry": "Information Technology",
      "recordsExposed": 790803860,
      "passwordRisk": "plaintext",
      "dataExposed": ["Email addresses", "Passwords"],
      "flaggedByModel": true
    }
  ]
}
```

- `truthScores[]` is the heart of it: **one entry per model**, each carrying
  that model's own score and its Gonka Request ID. A failed model appears as
  `{ ok: false, model, error }` rather than being dropped, so the dashboard
  can show that only one model answered.
- `overallRiskScore` is reconciled from those scores per the table above, and
  is `null` if no model answered — never a fabricated `0`.
- `consensusNote` is set only when the router served the same model twice.
- `flaggedByModel` marks breaches the models themselves named as top risks.
- Only the largest `MAX_BREACHES_ANALYZED` breaches go into the profile
  (default 3, tuned for demo speed); `truncated` says so plainly so the
  headline is never quietly based on less data than the breach list shows.

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

1. **XON's real response differs from their published docs.** Confirmed
   against a live request: `risk`, `passwords_strength` and `yearwise_details`
   are each a **1-element array wrapping one flat object**, not the
   `[label, count]` pairs the docs imply. Parsing them as pairs returns all
   zeros *without erroring*, so change these only with a real response in
   hand — `DEBUG_XON=1 npm start` prints the raw `BreachMetrics`.
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
