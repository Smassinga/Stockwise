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
- review company subscription/access state
- manually grant, extend, suspend, expire, or disable tenant access
- set purge scheduling metadata for expired trial tenants
- review the access audit log

## Commercial Posture

Current model:

- pricing is public in MZN
- 7-day trial is real
- paid activation is manual
- payment checkout is intentionally deferred

Future payment automation should reuse the existing control plane rather than bypass it.
