# StockWise Data Model

This document records the current schema truth after the canonical baseline reset and the first cleanup pass on top of it.

## What Is Canonical

### Company membership and access

Canonical structures:

- `companies`
- `company_members`
- `member_role`
- `member_status`
- `profiles`
- `user_active_company`
- `company_subscription_state`
- `platform_admins`

Current rules:

- company membership and authority live in `company_members`
- company role semantics use `member_role`
- company role definitions are exposed in the app under Users > Role definitions and must stay aligned with the checks in `src/lib/roles.ts` and `src/lib/permissions.ts`
- company roles are `OWNER`, `ADMIN`, `MANAGER`, `OPERATOR`, and `VIEWER`; the UI explains practical can/cannot-do boundaries without inventing permissions that are not enforced
- user profile and sign-in metadata live in `profiles`
- `profiles.phone_number` is an optional user contact field captured from signup/profile edits; it is not used for authentication, invitation matching, membership, tenant selection, or entitlement
- active company context lives in `user_active_company`
- entitlement state lives in `company_subscription_state`
- platform-admin access is separate via `platform_admins` and is not granted by company ownership or membership role

Legacy structures removed in cleanup:

- `user_profiles`
- `company_role`

### Inventory and stock truth

Canonical structures:

- `items`
- `items_view`
- `warehouses`
- `bins`
- `stock_movements`
- `stock_levels`
- `posting_requests`
- `boms`
- `bom_components`

Current rules:

- `stock_movements` is the canonical stock ledger
- `stock_levels` is the derived rollup used for availability and weighted-average bucket cost
- stock movement trigger rollups use atomic negative-delta guards and receipt upserts so concurrent issue/receipt inserts cannot lose bucket updates or silently overdraw stock
- `posting_requests` is the reusable company-scoped backend idempotency ledger for posting workflows; it covers assembly, normal web Point of Sale, PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, adjustment, Production Run post/reversal, and Growth Batch create/activate/cancel/measurement/direct-cost/stock-input/loss/transfer/reversal workflows.
- application code that records a stock receipt, issue, transfer, or adjustment should insert the `stock_movements` row and let database triggers update `stock_levels`; it should not also mutate `stock_levels` directly for the same event
- assembly posting uses `build_from_bom` or the hardened source-split `build_from_bom_sources` path; both create `stock_movements` rows with `ref_type = 'BUILD'` and a build `ref_id`
- idempotent assembly posting uses `post_build_from_bom` and `post_build_from_bom_sources`; repeated calls with the same request key and same payload return the original build id, while reused keys with changed payloads are rejected
- idempotent normal web POS posting is implemented in the A2.4a.1 package through `post_operator_sale` with operation type `operator.sale`; repeated calls with the same request key and same payload return the original sales order result, while reused keys with changed payloads are rejected
- the consolidated A2.4/A2.5 package adds dedicated governed posting RPCs for the remaining maintained stock-posting workflows: `post_purchase_receipt` (`purchase.receive`), `post_sales_shipment` (`sales.ship`), `post_opening_stock_import` (`opening_stock.import`), `post_stock_receipt` (`stock.receipt`), `post_stock_issue` (`stock.issue`), `post_stock_transfer` (`stock.transfer`), and `post_stock_adjustment` (`stock.adjustment`)
- these RPCs preserve `stock_movements` as the append-only ledger and `stock_levels` as the trigger-derived rollup; replay cannot duplicate stock or document progress, and same-key/changed-payload requests are rejected before business rows are created
- helper RPCs such as `inv_issue_component` and `inv_receive_finished` are legacy/internal utilities, not normal client-facing assembly APIs
- canonical UOM identifiers remain text (`uoms.id`, `items.base_uom_id`, and `stock_movements.uom_id`); opening-stock import must preserve text IDs such as `uom_ea` and must not cast them to UUID
- legacy POS RPCs remain temporarily executable for deployment and stale-client compatibility; A2.4a.2 must close normal authenticated legacy execution after frontend and Tauri distribution posture is reviewed
- maintained frontend PO receiving, sales-order shipping, opening-stock import, and manual movement flows are moved behind dedicated RPC/idempotency boundaries in the consolidated A2.4/A2.5 package; production rollout and representative smoke validation completed on 2026-06-14
- remaining direct movement access is limited to read/reporting paths, local regression setup fixtures, and stale or legacy helper surfaces. `src/lib/sales.ts` still contains an old direct stock-movement helper with no maintained frontend caller; legacy POS RPC closure remains A2.4a.2.
- `movements` is no longer part of the intended product direction
- the `/movements` UI is a register over `stock_movements`, not a separate data model; visual filtering, badges, and mobile cards must not imply manual `stock_levels` posting or a different costing policy

Legacy structures removed in cleanup:

- `movements`

### Item commercial pricing

Current commercial default:

- sellable items store the default sell price in `items.unit_price`
- `items_view.unitPrice` exposes it to the app
- Point of Sale prefills line pricing from `items.unit_price`
- Point of Sale never uses stock cost or weighted-average valuation as the default sell price
- assembly material cost estimates and build receipt unit costs must not mutate `items.unit_price`

### Walk-in / cash sale model

Current rule:

- quick store-counter sales default to the company cash customer
- the A2.4a.1 web POS cutover calls `post_operator_sale(...)`, which delegates to the existing sale-and-settlement RPC path and creates or reuses the cash customer when a named customer is not selected
- named customer override is optional

## Settings Models

These tables are both still active and intentionally retained for now:

- `company_settings`
  - company-scoped structured JSON and finance/reminder configuration
- `app_settings`
  - app-level shared JSON configuration and fallback behavior still used by current code
- `settings`
  - smaller legacy config table still used by current app code for base-currency and report-source behavior

`settings` and `app_settings` are not clean enough to consolidate blindly in this pass because both are still used by live code paths. Future consolidation should happen only with a deliberate forward migration and code cutover.

## Finance and settlement anchors

Canonical active anchors:

- AR: issued sales invoices
- AP: posted vendor bills

Legacy orders may still appear as history or operational parents, but reconciliation and settlement truth now follow finance-document anchors.

## Current design summary

One clean model per responsibility:

- membership/roles: `company_members` + `member_role`
- user profile/sign-in state: `profiles`
- active company: `user_active_company`
- stock ledger: `stock_movements`
- posting idempotency: `posting_requests` for assembly, normal web POS, consolidated A2.4/A2.5 stock-posting RPCs, Production Run post/reversal, and Growth Batch create/activate/cancel/measurement/direct-cost/stock-input/loss/transfer/reversal operations
- item default sell price: `items.unit_price`

## Production Runs

The Production Runs package adds a planned-versus-actual production model. It is live as of 2026-06-18; its rollout aligned hosted Supabase through `20260615213640_add_production_run_posting.sql`. Current hosted migration history now continues through Growth Batches G3 at `20260620132656_add_growth_batch_stock_input_posting.sql`.

Tables:

- `production_runs` stores the header, reference, BOM snapshot, finished item, planned/actual output, destination, status, cost totals, movement links, actor timestamps, and reversal metadata.
- `production_run_inputs` stores deterministic input lines, source BOM component links, input item/UOM, planned and actual quantities, source bucket, frozen input WAC, frozen input total, original issue movement, and reversal receipt movement.
- `production_run_outputs` stores output lines. The first UI supports exactly one primary finished output, while the table shape leaves room for future multi-output/by-product expansion.
- `production_run_extra_costs` stores additional direct production-cost snapshots in `labour`, `utilities`, `overhead`, `transport`, or `other` categories.
- `production_run_counters` generates non-fiscal company-scoped production run references.

Lifecycle:

- `draft`: editable by OPERATOR+ through `update_production_run_draft`.
- `posted`: immutable production result; stock movements and cost snapshots are frozen.
- `reversed`: original posted run remains auditable and compensating movements are linked.
- `cancelled`: draft-only closure with no stock movement.
- normal authenticated clients can read company-scoped Production Run rows but cannot directly insert, update, or delete Production Run business rows; mutation is RPC-only.
- first-release Production Run input and output quantities use each item base UOM. `production_run_inputs.uom_id`, `production_run_outputs.uom_id`, and `production_runs.output_uom_id` must match the relevant item `base_uom_id`; general UOM conversion is deferred.

Posting and reversal:

- `post_production_run` uses operation type `production.run.post`.
- `reverse_production_run` uses operation type `production.run.reverse`.
- both use `posting_requests`, mandatory request keys, deterministic payload hashes, replay safety, and payload-mismatch rejection.
- posting writes input issues and one output receipt with `ref_type = 'PRODUCTION_RUN'`.
- reversal writes compensating output issue and input receipts with `ref_type = 'PRODUCTION_RUN_REVERSAL'`.
- neither path mutates `stock_levels` directly or updates `items.unit_price`.

Additional direct costs do not create bank, cash, supplier, vendor-bill, or journal rows. They are cost snapshots used to calculate total production cost and output unit cost.
- entitlement/control plane: `company_subscription_state` + `platform_admins`

Production smoke validation posted and immediately reversed Production Run `LEN-PR000000001` for `Leny Doçuras`. The post created seven input issues and one output receipt; the reversal created one compensating output issue and seven input receipts. Fermento source stock returned to `3`, the controlled output QA bucket returned to `0`, duplicate and negative stock checks stayed zero, and the finished item `items.unit_price` remained `1500`.

## Growth Batches

Growth Batches add a live group-level batch lifecycle for biological and agricultural work. Hosted Supabase is aligned through `20260620132656_add_growth_batch_stock_input_posting.sql`; production frontend commit `58e8a083c29d70d3b72aa755a80336393bcbb268` exposes the maintained `/growth-batches` route through Vercel deployment `dpl_CPHfKuoWcZ1eEMLrFXjv3cSFCu3i`.

Tables:

- `growth_batches` stores the header, reference, family, primary quantity basis, opening/current quantity, optional opening/latest total weight, `weight_uom_id`, optional area/`area_uom_id`, location, status, memo cost rollups, and actor timestamps.
- `growth_batch_counters` generates company-scoped non-fiscal references such as `LEN-GB000000001`.
- `growth_batch_events` stores immutable activation, measurement, direct-cost, and cancellation events with per-batch sequence numbers.
- `growth_batch_measurements` stores typed immutable measurement details.
- `growth_batch_direct_costs` stores immutable memo direct-cost details.

Read models:

- `growth_batches_register`
- `growth_batch_current_state`
- `growth_batch_event_timeline`
- `growth_batch_measurement_history`
- `growth_batch_direct_cost_history`
- `growth_batch_stock_input_history`

Public RPCs:

- `create_growth_batch_draft`
- `update_growth_batch_draft`
- `cancel_growth_batch_draft`
- `activate_growth_batch`
- `record_growth_batch_measurement`
- `record_growth_batch_direct_cost`
- `preview_growth_batch_stock_input`
- `post_growth_batch_stock_input`
- `reverse_growth_batch_stock_input`

Lifecycle:

- `draft`: editable by OPERATOR+ through `update_growth_batch_draft`.
- `active`: accepts measurements and memo direct costs.
- `cancelled`: draft-only closure with a required reason.
- `completed` is reserved for a later phase and is not exposed by G1-G2 workflows.

Mutation rules:

- normal authenticated clients can read company-scoped Growth Batch rows but cannot directly insert, update, or delete Growth Batch business rows.
- mutation is RPC-only through `create_growth_batch_draft`, `update_growth_batch_draft`, `cancel_growth_batch_draft`, `activate_growth_batch`, `record_growth_batch_measurement`, `record_growth_batch_direct_cost`, `post_growth_batch_stock_input`, `reverse_growth_batch_stock_input`, `record_growth_batch_loss`, and `reverse_growth_batch_loss`; stock-input and loss previews are also RPC-only and non-mutating.
- create, activate, cancel, measurement, and direct-cost actions use `posting_requests` request keys and deterministic structured JSON payload hashes. Optional numeric fields preserve omitted/null/zero distinctions while normalizing equivalent numeric representations such as `1`, `1.0`, and `1.00`.
- count-based batches require whole-number primary quantities.
- primary quantities are recorded in selected UOMs with family validation; generic conversion is deferred.
- total-weight and average-weight measurements require the batch `weight_uom_id` and must use that UOM. Opening/latest total weight is always displayed with its UOM.
- area observations require the batch `area_uom_id`. Height requires a length-family UOM. Temperature and `other` measurements require an existing UOM but do not claim full physical-dimension validation in G1-G2.
- temperature observations may be negative; weights, areas, heights, sample sizes, and other non-temperature measurement values remain non-negative.
- measurement and memo direct-cost effective dates must be on or after the batch `start_date` and not later than the current date. `event_at`/`created_at` remain server-authoritative timestamps.
- history views expose `event_sequence`, `event_effective_date`, `event_created_at`, and `event_id`; callers must request an explicit order.
- direct costs update Growth Batch memo rollups only and do not create stock, COGS, AP, AR, cash, bank, settlement, journal, invoice, or `items.unit_price` changes.
- G3 physical stock inputs and event-specific input reversal are live. G4.1 mortality/shrinkage preview, recording, and event-specific reversal are live. G4.2 full-batch operational location transfer is implemented locally only and is not hosted/live. Harvest/split outputs, completion, whole-batch reversal, fair value, FIFO, and COGS remain future phases.

Production smoke retained active batch `LEN-GB000000001` (`14490729-afa2-461a-a2f8-5f97afc745a5`) for `Leny Doçuras`. The smoke verified draft create/edit, activation, one total-weight measurement, one memo direct cost, event sequences `1` activation, `2` measurement, and `3` direct cost, and reconciled the register/current-state/timeline/measurement/direct-cost read models. It created no stock movement, no finance posting, no settlement, no invoice, and no `items.unit_price` change.

### Growth Batches G3 Live Stock Inputs

G3 extends Growth Batches for stock-input posting and is live after the 2026-06-22 database-first rollout. At that rollout, hosted production reached 30 migrations through:

- `20260620132646_add_growth_batch_stock_inputs.sql`
- `20260620132656_add_growth_batch_stock_input_posting.sql`

G3 schema additions:

- `growth_batch_stock_inputs` stores immutable input detail lines with item, base UOM, quantity, source warehouse/bin, frozen WAC unit cost, frozen total material cost, issue movement id, notes, actor, and timestamp.
- `growth_batch_stock_input_reversal_lines` stores immutable compensating reversal detail lines tied to the original stock-input line and receipt movement.
- `growth_batch_stock_input_history` exposes event sequence, effective date, server timestamp, actor, item/SKU, quantity/UOM, source bucket, frozen costs, issue movement, reversal state, reversal event, reversal actor, reason, and receipt movement.
- `growth_batch_events` gains `stock_input` and `stock_input_reversal` event types and a narrow original-event relationship for stock-input reversals.

G3 RPCs:

- `preview_growth_batch_stock_input(uuid, date, jsonb, text)` returns readiness, blocker details, current availability, WAC estimates, line costs, and projected Growth Batch rollups without creating events, details, posting requests, stock movements, or finance rows.
- `post_growth_batch_stock_input(uuid, date, jsonb, text, text)` creates one `stock_input` event, one detail row per canonical line, one stock issue movement per line, a succeeded `growth.batch.input` request, and recalculated material/total/remaining rollups.
- `reverse_growth_batch_stock_input(uuid, date, text, text)` is MANAGER+ only and creates one `stock_input_reversal` event, one reversal line per original detail, compensating stock receipt movements using original quantities and frozen costs, a succeeded `growth.batch.input.reverse` request, and recalculated rollups.

G3 stock inputs are base-UOM-only: each consumed line must use `items.base_uom_id`. The consumed stock UOM is independent from the batch primary quantity UOM, `weight_uom_id`, and `area_uom_id`; no conversion is performed. Source WAC is frozen as Growth Batch material cost, while memo direct costs remain separate and non-financial. Stock input and reversal movements use event-specific references (`GROWTH_BATCH_INPUT` / `GROWTH_BATCH_INPUT_REVERSAL`) with the Growth Batch event as `ref_id` and the typed detail row as `ref_line_id`.

Pre-rollout validation passed with 30-migration replay, Growth Batches regression `5/5`, complete finance regression `31/31`, independent implementation inspection, authenticated local visual QA, static checks, build, and GitHub Validation run `27930016751`. Production smoke used `Leny Doçuras` batch `LEN-GB000000002`, input event `LEN-GB000000002-E000002`, reversal event `LEN-GB000000002-E000003`, item `OV002 - Ovo`, and `1 EA` from `WH001 - Casa / CDC001 - Cozinha - Casa`. Frozen WAC was `10.304233`; material cost moved `0 -> 10.304233 -> 0`; source stock moved `48 -> 47 -> 48`; issue movement `3fe172dd-adc5-44e5-8ec6-7587420078fa` and receipt movement `48ce328c-fdc9-4383-a0d5-11164fb0da7f` kept the original issue immutable. No cash, bank, vendor bill, invoice, finance-event, settlement, or `items.unit_price` mutation occurred.

G3 still does not add mortality, shrinkage, transfers, harvest/split outputs, completion, whole-batch reversal, FIFO biological layers, COGS, fair value, automatic finance posting, vendor-bill allocation, supplier liabilities, cash/bank settlement, profitability dashboards, per-animal/per-plant records, or generic UOM conversion. Mortality and shrinkage are live through the G4.1 package below; transfer, harvest, completion, and valuation scope remains separate.

### Growth Batches G4.1 Live Loss Events

G4.1 is live in production as of 2026-06-28. Local and hosted production migration history both have 32 active migrations through `20260627225414_add_growth_batch_loss_posting.sql`. The release commit is `5a24eb428499d126870883bb5841e3e451cdd178`, GitHub Validation run `28319500331` passed, and Vercel deployment `dpl_FrC2WKJsF1DmosBSu68tahEBhmhU` served the matching frontend.

G4.1 schema additions:

- `growth_batch_losses` stores immutable mortality/shrinkage detail rows with loss type, quantity lost, weight lost, reason code, notes, before/after quantity snapshots, before/after total-weight snapshots, actor, and timestamp.
- `growth_batch_loss_reversal_lines` stores immutable event-specific reversal rows linked to the original loss event and original loss detail. Restored quantity and restored weight must exactly match the original frozen loss values.
- `growth_batch_loss_history` exposes loss event references, sequence, effective date, actor, quantity/weight loss, before/after snapshots, reason, notes, and reversal status/evidence.
- `growth_batch_events` supports `mortality`, `shrinkage`, `mortality_reversal`, and `shrinkage_reversal` while preserving G1-G3 event types.

G4.1 RPCs:

- `preview_growth_batch_loss(uuid, text, date, numeric, numeric, text, text)` validates active batch state, reason codes, count integrality, available quantity, available weight, and resulting rollups without creating events, details, posting requests, stock movements, stock levels, or finance rows.
- `record_growth_batch_loss(uuid, text, date, numeric, numeric, text, text, text)` is OPERATOR+ and creates one mortality or shrinkage event, one immutable loss detail, a succeeded `growth.batch.mortality` or `growth.batch.shrinkage` posting request, and updates only current quantity/current total weight plus event-sequence state.
- `reverse_growth_batch_loss(uuid, text, text)` is MANAGER+ and creates a matching mortality/shrinkage reversal event plus immutable reversal detail. It restores the original frozen quantity and/or weight, blocks second reversal, and blocks reversal where later dependent quantity/weight evidence exists.

Cost and accounting boundary: G4.1 creates no `stock_movements`, does not update `stock_levels`, does not change material cost, memo direct cost, harvested cost, remaining cost, or `items.unit_price`, and creates no cash, bank, vendor bill, sales invoice, settlement, journal, or finance-event rows. Accumulated cost remains with the batch. Harvest/split outputs, completion, FIFO biological layers, COGS, fair value, automatic finance posting, dashboards, and per-animal/per-plant identity remain future scope.

Production smoke retained active batch `LEN-GB000000003` (`452ba7d8-87c2-46dd-b60a-fa95e0ac12b4`) for `Leny Doçuras`. The smoke created and activated the batch with `20 EA` and `40 KG`, then posted and reversed mortality `2 EA` and shrinkage `5 KG` through the maintained UI. Mortality event `LEN-GB000000003-E000002` used detail `27dd3a4b-728d-44fa-9612-842dce37dc10` and request `a056575d-2c0e-4627-8a87-0ac9556f25e4`; mortality reversal `LEN-GB000000003-E000003` used detail `76227fa1-c56b-4c2a-9561-2a15384abbba` and request `d7eff67d-3c22-4524-916b-c8d1fffa4b25`. Shrinkage event `LEN-GB000000003-E000004` used detail `ae735f1e-b526-4c0e-b5a2-79c7254d896b` and request `c4022789-545c-4816-9c75-56638cb4aa16`; shrinkage reversal `LEN-GB000000003-E000005` used detail `f4b234c1-a8d9-4cfa-a0c5-7a6d601ac24f` and request `cf4d8473-5784-46ae-a98a-90e07fc2b433`. Final state restored to `20 EA` and `40 KG`, all Growth Batch cost rollups stayed `0`, stock movements/levels and finance rows were unchanged, negative stock and duplicate bucket checks were `0`, and `items.unit_price` sum stayed `189778` with the stable rollout hash unchanged.
### Growth Batches G4.2 Local Transfer Package

G4.2 is implemented locally and is not hosted/live. Local migration history has 34 active migrations through `20260630170735_add_growth_batch_transfer_posting.sql`; hosted production remains at 32 active migrations through `20260627225414_add_growth_batch_loss_posting.sql`.

G4.2 schema additions:

- `growth_batch_transfers`: one immutable detail row per `transfer` event with source and destination warehouse/bin/description snapshots, current full-batch quantity/weight/area snapshots, and cost snapshots for audit only.
- `growth_batch_transfer_reversal_lines`: one immutable reversal detail per original transfer, enforcing one reversal maximum and matching company/batch/original-event relationships.
- `growth_batch_transfer_history`: read model exposing readable source-to-destination labels, event references/sequences, quantity/weight snapshots, reversal status, and reversal eligibility.

G4.2 RPCs:

- `preview_growth_batch_transfer`: OPERATOR+ non-mutating preview. It returns source-location fingerprint, source/destination labels, unchanged quantity/weight/cost snapshots, and blockers.
- `transfer_growth_batch`: OPERATOR+ full-batch location transfer. It requires a request key and source-location fingerprint, creates one `transfer` event/detail, and updates only `warehouse_id`, `bin_id`, `location_description`, `latest_event_sequence`, `updated_by`, and `updated_at` on the batch.
- `reverse_growth_batch_transfer`: MANAGER+ event-specific transfer reversal. It reverses only the latest unreversed transfer when the batch is still at that transfer destination and the original source remains active.

Cost and accounting boundary: G4.2 creates no `stock_movements`, does not update `stock_levels`, does not change current quantity, latest total weight, material cost, memo direct cost, harvested cost, remaining cost, or `items.unit_price`, and creates no cash, bank, vendor bill, sales invoice, settlement, journal, or finance-event rows. Transport expense remains a separate memo direct-cost event through the existing direct-cost workflow.
