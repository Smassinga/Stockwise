# StockWise Product UX Audit - July 2026

Date: 2026-07-16

Release: `53a36065f39cea971abb9b48f7c7b72a7ab03584`

Scope: UX Phase 1 dark-surface reset, shared state foundation, and whole-product audit

## 1. Executive Summary

StockWise has a credible operational product foundation: broad inventory and finance coverage, backend-authoritative posting, responsive register patterns, guarded reversals, English and Portuguese localization, and a consistent StockWise product identity. The main visual defect was the dark theme's navy and blue-gray environmental cast. Shared loading, empty, error, blocked, and success states also lacked a sufficiently explicit semantic contract.

UX Phase 1 corrected those system-level defects without changing data, permissions, routes, calculations, or workflow behavior. The live application now uses a neutral black and charcoal dark hierarchy, retains the WiseCore teal family for interaction and focus, and preserves red, amber, and positive green for their established meanings. The root loading fallback and shared premium state primitives now provide accessible, distinguishable states.

The broader audit found no P0 defect. Remaining work is primarily information architecture, workflow compression, localization completeness, and consistency across domain-specific detail pages. Those findings are sequenced as UX-1 through UX-10 rather than being mixed into this release.

## 2. Current Product Strengths

- StockWise remains a coherent product brand while WiseCore Technologies, Lda. remains the owner and promoter.
- Operational routes cover inventory, purchasing, sales, finance, production, Growth Batches, compliance, setup, and platform administration.
- Backend-authoritative posting and event-specific reversals provide stronger trust than presentation-only demos.
- Premium registers already support desktop comparison tables and Android-first review cards.
- Light and dark themes, English and Portuguese, and responsive layouts are maintained in one application architecture.
- Finance charts explain their source and distinguish revenue, COGS, gross margin, and inventory.
- Empty states generally point to a next action instead of presenting decorative placeholders.
- Production and Growth Batch flows expose immutable history and reversal evidence.

## 3. Dark-Theme Defect Summary

The initial maintained source scan covered 214 TypeScript, TSX, and CSS files. It found 54 `slate-*` utility occurrences, 13 navy HSL literals, 48 navy RGB/shadow literals, and 55 dark blue/navy-like hex occurrences. Direct `blue-*`, `sky-*`, and `cyan-*` utility counts were already zero at the release baseline, but blue-gray and navy were still embedded in shared surfaces, overlays, shadows, landing treatments, and document presentation.

The final maintained source scan reports zero `blue-*`, `sky-*`, `cyan-*`, `slate-*`, navy HSL, and navy RGB/shadow occurrences. Two dark-teal hex occurrences remain in self-contained Sales Order and Purchase Order print HTML. Both are the approved WiseCore `#014558` dark teal, not generic blue, and cannot consume runtime CSS variables.

## 4. Surface-Role Map

| Role | Light mode | Dark mode | Semantic boundary |
| --- | --- | --- | --- |
| App canvas | near-white neutral | black-neutral | environmental surface only |
| Sidebar | white/neutral | deepest neutral black | navigation context |
| Routine card | white | charcoal | grouped operational content |
| Elevated surface | white | lighter charcoal | dialogs, sheets, menus, popovers |
| Muted region | light neutral | restrained neutral gray | passive groups and disabled/read-only context |
| Primary action | WiseCore dark teal | moderated bright teal | action, selection, focus, active tabs |
| Informational | charcoal/neutral | light neutral | factual state, not success |
| Success | positive green | positive green | completed or healthy state only |
| Warning | amber | amber | review or blocked prerequisite |
| Error/destructive | red | red | failure, negative, destructive action |

## 5. Information Architecture Map

The authenticated shell currently exposes four groups:

- Operations: Dashboard, Point of Sale, Items, Recipes & Assemblies, Production Runs, Growth Batches, Stock movements, Stock Levels, Warehouses.
- Commercial & finance: Orders, Sales Invoices, Mozambique Compliance, Vendor Bills, Settlements, Transactions, Cash, Banks, Landed Cost, Reports.
- Setup: Customers, Suppliers, Users, Currency, UOM, Imports, Settings.
- Platform: Platform Control.

The grouping is understandable, but the desktop navigation is long and the distinction between operational registers, setup, and finance resolution can require domain knowledge. UX-1 should refine labels, route prioritization, and mobile reachability without changing permissions or route contracts.

## 6. Route Inventory

| Area | Routes audited or inventoried | Primary job |
| --- | --- | --- |
| Public/auth | `/`, `/login`, `/auth/callback`, `/update-password`, `/accept-invite` | marketing, authentication, recovery, invitation |
| Company entry | `/onboarding`, `/company-access`, `/activation` | company setup and access state |
| Operations | `/dashboard`, `/operator`, `/items`, `/movements`, `/stock-levels`, `/warehouses` | daily control and inventory evidence |
| Commercial | `/orders`, `/sales-invoices`, `/sales-invoices/:id`, `/vendor-bills`, `/vendor-bills/:id` | order and document lifecycle |
| Finance | `/settlements`, `/transactions`, `/cash`, `/banks`, `/banks/:bankId`, `/landed-cost`, `/reports` | exposure, ledger, and reconciliation |
| Production | `/bom`, `/production-runs`, `/growth-batches` | recipes, controlled production, biological/agricultural lifecycle |
| Setup/admin | `/customers`, `/suppliers`, `/users`, `/users/roles`, `/currency`, `/uom`, `/settings/uoms`, `/setup/import`, `/settings` | master data and company configuration |
| Compliance/platform | `/compliance/mz`, `/platform-control` | fiscal configuration and platform administration |
| Utility | `/profile`, `/search` | account and cross-domain lookup |

## 7. Workflow Journey Findings

- Dashboard: strong operating-answer framing, but the full page remains vertically dense. UX-2 should sharpen the first viewport and progressively disclose deeper analytics.
- Onboarding/setup: invite acceptance, company creation, compliance, opening data, and user setup are individually clear but do not yet form one persistent setup journey. UX-3 should connect existing routes without adding backend state.
- Items/stock: premium register patterns are mature. UX-4 should standardize detail actions, loading states, and inventory evidence across Items, Stock Levels, and Movements.
- Sales/purchasing: governed document state is strong, but creation, issuance/booking, settlement anchor transitions, and correction paths require careful explanation. UX-5 and UX-6 should simplify action hierarchy without changing finance authority.
- Cash/bank/settlements: the model is credible and auditable, but operators must understand which SO, PO, SI, or VB is the active anchor. UX-6 should make anchor and outstanding state more immediate.
- Recipes/production/Growth Batches: operational depth is a product strength. Dense detail tabs, long histories, and mixed terminology require focused UX-7 work.
- Settings/platform/compliance: real backed functions are present, but administrative density and role distinctions need UX-8 consistency.

## 8. Shared Component Findings

UX Phase 1 corrected shared components before page-specific styling:

- `AppLoadingState` provides an accessible root loading skeleton.
- `PremiumSkeleton` announces loading politely and respects reduced motion.
- `PremiumStatePanel` differentiates empty, error, blocked, success, and neutral states.
- `PremiumEmptyState` retains existing call-site compatibility while using the shared semantics.
- Dialog, alert-dialog, sheet, popover, input, textarea, select, button, and skeleton primitives now use neutral surfaces and visible focus treatment.
- `AppLayout`, theme/locale controls, brand lockup, notifications, finance history cards, and platform analytics no longer leak navy/slate defaults.

The remaining component concern is consistency of route-specific loading and error branches that still render literal text rather than the shared state layer.

## 9. Loading, Empty, And Error State Findings

- Root route loading changed from generic text to `AppLoadingState`.
- Loading skeletons now use `role=status`, polite live regions, stable dimensions, and motion-safe animation.
- Empty and error are no longer the same shared visual state.
- Blocked uses amber warning semantics; success remains green; neutral facts remain neutral.
- Six literal loading references remain in maintained route code. They are not a release blocker, but UX-9 should migrate meaningful route-level branches to the shared state contract.
- Production inspection found no fallback page or raw backend-code leakage on the audited routes.

## 10. Accessibility Findings

- Verified contrast: dark primary `#00C98F` on `#014558` is 4.89:1; light primary `#014558` on white is 10.53:1.
- Focus ring contrast is 9.46:1 in dark mode and 3.48:1 in light mode against the surrounding surface.
- Dark body text contrast is 18.16:1; light body text contrast is 16.25:1.
- Focus rings retain an offset and remain visible on neutral canvases.
- Disabled and read-only controls remain visually distinct from active controls.
- Status meaning is paired with copy, labels, icons, or position rather than color alone.
- Chart series use labels and markers in addition to color.
- Remaining accessibility work belongs in UX-9: systematic keyboard traversal, screen-reader flow, reduced-motion coverage, and localized accessible-name completeness.

## 11. Responsive Findings

Production checks covered 14 authenticated routes at `1440`, `1200`, `820`, and `390` in light and dark mode. Public/auth checks were also completed locally at the same widths. Document-level horizontal overflow was zero throughout.

Items, Stock Levels, and Movements expose intentionally off-canvas desktop navigation controls at phone width, but the document width remains stable and the mobile content does not escape the viewport. Dense registers continue to use contained table scrolling or mobile card alternatives. No clipped dialog, escaped action row, fallback, or unreadable dark surface was observed in the inspected states.

## 12. Localization Findings

English and Portuguese theme, navigation, public/auth, and representative authenticated routes were checked. UX-1 localizes the complete shell and authenticated route-title map, including `Execuções de Produção`, `Lotes de Crescimento`, and the distinct Sales/Purchase order workspaces. Mixed terminology that remains inside page bodies is established localization debt assigned to the relevant domain package and UX-9.

No new missing translation key or raw package backend code was observed.

## 13. Investor And Demo Credibility Findings

StockWise can demonstrate real operational breadth, governed finance and stock evidence, production lifecycle control, and responsive enterprise workflows. The neutral dark system materially improves perceived discipline and removes the previous template-like navy cast.

The main demo risk is narrative density: a first-time viewer can see many capable routes before understanding the primary operating loop. UX-10 should prepare a truthful guided demonstration using existing data and workflows, without fabricated customers, metrics, or product claims.

## 14. DevTools Findings

- Production console errors: 0.
- Production console warnings attributable to this package: 0.
- CSP errors: 0.
- React fallback activations: 0.
- Raw backend-code matches on audited visible route content: 0.
- Failed required brand asset observed during final checks: 0.
- No deliberate Sentry event was generated. Normal page loads produced no browser error attributable to the release; direct Sentry issue-count verification was outside the available browser evidence.

## 15. P0/P1/P2/P3 Finding Register

| ID | Severity | Route/component | User impact | Evidence | Status | Package |
| --- | --- | --- | --- | --- | --- | --- |
| UXF-01 | P1 | global tokens, shell, landing, overlays | dark mode looked navy/template-like and weakened WiseCore identity | 54 slate, 13 navy HSL, 48 navy RGB, 55 navy-like hex baseline hits | corrected | UX-0 |
| UXF-02 | P1 | `App.tsx`, loading/state primitives | generic loading and ambiguous state feedback reduced trust | root text fallback and shared state review | corrected | UX-0 |
| UXF-03 | P2 | dialog, sheet, popover, forms | elevated surfaces and focus could inherit environmental tint | primitive diff and contrast checks | corrected | UX-0 |
| UXF-04 | P2 | Dashboard charts | cyan inventory and brand-blue revenue semantics competed with finance meaning | token and chart consumer review | corrected | UX-0 |
| UXF-05 | P2 | authenticated shell/navigation | long route list increases scanning and discovery cost | four groups and 30+ navigation destinations | corrected | UX-1 |
| UXF-06 | P2 | `/dashboard` | long vertical cockpit dilutes first-viewport operating answer | production desktop/mobile inspection | deferred | UX-2 |
| UXF-07 | P2 | `/settlements`, `/cash`, `/banks`, document detail | finance-anchor and correction logic is accurate but cognitively demanding | route and maintained copy review | deferred | UX-6 |
| UXF-08 | P2 | `/production-runs`, `/growth-batches` | dense histories/tabs and mixed terminology slow scanning | production PT navigation and route review | deferred | UX-7/UX-9 |
| UXF-09 | P2 | `/onboarding`, `/settings`, `/setup/import`, `/users` | setup steps are clear individually but not one continuous journey | route and setup-map review | deferred | UX-3 |
| UXF-10 | P3 | Items, Stock Levels, Movements | shared register quality is strong, but detail/action consistency can improve | desktop table and mobile-card review | deferred | UX-4 |
| UXF-11 | P3 | route-level loading branches | six literal loading references bypass the full shared state treatment | final source search | deferred | UX-9 |
| UXF-12 | P3 | icon system/navigation | Lucide/Phosphor split is intentional but needs a future recognisability audit | `docs/icon-system.md` and imports | navigation corrected; broader audit deferred | UX-1/UX-9 |
| UXF-13 | P3 | route metadata and PT labels | some domain names/page titles remain English in Portuguese mode | production PT sample | shell and route metadata corrected; page bodies deferred | UX-1/UX-9 |
| UXF-14 | P3 | cross-product demo journey | breadth is credible but first-time narrative is not curated | route inventory and landing/app comparison | deferred | UX-10 |

Finding totals: P0 `0`, P1 `2`, P2 `7`, P3 `5`.

## 16. Findings Corrected In This Package

- Replaced navy/blue-gray/slate environmental styling with neutral surface tokens.
- Made light and dark surface roles explicit for canvas, sidebar, cards, popovers, dialogs, sheets, and muted groups.
- Reserved WiseCore teal for action, focus, selection, and approved brand emphasis.
- Replaced blue/navy shadow literals with neutral black shadows.
- Corrected revenue, COGS, gross-margin, and inventory chart semantics.
- Added an accessible shared root loading state.
- Unified loading, empty, error, blocked, success, and neutral shared states.
- Improved shared form focus, disabled, and read-only presentation.
- Removed the competing blue landing glow and retained a controlled teal/charcoal treatment.
- Preserved StockWise product identity and WiseCore owner attribution.

## 17. Findings Intentionally Deferred

- Navigation regrouping, route prioritization, and mobile destination hierarchy.
- Dashboard content reduction or data-model changes.
- Persistent onboarding/setup progress state.
- Finance workflow restructuring or new reconciliation behavior.
- Production/Growth Batch information architecture changes.
- Complete Portuguese terminology and route-title audit.
- Systematic keyboard/screen-reader audit across all dialogs and dense workflows.
- Investor/customer demonstration choreography.

## 18. Recommended Implementation Packages

| Package | Scope and routes | Shared components | Behavior to preserve | Dependencies | Validation | Risk | Migration | Finance regression | Production mutation smoke |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UX-0 Dark theme and shared surface system | global shell, public/auth, all routes | tokens, overlays, forms, loading/state primitives | all current workflow and state semantics | none | static, build, local 288/288, production visual matrix | medium visual | no | required | no |
| UX-1 App shell and navigation | authenticated shell and all route entry points | `AppLayout`, mobile drawer, navigation groups, search | permissions, routes, company context, sign-out | UX-0 | keyboard/mobile route reachability, EN/PT, visual matrix | medium | no | targeted/full if code paths change | no |
| UX-2 Dashboard operating cockpit | `/dashboard` | register header, metric cards, charts, quick actions | current queries, date windows, revenue/COGS wording | UX-0/UX-1 | data reconciliation plus responsive visual QA | medium | not expected | required | read-only only |
| UX-3 Onboarding and setup journey | `/onboarding`, `/settings`, `/setup/import`, `/users`, `/compliance/mz` | progress/navigation state, setup cards, forms | invitations, roles, settings RPCs, access control | UX-1 | local invitation/setup regression, EN/PT, mobile | high | only if separately approved | required | controlled only if backend state is added |
| UX-4 Items, Stock Levels, and Movements | `/items`, `/stock-levels`, `/movements`, `/warehouses` | premium registers, filters, mobile cards, state panels | stock authority, WAC, posting, item edit limits | UX-0/UX-1 | local inventory regression and responsive register QA | medium | no expected | required | no mutation needed for visual release |
| UX-5 Sales and purchasing workflows | `/orders`, `/sales-invoices`, `/vendor-bills` | form sections, action hierarchy, timeline cards | tax, issuance/booking, immutability, finance anchors | UX-1/UX-4 | full finance regression, legal-output comparison, EN/PT | high | no expected | required | controlled only after explicit authorization |
| UX-6 Invoice, bill, settlement, cash, and bank workflows | document detail, `/settlements`, `/cash`, `/banks` | finance chain/timeline, state panels, dialogs | governed RPCs, idempotency, outstanding, anchor transitions | UX-5 | full finance regression, replay/local authority tests | high | no expected | required | controlled settlement smoke only if authorized |
| UX-7 Recipes, Production Runs, and Growth Batches | `/bom`, `/production-runs`, `/growth-batches` | detail tabs, timelines, mobile action groups | posting, frozen cost, event-specific reversal, lifecycle rules | UX-1/UX-4 | full regression, EN/PT, local fixtures, responsive QA | high | no expected for presentation | required | no unless separately authorized |
| UX-8 Settings, users, Platform Control, and compliance | `/settings`, `/users`, `/platform-control`, `/compliance/mz` | setup map, role/status panels, admin registers | membership authority, subscription/access control, fiscal rules | UX-1/UX-3 | role matrix, EN/PT, responsive/admin QA | high | no expected | required | no |
| UX-9 Accessibility, localization, motion, and final consistency | all maintained routes | focus, live regions, state panels, locale metadata | all behavior; reduced-motion and wording boundaries | UX-1 through UX-8 | keyboard, screen reader, contrast, EN/PT, motion, visual matrix | medium | no | required for shared runtime changes | no |
| UX-10 Investor and customer demonstration closeout | landing plus approved read-only product journey | guided copy, route choreography, evidence checklist | truthful data and product claims; no fabricated records | UX-1 through UX-9 | production read-only walkthrough, console/CSP/Sentry review | low/medium | no | not for docs-only work | no business mutation |

## 19. Validation Evidence

- Local migrations: `44`, latest `20260712230118_fix_canonical_sales_order_finance_state.sql`.
- Static gates: migration check, TypeScript/React lint, CSS variable check, CSS class check, production build, and `git diff --check` passed.
- Local finance regression: `288/288` passed against positively verified `http://127.0.0.1:54321`; duration `111.265s`.
- Implementation commit: `53a36065f39cea971abb9b48f7c7b72a7ab03584`.
- Validation: run `29471866754`, job `87536464288`, conclusion `success`.
- Isolated finance regression: run `29471901431`, job `87536564350`, `288/288`, ephemeral loopback stack, cleanup passed, no success artifact.
- Vercel: deployment `dpl_5PdnDGS1BRs5MfybMENNenjZyj8K`, Production/Ready, serving the implementation commit on `stockwiseapp.com` and `www.stockwiseapp.com`.
- Production authenticated routes: `/dashboard`, `/items`, `/stock-levels`, `/movements`, `/orders`, `/sales-invoices`, `/vendor-bills`, `/settlements`, `/cash`, `/banks`, `/settings`, `/platform-control`, `/production-runs`, `/growth-batches`.
- Production widths: `1440`, `1200`, `820`, `390`; themes: light and dark.
- Portuguese production sampling: Dashboard plus Items, Settlements, Cash, Banks, Settings, Platform Control, Production Runs, and Growth Batches; local public/auth EN/PT checks covered landing, login, sign-up, password recovery, and password update.
- Production document overflow, fallback, raw backend-code, console-error, and CSP-error counts: `0`.
- No schema, hosted database, business-data, or Sentry configuration mutation was required.

## 20. Remaining Risks

- Not every destructive, blocked, reversed, immutable, and error state was deliberately recreated in production; those remain covered by maintained local regression and prior controlled rollout evidence.
- Detail routes without a safe preselected record were audited through source/shared components and register entry points rather than by mutating production data.
- Sentry issue-count access was not used; the release generated no deliberate event, and no browser console error attributable to normal page loading was observed.
- Portuguese domain terminology and route metadata remain partially mixed.
- The sidebar breadth and dashboard density still require focused design work rather than cosmetic changes.
- The two remaining dark-teal literals are intentional print-document exceptions and must be reviewed if print rendering is redesigned.

## 21. UX-1 App Shell And Navigation Baseline

The 2026-07-16 UX-1 review started from commit `58ac56d1965f0fc8f5953e98af88a47f7fc5b6a5`, with 44 migrations and no route, permission, workflow, or database change pending. `App.tsx` declares 45 concrete route patterns plus the wildcard fallback. The authenticated shell directly listed 26 ordinary company destinations and one conditional Platform destination in four broad groups. The mobile dock showed Dashboard, Point of Sale, the undifferentiated Orders workspace, Items, and More; the More drawer repeated the four desktop groups.

Evidence confirmed the following UX-1 findings:

- one Commercial & finance group mixed sales, purchasing, ledgers, compliance, landed cost, and reporting;
- Customers and Suppliers were separated from their daily Sales and Purchasing context;
- the single Orders item could not distinguish the existing `tab=sales` and `tab=purchase` workspaces;
- `/users/roles` was guarded and routable but not directly discoverable;
- duplicate Lucide meanings included Receipt for invoices and transactions, Users for users and customers, and ShieldCheck for compliance and Platform Control;
- active matching used only the pathname, so a query-tab destination could not express its actual state;
- route metadata remained English for authenticated routes in Portuguese mode;
- the mobile drawer scrolled and locked body scroll, but lacked explicit modal semantics, Escape handling, focus containment, and focus restoration;
- company and user context were present but visually compressed into one account panel, and role codes were formatted rather than localized.

No unauthorized-route flash was found. Membership and company-access guards resolve before `AppLayout` mounts, Users visibility continues to use `CanManageUsers`, and Platform Control starts hidden until the existing platform-admin status call resolves. Blocked-company and unresolved-access states remain outside the authenticated shell.

## 22. UX-1 Route Inventory

This inventory records actual route contracts. `company shell` means authenticated user, active membership, and enabled company access. Platform authority and MANAGER+ user-management authority remain the existing guards; navigation does not replace them.

| Route pattern | EN / PT title or entry | IA or direct visibility | Existing guard, query, and active-parent rule |
| --- | --- | --- | --- |
| `/` | StockWise landing | public, not app navigation | public |
| `/login` | Sign In / Iniciar Sessão | public account entry | public-only |
| `/auth` | Login alias | not listed | redirects to `/login` |
| `/auth/callback` | Signing In / A iniciar sessão | not listed | public callback |
| `/update-password` | Update Password / Actualizar Palavra-passe | not listed | public recovery entry |
| `/accept-invite` | Accept Invitation / Aceitar Convite | not listed | public invitation entry |
| `/onboarding` | Company Setup / Configuração da Empresa | not listed | authenticated; shown when membership is unresolved or absent |
| `/company-access` | Company Access / Acesso da Empresa | not listed | authenticated membership; blocked-company destination |
| `/activation` | Verified Activation / Activação Verificada | not listed | authenticated membership; existing activation authority |
| `/platform-control` | Platform Control / Controlo da Plataforma | Platform, desktop and More only when authorized | platform-admin guard; never activates company Settings |
| `/dashboard` | Dashboard / Painel | Overview; desktop, dock, More | company shell; exact active parent |
| `/operator` | Point of Sale / Ponto de Venda | Overview; desktop, dock, More | company shell; existing POS route authority unchanged |
| `/items` | Items / Artigos | Inventory; desktop, Stock dock entry, More | company shell; exact active parent |
| `/movements` | Stock Movements / Movimentos de stock | Inventory; desktop and More | company shell; movement history meaning |
| `/warehouses` | Warehouses / Armazéns | Inventory; desktop and More | company shell |
| `/stock-levels` | Stock Levels / Níveis de Stock | Inventory; desktop and More | company shell; current quantity meaning |
| `/setup/import` | Opening Data / Dados Iniciais | Inventory, lower frequency; desktop and More | company shell; existing import behavior unchanged |
| `/orders` | Sales Orders / Encomendas de Venda or Purchase Orders / Ordens de Compra | Sales and Purchasing; Orders dock aggregate | `tab=sales` selects Sales; the maintained default and link use `tab=purchase`; `orderId` remains unchanged |
| `/orders/sales/:orderId` | legacy Sales Order workspace | not directly listed | existing redirect to `/orders?tab=sales&orderId=...` |
| `/orders/purchase/:orderId` | legacy Purchase Order workspace | not directly listed | existing redirect to `/orders?tab=purchase&orderId=...` |
| `/sales-invoices` | Sales Invoices / Faturas de venda | Sales; desktop and More | company shell; detail routes activate this parent |
| `/sales-invoices/:invoiceId` | Sales Invoice Details / Detalhes da Fatura de Venda | not directly listed | company shell; title never exposes UUID |
| `/customers` | Customers / Clientes | Sales; desktop and More | company shell |
| `/vendor-bills` | Vendor Bills / Faturas de fornecedor | Purchasing; desktop and More | company shell; detail routes activate this parent |
| `/vendor-bills/:billId` | Vendor Bill Details / Detalhes da Fatura de Fornecedor | not directly listed | company shell; title never exposes UUID |
| `/suppliers` | Suppliers / Fornecedores | Purchasing; desktop and More | company shell |
| `/landed-cost` | Landed Cost / Custo de Importação | Purchasing; desktop and More | company shell |
| `/bom` | Recipes & Assemblies / Receitas e Montagens | Production; desktop and More | company shell |
| `/production-runs` | Production Runs / Execuções de Produção | Production; desktop and More | company shell; existing optional `bomId` remains unchanged |
| `/growth-batches` | Growth Batches / Lotes de Crescimento | Production; desktop and More | company shell; distinct optional lifecycle workspace |
| `/settlements` | Settlements / Liquidações | Finance; desktop and More | company shell; existing ADMIN+ posting authority remains inside workflow |
| `/cash` | Cash / Caixa | Finance; desktop and More | company shell; existing finance authority unchanged |
| `/banks` | Banks / Bancos | Finance; desktop and More | company shell; detail routes activate this parent |
| `/banks/:bankId` | Bank Details / Detalhes do Banco | not directly listed | company shell; title never exposes UUID |
| `/transactions` | Transactions / Transacções | Finance; desktop and More | company shell; combined ledger meaning |
| `/reports` | Reports / Relatórios | Finance; desktop and More | company shell |
| `/compliance/mz` | Mozambique Compliance / Conformidade em Moçambique | Finance; desktop and More | company shell; fiscal readiness, not Platform Control |
| `/users` | Users / Utilizadores | Administration when MANAGER+ | company shell plus `CanManageUsers`; exact active item |
| `/users/roles` | Roles / Funções | Administration when MANAGER+ | same existing guard; distinct from Users active state |
| `/currency` | Currency / Moeda | Administration; desktop and More | company shell |
| `/uom` | Units of Measure / Unidades de Medida | Administration; desktop and More | company shell; canonical navigation entry |
| `/settings/uoms` | Units of Measure / Unidades de Medida | not directly duplicated | existing alias activates Units of Measure, not Settings |
| `/settings` | Settings / Definições | Administration; desktop and More | company shell; exact active item |
| `/profile` | Profile / Perfil | personal utility | company shell; not a primary route |
| `/search` | Search / Pesquisa | header utility | company shell; existing `q` query remains unchanged |

## 23. UX-1 Implemented Information Architecture

The consolidated navigation model contains 29 definitions in eight ordered groups. Platform is conditional, and Users plus Roles retain their existing MANAGER+ visibility. Ordinary OPERATOR and VIEWER users therefore see 26 company destinations; MANAGER, ADMIN, and OWNER users see 28; an independently authorized platform admin sees the separated Platform destination in addition to the routes available through their company role.

1. Overview: Dashboard, Point of Sale.
2. Sales: Sales Orders, Sales Invoices, Customers.
3. Purchasing: Purchase Orders, Vendor Bills, Suppliers, Landed Cost.
4. Inventory: Items, Stock Levels, Stock Movements, Warehouses, Opening Data.
5. Production: Recipes & Assemblies, Production Runs, Growth Batches.
6. Finance: Settlements, Cash, Banks, Transactions, Reports, Mozambique Compliance.
7. Administration: Users, Roles, Currency, Units of Measure, Settings.
8. Platform: Platform Control, visible only after existing platform-admin authority resolves.

The mobile dock remains capped at five controls: Dashboard, POS, Orders, Stock, and More. Orders is an aggregate mobile entry into the existing shared workspace; query-aware Sales and Purchase links remain distinct in More. Stock opens Items; Stock Levels and Movements remain explicit in More. More opens the existing drawer, now using the desktop information architecture, current-company context, localized user context, profile/language/sign-out utilities, internal scrolling, body-scroll lock, Escape close, focus containment, and trigger focus restoration.

Active route state now combines `aria-current`, font weight, filled selection, and a visible shape indicator. Query matching distinguishes Sales from Purchase; bank, invoice, and bill detail routes activate their parent; `/settings/uoms` activates Units of Measure; Users does not remain active on Roles; and Platform Control never activates company Settings. The actual singular `tab=purchase` contract is preserved.

Lucide remains the only navigation/control icon system. Navigation icons inherit `currentColor`; duplicated meanings were replaced with workflow-specific icons, and Platform Control uses a system-administration icon distinct from fiscal compliance and company Settings. Phosphor remains unchanged for decorative and premium illustration.

## 24. UX-1 Validation And Deferrals

Local implementation review confirmed one React root, unchanged route declarations and guards, no new dependency, no package-lock change, and no database or business-logic change. The credential-free production build and query/detail active-state matrix passed. The complete local finance regression passed `288/288` against `http://127.0.0.1:54321` in `126.935s` of Node test time.

Production rollout evidence for 2026-07-16:

- implementation commit `75001f745ad4023a83724aafdae96934653fc450`;
- Validation run `29497048907`, job `87616372190`, conclusion `success`;
- isolated finance run `29497119715`, job `87616614335`, CLI `2.109.1`, 44 migrations through `20260712230118`, `288/288`, cleanup successful, no success artifact;
- Vercel deployment `dpl_7QiigAx7oDKRxVQZdQfUVa7TZMpN`, Production/Ready, serving the implementation commit through `stockwiseapp.com` and the redirecting `www.stockwiseapp.com` alias;
- authenticated read-only checks at `1440`, `1200`, `820`, and `390`, covering Portuguese/dark and English/light representative states;
- 22 reached destinations: Dashboard, Point of Sale, both Orders tabs, Items, Stock Levels, Movements, Sales Invoices, Vendor Bills, Settlements, Cash, Banks, Recipes & Assemblies, Production Runs, Growth Batches, Users, Roles, Settings, Mozambique Compliance, Platform Control, Search, and Profile;
- query matching proved Sales and Purchase mutually exclusive in grouped navigation, while the mobile Orders control remains an intentional aggregate workspace indicator;
- mobile More proved body-scroll lock, the eight grouped sections, safe drawer scrolling, Escape close, and focus restoration to the invoking More control;
- page-level overflow, fallback, console error/warning, CSP error, and missing required shell asset counts were `0`;
- English and Portuguese group, route, utility, accessible-name, and browser-title checks passed; no raw translation key appeared;
- production role evidence covered the authenticated company administrator who is also an authorized platform administrator. Ordinary and limited-role visibility was verified from the unchanged route guards and navigation filter, not by impersonating those roles in production;
- no safe detail record link was available in the inspected Sales Invoice, Vendor Bill, or Bank registers, so detail-parent activation remains proven by the local active-state matrix and source review rather than a production detail navigation;
- no production business record, schema, permission, route, workflow, Sentry setting, or hosted database state was changed.

UXF-05 is addressed by workflow grouping and daily-route priority. The navigation portion of UXF-12 is addressed by the Lucide mapping. UXF-13 is addressed for shell labels and route metadata; the complete page-body terminology audit remains UX-9. UXF-14 is improved by making Sales, Purchasing, Inventory, Finance, Production, and Administration legible in the shell, while a guided customer/investor demonstration remains UX-10. UX-2 through UX-10 retain their documented order and scope.
# P1 interruption before UX-2: POS tax applicability

The production POS blocker is closed. The live correction adds a role-aware unconfigured state, authoritative tax-inclusive review totals, explicit configured/non-fiscal treatment, future-only company Settings, durable Sales Order visibility, EN/PT copy, and responsive review/success states. It does not reopen UX-1 or redesign the POS workflow. Read-only production QA passed Point of Sale and Settings at `1440`, `1200`, `820`, and `390` in light/dark and EN/PT with no overflow, raw backend code, console error, or CSP error; no production sale or tax-mode mutation was performed. The planned UX-2 through UX-10 order now resumes unchanged.

## 25. UX-2 Dashboard Operating Cockpit Rollout

UX-2 began from commit `81db227d23fc05b3b81b14eedab9d1031b36dc77` with 45 migrations and no pending schema, route, dependency, workflow, or authority change. The initial dashboard had credible operating evidence but diluted the first-viewport answer through a long, uniformly weighted collection of metrics and analytics. Revenue and COGS were already grounded in operational Sales Orders and shipment-linked issue movements; the package retained that authority and reconciled period, order, line, movement, chart, and headline populations before changing presentation.

The implemented desktop hierarchy is: header and scope, Operating Answer, Action Needed, Performance Snapshot, Performance Drivers, Latest Stock Movements, and Detailed Product Performance. Mobile uses: day/scope, Operating Answer, Action Needed, Quick Actions, Performance Snapshot, Performance Drivers, Latest Stock Movements, and Detailed Product Performance. Latest movements are limited to three with an explicit route to `/movements`; action links use existing routes and permissions.

Cost coverage is evaluated per order-item. Explicit numeric zero is preserved as supported zero-cost evidence, while missing shipment costs, service-only rows, and unattributed movement costs produce partial or unavailable states and withhold margin. Product revenue allocation uses line revenue weights, or quantity only as a bounded fallback, and never uses cost weights. Daily chart Revenue and COGS reconcile exactly with the headline metrics. Top Client is optional and appears only for a resolved named non-cash customer after its independent read succeeds.

Implementation `6250bf86cd58f44465b528d0dfb9f6e7414bc345` passed Validation run `29663517722`, job `88130055402`. Manual Finance Regression (Isolated) run `29663553319`, job `88130148160`, replayed 45 migrations through `20260716130533`, passed `393/393`, cleaned up successfully, and produced no success artifact. Production deployment `dpl_4GS3Hb6PCJC7xKb2WPaKZUFvLW9Q` reached Ready and is served by `stockwiseapp.com`; `www.stockwiseapp.com` redirects to the canonical alias.

Local state validation covered supported cost, explicit zero, missing/partial cost, negative margin, stale-read retention/recovery, optional customer resolution, and exact chart reconciliation at `1440x900`, `1200x800`, `820x1180`, and `390x844` in light/dark and EN/PT. Production read-only QA at the same widths confirmed the live ordering, company/period scope, operating status, urgent actions, performance drivers, latest movements, detailed products, EN/PT text, both themes, and exact live Revenue/COGS chart reconciliation. No production record was created or changed. No route, permission, schema, RPC, finance/stock authority, workflow trigger, package dependency, or Sentry configuration changed.

UXF-06 is closed by the decision-first hierarchy and progressive disclosure. UXF-14 is further reduced because the first viewport now explains operating status and the action required before deeper analysis. UX-3 Onboarding and Setup Journey remains next; UX-4 through UX-10 retain their documented sequence.

## 26. UX-3 Onboarding And Setup Journey (implementation baseline)

UX-3 started from `177c6ece3a79b94dbc6c69cef724646b69072962` with 45 migrations through `20260716130533_add_pos_tax_applicability_mode.sql`, a clean tree, and `393/393` as the maintained finance-regression expectation. The initial experience had secure invitation and company-bootstrap flows, but onboarding ended in a static checklist, Settings mixed readiness with edit permission, import tabs had no durable deep-link/result contract, and one optional Compliance read could make all fiscal evidence appear failed.

The implemented journey separates workspace entry from ongoing setup. `/onboarding` still verifies the authenticated account, lists only email-bound pending invitations, accepts invitations explicitly, creates only a minimal company name, preserves platform-admin separation, and now reports the selected company, assigned role, and whether entry came from creation or invitation. Its percentage is labelled only as workspace entry; it is not company readiness. Dashboard is primary and `/settings?view=setup` is the ongoing setup destination.

The Settings hub derives separate readiness, authority, and workflow-consequence states from existing bounded reads. Core foundation covers company/fiscal identity, sales and purchase tax defaults, POS mode, fiscal settings/series, currency, UOM, locations, items, and the opening-data decision. Operational extensions cover customers, suppliers, team access, banks, document branding, notifications, and due reminders. Optional areas are excluded from attention counts, a single active Owner is valid, service-only catalogs do not require stock locations, and failed reads are `unavailable` rather than `missing`.

The capability map is intentionally bounded: company/fiscal identity and series support fiscal issue; configured tax defaults support canonical commercial lines; explicit POS mode supports POS posting; tracked items require locations for stock movement; bank accounts are needed only for bank settlement; opening stock is needed only when bringing current on-hand stock into StockWise. The hub does not claim universal transaction readiness, full compliance, official SAF-T submission, or accounting completeness.

Deep-link contracts are whitelisted. Settings accepts `view=setup|all` and `section=company-profile|commercial-tax|localization|operations|inventory|notifications|due-reminders|documents`. Opening import accepts `dataset=locations|items|customers|suppliers|opening_stock`; invalid values fall back safely and no query value triggers a mutation. Import results remain visible in the component session with a return to company setup. Users retains MANAGER+ authority and distinguishes active, pending, disabled, and valid single-user states. Compliance isolates core settings/series from optional run, artifact, and audit history and retains the explicit statement that StockWise does not generate an official SAF-T/XML submission from that screen.

Local implementation validation and release evidence are recorded in the UX-3 closeout entry after CI, isolated regression, deployment, and read-only production QA. UXF-09 may be closed only when those gates pass. UX-4 remains next; no UX-4 inventory/register redesign is included here.

## 27. UX-3 Onboarding And Setup Journey Rollout

UX-3 is live. Implementation commit `72a36c58973213b12cce7a5a9408c918de40f2ca` introduced the evidence-backed setup hub and passed Validation run `29675193433`, job `88161274623`. Production QA then exposed a locale fallback when a company Settings row omitted an explicit language and retained a stale per-company cache. Corrections `5e1513eec92d67d47db22dbe90aa94e89b86cf75`, `a2240a5f6acfbc6a85f8e4e9aab6bee7846be68b`, and `95f3f6d345010e0a770e025b91187be144a7add2` kept explicit company language authoritative while allowing the current EN/PT control to govern when no explicit setting exists. Final Validation run `29676646365`, job `88165158384`, passed.

Final Finance Regression (Isolated) run `29676677772`, job `88165239453`, used CLI `2.109.1`, replayed 45 migrations through `20260716130533`, passed `393/393`, cleaned up the ephemeral loopback stack, and uploaded no success artifact. Production deployment `dpl_5iRqqKbbzC4AX1Lu4K5xXg37U4RB` reached Ready for commit `95f3f6d345010e0a770e025b91187be144a7add2` and serves `stockwiseapp.com`; `www.stockwiseapp.com` redirects to the canonical alias. Sentry source-map upload remained successful.

Read-only production validation covered Settings setup, supported Settings deep links and invalid fallback, Opening Data dataset selection and invalid fallback, Users/Roles setup return, Mozambique Compliance, and active-member `/onboarding` redirect. Checks covered `1440`, `1200`, `820`, and `390`, light and dark, with representative English and complete Portuguese setup-path checks. PT now survives a full Settings reload when the company has no explicit locale. Page overflow, raw translation keys, mojibake, fallback UI, console warnings/errors, and CSP errors were zero. The inspected production company already exposed an existing `non_fiscal` POS setting; UX-3 did not change that setting or any business data.

UXF-09 is closed: onboarding is now bounded to workspace entry, ongoing setup is capability-based in Settings, optional and not-applicable states are neutral, unavailable evidence is not presented as missing, and role guidance does not imply permission. No route, role, permission, invitation authority, schema, migration, RPC, posting behavior, Sentry configuration, dependency, or workflow trigger changed. UX-4 Inventory And Register Consistency remains next; UX-5 through UX-10 retain their documented order.
