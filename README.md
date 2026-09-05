<div align="center">

# LeakLens

**Know what's exposed. Know what to do.**

Privacy-first breach intelligence, verified by multiple independent AI models
on the [Gonka Network](https://gonka.ai).

Built for the Gonka Network **AI for Society** hackathon.

</div>

---

## What it does

Most people can find out *that* their email was leaked. Almost nobody can find
out *what to do about it first*. The raw breach data is public but unreadable,
and the tools that surface it stop at a list of names.

LeakLens closes that gap:

1. **Checks** an email against known public data leaks (XposedOrNot).
2. **Asks two independent models** through the official Gonka Router how severe
   each breach actually is for that person.
3. **Shows disagreement** between the models instead of hiding it behind a
   single confident number.
4. **Explains** what was exposed and what to secure first.
5. **Proves it** — every inference step carries its Gonka Request ID.

The multi-model step is the point. A single model asserting "this is critical"
is exactly the centralized opinion a decentralized inference network exists to
replace. When our two models disagree by more than 25 points, we say so on the
screen and take the more cautious score.

---

## How it meets the challenge

| Requirement | Where it lives |
| --- | --- |
| All AI inference via `gonkarouter.io` | [`data-layer/src/gonkaClient.js`](data-layer/src/gonkaClient.js) |
| Multi-model cross-verification | Two models per breach, [`analyzeBreachSeverity.js`](data-layer/src/analyzeBreachSeverity.js) |
| Consensus logic for conflict | `reconcileModelVerdicts()` — agree / dispute / single-model / unavailable |
| Score 0–100 + reasoning trace | `overallRiskScore` plus per-model reasoning and cited evidence |
| Request ID per inference step | Displayed on every verdict row in the dashboard |
| Neutrality prompt | `buildSeverityPrompt()` — facts only, cite evidence, no speculation |

Full integration notes are in **[`data-layer/README.md`](data-layer/README.md)**.

---

## Prerequisites

You need **one** thing installed:

| | Version | Check with |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 18 or newer (20+ recommended) | `node --version` |

npm ships with Node, so there is nothing else to install.

> ### Why there is no `requirements.txt` or virtual environment
>
> **LeakLens is a Node.js project — there is no Python in it.** `requirements.txt`,
> `pip` and `venv` are Python tools and do not apply here.
>
> Node already gives you the same three guarantees, without any activate step:
>
> | Python | Node equivalent | Where |
> | --- | --- | --- |
> | `requirements.txt` | `package.json` (`dependencies`) | [`data-layer/package.json`](data-layer/package.json) |
> | pinned versions / lockfile | `package-lock.json` | `data-layer/package-lock.json` |
> | `venv/` isolation | `node_modules/` — already per-project | created by `npm run setup` |
>
> `node_modules/` **is** the isolated environment. It lives inside the project,
> is never shared with other projects on your laptop, and is git-ignored — so
> there is nothing to activate and nothing to deactivate. Running
> `npm run setup` is the direct equivalent of
> `python -m venv venv && pip install -r requirements.txt`.

---

## Quick start

```bash
git clone <your-repo-url>
cd LeakLens
npm run setup
npm start
```

Then open **http://localhost:5173**.

That is the whole thing. `npm start` runs the API and the dashboard together in
one terminal, and one `Ctrl+C` stops both.

The app **works immediately without an API key** — breach lookup is fully
functional and the AI panel reports itself as unconfigured rather than
breaking. Add your Gonka key when you want the severity analysis.

---

## Adding your Gonka API key

```bash
cd data-layer
cp .env.example .env
```

Open `data-layer/.env` and paste your key:

```ini
GONKA_API_KEY=sk-your-real-key-here
```

Then confirm it works **before** you rely on it:

```bash
npm run verify-gonka
```

This checks four things and prints a clear pass/fail for each:

1. Is a key loaded?
2. Does the router accept it?
3. Do the two configured model IDs actually exist on your key?
4. Does a live inference return a usable Request ID?

It masks the key in its output, so it is safe to run while screen-sharing.

> **Security.** `data-layer/.env` is git-ignored and must never be committed.
> `data-layer/.env.example` is the tracked template — copy it, never edit it
> with real values. If a key is ever pushed, revoke and reissue it immediately.

### If a model ID is rejected

Model IDs are **case-sensitive** and the catalogue can change.
`npm run verify-gonka` prints the exact list your key can reach; paste the
correct IDs into `.env`:

```ini
GONKA_MODEL_PRIMARY=moonshotai/Kimi-K2.6
GONKA_MODEL_SECONDARY=MiniMaxAI/MiniMax-M2.7
```

---

## Running it

### One command (recommended)

```bash
npm start
```

```
  LeakLens is running
    Dashboard : http://localhost:5173
    API       : http://localhost:4000
```

### Two terminals (if you want separate logs)

```bash
# terminal 1 — API
cd data-layer
npm start

# terminal 2 — dashboard
cd frontend-dashboard
npx serve .
```

If you run the dashboard yourself, make sure `DATA_LAYER_BASE` at the top of
`frontend-dashboard/app.js` matches the API's port.

### All commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Installs dependencies (run once, or after `git pull`) |
| `npm start` | Runs API + dashboard together |
| `npm test` | Runs the full test suite |
| `npm run verify-gonka` | Checks your API key and model IDs |
| `npm run backend` | Runs only the API |

---

## Testing

```bash
npm test
```

**34 tests. No API key and no network required** — the Gonka integration is
tested against a local stub that speaks the same OpenAI-compatible protocol.

| Suite | Covers |
| --- | --- |
| `contract.test.js` | The shared JSON contract stays complete and null-free |
| `consensus.test.js` | Agreement, dispute, partial failure, and scoring rules |
| `privacy.test.js` | Email never stored in plaintext, never sent to models |
| `integration.test.js` | Full run against an OpenAI-compatible router stub |

---

## Architecture

```
 Browser
    │  email address
    ▼
 frontend-dashboard/          static HTML/CSS/JS, no build step
    │  GET /api/check-email
    │  GET /api/analyze-breach
    ▼
 data-layer/  (Express API, port 4000)
    ├── xponClient.js ─────────▶ XposedOrNot        breach lookup
    ├── shapeBreachData.js                          → the shared contract
    ├── cache.js                                    hashed-key TTL cache
    └── gonkaClient.js ────────▶ Gonka Router       2 models, in parallel
                                 (OpenAI-compatible)
```

**One upstream lookup per scan.** Both endpoints share a cached, shaped result,
so a full scan costs a single XposedOrNot request — which matters, because the
free tier allows only 25 per hour per IP.

**The two page loads are independent.** The breach report renders the moment it
arrives; the slower AI analysis fills in afterwards. If Gonka is unreachable,
unconfigured, or rate-limited, you still keep your full breach report.

### API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness, and whether Gonka is configured |
| `GET /api/check-email?email=…` | Breach lookup — the shared team contract |
| `GET /api/analyze-breach?email=…` | Multi-model Gonka consensus report |

Response shapes, error codes and the scoring rationale are documented in
**[`data-layer/README.md`](data-layer/README.md)**.

---

## Privacy

This is a tool people hand their email address to, so the guarantees are
enforced by tests, not intentions:

- The address is **never written to disk** and never logged.
- The cache keys on a **SHA-256 hash**, never the address itself, is bounded at
  500 entries, and sweeps expired entries on a timer.
- **Only breach metadata is sent to the models** — the email address never
  leaves our side of the network boundary.
- **Rate limited** to 60 requests and 20 analyses per IP per 15 minutes, so a
  stranger who finds the deployed URL cannot drain the shared quota or the
  token credits.
- Results are labelled as guidance, not a guarantee.

`data-layer/tests/privacy.test.js` asserts the first three.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Cannot reach the data-layer at http://localhost:4000` | The API isn't running. Use `npm start` from the project root. |
| `Port 4000 is already in use` | Something else holds the port. Stop it, or set `PORT=4001` in `data-layer/.env` **and** update `DATA_LAYER_BASE` in `app.js`. |
| `AI severity analysis is not configured` | No `GONKA_API_KEY`. See [Adding your Gonka API key](#adding-your-gonka-api-key). |
| `The Gonka API key was rejected` | Bad or expired key. Run `npm run verify-gonka`. |
| A model 404s | Wrong model ID. Run `npm run verify-gonka` for the real catalogue. |
| `Too many checks right now` | XposedOrNot's 25/hour IP limit. Wait, or reuse a cached email. |
| `npm run setup` fails | Check `node --version` is 18+. |

---

## Project structure

```
LeakLens/
├── data-layer/              Breach lookup + Gonka consensus (the backend)
│   ├── src/                 config, gonkaClient, analyze, shape, cache, server
│   ├── scripts/             verifyGonka.js — pre-demo key check
│   ├── tests/               34 tests
│   └── .env.example         Environment template — copy to .env
├── frontend-dashboard/      Dashboard (no build step)
├── scripts/dev.js           Runs both servers with one command
├── ai-orchestration/        Reserved for further prompt/consensus work
├── privacy-deployment-pitch/  Privacy guardrails, deployment, pitch
├── shared/contracts/        Agreed JSON shapes between team areas
├── docs/                    Product, Gonka integration, and pitch notes
└── tests/                   Team-level cross-area checks
```

## Team ownership

| Area | Owner focus |
| --- | --- |
| `data-layer/` | XposedOrNot integration, Gonka consensus, shared contract |
| `ai-orchestration/` | Prompt design and consensus refinement |
| `frontend-dashboard/` | Leak score, reasoning trace, Request ID display |
| `privacy-deployment-pitch/` | Privacy guardrails, deployment, pitch |

Work on feature branches (`feature/breach-lookup`, `feature/consensus-logic`,
`feature/dashboard-ui`). Agree the shared JSON contract before parallel work,
and merge small working slices into `main` early.

---

<div align="center">

**Verify the world on Gonka.**

</div>
