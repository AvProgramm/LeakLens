# LeakLens

LeakLens is a privacy-first breach intelligence tool for the Gonka Network public-good hackathon.

It checks an email against known leaks, uses multiple independent AI models through Gonka Router to explain severity, surfaces disagreement, and turns raw breach records into a prioritised security checklist.

## Team ownership

- `data-layer/` - XposedOrNot integration, email input, and shared breach JSON contract
- `ai-orchestration/` - Gonka Router calls, explainer prompt, model comparison, and consensus logic
- `frontend-dashboard/` - leak score, reasoning trace, and Gonka Request ID display
- `privacy-deployment-pitch/` - no-persistence guardrails, rate limiting, deployment, README, and pitch
- `shared/` - contracts and decisions shared across all owners
- `docs/` - product, integration, and pitch notes
- `tests/` - contract, consensus, privacy, and user-flow checks

## Collaboration rules

Each owner works on a feature branch, for example `feature/breach-lookup`, `feature/consensus-logic`, or `feature/dashboard-ui`. Agree on the shared JSON contract before parallel implementation, and merge small working slices into `main` early.

## Core product

1. Check an email against known data leaks.
2. Ask at least two independent models through the official Gonka Router.
3. Compare severity scores and show meaningful disagreement instead of hiding it.
4. Explain what was exposed and what to secure first.
5. Display Gonka Request IDs for every inference step.

## Privacy boundaries

- never persist submitted email addresses
- never store passwords, breach dumps, or private credentials
- keep Request IDs visible without exposing sensitive input
- add rate limiting before public deployment
- label results as guidance, not a guarantee

This repository is a structure-only scaffold. Application code, secrets, and user data do not belong here.


