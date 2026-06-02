# Padaria Pão Dourado Demo Plan

## Objective

Create a 20-second Portuguese-first StockWise demo that shows how a bakery can control daily stock, POS sales, stock movements, low-stock alerts, and business visibility without using real customer data.

This demo is an offline WhatsApp and pitch asset only. It must not be embedded on the public landing page, copied into `public/`, or referenced by app routes.

## Audience

Bakery owners, managers, and operators in Mozambique who need practical control over ingredients, finished products, daily sales, and restocking decisions.

## Format

- Primary version: 16:9 horizontal, 1920x1080
- Duration: 20 seconds
- Language: Portuguese
- Captions: burned in
- Voiceover: script prepared, rendering optional
- Future-ready: structure can be adapted into a 9:16 vertical version later

## Visual System Alignment

- The HyperFrames demo is self-contained marketing video HTML, not a React app import.
- The video panels are video-only recreations aligned with the StockWise visual system; they do not execute authenticated app workflows.
- It must visually follow the real StockWise app and landing page design system.
- Use the official StockWise logo from `public/brand/stockwise-logo.png`, copied into the demo as `assets/stockwise-logo.png`.
- Use the app tokens from `src/index.css`: light app background, navy foreground, card and border tokens, StockWise primary blue, financial-positive, financial-warning, and dashboard premium panel tokens.
- Recreate lightweight video-only panels inspired by `PremiumRegisterHeader`, `PremiumMetricCard`, `PremiumStatusBadge`, dashboard cockpit cards, Items register cards, Stock Levels risk badges, and POS sale panels.
- Do not invent alternate logos, random blues, generic SaaS gradients, or visual language that would make the demo look separate from StockWise.

## Scene Timing

| Scene | Time | On-screen copy | Visual direction |
| --- | --- | --- | --- |
| 1 | 0-3s | O stock de uma padaria muda todos os dias. | Clean title card for Padaria Pão Dourado with bakery inventory items. |
| 2 | 3-7s | Com o StockWise, ingredientes, produtos e vendas ficam no mesmo sistema. | StockWise-style item register showing Farinha 25kg, Açúcar 10kg, Fermento, Pão, and Bolo de chocolate with stock badges. |
| 3 | 7-12s | Registe vendas no POS e movimentos de stock. | POS sale for Pão, Bolo de chocolate, and Pastel de nata, followed by visible stock movement updates. |
| 4 | 12-16s | Veja o que está abaixo do mínimo antes da produção parar. | Action-needed cards for Farinha 25kg, Fermento, and Caixa para bolo. |
| 5 | 16-20s | Controle stock, vendas e decisões diárias com mais segurança. | StockWise logo, daily metrics preview, and CTA: Começar teste grátis de 7 dias. |

## Voiceover Script

O stock de uma padaria muda todos os dias. Com o StockWise, ingredientes, produtos e vendas ficam no mesmo sistema. Registe vendas no POS, acompanhe movimentos de stock e veja o que está abaixo do mínimo antes da produção parar. Comece o teste grátis de 7 dias.

## Subtitle-Safe Version

O stock de uma padaria muda todos os dias.

Ingredientes, produtos e vendas no mesmo sistema.

Registe vendas no POS e movimentos de stock.

Veja o que está abaixo do mínimo.

Comece o teste grátis de 7 dias.

## Sample Data

- Empresa fictícia: Padaria Pão Dourado
- Vendas do dia: MZN 12.750
- Valor em stock: MZN 48.900
- Itens abaixo do mínimo: 3
- Movimentos de stock hoje: 18
- Venda POS: MZN 1.250
- Farinha 25kg: abaixo do mínimo
- Fermento: abaixo do mínimo
- Caixa para bolo: atenção/reposição
- Outros itens: Açúcar 10kg, Manteiga, Pão, Bolo de chocolate, Pastel de nata

## Animation Notes

- Use StockWise blue/navy branding with light-first SaaS surfaces.
- Keep motion subtle: fade, slight upward movement, and light UI slide-ins.
- Use calm warning styling for low-stock alerts.
- Avoid heavy 3D, flashy effects, fake testimonials, batch/expiry workflows, and unsupported feature claims.
- Include the caption `Dados ilustrativos para demonstração.` where sample business values are shown.
- Keep card radius, border, shadow, badge tones, metric cards, and button styling close to the authenticated premium UI.

## Export Recommendation

- Draft review: `npx hyperframes render --quality draft --output renders/bakery-demo-draft.mp4`
- Final horizontal: `npx hyperframes render --fps 30 --quality high --output renders/bakery-demo-1920x1080.mp4`
- Recommended delivery: MP4, 1920x1080, 30fps, burned-in Portuguese captions

Run commands from `demos/hyperframes/bakery-demo`.

Install FFmpeg normally through the operating system or package manager before rendering. Do not document or depend on local media-player paths such as KMPlayer filter folders.

## Known Limitations

- The demo uses fictional sample UI and data; it is not a live StockWise customer workspace.
- No voiceover audio has been rendered yet; the script is prepared for a later narration pass.
- The first composition is horizontal only; a vertical 9:16 adaptation should be created separately.
- The demo does not show batch or expiry logic.
- The CTA mentions a 7-day trial only and does not imply instant paid checkout.
