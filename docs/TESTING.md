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
