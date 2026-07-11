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

Production Runs, Growth Batches G3 stock-input posting, Growth Batches G4.1 mortality/shrinkage, Growth Batches G4.2 full-batch operational location transfer, Growth Batches G5.1 governed depleting harvest, and Growth Batches G5.2 completion are live foundations. Remaining future Production & Costing work includes:

- non-depleting biological yield, split or child batches, and multi-output harvest
- whole-batch reversal
- FIFO biological layers, COGS, and fair-value accounting
- automatic finance posting from production, vendor-bill allocation, and advanced cost allocation. Governed manual settlement/cash/bank posting is live at migration 39, but it does not make production costs post automatically.
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

The first complete Production Runs package is live and production-smoke validated as of 18 June 2026. Its rollout aligned hosted Supabase through `20260615213640_add_production_run_posting.sql`, and the production frontend was commit `4f82c5a feat(production): add governed production runs`. Hosted production and local replay now contain 39 active migrations through `20260709222842_governed_settlement_posting.sql`.

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

Growth Batches G1-G2 is live and production-smoke validated as of 20 June 2026. Its rollout aligned hosted Supabase through `20260619175129_add_growth_batch_lifecycle_events.sql`; later G3 rollout evidence below records the 30-migration checkpoint through `20260620132656_add_growth_batch_stock_input_posting.sql`.

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
- physical stock inputs and event-specific stock-input reversal are live in G3. Mortality/shrinkage are live in G4.1. Full-batch operational location transfer and event-specific transfer reversal are live in G4.2. Governed depleting harvest and event-specific harvest reversal are live in G5.1. Lifecycle completion and event-specific completion reversal are live in G5.2. Split/child batches, non-depleting yield, multi-output harvest, whole-batch reversal, fair value, FIFO, and COGS remain future scope.

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

Growth Batches G3 is live and production-smoke validated as of 2026-06-22. At that rollout, hosted production reached 30 active migrations through `20260620132656_add_growth_batch_stock_input_posting.sql`, and the production frontend was deployment `dpl_CPHfKuoWcZ1eEMLrFXjv3cSFCu3i` at commit `58e8a083c29d70d3b72aa755a80336393bcbb268`. The rollout applied:

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

## Growth Batches G4.1 Live Loss Package

Growth Batches G4.1 is live in production as of 2026-06-28. Local and hosted production migration history both have 32 active migrations through `20260627225414_add_growth_batch_loss_posting.sql`. The database-first rollout applied `20260627225400_add_growth_batch_losses.sql` and `20260627225414_add_growth_batch_loss_posting.sql`, release commit `5a24eb428499d126870883bb5841e3e451cdd178`, Vercel deployment `dpl_FrC2WKJsF1DmosBSu68tahEBhmhU`, and GitHub Validation run `28319500331`.

G4.1 adds mortality and shrinkage as operational loss events for active Growth Batches:

- `growth_batch_losses` stores immutable mortality/shrinkage detail rows with before/after quantity and total-weight snapshots.
- `growth_batch_loss_reversal_lines` stores immutable event-specific reversal evidence.
- `growth_batch_loss_history` exposes loss and reversal status for the maintained `/growth-batches` UI.
- `preview_growth_batch_loss`, `record_growth_batch_loss`, and `reverse_growth_batch_loss` keep mutation RPC-only, with OPERATOR+ recording and MANAGER+ reversal.
- operation types are `growth.batch.mortality`, `growth.batch.shrinkage`, `growth.batch.mortality.reverse`, and `growth.batch.shrinkage.reverse`.

Costing boundary:

- losses reduce only current batch quantity and/or latest total weight.
- accumulated material and memo direct costs remain with the batch.
- no mortality valuation, cost write-off, COGS, fair-value treatment, finance journal, vendor bill, settlement, invoice, stock movement, `stock_levels` update, or `items.unit_price` change is introduced.
- reversal restores the original frozen quantity and/or weight by compensating event; original loss rows remain immutable.

Controlled production smoke used tenant `Leny Doçuras` and batch `LEN-GB000000003` (`452ba7d8-87c2-46dd-b60a-fa95e0ac12b4`) with `20 EA` and `40 KG`. Batch creation request `ac481ab0-318e-491e-ba0c-065e2b216924`, activation request `e0f85361-d4f0-427b-bc6f-63f8f3ae071b`, and activation event `LEN-GB000000003-E000001` succeeded. Mortality `2 EA` created event `LEN-GB000000003-E000002`, detail `27dd3a4b-728d-44fa-9612-842dce37dc10`, and request `a056575d-2c0e-4627-8a87-0ac9556f25e4`; mortality reversal created event `LEN-GB000000003-E000003`, reversal detail `76227fa1-c56b-4c2a-9561-2a15384abbba`, and request `d7eff67d-3c22-4524-916b-c8d1fffa4b25`, restoring quantity `18 -> 20 EA`.

Shrinkage `5 KG` created event `LEN-GB000000003-E000004`, detail `ae735f1e-b526-4c0e-b5a2-79c7254d896b`, and request `c4022789-545c-4816-9c75-56638cb4aa16`; shrinkage reversal created event `LEN-GB000000003-E000005`, reversal detail `f4b234c1-a8d9-4cfa-a0c5-7a6d601ac24f`, and request `cf4d8473-5784-46ae-a98a-90e07fc2b433`, restoring weight `35 -> 40 KG`. Final batch cost rollups stayed `MZN 0.00`, stock movements and stock levels were unchanged, finance rows were unchanged, negative stock and duplicate bucket checks stayed `0`, and `items.unit_price` stayed unchanged.

## Growth Batches G4.2 Live Transfer Package

Growth Batches G4.2 is live in production as of 2026-07-02. Hosted and local production migration history both have 34 active migrations through `20260630170735_add_growth_batch_transfer_posting.sql`. The package adds full-batch operational location transfer and event-specific transfer reversal only, with no stock movements, stock-level changes, cost write-off, finance posting, or `items.unit_price` change.

The controlled rollout used `Leny Doçuras` batch `LEN-GB000000003`. The initial maintained-UI transfer to `Casa / CDC001` succeeded, but a detail-card layout blocker prevented reliable UI reversal; the batch was restored through the approved authenticated public reversal RPC. After frontend fix commit `c84469100249188144cb6305a634e21fba77a653` deployed, a fresh maintained-UI transfer/reversal completed with events `LEN-GB000000003-E000008` and `LEN-GB000000003-E000009`, restored `Casa / QA-A2`, preserved `20 EA`, `40 KG`, active status, and zero cost rollups, and left stock, finance, negative/duplicate stock checks, and selling price unchanged. Production replay, payload-mismatch, authority-negative, and concurrency tests remain covered by local regression rather than production smoke.

Still future:

- split/child batches, non-depleting yield, and multi-output harvest
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

## Growth Batches G5.1 Live Depleting Harvest Package

Growth Batches G5.1 is live and production-smoke validated as of 2026-07-03. Hosted and local Supabase are aligned at 36 active migrations through `20260702205834_add_growth_batch_harvest_posting.sql`.

G5.1 adds governed partial and full depleting harvest for active Growth Batches:

- one immutable `growth_batch_harvests` detail per harvest event
- one primary stock-tracked output item and one stock receipt movement per harvest
- `growth.batch.harvest` idempotency for posting
- proportional `remaining_cost` transfer into `harvested_cost` for partial harvests
- exact remaining-cost transfer for full harvests so `remaining_cost` becomes zero
- active zero-quantity "fully harvested awaiting completion" state; automatic completion remains future
- MANAGER+ event-specific reversal through `growth.batch.harvest.reverse`, immutable `growth_batch_harvest_reversal_lines`, and one compensating stock issue movement

G5.1 preserves the accounting boundary:

- `accumulated_material_cost`, `accumulated_direct_cost`, and `accumulated_total_cost` remain cumulative historical totals
- harvest changes only current quantity, current total weight where present, `harvested_cost`, `remaining_cost`, audit fields, and latest sequence
- reversal restores only the original quantity, weight, harvested/remaining allocation, audit fields, and latest sequence
- stock effects are append-only movement effects through the existing stock engine; `stock_levels` is not directly updated by Growth Batch code
- no sale, invoice, COGS, FIFO layer, fair-value entry, finance journal, cash, bank, AP, AR, vendor-bill allocation, supplier liability, profitability dashboard, child batch, split batch, non-depleting recurring yield, multi-output/co-product allocation, or `items.unit_price` change is introduced

The 2026-07-03 production rollout applied the two G5.1 migrations, verified the hosted schema/RLS/grant/helper surface, and used controlled tenant `Leny Docuras`, batch `LEN-GB000000003`, and QA item `QA-G51-POULTRY-KG` (`4cb6e677-c44f-4de9-952e-9a8506e5ea73`). Partial harvest `LEN-GB000000003-E000010` (`1 EA`, `2 KG`, output `2 KG`) was reversed by `LEN-GB000000003-E000011`; full harvest `LEN-GB000000003-E000012` (`20 EA`, `40 KG`, output `40 KG`) was reversed by `LEN-GB000000003-E000013`. The full-harvest interim UI showed zero quantity, zero weight, active status, and awaiting completion. Final state restored `20 EA`, `40 KG`, active status, zero costs, and the QA output bucket to `0 KG`; `growth_batch_events`, harvest details, reversal details, posting requests, and stock movements increased by the expected `+4/+2/+2/+4/+4`. The retained zero stock-level row for the QA bucket is expected from the first receipt. Finance/sales counts and pre-existing item selling prices were unchanged; the smoke used a zero-cost batch, so nonzero proportional cost allocation remains covered by local regression.

## Growth Batches G5.2 Live Completion Package

Growth Batches G5.2 is live and production-smoke validated. Hosted production and local replay now contain 39 active migrations through the later governed-settlement migration `20260709222842_governed_settlement_posting.sql`; G5.2 itself remains anchored at `20260704041943_add_growth_batch_completion_posting.sql`.

G5.2 adds governed lifecycle completion after full harvest:

- one immutable `growth_batch_completions` detail per completion event
- one immutable `growth_batch_completion_reversal_lines` detail per event-specific completion reversal
- `growth.batch.complete` idempotency for posting
- `growth.batch.complete.reverse` idempotency for reversal
- `growth_batch_completion_history` read model for lifecycle closeout and reversal state
- completion only when the active batch has zero current quantity, zero current weight where weight exists, and zero remaining cost
- reversal restores only active/completed lifecycle fields

G5.2 preserves the accounting and stock boundary:

- no stock movement and no `stock_levels` update
- no change to current primary quantity, current total weight, area, accumulated material cost, accumulated direct cost, accumulated total cost, harvested cost, remaining cost, or `items.unit_price`
- no sale, invoice, COGS, FIFO layer, fair-value entry, finance journal, cash, bank, AP, AR, vendor-bill allocation, supplier liability, split batch, child batch, whole-batch reversal, profitability dashboard, or individual animal/plant record
- only `status`, `completed_by`, `completed_at`, audit fields, and latest event sequence change under a completion-specific transaction-local guard
