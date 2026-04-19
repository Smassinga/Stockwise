# StockWise Monitoring and Operational Signals

This document records the monitoring sources that actually matter for StockWise today.

## Current Signal Sources

### Web and frontend

- Vercel deployment/build logs
- browser console and runtime error checks during smoke validation
- `npm run build` for production bundle integrity

### Database and backend control

- Supabase database logs
- Supabase auth logs
- Supabase Edge Function logs for company-access mailers and reminder workers
- `npx supabase db pull` replay validation when schema work is involved

### Workflow integrity

- `npm run test:finance-regression`
- targeted browser validation for Point of Sale, Platform Control, onboarding import, and finance-document workflows when those areas change

## What Is Not Part of the Current Baseline

These are not committed as current production dependencies:

- Sentry
- LogRocket
- Datadog
- New Relic

If any of those are added later, this document should be updated only after the integration is real.

## What to Check by Area

### Finance and inventory

- finance regression suite result
- Supabase DB/RPC errors
- settlement, bank, cash, and reconciliation read-model continuity

### Platform Control and access emails

- Supabase Edge Function logs
- company access audit tables
- company control action log

### Web release quality

- Vercel build result
- local `npm run build`
- smoke validation on key routes

### Tauri packaging

- `npm run tauri:prepare`
- desktop build or Android Gradle output when packaging is the target
- current branding/version metadata in Tauri config and Android resources

## Release-Time Minimum Monitoring Discipline

Before calling a change release-ready:

1. run `npm run lint:js`
2. run `npm run build`
3. run `npm run test:finance-regression` for finance, control-plane, or workflow changes
4. validate the relevant user flow in browser or packaged shell as appropriate
5. check Supabase logs if the change touched RPCs, policies, or Edge Functions

## Current Gap

StockWise has operational logging and regression coverage, but it does not yet have a dedicated third-party observability stack committed in-repo. That is acceptable as long as release validation stays disciplined and the existing Supabase/Vercel signals are actually reviewed.
