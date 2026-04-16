# Subscription and Access Control

This document records the current access-control foundation that governs trials, manual paid activation, tenant restriction, and later payment automation.

## Scope

Implemented in foundation scope:

- public MZN pricing on the landing page
- 7-day trial bootstrap for a new tenant
- backend entitlement checks for active company access
- blocked-access route for expired, suspended, or disabled tenants
- platform-admin control plane for manual grant, revoke, suspension, expiry, and purge scheduling
- auditability of access changes
- purge scheduling for trial operational data
- public bootstrap rate limiting

Explicitly deferred:

- automatic payment collection
- webhook-driven plan activation
- self-serve paid checkout
- automatic purge execution

## Data Model

Current core tables and types:

- `public.subscription_status`
  - `trial`
  - `active_paid`
  - `expired`
  - `suspended`
  - `disabled`
- `public.plan_catalog`
- `public.platform_admins`
- `public.company_subscription_state`
- `public.company_access_audit_log`
- `public.company_purge_queue`

Important fields in `public.company_subscription_state`:

- `plan_code`
- `subscription_status`
- `trial_started_at`
- `trial_expires_at`
- `paid_until`
- `access_granted_at`
- `access_granted_by`
- `grant_reason`
- `revoke_reason`
- `purge_scheduled_at`

## Effective Access Model

Access is not controlled by authentication alone.

- authentication proves who the user is
- company membership proves which tenant the user belongs to
- company entitlement state determines whether the tenant may be used

Current enforcement uses DB helpers first and UI second:

- `company_access_effective_status(uuid)`
- `company_access_is_enabled(uuid)`
- `member_has_company_access(uuid, boolean)`
- `get_my_company_access_state(uuid)`

The app route guard mirrors this state, but the backend helpers remain the real authority.

## Trial Lifecycle

Current trial rule:

- creating the first company through `create_company_and_bootstrap(text)` starts a 7-day trial
- the same flow is rate-limited to prevent repeated bootstrap abuse
- the same user gets the same active trial company back on repeated valid calls during the rate-limit window

Trial expiry behavior:

- user credentials remain intact
- company operational access is blocked
- operational tenant data can be scheduled for purge
- purge scheduling is auditable

## Purge Scope

Current design is explicit:

- retained:
  - auth credentials
  - auth user identity
  - platform-admin identity
  - access audit trail
- purge target:
  - operational company data
  - company-scoped business documents and master data

The queue design currently schedules purge intent through `public.company_purge_queue`.

Automatic destructive purge execution is intentionally deferred. This phase only implements:

- status model
- schedule model
- target-scope design
- queue row creation/sync
- audit visibility

## Manual Paid Activation

Paid activation is intentionally manual in the current commercial model.

- pricing is public
- entitlements are managed internally by platform admins
- `platform_admin_set_company_access(...)` is the intended control-plane path
- raw DB edits are not the intended operating model

This keeps commercial rollout controlled while leaving the data model ready for later payment automation.

## Platform Admin Access

Platform control is permission-based. There is no fake admin toggle in the app.

- route: `/platform-control`
- visibility: only active platform admins see the Platform section in navigation
- non-admin behavior: the route stays blocked and normal company users do not see admin UI

The intended first-admin path is:

1. sign in with the target user account
2. from the repo root, run:

```bash
npm run bootstrap:platform-admin -- admin@company.com --note "Initial platform admin"
```

Requirements for the bootstrap command:

- `VITE_SUPABASE_URL` or `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SERVICE_ROLE_KEY`

The command upserts the row into `public.platform_admins`. After sign-in refresh, the user can open `/platform-control` directly or use the Platform navigation entry.

## Abuse Protection

Implemented first layer:

- public company bootstrap rate limiting in `create_company_and_bootstrap(text)`
- platform-admin-only access to entitlement mutation paths
- existing finance-document duplicate/state guards remain the main repeated-click protection for issue/post/settlement-sensitive actions

## Future Layering

Later payment automation can attach to this control plane without redesigning tenant access:

- payment provider creates or updates a subscription record
- webhook or internal worker calls the same entitlement mutation path
- access state changes remain auditable in `company_access_audit_log`

That future layer should reuse the current plan catalog and entitlement state instead of replacing them.
