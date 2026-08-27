# Treasury Shield Repository Structure

This repository is intentionally a structure-only scaffold for the first sprint.

## Directories

- `app/` - Next.js App Router pages and global styles
  - `(marketing)/` - landing page and product explanation
  - `dashboard/` - treasury overview and runway status
  - `scenarios/` - price-drop scenario analysis
  - `recommendation/` - hedge explanation and strategy choice
  - `simulation/` - simulated trade and before/after result
- `components/` - reusable HeroUI interface components
  - `ui/` - shared buttons, cards, inputs, alerts, and layout pieces
  - `treasury/` - balance, runway, and expense components
  - `market/` - live order and market-data components
  - `scenarios/` - charts and risk comparison components
  - `simulation/` - confirmation and result components
- `lib/` - application logic and integrations
  - `thetanuts/` - client setup, order loading, and protocol mapping
  - `treasury/` - exposure, runway, and price-drop calculations
  - `market/` - filtering and ranking available orders
  - `storage/` - localStorage helpers for saved simulations
- `types/` - shared data shapes
  - `thetanuts/` - order, market, and position types
  - `treasury/` - wallet, expense, scenario, and recommendation types
- `public/` - static assets and demo content
  - `assets/` - logos and illustrations
  - `icons/` - product icons
- `docs/` - project documentation
  - `product/` - problem, user journey, and mvp scope
  - `sdk/` - Thetanuts integration notes
  - `pitch/` - demo script, judging map, and submission checklist
- `tests/` - verification layers
  - `unit/` - treasury and scenario calculations
  - `integration/` - market-data and user-flow checks

## Planned stack

- Next.js and TypeScript
- HeroUI and Tailwind CSS
- Thetanuts client SDK
- ethers or viem for Base reads
- Recharts for scenario visuals
- localStorage for saved simulations
- Vercel for deployment

No application code, private keys, environment files, or user data belongs in this scaffold.
