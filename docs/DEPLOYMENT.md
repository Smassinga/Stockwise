# StockWise Deployment and Release Position

This document describes the current release posture for StockWise as it exists today.

## Runtime Shape

StockWise currently ships in three ways:

- web frontend built by Vite and deployed from `dist/`
- Supabase database, auth, storage policies, RPCs, and Edge Functions
- Tauri desktop and Android shells that package the same frontend

## Current Commercial Position

- public pricing is visible in MZN
- paid activation remains manual through Platform Control
- automatic payment checkout is intentionally not part of the current release model

## Web Release Baseline

Required frontend/runtime variables:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SITE_URL=https://stockwiseapp.com
```

Production frontend error monitoring additionally uses:

```bash
VITE_SENTRY_ENABLED=true
VITE_SENTRY_DSN=<operator-managed public client DSN>
VITE_SENTRY_ENVIRONMENT=production
SENTRY_ORG=wisecore-technologies
SENTRY_PROJECT=stockwise-web
SENTRY_AUTH_TOKEN=<secret build-only token>
```

Every `VITE_*` value is exposed to the browser bundle. `SENTRY_AUTH_TOKEN` is secret, build-only, and must never use a `VITE_` prefix. With all three build-only values present, Vite creates hidden source maps, the Sentry plugin uploads them, and uploaded `.map` files are deleted from `dist`. Without those credentials, builds succeed without upload and without generating deployable source maps.

Preview environments should leave `VITE_SENTRY_ENABLED` false or absent. Production monitoring is not validated merely by a successful build or deployment; record a controlled production event and verify a readable TypeScript/React stack before claiming live event delivery. DSN rotation requires reviewing the exact project ingestion origin in both CSP layers.

Before a web release:

```bash
npm run lint:js
npm run check:css-vars
npm run check:css-classes
npm run build
npm run test:finance-regression
```

The GitHub Actions validation workflow runs the non-mutating subset automatically on pull requests and pushes to `main`:

```bash
npm ci
npm run check:migrations
npm run lint:js
npm run check:css-vars
npm run check:css-classes
npm run build
```

The workflow uses non-secret Vite placeholder values for Supabase compile-time variables. The finance regression suite remains a protected manual release gate unless a dedicated non-production Supabase test project and guarded CI secrets are configured. Normal CI must not receive production Supabase service-role credentials and must not perform production database mutations.

The maintained `npm run test:finance-regression` command runs finance-regression files serially. The suite uses one mutation database and broad setup/cleanup across finance, onboarding, and Growth Batch scenarios; serial file execution prevents fixture interference while preserving explicit concurrency tests inside the scenarios designed to exercise races.

If database changes are included:

```bash
npx supabase db pull
npm run check:migrations
npx supabase db push
```

Only report a live schema change if `npx supabase db push` succeeded in the same session.

For production-impacting releases, also review:

- [SECURITY_AND_SCALE_BASELINE.md](SECURITY_AND_SCALE_BASELINE.md) for current enforcement, monitoring, rate-limiting, and scaling assumptions
- [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md) for rollback, restore, Edge Function, Auth/email, and emergency platform-admin checklists

## Governed Settlement Posting Live

Hosted production and local replay are aligned at 39 migrations through `20260709222842_governed_settlement_posting.sql`.

This forward-only package governs cash settlement, bank settlement, manual cash adjustment, manual bank-ledger posting, and atomic bank CSV import with `posting_requests` idempotency. Settlement eligibility uses exact two-decimal `numeric` normalization with no additive epsilon; fully resolved anchors reject every positive normalized amount. `post_bank_ledger_import` commits a complete canonical batch or nothing, uses one `bank.ledger.import` request, and replays identical logical files across reloads without duplicate rows.

## Current Production Release Notes

2026-07-10/11 governed Settlement, Cash, and Bank production rollout:

- release commit `5e47a9d279e4db7c4f588d420bd9439b751d260d` passed GitHub Actions Validation run `29130740318`; Vercel deployment `dpl_7rPAojKUq7sSeqkZ49WE2cZH65Wh` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- linked production project `ogzhwoqqumkuqhbvuzzp` moved from 38 to 39 migrations by applying only `20260709222842_governed_settlement_posting.sql` from `2026-07-10T23:46:23.8149856Z` to `2026-07-10T23:46:51.9198735Z`; the push exited zero and the second dry run reported the remote database up to date
- live authenticated ADMIN+ RPCs are `post_cash_settlement`, `post_bank_settlement`, `post_cash_adjustment`, `post_bank_ledger_transaction`, and `post_bank_ledger_import`; PUBLIC/anon execution and normal-client direct cash/bank inserts remain denied, while internal helpers remain client-inaccessible with restricted search paths
- controlled Leny Docuras cash smoke settled MZN 1.00 on `LEN-SO000000002`, changing outstanding MZN 1,500.00 to MZN 1,499.00; cash row `be35dfce-1979-4b67-8a2f-8f42aa87460e` and request `e86f0b6b-f0ee-449d-96dc-e561df969d33` succeeded
- controlled bank smoke used QA account `86c7ed62-ac7f-4c57-9c58-6804c464d171`; manual MZN 0.01 row `dc237d39-d764-417b-b531-f24acde9444c` used request `e886bd29-1837-4a28-8671-a2b4c1b96a9a`
- atomic CSV request `a9c85b6c-9566-4e60-841d-f94fef15948e` created MZN 0.02 row `4b943e8c-7c44-49c5-881c-f9d13de504d9` and MZN -0.02 row `640e01bf-c68a-4d92-8451-9242a747a506`; identical logical replay after reload created zero additional bank rows and zero additional settlement effect
- final QA bank balance was MZN 0.01; stock movements `75`, stock levels `17`, item-price hash `307b4335cad1eaba498c35b707ac2efb`, finance-document events `45`, Growth Batches `3`, and Production Runs `1` remained stable. Negative stock buckets, duplicate stock-bucket groups, stale SO/SI rows, stale PO/VB rows, and orphaned succeeded governed requests were all zero
- responsive production checks passed at `1440`, `1200`, `820`, and `390` with no page overflow, raw package backend code, browser console warning/error, or CSP error. Existing incomplete Portuguese coverage outside the new package remains separate legacy debt
- local finance regression passed `36/36` with 113 named governed settlement/import state checks. Repeated-`0.005`, over-settlement, payload-mismatch, stale-anchor, failed-import rollback, cross-company, authority-negative, and concurrency mutation tests were deliberately not run in production

2026-07-04/2026-07-09 Growth Batches G5.2 production rollout:

- at the G5.2 rollout, hosted production and local replay were aligned at 38 active migrations through `20260704041943_add_growth_batch_completion_posting.sql`; migration history now continues through governed-settlement migration 39
- `20260704041936_add_growth_batch_completion.sql` and `20260704041943_add_growth_batch_completion_posting.sql` applied together from `2026-07-04T15:11:31.7589419+02:00` to `2026-07-04T15:11:48.7774298+02:00` with exit zero; the second dry run reported the remote database up to date
- feature release `6fa6bdb1303c9457f0b26fa6934a3d096cdad38b` passed Validation run `28706577810`; the G5.2 Portuguese lifecycle-copy correction `bc22eb3facd166dbcd59fb7d5bedb21bb51d20b9` passed Validation run `29051595028` and deployed as `dpl_BRA6QUesB64T8LwF3rUAF7dYFKfv`
- the local package adds governed lifecycle completion and event-specific completion reversal only, with `growth_batch_completions`, `growth_batch_completion_reversal_lines`, `growth_batch_completion_history`, `preview_growth_batch_completion`, `complete_growth_batch`, and `reverse_growth_batch_completion`
- completion requires an active Growth Batch with zero current primary quantity, zero current total weight where weight exists, and zero remaining cost; full harvest remains the G5.1 operation that produces the awaiting-completion state
- G5.2 changes only lifecycle status, completion actor/timestamp, audit fields, and latest event sequence. It creates no stock movement, stock-level update, quantity/weight/cost mutation, sale, invoice, COGS, FIFO layer, fair-value entry, finance row, automatic stock output, split/child batch, whole-batch reversal, profitability dashboard, individual animal/plant record, or `items.unit_price` change
- controlled production smoke completed full harvest, completion, completion reversal, and full-harvest reversal through the maintained UI; replay, mismatch, concurrency, insufficient-state, and authority-negative tests remain local-only

2026-07-03 Growth Batches G5.1 production rollout:

- hosted and local production migration history are aligned at 36 active migrations through `20260702205834_add_growth_batch_harvest_posting.sql`
- the rollout applied `20260702205827_add_growth_batch_harvests.sql` and `20260702205834_add_growth_batch_harvest_posting.sql` from `2026-07-03T14:53:26+02:00` to `2026-07-03T14:53:42+02:00` with exit zero; the second dry run reported the remote database up to date
- release commit `6f050745a9e1e5f9a56bfee7f30bca2b7ff55e10` passed GitHub Actions Validation run `28657058435`
- production frontend deployment `dpl_4sYA2iZ1r61iB1mdZTgZxY7DPPaH` served `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- G5.1 adds governed partial/full depleting harvest, one primary inventory output receipt per harvest, proportional remaining-cost transfer to harvested cost, exact full-harvest remaining-cost transfer, and MANAGER+ event-specific harvest reversal
- full harvest leaves the Growth Batch `active` with zero current quantity and an awaiting-completion state; completion remains a separate future package
- G5.1 creates append-only stock movements for harvest receipt and reversal issue only; it does not create sales, invoices, COGS, FIFO layers, fair-value entries, finance rows, cash/bank/AP/AR documents, automatic completion, split or child batches, multi-output/co-product allocation, non-depleting yield, profitability dashboards, individual animal/plant records, or `items.unit_price` changes
- controlled QA item `QA-G51-POULTRY-KG` / `Frango abatido - QA G5.1` (`4cb6e677-c44f-4de9-952e-9a8506e5ea73`) was created through the maintained Items UI with base UOM KG, `finished_good`, stock tracking enabled, buy/sell/assembly disabled, min stock `0`, and no selling price
- partial smoke used batch `LEN-GB000000003`, quantity `1 EA`, weight `2 KG`, output `2 KG`, event `LEN-GB000000003-E000010`, detail `b8ff30af-7b59-47e1-b96f-7abb0215c47a`, request `b74066ca-3bde-48d5-8d01-d5d9b73b7c11`, and receipt movement `4e072c72-fbea-4a5d-ae56-4c25bc72029a`; maintained-UI reversal created `LEN-GB000000003-E000011`, detail `7ea857ba-069e-40a8-8b56-9482f3f92f54`, request `e4727f36-8440-4d62-bea6-8116bfe33b2e`, and issue movement `516d37ab-dff7-4872-8036-a34d7138db26`
- full smoke used quantity `20 EA`, weight `40 KG`, output `40 KG`, event `LEN-GB000000003-E000012`, detail `946f88c2-c147-4c96-9db8-7723fdfb5f0e`, request `91329bc4-47e3-4f88-9864-f8b0411f0652`, and receipt movement `5654dc72-c4b6-4fbc-bc6d-5646641ad877`; the full-harvest UI showed zero quantity, zero weight, active status, and awaiting completion before maintained-UI reversal created `LEN-GB000000003-E000013`, detail `af0e9137-aa90-4df7-8108-0b0bf9db0b29`, request `7973209f-a77a-439f-ad11-870ea74f49ae`, and issue movement `c5908639-1c1e-46b4-a75c-9e4d0b4fdf68`
- final state restored `Casa / QA-A2`, active status, `20 EA`, `40 KG`, no area, zero accumulated/harvested/remaining costs, and latest sequence `13`; G5.1 deltas from the post-item baseline were `growth_batch_events +4`, `growth_batch_harvests +2`, `growth_batch_harvest_reversal_lines +2`, G5.1 `posting_requests +4`, and `stock_movements +4`
- the QA output bucket returned to `0 KG`; the one retained zero stock-level row is expected from the first receipt. Negative stock and duplicate bucket checks stayed `0`, all G5.1 posting requests succeeded, pre-existing `items.unit_price` hash stayed `042919f464f3830a8a7c17791d9a43e7`, and the new QA item has no selling price. The production smoke batch had zero remaining cost; nonzero proportional-cost allocation remains covered by local regression.

2026-06-28 Growth Batches G4.1 production rollout:

- hosted and local Supabase are aligned through migration `20260627225414_add_growth_batch_loss_posting.sql` with 32 active migrations
- production frontend is aligned at Git commit `5a24eb428499d126870883bb5841e3e451cdd178`
- Vercel production deployment `dpl_FrC2WKJsF1DmosBSu68tahEBhmhU` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- GitHub Actions `Validation` run `28319500331` passed before rollout
- the database-first rollout ran from `2026-06-28T13:11:36.5943818+02:00` to `2026-06-28T13:11:52.8158591+02:00`; pre-rollout hosted history had 30 migrations through `20260620132656`, and post-rollout history had 32 migrations
- `npx supabase db push --linked` exited `0` and applied exactly `20260627225400_add_growth_batch_losses.sql` then `20260627225414_add_growth_batch_loss_posting.sql`; the second dry run reported that the remote database was up to date
- live G4.1 tables are `growth_batch_losses` and `growth_batch_loss_reversal_lines`; the live G4.1 read model is `growth_batch_loss_history`
- live G4.1 RPCs are `preview_growth_batch_loss`, `record_growth_batch_loss`, and `reverse_growth_batch_loss`
- RLS and FORCE RLS were verified on both new tables; authenticated company-scoped SELECT exists, authenticated direct INSERT/UPDATE/DELETE is blocked, mutation remains RPC-only, `anon`/`PUBLIC` cannot execute mutation RPCs, functions are `SECURITY DEFINER` with restricted `search_path`, OPERATOR+ is required for preview/recording, and MANAGER+ is required for reversal
- migration-only invariant checks stayed unchanged before smoke: `growth_batches=2`, `growth_batch_events=6`, `growth_batch_measurements=1`, `growth_batch_direct_costs=1`, `growth_batch_stock_inputs=1`, `growth_batch_stock_input_reversal_lines=1`, `posting_requests=17`, `stock_movements=69`, `stock_levels=16`, `cash_transactions=11`, `bank_transactions=3`, `vendor_bills=3`, `sales_invoices=4`, `sales_credit_notes=1`, `sales_debit_notes=0`, `finance_document_events=45`, negative stock `0`, duplicate stock bucket groups `0`, no G4.1 posting requests, and `items.unit_price` sum `189778`
- the controlled production smoke used the maintained `/growth-batches` UI, tenant `Leny Doçuras` (`b49089cc-af95-44a6-bdff-45faec9d7bc5`), batch `LEN-GB000000003` (`452ba7d8-87c2-46dd-b60a-fa95e0ac12b4`), family `Poultry`, location `Casa / QA-A2`, quantity UOM `EA - Each`, and weight UOM `KG - Kilogram`
- batch creation request `ac481ab0-318e-491e-ba0c-065e2b216924` and activation request `e0f85361-d4f0-427b-bc6f-63f8f3ae071b` succeeded; activation event `LEN-GB000000003-E000001` (`19a6a67c-db38-457e-b287-af16fa8f5f18`) used sequence `1`
- mortality preview showed quantity `20 -> 18 EA` and weight `40 -> 40 KG` without creating any event, detail, request, stock, finance, cost, or price mutation
- mortality event `LEN-GB000000003-E000002` (`32fa183e-6353-487d-9909-753a1b128553`) used sequence `2`, immutable detail `27dd3a4b-728d-44fa-9612-842dce37dc10`, reason `disease`, quantity `20 -> 18 EA`, weight `40 -> 40 KG`, and succeeded request `a056575d-2c0e-4627-8a87-0ac9556f25e4`
- mortality reversal event `LEN-GB000000003-E000003` (`8717f3b9-d5cd-46aa-bbe7-a9048e592375`) used sequence `3`, reversal detail `76227fa1-c56b-4c2a-9561-2a15384abbba`, reason `Controlled G4.1 mortality smoke reversal`, restored quantity `18 -> 20 EA`, and succeeded request `d7eff67d-3c22-4524-916b-c8d1fffa4b25`
- shrinkage preview showed quantity `20 -> 20 EA` and weight `40 -> 35 KG` without creating any event, detail, request, stock, finance, cost, or price mutation
- shrinkage event `LEN-GB000000003-E000004` (`fd05b909-b92b-45a3-843d-0d06d59f20ea`) used sequence `4`, immutable detail `ae735f1e-b526-4c0e-b5a2-79c7254d896b`, reason `drying`, quantity `20 -> 20 EA`, weight `40 -> 35 KG`, and succeeded request `c4022789-545c-4816-9c75-56638cb4aa16`
- shrinkage reversal event `LEN-GB000000003-E000005` (`7459f1d6-b911-4727-beac-3d9a4ce9124d`) used sequence `5`, reversal detail `f4b234c1-a8d9-4cfa-a0c5-7a6d601ac24f`, reason `Controlled G4.1 shrinkage smoke reversal`, restored weight `35 -> 40 KG`, and succeeded request `cf4d8473-5784-46ae-a98a-90e07fc2b433`
- final counts were `growth_batches=3`, `growth_batch_events=11`, `growth_batch_losses=2`, `growth_batch_loss_reversal_lines=2`, `posting_requests=23`, `stock_movements=69`, `stock_levels=16`, `cash_transactions=11`, `bank_transactions=3`, `vendor_bills=3`, `sales_invoices=4`, `sales_credit_notes=1`, `sales_debit_notes=0`, and `finance_document_events=45`
- final batch state restored to `20 EA` and `40 KG`; material cost, memo direct cost, total cost, harvested cost, and remaining cost stayed `MZN 0.00`; negative stock and duplicate stock bucket checks remained `0`; `items.unit_price` sum stayed `189778` and the stable rollout hash baseline remained unchanged
- Supabase API/Postgres log inspection through available MCP tooling was permission-blocked for this session; maintained UI calls succeeded and read-only database evidence showed no smoke failure
- At the G4.1 hosted rollout checkpoint, transfers and later harvest/split outputs, completion, whole-batch reversal, FIFO biological layers, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records remained outside hosted scope. G4.2 transfer scope became live in the 2026-07-02 rollout recorded below, and G5.1 governed depleting harvest became live in the 2026-07-03 rollout recorded above. Split/child batches, non-depleting yield, completion, whole-batch reversal, FIFO, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records remain outside hosted scope.

2026-07-02 Growth Batches G4.2 production rollout:

- hosted and local production migration history are aligned at 34 active migrations through `20260630170735_add_growth_batch_transfer_posting.sql`
- the G4.2 database rollout applied `20260630170730_add_growth_batch_transfers.sql` and `20260630170735_add_growth_batch_transfer_posting.sql`; hosted verification confirmed the transfer tables, transfer history view, RPC surface, RLS/FORCE RLS, and helper privilege boundary
- release commit `6995c1c59e4399258ab663953b0a129f606b92b5` passed GitHub Actions Validation run `28606395112`
- initial production frontend deployment `dpl_8Kv3c3bUnkgjsU9iaPNPVYF7MvEx` served the release commit on `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- the first controlled transfer smoke used tenant `Leny Doçuras`, batch `LEN-GB000000003` (`452ba7d8-87c2-46dd-b60a-fa95e0ac12b4`), source `Casa / QA-A2 - A2 Production Smoke`, destination `Casa / CDC001 - Cozinha - Casa`, transfer event `LEN-GB000000003-E000006`, detail `73988bc7-d212-4eb6-959d-b5acba41b7fe`, and request `24931559-1d98-4a77-86a6-b875fbefa63a`
- the maintained UI reversal was blocked by a cramped detail-card/action layout, so recovery used the approved authenticated public `reverse_growth_batch_transfer` RPC with request key `g42-smoke-recovery-2026-07-02T19:23:15.603Z-8ba3584b-88f1-4cf5-9d84-a7013cea3238`, reversal event `LEN-GB000000003-E000007`, detail `92f345e8-8c62-49e5-ba33-6127de00eb02`, and request `0adb6f6d-e65e-48b0-b472-c41fc8e82353`; this recovery restored the batch but did not count as maintained-UI reversal smoke
- UI fix commit `c84469100249188144cb6305a634e21fba77a653` (`fix(growth): improve batch detail action layout`) passed GitHub Actions Validation run `28617062013`; Vercel deployment `dpl_ECTTdBiBpL6y4kkm39XmsqtpmY3p` served the correction
- the fresh maintained-UI transfer created event `LEN-GB000000003-E000008` (`ba9b5cbc-ab24-423c-bcc2-eb706d0350b7`), detail `a0f1da34-10a9-4424-8162-00cece41e499`, request `1e2abeee-ff40-4373-93bc-61b9101e836b`, and request key `916b2086-57b2-46e5-95ae-d3a8473e10f1`
- the fresh maintained-UI reversal created event `LEN-GB000000003-E000009` (`b252af5b-e66b-4574-bd76-219bb7ffc473`), detail `45b096ed-6215-47f2-9b22-e531cdeec8b0`, request `c056422d-4805-42f5-a72a-4e69ab2d994c`, and request key `395ce06a-d144-4c90-acb2-03b6d1fff71d`
- final smoke state restored `Casa / QA-A2`, quantity `20 EA`, weight `40 KG`, no area, active status, zero material/direct/total/harvested/remaining cost, and latest event sequence `9`
- expected total G4.2 smoke deltas were observed: `growth_batch_events +4`, `growth_batch_transfers +2`, `growth_batch_transfer_reversal_lines +2`, and G4.2 posting requests `+4`
- stock movements stayed `69`, stock levels stayed `16`, cash `11`, bank `3`, vendor bills `3`, sales invoices `4`, sales credit notes `1`, sales debit notes `0`, finance document events `45`, negative stock buckets `0`, duplicate stock bucket groups `0`, and `items.unit_price` sum `189778`
- production responsive QA after the fix covered `1440`, `1366`, `1200`, `1024`, `820`, and `390`; the detail title did not collapse, action buttons stayed inside the card, transfer history remained visible, no second reversal action remained, and no console/CSP/page-overflow error was captured
- production replay, payload-mismatch, authority-negative, and concurrency mutation tests were not performed; they remain covered by local regression

2026-06-22 Growth Batches G3 production rollout:

- at the G3 rollout, hosted Supabase aligned through migration `20260620132656_add_growth_batch_stock_input_posting.sql` with 30 active migrations
- production frontend is aligned at Git commit `58e8a083c29d70d3b72aa755a80336393bcbb268`
- Vercel production deployment `dpl_CPHfKuoWcZ1eEMLrFXjv3cSFCu3i` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- GitHub Actions `Validation` run `27930016751` passed before rollout
- the database-first rollout ran from `2026-06-22T17:10:34.2302646Z` to `2026-06-22T17:10:52.9607505Z`; pre-rollout hosted history had 28 migrations through `20260619175129`, and post-rollout history had 30 migrations
- `npx supabase db push --linked` exited `0` and applied exactly `20260620132646_add_growth_batch_stock_inputs.sql` then `20260620132656_add_growth_batch_stock_input_posting.sql`; the second dry run reported that the remote database was up to date
- live G3 tables are `growth_batch_stock_inputs` and `growth_batch_stock_input_reversal_lines`; the live G3 read model is `growth_batch_stock_input_history`
- live G3 RPCs are `preview_growth_batch_stock_input`, `post_growth_batch_stock_input`, and `reverse_growth_batch_stock_input`
- RLS and FORCE RLS were verified on both new tables; authenticated company-scoped SELECT exists, authenticated direct INSERT/UPDATE/DELETE is blocked, mutation remains RPC-only, `anon`/`PUBLIC` cannot execute mutation RPCs, functions are `SECURITY DEFINER` with restricted `search_path`, OPERATOR+ is required for posting, and MANAGER+ is required for reversal
- migration-only invariant checks stayed unchanged before smoke: `growth_batches=1`, `growth_batch_events=3`, `growth_batch_measurements=1`, `growth_batch_direct_costs=1`, `posting_requests=13`, `stock_movements=67`, `stock_levels=16`, `cash_transactions=11`, `bank_transactions=3`, `vendor_bills=3`, `sales_invoices=4`, `finance_document_events=45`, negative stock `0`, duplicate stock bucket groups `0`, no G3 posting requests, and `items.unit_price` sum `189778`
- the controlled production smoke used the maintained `/growth-batches` UI, tenant `Leny Doçuras` (`b49089cc-af95-44a6-bdff-45faec9d7bc5`), batch `LEN-GB000000002` (`791d3282-4075-4163-9e23-cb9aa5dea493`), item `OV002 - Ovo`, UOM `EA - Each`, and source `WH001 - Casa / CDC001 - Cozinha - Casa`; a dedicated QA bin was not used so the smoke avoided extra warehouse/bin configuration changes
- preview showed source availability `48 EA`, base unit `EA`, estimated WAC `MZN 10.30`, and estimated material cost `MZN 10.30`, and preview created no stock movement or posting request
- stock input event `LEN-GB000000002-E000002` (`0332d6a4-9ef8-4053-8714-0ac7c5bcf7b2`) used sequence `2`, immutable detail `6837d2a6-7e29-4a7d-acb1-d3b7e352944c`, issue movement `3fe172dd-adc5-44e5-8ec6-7587420078fa`, and succeeded request `e32dcf72-755d-4d1f-86c8-1e96e9fd761b`
- the issue movement used `ref_type = 'GROWTH_BATCH_INPUT'`, `ref_id = '0332d6a4-9ef8-4053-8714-0ac7c5bcf7b2'`, and `ref_line_id = '6837d2a6-7e29-4a7d-acb1-d3b7e352944c'`
- reversal event `LEN-GB000000002-E000003` (`6575aec2-30c8-40ef-9ab9-3b636a5bb02b`) used sequence `3`, detail `03b1dd13-cf49-4aa5-abab-6de06aa765a6`, receipt movement `48ce328c-fdc9-4383-a0d5-11164fb0da7f`, succeeded request `efd1c065-3d29-4185-8b1d-a216e0e7d80e`, and reason `Controlled G3 production smoke reversal`
- the receipt movement used `ref_type = 'GROWTH_BATCH_INPUT_REVERSAL'`, `ref_id = '6575aec2-30c8-40ef-9ab9-3b636a5bb02b'`, and `ref_line_id = '03b1dd13-cf49-4aa5-abab-6de06aa765a6'`
- source stock moved `48 -> 47 -> 48`; Growth Batch material cost moved `MZN 0.00 -> MZN 10.304233 -> MZN 0.00`; memo direct cost stayed `MZN 0.00`; total and remaining cost reconciled to `MZN 0.00` after reversal
- the original issue event, detail, and movement remained unchanged; after reversal the UI no longer exposed a second `Reverse event` action
- final counts were `growth_batches=2`, `growth_batch_events=6`, `growth_batch_measurements=1`, `growth_batch_direct_costs=1`, `growth_batch_stock_inputs=1`, `growth_batch_stock_input_reversal_lines=1`, `posting_requests=17`, `stock_movements=69`, `stock_levels=16`, `cash_transactions=11`, `bank_transactions=3`, `vendor_bills=3`, `sales_invoices=4`, and `finance_document_events=45`
- negative stock and duplicate stock bucket checks remained `0`; cash, bank, vendor bill, invoice, settlement, and finance-event rows were unchanged by G3; `items.unit_price` sum stayed `189778` and the preflight hash baseline was unchanged
- Supabase API logs showed 200 responses for the maintained G3 preview/post/reversal/read-model path. Postgres logs showed no rollout/smoke failure; two inspection-only errors were caused by read-only verification attempts and did not affect the maintained UI path.
- At the G3 hosted rollout checkpoint, transfers and later harvest/split outputs, completion, whole-batch reversal, FIFO biological layers, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records remained outside hosted scope. G4.2 transfer scope is now live as recorded above, and G5.1 governed depleting harvest is live as recorded in the 2026-07-03 rollout note. Split/child batches, non-depleting yield, completion, whole-batch reversal, FIFO, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records remain outside hosted scope.

2026-06-20 Growth Batches G1-G2 rollout:

- the 2026-06-20 G1-G2 rollout aligned hosted Supabase through migration `20260619175129_add_growth_batch_lifecycle_events.sql`; the current hosted and local Growth Batch state is documented in the later G4.2 and G5.1 notes above
- production frontend is aligned at Git commit `c7b5e299c277c28faf78fc5f19e4fe43fbfb20d3 feat(growth): add governed growth batches foundation`
- Vercel production deployment `dpl_3ouAxVTpzLpAek6GGSMjP6hQ5pbR` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- the database-first rollout ran from `2026-06-20T09:22:08+02:00` to `2026-06-20T09:42:06+02:00`; pre-rollout hosted history had 26 migrations through `20260615213640`, and post-rollout history had 28 migrations with `20260619175117` and `20260619175129` applied in order
- `npx supabase db push --linked` exited `0`; the second dry run reported that the remote database was up to date
- live Growth Batch tables are `growth_batches`, `growth_batch_counters`, `growth_batch_events`, `growth_batch_measurements`, and `growth_batch_direct_costs`
- live read models are `growth_batches_register`, `growth_batch_current_state`, `growth_batch_event_timeline`, `growth_batch_measurement_history`, and `growth_batch_direct_cost_history`
- live public RPCs are `create_growth_batch_draft`, `update_growth_batch_draft`, `cancel_growth_batch_draft`, `activate_growth_batch`, `record_growth_batch_measurement`, and `record_growth_batch_direct_cost`
- authority checks verified RLS and FORCE RLS on all five Growth Batch tables, denied authenticated direct INSERT/UPDATE/DELETE, kept mutation RPC-only, revoked maintained mutation RPC execution from `anon` and `PUBLIC`, and retained `SECURITY DEFINER` functions with restricted `search_path`
- the controlled production smoke ran from `2026-06-20 10:35:46 +02:00` to `2026-06-20 10:54:48 +02:00` using the maintained production UI, tenant `Leny Doçuras` (`b49089cc-af95-44a6-bdff-45faec9d7bc5`), Admin user context `Samuel Massinga`, and location `Casa / QA-A2 - A2 Production Smoke`
- retained smoke batch `LEN-GB000000001` (`14490729-afa2-461a-a2f8-5f97afc745a5`) is active with name `QA Growth Smoke — Poultry — 2026-06-20 10:37 CAT`
- final smoke state was opening/current quantity `10 EA`, latest total weight `10 KG`, material cost `MZN 0.00`, direct cost `MZN 1.00`, total cost `MZN 1.00`, harvested cost `MZN 0.00`, and remaining cost `MZN 1.00`
- draft creation and notes edit were performed through `/growth-batches`; the backend generated the reference, the reference stayed unchanged, and the draft edit created no lifecycle event
- activation event `a8106b7a-a5a2-438b-9dbd-02f0b3b6115b` used event sequence `1`
- total-weight measurement event `d924afa0-53d0-4314-a7d3-1fad1326b98d` with detail `db5ecb06-065b-4c09-a20f-6f1634b2f3f8` used event sequence `2`
- Water memo direct-cost event `be3a0b50-46f9-4f25-bf27-0f1ce4723b7b` with detail `7d7614dd-a916-4e3f-9aeb-ebc77b8a2dfa` used event sequence `3`
- succeeded posting requests were `growth.batch.create` (`d20b1c2b-63d4-4c9b-9f18-5a4d0c8cc40e`), `growth.batch.activate` (`feaef562-f931-4d91-af37-d0b71558a452`), `growth.batch.measurement` (`2a9b158f-84aa-4643-85cc-ea5e96727f84`), and `growth.batch.cost` (`a1348996-bb1f-468c-aecf-18090336bc9c`)
- Production idempotency persistence was verified through succeeded posting requests and non-duplicated events/details. Replay, mismatch, concurrency and failure behavior remain covered by the guarded local `31/31` regression suite.
- Growth Batch row counts moved as expected: `growth_batches` `0 -> 1`, `growth_batch_events` `0 -> 3`, `growth_batch_measurements` `0 -> 1`, `growth_batch_direct_costs` `0 -> 1`, and `posting_requests` `9 -> 13`
- stock remained unchanged: `stock_movements` `53 -> 53` and `stock_levels` `9 -> 9`
- finance remained unchanged: `cash_transactions` `4 -> 4`, `bank_transactions` `0 -> 0`, `vendor_bills` `1 -> 1`, `sales_invoices` `0 -> 0`, and `finance_document_events` `5 -> 5`
- commercial selling prices remained unchanged: `items.unit_price` sum `2500 -> 2500`, hash `042919f464f3830a8a7c17791d9a43e7` unchanged
- G1-G2 created no physical stock movement, did not mutate stock levels, and did not create cash, bank, vendor bill, settlement, invoice, supplier liability, finance journal/event, or `items.unit_price` changes
- `/growth-batches` and `/bom` were validated at widths `1440`, `1200`, `820`, and `390` in light and dark mode; there was no CSP/CORS error, no page-level horizontal overflow, no unlabeled weight, and costs displayed with MZN
- accepted responsive observation: at `1200` and `820`, the Growth Batches desktop/tablet table uses contained horizontal table scrolling while page/body overflow remains zero
- BOM workflow cards passed visual review with Landed Cost secondary, Production Runs action-oriented, no BOM posting performed, and no BOM business logic changed
- local guarded finance regression passed `31/31` before rollout against `http://127.0.0.1:54321`
- GitHub Actions `Validation` run `27863125281` / `#13` passed for commit `c7b5e299`
- G3-G5 remained future scope at the G1-G2 production rollout: stock-input consumption, mortality, transfers, harvest, completion, reversal, FIFO biological layers, COGS, fair-value accounting, automatic finance posting, vendor-bill allocation, cash/bank settlement, advanced allocation, and profitability dashboards were not live.

2026-06-21 Growth Batches G3 pre-rollout readiness note:

- this note records the local validation that preceded the 2026-06-22 production rollout
- the G3 branch added `20260620132646_add_growth_batch_stock_inputs.sql` and `20260620132656_add_growth_batch_stock_input_posting.sql`, now live in hosted production
- local replay of all 30 migrations passed; Growth Batches regression passed `5/5`, complete finance regression passed `31/31`, independent implementation inspection passed, authenticated local visual QA passed at `1440`, `1200`, `820`, and `390` in light and dark mode, and static validation/build passed
- G3 adds non-mutating stock-input preview, atomic multi-line stock consumption, frozen source-WAC material costs, Growth Batch material/total/remaining rollups, append-only stock-input history, and MANAGER+ compensating reversal
- stock-input issue movements use `ref_type = 'GROWTH_BATCH_INPUT'`, the stock-input event id as `ref_id`, and the immutable input detail id as `ref_line_id`
- reversal receipt movements use `ref_type = 'GROWTH_BATCH_INPUT_REVERSAL'`, the reversal event id as `ref_id`, and the immutable reversal detail id as `ref_line_id`
- G3 remains base-UOM-only for consumed item lines and does not add generic UOM conversion
- G3 stock inputs create physical stock issue movements and material-cost rollups, but do not create cash, bank, vendor bill, settlement, invoice, supplier liability, finance journal/event, automatic COGS, or `items.unit_price` changes
- authenticated local visual QA used isolated local company `G3 Visual QA Local 20260621120349`, batch `G3 Visual Batch 20260621120349`, batch reference `GVI-GB000000001`, and stock-input event `GVI-GB000000001-E000002`; it verified valid preview, stale-preview protection, duplicate source-line rejection, insufficient-stock blocking, OPERATOR+ posting, MANAGER+ event-specific reversal with mandatory reason, compensating receipt, original issue preservation, material-cost restoration from `MZN 12.50` to `MZN 0.00`, and stock restoration to `100 EA at MZN 2.50 WAC`
- At the G3 validation checkpoint, transfers and later harvest/split outputs, completion, whole-batch reversal, FIFO biological layers, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records remained outside hosted scope. G4.2 transfer scope is now live as recorded above, and G5.1 governed depleting harvest is live as recorded in the 2026-07-03 rollout note. Split/child batches, non-depleting yield, completion, whole-batch reversal, FIFO, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records remain outside hosted scope.

2026-06-18 Production Runs rollout:

- at the 2026-06-18 Production Runs rollout, hosted Supabase aligned through migration `20260615213640_add_production_run_posting.sql`
- production frontend is aligned at Git commit `4f82c5a feat(production): add governed production runs`
- Vercel production deployment `dpl_8Es8xX6RAAAmof59ssCwuTLWeQmF` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- normal Production Runs now use `/production-runs` with `post_production_run` (`production.run.post`) and `reverse_production_run` (`production.run.reverse`)
- the controlled production smoke used tenant `Leny Doçuras`, recipe `Bolo Custarde` v1, item `Bolo de Custarde`, and source `Casa / CDC001 - Cozinha - Casa`
- a controlled `stock.receipt` setup added 3 `Fermento` to `Casa / CDC001 - Cozinha - Casa` through the maintained Movements UI, creating movement `07c1da12-8e7c-45d0-90ba-32b141404163` and succeeded posting request `9b1f5e7c-a046-458c-a889-6f4056d36805`
- Production Run `LEN-PR000000001` (`0eee505d-a337-480c-9984-e5690399cf35`) was created, previewed, posted once, and reversed once through the maintained production UI
- posting created one succeeded `production.run.post` request (`33facecd-a63e-45c9-939d-2179303031b1`), seven input issue movements, and one output receipt movement (`bb2fe802-9d58-4f7a-9118-982a44ef84ce`)
- reversal created one succeeded `production.run.reverse` request (`54409ae2-d3f4-483f-8b7b-ecfd66717ae9`), one compensating output issue movement (`2991d192-223d-42a3-b017-c41850d43c5b`), and seven compensating input receipts
- Fermento stock in `Casa / CDC001 - Cozinha - Casa` moved `0 -> 3 -> 0 -> 3`; `Bolo de Custarde` stock in `Casa / QA-A2 - A2 Production Smoke` moved `0 -> 1 -> 0`
- duplicate stock bucket and negative stock checks remained zero, `items.unit_price` remained `1500`, and no cash, bank, or vendor-bill rows were created by the Production Run
- no production replay or payload-mismatch tests were performed; those paths remain covered by the local `26/26` finance regression suite
- the remaining non-blocking follow-ups are intentionally clearing previously saved draft destination/notes and reconsidering authenticated SELECT access to `production_run_counters`

2026-06-14 consolidated A2.4/A2.5 governed stock-posting rollout:

- hosted Supabase is aligned through migration `20260614123300_add_governed_manual_stock_posting.sql`
- production frontend is aligned at Git commit `51c4fd1 fix(inventory): govern remaining stock postings`
- Vercel production deployment `dpl_AkMrBB8BvcufSRNjDdWTAmXm8WMx` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- governed operation types now live through dedicated backend RPCs: `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, and `stock.adjustment`
- representative production smokes passed for PO receipt, sales shipment, transfer, and positive adjustment on the controlled `Leny Doçuras` tenant
- the completed transfer smoke moved one `Bolo de Custarde` from `Casa / CDC001 - Cozinha - Casa` to `Casa / QA-A2 - A2 Production Smoke`, creating one succeeded `stock.transfer` posting request and two balanced movements
- the completed shipment smoke created controlled sales order `LEN-SO000000002`, shipped one `Bolo de Custarde` from `QA-A2`, created one succeeded `sales.ship` posting request and one issue movement, and created no invoice or settlement
- duplicate stock bucket and negative stock checks remained zero, and `items.unit_price` remained `1500`
- no production replay or payload-mismatch tests were performed; those paths remain covered by the local `24/24` finance regression suite
- the production regression guard blocks the production project `ogzhwoqqumkuqhbvuzzp`
- legacy POS RPCs remain temporarily executable for stale Tauri compatibility until A2.4a.2

2026-06-14 A2.4a.1 normal web POS idempotency rollout:

- hosted Supabase migration `20260613144412_add_idempotent_operator_sale.sql` was applied successfully
- production frontend is aligned at Git commit `80c7c70 fix(pos): add idempotent sale posting`
- Vercel production deployment `dpl_DLz4QxxMooVrNDutD2e2H4YNzzEh` serves `https://stockwiseapp.com` and `https://www.stockwiseapp.com`
- normal web Point of Sale now calls `post_operator_sale`, backed by `posting_requests` operation type `operator.sale`
- controlled production POS smoke validation passed after the database-first rollout and frontend deployment
- the smoke submitted one cash sale once, creating one sales order, one sales-order line, one stock issue movement, one cash transaction, and one `operator.sale` posting request
- no duplicate sale, movement, or settlement was created, and stock moved from `2` to `1` for the approved controlled item
- the posted selling price remained `1500`, `items.unit_price` remained `1500`, and commercial POS pricing stayed separate from inventory cost
- duplicate stock bucket and negative stock checks remained clear after the smoke
- legacy POS RPCs remain temporarily executable for deployment compatibility and stale Tauri clients until A2.4a.2 closes normal authenticated legacy execution

2026-06-13 Assembly A1-A2.3 production rollout:

- production frontend and backend are aligned at Git commit `2bfb31d fix(inventory): make stock rollups concurrency safe`
- hosted Supabase migrations `20260611035202_harden_assembly_rpc_authority.sql`, `20260611201848_fix_opening_stock_uom_text_id.sql`, `20260611211051_add_posting_requests_and_idempotent_assembly.sql`, and `20260613050914_make_stock_rollup_concurrency_safe.sql` were applied successfully
- controlled production assembly smoke validation passed after the database rollout
- the smoke build created one build, seven component issue movements, and one finished-item receipt movement through the `/bom` Recipes & Assemblies UI
- all eight assembly movements were linked with `ref_type = 'BUILD'` and the generated build id
- component and finished-item `stock_levels` reconciled to the posted movement deltas, weighted-average cost updated as expected, and no stock bucket became negative
- `items.unit_price` stayed unchanged, preserving separation between commercial selling price and inventory cost
- duplicate stock bucket detection still returned zero rows after the smoke build
- no production finance regression suite was run, because that suite creates broad temporary Auth, company, inventory, and finance data
- no POS or PO production mutation smoke was run, because no separately approved controlled target was provided
- the follow-up `/bom` success-feedback patch is UI-only and does not change posting authority, idempotency, stock valuation, finance posting, or access control

2026-06-05 production deployment:

- deployed with `npx vercel build --prod` and `npx vercel deploy --prebuilt --prod`
- latest production deployment URL: `https://stockwise-popyw0hqa-honeythiefs-projects.vercel.app`
- custom production domain verified at `https://stockwiseapp.com`
- reset-password recovery now routes through `/auth/callback` to `/update-password` before normal membership routing
- password updates use Supabase Auth `updateUser({ password })`, clear the recovery marker, and return the user to `/login`
- signup confirmation and resend-confirmation routing remain unchanged: confirmed no-company users reach onboarding and active-company users reach dashboard
- landing card icon spacing fix is included; feature/workflow/use-case icon badges stay in normal card flow with visible top padding
- no Supabase migration was created or pushed for this package
- no schema, RLS, company membership authority, entitlement/trial, finance, inventory, POS, invoice, settlement, valuation, or Platform Control permission logic was changed

2026-06-04 Supabase Auth email confirmation update:

- production Supabase Auth requires email confirmation before normal app access (`mailer_autoconfirm=false`)
- unverified email sign-ins remain disallowed
- production Site URL is `https://stockwiseapp.com`
- redirect allow-list includes `https://stockwiseapp.com/auth/callback`
- Supabase Auth transactional email uses configured custom SMTP through Brevo
- Confirm signup, Reset password, Invite user, and Change email templates were polished with Portuguese-first StockWise/WiseCore Technologies copy
- no Supabase migration was created or pushed for this package
- no change was made to company membership authority, entitlement/trial logic, finance, inventory, POS, invoices, settlements, valuation, or RLS

2026-06-03 production deployment:

- auth/signup polish is live after `npx vercel build --prod` and `npx vercel deploy --prebuilt --prod`
- latest production deployment URL: `https://stockwise-b7dqlzgvu-honeythiefs-projects.vercel.app`
- Supabase migration `20260602191520_add_profile_phone_number.sql` was applied live with `npx supabase db push`
- `profiles.phone_number` is nullable, profile-only contact data
- profile phone saves use Supabase Auth metadata plus the `handle_user_profile_sync` trigger as the authoritative write path when direct `profiles` writes are blocked by RLS
- remote migration history entry `20260531145805` was repaired as an accidental synthetic `*_remote_schema.sql` artifact; it was not committed as a real migration
- no change was made to company membership authority, entitlement/trial logic, finance, inventory, POS, invoices, settlements, valuation, or RLS

## Supabase and Email Release Requirements

StockWise depends on Supabase for:

- authentication and company membership
- entitlement and trial enforcement
- finance posting, settlements, reconciliation, and imports
- outbound company-access email sending

Edge-function mail flows require the configured Brevo SMTP secrets. Verify required secrets before deploying or testing an email function.

Supabase Auth email confirmation uses the Auth service SMTP configuration, also backed by Brevo. Do not confuse those Auth SMTP settings with Edge Function secrets; both must remain configured for their respective flows.

Current support inbox:

- `geral@stockwiseapp.com`

This inbox is for inbound user contact. Outbound company-access emails go to the selected company's canonical recipient, not to support.

Zoho hosts the public mailbox for receiving and replying to messages. Transactional delivery remains separate: Supabase Auth SMTP settings and Edge Function mail secrets must continue to be configured with the approved transactional mail provider and updated sender or reply-to identity externally where those values are not controlled by the repository.

## Tauri Release Position

Desktop and Android packaging are maintained, but they are still direct-distribution builds:

- desktop updater is not configured
- desktop code signing is not configured in-repo
- Android release signing uses local keystore input and is intentionally not committed

Use:

- [TAURI_RELEASE_WORKFLOW.md](TAURI_RELEASE_WORKFLOW.md) for the maintained packaging path
- [TAURI_DESKTOP_GUIDE.md](TAURI_DESKTOP_GUIDE.md) for desktop-specific notes

## Release Checklist

Use this checklist before calling a build or release "ready":

1. verify current docs still match the product and release path
2. confirm the GitHub Actions non-mutating validation workflow passed for the release ref
3. run `npm run lint:js`
4. run `npm run build`
5. run `npm run test:finance-regression`
6. run `npm run tauri:prepare` if desktop or Android packaging metadata matters for this release
7. verify branding, Point of Sale naming, and Android-first navigation assumptions on the current UI
8. if DB code changed, validate the canonical migration workflow before shipping
9. if the release changes operational posture, update the security baseline or recovery runbook in the same pass

## What This Document Does Not Cover

This document does not try to be:

- a generic Supabase tutorial
- a payment-gateway runbook
- a historical release log

If a release topic is not current and specific to StockWise, it should live elsewhere or not be tracked.

## Payment activation rollout (live)

Hosted production and local replay are aligned at 41 migrations through `20260711091724_add_payment_activation_workflow.sql`. Release `48b5b1217a1971aada6949cbbc4689a4e6b6cd3b` passed Validation `29155359288`; the linked push ran from `2026-07-11T16:04:56.1021933+02:00` to `2026-07-11T16:05:16.0576542+02:00`, exited zero, and applied exactly the two payment-activation migrations. Hosted RLS, FORCE RLS, grants, restricted search paths, private storage controls, and authenticated-only workflow RPCs were verified before mutation smoke.

Vercel release deployment `dpl_GDpEFb5Q3HyTHhPUvXdy8ei6CuXc` served both production aliases. Controlled Leny Doçuras smoke used a clearly synthetic proof and temporary non-secret QA channel, produced request `PAY-B49089-000001`, exercised correction/resubmission and approval, then restored the company to trial and deactivated the channel. The entitlement helper recalculated the restored trial expiry to `2026-07-18` and purge date to `2026-08-01`; the original later dates could not be restored through the governed UI and were not forced by direct mutation. Localization correction `db6083c8e495e9118dcde6c8ed00220f7e152c73` passed Validation `29164872936` and deployed as `dpl_GzpTNoVezPEZybGCvGw3v1SVHnDE`.

## Commercial tax package production rollout (2026-07-12)

Hosted production moved from 41 to 43 migrations when `20260712052825_add_commercial_tax_integrity.sql` and `20260712052833_add_item_profile_trust.sql` applied from `2026-07-12T20:29:28.1758782Z` to `2026-07-12T20:29:47.8235189Z` with exit zero. Production smoke then exposed a canonical Sales Order finance-state read-model defect that counted line tax twice. Forward-only migration `20260712230118_fix_canonical_sales_order_finance_state.sql` applied from `2026-07-12T21:12:33.2824249Z` to `2026-07-12T21:12:49.5882887Z`, bringing hosted and local history to 44; the linked follow-up dry run reported the remote database up to date.

Release `b5cf3463b07ba0b512150694216cf8b406a836bf` passed Validation `29207659225`. Corrective release `f3a462b5aaec037171c4d9c128abbf7b993601c0` passed `29209120051`; Sales Order presentation fix `83a497d8cf138fa12f82378136af1e48eb99f2f1` passed `29209397253`; Purchase Order label/accessibility fix `8bdbfb684f1b68a51618498a9a32d06e44456b0c` passed `29210227944` and deployed as `dpl_CyNr67yxrhWyFHkds6ZkebFUxK3p` to both production aliases.

Controlled Leny Doçuras smoke used synthetic non-statutory `QA_STD_725` and `QA_EXEMPT_0` options. Canonical SO `LEN-SO000000003` (`QA-TAX-SO-20260712`) totalled `364.80` from `346.90` subtotal and `17.90` line tax; draft SI `LEN-INV2026-00001` copied both line snapshots exactly and was not issued. Canonical PO `LEN-PO000000006` (`QA-TAX-PO-20260712`) totalled `354.15` from `346.90` subtotal and `7.25` line tax; draft VB `LEN-VB00002` copied both line snapshots exactly and was not posted. QA item `QA-TAX-20260712` round-tripped its resale/stock/buy/sell profile and `123.45` price; only `min_stock` changed from `0` to `1` through the maintained UI.

Defaults were restored to null, both synthetic options were deactivated, and a deliberate no-default draft remained visibly unconfigured, failed confirmation, and was cancelled. Production attack, concurrency, cross-company, immutable-document, and rounding-abuse tests remained local-only. Final local validation passed clean replay `44/44`, finance regression `288/288`, and 126 independently named package checks.
