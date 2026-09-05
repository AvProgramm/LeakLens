# dashboard

Frontend for LeakLens. Plain HTML/CSS/JS, no build step, no framework — fast
to run and easy for everyone on the team to edit directly.

## Run it

Start the data-layer first (`npm start` inside `data-layer/`, serves
`http://localhost:4000`), then serve this folder with any static server.
Opening `index.html` directly over `file://` can hit CORS issues in some
browsers.

```bash
cd frontend-dashboard
npx serve .
# or: python3 -m http.server 5173
```

If the dashboard cannot reach the backend it says so explicitly, naming the
URL it tried — the usual cause is the data-layer not running.

## Configuration

One value, at the top of `app.js`:

```js
const CONFIG = { DATA_LAYER_BASE: "http://localhost:4000" };
```

This **must match the data-layer's `PORT`** (default 4000). Point it at the
deployed data-layer URL on demo day.

## What it shows

- **Breach report** — count, total records, and a card per leak with year,
  industry, records exposed, data classes and password storage. Sorted
  largest-first; the first 20 render with a "show all" toggle.
- **Leak Score panel** — the 0-100 score from the Gonka multi-model
  consensus, whether the two models agreed, a per-model verdict row carrying
  its **Gonka Request ID**, and a reasoning trace showing *both* models'
  explanations and evidence.

Colour carries the consensus state: green where the models agree, amber
where they disagree. Disagreement is a headline feature of this product, not
an error, and is styled that way.

## Load order

The two fetches are deliberately independent. The breach report renders and
is revealed the moment it arrives; the slower AI call fills in afterwards.
If Gonka is unreachable, unconfigured, or rate-limited, the user still keeps
their full breach report and the AI panel explains why it is empty.

On page load the dashboard also calls `/health`, so it can say up front that
AI analysis is unconfigured rather than failing halfway through a scan.

## Files

- `index.html` — page structure
- `style.css` — all styling, theme tokens at the top of the file
- `app.js` — data-layer and Gonka analysis fetches, rendering
