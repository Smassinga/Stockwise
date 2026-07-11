# StockWise Testing Strategy

This document records the current testing baseline that actually exists in the repo.

## Current Status

Implemented today:

- lint and build checks for every material code change
- a non-mutating GitHub Actions validation gate for pull requests and pushes to `main`
- a real finance regression suite driven by the Node test runner and live Supabase clients

Not yet implemented as first-class repo tooling:

- dedicated Jest unit-test suite
- dedicated Cypress or Playwright browser E2E suite
- CI isolation for every finance mutation scenario

## Automated CI Validation

GitHub Actions runs `.github/workflows/validation.yml` on pull requests and pushes to `main`.

The workflow runs only non-mutating checks:

```bash
npm ci
npm run check:migrations
npm run lint:js
npm run check:css-vars
npm run check:css-classes
npm run build
```

Normal CI does not receive Supabase service-role credentials and does not run `npx supabase db push`. The workflow uses non-secret Vite placeholder values for Supabase compile-time variables so the production bundle check does not require real Supabase keys.

`npm run test:finance-regression` is intentionally not part of always-on public CI because it uses live Supabase clients, requires service-role access, creates temporary Auth/company/finance data, and then cleans it up. It remains a protected manual release gate until a dedicated isolated Supabase test project and guarded GitHub Actions secrets are configured.

If finance regression is later enabled in CI, use a non-production Supabase project only and provide these secrets through protected GitHub Actions environments:

- `VITE_SUPABASE_URL` or `SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` or `SERVICE_ROLE_KEY`

## Primary Regression Command

Run the finance regression suite with:

```bash
npm run test:finance-regression
```

The suite currently runs through:

- real auth users created for the run
- temporary company-scoped finance and inventory data
- backend RPCs, RLS, triggers, and state views
- cleanup at the end of the run

The package script runs finance-regression test files serially with Node's `--test-concurrency=1` flag. The files share one local mutation database and perform broad setup/cleanup, so concurrent file execution can make unrelated fixtures delete or alter each other's companies, users, warehouses, items, bins, posting requests, or control-plane rows. Serial file execution is a test-infrastructure guard, not a weakening of coverage: targeted concurrency scenarios remain inside the relevant tests, including stock rollup races, posting idempotency races, Production Run contention, Growth Batch G4.1 loss contention, G4.2 transfer stale-source/concurrent-destination coverage, local G5.1 harvest/reversal contention, and local G5.2 completion/reversal contention.

This is not a decorative page-load smoke suite. It mutates real test data against the connected Supabase project and then removes it.

The suite has a startup target guard in `tests/finance-regression/helpers.mjs`. It runs before Supabase clients are created, before Auth users or companies are created, and before mutation RPCs are invoked. Local Supabase targets such as `http://127.0.0.1:54321` and `localhost` are allowed automatically. The known StockWise production project `ogzhwoqqumkuqhbvuzzp` is hard-blocked and cannot be overridden. Any other remote project requires both `ALLOW_REMOTE_FINANCE_REGRESSION=true` and `FINANCE_REGRESSION_TARGET=non-production`, and must be an isolated non-production target.

## Finance Flows Covered

Current protected workflows:

1. Sales Order -> Sales Invoice draft -> approval -> issue readiness -> issue
2. Purchase Order -> Vendor Bill draft -> approval -> post
3. Settlements, including:
   - governed cash and bank settlement RPCs
   - same-key replay and changed-payload rejection
   - SO/PO to SI/VB anchor transition and stale-anchor blocking
   - over-settlement, cross-company, role, disabled-company, direct-write, and anon-execution guards
4. AR and AP bridge / reconciliation calculations
5. item and UOM dependencies that affect inventory and finance correctness
6. BOM / assembly gating and successful build posting
7. purchase receiving stock integrity:
   - exactly one PO receipt movement is recorded for a receipt action
   - `stock_levels` increases from the movement trigger only, preventing receipt double-counting
   - PO receipt state reaches fully received with zero remaining quantity
8. access-control lifecycle:
   - 7-day trial bootstrap
   - expiry restriction
   - reactivation
   - purge scheduling
9. public abuse protection on repeated company bootstrap

## What The Suite Asserts

The suite currently protects:

- finance posting continuity
- document state transitions
- approval and authority gates
- document relationship integrity
- settlement anchor continuity
- bank and cash posting continuity
- governed settlement idempotency across cash and bank, including exact two-decimal normalization, the reported repeated-`0.005` boundary, zero-outstanding rejection, exact minor-unit residual settlement, `posting_requests` result persistence, duplicate-row prevention, and competing full-settlement contention
- active-anchor transfer from `SO` to `SI` and `PO` to `VB`, including zero legacy-order exposure after the finance document is active
- atomic `post_bank_ledger_import` behavior: two-row/multi-row success, deterministic reorder/reload replay, repeated identical-looking rows, changed-payload rejection, later-row rollback, corrected retry, row/size limits, row-specific errors, ADMIN+ authority, cross-company denial, stale-anchor and direction blocking, and zero partial ledger/settlement effects after failure
- settlement/import isolation from `stock_movements`, `stock_levels`, and `items.unit_price`, plus static proof that maintained settlement, Cash, and Bank Detail posting flows contain no raw ledger inserts or per-row CSV posting loop
- the governed settlement/import block contains 113 unique named state checks inside the maintained 36/36 finance regression run; production-target detection still aborts before mutation
- current-legal-value bridge math
- item / UOM integrity assumptions used by inventory and finance paths
- assembly build gating under sufficient and insufficient stock
- assembly movement audit linkage through `ref_type = 'BUILD'` and `ref_id = build_id`
- assembly backend authority checks, including OPERATOR+ posting and VIEWER blocking
- idempotent assembly posting through `post_build_from_bom` and `post_build_from_bom_sources`, including successful replay, payload-mismatch rejection, and no duplicate build or movement rows
- idempotent normal web POS posting through `post_operator_sale`, including successful replay, payload-mismatch rejection, no duplicate sales orders, lines, stock movements or settlements, OPERATOR+ authority, VIEWER blocking, and commercial price separation from stock cost
- idempotent governed stock posting for PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, and adjustment in the consolidated A2.4/A2.5 package
- concurrent stock rollup protection, including assembly over-issue races, concurrent receipt weighted-average rollup, ledger-to-rollup reconciliation, and POS-versus-assembly stock competition
- broader A2.5 stock contention checks, including concurrent PO/manual receipts into one bucket and competing sales/manual issue demand from one bucket
- hardened source-split assembly posting or an explicit blocked-path assertion when disabled
- PO receiving ledger integrity, including protection against app-side `stock_levels` double-counting
- Growth Batches G1-G2 authority, RLS/FORCE RLS, RPC-only mutation, request-key idempotency, payload mismatch rejection, null/zero/omitted hash distinctions, numeric hash equivalence, UOM validation, chronology guards, event sequencing, direct-cost rollups, deterministic read-model ordering, and stock/finance/price isolation
- Growth Batches G3 stock-input coverage, including preview/no-mutation behavior, base-UOM enforcement, insufficient-stock and duplicate-bucket blockers, physical issue movement references, frozen WAC material cost, rollups, replay/mismatch, MANAGER+ reversal, compensating receipt references, direct mutation rejection, and finance/price isolation
- Growth Batches G4.1 mortality/shrinkage coverage, including preview/no-mutation behavior, reason-code validation, count-integrality and excessive-loss blockers, current quantity/latest-weight rollups, replay/mismatch, OPERATOR+ recording, MANAGER+ event-specific reversal, dependency blocking, direct mutation rejection, concurrent loss safety, and stock/finance/cost/price isolation
- Growth Batches G4.2 local transfer coverage, including preview/no-mutation behavior, source-location fingerprint stale-preview protection, full-batch transfer snapshots, OPERATOR+ transfer, MANAGER+ event-specific transfer reversal, latest-transfer dependency blocking, inactive/cross-company destination rejection, direct mutation rejection, concurrent transfer safety, and stock/finance/cost/price isolation
- Growth Batches G5.1 local depleting-harvest coverage, including preview/no-mutation behavior, partial and full harvest allocation, exact full-cost transfer, stock receipt references, output-stock bucket effects through the stock engine, OPERATOR+ posting, MANAGER+ event-specific reversal, stale fingerprint rejection, direct mutation rejection, helper privilege denial, concurrent harvest/reversal safety, insufficient-output-stock reversal blocking, fully harvested awaiting-completion state, and finance/selling-price isolation
- Growth Batches G5.2 local completion coverage, including preview/no-mutation behavior, MANAGER+ lifecycle completion, event-specific completion reversal, completed-state blocking for measurement/direct-cost/harvest/reversal dependencies, stale fingerprint rejection, direct mutation rejection, helper privilege denial, same-key replay, changed-payload rejection, same-key contention, lifecycle-only status/audit/latest-sequence updates, and stock/finance/cost/quantity/weight/selling-price isolation
- trial and entitlement enforcement

Hosted production and local replay now have 39 migrations through `20260709222842_governed_settlement_posting.sql`.

The governed settlement release passed the maintained local finance regression `36/36`, including 113 uniquely named settlement/import state checks. Controlled production smoke covered one cash settlement, one manual bank row, one two-row atomic CSV import, identical logical replay after reload, EN/PT package feedback, responsive widths `1440/1200/820/390`, and stock/price/anchor invariants. Production did not run repeated-`0.005`, payload-mismatch, over-settlement, stale-anchor, failed-import rollback, cross-company, authority-negative, or concurrency mutation tests; those remain local-regression evidence only.

## Test Architecture

Current implementation lives in:

- `tests/finance-regression/helpers.mjs`
- `tests/finance-regression/finance-regression.test.mjs`
- `tests/finance-regression/growth-batches.test.mjs`
- `tests/finance-regression/onboarding-invitations.test.mjs`

The suite uses:

- `node --test`
- `@supabase/supabase-js`
- temporary auth users
- company-scoped setup and cleanup

Important design rules:

- prefer meaningful state assertions over shallow render checks
- cover both success and blocked paths
- validate the same DB and RLS paths production uses
- keep cleanup explicit so repeated runs do not drift

## Validation Steps For Product Changes

After code changes that can affect runtime behavior:

1. `npm run lint:js`
2. `npm run build`
3. `npm run test:finance-regression`

For DB work:

1. inspect pending migrations
2. attempt `npx supabase db pull` when remote state may have changed
3. apply migrations with `npx supabase db push`
4. rerun lint, build, and the finance regression suite

For premium UI phases that do not change backend logic, posting logic, or schema, keep the same automated gates and add manual route QA for the touched authenticated surfaces. Phase 4 requires `/onboarding`, `/settings`, `/users`, and `/users/roles` checks at desktop and mobile widths, with special attention to explicit invitation acceptance, backed Settings navigation, and role copy staying aligned with `roles.ts` and `permissions.ts`.

The 2026-06-10 Recipes & Assemblies Phase 1 pass is a UX and workflow-clarity change over the existing BOM/assembly flow. It introduced no schema migration and did not change stock posting, valuation, POS pricing, finance posting, settlements, invoice issuance, RLS, entitlement, or access-control logic. Validate `/bom` at desktop `1440`, laptop `1200`, tablet `820`, and phone `390`, checking that recipe/BOM selection, ingredient/component cards, readiness states, insufficient-stock messaging, estimated material-cost wording, and the existing post-assembly action remain clear without implying full production costing. `npm run test:finance-regression` remains required before any future production posting, valuation, or backend costing change; for this UI-only pass it may be skipped unless the connected Supabase target is a safe mutation test project.

The 2026-06-11 Phase A1 assembly backend hardening pass changes only existing assembly RPC authority, company scoping, helper exposure, and build movement audit linkage. It does not add Production Runs, Growth Batches, POS pricing changes, finance posting, invoice issuance, settlements, entitlement, Platform Control, subscription logic, or a new RLS model. Before staging A1, run the normal static/build gates and run `npm run test:finance-regression` against a confirmed safe mutation Supabase target. A2 remains required for idempotency, repeated-click replay, concurrent stock-decrement safety, and simultaneous assembly/POS/receipt stress coverage.

The 2026-06-11 opening-stock regression unblocker keeps canonical UOM IDs as text and verifies `import_opening_stock_batch` accepts IDs such as `uom_ea`. This was found while validating A1 locally and does not change Production Runs, Growth Batches, POS pricing, invoice issuance, settlements, entitlement, Platform Control, or subscription behavior.

The 2026-06-11 A2.1/A2.2 pass introduces `posting_requests` as the backend idempotency foundation and applies it only to assembly posting. The finance regression suite must verify simple and source-split idempotent assembly replay, payload mismatch rejection, stable build/movement counts, and unchanged `items.unit_price`. A2.3 remains required for concurrent stock-decrement safety; POS, PO receiving, sales-order shipping, opening-stock import, manual stock movements, finance posting, invoice issuance, settlements, entitlement, Platform Control, company access, and subscription behavior are out of scope for this pass.

The 2026-06-13 A2.3 pass hardens the shared stock rollup path behind `stock_movements` inserts. The finance regression suite must verify atomic insufficient-stock behavior under concurrent assembly issue attempts, concurrent receipt quantity and weighted-average rollup, ledger-to-rollup reconciliation, and cross-workflow POS-versus-assembly stock competition. This pass does not add idempotency to POS, PO receiving, sales-order shipping, opening-stock import, or manual movements; A2.4 remains required for those workflow authority boundaries.

The 2026-06-13 production rollout for A1 through A2.3 was smoke-validated against a controlled assembly target after the hosted migrations were applied. The smoke created one build, seven component issue movements, and one finished-item receipt movement from `/bom`; all eight movements carried `ref_type = 'BUILD'` and the generated build id. Stock rollups reconciled to the movement deltas, weighted-average cost updated as expected, `items.unit_price` stayed unchanged, and duplicate stock buckets remained zero. The full finance regression suite was not run against production because it creates broad temporary Auth, company, inventory, and finance data. POS and PO production mutation smokes were not run because no separately approved controlled targets were provided.

The post-rollout `/bom` success-feedback patch is UI-only. Validate that the durable success panel remains visible after the immediate form reset/data refresh, displays the finished item, quantity, and shortened build reference, can be dismissed, and clears when the operator changes the BOM or starts another build plan. This patch does not change posting authority, request-key generation, idempotency behavior, stock movement posting, stock valuation, finance posting, POS, PO receiving, sales shipping, opening-stock import, or manual movement behavior.

The 2026-06-13 A2.4a.1 package added `post_operator_sale` as the idempotent wrapper for normal web Point of Sale posting and cut the web POS flow over to that wrapper. The finance regression suite must verify same-key/same-payload replay, same-key/changed-payload rejection, stable sales-order/line/movement/settlement counts, unchanged stock after replay, required request-key rejection, OPERATOR+ success, VIEWER blocking, cross-company rejection, and that commercial line pricing still comes from `items.unit_price` or an explicit operator price override rather than stock cost. The legacy POS RPC remains executable for deployment compatibility and stale Tauri clients until A2.4a.2. This pass does not add idempotency to PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, or adjustment.

The 2026-06-14 A2.4a.1 production rollout and smoke validation completed for normal web POS. The hosted migration and frontend deployment were live at commit `80c7c70`, and one controlled cash sale was submitted exactly once for `Leny Doçuras` using `Bolo de Custarde` from `Casa / CDC001 - Cozinha - Casa`. The smoke created one sales order (`LEN-SO000000001`), one sales-order line, one stock issue movement, one cash transaction, and one `posting_requests` row with `operation_type = 'operator.sale'`, `status = 'succeeded'`, and `result_ref_type = 'SO'`. Stock changed from `2` to `1`, duplicate stock buckets remained zero, and no negative stock bucket existed. The selling price was `1500` and `items.unit_price` remained `1500`, preserving commercial price separation from stock cost. No production replay or payload-mismatch test was performed because those paths are covered by the local finance regression suite, which passed `22/22` including replay, mismatch, authority, cash settlement, and bank settlement coverage. The short-lived success toast was not visible after six seconds, but posting succeeded, the cart reset, and stock refreshed correctly; this was a feedback observation, not a posting failure.

The consolidated A2.4/A2.5 package is live and representative production-smoke validated as of 14 June 2026. Hosted Supabase is aligned through `20260614123300`, the production frontend is commit `51c4fd1`, and the local finance regression suite passed `24/24` before rollout. Production smokes were intentionally narrow and submitted each action once: PO receipt created one `purchase.receive` request and one receipt movement; positive adjustment created one `stock.adjustment` request and one adjustment movement; transfer moved one `Bolo de Custarde` from `Casa / CDC001 - Cozinha - Casa` to `Casa / QA-A2 - A2 Production Smoke`, creating one `stock.transfer` request and two balanced movements; sales shipment created controlled order `LEN-SO000000002`, shipped one line from `QA-A2`, created one `sales.ship` request and one issue movement, and created no invoice or settlement. No production replay or payload-mismatch test was performed. Replay, mismatch, authority, concurrency, failure-path, duplicate-bucket, negative-stock, and weighted-average assertions remain covered by the local `24/24` suite. Duplicate and negative stock checks stayed zero after production smoke, and `items.unit_price` remained `1500`.

The first Production Runs package is live and production-smoke validated as of 2026-06-18. At that rollout, hosted Supabase aligned through `20260615213640`, the production frontend was commit `4f82c5a`, and the local finance regression suite passed `26/26` before rollout. The controlled smoke used `Leny Doçuras`, recipe `Bolo Custarde` v1, and Production Run `LEN-PR000000001`. A setup stock receipt for `Fermento` was submitted once through the maintained Movements UI, moving `Casa / CDC001 - Cozinha - Casa` stock `0 -> 3` and creating succeeded `stock.receipt` request `9b1f5e7c-a046-458c-a889-6f4056d36805`. The Production Run post was submitted once through `/production-runs`, created succeeded `production.run.post` request `33facecd-a63e-45c9-939d-2179303031b1`, seven input issue movements, and one output receipt movement `bb2fe802-9d58-4f7a-9118-982a44ef84ce`; Fermento moved `3 -> 0` and `Bolo de Custarde` in `Casa / QA-A2 - A2 Production Smoke` moved `0 -> 1`. The immediate reversal was submitted once, created succeeded `production.run.reverse` request `54409ae2-d3f4-483f-8b7b-ecfd66717ae9`, one compensating output issue `2991d192-223d-42a3-b017-c41850d43c5b`, and seven compensating input receipts; Fermento returned `0 -> 3` and the QA output bucket returned `1 -> 0`. Duplicate stock buckets and negative stock rows remained zero, `items.unit_price` remained `1500`, and no cash, bank, or vendor-bill rows were created by the Production Run. No production replay or payload-mismatch test was performed. Replay, mismatch, authority, concurrency, failure-path, base-UOM, finance-isolation, and reconciliation paths remain covered by the local `26/26` suite. The Production Runs UI requires a fresh readiness preview after material draft changes and exact run-reference confirmation before reversal. The production-target guard in `tests/finance-regression/helpers.mjs` remains mandatory and must print a local safe target before mutation tests.

Growth Batches G1-G2 is live and production-smoke validated as of 2026-06-20. Hosted Supabase is aligned through `20260619175129`, the production frontend is commit `c7b5e299`, and the guarded local finance regression passed `31/31` against `http://127.0.0.1:54321` before rollout. The controlled smoke used one retained active batch, `LEN-GB000000001` for `Leny Doçuras`, through the maintained `/growth-batches` UI. It verified draft create/edit, activation, one total-weight measurement, one memo direct cost, register/current-state/timeline/measurement/direct-cost read-model reconciliation, event sequences `1` activation, `2` measurement, and `3` direct cost, and succeeded posting requests for `growth.batch.create`, `growth.batch.activate`, `growth.batch.measurement`, and `growth.batch.cost`.

The smoke created only the expected Growth Batch rows: `growth_batches` `0 -> 1`, `growth_batch_events` `0 -> 3`, `growth_batch_measurements` `0 -> 1`, `growth_batch_direct_costs` `0 -> 1`, and `posting_requests` `9 -> 13`. Stock and finance anchors stayed unchanged: `stock_movements` `53 -> 53`, `stock_levels` `9 -> 9`, `cash_transactions` `4 -> 4`, `bank_transactions` `0 -> 0`, `vendor_bills` `1 -> 1`, `sales_invoices` `0 -> 0`, `finance_document_events` `5 -> 5`, and `items.unit_price` sum/hash stayed `2500` / `042919f464f3830a8a7c17791d9a43e7`. Production idempotency persistence was verified through succeeded posting requests and non-duplicated events/details. Production replay and payload-mismatch tests were not performed; replay, mismatch, concurrency and failure behavior remain covered by the guarded local `31/31` regression suite.

Growth Batches G3 is live and production-smoke validated as of 2026-06-22. Hosted Supabase is aligned through `20260620132656`, the production frontend is commit `58e8a083`, Vercel deployment `dpl_CPHfKuoWcZ1eEMLrFXjv3cSFCu3i` serves the production aliases, and GitHub Validation run `27930016751` passed before rollout. The production smoke used tenant `Leny Doçuras`, batch `LEN-GB000000002`, item `OV002 - Ovo`, UOM `EA - Each`, and source `WH001 - Casa / CDC001 - Cozinha - Casa`. It previewed successfully, posted `1 EA` once with frozen WAC `10.304233`, created input event `LEN-GB000000002-E000002`, detail `6837d2a6-7e29-4a7d-acb1-d3b7e352944c`, issue movement `3fe172dd-adc5-44e5-8ec6-7587420078fa`, and request `e32dcf72-755d-4d1f-86c8-1e96e9fd761b`, then immediately reversed with event `LEN-GB000000002-E000003`, detail `03b1dd13-cf49-4aa5-abab-6de06aa765a6`, receipt movement `48ce328c-fdc9-4383-a0d5-11164fb0da7f`, and request `efd1c065-3d29-4185-8b1d-a216e0e7d80e`.

G3 pre-rollout validation passed before Git finalisation: 30-migration replay passed, Growth Batches targeted regression passed `5/5`, complete finance regression passed `31/31`, independent implementation inspection passed, authenticated local visual QA passed at `1440`, `1200`, `820`, and `390` in light and dark mode, and static validation/build passed. Production smoke confirmed source stock `48 -> 47 -> 48`, material cost `0 -> 10.304233 -> 0`, memo direct cost unchanged, original issue immutability, no second reversal action after reversal, negative stock `0`, duplicate stock bucket groups `0`, no cash/bank/vendor bill/invoice/finance-event mutation, and unchanged `items.unit_price` sum/hash baseline.

G3 production replay, payload-mismatch, concurrency, and failure tests must not be performed in production. They remain covered by the guarded local finance regression suite and controlled local visual QA.

Growth Batches G4.1 is live and production-smoke validated as of 2026-06-28. Hosted and local Supabase are aligned through `20260627225414` with 32 active migrations, the production frontend is commit `5a24eb428499d126870883bb5841e3e451cdd178`, Vercel deployment `dpl_FrC2WKJsF1DmosBSu68tahEBhmhU` serves the production aliases, and GitHub Validation run `28319500331` passed before rollout. The local package adds mortality and shrinkage preview/recording/reversal coverage to `tests/finance-regression/growth-batches.test.mjs`: VIEWER/OPERATOR/MANAGER authority, cross-company rejection, direct table mutation blocking, valid mortality and shrinkage, invalid date/reason/empty/excessive loss paths, request-key replay and mismatch, current quantity/latest-weight restoration, later-loss and later-weight-measurement reversal blockers, concurrent competing loss safety, duplicate request replay, and isolation from stock movements, stock levels, Growth Batch costs, finance rows, and `items.unit_price`. Local validation passed with 32-migration replay, `check:migrations`, static checks, production build, targeted Growth Batches regression `6/6`, complete finance regression `32/32`, and authenticated `/growth-batches` visual QA at `1440`, `1200`, `820`, and `390` in light and dark mode. Production smoke used tenant `Leny Doçuras`, batch `LEN-GB000000003`, mortality event `LEN-GB000000003-E000002`, mortality reversal `LEN-GB000000003-E000003`, shrinkage event `LEN-GB000000003-E000004`, and shrinkage reversal `LEN-GB000000003-E000005`; final quantity restored to `20 EA`, final weight restored to `40 KG`, second reversal controls were hidden, stock/finance/cost/price counts stayed unchanged, negative stock and duplicate buckets stayed zero, and `items.unit_price` stayed unchanged. Production replay, mismatch, concurrency, and failure tests remain disallowed.

Growth Batches G4.2 is live and production-smoke validated as of 2026-07-02. Hosted and local Supabase are aligned through `20260630170735_add_growth_batch_transfer_posting.sql` with 34 active migrations. The local Growth Batch regression covers full-batch operational location transfer and event-specific transfer reversal in `tests/finance-regression/growth-batches.test.mjs`: OPERATOR+ preview/post, MANAGER+ reversal, VIEWER/OPERATOR reversal blocking, cross-company destination rejection, inactive warehouse/bin rejection, source-location fingerprint mismatch, same-key replay, changed-payload rejection, one transfer detail per event, one reversal maximum, immutable original transfer and reversal detail rows, latest-transfer-only reversal, non-location events not blocking reversal, inactive original source blocking reversal, concurrent competing transfers, unchanged quantity/weight/cost rollups, no stock movements, no stock-level changes, no finance rows, and unchanged `items.unit_price`. Production G4.2 rollout stayed database-first with a narrow maintained-UI transfer/reversal smoke: the first UI transfer was restored by the approved authenticated public reversal RPC after a detail-card layout blocker, then fix commit `c84469100249188144cb6305a634e21fba77a653` deployed and a fresh maintained-UI transfer/reversal completed. Production replay, payload-mismatch, authority-negative, and concurrency stress tests stay local-only.

Growth Batches G5.1 is live and production-smoke validated as of 2026-07-03. Hosted and local Supabase are aligned through `20260702205834_add_growth_batch_harvest_posting.sql` with 36 active migrations. The maintained Growth Batch regression adds governed partial/full depleting harvest coverage: OPERATOR+ preview/post, VIEWER posting block, MANAGER+ event-specific reversal, OPERATOR reversal block, internal helper privilege denial, direct table mutation blocking, stale fingerprint rejection after state changes, request-key replay and mismatch, partial proportional cost allocation, full-harvest exact remaining-cost transfer, zero-remaining-quantity active/awaiting-completion state, one harvest receipt movement, one compensating reversal issue movement, no finance rows, unchanged `items.unit_price`, negative/duplicate stock-bucket checks, and concurrency safety. Production smoke used Leny Docuras batch `LEN-GB000000003` and QA item `QA-G51-POULTRY-KG`: partial harvest `LEN-GB000000003-E000010` was reversed by `LEN-GB000000003-E000011`, full harvest `LEN-GB000000003-E000012` was reversed by `LEN-GB000000003-E000013`, the QA output bucket returned to zero, and final batch state restored `20 EA`, `40 KG`, active status, and zero costs. Production replay, payload-mismatch, authority-negative, insufficient-stock, nonzero-cost allocation, and concurrency tests remain local-only. G5.1 intentionally excludes non-depleting yield, split/child batches, multi-output/co-product allocation, sale/invoice creation, COGS, FIFO, fair value, finance posting, automatic completion, whole-batch reversal, profitability dashboards, and individual animal/plant tracking.

Growth Batches G5.2 is live and production-smoke validated. Hosted migration history now continues through governed-settlement migration 39, while G5.2 remains anchored at `20260704041943_add_growth_batch_completion_posting.sql`. The maintained Growth Batch regression adds governed lifecycle-completion coverage: OPERATOR preview with manager-required blocker, MANAGER+ completion/reversal, source-state fingerprinting, stale-preview rejection after state changes, idempotent replay and mismatch rejection, direct table mutation blocking, internal helper privilege denial, completed-state blocking for measurement/direct-cost/harvest and harvest reversal, one completion detail per event, one reversal maximum, event-specific reversal back to active, no stock movements, no stock-level changes, unchanged quantity/weight/cost rollups, unchanged finance rows, unchanged `items.unit_price`, and concurrent same-key completion safety. The authorised maintained-UI smoke posted full harvest `E000014`, completion `E000015`, completion reversal `E000016`, and harvest reversal `E000017` for `LEN-GB000000003`, restoring `20 EA`, `40 KG`, active status, zero costs, and the zero QA output bucket. Production replay, mismatch, authority-negative, and concurrency tests remain deliberately local-only.

## Auth Production QA

The 2026-06-04 Auth confirmation change requires these production smoke checks whenever the auth surface or Auth settings are changed:

- signup creates a pending verification state and does not auto-enter the app
- Brevo-delivered confirmation email uses the polished StockWise template
- confirmation link reaches `/auth/callback` and then routes by membership state
- login before confirmation is blocked or shows the verification/resend panel
- resend confirmation sends email and respects the 60-second frontend cooldown
- confirmed no-company users route to onboarding
- confirmed active-company users route to dashboard
- Platform Control remains restricted to platform-admin users
- profile phone remains profile-only contact data and saves after the live nullable `profiles.phone_number` migration

The 2026-06-03 auth/signup production QA covered:

- `/login` login and signup states at widths `1440`, `1200`, `820`, and `390`
- optional phone, confirm password, password visibility, trust copy, forgot-password messaging, and horizontal overflow
- unconfirmed-login verification panel and resend control using an admin-created unconfirmed temporary user
- active-company dashboard routing, no-company onboarding routing, profile phone save, and Platform Control access split
- cleanup of all temporary QA auth users, platform-admin rows, profiles, and test company data

2026-06-04 configuration change:

- the prior signup auto-sign-in caveat is resolved by requiring production Supabase email confirmation before normal app access

2026-06-05 controlled-inbox Auth email-delivery QA:

- controlled disposable inboxes received production Supabase Auth emails through Brevo for confirm signup, resend confirmation, and reset password
- subjects matched the reviewed templates: "Confirme o seu acesso ao StockWise" and "Repor a sua palavra-passe do StockWise"
- received HTML rendered correctly at desktop and mobile widths (`1440` and `390`) when served with UTF-8; CTA, fallback link, and support mailto were visible with no horizontal overflow
- copy quality passed for Portuguese-first wording, StockWise/WiseCore branding, support contact, and security note; no tax, SAF-T, certification, or other compliance claim was introduced
- confirm-signup button link followed the Brevo wrapper, completed Supabase verification, reached `/auth/callback`, and routed the no-company QA user to `/onboarding`
- resend confirmation was requested successfully and delivered as a second confirmation email; the fallback link followed the Brevo wrapper, completed verification, and routed the no-company QA user to `/onboarding`
- reset-password button and fallback links followed the Brevo wrappers and exchanged the recovery token; the fixed callback now routes recovery sessions to `/update-password` before normal onboarding/dashboard membership routing
- spam placement was not fully validated because the controlled disposable inbox provider exposes delivered inbox messages but no comparable Gmail/Outlook-style spam folder
- cleanup removed the temporary production Auth users and associated profile rows; no temporary company memberships, active-company rows, or Platform Control admin rows remained

2026-06-05 reset-password recovery fix QA must cover:

- reset email link reaches `/auth/callback` and then `/update-password`
- mismatched passwords are blocked on the update screen
- valid matching passwords call Supabase Auth `updateUser({ password })`
- after update, the recovery marker is cleared and the user signs in again through `/login`
- old password no longer signs in; new password signs in and then follows the existing no-company onboarding or active-company dashboard route
- confirmation/signup and resend-confirmation routing stay unchanged

2026-06-05 post-deployment production smoke:

- production was deployed with `npx vercel build --prod` and `npx vercel deploy --prebuilt --prod`
- custom domain `https://stockwiseapp.com` served the new `/update-password` route
- fresh controlled inboxes received Brevo/Supabase reset-password and confirm-signup emails with CTA and fallback links
- reset-password CTA followed Brevo -> Supabase -> `/auth/callback` -> `/update-password`; password update succeeded, old password was rejected, and the new password signed in
- the no-company reset QA user reached `/onboarding` after signing in with the updated password
- signup confirmation CTA routed a fresh no-company user to `/onboarding`
- login before confirmation showed the verification/resend panel; the resend button sent another email, showed the 60-second cooldown state, and the resent confirmation link routed to `/onboarding`
- active-company QA user reached `/dashboard`
- normal active-company user was redirected away from `/platform-control`, preserving Platform Control restriction
- landing card icon spacing was checked at widths `1440`, `1200`, `820`, and `390`; the feature/workflow/use-case icon badges had nonzero top spacing and no horizontal overflow
- temporary Auth users, profile rows, company memberships, active-company rows, Platform Control rows, and the temporary QA company were removed after production smoke

## Known Limits

Current gaps that remain future scope:

- CI wiring for the finance regression suite in an isolated Supabase test project
- broader isolated environment strategy beyond the current temp-data cleanup model
- long-tail browser interaction coverage outside the finance-critical mutation suite
- dedicated lower-level unit testing for shared helpers
- first-class automated browser E2E coverage for the auth verification/resend UX
- production deliverability checks against mailbox providers with real spam/quarantine folders, especially Gmail and Microsoft 365/Outlook
- formal monthly recovery drill evidence using [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md)

## Recommended Next Testing Layer

The next practical expansion is not another vanity smoke layer.

Recommended next steps:

- require the non-mutating validation workflow as a protected branch check
- wire the finance regression suite into CI only after a dedicated non-production Supabase project and guarded environment rules exist
- add smaller targeted unit tests around shared helper math and access-state formatting
- add browser-level route verification only for high-value public/commercial and blocked-access flows

## Payment activation regression (local only)

`payment-activation.test.mjs` adds 123 named checks against local Supabase. It covers channel authority/audit, OWNER/ADMIN versus lower-role boundaries, plan-price authority, one-open-request/idempotency behavior, private storage MIME/size/cross-company controls, proof validation, submission/correction/resubmission, platform review/approval, same-key and competing-key approval behavior, provider-reference uniqueness across same-category channels, entitlement and event audits, restricted grants/search paths, signed URL bounds, and cash/bank/stock/price/Growth Batch/Production Run isolation. The test uses the existing production-target hard block and must never run against hosted production.
