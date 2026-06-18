# StockWise Security and Scale Baseline

Status: 2026-06-14.

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

- The local and hosted migration chains are aligned through `20260614123300`.
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
- Company bootstrap has backend rate limiting; assembly posting, normal web POS posting, PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, and adjustment have backend idempotency through `posting_requests`; shared stock rollups use atomic negative-delta guards and receipt upserts. A2.4a.1 is live in hosted Supabase as of 2026-06-14: normal web POS uses `post_operator_sale` with operation type `operator.sale`, the production smoke passed, `authenticated` can execute the wrapper, and `anon` cannot execute it. The legacy POS RPCs remain a temporary compatibility bypass until A2.4a.2 reviews stale Tauri clients and closes normal authenticated legacy execution. The consolidated A2.4/A2.5 package is live as of 2026-06-14 through `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, and `stock.adjustment`; representative production smokes passed for PO receipt, sales shipment, transfer, and positive adjustment.
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
| Production Runs | No | New company-scoped Production Run read policies; mutation is RPC-only | draft/post/reverse RPCs | No | No | Request-key idempotency, OPERATOR+ post authority, MANAGER+ reversal authority, stock trigger guards, base-UOM-only enforcement | Implemented locally only. Authenticated clients can read permitted rows but cannot directly mutate Production Run business tables. `post_production_run` uses `production.run.post`; `reverse_production_run` uses `production.run.reverse`. Posting and reversal write append-only `stock_movements`, never direct `stock_levels`, and never update `items.unit_price`. |
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

- Vercel build and deployment logs
- Vercel runtime logs
- Supabase database logs
- Supabase Auth logs
- Supabase Edge Function logs
- browser console checks during smoke QA
- finance regression output

Not currently committed:

- Sentry
- LogRocket
- Datadog
- New Relic
- formal uptime monitor
- on-call alerting policy

Recommendation: choose one lightweight error/uptime monitoring path only after approval, then document the exact events, retention, and owner. Do not add multiple overlapping observability tools.

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
2. Add finance regression to CI only after a dedicated non-production Supabase project and guarded GitHub Actions environment exist.
3. Run Supabase advisor and source review focused on RLS, security-definer functions, exposed views, and missing indexes for high-traffic pages.
4. Add one approved monitoring/alerting layer for production errors and uptime, with owner, retention, and escalation rules.
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
