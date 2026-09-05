# dashboard

Frontend for LeakLens. Plain HTML/CSS/JS, no build step, no framework — fast to run and easy for everyone on the team to edit directly.

## Run it

The data-layer server needs to be running first. Easiest is `npm run dev:full` from the repo root, which starts the API and this dashboard together.

Then serve this folder with any static server, opening `index.html` directly via `file://` can hit CORS issues in some browsers:

```bash
cd dashboard
npx serve .
# or: python3 -m http.server 5173
```

## What this hits

- `GET /api/check-email` — breach lookup (XposedOrNot), powers the breach list.
- `GET /api/analyze-breach` — Gonka Router multi-model Truth Scores, powers the Leak Score panel and the per-model verdict cards.

Both are real now. If Gonka isn't configured on the server (no key set), the panel shows an explicit "Unavailable" state rather than breaking, the breach report above it still renders regardless.

## What the AI panel shows

- Overall Leak Score (0–100) and a Low/Medium/High tier.
- Consensus status (agreement, divergence, or not cross-verified) with how far apart the models were, plus a note if only the largest N breaches were judged.
- One card per model: that model's own Truth Score, evidence, reasoning, and recommended action side by side with the other model's, plus its Gonka Request ID, so any verdict here can be checked against the network afterward.
- A chip on the breaches the models themselves named as the top risks.

## Files

- `index.html` — page structure
- `style.css` — all styling, theme tokens at the top of the file
- `app.js` — breach lookup and Gonka Truth Score fetches, both real
