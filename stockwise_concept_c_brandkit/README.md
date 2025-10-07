# StockWise — Concept C Brand Kit

This ZIP contains:
- **/svgs** — primary logo marks (Concept C), dark/light, plus horizontal/vertical lockups.
- **/web** — `manifest.json`, favicon/splash link snippets, and a browser **PNG generator** (`index.html`).
- **/email** — `signature.html` table-based email signature.
- **/react** — `SwHeader.tsx` + `tokens.css` ready to drop into your app.

## Quick start
1) Place `/svgs` in your design assets repo.
2) Open `/web/index.html` in a browser to export PNG icons (16–512). Copy `/web/manifest.json` to your public folder and include the head snippet from `/web/snippet_favicon_head.html`.
3) For iOS splash images, generate PNGs and include links from `/web/snippet_ios_splash.html`.
4) Use `/email/signature.html` inside your email client.
5) Import `react/SwHeader.tsx` and include `react/tokens.css` in your app shell.

Colors:
- Ink: `#0B1220`
- Blue: `#1565FF`
- Blue Accent (dark mode): `#4DA3FF`
