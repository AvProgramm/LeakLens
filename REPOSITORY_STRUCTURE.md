# Treasury Shield Repository Structure

This repository is intentionally a structure-only scaffold for the first sprint.

## Directories

- `app/` - Next.js App Router pages and global styles
- `components/` - reusable HeroUI interface components
- `lib/` - Thetanuts SDK client, treasury calculations, and market-data helpers
- `types/` - shared TypeScript data shapes
- `public/` - static assets and demo content
- `docs/` - product notes, sdk references, and pitch material
- `tests/` - calculation and user-flow tests

## Planned stack

- Next.js and TypeScript
- HeroUI and Tailwind CSS
- Thetanuts client SDK
- ethers or viem for Base reads
- Recharts for scenario visuals
- localStorage for saved simulations
- Vercel for deployment

No application code, private keys, environment files, or user data belongs in this scaffold.
