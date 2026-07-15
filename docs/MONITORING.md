# StockWise Monitoring and Operational Signals

This document records the monitoring sources that actually matter for StockWise today.

## Current Signal Sources

### Web and frontend

- Sentry (`wisecore-technologies/stockwise-web`) for production frontend error events after production environment enablement
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

## Excluded Observability Products

The first controlled Sentry package is error monitoring only. The following remain disabled and unconfigured:

- Sentry Logs, Session Replay, tracing, profiling, user feedback, and OpenTelemetry
- Vercel Log Drains
- Supabase Edge Function monitoring through Sentry

Supabase database/Auth/Edge logs and Vercel build/runtime logs remain separate signal sources. Sentry does not replace backups, point-in-time recovery, restore validation, or recovery drills.

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

## Current Position

The repository contains a production-only Sentry frontend integration. It remains disabled unless the production build and browser environment contracts are explicitly configured. A production event is not considered validated until a controlled post-deployment smoke confirms ingestion and readable source-mapped frames.

See [SECURITY_AND_SCALE_BASELINE.md](SECURITY_AND_SCALE_BASELINE.md) for the current monitoring, rate-limiting, CI/CD, and scaling gap list. See [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md) for incident, rollback, restore, and monthly recovery-test checklists.

## Payment activation signals (live package)

Monitor submitted/under-review/needs-correction queue age, approval failures, provider-reference uniqueness conflicts, proof authorization rate limits, missing proof objects, and access-audit/request-event reconciliation. The rollout baseline ended with no stuck workflow posting requests and no approved request missing its access audit. Do not treat catalogue recurring value or submitted evidence as collected revenue. Provider webhook and automatic reconciliation observability remain future scope.
