# StockWise Premium UI Direction

## OPS-1 operating surfaces

Receipts use focused completion actions and clean thermal/A4 hierarchy. Reports are navigated as a business-question catalogue rather than a generic tab strip. Branded exports use company identity without empty logo space. The notification bell remains compact while `/notifications` provides accessible filters and mobile cards; it is an operating inbox, not a social feed.

This document records the current UI direction for the authenticated StockWise product. It applies to operational app surfaces, not to marketing pages.

This is the canonical StockWise UI quality contract. Surface-specific documents may add workflow constraints, but they must not redefine the brand, semantic-state, loading, accessibility, content, mobile, or restraint rules below. Historical rollout evidence records what was checked at the time; it is not a competing style guide.

## UX-10 UI quality contract

### Product identity and colour roles

StockWise uses WiseCore green/teal, black, charcoal, white, and neutral grayscale. Blue may appear inside an authentic StockWise or WiseCore logo asset, but blue and purple are not application-primary or environmental colours.

Brand and state have separate jobs. `primary` identifies the product, principal actions, selection, and focus. It does not mean success. General interface states use the `status` token family mapped in Tailwind:

| Meaning | Tailwind contract | Required non-colour signal |
| --- | --- | --- |
| Success | `status-success`, `status-success-foreground`, `status-success-muted`, `status-success-border` | Outcome text and, where useful, a check icon |
| Warning | `status-warning`, `status-warning-foreground`, `status-warning-muted`, `status-warning-border` | Warning text and, where useful, a warning icon |
| Danger/error | `status-danger`, `status-danger-foreground`, `status-danger-muted`, `status-danger-border` | Error or destructive text and, where useful, an alert icon |
| Information | `status-info`, `status-info-foreground`, `status-info-muted`, `status-info-border` | Explanatory text or an accessible label |
| Neutral | `status-neutral`, `status-neutral-foreground`, `status-neutral-muted`, `status-neutral-border` | State text or context label |

Financial and chart tokens remain domain-specific data encodings; they are not substitutes for general status tokens. `destructive` remains the base destructive-control contract. New components must not add direct Tailwind colour recipes such as `bg-green-*`, `text-red-*`, or `border-amber-*` for semantic state. Existing direct usage is frozen by the UX foundations baseline and must decrease during later surface packages. A state is never a coloured dot or tinted row alone: pair colour with text, an icon, a label, or an accessible name.

### Visual restraint and StockWise specificity

Hierarchy, spacing, typography, real product evidence, and operational context should be preferred over decorative effects. Gradients, glow, blurred blobs or orbs, glassmorphism, floating decoration, pointer glow, shimmer outside loading, animation, unnecessary shadows, oversized rounded cards, icon badges, pills, and card grids require a functional reason. They are not default polish.

A card is a grouping mechanism, not the default layout primitive. Do not automatically put every KPI, paragraph, feature, step, setting, or empty state in a rounded bordered container. Prefer whitespace, dividers, sections, rows, tables, lists, grouped fields, and typographic hierarchy when they communicate the relationship more directly. Status pills and icon badges are justified only when they improve scanning or preserve a compact control/state pattern.

If a section or component could be copied unchanged into an unrelated SaaS product, question whether it is specific enough to StockWise.

### Loading contract

When the final structure is reasonably known, loading placeholders must approximate it. Use the shared `PremiumSkeleton` summary, table, list, or detail structure and the table/mobile-register loading contracts before inventing another skeleton. Reserve the major content areas, keep the skeleton responsive, and avoid generic rectangles that imply data or structure the final view will not contain. Render real content as soon as it is available; do not hold a skeleton for visual effect.

Use a spinner or progress indicator for a local active operation such as saving, submitting, issuing, sending, confirming, importing, creating, deleting, or processing a transaction. A central spinner is not the default for structural page loading. Loading text and `aria-busy`/status semantics must remain understandable without animation.

Skeleton pulse or shimmer must be subtle, inexpensive, and disabled under `prefers-reduced-motion`. Animation is never required to understand that content is loading. Loading, empty, unavailable, error, blocked, success, warning, and neutral states must not collapse into one generic component or imply false zero/healthy data.

### Content and truncation contract

Interface copy should guide an action, explain a decision, prevent an error, explain a consequence, clarify system state, or explain what happens next. Remove decorative claims and generic filler such as “Powerful and intuitive”, “Everything you need”, or “Take control of your business”. Uppercase eyebrow text is acceptable only as a useful operational label.

A page or section title does not need a sentence underneath that merely restates its purpose. Login, Signup, Onboarding, Profile, and Dashboard should keep supporting copy only when it adds a consequence, prerequisite, state explanation, decision context, or next action. Whitespace is preferable to a decorative eyebrow, badge, icon, or replacement sentence.

Critical financial amounts, errors, statuses, operational warnings, ambiguous document references, and important item identifiers must not be silently truncated. Truncation is acceptable only for genuinely secondary information when the full value remains accessible and no decision depends on the hidden content.

### Typography decision boundary

The current application continues to render Inter in this package. Inter is not permanently approved or locked. Typography must be evaluated as a separate controlled design decision covering readability, Portuguese diacritics, dense operational data, numeric clarity, Android rendering, bundle/runtime cost, and light/dark behaviour. IBM Plex Sans is the first planned comparison candidate. Do not replace the global font during unrelated surface work.

### Accessibility engineering target

StockWise targets WCAG 2.2 AA as an engineering quality goal. Do not describe the product as certified, fully compliant, or proven conformant without independent evidence. Every applicable UI change must consider contrast, keyboard access, visible focus, logical focus order, focus restoration, labels, accessible names, semantic headings, forms, error association, touch target sizing, mobile accessibility, colour-independent status, reduced motion, dialog/drawer focus behaviour, accessible authentication, and useful alt text for informative images.

Use native HTML first: `<button>` for actions, `<a>` for navigation, real labels for form controls, and headings in logical order. ARIA supplements correct native semantics when required; it does not repair an avoidable clickable `<div>` or replace native behaviour without reason.

Automated checks are one layer only. The maintained ESLint accessibility rules detect high-confidence JSX/ARIA/native-interaction defects, and the UI-foundations gate prevents new direct status-colour utilities. These checks cannot evaluate full keyboard journeys, focus restoration, responsive reading order, rendered contrast in every state, screen-reader clarity, or WCAG conformance. The quality model is automated checks plus manual keyboard QA plus human UX/accessibility review. Lighthouse, when used, is a regression and diagnostic signal, not proof of conformance.

### Mobile-first behaviour

Mobile is a first-class operating surface, not a compressed desktop layout. Preserve the Android-first contracts in `MOBILE_OPTIMIZATION.md`: meaningful task order, reachable touch targets, wrapped critical content, card/list alternatives where tables are unsuitable, contained scrolling where data comparison genuinely needs it, safe-area and dock clearance, and no hover-only action.

### Frontend Definition of Done

UI work is done, where applicable, when functionality and business logic remain correct; the surface follows StockWise identity; mobile works; required loading, empty, error, success, warning, and destructive states are intentional; semantic tokens are used; keyboard order and focus are usable; labels and accessible names are present; critical content is not hidden by truncation; reduced motion is complete; and no new console error, warning, lint failure, test failure, type error, or build failure is introduced. Static screens do not need invented loading or empty states. Pull requests must state when a checklist item does not apply instead of creating meaningless UI to satisfy it.

## Product Standard

StockWise should feel like a serious modern SaaS product with financial-institution trust. The app is light-first for daily operational work. Dark mode must be equally deliberate, and selected dashboard areas may use richer dark panels when they improve hierarchy and executive scanning.

The UI foundation now favors:

- clear page headers with company, warehouse, and time context
- decision-first metrics with semantic tones and only as much containment as their grouping requires
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

The Dashboard answers what needs attention and what has happened before it offers deeper analysis. Its maintained order is: company and scope; a short attention or first-use section; the three latest governed stock movements; one grouped current-position summary; and then trend or performance drivers only when the selected data can support them. Mobile keeps the same priority and does not stack a desktop widget wall.

A new company is not a set of zero KPIs. When there are no items or operating records, the Dashboard replaces metrics and empty charts with at most three named, role-aware next actions drawn from existing routes. A company with items but no movements or transactions is “setup in progress”, not populated and not complete. A selected period with no completed activity may say “No activity”; it must not imply that missing setup or failed reads are confirmed financial zeroes. No percentage, readiness score, progress ring, or page-visit completion logic is permitted.

Every Dashboard KPI must support a decision, identify its period or current-state scope, and distinguish unavailable evidence from zero. Operational revenue, gross profit, current inventory value, and open orders share one grouped summary rather than requiring a row of independent cards. Low stock, out of stock, missing thresholds, missing cost evidence, and supported negative gross profit belong in the attention queue. Completion rate, average transaction, transaction count, low-stock count, and out-of-stock count are not standalone headline cards; useful counts remain context inside the related metric or action.

The established `get_owner_dashboard` RPC remains authoritative for period performance, inventory summary, product, customer, and trend evidence. Supporting item, warehouse, and latest-movement reads identify first-use state and recent activity without adding a calculation or mutation path. Reads that fail surface a friendly recoverable error while detailed diagnostics stay in development logs; a failed refresh may retain explicitly stale data but never render the backend error as normal user copy.

Structural loading uses `PremiumSkeleton` in Dashboard order: attention list, grouped summary, then supporting detail. Empty states say what is absent and what action is possible; they do not require an illustration or CTA when the current role cannot act. A chart is rendered only with at least two truthful daily points, includes an accessible daily table, uses named series tokens, and keeps gross-profit gaps where cost evidence is incomplete.

Dashboard presentation must preserve the read-only RPC, existing role capabilities, posting logic, COGS logic, settlement anchoring, RLS, and access behavior. It must not introduce a cross-domain attention engine or calculate new finance, stock, production, or Growth Batch rules.

### UX-10G authenticated QA evidence (2026-08-08)

The approved Leny Doçuras company exercised the populated and attention states through the maintained UI. The Dashboard rendered four out-of-stock items, one low-stock item, four open orders, current inventory valuation, and three recent governed movements without treating the empty current sales period as monetary zero. Temporarily changing the existing `OPS-QA Receipt Item` minimum from `1` to `8` changed the Dashboard low-stock signal from `1` to `2`; restoring the minimum to `1` restored the Dashboard signal. No stock quantity, order, sale, finance record, schema, role, or access rule changed.

Browser review covered `360`, `390`, `430`, `820`, and `1440` widths, English and Portuguese, light and dark themes, reduced motion, mobile drawer focus restoration, and a clean authenticated Dashboard refresh with no console error or warning. The Leny membership safely redirected `/onboarding` back to Dashboard; invitation and new-identity states were not manufactured. First-use selection is covered by the source contract and still needs a future safe empty-company fixture for live browser evidence.

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

- Items is register-first. `/items?view=register` is the default review surface and `/items?view=create` is the focused creation workspace; browser history remains meaningful and item profile authority is unchanged.
- Stock Levels is explicitly read-only. It never adds quantities across mixed base units, shows each item base UoM, values on-hand using weighted average cost, and distinguishes healthy, low, out, negative, and minimum-threshold-unconfigured evidence.
- Movements is history-first. `/movements?view=history` is the default ledger and `/movements?view=record&type=receive|issue|transfer|adjust` opens the focused governed posting workspace. The maintained `post_stock_*` RPCs and posting-request idempotency remain authoritative.
- Warehouses uses the same register header, metric, status, loading, and partial-data language. A failed bin read is unavailable evidence, never a confirmed zero.
- Bin filtering is not exposed on Stock Levels until the current stock-level read model exposes bin data to the page.

Movements must stay a register, not another dashboard. It may improve presentation, filtering, loading/error states, and empty states, but it must not manually mutate `stock_levels`, change posting/valuation/POS/purchase logic, or imply a costing-policy change. `stock_movements` remains canonical and `stock_levels` remains derived.

## Page Rhythm Contract

The authenticated shell owns viewport clearance, header offset, safe-area insets, and mobile-dock clearance through `app-main-content`: `16px` on phones, `20px` on tablet widths, and `24px` from desktop widths. `.app-page` owns maximum width, internal vertical flow, and section rhythm only. Page headers own their internal padding; sections own spacing between siblings; cards own their content padding. Ordinary pages must not add compensating top margins or duplicate shell padding.

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
- the completion state shows the selected company, assigned role, entry source, and explicit Dashboard or Company setup actions; ongoing readiness belongs to the Settings setup hub rather than a static onboarding checklist

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

UX-10C uses a quiet editorial Landing: a specific hero, one labelled operating-records illustration, a static purchase-to-review chain, open operation/problem/capability layouts, connected selling and purchasing paths, an implementation timeline, restrained use cases, canonical pricing, purchase-friction FAQ, and compact WiseCore context. It has no floating hero notices, statistic cards, capability marquee, coded pseudo-dashboard, fiscal-marketing section, gradients, orbs, pointer glow, CTA pulse, glare, hover lift, or page-level animation. The repository currently has no suitable maintained current product screenshot; do not fabricate one. A future screenshot must come from an approved environment, contain no sensitive data, and be reviewed for current product accuracy. Landing work must not introduce finance, stock, POS, invoice, settlement, onboarding, authentication, Supabase, migration, or pricing-source logic.

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

## Commercial Workflow Presentation

Commercial pages must not collapse document workflow, stock progress, finance-document state, approval, and settlement into one ambiguous status. Sales Orders and Purchase Orders are operational/commercial records. Issued Sales Invoices and posted Vendor Bills are the legal or financial documents and become the active settlement anchors under the existing backend rules.

Register pages use the shared premium header, bounded metrics, search/filter controls, one principal next action per row, contained desktop tables, and card-first mobile lists. Document amount summaries distinguish original document total, current legal amount, and outstanding amount. Missing canonical state is unavailable evidence, not zero, and user-facing failure states must not instruct operators to run migrations.

Order details may use a compact lifecycle strip for workflow, fulfilment or receipt, finance handoff, and settlement. The strip is explanatory only: it must derive from maintained state views and existing linked-document reads, never invent permission or mutation authority. Purchase receipt and Vendor Bill creation remain independent dimensions.

Foreign-currency creation must expose base, loading, configured, manual, unavailable, and invalid rate states. Base currency may show its fixed `1:1` contract. Foreign currency must never treat a missing or failed rate lookup as trusted `1:1`; a positive finite configured or explicitly reviewed manual rate is required before draft creation.

UX-5 is live from the implementation series `7e0d10a69b374c1b02682e905d259485d3dfdd89` through localization correction `89a3384509ca316533f96d3f5a259bc5b5437b4c`. Commercial registers now keep one principal action, card-first mobile review, explicit amount hierarchy, localized canonical workflow/resolution states, and a compact lifecycle strip. The Page Rhythm Contract remains shell-owned at 16px phone, 20px tablet, and 24px desktop. UX-6 may deepen settlement, cash, bank, and reconciliation workflows, but must preserve the order/document/anchor distinctions established here.

The `/bom` workflow bridge cards now use the shared premium card spacing pattern: icon badge, eyebrow/title/body stack, and separated action zone. Production smoke verified the Landed Cost card remains secondary, Production Runs remains more action-oriented, and the correction is spacing/hierarchy only, not a BOM workflow or posting change.

## Finance Workspaces And Shareable Outputs

Finance workspaces separate three questions: open exposure, posted settlement activity, and controller reconciliation. Exposure prioritizes counterparty, active anchor, current legal amount, settled amount, outstanding amount, due position, and one valid next action. Activity preserves cash and bank evidence after exposure is resolved. Reconciliation keeps the maintained review and exception views authoritative; the frontend does not recreate their formulas.

Cash is a company-base-currency cash book, not a bank account. Bank pages distinguish account operating currency from company-base ledger values. Summary and register reads have independent loading and failure states, so a failed summary or balance never becomes a valid-looking zero. Bank reconciliation requires an explicitly selected statement and keeps book balance, statement closing balance, difference, transaction reconciliation, and statement status distinct.

New finance Excel, PDF, and Print outputs share one typed source model and WiseCore dark-teal/neutral presentation. External advice shows the StockWise company and resolved counterparty, masks bank identifiers, excludes internal notes and raw IDs, and states that StockWise allocation evidence is not bank-issued proof. Excel uses numeric amount cells, frozen/filterable table headers, print setup, and explicit base currency. PDF and Print use the same model, A4 layout, repeated headers where needed, wrapped text, page numbering, and matching totals. Missing optional master data is omitted; an unresolved counterparty blocks external advice rather than producing an anonymous document.

UX-6 is live from implementation `615dd19d889c2d03efb2e6429f0e726c31fd560b`. Optional grouped multi-event advice and a broader bounded counterparty-activity section remain deferred; single-event Remittance Advice and Receipt Allocation Advice plus current filtered reconciliation, cash, bank-ledger, and bank-reconciliation exports are the maintained contract.

## UX-7 Production Workspace Direction

The production routes are register-first and share one workflow-selection explanation:

- Recipes & Assemblies is the simple Recipe-driven stock transformation path and retains Quick Assembly;
- Production Runs is the controlled planned-versus-actual path with preview, frozen material/direct-cost snapshots, posting evidence, and event-specific reversal;
- Growth Batches is group-level biological or agricultural lifecycle tracking, not an individual record, stock item, finance document, or profitability model.

Each selected record exposes one primary action and no more than two immediate secondary actions. Remaining activities belong in a labelled workflow menu or on their source event. Growth Batch detail uses Overview, Materials & Location, Lifecycle, Measurements, Costs, and History & Audit instead of ten equal-weight tabs. Developer future-scope ideas must remain in technical documentation, not disabled operational controls.

Production cost presentation must distinguish current Recipe WAC estimates, draft Production Run preview estimates, frozen posted Production Run costs, Growth Batch memo direct costs, harvested cost, remaining cost, explicit zero, unavailable evidence, and not-applicable evidence. Teal remains action/focus/selection; success, warning, and destructive colors remain semantic.

Production exports inherit the UX-6 company-header, WiseCore palette, numeric Excel, A4 PDF, page-numbering, safe-filename, and shared-source-model rules. Recipe Specification, Production Run Cost Sheet, and Growth Batch Activity & Cost Report are internal operational outputs. Their disclaimers must not imply accounting posting, COGS, fair value, individual identity, or bank/payment evidence.

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

The package replaced `199` explicit maintained-source blue/sky brand literals (`187` Tailwind sky utilities, four then-current landing blue-orb references, three legacy `--sw-blue*` tokens, and five old blue hex literals) with semantic tokens or context-appropriate colours. The final raw count for those blue/sky/legacy literals was zero. Shared corrections covered `IconBadge`, `PremiumStatusBadge`, `PremiumMetricCard`, `MobileQuickActionGroup`, subscription analytics, Tailwind informational tone support, and the former landing product tabs. UX-10C later removed those tabs. Revenue is neutral charcoal in light mode and a light neutral in dark mode; gross margin remains positive green and COGS remains red. The named `--chart-inventory` series now uses the WiseCore mid teal rather than cyan. Standalone Sales Order, Purchase Order, and finance-document print HTML use neutral charcoal text and furniture because generated print documents cannot consume application CSS variables; this remains presentation-only and does not change document wording or fiscal semantics.

Historically, that rollout replaced the Landing's competing blue orb with one restrained deep-teal/charcoal glow. UX-10C supersedes that interim treatment and removes the Landing glow entirely. The unused and unreferenced `src/tokens.css` legacy token file was removed after repository-wide import verification. No logo was regenerated, no Ocean Breeze dependency was installed, and no route, schema, business logic, package identifier, or Sentry configuration changed.

## Neutral surface and state foundation (Phase 1)

The first whole-product UX phase neutralizes the remaining navy environmental styling without reworking route architecture or business workflows. Dark canvas, cards, popovers, sidebars, muted controls, borders, PWA theme colors, landing showcase surfaces, print furniture, and shadows now use black or neutral charcoal. WiseCore teal remains bounded to actions, focus, selection, and controlled brand emphasis.

The shared state foundation consists of `AppLoadingState`, the accessible `PremiumSkeleton`, and `PremiumStatePanel`. These primitives prevent route-loading, empty, error, blocked, success, and neutral states from collapsing into the same generic card treatment. Existing `PremiumEmptyState` call sites retain their API and inherit the shared empty-state semantics. Further page-level adoption belongs to later roadmap phases where the local workflow can be assessed without changing backend-authoritative behaviour.
# POS tax-treatment presentation

Point of Sale review surfaces must show authoritative Subtotal, Tax treatment, Tax, Total to receive, and payment destination before confirmation. A changed cart, company, bin, date, customer, price, quantity, payment destination, bank account, or tax configuration invalidates the preview. Unconfigured state uses restrained warning treatment and role-appropriate guidance. Non-fiscal state says `tax not applied`; it must never use `0%`, `zero-rated`, `exempt`, or fiscal-invoice styling.

Settings keeps the two explicit future-sale choices within the existing commercial-tax section. Non-fiscal selection requires a plain acknowledgement and the legal-obligation disclaimer; this is not a waiver or compliance claim. Sales Order registers/details use a durable restrained non-fiscal badge and keep settlement and stock evidence visible.

Production read-only QA on 2026-07-16 verified the role-aware unconfigured Point of Sale state and the OWNER/ADMIN Settings control at `1440`, `1200`, `820`, and `390`, in light/dark and EN/PT. Totals remain visible without overflow, raw backend-code leakage, console errors, or CSP errors. No production sale or settings mutation was used for visual validation.

## UX-2 Dashboard Performance Cockpit (live)

The dashboard now leads with an operating answer rather than a uniform grid of metrics. Desktop order is operating answer, action needed, performance snapshot, performance drivers, the latest three stock movements, and detailed product performance. Mobile keeps the same evidence but places the daily scope and actions first, with deeper analysis below. The current company, warehouse scope, and active period remain visible without turning the dashboard into a posting surface.

Revenue remains operational Sales Order evidence and COGS remains shipment-linked stock-issue evidence for the same order-item population and period. Daily chart totals must reconcile exactly to their headline totals. Known explicit zero cost is a valid, visibly distinct state; missing shipment cost, service-only rows, and unattributed movement cost are incomplete evidence and must withhold margin rather than becoming zero. Optional Top Client content appears only when a resolved named customer passes the maintained eligibility checks.

The live implementation uses bounded reads over existing tables and adds no dashboard schema, RPC, migration, or authority. Independent core, performance, and optional-customer reads expose loading, partial, unavailable, and stale states without briefly presenting incomplete data as healthy. Production read-only QA covered `1440`, `1200`, `820`, and `390`, light/dark, and English/Portuguese; the cockpit reconciled its live Revenue and COGS totals, displayed no raw translation key or fallback, and required no business-data mutation.

## UX-3 Setup Journey Contract

Onboarding measures workspace entry only. It must never present its completion value as company setup readiness. Once a company is selected, Settings owns the ongoing journey through evidence-backed capability areas, not a universal score or forced sequence.

Every setup surface keeps readiness, authority, and consequence separate. `Ready`, `Needs action`, `In progress`, `Optional`, `Not applicable`, and `Unavailable` describe evidence. `Can manage`, `Can review`, `Read-only`, and ask-role guidance describe the signed-in member. Optional areas use neutral treatment; unavailable reads never become amber missing-data claims.

The setup hub leads the Settings first viewport, keeps core foundation before operational extensions, and uses one supported deep link per action. Query values select a maintained view only and never save, invite, import, or post. Mobile cards retain readable EN/PT copy, visible status text beyond color, practical targets, and the shell dock allowance.

UX-3 production validation completed on 2026-07-19. The final deployment passed at `1440`, `1200`, `820`, and `390`, light/dark, and EN/PT representative routes. A production-only locale fallback discovered during QA was corrected so an explicit stored company language still wins, while the active language control remains effective when no company locale is configured. No universal setup percentage, backend readiness state, schema, role, permission, or business mutation was introduced.

## UX-8 Administration And Compliance Contract

Settings remains the company command centre and groups company identity, operations, communications, documents, people, and platform-managed access by authority and operational effect. Section saves remain local. Weighted average is the only presented live valuation policy; FIFO is explanatory future scope, not a selector. Company users may review entitlement evidence but cannot use Settings as a substitute for Platform Control.

Users is register-first and separates invitation creation from email delivery. One principal row action opens member review; role comparison, disable, removal, and hierarchy blockers remain secondary and explicit. Company roles describe authority inside one company. Platform-admin authority is independent and never follows from OWNER or ADMIN.

Platform Control uses portfolio, activation, selected-company, communication, audit, and isolated danger workflows. Stored subscription state remains separate from effective access. Catalogue MRR and ARR are catalogue indicators, not collected revenue. Operational reset remains alone in the danger section with exact deleted/preserved scope, UUID confirmation, reason, rate limit, and backend audit.

Mozambique Compliance leads with supported-issuance readiness from core identity, settings, and series evidence. Optional histories fail independently. The Fiscal Document Review Workbook is an Excel review aid with an explicit non-SAF-T, non-tax-return, non-submission disclaimer. No universal compliance score, manual next-number control, raw status, or raw storage path belongs in the primary experience.

## UX-9A Conversion, Motion, Setup, And Currency Feedback

Historical UX-9A conversion motion used a logged-out hero pulse and clipped CTA glare. UX-10C supersedes that Landing treatment: the public hero, pricing, and final action are static apart from ordinary control feedback. Authenticated actions, operational alerts, destructive states, finance exceptions, and fiscal warnings remain outside decorative motion.

The Magic UI Interactive Hover Button, Pulsating Button, and Glare Hover sources were reviewed during UX-9A but their registry output was not installed. UX-10C removed the Landing-specific adaptations and their unused effect components; the maintained base Button remains unchanged.

Onboarding feedback communicates the actual asynchronous step without timers or fake progress. Currency feedback is explicitly a conversion preview and saved-rate confirmation, never a transfer, payment, settlement, or accounting result. Price labels use natural `Price`/`Prices` and `Preço`/`Preços`; MZN remains in formatted amounts and every operational currency context where it carries meaning.

The retained workspace loader still has a stable reduced-motion equivalent. UX-10C removed Landing pulse, glare, reveal, drift, pointer-glow, ticker, and preview animation; no Landing information depends on motion.
## UX-9B shell and workspace consistency

UX-9B corrected the desktop sidebar root cause by making the `aside` a sticky `100dvh` flex container with hidden root overflow, a `min-h-0` independently scrolling navigation region, and fixed brand/company/account regions. `AppLayout` remains responsible for header, safe-area, page-edge, and mobile-dock clearance; shared `app-page` variants own width and vertical rhythm.

Items, Stock Levels, and Stock Movements use the compact shared search/filter/action toolbar with natural EN/PT result counts. Currency now uses the maintained page header and metric cards; enabled rows are neutral with a textual active badge rather than a full green success treatment. Monetary revenue-minus-COGS values are labelled Gross profit / Lucro bruto; the percentage remains Gross margin / Margem bruta.

## UX-9C owner cockpit

Dashboard hierarchy is now: page header, compact period/warehouse toolbar, five primary KPIs, secondary indicators, trend, principal actions, product/customer drivers, and inventory links. The full-width Latest Stock Movements section is removed while maintained movement navigation remains.

The analytics canvas retains the shell-owned `app-page--analytics` wide-screen limits. Primary cards use five columns only where space permits, fall to two columns on tablet/phone, and never force a five-card phone row. Custom dates query only after Apply; invalid or empty ranges cannot read. All controls have visible labels and accessible names, unavailable states remain textual, and chart meaning is also summarised in text.

## SVC-1 service workspace

Service Jobs uses the maintained page header, four summary metrics, filterable register, and a full-height detail sheet. The sheet keeps service scope, time, company/customer materials, direct costs, supplier allocations, actual-cost summary, and audit timeline visibly separated. Destructive corrections require a typed reason and remain reversal actions.

Customer-supplied material uses a canonical UoM selector and displays the readable UoM code. Dashboard chart meaning is explicit in both legend and text: Operational sales retains primary colour, COGS uses destructive red, and Gross profit uses success green. Gross margin remains a percentage and is never labelled Gross profit.

## UX-9D landing hero and dashboard trend clarity (historical, Landing superseded by UX-10C)

The UX-9D hero previously reserved a `max-w-4xl` region and conditionally displayed supporting metrics and decorative evidence cards. UX-10C removed the eyebrow, metrics, and floating cards and replaced the hero with a calm text-and-illustration composition. The historical dashboard trend guidance in this section remains applicable to Dashboard only.

Dashboard period headlines and daily points remain one `get_owner_dashboard` result with no client-side replacement totals. The chart description now states that points are daily while headline cards are selected-period totals. Operational sales retains its existing primary series colour, COGS uses `--chart-cogs-line` with a restrained dash, and Gross profit uses the solid `--chart-margin-line`; the former `--success` reference was invalid because that generic token is not defined. Gross margin remains the percentage KPI. Daily details repeats Operational sales, COGS, and supported Gross profit, while unsupported daily profit remains explicitly unavailable.

## UX-10D / UX-10E / UX-10F account journey

Public authentication is an operational entry point, not a second marketing landing page. It uses one direct heading, one concise return-to-work message, the minimum fields required for the selected action, and explicit email-verification and recovery states. Phone remains optional profile contact information and is not collected during account creation or presented as an authentication factor.

Onboarding communicates three truthful stages: confirmed account, company access, and the first operating task. It must not use arbitrary percentages or claim that company creation means the whole operation is ready. Invitation acceptance remains email-bound and explicit. Company creation still uses the existing bootstrap RPC and only asks for the minimum company name. After access exists, the user may open Items, opening-data import, company setup, or authorized team access; this choice is navigation only and is not persisted as company configuration.

Profile separates account identity, active-company context, personal contact details, display preferences, security, company settings, and support. Password controls must describe the action that actually occurs. The maintained Profile security action sends one secure recovery link through the existing authentication flow; it does not render local current/new password fields that are ignored. Company legal, banking, stock, document, and readiness fields remain in company Settings rather than personal Profile.

The shared public-auth shell is deliberately quiet: no gradient backdrop, feature-card stack, hover lift, glow, or marketing badges. Login, onboarding, invitation acceptance, and password recovery retain one visible page heading, native form semantics, visible focus, responsive spacing, and the existing reduced-motion foundation. Authentication, company membership, RLS/RPC, subscription, and activation contracts are unchanged.

## UX-10H authenticated product contract

Authenticated pages use an open heading region by default. `PremiumPageHeader` and `PremiumRegisterHeader` provide hierarchy, evidence, status, and actions without wrapping the page title in an elevated card. Decorative eyebrow props remain source-compatible but are not rendered. A card is still appropriate where the content forms one meaningful operational group.

Shared table and mobile-register failures are error states, not empty states. Structural reads use the maintained skeleton architecture; an empty state appears only after a successful read with no applicable records. Global Search and Notifications use labelled controls, explicit loading/empty/error states, semantic status text plus icons, valid destinations, and row/divider composition instead of a card per result.

The full route-by-route audit, safe fixes, and deferred domain inventory are maintained in [`docs/ui-ux/UX-10H-AUTHENTICATED-PRODUCT-AUDIT.md`](ui-ux/UX-10H-AUTHENTICATED-PRODUCT-AUDIT.md). Finance, settlement, production, Growth Batch, Service Job, Landed Cost, subscription, and access-control changes require their own domain-authority package; visual simplification must never erase authoritative state or posting evidence.

## UX-11A finance documents and settlements

Finance screens preserve professional information density while making the governing record and amount unambiguous.

- Lead document detail with its real reference, counterparty context, lifecycle state, total, open or settled amount, and operational dates. Generic headings and decorative finance eyebrows do not replace document identity.
- Draft invoices and vendor bills are preparation records. They must not be presented as issued or posted settlement anchors, overdue balances, or open receivables or payables. Settlement state begins only after the existing issue or post workflow establishes the finance document as the anchor.
- Show one strong lifecycle treatment in the primary viewport. Repeat state only where it is required to interpret a distinct section or action; never use colour alone.
- Preserve backend-authoritative currency, precision, totals, adjustments, settled amounts, and outstanding amounts. Presentation code must not recreate accounting calculations.
- Align financial numbers with tabular numerals and keep critical references and amounts fully available on mobile. Registers may use tables on larger screens but need a deliberate compact mobile representation.
- Use open summary bands, definition lists, rows, and dividers before adding metric cards. Complex audit evidence may retain containers where the boundary is meaningful.
- Issue, post, settle, void, reverse, and delete actions retain governed authority and explain real consequences before completion. Output actions such as print and download remain secondary.
- Structural document and register loading uses the shared skeleton contract. Empty and error states distinguish no records, filtered results, unavailable evidence, and insufficient access without inventing zero values.

The implementation record and scoped QA evidence are maintained in [`docs/ui-ux/UX-11A-FINANCE-DOCUMENTS-SETTLEMENTS.md`](ui-ux/UX-11A-FINANCE-DOCUMENTS-SETTLEMENTS.md).
