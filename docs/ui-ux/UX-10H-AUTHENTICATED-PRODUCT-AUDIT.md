# UX-10H authenticated product audit and safe systemic remediation

Status: maintained implementation record and remediation inventory
Canonical visual and interaction contract: [`docs/premium-ui-direction.md`](../premium-ui-direction.md)
Audit tenant: approved Leny Doçuras test company
Engineering target: WCAG 2.2 AA; this is not a certification or compliance claim

## Scope and method

UX-10H reviewed the authenticated shell and all maintained product families against the UX-10A/B foundations. The audit used source inspection, current-run desktop and mobile browser inspection, PT/EN checks, keyboard-oriented semantic inspection, console review, and ordinary Leny workflows. Existing RLS, RPCs, posting rules, idempotency, accounting, inventory, costing, production, subscription, activation, and platform boundaries remained authoritative.

Safe implementation in this package was limited to repeated presentation contracts with a single correct answer: open shared page headers, semantic error/loading states, accessible notification filters/statuses, valid Search destinations, meaningful Search register filtering, direct POS/import headings, semantic warning treatment, an explicit item-deletion confirmation, user-language Dashboard movement labels, and removal of the internal `OPS-1` Reports eyebrow. Domain-heavy workflow redesign remains deferred.

## Authenticated information architecture

The maintained authenticated hierarchy is:

1. Dashboard for attention, recent operating evidence, and the next useful action.
2. Inventory for item master data, stock by location, movements, warehouses, and opening data.
3. Commercial operations for POS, sales and purchase orders, customers, and suppliers.
4. Finance for invoices, vendor bills, settlements, cash, banks, and transactions.
5. Operations for BOM/Assembly, Production Runs, Growth Batches, Service Jobs, and Landed Cost.
6. Review and administration for Reports, Settings, Users, Notifications, Profile, and Search.

Navigation labels should describe the destination in user language. Internal programme codes, decorative eyebrows, and duplicated page-purpose paragraphs do not belong in the primary hierarchy.

## Shared contracts applied

### Page and register headers

`PremiumPageHeader` and `PremiumRegisterHeader` use an open heading region with a divider. They no longer create a large elevated card around every page title. The register header keeps its existing compatibility prop for `eyebrow`, but decorative eyebrow content is not rendered. A caller may still provide context, status, evidence, or actions through the maintained semantic regions.

### Loading, empty, error, and unavailable

- Structural loading uses `PremiumSkeleton` or the shared table/mobile skeleton architecture.
- Table and mobile-register failures use `PremiumStatePanel` with error semantics; they are not presented as empty data.
- Empty means the read succeeded and returned no applicable records.
- Unavailable means the read failed or required evidence could not be obtained; it must not silently become zero or empty.
- Retry is offered only where repeating the read is meaningful.
- Action failures retain a human message while technical detail stays in development logging.

### Search

Global Search uses a labelled native input, structural list loading, explicit empty/error states, and open result rows rather than icon-badge cards. Items, customers, and suppliers route to their real registers with the matched name as a filter; nonexistent detail routes are not generated. Orders and finance documents retain their existing truthful detail/workspace destinations.

### Notifications

Notification severity uses canonical info/success/warning/danger tokens and visible text plus an icon. Unread state is textual, not a colour-only dot. Category and read-state filters have accessible names. The list uses dividers rather than a card per notification. Mark-all is limited to the loaded notification IDs visible to the signed-in user; action errors do not pretend a mutation succeeded.

### Mobile

Mobile order follows decision priority rather than mechanically stacking every desktop container. Titles, amounts, references, statuses, warnings, and action labels must wrap rather than become ambiguous. Fixed navigation and action bars must preserve safe-area clearance. Table-heavy surfaces need a maintained mobile representation or contained horizontal region with no page-level overflow.

## Surface audit

| Surface | Current evidence | UX-10H result | Remaining concern |
| --- | --- | --- | --- |
| Shell, desktop and mobile navigation | Sticky desktop navigation, mobile dock/drawer, company context, locale/theme, Notification Center | Shared notification semantics corrected; native links/buttons retained | Company-context pills and mobile dock decoration should be reconsidered with a dedicated shell composition pass, not piecemeal |
| Dashboard | Attention-first UX-10G hierarchy, real period data, truthful first-use states | Kept; shared open header applies | Role-specific evidence remains limited by available fixtures |
| Items | Leny items with role/readiness/stock evidence | Open register header; Search filter support; irreversible deletion now requires confirmation | Four summary cards and dense role/profile composition need item-specific redesign |
| Stock Levels | Location-scoped stock evidence | Shared register/error/loading contract applies | Cold-load and sparse/location states need a focused inventory state matrix |
| Stock Movements | Traceable movement register and filters | Shared register/error/loading contract applies | Dense filters and domain terminology need a dedicated audit |
| Warehouses | Warehouse/bin register and role-aware controls | Shared register header applies | Location editing and destructive states require focused workflow QA |
| Opening data | Supported template/import workflow with validation and commit boundary | Direct `h1`, duplicate historical badge/body removed, semantic permission warning | Import datasets and failure recovery need fixture workbooks for full mutation QA |
| POS | Real warehouse/bin stock, tax preview, settlement destination, receipt output | Direct `h1`, redundant header help removed, semantic warning treatment | Product cards, summary cards, and mobile checkout density need a POS-specific redesign |
| Sales/Purchase Orders | Registers, draft/fulfilment states, linked finance workflow | Shared open register header applies | Zero KPI rows and repeated status treatment require workflow-specific simplification |
| Customers/Suppliers | Leny register data and edit/create workflows | Search destinations now open the correct filtered register | Registers still contain conventional card framing; destructive/archive rules need focused QA |
| Sales Invoices/Vendor Bills | Authoritative lifecycle, compliance/readiness, document and settlement evidence | Shared open register header applies | Duplicate lifecycle badges, nested cards, and detail-page action hierarchy are high-priority domain work |
| Settlements | Governed AP/AR settlement evidence and explicit posting workflow | Audited only; no domain logic changed | Highest visual density and direct-colour debt; requires finance-authority-preserving redesign |
| Cash/Banks/Transactions | Cash book, bank registers/details, ledgers, statements, reconciliation evidence | Audited; shared states retained | Banks and finance timelines still use gradients/hover lift; error copy and mobile tables need focused remediation |
| BOM/Assembly | One Leny recipe and governed build/reversal workflows | Audited only | Repeated workflow selectors, summary cards, and raw action errors require production-specific work |
| Production Runs | Real reversed run and production register evidence | Shared open register header applies | Four KPI cards and repeated workflow selector create avoidable density |
| Growth Batches | Three active Leny batches and controlled agricultural workflow | Shared open register header applies | Domain-specific lifecycle and valuation evidence must be redesigned with Growth contract expertise |
| Service Jobs | One finalised Leny job and a truthful active-filter empty state | Existing state primitives retained | Create/detail/reversal flows were not fully mutated in this package |
| Landed Cost | Purchase-order-dependent allocation workspace | Audited only | Preselection zero values can look authoritative before evidence exists; requires a product decision |
| Reports | Maintained operational report catalogue and export functions | Internal `OPS-1` eyebrow removed | Raw RPC messages, generic loading text, summary-card grids, and mobile tables need a reports package |
| Settings | Evidence-backed setup command centre | Audited only | Dense card grid is intentional in places but needs hierarchy review by authority and consequence |
| Users/Roles | Five active and two invited Leny members | Audited without exposing private contact evidence | Alternate-role sessions were unavailable; role matrix remains partially untested |
| Notifications | Real Leny historical notifications | Rebuilt with labelled filters, structural states, semantic badges, rows/dividers, and safe mark-all scope | Historical generated notification bodies include unformatted decimal amounts; source formatting needs a communications package |
| Search | Real item/customer/supplier/order/document results | Broken register detail destinations fixed; PT/EN labels and reusable states added | Search remains name/reference based and intentionally does not invent ranking or fuzzy relevance |
| Profile | Real signed-in user/company context, preferences, password-link action | Existing UX-10D/F design retained; expected optional-mirror permission denial is logged as information rather than a failed-save warning | The duplicate Auth-metadata/profile-table ownership model remains data-model debt and needs a separate authority decision |

## Deferred remediation inventory

### High

- Finance detail and settlement pages: simplify duplicated statuses, nested cards, action hierarchy, gradients, hover lift, and direct semantic colours without weakening posting/approval evidence.
- Notifications source formatting: format monetary payloads before presentation so legacy bodies do not expose raw fixed-scale decimals.
- Landed Cost: distinguish “no purchase order selected,” unavailable allocation evidence, and genuine zero before showing totals.
- Role QA: provide safe credentials or purpose-built fixtures for ADMIN, MANAGER, and operational-role browser validation.
- Units of measure: Leny exposes two generated `EA-*` choices with the same “Each” meaning during item creation. Canonical-code ownership and duplicate cleanup require a governed data package.

### Medium

- Inventory and order registers: replace default four-card KPI rows where a metric does not support a decision; validate cold-load, zero, no-setup, and permission states.
- POS: reduce card-within-card density; the real Leny checkout/posting path passed, while receipt output and full keyboard-only checkout still need dedicated fixtures.
- Global Search: independent register/document reads currently run serially, producing a visibly long loading state on the broad `OPS` query. Parallel read orchestration should be measured and implemented separately.
- Reports: replace generic text loading/raw RPC errors with structural loading and human error states; review mobile table strategy.
- Production/Growth/Service: simplify repeated workflow selectors and summary cards only with domain-specific lifecycle QA.
- Shell: reduce decorative company-context pills and gradients while preserving the current responsive navigation contract.

### Low

- Revisit full application typography in the separately approved typography comparison package; IBM Plex Sans remains the first comparison candidate.
- Review the remaining low-risk neutral icon badges and small shadows after domain work determines whether they carry interaction or state meaning.

No blocker requiring schema, migration, RLS, RPC, subscription, activation, or business-logic change was identified for the systemic work completed here.

## Leny authenticated QA evidence

- Posted one ordinary non-fiscal cash POS sale for `OPS-QA Receipt Item` from `WH001 / QA-A2` with the explicit reference `UX-10H-POS-20260808` and note `UX-10H authenticated product audit`.
- The governed result was Sales Order `LEN-SO000000013`, quantity `1 EA`, subtotal/received amount `MZN 100.00`, and tax `MZN 0.00` under the existing non-fiscal contract.
- The POS reloaded available stock from `7 EA` to `6 EA`. Dashboard month view then showed the Aug 8 issue, `MZN 200.00` operational revenue, `MZN 100.00` gross profit, and two completed transactions. No calculation or posting rule was added by UX-10H.
- Created `UX-10H Disposable Item` / `UX10H-20260808-DISP`, changed minimum stock from `2` to `3`, confirmed the out-of-stock state remained truthful, and deleted the disposable item. The immediate-delete UX found during this test was corrected; a subsequent delete attempt against the retained OPS QA item opened the confirmation and was cancelled.
- Saved the signed-in Profile without changing its displayed values. Supabase Auth metadata remained authoritative. The optional `profiles` mirror was denied by its existing policy, produced no user-visible failure, and is now recorded at information level rather than as a warning.
- Lower-role login could not be exercised without credentials or an external invitation/verification path. Existing Leny member rows were inspected, but no authentication state was fabricated.

## Validation model

Automated source contracts, lint, UI-foundation debt checks, TypeScript baseline comparison, build, migration inventory, and browser console inspection are regression controls. They do not prove WCAG 2.2 AA. Manual keyboard QA, focus/order inspection, mobile/touch review, domain review, and human accessibility judgment remain required.

## Evidence handling

Current-run screenshots are stored outside the repository under the Codex visualization workspace. Screens containing personal member contact information are excluded from handoff evidence. The repository contains no fabricated product screenshot, customer, testimonial, metric, compliance claim, or certification.

## Validation outcome

- TypeScript baseline improved from `73` errors across `25` paths to `61` errors across `21` legacy paths. No TypeScript error remains in a UX-10H-changed path. The reduction came from narrow typing corrections in already-touched Items, Opening Import, POS, and Reports code; unrelated debt was not remediated.
- Direct semantic-colour debt improved from `582` to `563` occurrences. The UI-foundation check stayed below the `593` ceiling and reported no path increase.
- JavaScript/CSS lint, CSS variable/class checks, UX-10H contract tests, Dashboard tests, build, migration inventory, and `git diff --check` passed.
- The mutation-capable finance regression command correctly refused to run because `.env` targets production Supabase. Its five suites were blocked before mutation; this is an environment safety guard, not a UX-10H product failure. No override or production test mutation was attempted.
- The production build retained the existing advisory warnings for stale Browserslist data and large chunks. Opening Import, Dashboard, and the main bundle remain the clearest route-size follow-ups.
