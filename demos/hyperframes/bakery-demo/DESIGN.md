# StockWise Bakery Demo Visual Identity

## Style Prompt

Create a premium, practical StockWise product demo for a Mozambican bakery owner. The composition is self-contained HyperFrames HTML, but it must visually follow the real StockWise app and landing page rather than inventing a separate SaaS style. Use the official StockWise logo asset, light-first operational surfaces, navy text, restrained blue/teal accents, semantic warning badges, measured shadows, and calm motion. All visible text must be Portuguese.

## Colors

- Canvas: app token `--background: 214 31% 97%`.
- Ink: app token `--foreground: 222 47% 11%`.
- Muted text: app token `--muted-foreground: 217 14% 42%`.
- StockWise blue: app token `--primary: 218 86% 45%`.
- Card/surface: app tokens `--card`, `--surface-elevated`, `--surface-muted`, `--card-border`.
- Success/stock: app token `--financial-positive: 158 64% 34%`.
- Warning: app token `--financial-warning: 38 92% 46%`.
- Dark panel: dashboard tokens `--premium-dashboard-panel`, `--premium-dashboard-panel-foreground`, `--premium-dashboard-panel-border`.

## Typography

- Primary: Inter, with local Noto Sans fallback from `assets/NotoSans-*.ttf`.
- Headline weight: 800-900, with modest negative tracking only.
- UI labels: 700-800 with compact uppercase spacing matching `.premium-label`.
- Numeric values: tabular figures where supported.

## Branding And UI Rules

- Use `assets/stockwise-logo.png`, copied from `public/brand/stockwise-logo.png`.
- Do not recreate or reinterpret the StockWise logo.
- Video-only panels should mirror the real premium primitives: `PremiumRegisterHeader`, `PremiumMetricCard`, `PremiumStatusBadge`, `PremiumTableToolbar`, dashboard cockpit panels, Items register cards, and Stock Levels risk badges.
- Use app-like card radii around 16-22px, thin card borders, and measured shadows.
- Dark panels are allowed only for dashboard/cockpit emphasis and must use the dashboard panel token family.

## Motion Rules

- Use subtle fades, short upward entrances, and light slide-ins.
- Animate from final CSS positions with `gsap.from()` and exit with `gsap.to()`.
- Keep scene motion business-like; avoid flashy zooms, heavy 3D, neon glows, or constant bouncing.

## What NOT To Do

- Do not use real customer data.
- Do not imply instant paid checkout.
- Do not show batch or expiry workflows in this demo.
- Do not use fake testimonials.
- Do not use generic neon startup styling.
- Do not introduce random blues, generic SaaS gradients, or non-StockWise logos.
