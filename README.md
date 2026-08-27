# Treasury Shield

Treasury Shield is a track 1 hackathon project for MUBA Hacks 2026.

It helps small web3 teams understand how a fall in the value of their crypto treasury could affect payroll and operating runway. The product uses live Thetanuts options market data to explain possible downside protection in plain language before a user commits funds.

## The Story

Alice runs a small web3 studio. Her team holds ETH for future contractor payments. Bob manages a DAO treasury with a similar problem: the treasury is held in volatile crypto assets, but grants and expenses are fixed in dollars.

They can see their wallet balance, but they cannot quickly answer:

> will our treasury still cover our next expenses if crypto falls, and what would protection cost?

Treasury Shield turns that question into a simple risk and protection workflow.

## Problem

Small web3 teams often have volatile crypto assets and fixed operating costs. Existing options tools are designed for experienced traders and expose users to complex terminology, strike tables, and payoff charts.

Treasury managers need a simpler way to:

- measure their treasury runway
- understand the effect of a price drop
- compare a protection cost with the risk it addresses
- see the result before making a trading decision

## Solution

Treasury Shield combines treasury assumptions, live Thetanuts orders, price-drop scenarios, and a simple hedge explanation in one frontend-first product.

The mvp journey is:

1. Enter the treasury asset and amount.
2. Enter upcoming expenses and the protection period.
3. View the current treasury value and runway gap.
4. Compare the result under 5%, 10%, and 20% price drops.
5. Review one Thetanuts-based protection recommendation.
6. Simulate the hedge using current market data.
7. Compare the protected and unprotected outcomes.

## Why Track 1

Treasury Shield is built for **Best Product Built on the Thetanuts SDK**.

Thetanuts is load-bearing in this product. Its live orders, strikes, expiries, premiums, and payout logic inform the protection recommendation. Replacing Thetanuts with static numbers would remove the core product capability.

This project is intentionally not Track 2. Track 2 requires an artificial intelligence agent to execute a real options trade on Base mainnet. Treasury Shield focuses on a complete, easy-to-use, simulation-first product without autonomous trading or real-money execution in the mvp.

## Four Judging Pillars

### Product

A focused treasury-risk product for a clear customer: small web3 teams protecting payroll and operating runway.

### User Experience

Plain-language inputs, one recommendation, visible scenarios, and a clear before-and-after result for users who are not professional traders.

### Real-World Problem

Crypto treasuries can lose spending power while payroll and operating costs remain fixed.

### Complete Implementation

The target mvp is an end-to-end deployed flow: setup, live Thetanuts data, calculations, recommendation, simulation, saved results, validation, error states, and responsive screens.

## Stack

- Next.js and TypeScript
- HeroUI and Tailwind CSS
- Thetanuts client SDK
- ethers or viem for Base blockchain reads
- Recharts for scenario visuals
- localStorage for saved simulations
- Vercel for deployment

The first version does not require a backend, database, user accounts, or environment files.

## Repository Structure

```text
app/
  (marketing)/       landing page and product explanation
  dashboard/         treasury overview and runway status
  scenarios/         price-drop scenario analysis
  recommendation/    hedge explanation and strategy choice
  simulation/        simulated trade and result
components/
  ui/                shared interface components
  treasury/          balance, runway, and expense components
  market/            live order and market-data components
  scenarios/         charts and risk comparison components
  simulation/        confirmation and result components
lib/
  thetanuts/         SDK client and protocol helpers
  treasury/          exposure and runway calculations
  market/            order filtering and ranking
  storage/           localStorage helpers
types/
  thetanuts/         order, market, and position types
  treasury/          wallet, expense, scenario, and recommendation types
docs/
  product/           problem and user journey
  sdk/               Thetanuts integration notes
  pitch/             demo script and submission checklist
tests/
  unit/              calculation tests
  integration/       market-data and user-flow tests
```

## Thetanuts Integration Shape

The planned integration reads live Thetanuts data in the browser, filters suitable orders, and ranks them against the user's treasury inputs.

```text
browser UI
  -> Thetanuts client SDK
  -> Base market data
  -> treasury calculations
  -> recommendation
  -> simulated hedge result
  -> localStorage
```

The current Thetanuts documentation and repository are the source of truth for exact methods, addresses, supported assets, and workflows.

## Security Boundaries

- no seed phrases or private keys
- no custodial wallet
- no autonomous trading
- no real-money execution in the mvp demo
- Base network validation
- verified token and protocol addresses
- explicit display of premium, expiry, maximum loss, and remaining risk
- input validation for amounts and protection periods
- clear separation between live market data and estimated simulation output
- visible not-financial-advice notice

## One-Week Sprint

| day | outcome |
| --- | --- |
| 1 | project shell, visual direction, landing page, and setup form |
| 2 | treasury value, expense coverage, runway gap, and scenario formulas |
| 3 | Thetanuts SDK connection, live order loading, and error states |
| 4 | recommendation card and before/after risk chart |
| 5 | simulation screen, localStorage, and responsive polish |
| 6 | testing, readme, demo script, and 3-5 minute video |
| 7 | deployment, pitch rehearsal, and submission verification |

## Five-Minute Demo

1. Introduce Alice and Bob's treasury problem.
2. Enter a 10 ETH treasury and fixed expenses.
3. Show the effect of a 5%, 10%, and 20% ETH drop.
4. Load a Thetanuts-based protection recommendation.
5. Run the simulated hedge.
6. Compare the protected and unprotected results.
7. Explain why Thetanuts options are essential to the product.

## Competition Checklist

- [ ] public repository with clean commit history
- [ ] complete deployed demo
- [ ] clear README and setup instructions
- [ ] live Thetanuts data in the product
- [ ] 3-5 minute demonstration video
- [ ] five-minute presentation and five-minute Q&A preparation
- [ ] AI tools declared in the submission if used
- [ ] team members listed in the final submission
- [ ] no private keys, secrets, or local project files committed

## Status

This repository currently contains the structure-only scaffold for the sprint. Application implementation will be added during the official hackathon period.

## Disclaimer

Treasury Shield is a hackathon prototype and not financial advice. Simulated outcomes are estimates and do not guarantee protection, profit, or future performance.
