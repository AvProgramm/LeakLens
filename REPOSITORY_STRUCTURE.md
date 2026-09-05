# LeakLens Repository Structure

```text
data-layer/              Person 1: breach lookup and response contract
ai-orchestration/        Person 2: Gonka Router and consensus logic
frontend-dashboard/      Person 3: transparency dashboard and audit UI
privacy-deployment-pitch/ Person 4: privacy, deployment, docs, and pitch
shared/contracts/        agreed JSON shapes between team areas
docs/product/            problem, user journey, and MVP decisions
docs/gonka/              router integration notes and Request ID behavior
docs/pitch/               demo script and submission checklist
tests/contract/          shared data contract checks
tests/consensus/         model disagreement and scoring checks
tests/privacy/           retention and input-safety checks
tests/flow/              end-to-end user journey checks
```

The data-layer now carries the working implementation (breach lookup, Gonka
Router consensus) and its own test suite in `data-layer/tests/`. The
top-level `tests/` directories remain for team-level checks across areas.

No private keys, environment files, breach dumps, or personal data belongs in
this repository. Secrets live only in `data-layer/.env`, which is git-ignored;
`data-layer/.env.example` is the tracked template.
