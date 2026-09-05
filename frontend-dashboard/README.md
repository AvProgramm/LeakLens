# dashboard

Frontend for LeakLens. Plain HTML/CSS/JS, no build step, no framework — fast to run and easy for everyone on the team to edit directly.

## Run it

The data-layer server needs to be running first (`npm start` inside `data-layer/`, serves `http://localhost:4000`).

Then serve this folder with any static server, opening `index.html` directly via `file://` can hit CORS issues in some browsers:

```bash
cd dashboard
npx serve .
# or: python3 -m http.server 5173
```

## What this hits

- `GET /api/check-email` — breach lookup (XposedOrNot), powers the breach list.
- `GET /api/analyze-breach` — Gonka Router multi-model consensus, powers the Leak Score panel and the per-breach AI verdict cards.

Both are real now. If Gonka isn't configured on the server (no key set), the panel shows an explicit "Unavailable" state rather than breaking, the breach report above it still renders regardless.

## What the AI panel shows

- Overall Leak Score (0–100) and a Low/Medium/High tier.
- Consensus status (agreement vs. disagreement) and, if the analysis only covered the largest N breaches, a note saying so.
- Per-breach verdict cards: both models' severity score, evidence, reasoning, and recommended action side by side, plus each model's Gonka Request ID, so any verdict here can be checked against the network afterward.
- A matching severity chip injected back onto each breach in the list above, so a leak's risk is visible in both places.

## Files

- `index.html` — page structure
- `style.css` — all styling, theme tokens at the top of the file
- `app.js` — data-layer fetch (real) + AI-layer mock (placeholder), see comments inside
