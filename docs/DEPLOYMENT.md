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
