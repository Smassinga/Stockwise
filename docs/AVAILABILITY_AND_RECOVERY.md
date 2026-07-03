# StockWise Availability and Recovery Runbook

Status: 2026-07-02.

This runbook defines the current recovery posture for early commercial rollout. It is not a guarantee of service level and does not prove that a restore drill has been completed. Use it to drive incident response, monthly recovery tests, and future hardening work.

## Operating Assumptions

- The web frontend is deployed on Vercel.
- Database, Auth, storage, Realtime, and Edge Functions run on Supabase.
- Supabase Auth transactional email uses Brevo SMTP.
- Edge Function mailers also require Brevo SMTP secrets plus service-role access where applicable.
- Tauri desktop and Android builds package the same frontend, but are direct-distribution builds and do not currently have a committed updater or code-signing path.
- Hosted production remains aligned through `20260630170735_add_growth_batch_transfer_posting.sql` with 34 active migrations after the controlled Growth Batches G4.2 rollout. The local repository now has a 36-migration Growth Batches G5.1 package through `20260702205834_add_growth_batch_harvest_posting.sql`; G5.1 depleting harvest and event-specific harvest reversal are local-only and are not hosted/live.

## Backup Assumptions

These assumptions must be verified in the Supabase dashboard before treating them as an SLA:

- Supabase database backups and point-in-time recovery depend on the active Supabase project plan and configured retention.
- The current documented production backup posture remains scheduled daily physical database backups available and PITR not enabled. No new restore drill was performed during the 2026-06-28 Growth Batches G4.1 rollout.
- G5.1 adds local-only append-only harvest receipt/reversal issue behavior. It must not be treated as recoverable production functionality until a future authorised hosted rollout applies the two G5.1 migrations and records a new production smoke.
- No formal restore drill has yet been completed.
- Supabase Auth user recovery is tied to the same project recovery posture and Auth logs/configuration.
- Supabase Storage recovery depends on project backup support and any separate object backup/export process the operator maintains.
- Vercel deployment rollback remains available through previous immutable deployments.
- Edge Functions are source-controlled and can be redeployed from this repo once secrets are present.
- Supabase Auth email templates and settings are not fully represented as code; keep reviewed exports/backups of templates after material edits.

## Draft RTO/RPO Targets

These are suggested early-rollout targets, not contractual SLAs:

| Incident class | Examples | Target RTO | Target RPO |
| --- | --- | --- | --- |
| P0 | Auth outage, data corruption, finance posting outage, production app unavailable | 4 hours | 24 hours unless Supabase PITR confirms a tighter point |
| P1 | Core workflow degraded, Edge mailer failure, tenant access control issue | 1 business day | 24 hours |
| P2 | Non-critical UI issue, single email template issue, isolated browser rendering issue | 2 business days | No data loss expected |

Tighten these targets only after a successful restore drill and confirmed Supabase backup retention.

## General Incident Checklist

1. Assign an incident owner.
2. Record start time, affected tenant(s), affected workflow, and first observed symptom.
3. Freeze unrelated deploys and schema changes until the impact is understood.
4. Preserve Vercel logs, Supabase DB/Auth/Edge logs, browser console output, and relevant screenshots.
5. Classify the incident as frontend deploy, database/schema, Auth/email, Edge Function, storage, or operator/data issue.
6. Choose the smallest recovery action that addresses the cause.
7. Validate in staging or preview when possible before touching production.
8. Run the relevant smoke checks and finance regression when finance, inventory, access, or workflow behavior could be affected.
9. Document the action taken, what failed, what changed live, and what remains manual.

## Restore Checklist

Use this checklist before any production restore:

1. Confirm whether the issue is reversible without restore.
2. Identify the required restore point and affected data scope.
3. Confirm current migration history with `npx supabase migration list`.
4. Do not run `npx supabase db push` while investigating a restore unless an intentional migration has been reviewed.
5. If using Supabase restore/PITR, restore to a safe target first when the platform plan allows.
6. Compare restored schema, policies, functions, and critical tables against the expected migration chain.
7. Verify Auth sign-in, signup confirmation, password recovery, active company routing, and Platform Control restriction.
8. Run `npm run test:finance-regression` if finance, stock, settlement, entitlement, or access data could be impacted.
9. Validate affected tenant workflows manually.
10. Record residual risk and follow-up cleanup.

## Vercel Rollback Checklist

1. Identify the last known good deployment.
2. Confirm it uses compatible Supabase schema and environment variables.
3. Roll back or promote the previous deployment in Vercel.
4. Verify custom domain routing for `https://stockwiseapp.com`.
5. Smoke-test `/`, `/login`, `/auth/callback`, `/update-password`, `/onboarding`, `/dashboard`, and `/platform-control` denial for a normal user.
6. Check browser console and Vercel logs.
7. If rollback fixed the incident, keep database state unchanged unless a separate schema/data incident exists.

## Supabase Recovery Checklist

1. Confirm project health and backup/PITR availability in Supabase.
2. Capture current migration list and recent migration files.
3. Capture Supabase DB, Auth, Edge, and storage logs relevant to the incident.
4. Decide between targeted data repair, backup restore, PITR, or no restore.
5. Validate RLS remains enabled on protected tables after any restore.
6. Validate critical RPCs and triggers exist, especially company bootstrap, access-state helpers, POS issue, finance issue/post, settlement guards, and Platform Control RPCs.
7. Validate storage buckets and policies for `bank-statements` and `brand-logos`.
8. Run migration and app validation commands before any new release.
9. Run targeted user-flow checks for affected tenants.

## Storage Recovery Checklist

1. Identify bucket, object path, company id, and user who reported the issue.
2. Determine whether the object is public brand media or private bank-statement data.
3. Confirm bucket policies before restoring or re-uploading.
4. Restore from Supabase backup, operator-maintained backup, or user-provided source as appropriate.
5. Verify the restored object is visible only to the intended company/role.
6. Record the recovery source and any remaining files that could not be recovered.

## Edge Function Redeploy Checklist

Before redeploying an Edge Function:

1. Confirm the exact function and reason for redeploy.
2. Verify required secrets:
   - Brevo SMTP secrets for mailer flows
   - `SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` for service-role flows
   - `REMINDER_HOOK_SECRET` for `due-reminder-worker`
   - internal HMAC secrets for AI/schema snapshot functions
3. Confirm whether the function expects Supabase JWT, HMAC, bearer token, hook secret, or another gate.
4. Deploy only the intended function.
5. Check Edge Function logs after invocation.
6. For mailers, send a controlled test and verify Brevo accepted delivery.
7. For workers, verify no duplicate or stale backlog is processed unexpectedly.

## Auth And Email Incident Checklist

For confirmation, resend, invite, change-email, or reset-password issues:

1. Confirm Supabase Auth Site URL is `https://stockwiseapp.com`.
2. Confirm redirect allow-list includes `https://stockwiseapp.com/auth/callback`.
3. Confirm email confirmation remains enabled for production.
4. Confirm Brevo SMTP settings are present and approved.
5. Confirm the affected template preserves required Supabase variables, especially confirmation/recovery URL variables.
6. Send to controlled inboxes.
7. Check Brevo delivery status, recipient inbox, and provider spam/quarantine folders when available.
8. Confirm confirm-signup and resend reach `/auth/callback` and route by company membership.
9. Confirm reset-password reaches `/update-password`, not onboarding/dashboard directly.
10. Do not change company membership, entitlement, RLS, Platform Control, finance, inventory, POS, invoice, settlement, or valuation logic to fix an email incident.

## Platform-Admin Emergency Checklist

Use platform-admin emergency access only when production support requires it.

1. Verify the requestor and reason outside the app.
2. Prefer an existing active platform admin.
3. If a first or replacement platform admin is required, use the maintained bootstrap path:

```bash
npm run bootstrap:platform-admin -- admin@example.com --note "Emergency access reason"
```

4. Verify required service-role environment variables are present.
5. Sign in as the intended user and verify `/platform-control` access.
6. Record the reason and time.
7. Remove temporary platform-admin access when no longer needed.
8. Never grant Platform Control by editing company roles.

## Monthly Recovery Test Checklist

Run monthly or before larger commercial rollout:

1. Confirm `npx supabase migration list` is aligned.
2. Confirm no `*_remote_schema.sql` artifact is pending.
3. Verify Supabase backup/PITR retention and record the date checked.
4. Rehearse Vercel rollback to a known prior deployment or preview target.
5. Verify Auth confirmation, resend confirmation, and reset-password recovery with controlled inboxes.
6. Verify Edge Function secret inventory without printing secret values.
7. Redeploy or dry-run one low-risk Edge Function in a non-production target when available.
8. Validate storage access for one private bank-statement object and one brand-logo object.
9. Run:

```bash
npm run check:migrations
npm run lint:js
npm run check:css-vars
npm run check:css-classes
npm run build
npm run test:finance-regression
```

10. Record results in `docs/TESTING.md` or the release notes if the drill changes current truth.

## Communications And Evidence Log

During a production incident, record:

- who owned the incident
- exact production URL or Supabase project affected
- first bad deployment or timestamp
- commands run
- whether any migration, restore, or deploy changed live state
- validation results
- temporary users/tenants created for QA
- cleanup result
- residual risk

Do not expose secrets in logs, screenshots, commits, or issue reports.
