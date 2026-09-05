# LeakLens

LeakLens is a privacy-first breach intelligence tool built for the Gonka
Network "AI for Society" hackathon.

It checks an email against known public data leaks, asks **two independent
models through the official Gonka Router** to judge how severe each breach
is, shows where those models disagree instead of hiding it, and turns raw
breach records into a prioritised action list — with a Gonka Request ID
attached to every inference step.

## Run it in two terminals

```bash
# terminal 1 - backend
cd data-layer
npm install
cp .env.example .env      # paste your Gonka key into .env
npm run verify-gonka      # confirms key + model IDs before you demo
npm start                 # http://localhost:4000

# terminal 2 - dashboard
cd frontend-dashboard
npx serve .               # then open the URL it prints
```

The backend runs without a Gonka key — breach lookup works fully and the AI
panel reports itself unavailable rather than breaking.

## How it maps to the challenge

| Requirement | Where it lives |
|---|---|
| All AI inference via `gonkarouter.io` | `data-layer/src/gonkaClient.js` |
| Multi-model cross-verification | two models per breach, `analyzeBreachSeverity.js` |
| Consensus logic for disagreement | `reconcileModelVerdicts()` — agree / dispute / single-model |
| Score 0-100 + reasoning trace | `overallRiskScore` + per-model reasoning and evidence |
| Request ID shown per inference | every verdict row in the dashboard |
| Neutrality prompt | `buildSeverityPrompt()` — facts only, cite evidence, no speculation |

Full integration notes, the response contract, and the scoring rationale are
in [`data-layer/README.md`](data-layer/README.md).

## Why breach data

The challenge is open-ended: "real-world applications of AI in the public
domain… genuine value for everyday users." Breach exposure is a problem
almost everyone has and almost nobody can act on — the raw data is public but
unreadable, and existing tools tell you *that* you were leaked without
telling you *what to do first*. Multi-model consensus matters here for the
same reason it matters for fact-checking: a single model asserting "this is
critical" is exactly the centralized opinion the network exists to replace.

## Team ownership

- `data-layer/` — XposedOrNot integration, Gonka Router consensus, shared contract
- `ai-orchestration/` — reserved for further prompt/consensus work
- `frontend-dashboard/` — leak score, reasoning trace, Request ID display
- `privacy-deployment-pitch/` — privacy guardrails, deployment, pitch
- `shared/` — contracts and decisions shared across all owners
- `docs/` — product, integration, and pitch notes
- `tests/` — team-level checks (the data-layer's own suite is in `data-layer/tests/`)

## Collaboration rules

Each owner works on a feature branch, for example `feature/breach-lookup`,
`feature/consensus-logic`, or `feature/dashboard-ui`. Agree on the shared
JSON contract before parallel implementation, and merge small working slices
into `main` early.

## Privacy boundaries

- never persist submitted email addresses — the cache keys on a SHA-256 hash,
  never the address, and sweeps entries on a timer
- never send the email address to the AI models — only breach metadata goes
  to Gonka
- never store passwords, breach dumps, or private credentials
- keep Request IDs visible without exposing sensitive input
- rate limiting is enforced in `data-layer/src/server.js` (60 requests and
  20 analyses per IP per 15 minutes)
- results are labelled as guidance, not a guarantee

`data-layer/tests/privacy.test.js` asserts the first three.

## Tests

```bash
cd data-layer && npm test
```

34 tests covering the shared contract, the consensus and scoring logic, the
privacy guarantees, and a full integration run against a local
OpenAI-compatible stub — no API key or network required.

## Secrets

Real keys live only in `data-layer/.env`, which is git-ignored.
`data-layer/.env.example` is the tracked template — copy it, never commit the
copy.
