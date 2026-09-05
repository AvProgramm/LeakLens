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
- **Real:** the "Leak Score" panel calls `/api/analyze-breach`, showing the aggregate score, both model verdicts, consensus status, reasoning, recommended action, and Gonka request IDs.

## AI layer

`app.js` calls the data-layer `/api/analyze-breach` endpoint after breach data is loaded. The data layer requires `GONKA_API_KEY` in its local `.env` file.

## Files

- `index.html` — page structure
- `style.css` — all styling, theme tokens at the top of the file
- `app.js` — data-layer and live AI analysis fetches
