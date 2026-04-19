# StockWise Testing Strategy

This document records the current testing baseline that actually exists in the repo.

## Current Status

Implemented today:

- lint and build checks for every material code change
- a real finance regression suite driven by the Node test runner and live Supabase clients

Not yet implemented as first-class repo tooling:

- dedicated Jest unit-test suite
- dedicated Cypress or Playwright browser E2E suite
- CI isolation for every finance mutation scenario

## Primary Regression Command

Run the finance regression suite with:

```bash
npm run test:finance-regression
```

The suite currently runs through:

- real auth users created for the run
- temporary company-scoped finance and inventory data
- backend RPCs, RLS, triggers, and state views
- cleanup at the end of the run

This is not a decorative page-load smoke suite. It mutates real test data against the connected Supabase project and then removes it.

## Finance Flows Covered

Current protected workflows:

1. Sales Order -> Sales Invoice draft -> approval -> issue readiness -> issue
2. Purchase Order -> Vendor Bill draft -> approval -> post
3. Settlements, including:
   - bank receive
   - bank pay
   - cash posting
   - settlement anchoring
4. AR and AP bridge / reconciliation calculations
5. item and UOM dependencies that affect inventory and finance correctness
6. BOM / assembly gating and successful build posting
7. access-control lifecycle:
   - 7-day trial bootstrap
   - expiry restriction
   - reactivation
   - purge scheduling
8. public abuse protection on repeated company bootstrap

## What The Suite Asserts

The suite currently protects:

- finance posting continuity
- document state transitions
- approval and authority gates
- document relationship integrity
- settlement anchor continuity
- bank and cash posting continuity
- current-legal-value bridge math
- item / UOM integrity assumptions used by inventory and finance paths
- assembly build gating under sufficient and insufficient stock
- trial and entitlement enforcement

## Test Architecture

Current implementation lives in:

- `tests/finance-regression/helpers.mjs`
- `tests/finance-regression/finance-regression.test.mjs`

The suite uses:

- `node --test`
- `@supabase/supabase-js`
- temporary auth users
- company-scoped setup and cleanup

Important design rules:

- prefer meaningful state assertions over shallow render checks
- cover both success and blocked paths
- validate the same DB and RLS paths production uses
- keep cleanup explicit so repeated runs do not drift

## Validation Steps For Product Changes

After code changes that can affect runtime behavior:

1. `npm run lint:js`
2. `npm run build`
3. `npm run test:finance-regression`

For DB work:

1. inspect pending migrations
2. attempt `npx supabase db pull` when remote state may have changed
3. apply migrations with `npx supabase db push`
4. rerun lint, build, and the finance regression suite

## Known Limits

Current gaps that remain future scope:

- CI wiring for the finance regression suite
- broader isolated environment strategy beyond the current temp-data cleanup model
- long-tail browser interaction coverage outside the finance-critical mutation suite
- dedicated lower-level unit testing for shared helpers

## Recommended Next Testing Layer

The next practical expansion is not another vanity smoke layer.

Recommended next steps:

- wire the finance regression suite into CI with guarded environment rules
- add smaller targeted unit tests around shared helper math and access-state formatting
- add browser-level route verification only for high-value public/commercial and blocked-access flows
