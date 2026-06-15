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

This is not a decorative page-load smoke suite. It mutates real test data against the connected Supabase project and then removes it.

The suite has a startup target guard in `tests/finance-regression/helpers.mjs`. It runs before Supabase clients are created, before Auth users or companies are created, and before mutation RPCs are invoked. Local Supabase targets such as `http://127.0.0.1:54321` and `localhost` are allowed automatically. The known StockWise production project `ogzhwoqqumkuqhbvuzzp` is hard-blocked and cannot be overridden. Any other remote project requires both `ALLOW_REMOTE_FINANCE_REGRESSION=true` and `FINANCE_REGRESSION_TARGET=non-production`, and must be an isolated non-production target.

## Finance Flows Covered

Current protected workflows:

1. Sales Order -> Sales Invoice draft -> approval -> issue readiness -> issue
2. Purchase Order -> Vendor Bill draft -> approval -> post
3. Settlements, including:
   - bank receive
   - bank pay
   - cash posting
   - settlement anchoring
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
- trial and entitlement enforcement

## Test Architecture

Current implementation lives in:

- `tests/finance-regression/helpers.mjs`
- `tests/finance-regression/finance-regression.test.mjs`

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
