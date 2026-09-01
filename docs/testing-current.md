# StockWise Current Testing Contract

This document is the maintained source of truth for the current automated testing and release gates. `TESTING.md` retains historical release evidence and older package snapshots; where an older statement conflicts with this document or the checked-in workflow definitions, this document and the workflows take precedence.

## Current schema baseline

As of 2026-08-26, the maintained repository and hosted production are aligned at 72 migrations through `20260826085721_ensure_companies_owner_user_id_index.sql`.

Migration truth in CI is derived from `supabase/migrations`. Do not hard-code an older migration count into release checks.

## Primary Validation

`.github/workflows/validation.yml` runs for pull requests and pushes to `main` with `contents: read` only.

It performs:

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npm run check:migrations`
4. `npm run lint:js`
5. `npm run typecheck`
6. `npm run check:css-vars`
7. `npm run check:css-classes`
8. `npm run check:ui-foundations`
9. runtime-hardening regression tests
10. Dashboard regression tests
11. Service Job contract regression tests
12. the production bundle build

The npm audit gate blocks high and critical dependency vulnerabilities. A passing gate does not imply that lower-severity advisories cannot exist; inspect the audit output when release evidence requires the full severity breakdown.

Primary Validation is non-mutating. It receives no production Supabase service-role credential and does not push migrations.

Permanent finance/UI continuity assertions that originated in the August 2026 post-QA repair package now live at `tests/runtime-hardening/finance-ui-continuity.test.mjs`. They therefore execute on every Primary Validation run instead of remaining behind the historical opt-in `test:post-qa-repairs` script. The assertions themselves remain unchanged; only their test-governance classification and execution path changed.

## Isolated Finance Regression

`.github/workflows/finance-regression-isolated.yml` runs on finance- or migration-sensitive pull requests and can also be dispatched manually.

The workflow:

- starts an ephemeral loopback Supabase stack with CLI `2.109.1`;
- rejects the StockWise production project and any `*.supabase.co` mutation target;
- derives migration count and latest version from the checked-out repository;
- asserts zero PUBLIC and anonymous SECURITY DEFINER execution, removal of the obsolete reset RPC, and closure of anonymous `stock_levels` reads;
- runs `npm run test:finance-regression:ci` serially;
- runs Dashboard and Service Job regression after Finance succeeds;
- retains sanitized failure-only diagnostics for three days;
- destroys the ephemeral stack whether the job passes or fails.

The permanent workflow is fail-fast. Diagnostic-era PR write permissions and `continue-on-error` control flow are not part of the maintained gate.

## Isolated Authenticated Browser Regression

`.github/workflows/browser-regression-isolated.yml` is the maintained Playwright browser gate for application-, migration-, package-, and E2E-sensitive pull requests, and it can also be dispatched manually.

It:

- starts a fresh local Supabase stack and rejects production/remote mutation targets;
- creates a temporary authenticated user and company fixture locally;
- installs the pinned Chromium runtime for `@playwright/test 1.62.1`;
- exercises Login -> Dashboard -> Items through the real browser UI;
- asserts the Dashboard scope and first-use state through accessible roles/names rather than implementation-only selectors;
- checks the 390 x 844 mobile viewport for horizontal overflow;
- fails on uncaught page errors;
- stores screenshot, trace, video, and report evidence only on failure;
- destroys the local stack after the run.

This browser gate does not use production credentials and does not create or change Leny QA data.

## Dependency and workbook security

The legacy SheetJS `xlsx` dependency is removed. Current workbook import/export paths use ExcelJS and the maintained CSV parser. Legacy `.xls` input is rejected with guidance to save as `.xlsx` or `.csv`.

`package.json` and `package-lock.json` must remain free of the removed `xlsx` dependency.

## Release evidence rule

A maintenance or product release is merge-ready only when the relevant final commit has reproducible green evidence. For the 2026-08-26 maintenance closeout, the release record must include:

- Primary Validation success, including the dependency audit step;
- Isolated Finance Regression success;
- Isolated Browser Regression success;
- hosted Supabase migration/security invariant verification;
- post-merge `main` Validation success;
- production deployment verification when the web application changed.

A scheduler-level GitHub Actions `startup_failure` with no job execution is infrastructure evidence, not a passing or failing product test. It must be accompanied by a successful real execution for the same commit before release.

## Not proven by these gates

The current automated suite does not by itself prove:

- WCAG 2.2 AA conformance;
- complete screen-reader usability;
- disaster-recovery RPO/RTO targets;
- production behavior of scenarios intentionally kept local, such as destructive, contention, and broad finance mutation tests;
- platform settings such as leaked-password protection or the hosted Postgres patch level.

Those items require their own evidence and must not be inferred from a green CI badge.
