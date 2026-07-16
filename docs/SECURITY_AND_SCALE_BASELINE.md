# StockWise Security and Scale Baseline

Status: 2026-06-27.

This document records the current security, scalability, monitoring, rate-limiting, deployment, and operational baseline for StockWise. It is an audit and operating package, not a schema-change package. No business logic, RLS policy, migration, finance posting, stock posting, POS, invoice, settlement, valuation, entitlement, membership, or Platform Control authority change is introduced by this document.

## Executive Summary

StockWise already has a solid backend-authoritative foundation for the highest-risk workflows: Supabase Auth, company-scoped RLS, RPC-backed posting workflows, explicit company membership, separated platform-admin authority, guarded tenant entitlement state, storage policies, non-mutating CI validation, and production release validation with the finance regression suite.

The largest current gaps are operational rather than functional: finance regression is not yet safe for always-on public CI, formal recovery drills are not yet recorded, monitoring relies on Vercel/Supabase/browser checks rather than alerting, rate limiting is partial outside account/bootstrap/email paths, and load/index review has not been formalized for heavier commercial traffic.

The next hardening phase should avoid broad rewrites. The practical sequence is CI gating, Supabase advisor/index review, alerting/error tracking decision, recovery drill, and targeted rate limiting for expensive mutation/export workflows.

## Audit Scope

Reviewed areas:

- Supabase migrations, tables, RLS policies, RPCs, views, and storage policies
- Supabase Edge Functions and shared security helpers
- Supabase Auth, email confirmation, password recovery, profile phone handling, and routing guards
- company membership, active company, roles, entitlement state, and Platform Control separation
- Vercel hosting headers, caching posture, and production validation commands
- Tauri desktop/Android packaging assumptions
- documentation, migration discipline, and current testing posture

This pass did not run destructive recovery tests and did not change production schema.

## Current Implemented Protections

### Authentication and account lifecycle

- Supabase Auth is the only authentication system.
- Production email confirmation is enabled through Supabase Auth and Brevo SMTP.
- Password recovery routes through `/auth/callback` and `/update-password` before normal onboarding/dashboard routing.
- Reset password uses Supabase Auth `updateUser({ password })` after the recovery session is established.
- Signup captures optional phone metadata as profile contact data only. `profiles.phone_number` is nullable and is not an auth factor, invitation key, tenant selector, entitlement signal, or phone OTP path.
- Auth callback routing keeps confirmation, recovery, and invitation flows separate.

### Company authority and access

- Company authority lives in `company_members` and `member_role`.
- Active company state lives in `user_active_company`.
- Entitlement state lives in `company_subscription_state`.
- Platform-admin identity is separated through `platform_admins`; company ownership does not grant Platform Control access.
- Public bootstrap creates a tenant through a backend RPC rather than a frontend-only sequence.
- Trial and company-access checks are mirrored in route guards but enforced through database helpers/RPCs.

### Database and RLS

- Hosted production and local replay contain 44 active migrations through `20260712230118_fix_canonical_sales_order_finance_state.sql`; governed settlement posting, commercial tax integrity, G5.1 depleting harvest, and G5.2 lifecycle completion are live and production-smoke validated. Growth Batches G4.1 is live after the approved 2026-06-28 database-first rollout and controlled production smoke; G4.2 transfers are live after the approved 2026-07-02 database-first rollout, corrective UI deployment, and controlled production smoke; G5.1 harvests are live after the approved 2026-07-03 database-first rollout and controlled production smoke; G5.2 completion is live after the approved 2026-07-04 database-first rollout and 2026-07-09 maintained-UI smoke. The G4.2 rollout used release commit `6995c1c59e4399258ab663953b0a129f606b92b5`, UI fix commit `c84469100249188144cb6305a634e21fba77a653`, Vercel deployment `dpl_ECTTdBiBpL6y4kkm39XmsqtpmY3p`, and GitHub Validation run `28617062013` for the corrected frontend. The G5.1 rollout used release commit `6f050745a9e1e5f9a56bfee7f30bca2b7ff55e10`, Vercel deployment `dpl_4sYA2iZ1r61iB1mdZTgZxY7DPPaH`, and GitHub Validation run `28657058435`. The G5.2 rollout used feature commit `6fa6bdb1303c9457f0b26fa6934a3d096cdad38b`, validation run `28706577810`, UI correction `bc22eb3facd166dbcd59fb7d5bedb21bb51d20b9`, validation run `29051595028`, and Vercel deployment `dpl_BRA6QUesB64T8LwF3rUAF7dYFKfv`. Governed settlement release `5e47a9d279e4db7c4f588d420bd9439b751d260d` passed Validation run `29130740318` and deployed as `dpl_7rPAojKUq7sSeqkZ49WE2cZH65Wh`.
- The canonical migration baseline enables RLS on the public business tables and defines company-scoped policies.
- Core protected tables include `companies`, `company_members`, `profiles`, `user_active_company`, `company_subscription_state`, `platform_admins`, item/stock/finance tables, invitations, notifications, and operational control-plane tables.
- Storage policies exist for private `bank-statements` and public `brand-logos` buckets, with company-scoped access rules.
- `*_remote_schema.sql` files from `db pull` are treated as review artifacts by default, not automatic canonical migrations.

### Backend-authoritative workflows

StockWise does not rely on UI state alone for the highest-risk workflows:

- company bootstrap uses `create_company_and_bootstrap`
- invitation discovery/acceptance uses authenticated email-bound RPCs
- active company selection uses backend membership checks
- Platform Control actions use platform-admin RPCs
- POS sale issue uses dedicated operator sale RPCs
- stock ledger writes use `stock_movements` plus database rollups into `stock_levels`
- finance document issue/post/approval/settlement workflows use RPCs, triggers, and state guards
- the live governed-settlement package revokes normal direct ledger inserts and exposes authenticated-only `post_cash_settlement`, `post_bank_settlement`, `post_cash_adjustment`, `post_bank_ledger_transaction`, and atomic `post_bank_ledger_import` RPCs; internal resolver/normalization/idempotency helpers remain non-executable by normal clients and all definer functions use restricted search paths. Settlement checks normalize exact two-decimal `numeric` values after locking, reject every positive amount against normalized zero outstanding, and use no additive epsilon. Bank imports are ADMIN+, company-scoped, capped at 500 rows/512 KiB, canonical SHA-256 batch-idempotent, and transactionally all-or-nothing. Hosted catalog verification confirmed RLS stayed enabled, normal direct inserts stayed denied, PUBLIC/anon execution stayed zero, and no RLS policy was weakened.
- guarded company reset is platform-admin only, auditable, rate-limited, and blocked for active-paid tenants

### Edge Functions

The current Edge Function layer includes shared helpers for:

- bearer token checks for user-invoked functions
- service-role clients only inside trusted Edge Function code
- body-size-limited JSON reads
- required text/email validation
- HMAC-signed internal requests for internal AI/schema snapshot functions
- per-scope rate limiting through `consume_security_rate_limit`
- Brevo SMTP delivery through shared mailer helpers

Sensitive functions include admin/user management, invite/report/company-access mailers, due reminders, digest worker, schema snapshot, and AI operations. Several are intentionally `verify_jwt=false` because they use a hook secret or HMAC signature instead of Supabase user JWT validation.

### Hosting, headers, and caching

Vercel serves the SPA with:

- immutable caching for `/assets/*`
- `no-store` for app routes
- HSTS
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- restrictive Permissions Policy
- CSP limiting scripts/styles/connections/images to the app, fonts, and Supabase endpoints

This is appropriate for the web app baseline. Dynamic business data is fetched through authenticated Supabase APIs and is not aggressively cached by Vercel routes.

### Testing and release validation

Current required validation for material app changes:

```bash
npm run check:migrations
npm run lint:js
npm run check:css-vars
npm run check:css-classes
npm run build
npm run test:finance-regression
```

The finance regression suite runs real Supabase-backed workflows, creates temporary data, validates posting/access behavior, and cleans up after the run.

## Partial Protections

- Auth signup, resend confirmation, and reset password have Supabase/Brevo provider controls plus frontend cooldowns, but not a StockWise-owned database rate limit.
- Company bootstrap has backend rate limiting; assembly posting, normal web POS posting, PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, adjustment, Production Run post/reversal, and Growth Batch create/activate/cancel/measurement/direct-cost/stock-input/reversal/loss/transfer/harvest/completion operations have backend idempotency through `posting_requests`, including `growth.batch.transfer`, `growth.batch.transfer.reverse`, `growth.batch.harvest`, `growth.batch.harvest.reverse`, `growth.batch.complete`, and `growth.batch.complete.reverse`. Shared stock rollups use atomic negative-delta guards and receipt upserts. A2.4a.1 is live in hosted Supabase as of 2026-06-14: normal web POS uses `post_operator_sale` with operation type `operator.sale`, the production smoke passed, `authenticated` can execute the wrapper, and `anon` cannot execute it. The legacy POS RPCs remain a temporary compatibility bypass until A2.4a.2 reviews stale Tauri clients and closes normal authenticated legacy execution. The consolidated A2.4/A2.5 package is live as of 2026-06-14 through `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, and `stock.adjustment`; representative production smokes passed for PO receipt, sales shipment, transfer, and positive adjustment. Production Runs are live as of 2026-06-18 through `production.run.post` and `production.run.reverse`; the controlled post/reversal smoke passed with zero duplicate/negative stock buckets and unchanged `items.unit_price`. Growth Batches G3 is live as of 2026-06-22 through `growth.batch.input` and `growth.batch.input.reverse`; controlled stock-input/reversal smoke passed with zero duplicate/negative stock buckets, restored source stock/material cost, unchanged finance rows, and unchanged `items.unit_price`. G4.1 is live as of 2026-06-28 through `growth.batch.mortality`, `growth.batch.shrinkage`, `growth.batch.mortality.reverse`, and `growth.batch.shrinkage.reverse`; controlled loss/reversal smoke restored quantity and weight, created no stock movement, kept costs and finance rows unchanged, and left `items.unit_price` unchanged. G4.2 is live as of 2026-07-02 through `growth.batch.transfer` and `growth.batch.transfer.reverse`; controlled transfer/reversal smoke restored location, created no stock movement, kept costs and finance rows unchanged, and left `items.unit_price` unchanged. G5.1 is live as of 2026-07-03 through `growth.batch.harvest` and `growth.batch.harvest.reverse`; controlled partial/full harvest and reversal smoke restored quantity, weight, costs, and the QA output bucket, created only append-only harvest receipt/reversal issue movements, and left finance rows and pre-existing selling prices unchanged. G5.2 is live as of 2026-07-04/09 through `growth.batch.complete` and `growth.batch.complete.reverse`; the maintained-UI smoke verified lifecycle-only status changes, event-specific reversal, and no stock/finance/cost/price mutation, while helper privilege denial, replay, mismatch, and concurrency remain local regression coverage.
- The A1-A2.3 assembly and stock-engine hardening chain is live in hosted Supabase as of 2026-06-13 and passed controlled production assembly smoke validation. The smoke confirmed build-linked movement audit, stock rollup reconciliation, weighted-average cost behavior, unchanged `items.unit_price`, and zero duplicate stock buckets.
- Platform Control mailers and guarded reset paths have stronger rate limiting than ordinary frontend reads.
- Monitoring relies on Vercel logs, Supabase logs, Edge Function logs, browser console checks, and regression output. No third-party exception tracker is committed.
- CI/CD validation is wired for non-mutating checks on pull requests and pushes to `main`; finance regression remains a protected manual/live-environment gate.
- Supabase backups and recovery depend on the configured Supabase project plan and dashboard settings; this document does not prove a completed restore drill.
- Tauri packages the same frontend, but current desktop config has `csp: null` and broad local text-file permissions under app/home/temp paths. That should be reviewed before broader desktop distribution.
- The database contains many security-definer functions. This is expected for an RPC-heavy Supabase app, but it requires periodic review through Supabase advisors and source review.

## Missing Protections

- Protected-branch enforcement for the validation workflow.
- Safe isolated CI environment for finance regression.
- Formal backup restore drill evidence.
- Approved RTO/RPO and escalation ownership.
- Uptime monitoring and production error alerting.
- Dedicated provider deliverability checks for Gmail and Microsoft 365 spam/quarantine placement.
- Load/performance test baseline for dashboard, reports, registers, exports, and Platform Control list pages.
- Formal Supabase advisor review cadence for RLS, indexes, security-definer functions, and exposed views.
- Explicit StockWise-owned rate limits for all expensive mutation/export workflows.
- Desktop/mobile packaging security review for CSP, file permissions, signing, updater posture, and release-channel controls.

## Security Matrix By Workflow

| Workflow | Frontend only | RLS | RPC | Edge Function | Platform-admin only | Rate limiting | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Landing and public pricing | Yes | No | No | No | No | Vercel/provider | Static/public content. No business authority. |
| Signup and email confirmation | No | Auth/profile policies | Supabase Auth | Supabase Auth SMTP | No | Provider + UI cooldown | Brevo SMTP sends Auth templates. |
| Password recovery | No | Auth/profile policies | Supabase Auth | Supabase Auth SMTP | No | Provider | Recovery session must route to `/update-password`. |
| Profile phone | No | `profiles` policies/trigger | Auth/profile sync | No | No | Provider/session | Nullable profile-only contact field. |
| Company bootstrap | No | Company policies | `create_company_and_bootstrap` | No | No | Backend DB limiter | Starts trial and owner membership. |
| Active company selection | No | Membership policies | active-company helpers/RPCs | No | No | Session scoped | Must belong to selected company. |
| Invitation discovery/acceptance | No | `company_invites` policies | invite RPCs | `admin-users` sync/mail paths | No | Partial Edge limits | Email-bound and explicit acceptance. |
| Users and roles | No | `company_members` policies | role/member RPC paths | `admin-users` | No | Edge limits | Frontend guard is usability only. |
| Platform Control | No | `platform_admins` and control tables | platform-admin RPCs | access mailer | Yes | Partial | Company roles do not grant this. |
| Subscription/trial access | No | entitlement tables | access-state helpers/RPCs | access mailer | Mutations yes | Partial | Route guard mirrors backend state. |
| POS sale issue | No | Stock/finance/company policies | operator sale RPCs | No | No | A2.4a.1 normal web POS idempotency, state guards, no explicit throttle | `post_operator_sale` uses `posting_requests` with `operator.sale` for normal web POS. Production smoke passed on 2026-06-14. Legacy POS RPCs remain temporarily executable until A2.4a.2. |
| Stock movements and levels | No | Stock policies | triggers/RPCs | No | No | State guards and A2.4/A2.5 idempotency wrappers | `stock_movements` is ledger; `stock_levels` is rollup. Governed RPCs are live for `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, and `stock.adjustment`; representative production smokes passed with zero duplicate and negative stock buckets. |
| Sales invoices | No | Finance policies | issue/post/state RPCs | No | No | State guards | Backend issue/post invariants protect repeated clicks. |
| Vendor bills | No | Finance policies | approval/post RPCs | No | No | State guards | Backend AP anchors. |
| Settlements, bank, and cash | No | Finance policies | settlement guards/RPCs | No | No | State guards | Backend settlement authority. |
| Landed cost, BOM, assembly | No | Company/stock policies | workflow RPCs | No | No | Assembly idempotency, atomic stock rollup guards, state guards | Assembly RPCs enforce OPERATOR+ and build-linked stock movements; A2.1/A2.2 adds idempotent assembly wrappers, and A2.3 hardens shared rollup concurrency. This chain is live and production-smoke validated. Consolidated A2.4/A2.5 is also live and no longer blocks beginning Production Runs. |
| Production Runs | No | Company-scoped Production Run read policies; mutation is RPC-only | draft/post/reverse RPCs | No | No | Request-key idempotency, OPERATOR+ post authority, MANAGER+ reversal authority, stock trigger guards, base-UOM-only enforcement | Live and production-smoke validated as of 2026-06-18. Authenticated clients can read permitted rows but cannot directly mutate Production Run business tables. `post_production_run` uses `production.run.post`; `reverse_production_run` uses `production.run.reverse`. Posting and reversal write append-only `stock_movements`, never direct `stock_levels`, and never update `items.unit_price`. |
| Growth Batches | No | Company-scoped Growth Batch read policies; mutation is RPC-only; FORCE RLS on business, G3 detail tables, G4.1 loss tables, G4.2 transfer tables, G5.1 harvest tables, and G5.2 completion tables | draft/activate/cancel/measurement/direct-cost/preview-stock-input/post-stock-input/reverse-stock-input/preview-loss/record-loss/reverse-loss/preview-transfer/transfer/reverse-transfer/preview-harvest/post-harvest/reverse-harvest/preview-completion/complete/reverse-completion RPCs | No | No | Request-key idempotency for create, activate, cancel, measurement, direct cost, G3 stock input/reversal, G4.1 mortality/shrinkage/reversal, G4.2 transfer/reversal, G5.1 harvest/reversal, and G5.2 completion/reversal; OPERATOR+ posting/recording/transfer/harvest; MANAGER+ completion and reversal; validation triggers | Live G3 package as of 2026-06-22, live G4.1 package as of 2026-06-28, live G4.2 transfer package as of 2026-07-02, live G5.1 harvest package as of 2026-07-03, and live G5.2 completion package as of 2026-07-04/09. Authenticated clients can read permitted rows/views but cannot directly mutate Growth Batch business tables. Memo direct costs remain non-financial; G3 stock inputs add physical issue movements and compensating receipt movements, freeze source WAC as material cost, keep original movements immutable, and create no finance, supplier liability, settlement, invoice, or commercial price change. G4.1 losses reduce only current quantity/latest weight and create no stock/finance/cost/price mutation. G4.2 transfers update only current location fields and create no stock, finance, cost, or selling-price mutation. G5.1 harvests create one stock receipt and event-specific reversal creates one compensating stock issue. G5.2 completion changes only lifecycle status/audit/latest sequence and creates no stock, finance, sale, COGS, fair value, cost, quantity, weight, or `items.unit_price` mutation. |
| Reports and exports | Mostly UI | Read policies | Read helpers | No | No | Missing | Browser generation can become a performance risk. |
| Company-access emails | No | Control tables | audit RPCs | mailer-company-access | Yes | Edge limits | Brevo SMTP required. |
| Due reminders and digest worker | No | Company data policies via service role | Worker queries | Edge worker | No | Hook/worker controls | Requires worker secrets and Brevo config. |
| Schema snapshot and AI ops | No | Service-role constrained by function logic | Internal operations | HMAC Edge functions | Internal only | Internal secret/HMAC | Verify secrets before deployment. |

## Rate-Limiting Status

| Area | Current status | Risk |
| --- | --- | --- |
| Company bootstrap | Implemented through backend limiter | Good first layer against repeated trial creation. |
| Signup | Supabase provider-managed | No StockWise-owned custom limiter. |
| Resend confirmation | Supabase provider-managed plus 60-second UI cooldown | UI cooldown is not a backend control. |
| Password reset | Supabase provider-managed | Monitor abuse through Auth/Brevo logs. |
| Invite flows | Partial Edge/mail limits and email-bound acceptance | Review direct invite mutation paths before scale. |
| Platform Control actions | Platform-admin gating; guarded reset is rate-limited | Keep audit log review in release checks. |
| Edge Function emails | Shared Edge limiter where implemented | Verify every mailer uses the shared limiter before expanding. |
| POS posting | Backend authority, normal web idempotency, state guards, no explicit throttle | Complete A2.4a.2 legacy RPC closure after frontend deployment and maintained Tauri clients are reviewed; add throttles only if abuse or repeated-submit load appears. |
| Invoice issuing/posting | Backend authority/state guards, no explicit throttle | State invariants matter more than arbitrary limits. |
| Settlement posting | Backend authority/state guards, no explicit throttle | Add per-user throttles only after reviewing operator workflows. |
| Exports/PDF generation | Mostly browser-local; no server throttle | Watch browser performance and Supabase read volume. |

## Monitoring Status

Current signals:

- production-only Sentry frontend error monitoring, enabled only by explicit production environment configuration
- Vercel build and deployment logs
- Vercel runtime logs
- Supabase database logs
- Supabase Auth logs
- Supabase Edge Function logs
- browser console checks during smoke QA
- finance regression output

The Sentry privacy baseline sets `sendDefaultPii=false`, retains at most an opaque authenticated-user UUID, removes user email/name/IP, cookies, request headers and bodies, authorization data, URL query strings/fragments, console breadcrumbs, and sensitive customer, supplier, bank, invoice, vendor-bill, payment-proof, and authentication context. Browser-side and organization-level server-side privacy controls were validated with one controlled production event on 2026-07-15: message and URL secrets were scrubbed, request/query/body/header/cookie data was absent, no user identity was attached, and a second inspection showed no IP-derived geography value after `$user.geo.**` and `$user.ip_address` filtering.

This validation is scoped evidence, not an absolute guarantee. Arbitrary business data manually attached by future code still requires review. Sentry monitoring for Supabase Edge Functions is not integrated, and tracing and Session Replay remain disabled.

Not currently configured:

- Sentry Logs, Session Replay, tracing, profiling, user feedback, and OpenTelemetry
- Vercel Log Drains
- Sentry monitoring for Supabase Edge Functions
- LogRocket
- Datadog
- New Relic
- formal uptime monitor
- on-call alerting policy

Sentry is detection and triage only; it does not change authorization, RLS, recovery, or availability guarantees. Retention, alert ownership, and a formal uptime monitor remain operational follow-up work.

## CI/CD Status

Current automated validation:

- `.github/workflows/validation.yml` runs on pull requests and pushes to `main`
- the workflow runs `npm ci`, migration filename checks, JS lint, CSS variable checks, CSS class checks, and production build
- the workflow uses non-secret Vite placeholder Supabase values for compile-time build checks
- the workflow does not receive production Supabase secrets
- the workflow does not run `npx supabase db push`
- the workflow does not run live Supabase mutation tests

Current manual/protected deployment discipline:

- run migration checks before schema work
- run finance regression locally or in a protected environment before production releases
- deploy with Vercel CLI when validation passes
- do not claim a live migration unless `npx supabase db push` succeeded in the same session

Still missing:

- protected branch settings requiring the validation workflow
- secret-scoped isolated finance regression environment
- automated remote migration-drift check
- required deployment approvals for production environments

## Scaling And Load-Balancing Status

StockWise currently uses platform-managed scaling:

- Vercel for static assets and frontend delivery
- Supabase for database, Auth, Realtime, storage, and Edge Functions
- no custom load balancer in the repo

Likely bottleneck candidates:

- dashboard aggregation and recent activity panels
- stock levels and movements registers
- items search/filter/sort at larger catalogue sizes
- finance document list/detail pages
- Platform Control company listing and analytics
- exports and PDF generation
- report screens that join stock, finance, and settlement state
- Edge Function email bursts

Recommended review cadence:

- Supabase database advisors after schema changes
- query plan/index review for the pages above before large-customer onboarding
- bundle/chunk review after large UI dependency additions
- Edge Function log review after email/worker releases

## Caching And CDN Position

- Static built assets under `/assets/*` are immutable and CDN-cacheable.
- App routes are `no-store`.
- Business data must stay fresh through authenticated Supabase queries.
- Dashboard, stock, finance, settlement, and Platform Control data should not be cached aggressively without an explicit invalidation model.
- Landing page images/assets can be optimized and cached, but authenticated app data should remain session-bound.

## Recommended Next Hardening Priorities

1. Require the non-mutating validation workflow as a protected branch check.
2. Decide whether the validated manual isolated finance workflow should become a protected merge or scheduled gate; the first ephemeral run passed `288/288` without hosted credentials on 2026-07-15.
3. Run Supabase advisor and source review focused on RLS, security-definer functions, exposed views, and missing indexes for high-traffic pages.
4. Assign Sentry alert ownership and retention after the validated 2026-07-15 production error-path smoke; uptime monitoring remains separate.
5. Run and record a monthly recovery drill using `docs/AVAILABILITY_AND_RECOVERY.md`.
6. Review rate limits for invite mutation, Platform Control mutation, POS posting, invoice issuing, settlement posting, and heavy exports.
7. Review Tauri desktop/Android release security: CSP, filesystem capabilities, code signing, updater, Android signing, and secret handling.
8. Add targeted browser E2E checks for auth confirmation, password recovery, resend confirmation, blocked company access, and Platform Control denial.

## Baseline Change Rules

- Do not weaken RLS to fix frontend friction.
- Do not move posting authority into the frontend.
- Do not add a second auth or organisation system.
- Do not commit raw secrets, generated `*_remote_schema.sql` artifacts, or unreviewed schema pulls.
- Do not install heavy monitoring or rate-limiting systems without an approved operational owner.
- Keep this document current when release state, enforcement layer, or operational assumptions change.

## Payment activation security boundary (live)

New request, event, counter, channel, and channel-event tables use RLS and FORCE RLS. Normal clients receive SELECT only; OWNER/ADMIN mutations and all review transitions are RPC-only. `PUBLIC` and `anon` cannot execute public mutation RPCs, internal helpers are not client-executable, SECURITY DEFINER functions use restricted search paths, and proof objects remain private with 5 MiB JPEG/PNG/PDF limits. Platform approval requires locked request/subscription rows and `posting_requests` idempotency before reusing the established entitlement mutation/audit path.

These controls were re-verified in the hosted catalog after migration 41. Controlled production smoke used no real destination credentials, left one private synthetic proof object for audit, deactivated its QA channel, and produced no cash, bank, stock, invoice, vendor-bill, Growth Batch, Production Run, or item-price mutation.

## Commercial tax security boundary (live)

The three tax configuration tables use RLS and FORCE RLS. Authenticated company members receive scoped SELECT only; ADMIN+ configuration changes are RPC-only and audited. `PUBLIC` and `anon` cannot execute tax or item-profile mutation RPCs, and normal clients cannot execute internal validators, rollups, snapshot triggers, or total calculators. Every new `SECURITY DEFINER` function has a restricted `pg_catalog, public` search path.

The database, not the client, chooses configured option snapshots, rounds line tax, derives header totals, blocks inactive/cross-company options, enforces exemption reasons, and locks line totals and tax snapshots after confirmation/approval. Canonical PO conversion cannot enter the legacy proportional allocator. Configuration updates lock defaults/options consistently so an inactive option cannot become or remain a default through a race. Hosted verification confirmed RLS/FORCE RLS, company-scoped SELECT, mutation-RPC authority, `PUBLIC`/`anon` denial, internal-helper denial, and restricted search paths through migration 44.
# POS tax-mode authority (live, 2026-07-16)

`set_company_pos_tax_mode(...)` requires authentication, active company context, and OWNER/ADMIN membership. `PUBLIC` and `anon` have no execute privilege. `commercial_tax_resolve_pos_context(...)` and the non-fiscal invoice trigger helper are not executable by client roles. All new security-definer functions use restricted search paths. `company_tax_settings` and `company_tax_configuration_events` retain RLS and FORCE RLS; authenticated direct settings and audit-event mutation remains denied.

The mode and line evidence are database-stamped. Ordinary clients cannot mark an ordinary Sales Order non-fiscal or edit a historical POS mode snapshot. This package changes no membership, subscription, payment-activation, stock, Production Run, Growth Batch, or platform-admin authority.

Hosted catalog verification after migration 45 confirmed RLS and FORCE RLS on tax settings, configuration events, Sales Orders, and Sales Order lines; authenticated SELECT-only table access; authenticated-only public RPC execution; `PUBLIC`/`anon` denial; internal-helper denial; restricted security-definer search paths; and the active non-fiscal invoice guard trigger. No production privilege-negative mutation test was run.
