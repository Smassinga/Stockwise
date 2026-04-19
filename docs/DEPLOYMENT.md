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

## Supabase and Email Release Requirements

StockWise depends on Supabase for:

- authentication and company membership
- entitlement and trial enforcement
- finance posting, settlements, reconciliation, and imports
- outbound company-access email sending

Edge-function mail flows require the configured Brevo SMTP secrets. Verify required secrets before deploying or testing an email function.

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
