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

## What's real vs. mock right now

- **Real:** the email input, the fetch to `data-layer`'s `/api/check-email`, and every part of the breach list (name, year, industry, records exposed, data types, password risk). This is wired to the actual contract from PR #1.
- **Mock:** the entire "Leak Score" panel (score, consensus, model verdicts, reasoning trace). This is static placeholder data shaped like what the Gonka/AI layer will eventually return, clearly labelled "AI layer pending" in the UI itself so it's never mistaken for a real verdict during testing.

## Wiring in the real AI layer

Everything needed to swap the mock for the real thing lives in `app.js`. Look for `getAIVerdict()`, that's the one function to change. Its input (`breachData`, the exact object `fetchBreachData()` returns) and output shape (matching `MOCK_AI_VERDICT`) are already the agreed contract, so nothing else in the file should need to change.

## Files

- `index.html` — page structure
- `style.css` — all styling, theme tokens at the top of the file
- `app.js` — data-layer fetch (real) + AI-layer mock (placeholder), see comments inside
