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

## StockWise And WiseCore Brand Alignment

StockWise remains the product name, product mark, workspace identity, route language, and public domain. WiseCore Technologies, Lda. remains the company, promoter, and product owner. Product surfaces must not replace the StockWise identity with the WiseCore corporate identity; WiseCore attribution belongs in company, legal, institutional, and approved builder/owner contexts.

The maintained product palette is derived from the WiseCore corporate mark:

- bright teal-green `#00C98F`
- mid teal-green `#009679`
- dark teal `#014558`
- black `#000000`
- white `#FFFFFF`

The interactive system consumes this palette through semantic tokens rather than page-specific raw utilities. `--primary`, `--ring`, and their sidebar equivalents carry product actions, focus, selected navigation, and active tabs. Light mode uses dark teal primary surfaces with white text and a mid-teal focus ring. Dark mode uses moderated bright teal with dark-teal text and avoids neon decorative treatment. Neutral informational states use `--informational`; they must not be presented as success merely to make them green.

The only maintained hardcoded palette exception is generated Sales Order and Purchase Order print HTML. Those self-contained documents cannot consume the application CSS custom properties, so their section headers use the approved dark-teal and pale-teal values directly. This is presentation-only and does not alter legal wording or fiscal output semantics.

## Light And Dark Mode

Light mode uses white and near-white operational surfaces, controlled borders, restrained shadows, and high-readability text.

Dark mode uses black and neutral charcoal surfaces, moderated contrast, and non-neon semantic colors. Blue or navy must not be used as the environmental canvas. It is not a color inversion of light mode.

The maintained surface hierarchy is deliberate in both themes:

- the app canvas is the darkest or lightest environmental layer
- routine cards use `--card`; menus and dialogs use the slightly elevated `--popover`
- grouped controls and passive regions use `--muted` or `--secondary`
- borders separate structure without becoming a second accent system
- teal is reserved for primary action, focus, selection, and owned-brand emphasis
- amber, red, and positive green retain their warning, destructive, and success meanings

Loading, empty, error, blocked, success, and neutral states must remain visually and semantically distinct. The shared premium state panel owns those meanings; loading uses neutral skeletons with `role=status`, polite live announcements, and reduced-motion-safe animation. Empty states explain the missing prerequisite or next action. Error states use an alert role without rendering raw backend codes. Blocked states use warning semantics and must not be colored as success.

Buttons, inputs, text areas, selects, dialogs, and sheets consume semantic tokens. Read-only and disabled fields must remain visibly different from active controls. Focus rings must stay visible in light and dark mode, including on compact Android layouts. Elevated surfaces should use neutral black shadows rather than blue or navy shadow literals.

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
- Daily finance trend charts use semantic operating colors: Revenue is neutral charcoal in light mode and a readable light neutral in dark mode through `--chart-revenue-line`, COGS is red through `--chart-cogs-line`, and Gross Margin is green through `--chart-margin-line`.
- Inventory retains the named `--chart-inventory` token but uses the moderated WiseCore mid teal. It remains a data-series token, not a general interaction utility. Where Inventory and primary actions appear together, labels, marker shapes, and placement must keep their meanings distinct without relying on color alone.
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
- at the Phase 1 Recipes & Assemblies checkpoint, full Production Runs, frozen cost snapshots, labour/utilities/overhead allocation, recurring costs, and Growth Batches remained future scope; Production Runs are now live at `/production-runs`, Growth Batches G3 stock-input UI is live at `/growth-batches`, and recurring allocations, automated overhead pools, by-product allocation, and Growth Batches G4+ remain future scope
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

The landing page may use one realistic product-preview panel, restrained dark showcase sections, language/theme controls, pricing cards, lightweight React/Framer page-level scroll animation, restrained atmospheric movement, large-screen floating operational cards, fine-pointer bento pointer glow, a truthful capability rail, and the local illustrative desk/documents asset at `/landing/stockwise-records-desk.png`. The product preview must support light and dark mode. Repeated dashboard previews and artificial coded paperwork collages should be avoided; later visuals should clarify the shift from scattered spreadsheets, count sheets, invoices, receipts, payment notes, and paper records to organised operating control. Landing motion should stay subtle and reduced-motion safe: no autoplaying tabs, fake customer marquees, fabricated counters, heavy animation dependencies, or mobile-heavy continuous motion. It must not introduce finance, stock, POS, invoice, settlement, onboarding, Supabase, or migration logic.

## Validation Notes

Phase 3 register work did not change schema, migrations, stock posting, POS pricing, finance posting, settlements, invoice issuance, or access-control logic.

The onboarding invitation regression that previously blocked the full finance regression suite was fixed in `20260531091413_fix_create_company_preserve_pending_invites.sql`. The corrected `create_company_and_bootstrap` RPC leaves pending invitations untouched when an invited user creates a new company; invitation acceptance remains explicit.

Phase 4 UI work did not change the invitation RPCs, role assignment rules, settings persistence RPC, finance posting, POS posting, stock posting, settlements, invoice issuance, Supabase schema, or migrations.

## UX Phase 1 Production Checkpoint (2026-07-16)

The neutral surface and shared state system is live in production from implementation commit `53a36065f39cea971abb9b48f7c7b72a7ab03584` and Vercel deployment `dpl_5PdnDGS1BRs5MfybMENNenjZyj8K`.

- The final maintained source scan contains zero `blue-*`, `sky-*`, `cyan-*`, `slate-*`, navy HSL, or navy RGB/shadow occurrences.
- Two direct `#014558` values remain in self-contained Sales Order and Purchase Order print HTML. They are approved WiseCore dark-teal presentation exceptions because generated print markup cannot consume application CSS variables.
- Production visual QA covered 14 authenticated routes at `1440`, `1200`, `820`, and `390` in light and dark mode, with representative Portuguese checks.
- Page-level overflow, raw backend-code, fallback, console-error, and CSP-error counts were zero on the audited production routes.
- Validation run `29471866754` and isolated finance run `29471901431` passed; the isolated run completed `288/288` and cleaned up its ephemeral stack.
- StockWise remains the product identity. WiseCore Technologies, Lda. remains the owner and promoter.
- No schema, business logic, package dependency, workflow trigger, or Sentry configuration changed.

The evidence-backed product findings and UX-1 through UX-10 roadmap are maintained in [Product UX Audit - July 2026](ui-ux/PRODUCT_UX_AUDIT_2026-07.md).

## Production Runs Workspace Direction

The first Production Runs workspace is live at `/production-runs`. It uses the same premium register/detail pattern as other operational workspaces:

- register header, search/filter controls, desktop table, and Android-first cards
- draft creation from a recipe, editable actual output, source buckets, direct costs, and readiness preview
- posted detail reads frozen snapshots rather than recalculating historical cost from current stock
- reversal UI explains compensating movements, requires a reason, and requires typing the exact run reference before the destructive action is enabled
- draft edits invalidate the readiness preview so operators refresh current source-stock and cost readiness before posting
- quick assembly stays on `/bom`; Production Runs is the richer planned-versus-actual production path

Do not add a broad UI library for Production Runs. Keep the route on existing Tailwind, shadcn-style primitives, and `src/components/premium`.

## Growth Batches Workspace Direction

Growth Batches G3, G4.1, G4.2, G5.1, and G5.2 are live and production-smoke validated at `/growth-batches`. G4.1 extends the same workspace with mortality/shrinkage preview, recording, loss history, and MANAGER+ event-specific loss reversal; G4.2 adds a transfer preview/post/reversal surface; G5.1 adds a Harvests tab for governed depleting harvest preview/posting and MANAGER+ event-specific harvest reversal; G5.2 adds a Completion tab for lifecycle completion and MANAGER+ event-specific completion reversal. Hosted production and local replay now contain 44 migrations through `20260712230118_fix_canonical_sales_order_finance_state.sql`. The workspace uses the same premium register/detail approach:

- `PremiumRegisterHeader`, metric cards, search/filter controls, desktop `PremiumDataTable`, and Android `PremiumMobileCardList`
- detail tabs for overview, stock inputs, G4.2 transfers, G5.1 harvests, G5.2 completion, G4.1 losses, measurements, memo direct costs, timeline, and audit
- draft actions only while status is `draft`; measurement, memo direct-cost, G3 stock-input, G4.1 loss, G4.2 transfer, G5.1 harvest, and G5.2 completion actions only while status is `active`, with completed batches read-only except event-specific completion reversal where eligible
- G3 stock-input dialogs use explicit Preview and Post actions, mark previews stale after edits, keep duplicate/source blockers visible, and display item quantity/UOM, availability, WAC estimate, material cost, and movement references
- stock-input reversal is event-specific, MANAGER+ only, requires date/reason/exact event confirmation, and must not be labelled as whole-batch reversal
- G4.1 loss reversal is event-specific, MANAGER+ only, requires a reason, restores the original frozen quantity/weight, and must not be labelled as whole-batch reversal
- G4.2 transfer reversal is event-specific, MANAGER+ only, requires a reason, and restores only the original source location for the current surviving batch
- G5.1 harvest reversal is event-specific, MANAGER+ only, requires a reason, restores the original frozen quantity/weight/cost allocation when the harvested output remains available, and must not be labelled as sale reversal, COGS reversal, or whole-batch reversal
- G5.2 completion reversal is event-specific, MANAGER+ only, requires a reason, restores active status only, and must not be labelled as whole-batch reversal or harvest reversal
- no enabled controls for non-depleting yield, split/child batches, multi-output harvest, whole-batch reversal, fair value, FIFO, COGS, sale/invoice creation, or finance posting

The G5.1 Harvests tab and G5.2 Completion tab keep the prior G4.2 layout correction intact: readable batch title, actions wrapping inside the detail card, preview-required submit, stale-preview messaging, visible stock/no-sale/no-COGS/no-finance explanations, readable history, no raw backend codes, English and Portuguese copy, and no page-level horizontal overflow at mobile widths. The 2026-07-09 production smoke confirmed the completion history remained readable through `active -> completed -> active`, no second-reversal action remained visible, and the G5.2 Portuguese completion copy was rechecked after the `bc22eb3` frontend correction.

The live governed finance package keeps the current Settlements, Cash, and Bank Detail layouts while replacing unsafe mutation behavior: submits disable during posting, known anchor failures map to English/Portuguese guidance, balances refresh after success/replay, and CSV import sends one atomic batch with row-specific safe failures. Identical logical CSV files retain a deterministic SHA-256 identity across reloads. Production smoke passed at `1440`, `1200`, `820`, and `390` with no page-level overflow, raw package backend code, console error, or CSP error; no broad finance-page redesign or WiseCore rebrand sweep was part of this package.

Production UI smoke validated the G1-G2 register, detail overview, measurement history, direct-cost history, timeline, and audit surfaces with retained batch `LEN-GB000000001`. G3 production smoke then validated batch `LEN-GB000000002`: preview, single post, stock-input history, MANAGER+ event-specific reversal, restored material cost, restored source stock, no second reversal action, no finance mutation, and no selling-price mutation. G4.1 production smoke validated batch `LEN-GB000000003`: mortality and shrinkage preview/post/reversal, required reversal reason, restored quantity `20 -> 18 -> 20 EA`, restored weight `40 -> 35 -> 40 KG`, no second reversal action, no stock/finance/cost/price mutation, and zero negative stock or duplicate buckets. G4.2 production smoke used the same controlled batch: the first transfer was restored through the approved authenticated public reversal RPC after a detail-card layout blocker, then the corrected UI completed a fresh transfer/reversal through the maintained history surface with no second reversal action and no stock/finance/cost/price mutation. Weight values displayed their UOM, memo/material costs displayed MZN, Android cards passed at `390`, and contained table scrolling at `1200` and `820` stayed inside the table surface without page/body overflow.

The visual reference standard is existing StockWise premium components. MVPBlocks or other galleries may be used only as inspiration; no MVPBlocks dependency or copied block is part of this package.

## App Shell And Navigation Rules

The maintained authenticated shell prioritizes daily operating work before setup. Desktop and grouped mobile navigation use this order: Overview, Sales, Purchasing, Inventory, Production, Finance, Administration, then the separately authorized Platform area. Customers stay with Sales; Suppliers and Landed Cost stay with Purchasing; Mozambique Compliance stays with Finance; Platform Control must never be presented as company Settings.

Navigation rules:

- directly visible entries must preserve existing routes, query parameters, role checks, company-access checks, and backend authority;
- the shared Orders route must expose distinct Sales and Purchase labels using the maintained `tab=sales` and `tab=purchase` contract;
- Point of Sale remains a prominent Overview and mobile destination for users already authorized by the existing shell contract;
- Administration is visually secondary, and Platform is separated by structure as well as authorization;
- the mobile dock has no more than five controls and uses Dashboard, POS, Orders, Stock, and More; More exposes every authorized route through the grouped drawer;
- current company and current user are labelled as different contexts; internal company IDs and raw role codes must not be used as display fallbacks;
- Search, Profile, language, theme, and sign-out are utilities, not competing primary destinations;
- active state combines `aria-current`, typography, a shape indicator, and WiseCore teal selection rather than color alone;
- detail routes activate their register parent, and shared query-tab routes activate exactly one destination;
- desktop navigation owns an internal scroll region; the mobile drawer locks body scroll, contains focus, closes on Escape and route selection, and restores focus to its trigger;
- all navigation icons use Lucide, consistent sizing, and `currentColor`; Phosphor remains reserved for decorative and premium illustration;
- group labels, route labels, descriptions, utility labels, accessible names, and browser route titles require matching English and Portuguese terminology.

The shell must remain a navigation and context layer. It must not infer permissions, expose unresolved authority, create a backend preference, or move workflow decisions out of guarded pages and RPCs.

UX-1 is live from implementation commit `75001f745ad4023a83724aafdae96934653fc450`. Production read-only QA confirmed the eight-group hierarchy, teal-plus-shape active treatment, separated company/user/platform context, five-control mobile dock, grouped More drawer, and EN/PT route metadata at `1440`, `1200`, `820`, and `390` without page overflow, console errors, or CSP errors.

The `/bom` workflow bridge cards now use the shared premium card spacing pattern: icon badge, eyebrow/title/body stack, and separated action zone. Production smoke verified the Landed Cost card remains secondary, Production Runs remains more action-oriented, and the correction is spacing/hierarchy only, not a BOM workflow or posting change.

## What Not To Use

Avoid:

- heavy animation inside the authenticated business app
- random glow effects, shader backgrounds, or decorative blobs
- neon dark mode
- generic bento-card repetition without operating meaning
- desktop tables as the primary Android review surface
- finance metrics that look like placeholders
- component-library churn that adds paid or proprietary dependencies

The live activation workspace uses the existing card, badge, form, dialog, and responsive table primitives. It avoids checkout language, visually separates authoritative amount from declared amount, keeps the proof-not-verification warning persistent, and makes review actions explicit rather than hover-only. Production QA confirmed English/Portuguese lifecycle labels, light/dark readability, and zero page overflow at `1440`, `1200`, `820`, and `390`; the targeted localization follow-up did not introduce a broader visual redesign.

## Commercial tax and item-profile UI (live)

Settings uses the existing card/form system for auditable options and separate sales/purchase defaults. SO/PO create surfaces use mobile line cards below `md`, contained desktop tables above `md`, per-line treatment selectors, a deliberate bulk-apply control, explicit unconfigured messaging, and derived gross/discount/subtotal/tax/total summaries. SI/VB detail surfaces show copied labels and amounts rather than raw codes.

Items disables protected profile controls when capability detection fails, shows a persistent compatibility warning, hides the misleading profile preview, and requires explicit basic-only acknowledgement. This is a contained trust correction, not a dashboard, brand, or component-library redesign. Production QA verified contained layouts at `1440`, `1200`, `820`, and `390`, English/Portuguese, light/dark, zero page-level overflow, zero raw package codes, and no console or CSP error.

## WiseCore palette alignment (live)

The 2026-07-16 visual-identity rollout keeps StockWise as the product and WiseCore Technologies, Lda. as its owner and promoter. The maintained interactive palette now derives from the WiseCore logo: bright teal-green `#00C98F`, mid teal-green `#009679`, dark teal `#014558`, black, and white. Light mode uses dark teal for primary actions and mid teal for focus; dark mode uses the bright teal with a dark-teal foreground so the interface remains readable without becoming neon.

The package replaced `199` explicit maintained-source blue/sky brand literals (`187` Tailwind sky utilities, four landing blue-orb references, three legacy `--sw-blue*` tokens, and five old blue hex literals) with semantic tokens or context-appropriate colors. The final raw count for those blue/sky/legacy literals is zero. Shared corrections covered `IconBadge`, `PremiumStatusBadge`, `PremiumMetricCard`, `MobileQuickActionGroup`, subscription analytics, Tailwind informational tone support, and the landing product tabs. Revenue is neutral charcoal in light mode and a light neutral in dark mode; gross margin remains positive green and COGS remains red. The named `--chart-inventory` series now uses the WiseCore mid teal rather than cyan. Standalone Sales Order, Purchase Order, and finance-document print HTML use neutral charcoal text and furniture because generated print documents cannot consume application CSS variables; this remains presentation-only and does not change document wording or fiscal semantics.

The landing's competing blue orb was replaced by one restrained deep-teal/charcoal glow. The unused and unreferenced `src/tokens.css` legacy token file was removed after repository-wide import verification. No logo was regenerated, no Ocean Breeze dependency was installed, and no route, schema, business logic, package identifier, or Sentry configuration changed.

## Neutral surface and state foundation (Phase 1)

The first whole-product UX phase neutralizes the remaining navy environmental styling without reworking route architecture or business workflows. Dark canvas, cards, popovers, sidebars, muted controls, borders, PWA theme colors, landing showcase surfaces, print furniture, and shadows now use black or neutral charcoal. WiseCore teal remains bounded to actions, focus, selection, and controlled brand emphasis.

The shared state foundation consists of `AppLoadingState`, the accessible `PremiumSkeleton`, and `PremiumStatePanel`. These primitives prevent route-loading, empty, error, blocked, success, and neutral states from collapsing into the same generic card treatment. Existing `PremiumEmptyState` call sites retain their API and inherit the shared empty-state semantics. Further page-level adoption belongs to later roadmap phases where the local workflow can be assessed without changing backend-authoritative behaviour.
# POS tax-treatment presentation

Point of Sale review surfaces must show authoritative Subtotal, Tax treatment, Tax, Total to receive, and payment destination before confirmation. A changed cart, company, bin, date, customer, price, quantity, payment destination, bank account, or tax configuration invalidates the preview. Unconfigured state uses restrained warning treatment and role-appropriate guidance. Non-fiscal state says `tax not applied`; it must never use `0%`, `zero-rated`, `exempt`, or fiscal-invoice styling.

Settings keeps the two explicit future-sale choices within the existing commercial-tax section. Non-fiscal selection requires a plain acknowledgement and the legal-obligation disclaimer; this is not a waiver or compliance claim. Sales Order registers/details use a durable restrained non-fiscal badge and keep settlement and stock evidence visible.
