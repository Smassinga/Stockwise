# StockWise Premium UI Direction

This document records the current UI direction for the authenticated StockWise product. It applies to operational app surfaces, not to marketing pages.

## Product Standard

StockWise should feel like a serious modern SaaS product with financial-institution trust. The app is light-first for daily operational work. Dark mode must be equally deliberate, and selected dashboard areas may use richer dark panels when they improve hierarchy and executive scanning.

The UI foundation now favors:

- clear page headers with company, warehouse, and time context
- premium metric cards with semantic tones
- structured sections with readable descriptions and contained actions
- intentional empty states that guide the next setup or operating action
- chart colors that communicate finance meaning without weak opacity
- Android/mobile layouts that prioritize operator workflows

## Light And Dark Mode

Light mode uses white and near-white operational surfaces, controlled borders, restrained shadows, and high-readability text.

Dark mode uses deep charcoal/navy surfaces, moderated contrast, and non-neon semantic colors. It is not a color inversion of light mode.

Dashboard dark panels are approved for the top cockpit and performance chart when they add status hierarchy. They should not be copied into forms, item registers, invoice details, or routine admin tables.

## Dashboard Cockpit

The dashboard is structured as a management cockpit:

- Premium header: company context, warehouse context, active window, and a primary POS action.
- Operating status: a dark cockpit panel with the operating answer and high-value metrics.
- Action needed: replenishment, setup, margin, or first-use actions before passive analytics.
- Recent activity: timeline-style movement feed with useful timestamps and values.
- Performance snapshot: Daily Revenue vs COGS chart plus revenue, COGS, inventory, and gross-margin metrics.
- Performance insights: item-level operational margin remains table/card based and keeps the existing shipment-linked calculation language.

Dashboard content must preserve existing data sources and finance semantics. Visual polish must not change posting logic, COGS logic, settlement anchoring, RLS, or access behavior.

The external dashboard guide used in the June 2026 polish pass is inspiration only for hierarchy, card/chart composition, responsive behaviour, and light/dark polish. It must not trigger a migration to Next.js, `next-themes`, a standalone theme selector, or a copied template architecture. StockWise remains the existing Vite + React + TypeScript app unless a separate architecture decision says otherwise.

## Chart Styling

Finance charts should look like operating insight, not decoration.

Rules:

- Revenue, COGS, margin, inventory, and receivables use named chart tokens.
- Revenue and COGS must be readable in both light and dark mode.
- Daily finance trend charts use semantic operating colors: Revenue is blue through `--chart-revenue-line`, COGS is red through `--chart-cogs-line`, and Gross Margin is green through `--chart-margin-line`.
- Daily line-chart markers are visible circles: normal dots are 8x8 px (`r=4`), active/hover dots are 10x10 px (`r=5`), and both use `--chart-grid-border` with `strokeWidth=1`.
- `--chart-grid-border` controls grid lines, marker strokes, and tooltip marker borders so chart furniture stays consistent in light and dark mode.
- Daily Revenue vs COGS is rendered as a timeline line chart with visible circular markers for each point; chart styling changed without changing the dashboard data-source logic.
- Do not make key financial values look disabled through weak opacity.
- Tooltips use clear surfaces, tabular numbers, and semantic color markers.
- Legends use readable text and direct series names.
- Empty chart states explain what data is required.

The Daily Revenue vs COGS chart uses the existing shipment-linked dashboard calculation and adds only a visual daily trend layer.

## Android Workflow Principle

Android should not mimic the desktop dashboard. Mobile dashboard order should prioritize:

1. Today/status context.
2. Action Needed.
3. Quick Actions such as Start POS, Search item, Record movement, and View low stock.
4. Recent Activity.
5. Charts and deeper performance review lower on the page.

Compact inventory and operational pages should prefer card/register surfaces before falling back to horizontal desktop tables.

## Premium Registers

Operational registers now have a shared premium pattern under `src/components/premium`:

- `PremiumRegisterHeader` for page context, badges, actions, and metric summaries
- `PremiumTableToolbar` and `PremiumTableFilter` for search and filter controls
- `PremiumDataTable` for desktop sorting, column visibility, pagination, loading skeletons, and empty/error states
- `PremiumMobileCardList` for Android-first card review with the same pagination model
- `PremiumColumnVisibilityMenu`, `PremiumPagination`, `PremiumBulkActionBar`, and `PremiumImportExportActions` for reusable register controls

Desktop registers may use wide tables when comparison matters. Android registers should show searchable cards first, with location, status, and next action visible without horizontal scrolling.

Items, Stock Levels, and Movements follow this implementation:

- Items uses the register pattern for SKU/name, role indicators, base UoM, default sell price, stock status, readiness, minimum-stock editing, and guarded delete actions.
- Stock Levels uses the register pattern for item/location lookup, warehouse filters, stock-risk filters, valuation columns, low-stock badges, Excel export, and movement/item shortcuts.
- Movements uses the register pattern as a premium stock-ledger surface over `stock_movements`: summary cards for total movements, Entradas/Receipts, Saídas/Issues, Ajustes/Adjustments, and Transferências/Transfers; search plus date/type/reference/item/warehouse/bin filters; semantic movement badges; desktop sortable table; Android cards with details and source actions.
- Bin filtering is not exposed on Stock Levels until the current stock-level read model exposes bin data to the page.

Movements must stay a register, not another dashboard. It may improve presentation, filtering, loading/error states, and empty states, but it must not manually mutate `stock_levels`, change posting/valuation/POS/purchase logic, or imply a costing-policy change. `stock_movements` remains canonical and `stock_levels` remains derived.

## Recipes & Assemblies

The former Assembly/BOM workspace is now presented as **Recipes & Assemblies**. This is Phase 1 of the Production & Costing direction and is intentionally a UX and workflow-clarity upgrade around the existing BOM/assembly model.

The workspace should answer operational questions before posting: what finished item is being made, which recipe/BOM is selected, which ingredients/components are consumed, what quantity is planned, what blocks readiness, what the current weighted-average material estimate is, and where stock is consumed from and received into.

Current boundaries:

- no Supabase migration was introduced
- no stock posting, valuation, POS pricing, finance posting, settlement, invoice, RLS, entitlement, or access-control logic changed
- current assembly cost remains an estimated material cost based on existing weighted-average stock cost
- at the Phase 1 Recipes & Assemblies checkpoint, full Production Runs, frozen cost snapshots, labour/utilities/overhead allocation, recurring costs, and Growth Batches remained future scope; the first Production Runs package is now implemented locally at `/production-runs` and remains not live until reviewed rollout
- `build_from_bom_sources`, `inv_issue_component`, and `inv_receive_finished` were not expanded and still require separate backend review before future Production & Costing work depends on them
- Android/mobile layout must remain card-first, with component/ingredient cards and readiness/cost/action panels available without horizontal table dependence

Import/export rules:

- Register buttons may link to existing import/export workflows.
- Do not invent new import/export business logic in a visual pass.
- Items links to the existing opening-data import route and keeps item-master export disabled until a governed export flow is implemented.
- Stock Levels keeps the existing Excel export path and only changes its placement and surrounding UI.

## Phase 4 Company Setup And Administration

Phase 4 applies the same premium standard to onboarding, Settings, and Users/Roles without changing schema, posting, access-control, or invitation RPC behaviour.

Onboarding is a setup decision surface:

- invited users see Join invited company and Create new company as separate explicit paths
- pending invitation cards explain role, inviter, invitation date, expiry, and the explicit accept action
- creating a new company leaves pending invitations pending and usable
- the completion state now shows a setup checklist for company profile, fiscal/legal setup, users, and opening data

Settings is the operating setup map for company administrators. It should route to real backed surfaces only:

- Company Profile remains the editable Settings form for legal/trading identity, contacts, address, logo, and print footer
- Fiscal & Legal and Document Numbering route to the Mozambique compliance workspace where fiscal series and legal references are governed
- Users & Roles routes to `/users` and `/users/roles`
- Warehouses & Bins, Currencies, Bank Accounts, and Import/Export route to their existing workspaces
- Notifications and due reminders stay inside Settings
- Payment Terms are acknowledged as workflow-backed through customers, suppliers, and order forms, but a central Settings editor is not exposed yet
- Subscription & Access remains platform-managed; company Settings must not show fake plan toggles or payment controls

Users/Roles uses the canonical role model from `permissions.ts` and `roles.ts`. Role descriptions may explain practical authority, but they must not imply permissions that the current role helpers or backend policies do not enforce.

## UI Library Position

The approved direction is to improve the existing Tailwind and shadcn-style component layer. Do not add broad UI libraries unless there is a clear product need that cannot be met by the current stack.

The current premium primitives live under `src/components/premium` and should stay generic:

- no direct Supabase calls
- no route-only business logic
- typed props
- accessible labels and button semantics
- light and dark mode support

Phase 4 keeps this decision: no paid or broad UI dependency was added for onboarding, Settings, or Users/Roles work.

## Icon System

The first icon-system pass adds `@phosphor-icons/react` as the approved premium accent library for high-visibility cards and public landing features. Phosphor is used with direct per-icon imports and `currentColor` so the existing token system still controls color. Lucide remains approved for shadcn primitives, navigation, search, close, chevron, and other standard UI controls until a separate navigation audit is completed.

Premium icon containers should use `IconBadge` instead of one-off inline spans. Dashboard and Settings card icon badges should stay around 40-48 px on desktop and 36-40 px on mobile; landing feature icons should be slightly larger. Full rules are maintained in [Icon System](icon-system.md).

## Public Landing Page Direction

The public landing page follows the same premium-business standard but remains a marketing surface, not an authenticated workflow surface. Its maintained source-of-truth docs live under `docs/landing-page/`.

Current positioning:

- StockWise helps businesses control stock, sales, purchases, documents, and payments in one organised workspace.
- The hero CTA is `Start 7-day trial`; pricing is shown in MZN; paid activation remains manually controlled by StockWise.
- Public compliance wording must be cautious: StockWise prepares cleaner fiscal and business records, but official submissions should be validated by an accountant or fiscal advisor.
- The page must not claim fiscal certification, official SAF-T/XML generation, automatic paid checkout, or a live FIFO costing policy.

The landing page may use one realistic product-preview panel, restrained dark showcase sections, language/theme controls, pricing cards, lightweight page-level scroll animation, and the local illustrative desk/documents asset at `/landing/stockwise-records-desk.png`. The product preview must support light and dark mode. Repeated dashboard previews and artificial coded paperwork collages should be avoided; later visuals should clarify the shift from scattered spreadsheets, count sheets, invoices, receipts, payment notes, and paper records to organised operating control. Landing motion should stay CSS/IntersectionObserver-based, subtle, and reduced-motion safe. It must not introduce finance, stock, POS, invoice, settlement, onboarding, Supabase, or migration logic.

## Validation Notes

Phase 3 register work did not change schema, migrations, stock posting, POS pricing, finance posting, settlements, invoice issuance, or access-control logic.

The onboarding invitation regression that previously blocked the full finance regression suite was fixed in `20260531091413_fix_create_company_preserve_pending_invites.sql`. The corrected `create_company_and_bootstrap` RPC leaves pending invitations untouched when an invited user creates a new company; invitation acceptance remains explicit.

Phase 4 UI work did not change the invitation RPCs, role assignment rules, settings persistence RPC, finance posting, POS posting, stock posting, settlements, invoice issuance, Supabase schema, or migrations.

## Production Runs Workspace Direction

The first Production Runs workspace is implemented locally at `/production-runs` and is not live until rollout. It uses the same premium register/detail pattern as other operational workspaces:

- register header, search/filter controls, desktop table, and Android-first cards
- draft creation from a recipe, editable actual output, source buckets, direct costs, and readiness preview
- posted detail reads frozen snapshots rather than recalculating historical cost from current stock
- reversal UI explains compensating movements, requires a reason, and requires typing the exact run reference before the destructive action is enabled
- draft edits invalidate the readiness preview so operators refresh current source-stock and cost readiness before posting
- quick assembly stays on `/bom`; Production Runs is the richer planned-versus-actual production path

Do not add a broad UI library for Production Runs. Keep the route on existing Tailwind, shadcn-style primitives, and `src/components/premium`.

## What Not To Use

Avoid:

- heavy animation inside the authenticated business app
- random glow effects, shader backgrounds, or decorative blobs
- neon dark mode
- generic bento-card repetition without operating meaning
- desktop tables as the primary Android review surface
- finance metrics that look like placeholders
- component-library churn that adds paid or proprietary dependencies
