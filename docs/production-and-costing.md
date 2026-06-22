# Production & Costing

This document records the current Production & Costing direction.

## Phase 1 Current State

Phase 1 upgrades the existing Assembly/BOM page into the **Recipes & Assemblies** workspace. It is a UX and workflow-clarity pass over the existing BOM and assembly behavior.

What changed:

- the user-facing concept is now Recipes & Assemblies
- the workspace uses premium header, summary cards, mobile ingredient/component cards, readiness panels, and estimated material-cost explanation
- current assembly estimates are labelled as **estimated material cost**
- the estimate is based on current weighted-average stock cost from existing stock levels
- the page remains Android/mobile friendly and avoids desktop-only table dependence for component review

What did not change:

- no Supabase schema migration was introduced
- no stock posting logic changed
- no valuation logic changed
- no POS pricing logic changed
- no finance posting, settlement, invoice issuance, RLS, entitlement, or access-control logic changed
- `stock_movements` remains the canonical stock ledger
- `stock_levels` remains derived by existing database logic
- item default selling price remains commercial and separate from stock cost

## Explicit Future Scope

Production Runs and Growth Batches G3 stock-input posting are live foundations. Remaining future Production & Costing work includes:

- mortality and shrinkage
- batch transfers
- harvest and split or partial harvest
- Growth Batch completion and whole-batch reversal
- FIFO biological layers, COGS, and fair-value accounting
- automatic finance posting, vendor-bill allocation, cash/bank settlement, and advanced cost allocation
- labour, utilities, overhead, recurring costs, and allocation rules beyond the current Production Run memo-cost snapshots
- production variance, margin, break-even, yield, waste, mortality, profitability, and batch comparison dashboards

## Backend Review Boundary

The existing `build_from_bom` path remains the simple assembly posting path.

The following existing backend functions were not expanded in Phase 1 and need separate backend review before future Production & Costing work depends on them:

- `build_from_bom_sources`
- `inv_issue_component`
- `inv_receive_finished`

Future posting/costing phases must add dedicated regression coverage before changing inventory valuation, stock posting, finance posting, or production costing behavior.

## Phase A1 Assembly Backend Hardening

Phase A1 hardens the current assembly RPCs without introducing Production Runs, Growth Batches, labour/utilities/overhead allocation, frozen cost snapshots, or biological costing.

What changed:

- `build_from_bom` now enforces active-company and OPERATOR+ backend authority before posting
- `build_from_bom` links component issue and finished receipt movements to the generated build with `ref_type = 'BUILD'` and `ref_id = build_id`
- `build_from_bom_sources` remains callable for the current `/bom` source-routing flow, but now applies the same company, active-BOM, role, item, warehouse, and bin validations
- source-split assembly posting now creates a `builds` row and links all assembly movements to that build
- legacy helper RPCs `inv_issue_component` and `inv_receive_finished` are restricted from normal client execution and no longer create zero `stock_levels` rows directly

What did not change:

- no POS pricing, finance posting, invoice issuance, settlements, entitlement, Platform Control, company-access, subscription, or broader access-control model changes were introduced
- `stock_movements` remains the stock ledger
- `stock_levels` remains the trigger-derived availability and weighted-average rollup
- item default selling price remains `items.unit_price` and is not derived from stock cost

## Phase A2.1/A2.2 Assembly Idempotency

Phase A2.1 introduces `posting_requests` as the reusable company-scoped backend idempotency ledger.

Phase A2.2 applies that foundation to existing assembly posting only:

- `post_build_from_bom` wraps the hardened simple assembly build path and returns the original build id on successful replay
- `post_build_from_bom_sources` wraps source-split assembly posting and returns the build id for first success and replay
- repeated calls with the same request key and same payload do not create duplicate builds or stock movements
- reused request keys with changed payloads are rejected

What did not change:

- no Production Runs or Growth Batches were implemented
- no labour, utilities, overhead, frozen cost snapshots, or biological costing were implemented
- no POS, PO receiving, sales-order shipping, opening-stock import, manual stock movement, finance posting, invoice issuance, settlement, entitlement, Platform Control, company-access, or subscription idempotency was added
- `stock_movements` remains the ledger and `stock_levels` remains the derived rollup
- item default selling price remains `items.unit_price` and is not derived from stock cost

## Phase A2.3 Stock Rollup Concurrency Safety

Phase A2.3 hardens the shared `apply_stock_delta` rollup path used by stock movement inserts. This is a stock-engine safety change, not a costing-policy change.

What changed:

- negative stock deltas are guarded by an atomic conditional update on the affected `stock_levels` bucket
- concurrent receipts into the same bucket use nullable-bin aware upserts so receipt quantity and weighted-average updates are not lost
- duplicate bucket preflight is explicit; hosted deployment must stop for manual cleanup if duplicate `stock_levels` buckets already exist
- regression coverage now includes concurrent assembly issue protection, concurrent receipt rollup, movement-ledger reconciliation, and POS-versus-assembly stock competition

What did not change:

- no Production Runs or Growth Batches were implemented
- no labour, utilities, overhead, frozen cost snapshots, or biological costing were implemented
- no POS pricing, finance posting, invoice issuance, settlement, entitlement, Platform Control, company-access, or subscription behavior changed
- no idempotency was added to POS, PO receiving, sales-order shipping, opening-stock import, or manual movements
- `stock_movements` remains the ledger and `stock_levels` remains the derived rollup
- reversals remain append-only compensating movements

## Production Release Closeout

The A1 through A2.3 chain is live in hosted Supabase as of 13 June 2026, with the production frontend and backend aligned at commit `2bfb31d`.

Production smoke validation passed against a controlled assembly target:

- `/bom` loaded as Recipes & Assemblies
- one UI submit created exactly one build
- seven component issue movements and one finished-item receipt movement were created
- all assembly movements were linked through `ref_type = 'BUILD'` and the generated build id
- component stock decreased and finished stock increased according to the BOM quantities
- no stock bucket became negative
- duplicate stock bucket detection returned zero rows
- weighted-average cost updated according to the existing rollup policy
- `items.unit_price` remained unchanged and separate from inventory cost
- one `posting_requests` row recorded the successful `assembly.build` result
- production Postgres logs showed no relevant error during the smoke window

The follow-up durable success confirmation on `/bom` is a UI feedback improvement only. It does not change posting authority, request-key generation, idempotency behavior, valuation, stock movement insertion, finance posting, POS, PO receiving, opening-stock import, sales shipping, manual movements, access control, Platform Control, or subscriptions.

## Phase A2.4a.1 Normal Web POS Idempotency

Phase A2.4a.1 starts the governed-posting expansion beyond assembly by adding an idempotent wrapper for normal web Point of Sale posting.

Release boundary:

- this package is live and production-smoke validated as of 14 June 2026
- hosted migration `20260613144412_add_idempotent_operator_sale.sql` is applied, and the production frontend is aligned at commit `80c7c70`
- the legacy POS RPCs remain executable during the compatibility window

What changed:

- `post_operator_sale` wraps the existing POS sale-and-settlement backend transaction with `posting_requests`
- the operation type is `operator.sale`
- same-key/same-payload replay returns the original sales order result without creating another sales order, sales-order line, stock movement, or settlement
- same-key/changed-payload requests are rejected before business rows are created
- the web POS flow now calls `post_operator_sale`
- POS commercial pricing remains based on `items.unit_price` or the operator's explicit line price override, not inventory cost
- production smoke submitted exactly one controlled cash sale for `Leny Doçuras`, creating one sales order, one line, one issue movement, one cash transaction, and one idempotency request
- the smoke moved stock from `2` to `1`, left `items.unit_price` at `1500`, created no duplicate or negative stock bucket, and recorded one succeeded `operator.sale` request referencing the sales order

What did not change:

- no PO receiving, sales-order shipping, opening-stock import, manual receipt/issue, transfer, or adjustment idempotency was added
- no POS pricing policy, stock valuation policy, finance posting, invoice issuance, settlement model, entitlement, Platform Control, company-access, or subscription behavior changed
- the legacy POS RPCs remain temporarily executable for migration/deployment compatibility and stale Tauri clients
- A2.4a.2 must review maintained Tauri/packaged-client posture and then close normal authenticated legacy POS execution

## Consolidated A2.4/A2.5 Governed Stock Posting

The consolidated A2.4/A2.5 package is live and representative production-smoke validated as of 14 June 2026. It moves the remaining maintained stock-posting workflows behind backend-authoritative, transactional, idempotent RPCs.

Release boundary:

- hosted Supabase is aligned through migration `20260614123300_add_governed_manual_stock_posting.sql`
- the production frontend is aligned at commit `51c4fd1 fix(inventory): govern remaining stock postings`
- Vercel production deployment `dpl_AkMrBB8BvcufSRNjDdWTAmXm8WMx` serves the production aliases
- the local finance regression suite passed `24/24` before rollout, including replay, mismatch, authority, concurrency, and failure-path coverage

What changed:

- normal web PO receiving calls `post_purchase_receipt` with operation type `purchase.receive`
- normal web sales shipping calls `post_sales_shipment` with operation type `sales.ship`
- opening-stock import calls `post_opening_stock_import` with operation type `opening_stock.import`
- maintained manual stock posting uses `post_stock_receipt`, `post_stock_issue`, `post_stock_transfer`, and `post_stock_adjustment`
- manual operation types are `stock.receipt`, `stock.issue`, `stock.transfer`, and `stock.adjustment`
- replay of the same request key and payload returns the original result without duplicating document progress or stock movements
- reusing a request key with a changed payload is rejected
- transfer posting creates both sides atomically or neither side
- adjustment posting remains movement-based and append-only
- `stock_movements` remains the ledger and `stock_levels` remains trigger-derived

Production smoke:

- `purchase.receive` and `stock.adjustment` passed earlier in the rollout on controlled `Leny Doçuras` data
- `stock.transfer` moved one `Bolo de Custarde` from `Casa / CDC001 - Cozinha - Casa` to `Casa / QA-A2 - A2 Production Smoke`, creating one `stock.transfer` request and two balanced movements
- `sales.ship` shipped controlled order `LEN-SO000000002` from the QA bin, creating one `sales.ship` request and one issue movement without creating an invoice or settlement
- duplicate stock buckets and negative stock rows remained zero
- `items.unit_price` remained `1500` and stayed separate from inventory cost
- no replay or payload-mismatch tests were performed in production; those paths remain covered by the local `24/24` regression suite

What did not change:

- no Production Runs, Growth Batches, Cost Analysis Dashboard, Advanced Allocation, or Industry Templates were implemented
- no POS legacy RPC revocation was included; A2.4a.2 remains deferred
- no POS pricing policy, stock valuation policy, finance posting, invoice issuance, settlement model, entitlement, Platform Control, company-access, or subscription behavior changed
- reversals remain compensating movements rather than edits or deletes to posted movements

Production Runs are no longer blocked by A2.4/A2.5. A2.4a.2 remains a separate compatibility/authority-closure package for legacy POS RPC execution and stale Tauri clients.

## Production Runs Live Package

The first complete Production Runs package is live and production-smoke validated as of 18 June 2026. Its rollout aligned hosted Supabase through `20260615213640_add_production_run_posting.sql`, and the production frontend was commit `4f82c5a feat(production): add governed production runs`. Current hosted migration history now continues through the Growth Batches G3 migration `20260620132656_add_growth_batch_stock_input_posting.sql`.

Live migrations:

- `20260615213636_add_production_runs_foundation.sql`
- `20260615213640_add_production_run_posting.sql`

What the package adds:

- company-scoped `production_runs`, `production_run_inputs`, `production_run_outputs`, `production_run_extra_costs`, and `production_run_counters`
- `/production-runs` as the planned-versus-actual production workspace
- draft creation from an active BOM, draft editing, draft cancellation, non-mutating preview, idempotent posting, and controlled reversal
- posting operation type `production.run.post`
- reversal operation type `production.run.reverse`
- frozen snapshots for BOM identity/version, actual input quantities, source locations, input WAC, material cost, extra direct costs, output quantity, output unit cost, movement links, actor, and timestamp
- additional direct costs in `labour`, `utilities`, `overhead`, `transport`, or `other` categories

Costing and audit rules:

- `stock_movements` remains the append-only stock ledger
- `stock_levels` remains trigger-derived and is never updated directly by Production Runs
- posting creates one input issue per actual consumed input and one finished-output receipt, all linked with `ref_type = 'PRODUCTION_RUN'`
- reversal creates compensating stock movements linked with `ref_type = 'PRODUCTION_RUN_REVERSAL'`; it does not update or delete the original movements
- additional direct costs are memo production-cost snapshots only and do not create cash, bank, AP, vendor-bill, or journal postings
- `items.unit_price` remains the commercial selling price and is not derived from Production Run cost
- current `/bom` quick assembly remains available as the simple stock transformation path
- authenticated clients have read-only table access for Production Run records; all create/edit/cancel/post/reverse mutations go through the maintained RPCs
- first-release Production Run quantities are base-UOM-only. BOM component quantities are interpreted as component item base-UOM quantities, output quantities use the finished item base UOM, and general UOM conversion remains deferred.
- a fresh readiness preview is required after material draft changes before posting, and reversal requires typing the exact run reference in the UI

Reversal limitations:

- only `posted` runs can be reversed
- MANAGER+ authority is required
- a reason is required
- reversal is blocked when the finished output is no longer available in the original destination bucket
- intervening stock activity means current bucket weighted-average cost may not return exactly to its historical pre-run value

Production smoke result:

- controlled setup used maintained manual receipt to add 3 `Fermento` to `Leny Doçuras / Casa / CDC001`
- Production Run `LEN-PR000000001` posted once for one `Bolo de Custarde` from recipe `Bolo Custarde` v1
- posting created one succeeded `production.run.post` request, seven input issues, and one output receipt
- immediate reversal created one succeeded `production.run.reverse` request, one compensating output issue, and seven compensating input receipts
- Fermento source stock returned to `3`, QA output stock returned to `0`, duplicate/negative stock checks stayed zero, `items.unit_price` remained `1500`, and no finance rows were created by Production Runs
- production replay and payload-mismatch tests were not run; those remain covered by the local `26/26` regression suite

## Growth Batches G1-G2 Live Package

Growth Batches G1-G2 is live and production-smoke validated as of 20 June 2026. Its rollout aligned hosted Supabase through `20260619175129_add_growth_batch_lifecycle_events.sql`; current hosted Supabase has 30 active migrations through `20260620132656_add_growth_batch_stock_input_posting.sql`.

Live migrations:

- `20260619175117_add_growth_batches_foundation.sql`
- `20260619175129_add_growth_batch_lifecycle_events.sql`

What the package adds:

- `growth_batches`, `growth_batch_counters`, `growth_batch_events`, `growth_batch_measurements`, and `growth_batch_direct_costs`
- read models for the register, current state, event timeline, measurement history, and direct-cost history
- `/growth-batches` as a premium register/detail workspace with desktop table and Android card views
- draft create/edit, draft cancellation, activation, measurement recording, and memo direct-cost recording
- operation types `growth.batch.create`, `growth.batch.activate`, `growth.batch.cancel`, `growth.batch.measurement`, and `growth.batch.cost`
- public RPCs `create_growth_batch_draft`, `update_growth_batch_draft`, `cancel_growth_batch_draft`, `activate_growth_batch`, `record_growth_batch_measurement`, and `record_growth_batch_direct_cost`

G1-G2 rules:

- Growth Batches are group-level, not individual-animal/plant inventory records.
- mutation is RPC-only; authenticated table mutation is blocked.
- count-basis opening quantities must be whole numbers.
- quantities use canonical text UOM IDs. Count, weight, area, and other maintained UOM choices are validated, but no generic conversion engine is introduced.
- optional numeric idempotency hashes preserve omitted/null/zero distinctions while treating equivalent numeric forms such as `1`, `1.0`, and `1.00` as the same payload.
- total-weight and average-weight measurements require the frozen batch `weight_uom_id` and are displayed with that UOM. Area observations require the batch area unit. Temperature can be negative; other non-temperature measurements remain non-negative.
- batch start date is the operational lifecycle boundary. Activation rejects future starts, and measurement/direct-cost effective dates must be on or after the start date and not in the future.
- histories expose event sequence, effective date, server-created timestamp, and event id; callers order histories explicitly.
- measurements do not alter population counts; total-weight measurements update latest total weight.
- direct costs are memo rollups only and create no finance, settlement, bill, journal, invoice, stock, COGS, or `items.unit_price` changes.
- physical stock inputs and event-specific stock-input reversal are live in G3. Mortality, transfers, harvest/split outputs, completion, whole-batch reversal, fair value, FIFO, and COGS remain future G4/G5 scope.

Production smoke result:

- controlled UI smoke used tenant `Leny Doçuras`, company id `b49089cc-af95-44a6-bdff-45faec9d7bc5`, Admin user context `Samuel Massinga`, and location `Casa / QA-A2 - A2 Production Smoke`
- retained batch `LEN-GB000000001` (`14490729-afa2-461a-a2f8-5f97afc745a5`) remains active as rollout evidence
- final state is opening/current quantity `10 EA`, latest total weight `10 KG`, material cost `MZN 0.00`, direct cost `MZN 1.00`, total cost `MZN 1.00`, harvested cost `MZN 0.00`, and remaining cost `MZN 1.00`
- draft creation and notes edit used the maintained UI; the backend generated the reference, and the draft edit created no lifecycle event
- activation event `a8106b7a-a5a2-438b-9dbd-02f0b3b6115b` used sequence `1`
- total-weight measurement event `d924afa0-53d0-4314-a7d3-1fad1326b98d` with detail `db5ecb06-065b-4c09-a20f-6f1634b2f3f8` used sequence `2`
- Water memo direct-cost event `be3a0b50-46f9-4f25-bf27-0f1ce4723b7b` with detail `7d7614dd-a916-4e3f-9aeb-ebc77b8a2dfa` used sequence `3`
- succeeded posting requests were recorded for `growth.batch.create`, `growth.batch.activate`, `growth.batch.measurement`, and `growth.batch.cost`
- production idempotency persistence was verified through succeeded posting requests and non-duplicated events/details; replay, mismatch, concurrency, and failure behavior remain covered by the guarded local `31/31` regression suite
- Growth Batch row counts moved `0 -> 1`, events `0 -> 3`, measurements `0 -> 1`, direct costs `0 -> 1`, and posting requests `9 -> 13`
- stock remained unchanged (`stock_movements` `53 -> 53`, `stock_levels` `9 -> 9`)
- finance remained unchanged (`cash_transactions` `4 -> 4`, `bank_transactions` `0 -> 0`, `vendor_bills` `1 -> 1`, `sales_invoices` `0 -> 0`, `finance_document_events` `5 -> 5`)
- `items.unit_price` sum stayed `2500`, and hash `042919f464f3830a8a7c17791d9a43e7` remained unchanged

The BOM workflow-card spacing correction in this package is UI-only and does not change BOM posting, planning, costing, or stock logic.

## Growth Batches G3 Live Stock-Input Package

Growth Batches G3 is live and production-smoke validated as of 2026-06-22. Hosted production has 30 active migrations through `20260620132656_add_growth_batch_stock_input_posting.sql`, and the production frontend is deployment `dpl_CPHfKuoWcZ1eEMLrFXjv3cSFCu3i` at commit `58e8a083c29d70d3b72aa755a80336393bcbb268`. The rollout applied:

- `20260620132646_add_growth_batch_stock_inputs.sql`
- `20260620132656_add_growth_batch_stock_input_posting.sql`

G3 scope:

- non-mutating stock-input preview for active Growth Batches
- atomic multi-line physical stock consumption through append-only `stock_movements` issues
- frozen source WAC snapshots stored on immutable stock-input detail rows
- material, total, and remaining Growth Batch rollups recalculated from immutable stock-input/reversal details plus existing memo direct costs
- append-only stock-input history and event timeline entries
- MANAGER+ event-specific compensating reversal through append-only receipt movements
- backend idempotency through `growth.batch.input` and `growth.batch.input.reverse`
- frontend stock-input preview/post/history/reversal workflow

G3 cost boundary:

- consumed item lines are base-UOM-only and must use `items.base_uom_id`
- Growth Batch primary quantity UOM, weight UOM, area UOM, and consumed item UOM remain separate domains
- no generic UOM conversion is introduced
- stock-input source WAC becomes Growth Batch material cost
- G1-G2 memo direct costs remain separate non-financial cost records
- G3 does not create cash transactions, bank transactions, vendor bills, settlements, invoices, supplier liabilities, finance journals/events, automatic COGS, or `items.unit_price` changes

Movement references:

- stock-input issues use `GROWTH_BATCH_INPUT`, the stock-input event id as `ref_id`, and the input detail id as `ref_line_id`
- compensating reversal receipts use `GROWTH_BATCH_INPUT_REVERSAL`, the reversal event id as `ref_id`, and the reversal detail id as `ref_line_id`
- original issue movements and original Growth Batch events remain immutable
- intervening stock activity means a reversal restores quantity and records the original frozen receipt value, but the current bucket WAC may not return exactly to its historical pre-input value

Validation and production smoke:

- local replay applied all 30 migrations
- Growth Batches targeted regression passed `5/5`; complete finance regression passed `31/31`
- independent implementation inspection passed
- authenticated local visual QA passed at `1440`, `1200`, `820`, and `390` in light and dark mode
- isolated local QA used company `G3 Visual QA Local 20260621120349`, batch `G3 Visual Batch 20260621120349`, reference `GVI-GB000000001`, and stock-input event `GVI-GB000000001-E000002`
- visual QA verified valid preview, stale-preview protection, duplicate source-line rejection, insufficient-stock blocking, governed OPERATOR+ posting, stock-input history, MANAGER+ event-specific reversal with mandatory reason, compensating receipt, and preserved original issue event/movement
- observed local values were `100 EA` starting stock, frozen WAC `MZN 2.50`, posted material cost `MZN 12.50`, cost after reversal `MZN 0.00`, and restored stock `100 EA at MZN 2.50 WAC`
- GitHub Validation run `27930016751` passed for commit `58e8a083c29d70d3b72aa755a80336393bcbb268`
- production smoke used tenant `Leny Doçuras`, batch `LEN-GB000000002`, item `OV002 - Ovo`, UOM `EA - Each`, and source `WH001 - Casa / CDC001 - Cozinha - Casa`; no dedicated QA bin was used
- preview displayed source availability `48 EA`, base UOM `EA`, estimated WAC `MZN 10.30`, and estimated material cost `MZN 10.30` without creating a movement or request
- posting consumed `1 EA`, froze WAC `10.304233`, created input event `LEN-GB000000002-E000002`, detail `6837d2a6-7e29-4a7d-acb1-d3b7e352944c`, issue movement `3fe172dd-adc5-44e5-8ec6-7587420078fa`, and succeeded request `e32dcf72-755d-4d1f-86c8-1e96e9fd761b`
- reversal used mandatory reason `Controlled G3 production smoke reversal`, created event `LEN-GB000000002-E000003`, detail `03b1dd13-cf49-4aa5-abab-6de06aa765a6`, receipt movement `48ce328c-fdc9-4383-a0d5-11164fb0da7f`, and succeeded request `efd1c065-3d29-4185-8b1d-a216e0e7d80e`
- source stock moved `48 -> 47 -> 48`, material cost moved `MZN 0.00 -> MZN 10.304233 -> MZN 0.00`, memo direct cost stayed `MZN 0.00`, negative stock and duplicate bucket checks stayed zero, finance rows stayed unchanged, and `items.unit_price` sum/hash stayed unchanged

Still future:

- mortality and shrinkage
- transfers
- harvest and split/partial harvest
- completion
- whole-batch reversal
- FIFO biological layers
- fair-value accounting
- COGS
- automatic finance posting
- vendor-bill allocation
- supplier liabilities
- cash/bank settlement
- profitability dashboards
- per-animal or per-plant records

Cost Analysis Dashboard, Advanced Allocation, recurring allocation, overhead pools, and Industry Templates remain future scope.
