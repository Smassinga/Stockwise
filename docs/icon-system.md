# StockWise Icon System

Checked: 2026-07-16

## Current Problem

StockWise previously used `lucide-react` for nearly every operational, navigation, and marketing icon. Lucide remains suitable for base shadcn controls, navigation, and common UI affordances, but the public landing page and high-visibility premium cards were starting to look generic. Several card patterns also used 32-40 px icon containers beside long text, which made mobile wrapping feel cramped.

## Selected Library

The approved first-pass operational accent library is Phosphor Icons through `@phosphor-icons/react`.

Rationale:

- MIT license and commercial SaaS usage fit the product.
- React package supports tree-shaking when only named icons are imported.
- Icons support `currentColor`, sizing, and multiple weights.
- `duotone` weight gives StockWise a more distinctive finance/inventory feel than generic outline-only icons.
- The library includes enough finance, stock, document, user, setup, and support icons for future replacement phases.

Lucide remains approved for core shadcn UI controls and navigation where recognisability matters. Do not mix additional operational icon systems unless a later audit documents the reason.

## Licence Summary

- Phosphor Icons React: MIT, React package, tree-shaking and import-performance guidance. Source: https://github.com/phosphor-icons/react
- Phosphor Core: MIT source package for raw SVG assets. Source: https://github.com/phosphor-icons/core
- Iconoir: MIT, React package, commercial use allowed; approved as a possible landing or empty-state accent source if Phosphor cannot cover a need. Source: https://iconoir.com/docs/packages/iconoir-react
- Tabler Icons: MIT, React package, currentColor/stroke support; approved fallback for utility icons but not selected for this first pass. Source: https://github.com/tabler/tabler-icons
- Streamline: commercial-use options exist, but free assets may require attribution and exact pack terms must be checked per asset. Not approved for committed app icons without a specific licence note. Source: https://site.streamlinehq.com/free/free-icons-for-commercial-use

## Approved Usage

- Use Phosphor for public landing feature icons, product-preview accents, onboarding decision/checklist cards, Settings setup cards, and future premium operational cards.
- Use `weight="duotone"` for decorative card/icon-badge accents unless a functional icon needs a simpler outline.
- Use Lucide for shadcn primitives, table controls, sidebar/mobile navigation, close/search/chevron affordances, and existing route icons until a later nav-specific pass.
- Import only the icons used by a file. Prefer Phosphor deep imports such as `@phosphor-icons/react/dist/csr/Warehouse` in this Vite app to avoid eager development transpilation of the whole package.
- Icons should inherit color through `currentColor` and semantic token classes.

## Not Approved

- Raw icon-pack dumps committed to the repository.
- Icons with unclear commercial licence or attribution requirements.
- Streamline, Reshot, Iconpacks.net, or ad hoc marketplace icons as the main operational app icon system.
- Using third-party icons as StockWise logos, product marks, or trademarks unless the licence explicitly permits that use.
- Random hardcoded icon colors that bypass tokens.
- Mixing more than two operational icon styles on the same surface.

## Sizing Rules

- Dashboard and Settings card icon containers: 40-48 px on desktop, 36-40 px on mobile.
- Landing feature icon containers: 48-56 px on desktop, 40-48 px on mobile.
- Empty-state icon containers: 44-48 px.
- Icons inside containers should usually be 16-24 px depending on the container size.
- Use stable dimensions so icon state changes do not resize cards.

## Container And Card Rules

- Use `IconBadge` for premium metric, action, empty-state, landing feature, onboarding, and Settings setup-card icons.
- On narrow screens, stack icon above text when a horizontal row would crowd long copy.
- Keep one icon per card unless a second icon has a clear functional purpose.
- Icon badges should support the card hierarchy, not overpower metrics or titles.
- Icon badges must remain in normal card flow with sufficient top padding; they should not sit flush against the card boundary.
- Use semantic tone classes from the premium component layer instead of one-off color recipes.

## Accessibility

- Decorative icons in cards should be `aria-hidden`.
- Functional icon-only buttons must have accessible labels or tooltips.
- Do not rely on icon color alone to communicate state; pair with text, status badges, or labels.

## Replacement Priority

1. Public landing feature cards and product preview.
2. Dashboard metric/action/empty-state cards.
3. Onboarding decision and checklist cards.
4. Settings setup map cards.
5. Users/Roles explanation and metric cards.
6. Items, Movements, and Stock Levels only where cramping is visible and the change is low-risk.
7. Sidebar and mobile navigation only after a separate recognisability review.

## Bundle Guardrail

Keep the Phosphor package as a single React dependency and do not add another icon package for operational app icons without removing or clearly scoping the old one. Avoid importing whole collections. Any future icon pass should compare production bundle output before and after if many icons are added.

## UX Phase 1 Audit Note

The July 2026 neutral-surface release did not add, remove, or replace an icon package. Phosphor remains the approved decorative/premium accent system and Lucide remains the functional navigation/control system. Both inherit semantic color through `currentColor`; generic blue or cyan icon defaults are not approved.

UX-1 completed the navigation recognisability pass. Dashboard uses overview meaning; POS uses the sales-register basket; Sales Orders and Purchase Orders use distinct outbound/check and inbound/list document meanings; Sales Invoices and Vendor Bills use distinct receipt and incoming-document meanings; Items, Stock Levels, Movements, and Warehouses use package, quantity, transfer/history, and warehouse meanings; Recipes, Production Runs, and Growth Batches use definition-tree, factory, and lifecycle meanings; Settlements, Cash, Banks, Transactions, Reports, and Compliance use hand/payment, wallet, bank, ledger, chart, and fiscal-shield meanings; Users, Roles, Currency, Units, Settings, and Platform Control use people, key, currency, ruler, sliders, and system-administration meanings.

Every navigation icon is Lucide, `aria-hidden` beside a visible label, consistent at 20 px, and inherits `currentColor`. WiseCore teal appears through active-state tokens only. Phosphor imports and premium/decorative consumers are unchanged. UX-9 retains the broader cross-product icon and assistive-technology consistency review.

The UX-1 production checkpoint on 2026-07-16 found no missing navigation icon, mixed icon package within a navigation row, hardcoded blue/cyan route color, or icon-only primary destination at the tested desktop, tablet, and phone widths.
