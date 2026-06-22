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

## Current Production Release Notes

2026-06-20 Growth Batches G1-G2 rollout:

- hosted Supabase is aligned through migration `20260619175129_add_growth_batch_lifecycle_events.sql` with 28 active migrations
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

2026-06-20 local Growth Batches G3 stock-input readiness note:

- this is not a production rollout note; hosted production remains at 28 migrations through `20260619175129_add_growth_batch_lifecycle_events.sql`
- the local G3 branch adds two pending migrations, `20260620132646_add_growth_batch_stock_inputs.sql` and `20260620132656_add_growth_batch_stock_input_posting.sql`, for a 30-migration local chain
- local replay of all 30 migrations passed; Growth Batches regression passed `5/5`, complete finance regression passed `31/31`, independent implementation inspection passed, authenticated local visual QA passed at `1440`, `1200`, `820`, and `390` in light and dark mode, and static validation/build passed
- current G3 state is ready for normal-user staging, commit, push, and CI; hosted rollout has not started and production smoke has not been performed
- local G3 adds non-mutating stock-input preview, atomic multi-line stock consumption, frozen source-WAC material costs, Growth Batch material/total/remaining rollups, append-only stock-input history, and MANAGER+ compensating reversal
- stock-input issue movements use `ref_type = 'GROWTH_BATCH_INPUT'`, the stock-input event id as `ref_id`, and the immutable input detail id as `ref_line_id`
- reversal receipt movements use `ref_type = 'GROWTH_BATCH_INPUT_REVERSAL'`, the reversal event id as `ref_id`, and the immutable reversal detail id as `ref_line_id`
- G3 remains base-UOM-only for consumed item lines and does not add generic UOM conversion
- G3 stock inputs create physical stock issue movements and material-cost rollups, but do not create cash, bank, vendor bill, settlement, invoice, supplier liability, finance journal/event, automatic COGS, or `items.unit_price` changes
- authenticated local visual QA used local-only company `G3 Visual QA Local 20260621120349`, batch `G3 Visual Batch 20260621120349`, batch reference `GVI-GB000000001`, and stock-input event `GVI-GB000000001-E000002`; it verified valid preview, stale-preview protection, duplicate source-line rejection, insufficient-stock blocking, OPERATOR+ posting, MANAGER+ event-specific reversal with mandatory reason, compensating receipt, original issue preservation, material-cost restoration from `MZN 12.50` to `MZN 0.00`, and stock restoration to `100 EA at MZN 2.50 WAC`
- G4/G5 capabilities remain out of scope: mortality, shrinkage, transfers, harvest/split outputs, completion, whole-batch reversal, FIFO biological layers, fair value, automatic finance posting, profitability dashboards, and per-animal/per-plant records are not implemented by this local package

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

- `support@stockwiseapp.com`

This inbox is for inbound user contact. Outbound company-access emails go to the selected company's canonical recipient, not to support.

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
