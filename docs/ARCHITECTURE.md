# StockWise Architecture

This document describes the current application shape after the canonical migration reset, schema cleanup, Platform Control hardening, Point of Sale work, and onboarding/import pass.

## Application Shape

StockWise is a React + TypeScript application backed by Supabase and packaged for web first, with Tauri desktop and Android shells consuming the same frontend.

Primary layers:

- routes and feature workspaces under `src/pages`
- shared UI, layout, and brand components under `src/components`
- premium UI primitives for cockpit pages and operational registers under `src/components/premium`
- workflow helpers, data mappers, and commercial/access helpers under `src/lib`
- Supabase schema, policies, RPCs, views, and Edge Functions under `supabase`
- Tauri desktop and Android shell metadata under `src-tauri`

## Current Product Surfaces

The maintained product surfaces are:

- dashboard and operational review
- premium dashboard cockpit for operating status, action needed, recent activity, and shipment-linked performance
- premium register primitives applied first to Items and Stock Levels, with desktop tables and Android card lists sharing sorting, filtering, pagination, and status presentation patterns
- premium onboarding and administration surfaces for explicit company setup, backed Settings navigation, and canonical Users/Roles review
- Point of Sale for fast small-store counter sales with a default walk-in / cash customer
- items, UOM, warehouses, bins, stock levels, and stock movements
- BOM and assembly, including lightweight time planning
- purchase orders, sales orders, vendor bills, and sales invoices
- settlements, bank, and cash workflows
- Growth Batches for group-level biological and agricultural batch tracking
- onboarding import for opening/master data
- platform control for company access, trials, manual paid activation, and guarded reset operations

## Onboarding Entry

- public signup uses Supabase Auth only; production users must confirm email before normal app access, then choose company creation or explicit invitation acceptance
- signup may capture an optional phone number as profile contact data, but phone is not a login factor, OTP path, membership key, or tenant-access signal
- Brevo-backed Supabase Auth email templates handle confirmation, password reset, invite, and email-change messages; no parallel auth or organisation system is used
- Supabase password recovery callbacks route to `/update-password` before normal membership routing; the update screen changes the password through Supabase Auth, clears the recovery marker, and returns the user to login
- authenticated users who already have an active company membership continue into the dashboard under the existing active-company rules
- authenticated users without an active membership land on `/onboarding`
- onboarding now supports two first-class paths: join an invited company or create a new company
- onboarding company creation is intentionally minimal and only requires the company name; legal identity, address, contacts, logo, bank details, tax details, and other deeper setup remain editable later in `Settings`
- after company creation, onboarding shows the setup checklist for company profile, fiscal/legal readiness, users, and opening data; these are navigation and readiness cues, not new backend workflow gates
- pending invitation discovery is email-bound and uses a dedicated authenticated RPC that only returns invites for the signed-in account email
- invitation acceptance stays secure through the authenticated email match plus invite validity checks; expired invite rows are excluded from the onboarding list and rejected on acceptance
- choosing `Create new company` no longer auto-consumes pending invitations; the invitation record remains pending unless the user explicitly accepts it
- the `admin-users/sync` edge function may link invite rows to the authenticated user id after sign-in, but it must not auto-activate invited memberships; invite acceptance remains an explicit onboarding or invite-link action

## Authority Split

- Supabase RPCs, policies, and views are the authority for stock posting, finance posting, reconciliation, entitlement state, and access restriction.
- Frontend pages are responsible for workflow clarity, guided inputs, and operator/admin usability.
- `posting_requests` is the shared backend idempotency ledger. It governs assembly posting, normal web Point of Sale, PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, adjustment, Production Run post/reversal, and Growth Batch create/activate/cancel/measurement/direct-cost/input/loss/transfer/harvest/reversal workflows.
- Tauri packages the current frontend. It does not introduce a separate desktop-only or Android-only business logic layer.
- The maintained enforcement, rate-limiting, monitoring, and scaling baseline is documented in [SECURITY_AND_SCALE_BASELINE.md](SECURITY_AND_SCALE_BASELINE.md); recovery and rollback procedures are documented in [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md).

## Canonical Data Direction

- the active migration history starts from the canonical baseline plus forward migrations only
- `stock_movements` is the stock ledger
- `stock_levels` is the derived availability and weighted-average rollup
- `posting_requests` is the company-scoped idempotency ledger for governed posting workflows
- governed operation types are domain-specific: `assembly.build`, `assembly.build_sources`, `operator.sale`, `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, `stock.adjustment`, `production.run.post`, `production.run.reverse`, `growth.batch.create`, `growth.batch.activate`, `growth.batch.cancel`, `growth.batch.measurement`, `growth.batch.cost`, `growth.batch.input`, `growth.batch.input.reverse`, `growth.batch.mortality`, `growth.batch.shrinkage`, `growth.batch.mortality.reverse`, `growth.batch.shrinkage.reverse`, `growth.batch.transfer`, `growth.batch.transfer.reverse`, `growth.batch.harvest`, and `growth.batch.harvest.reverse`
- `company_members` + `member_role` is the company membership and authority model
- `profiles` + `user_active_company` is the active signed-in user context
- `company_subscription_state` + `platform_admins` is the tenant entitlement and control-plane model

## Android-First and Tauri Position

- mobile UX is a general app concern, not a separate product mode
- the shell now uses adaptive page-width variants instead of one rigid content canvas, so dashboard-style pages and task workspaces can use wider screens more intelligently without losing readable structure
- the small-screen shell prioritizes a smaller route set, clearer vertical flow, and a persistent bottom navigation dock that stays visually separated from page content
- dashboard mobile flow prioritizes Today/status, Action Needed, Quick Actions, and Recent Activity before deeper chart review
- the Android runtime now fits the system window area and uses safe-area-aware top/bottom spacing instead of allowing app chrome to collide with the status bar
- the mobile drawer has its own scroll body so lower navigation entries remain reachable on shorter Android screens
- compact review-heavy pages such as Items, Movements, and Stock Levels should expose card/register views before falling back to horizontal tables
- onboarding, Settings, and Users/Roles should preserve the same Android-first principle: decision cards, setup categories, role explanations, invite forms, and member cards must remain usable without hover or horizontal-table dependence
- register import/export controls must wrap existing approved workflows; visual register work must not create new posting, costing, access-control, or data-import authority
- Point of Sale and onboarding import are packaged into Tauri builds exactly as they exist on the web app
- because installed Tauri builds can lag the web deployment, legacy POS RPC execution remains a temporary compatibility boundary until A2.4a.2 reviews maintained desktop/Android clients and closes normal legacy execution

## Production Runs Architecture

The first Production Runs package is live as of 2026-06-18. Its rollout aligned hosted Supabase through `20260615213640_add_production_run_posting.sql`, and the production frontend was commit `4f82c5a feat(production): add governed production runs`. Hosted Supabase now continues through Growth Batches G5.1 with 36 active migrations, latest hosted migration `20260702205834_add_growth_batch_harvest_posting.sql`; local replay continues through G5.2 with 38 active migrations, latest local migration `20260704041943_add_growth_batch_completion_posting.sql`.

Production Runs add a richer operational path beside quick assembly:

- `/bom` remains the Recipes & Assemblies workspace for recipe maintenance and simple quick-build stock transformations.
- `/production-runs` manages planned versus actual production, frozen costing, additional direct costs, posting, and controlled reversal.

New tables:

- `production_runs`
- `production_run_inputs`
- `production_run_outputs`
- `production_run_extra_costs`
- `production_run_counters`

New RPCs:

- `create_production_run_draft`
- `update_production_run_draft`
- `cancel_production_run_draft`
- `preview_production_run`
- `post_production_run`
- `reverse_production_run`

Posting uses `posting_requests` with operation type `production.run.post`. Reversal uses `posting_requests` with operation type `production.run.reverse`. Both require a nonblank request key, replay the same result for the same key and payload, and reject changed payloads under the same key.

Authority remains domain-specific:

- VIEWER can read permitted Production Run records.
- OPERATOR+ can create/edit drafts, preview, and post.
- MANAGER+ can reverse posted runs.
- authenticated clients have company-scoped read access to Production Run tables, but no direct table INSERT, UPDATE, or DELETE authority; draft/post/reverse mutations are RPC-only.

Production Run posting writes only `stock_movements`; `stock_levels` remains trigger-derived. Additional direct costs are production cost snapshots only and do not create finance postings.
- first-release Production Run quantities are recorded in each item base UOM only; generic Production Run UOM conversion is deferred to a later explicit design pass.
- desktop and Android releases must reflect current StockWise branding, route naming, and operator-facing copy

Production smoke validation used `Leny Doçuras` and Production Run `LEN-PR000000001`: setup receipt added Fermento through the maintained Movements UI, posting created seven input issues plus one output receipt, reversal created one compensating output issue plus seven input receipts, duplicate/negative stock checks stayed zero, and `items.unit_price` remained commercial.

## Growth Batches G1-G2 Architecture

Growth Batches G1-G2 is live in production as of 2026-06-20. Its rollout aligned hosted Supabase through `20260619175129_add_growth_batch_lifecycle_events.sql`; current hosted Supabase is aligned through the G5.1 migration `20260702205834_add_growth_batch_harvest_posting.sql` with 36 active migrations, while local replay is at 38 migrations through G5.2. The production route is `/growth-batches`.

The rollout applied the two Growth Batch migrations:

- `20260619175117_add_growth_batches_foundation.sql`
- `20260619175129_add_growth_batch_lifecycle_events.sql`

Production smoke validation passed through the maintained UI using the controlled `Leny Doçuras` tenant and retained active batch `LEN-GB000000001`.

The G1-G2 boundary is intentionally narrow:

- `/growth-batches` manages group-level biological or agricultural batches, not per-animal or per-plant stock.
- supported lifecycle actions are draft creation/editing, draft cancellation, activation, measurements, and memo direct costs.
- unsupported actions at the G1-G2 boundary remain disabled/future scope unless covered by later Growth Batch packages below: stock-input consumption is live in G3; mortality/shrinkage is live in G4.1; full-batch operational location transfer is live in G4.2; governed depleting harvest is live in G5.1; lifecycle completion is local-only in G5.2 and not hosted/live; split/child batches, non-depleting recurring yield, whole-batch reversal, fair-value adjustments, FIFO, COGS, and finance posting remain future scope.
- direct costs are Growth Batch memo rollups only. They do not create bank, cash, vendor bill, settlement, journal, invoice, stock movement, or `items.unit_price` changes.
- primary quantities are base-UOM-style entries only for this phase. Count quantities must be whole numbers, weight measurements use the batch `weight_uom_id`, area observations use the batch `area_uom_id`, and generic Growth Batch UOM conversion is deferred.
- the batch start date is the operational lifecycle boundary. Activation rejects future start dates; measurement and memo direct-cost effective dates must be on or after the start date and not in the future. Server-created timestamps remain separate from operator-entered effective dates.
- Growth Batch histories expose `event_sequence`, effective date, created timestamp, and event id. Callers must order histories explicitly, normally by `event_sequence`.
- authenticated clients may read permitted Growth Batch tables/views, but business mutation is RPC-only and protected by RLS, validation triggers, and request-key idempotency where duplicate submission risk exists.

New tables:

- `growth_batches`
- `growth_batch_counters`
- `growth_batch_events`
- `growth_batch_measurements`
- `growth_batch_direct_costs`

New read models:

- `growth_batches_register`
- `growth_batch_current_state`
- `growth_batch_event_timeline`
- `growth_batch_measurement_history`
- `growth_batch_direct_cost_history`

New RPCs:

- `create_growth_batch_draft`
- `update_growth_batch_draft`
- `cancel_growth_batch_draft`
- `activate_growth_batch`
- `record_growth_batch_measurement`
- `record_growth_batch_direct_cost`

Growth Batch operation types use `posting_requests` for create, activation, cancellation, measurement, and direct-cost replay safety: `growth.batch.create`, `growth.batch.activate`, `growth.batch.cancel`, `growth.batch.measurement`, and `growth.batch.cost`.

## Growth Batches G3 Live Stock-Input Package

Growth Batches G3 is live in production as of 2026-06-22. At that rollout, hosted production reached 30 active migrations through `20260620132656_add_growth_batch_stock_input_posting.sql`; the database-first rollout applied these migrations together:

- `20260620132646_add_growth_batch_stock_inputs.sql`
- `20260620132656_add_growth_batch_stock_input_posting.sql`

The G3 package keeps Growth Batches group-level and adds governed physical stock input for active batches only:

- `stock_input` and `stock_input_reversal` Growth Batch event types.
- immutable stock-input detail lines and immutable reversal-detail lines.
- one append-only `stock_movements` issue per input line, referenced with `ref_type = 'GROWTH_BATCH_INPUT'`, `ref_id = growth_batch_event_id`, and `ref_line_id = growth_batch_stock_inputs.id`.
- one compensating `stock_movements` receipt per reversal line, referenced with `ref_type = 'GROWTH_BATCH_INPUT_REVERSAL'`, `ref_id = reversal_event_id`, and `ref_line_id = growth_batch_stock_input_reversal_lines.id`.
- base-UOM-only consumed inventory lines; Growth Batch primary quantity, weight UOM, area UOM, and consumed item UOM remain separate domains with no conversion engine.
- source WAC is frozen into stock-input detail rows as material cost. Memo direct costs remain separate and non-financial.
- material, total, and remaining Growth Batch rollups are recalculated from immutable input/reversal details plus existing memo direct costs while the batch row is locked.
- `preview_growth_batch_stock_input`, `post_growth_batch_stock_input`, and `reverse_growth_batch_stock_input` preserve RPC-only mutation, company role checks, entitlement checks, RLS/FORCE RLS, and request-key idempotency for posting/reversal.

Pre-rollout validation passed: local replay of 30 migrations, Growth Batches regression `5/5`, complete finance regression `31/31`, independent implementation inspection, authenticated local visual QA at `1440`, `1200`, `820`, and `390` in light and dark mode, static validation, build, and GitHub Validation run `27930016751` for commit `58e8a083c29d70d3b72aa755a80336393bcbb268`. Production is served by Vercel deployment `dpl_CPHfKuoWcZ1eEMLrFXjv3cSFCu3i`.

The 2026-06-22 production smoke used tenant `Leny Doçuras` (`b49089cc-af95-44a6-bdff-45faec9d7bc5`) and new batch `LEN-GB000000002` (`QA G3 Stock Input Smoke - 2026-06-22`). It posted `1 EA` of `OV002 - Ovo` from `WH001 - Casa / CDC001 - Cozinha - Casa`, froze WAC `10.304233`, created input event `LEN-GB000000002-E000002`, issue movement `3fe172dd-adc5-44e5-8ec6-7587420078fa`, and request `e32dcf72-755d-4d1f-86c8-1e96e9fd761b`. Immediate reversal `LEN-GB000000002-E000003` created receipt movement `48ce328c-fdc9-4383-a0d5-11164fb0da7f` and request `efd1c065-3d29-4185-8b1d-a216e0e7d80e`. Source stock moved `48 -> 47 -> 48`, material cost moved `0 -> 10.304233 -> 0`, memo direct cost stayed `0`, finance rows stayed unchanged, negative stock and duplicate buckets stayed zero, and `items.unit_price` stayed unchanged.

G3 itself did not add mortality, shrinkage, transfers, harvests/splits, completion, whole-batch reversal, FIFO biological layers, COGS, fair-value accounting, automatic finance posting, vendor-bill allocation, supplier liabilities, cash/bank settlement, profitability dashboards, per-animal/per-plant records, or generic UOM conversion. Mortality and shrinkage are live through G4.1, full-batch operational location transfer is live through G4.2, governed depleting harvest is live through G5.1, and lifecycle completion is local-only through G5.2; split outputs, hosted completion rollout, valuation, accounting, profitability, and per-animal/per-plant scope remain separate.

## Growth Batches G4.1 Live Mortality And Shrinkage Package

Growth Batches G4.1 is live in production as of 2026-06-28. Local and hosted production migration history both have 32 active migrations through `20260627225414_add_growth_batch_loss_posting.sql`. The database-first rollout applied these migrations together:

- `20260627225400_add_growth_batch_losses.sql`
- `20260627225414_add_growth_batch_loss_posting.sql`

The release commit is `5a24eb428499d126870883bb5841e3e451cdd178`, GitHub Validation run `28319500331` passed, and Vercel production deployment `dpl_FrC2WKJsF1DmosBSu68tahEBhmhU` served the matching frontend during rollout.

The G4.1 package adds:

- `mortality`, `shrinkage`, `mortality_reversal`, and `shrinkage_reversal` event types.
- immutable `growth_batch_losses` and `growth_batch_loss_reversal_lines` tables with RLS, FORCE RLS, company-scoped SELECT, RPC-only mutation, and immutable-row triggers.
- `growth_batch_loss_history` plus current-state/register/timeline extensions for loss counts and typed loss summaries.
- `preview_growth_batch_loss`, `record_growth_batch_loss`, and `reverse_growth_batch_loss` RPCs.
- request-key idempotency for `growth.batch.mortality`, `growth.batch.shrinkage`, `growth.batch.mortality.reverse`, and `growth.batch.shrinkage.reverse`.
- OPERATOR+ preview/record authority and MANAGER+ reversal authority.

The 2026-06-28 production smoke used tenant `Leny Doçuras` (`b49089cc-af95-44a6-bdff-45faec9d7bc5`) and new batch `LEN-GB000000003` (`452ba7d8-87c2-46dd-b60a-fa95e0ac12b4`, `QA G4.1 Loss Smoke - 2026-06-28`) with `20 EA` opening/current quantity and `40 KG` opening/latest total weight. Batch creation request `ac481ab0-318e-491e-ba0c-065e2b216924` and activation request `e0f85361-d4f0-427b-bc6f-63f8f3ae071b` succeeded; activation event `LEN-GB000000003-E000001` (`19a6a67c-db38-457e-b287-af16fa8f5f18`) used sequence `1`.

The smoke previewed and posted mortality `2 EA` for reason `disease`, creating event `LEN-GB000000003-E000002` (`32fa183e-6353-487d-9909-753a1b128553`), detail `27dd3a4b-728d-44fa-9612-842dce37dc10`, and succeeded request `a056575d-2c0e-4627-8a87-0ac9556f25e4`. Reversal with reason `Controlled G4.1 mortality smoke reversal` created event `LEN-GB000000003-E000003` (`8717f3b9-d5cd-46aa-bbe7-a9048e592375`), reversal detail `76227fa1-c56b-4c2a-9561-2a15384abbba`, and succeeded request `d7eff67d-3c22-4524-916b-c8d1fffa4b25`, restoring quantity `18 -> 20 EA`.

The smoke then previewed and posted shrinkage `5 KG` for reason `drying`, creating event `LEN-GB000000003-E000004` (`fd05b909-b92b-45a3-843d-0d06d59f20ea`), detail `ae735f1e-b526-4c0e-b5a2-79c7254d896b`, and succeeded request `c4022789-545c-4816-9c75-56638cb4aa16`. Reversal with reason `Controlled G4.1 shrinkage smoke reversal` created event `LEN-GB000000003-E000005` (`7459f1d6-b911-4727-beac-3d9a4ce9124d`), reversal detail `f4b234c1-a8d9-4cfa-a0c5-7a6d601ac24f`, and succeeded request `cf4d8473-5784-46ae-a98a-90e07fc2b433`, restoring weight `35 -> 40 KG`. The UI showed both loss cards as reversed with no second reversal control.

G4.1 loss events reduce only the active batch current quantity and/or latest total weight. They create no stock movements, do not update `stock_levels`, do not change material cost, memo direct cost, harvested cost, remaining cost, or `items.unit_price`, and create no cash, bank, vendor bill, invoice, settlement, journal, or finance-event rows. Accumulated cost remains with the batch; mortality valuation, write-off, FIFO, COGS, fair value, harvest, completion, child batches, dashboards, and accounting integration remain future scope.

## Growth Batches G4.2 Live Transfer Package

Growth Batches G4.2 is live and production-smoke validated as of 2026-07-02. Hosted and local Supabase are aligned with 34 active migrations through `20260630170735_add_growth_batch_transfer_posting.sql`.

The package adds governed full-batch operational location transfer only:

- new event types `transfer` and `transfer_reversal`
- immutable `growth_batch_transfers` and `growth_batch_transfer_reversal_lines`
- `growth_batch_transfer_history` for readable source-to-destination history
- OPERATOR+ `preview_growth_batch_transfer` and `transfer_growth_batch`
- MANAGER+ `reverse_growth_batch_transfer`
- `/growth-batches` Transfers tab, preview-required transfer dialog, source-location fingerprint stale-preview protection, and event-specific reversal dialog

G4.2 changes only the current batch location fields through guarded RPCs: `warehouse_id`, `bin_id`, `location_description`, `latest_event_sequence`, `updated_by`, and `updated_at`. It does not split the batch, create child batches, create stock movements, update `stock_levels`, change quantity/weight/cost rollups, change `items.unit_price`, post finance rows, create transport cost automatically, or introduce harvest/completion/FIFO/COGS/fair-value/accounting behavior. Transport expense remains a separate memo direct-cost event.

The 2026-07-02 production rollout used release commit `6995c1c59e4399258ab663953b0a129f606b92b5`, GitHub Actions Validation run `28606395112`, and Vercel deployment `dpl_8Kv3c3bUnkgjsU9iaPNPVYF7MvEx` for the initial frontend. The database rollout had already aligned hosted Supabase to the two G4.2 migrations before a detail-card layout defect blocked the maintained-UI reversal path. The controlled batch `LEN-GB000000003` was restored through the approved authenticated public `reverse_growth_batch_transfer` RPC, then frontend commit `c84469100249188144cb6305a634e21fba77a653` (`fix(growth): improve batch detail action layout`) deployed as `dpl_ECTTdBiBpL6y4kkm39XmsqtpmY3p`. A fresh maintained-UI smoke then posted transfer `LEN-GB000000003-E000008` and reversed it with `LEN-GB000000003-E000009`, restoring `Casa / QA-A2`, preserving `20 EA`, `40 KG`, zero cost rollups, stock/finance counts, and `items.unit_price`.

## Growth Batches G5.1 Live Harvest Package

Growth Batches G5.1 is live and production-smoke validated as of 2026-07-03. Hosted and local Supabase are aligned at 36 active migrations through `20260702205834_add_growth_batch_harvest_posting.sql`.

The package adds governed depleting harvest only:

- new event types `harvest` and `harvest_reversal`
- immutable `growth_batch_harvests` and `growth_batch_harvest_reversal_lines`
- `growth_batch_harvest_history` for output, cost allocation, reversal state, and eligibility
- OPERATOR+ `preview_growth_batch_harvest` and `post_growth_batch_harvest`
- MANAGER+ `reverse_growth_batch_harvest`
- `/growth-batches` Harvests tab, preview-required harvest dialog, stale-source fingerprint protection, and event-specific reversal dialog

G5.1 reduces active batch primary quantity for partial or full depleting harvests and receives exactly one stock-tracked output item into inventory. Cost allocation moves existing `remaining_cost` into `harvested_cost`: partial harvests allocate `remaining_cost_before * harvested_primary_quantity / current_primary_quantity_before`, while full harvests transfer the exact remaining cost so no rounding residue remains. `accumulated_material_cost`, `accumulated_direct_cost`, and `accumulated_total_cost` stay cumulative. Full harvest leaves the batch `active` with zero current quantity and shows “fully harvested awaiting completion”; G5.2 implements local-only lifecycle completion after that state and is not hosted/live.

G5.1 stock behavior is append-only: harvest posting creates one `stock_movements` receipt with `ref_type = 'GROWTH_BATCH_HARVEST'`, and reversal creates one compensating issue with `ref_type = 'GROWTH_BATCH_HARVEST_REVERSAL'`. `stock_levels` remains trigger-derived. The package does not create sales, invoices, COGS, fair-value entries, finance journals, AP/AR/cash/bank rows, automatic completion, split or child batches, multi-output/co-product allocation, non-depleting recurring yield, FIFO biological layers, profitability dashboards, individual animal/plant records, or `items.unit_price` changes.

The 2026-07-03 production rollout used release commit `6f050745a9e1e5f9a56bfee7f30bca2b7ff55e10`, GitHub Actions Validation run `28657058435`, Vercel deployment `dpl_4sYA2iZ1r61iB1mdZTgZxY7DPPaH`, and database push window `2026-07-03T14:53:26+02:00` to `2026-07-03T14:53:42+02:00`. It applied `20260702205827_add_growth_batch_harvests.sql` and `20260702205834_add_growth_batch_harvest_posting.sql`. The controlled production smoke used tenant `Leny Docuras`, batch `LEN-GB000000003`, and QA item `QA-G51-POULTRY-KG` (`4cb6e677-c44f-4de9-952e-9a8506e5ea73`, base UOM KG, stock-tracked, finished good, not buyable/sellable, no selling price). Partial harvest event `LEN-GB000000003-E000010` (`e004b401-915e-4997-93a8-0423e850b5ba`) used detail `b8ff30af-7b59-47e1-b96f-7abb0215c47a`, request `b74066ca-3bde-48d5-8d01-d5d9b73b7c11`, and receipt movement `4e072c72-fbea-4a5d-ae56-4c25bc72029a`; reversal `LEN-GB000000003-E000011` (`7389ea83-e2d6-4d4a-ad10-ccd5e980c4a7`) used detail `7ea857ba-069e-40a8-8b56-9482f3f92f54`, request `e4727f36-8440-4d62-bea6-8116bfe33b2e`, and issue movement `516d37ab-dff7-4872-8036-a34d7138db26`. Full harvest event `LEN-GB000000003-E000012` (`efb9872c-7ddd-4b59-bb56-5aae8c47077f`) used detail `946f88c2-c147-4c96-9db8-7723fdfb5f0e`, request `91329bc4-47e3-4f88-9864-f8b0411f0652`, and receipt movement `5654dc72-c4b6-4fbc-bc6d-5646641ad877`; reversal `LEN-GB000000003-E000013` (`cc7e6223-4f07-4243-a6ad-4bf46d0b53da`) used detail `af0e9137-aa90-4df7-8108-0b0bf9db0b29`, request `7973209f-a77a-439f-ad11-870ea74f49ae`, and issue movement `c5908639-1c1e-46b4-a75c-9e4d0b4fdf68`. The zero-cost smoke restored `20 EA`, `40 KG`, active status, `Casa / QA-A2`, zero harvested/remaining cost, and a zero QA stock bucket; nonzero proportional allocation remains covered by local regression.

## Growth Batches G5.2 Local Completion Package

Growth Batches G5.2 is local-only and not hosted/live. Hosted production remains at 36 migrations through G5.1, while local replay has 38 active migrations through `20260704041943_add_growth_batch_completion_posting.sql`.

The package adds governed lifecycle completion only:

- new event types `completion` and `completion_reversal`
- immutable `growth_batch_completions` and `growth_batch_completion_reversal_lines`
- `growth_batch_completion_history` for completion snapshots, reversal state, and eligibility
- OPERATOR+ `preview_growth_batch_completion`, with MANAGER+ completion and reversal authority enforced by the public RPCs
- MANAGER+ `complete_growth_batch` and `reverse_growth_batch_completion`
- `/growth-batches` Completion tab, preview-required completion dialog, stale-state fingerprint protection, and event-specific reversal dialog

G5.2 changes only lifecycle status/audit/latest sequence through a narrow transaction-local completion guard: `status`, `latest_event_sequence`, `completed_by`, `completed_at`, `updated_by`, and `updated_at`. Completion requires an active batch with zero current quantity, zero current weight where weight exists, and zero remaining cost. Reversal restores only the corresponding active/completed lifecycle fields. The package creates no stock movements, does not update `stock_levels`, does not change quantity, weight, harvested cost, remaining cost, accumulated costs, or `items.unit_price`, and creates no sales, invoices, COGS, FIFO layers, fair-value entries, cash, bank, AP, AR, finance-document rows, split/child batches, whole-batch reversal, profitability dashboards, or individual animal/plant records.

## Notification Direction

- `public.notifications` remains the company-scoped notification feed consumed by the shell
- notifications should stay high-signal; approval requests, finance issue/post milestones, critical treasury approvals, and company-access events are in scope, while low-value draft churn is not
- finance lifecycle notifications now fan out from `finance_document_events` instead of duplicating logic inside every frontend page

## Guardrails

- keep Supabase-managed `storage` internals out of tracked app migrations
- keep custom global roles in `supabase/roles.sql`
- treat `db pull` `*_remote_schema.sql` files as review artifacts by default
- do not use inventory cost as a default selling price
- validate finance and operational continuity with `npm run test:finance-regression`
- keep UI polish inside the existing Tailwind/shadcn-style system unless a new dependency is explicitly justified
