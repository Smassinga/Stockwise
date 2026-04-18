# Platform Admin Runbook

This runbook explains how platform-admin access is granted and how the manual access-control plane is reached.

## Route

- Platform control route: `/platform-control`

Only active platform admins can use it.

## How Platform Admin Access Works

Admin access is permission-based.

- normal users do not see platform-admin navigation
- direct navigation to `/platform-control` is blocked for non-admins
- active platform admins see a dedicated Platform section in navigation and can open the route directly

There is no UI toggle for "admin mode".

## Bootstrap The First Platform Admin

Sign in with the target account first. Then, from the repo root, run:

```bash
npm run bootstrap:platform-admin -- admin@company.com --note "Initial platform admin"
```

Environment requirements:

- `VITE_SUPABASE_URL` or `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SERVICE_ROLE_KEY`

What the command does:

- looks up the auth user by email
- upserts an active row into `public.platform_admins`
- stores the optional note for audit and runbook context

## What Platform Admins Can Do Today

- open `/platform-control`
- use the top-level summary counters to review trial, active paid, expired, suspended, and disabled companies separately
- review company subscription/access state
- review company shell metadata, created date, registered company email, owner, member counts, and latest recorded sign-in activity
- manually grant, extend, suspend, expire, or disable tenant access
- set purge scheduling metadata for expired trial tenants
- preview and send expiry warning, purge warning, and paid activation confirmation emails
- review the access audit log
- review the separate control-action log for resets and outbound company-access emails
- trigger a guarded operational data reset for non-active-paid tenants
- return to the rest of the app using the in-page `Back to dashboard` path

## Owner And Sign-In Metadata

Platform Control now resolves company ownership in this order:

1. `companies.owner_user_id`
2. earliest active `OWNER` membership
3. earliest active `ADMIN` membership

Displayed sign-in activity uses the best available value from `public.profiles.last_sign_in_at`:

- owner last sign-in = selected owner profile, when present
- latest recorded sign-in = most recent active member sign-in, when present

If no profile activity exists, the UI shows that it was not captured instead of inventing a value.

## Company Recipient Rule For Outbound Access Emails

Platform Control now resolves the canonical outbound company recipient in this order:

1. `companies.email`
2. resolved owner email
3. active `ADMIN` email fallback

If none of these are present, preview/send is blocked with an explicit operator message.

This recipient rule is for outbound company notices only.

## Support Inbox Routing

Inbound support and activation requests now route to:

- `support@stockwiseapp.com`

This applies to public pricing/contact CTAs and the blocked-access `Request activation` path.

Outbound company emails do not send to that inbox. They send to the canonical company recipient and include `support@stockwiseapp.com` as the StockWise contact/reply-to target.

## Company Access Emails

Platform Control now supports manual preview/send for:

- expiry warning
- purge warning
- paid activation confirmation

Operating rules:

- these emails are manual admin-triggered actions
- they are not sent automatically when status changes
- Platform Control uses stored access dates and plan state, not unsaved form edits
- successful sends are audited in `company_control_action_log`

See [Company Access Email Operations](company-access-email-operations.md) for the detailed recipient, template, and audit rules.

## Guarded Operational Reset

Platform Control now includes `Reset company data`, but it is intentionally guarded.

Safeguards:

- platform-admin only
- confirmation must match the exact company UUID
- a written reason is required
- the action is rate-limited
- reset is blocked while the company is `active_paid`
- every reset writes to the control-plane action log

Current reset removes operational company data such as:

- sales and purchase documents
- finance adjustments, settlements, bank transactions, and cash transactions
- items, BOM data, builds, stock levels, and stock movements
- customers, suppliers, warehouses, bins, and company-scoped operational reminders/notifications

Current reset preserves:

- company shell
- company memberships
- auth credentials
- subscription/access state
- access audit history
- company settings
- payment terms, currencies, fiscal settings, fiscal series, and numbering counters

This is an operational reset, not an identity delete.

## Commercial Posture

Current model:

- pricing is public in MZN
- 7-day trial is real
- paid activation is manual
- payment checkout is intentionally deferred

Future payment automation should reuse the existing control plane rather than bypass it.
