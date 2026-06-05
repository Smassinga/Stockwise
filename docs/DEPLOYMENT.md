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

If database changes are included:

```bash
npx supabase db pull
npm run check:migrations
npx supabase db push
```

Only report a live schema change if `npx supabase db push` succeeded in the same session.

## Current Production Release Notes

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
2. run `npm run lint:js`
3. run `npm run build`
4. run `npm run test:finance-regression`
5. run `npm run tauri:prepare` if desktop or Android packaging metadata matters for this release
6. verify branding, Point of Sale naming, and Android-first navigation assumptions on the current UI
7. if DB code changed, validate the canonical migration workflow before shipping

## What This Document Does Not Cover

This document does not try to be:

- a generic Supabase tutorial
- a payment-gateway runbook
- a historical release log

If a release topic is not current and specific to StockWise, it should live elsewhere or not be tracked.
