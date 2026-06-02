# Bakery Demo Composition Spec

## Composition

- Name: `bakery-demo`
- Format: 16:9 horizontal first
- Canvas: 1920x1080
- Duration: 20 seconds
- Language: Portuguese
- Intended use: landing page, WhatsApp sharing, pitch/demo presentation, and social preview
- Visual system: self-contained HyperFrames composition aligned to the real StockWise app and landing design tokens.

## StockWise Alignment

- Official logo: `assets/stockwise-logo.png`, copied from `public/brand/stockwise-logo.png`.
- Visual tokens: app HSL tokens for background, foreground, card, border, primary, muted text, financial-positive, financial-warning, and dashboard premium panel colours.
- Typography: Inter stack with local Noto Sans fallback.
- UI references: premium page/register headers, metric cards, status badges, dashboard cockpit panels, Items register cards, Stock Levels low-stock treatment, and POS-style operational panels.
- Scope: the video recreates lightweight marketing-only UI panels and does not import or execute the React app.

## Fictional Company

Padaria Pão Dourado

All records and values are illustrative sample data for demonstration.

## Scene Timing

| Time | Caption | Visual |
| --- | --- | --- |
| 0-3s | O stock de uma padaria muda todos os dias. | Bakery item title card with ingredients and products. |
| 3-7s | Com o StockWise, ingredientes, produtos e vendas ficam no mesmo sistema. | StockWise-style item register with bakery items and status badges. |
| 7-12s | Registe vendas no POS e movimentos de stock. | POS sale beside stock movement updates. |
| 12-16s | Veja o que está abaixo do mínimo antes da produção parar. | Action-needed low-stock cards. |
| 16-20s | Comece o teste grátis de 7 dias. | StockWise CTA with daily dashboard metrics. |

## Sample Data

- Vendas do dia: MZN 12.750
- Valor em stock: MZN 48.900
- Itens abaixo do mínimo: 3
- Movimentos de stock hoje: 18
- Farinha 25kg: abaixo do mínimo
- Fermento: abaixo do mínimo
- Caixa para bolo: atenção/reposição
- Venda POS: MZN 1.250

## Voiceover Script

O stock de uma padaria muda todos os dias. Com o StockWise, ingredientes, produtos e vendas ficam no mesmo sistema. Registe vendas no POS, acompanhe movimentos de stock e veja o que está abaixo do mínimo antes da produção parar. Comece o teste grátis de 7 dias.

## Subtitle-Safe Script

O stock de uma padaria muda todos os dias.

Ingredientes, produtos e vendas no mesmo sistema.

Registe vendas no POS e movimentos de stock.

Veja o que está abaixo do mínimo.

Comece o teste grátis de 7 dias.

## Animation Notes

- Use subtle upward fades, light slide-ins, and short staged UI reveals.
- Do not use aggressive camera movement, heavy 3D, or flashy effects.
- Keep caption text burned in and readable.
- Preserve a stable final CTA frame.
- Keep motion and spacing consistent with StockWise's controlled premium SaaS style.

## Vertical Version Preparation

The current composition is a single 1920x1080 horizontal source. A later 1080x1920 version should reuse the same scene order, captions, sample data, and visual identity, with stacked UI cards and a taller caption-safe area.
