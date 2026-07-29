# StockWise Development Guide

This guide records the current repository workflow after the canonical Supabase baseline reset.

## Current migration baseline

UX-9C advances the maintained schema baseline to 46 migrations through `20260729143000_add_owner_dashboard_read_model.sql`. `npm run check:migrations` must report 46 active migrations, and the isolated finance workflow guard must use the same count and latest version.

## Authenticated Page Rhythm

Use `app-main-content` in the authenticated shell for first-content clearance and the safe-area relationship. Use one `.app-page` root for page width and sibling rhythm. Do not add `mt-*` or page-root padding to repair a shell-spacing problem; verify `16px` phone, `20px` tablet, and `24px` desktop clearance at the shell boundary first.

## Core Commands

```bash
npm install
npm run dev
npm run lint:js
npm run build
npm run test:finance-regression
```

`npm run dev` is maintained on `http://localhost:3000` through `vite.config.ts`; Tauri `devUrl` is aligned to the same port. Local Supabase development uses `http://127.0.0.1:54321`.

`npm run test:finance-regression` is the canonical protected mutation gate. It runs test files serially because the finance, onboarding, and Growth Batch regression files share one local Supabase database and each performs broad temporary setup/cleanup. Keep real concurrency assertions inside the purpose-built tests; do not make operators remember a separate serial override for release validation.

## Supabase Workflow

### Current rule

The active migration history is the canonical baseline plus forward migrations from this point onward.

Current release state: hosted production and local replay have 45 active migrations through `20260716130533_add_pos_tax_applicability_mode.sql`. The live settlement boundary normalizes exact two-decimal money values without epsilon, and the live commercial-tax boundary derives canonical headers and finance-state totals from line snapshots. Growth Batches G5.1 depleting harvest/event-specific harvest reversal and G5.2 completion/event-specific completion reversal remain live and production-smoke validated.

The latest Growth Batches G4.1 rollout applied:

- `20260627225400_add_growth_batch_losses.sql`
- `20260627225414_add_growth_batch_loss_posting.sql`

G4.1 validation passed before rollout: local replay reports 32 active migrations, Growth Batches regression `6/6`, complete finance regression `32/32`, independent inspection, authenticated visual QA at `1440`, `1200`, `820`, and `390` in light and dark mode, static checks, build, and GitHub Validation run `28319500331`. The hosted rollout ran in the authorised 2026-06-28 session with `npx supabase db push --linked` exit `0`; production mortality/shrinkage smoke passed through the maintained UI.

G4.1 adds OPERATOR+ mortality/shrinkage preview and recording, MANAGER+ event-specific loss reversal, immutable loss/reversal detail tables, loss read models, request-key idempotency, and `/growth-batches` UI coverage. It intentionally excludes transfers, harvest/split outputs, completion, stock output receipts, FIFO, COGS, fair value, automatic finance posting, dashboards, and per-animal/per-plant records. Production smoke used `Leny Doçuras` batch `LEN-GB000000003`, restored quantity `20 -> 18 -> 20 EA`, restored weight `40 -> 35 -> 40 KG`, kept stock movement and finance counts unchanged, kept Growth Batch costs at zero, kept negative stock and duplicate buckets at zero, and did not change `items.unit_price`.

G4.2 adds only governed full-batch operational location transfer and event-specific transfer reversal. It introduces `growth_batch_transfers`, `growth_batch_transfer_reversal_lines`, `growth_batch_transfer_history`, `preview_growth_batch_transfer`, `transfer_growth_batch`, and `reverse_growth_batch_transfer`, plus `/growth-batches` transfer UI and regression coverage. The package keeps transfers full-batch only: no partial split, child batch, harvest, completion, stock movement, stock-level change, cost write-off, finance posting, `items.unit_price` change, FIFO, COGS, fair value, profitability dashboard, or per-animal/per-plant identity. Local clean replay and targeted Growth Batch regression passed with 34 migrations before hosted rollout; production replay, mismatch, and concurrency mutation tests remain covered locally rather than in production.

G5.1 adds a live governed depleting harvest package. It introduces `growth_batch_harvests`, `growth_batch_harvest_reversal_lines`, `growth_batch_harvest_history`, `preview_growth_batch_harvest`, `post_growth_batch_harvest`, and `reverse_growth_batch_harvest`, plus `/growth-batches` Harvests UI and regression coverage. The package supports partial/full depleting harvest, one primary stock output receipt per harvest, proportional remaining-cost transfer into harvested cost, exact full-harvest remaining-cost transfer, and event-specific harvest reversal. It intentionally excludes non-depleting milk/egg yield, split/child batches, multi-output/co-product allocation, sales, invoices, COGS, FIFO, fair value, finance posting, automatic completion, whole-batch reversal, profitability dashboards, individual animal/plant records, and `items.unit_price` changes.

G5.2 adds a live governed completion package. It introduces `growth_batch_completions`, `growth_batch_completion_reversal_lines`, `growth_batch_completion_history`, `preview_growth_batch_completion`, `complete_growth_batch`, and `reverse_growth_batch_completion`, plus `/growth-batches` Completion UI and regression coverage. The package supports only lifecycle completion for active batches already at zero current quantity, zero current weight where weight exists, and zero remaining cost, plus event-specific completion reversal back to active. It intentionally creates no stock movements, no stock-level updates, no cost changes, no harvest output, no sale, no invoice, no COGS, no FIFO, no fair value, no finance posting, no whole-batch reversal, no split or child batch, no profitability dashboard, no individual animal/plant records, and no `items.unit_price` change. The 2026-07-09 UI smoke restored `LEN-GB000000003` from full harvest through `active -> completed -> active` and full-harvest reversal, retaining `20 EA`, `40 KG`, zero costs, no finance rows, no price change, and a zero QA output bucket.

Before changing the database:

1. run `npx supabase db pull` if the linked remote may have changed
2. inspect `supabase/migrations`
3. make only forward migrations
4. run `npm run check:migrations`
5. apply intentionally with `npx supabase db push`

### `db pull` artifacts

`npx supabase db pull` may generate a synthetic `*_remote_schema.sql` file after successful replay validation.

That file is:

- a review artifact
- not part of the canonical migration chain by default
- ignored by `.gitignore`

If a pull artifact is ever intentionally accepted, it must be reviewed as a real schema delta and force-added deliberately. Do not let it drift into commits casually.

### Storage and roles

- keep custom global roles in `supabase/roles.sql`
- do not recreate Supabase-managed `storage` internals in app migrations
- keep only app-owned buckets and policies in tracked migrations

## Repository Discipline

- use UTF-8 Portuguese strings and fix mojibake when found
- do not claim a live DB change unless `npx supabase db push` succeeded in the current session
- do not claim payment automation exists; activation remains manual
- do not use inventory cost as a selling-price default in Point of Sale flows

## Validation Expectations

After app changes:

```bash
npm run lint:js
npm run build
```

After finance, control-plane, or workflow changes:

```bash
npm run test:finance-regression
```

After database changes:

- verify `npx supabase db pull` replays cleanly
- verify `npm run check:migrations`
- verify `npx supabase db push` if the change is meant to go live

## Frontend error monitoring

Sentry is disabled by default in local development. The browser SDK initializes only for a production bundle when `VITE_SENTRY_ENABLED=true` and `VITE_SENTRY_DSN` is nonblank. `VITE_SENTRY_ENVIRONMENT` defaults to `production`. All `VITE_*` values are public browser-bundle configuration and must never contain a build auth token.

Source-map upload is independently enabled only when `SENTRY_ORG`, `SENTRY_PROJECT`, and secret build-only `SENTRY_AUTH_TOKEN` values are all present. Missing Sentry variables must not block `npm run dev`, ordinary local production builds, or GitHub validation. Do not create `.env.sentry-build-plugin` or `VITE_SENTRY_AUTH_TOKEN`.

The temporary production smoke helper used for the 2026-07-15 validation has been removed. Do not reintroduce a smoke route, query control, or synthetic-event helper without explicit authorization and a removal plan.

## Payment activation development

The assisted activation package is live with hosted and local history aligned at 41 migrations. Continue to use local Supabase for replay, mismatch, authority-negative, storage-isolation, provider-reference collision, and concurrency tests; the production project reference remains mutation-blocked by the finance regression helper. Production rollout used only a synthetic proof and non-secret controlled channel. Do not seed provider credentials or real customer payment evidence in regression data.

## Commercial tax and item profile development

Migrations 42-45 are live. Never seed a statutory rate from memory: create company-labelled options explicitly and keep sales and purchase defaults nullable. New order code must persist a `tax_option_id` per line and let database triggers calculate tax and header totals; do not reintroduce a freeform canonical header rate. Historical fixtures must explicitly use `legacy_header` rather than inheriting the new default. Canonical Sales Order finance-state derivation must not add line tax to a total that already includes tax.

Item create flows must either call `create_item_with_profile` and round-trip verify all protected fields, or visibly disable those controls and require basic-only acknowledgement. Do not show success before the authoritative reload. Production smoke verified the full QA profile and a `min_stock`-only edit without changing selling price, stock, BOMs, or Production Runs. Run a local reset and the complete finance regression after changing tax, order conversion, POS, finance-document, or item-profile behavior.

## Commercial workflow development

The `/orders` workspace uses the maintained query contract `tab=sales|purchase`, `view=register|create|detail`, and the existing `orderId`. Preserve older links that provide only `tab` or `orderId`, and keep mutations behind explicit user actions inside the existing governed sheets and detail surfaces.

Commercial presentation must keep workflow, stock fulfilment or receipt, finance-document state, settlement, and active financial anchor separate. Orders remain operational documents; issued Sales Invoices and posted Vendor Bills remain the legal or financial documents. Use canonical read models and the shared presentation helpers for user-facing labels. Do not render raw workflow or resolution values, and do not infer missing evidence as zero.

Base currency may use the explicit fixed `1:1` contract. A foreign-currency draft requires a positive finite configured rate or an explicitly reviewed manual rate. Missing or failed foreign-rate reads must remain visibly unavailable and must never become a trusted `1:1` fallback.

For CI, `npm run test:finance-regression:ci` runs the same serial test set without loading `.env`. It is intended only for an ephemeral local Supabase stack at `http://127.0.0.1:54321`; it does not replace the existing developer command or permit remote mutation targets.

## Finance workspace and output development

UX-6 keeps `/settlements`, `/cash`, `/banks`, and `/banks/:bankId` on the existing finance authority. The frontend may organize exposure, posted activity, and reconciliation into query-backed views, but it must read current legal, settled, outstanding, over-settled, due, aging, review, and exception values from the maintained controller views. A failed summary, ledger, balance, statement, or counterparty read is unavailable evidence and must never become a confirmed zero or an anonymous external report.

Finance exports use one typed read-only model for Excel, PDF, and Print. External advice must resolve the StockWise company and one customer or supplier, prefer immutable document snapshots over current master data, use company base currency for governed settlement values, mask bank account identifiers, and omit internal notes. Remittance Advice and Receipt Allocation Advice describe StockWise allocation evidence; neither is bank proof, a fiscal receipt, or confirmation that funds cleared. Do not create a separate print calculation path or recompute canonical reconciliation values in export helpers.

The UX-6 implementation did not add a migration, RPC, view, Edge Function, dependency, posting path, or authority rule. Local mutation proof remains the protected loopback finance suite. Production validation is read-only and must not post settlements or adjustments, reconcile transactions, upload statements, import bank CSV files, or change the POS tax mode.

## Production workspace and output development

UX-7 keeps `/bom`, `/production-runs`, and `/growth-batches` on the existing stock, costing, lifecycle, idempotency, role, and reversal authority. Recipes & Assemblies is the simple Recipe-driven stock transformation path; Production Runs preserve planned-versus-actual and frozen-cost evidence; Growth Batches preserve group-level biological or agricultural lifecycle evidence. Query-backed register, create, detail, build, and section state is presentation state only and must never post from URL state.

Keep cost labels exact. Recipe material cost is a current WAC estimate, draft Production Run cost is a preview estimate, posted Production Run cost is frozen evidence, Growth Batch direct cost is a memo operational cost, harvested cost is not COGS, and failed currency or cost reads are unavailable rather than zero. Production and Growth Batch activity must not create finance rows or change `items.unit_price`.

Recipe Specification, Production Run Cost Sheet, and Growth Batch Activity & Cost Report use one typed source model for Excel, PDF, and Print. They require company identity, explicit currency evidence, numeric Excel cells, A4 PDF output, safe filenames, WiseCore teal/neutral styling, and operational-scope disclaimers. Export helpers remain read-only and must not duplicate production costing, stock rollups, or lifecycle calculations.

The maintained query contracts are:

- `/bom?view=register|create|detail|build` with a company-scoped `bomId` for detail/build;
- `/production-runs?view=register|create|detail` with a company-scoped `runId`; the existing bare `bomId` creation link remains compatible;
- `/growth-batches?view=register|create|detail` with a company-scoped `batchId` and `section=overview|materials|lifecycle|measurements|costs|history`.

Growth Batch detail has six presentation sections, but all existing event types and event-specific reversals remain available. Event summaries that are empty or enum-shaped must use the localized event-type label. Do not expose raw lifecycle codes, UUIDs, RPC names, or developer future-scope controls in normal production workspaces.

## Administration and compliance workspace development

UX-8 keeps authenticated identity, company membership, company entitlement, and platform administration as separate authority domains. Settings is a query-backed company command centre; Users remains governed by the maintained role and invitation helpers; Platform Control remains independently platform-admin guarded; Mozambique Compliance remains company-scoped and readiness-first. Presentation helpers may label authority, readiness, or unavailable evidence, but they must not reproduce role hierarchy, effective-access, activation, reset, or fiscal-readiness authority.

The maintained routes are `/settings?view=overview|company|operations|communications|documents`, `/users`, `/users/roles`, `/platform-control?view=portfolio|activation|company`, and `/compliance/mz?view=readiness|series|export|history`. Legacy Settings `section` links still open and focus their governed section. Query state never saves settings, creates an invitation, changes access, decides activation, sends an audited notice, resets data, or changes fiscal evidence.

The Fiscal Document Review Workbook is an XLSX review aid. It is not an official SAF-T/XML submission file, tax return, proof of submission, or Tax Authority acceptance. Core fiscal settings and active series govern supported-issuance readiness; optional SAF-T preparation, artifact, and audit histories fail independently. Raw storage paths, UUIDs, and canonical status values are not normal business labels.

The UX-8 release added no migration, RPC, view, Edge Function, dependency, role rule, entitlement rule, reset scope, fiscal authority, or production mutation. A production-only member-dialog focus-return defect was corrected in `c8c135bf4f3dcfb2bea30f010be9b5bb165de674`; both explicit close and Escape now restore focus to the originating Review member control.

## UX-9A conversion and setup feedback development

UX-9A is a bounded interaction package, not the wider UX-9 consistency audit. Landing CTAs must remain links or anchors with one accessible name and no nested interactive controls. The logged-out hero owns the only pulse; authenticated, header, mobile-menu, pricing, and final CTAs remain stable. Pricing glare is decorative, pointer-transparent, fine-pointer-only, clipped to the existing card radius, and disabled by reduced motion. Public pricing remains the maintained four-plan, seven-day-trial, MZN, manual-activation model.

Onboarding progress follows the existing asynchronous authority: account check, company creation, active-company selection, membership confirmation, and invitation acceptance. It must not use a timer, artificial percentage, or simulated completion. Failures restore the existing form and entered values; successful company or invitation entry renders the existing durable completion state immediately.

The Currency preview is presentation-only and calculates the entered direction as `source amount * entered rate`. It does not invert rates, look up a reverse rate, save data, post finance activity, or imply a transfer. Incomplete or unavailable evidence remains instructional or unavailable rather than `0.00`. The compact saved-rate result is shown only after the maintained FX save succeeds and does not delay the real save.

Use the existing `framer-motion` package and CSS media queries for these effects. Under reduced motion, pulse, glare sweep, loader rotation, translating CTA text, and animated checkmark drawing stop while equivalent text and focus treatment remain visible. Do not add `motion`, replace the base Button or Card, add a dependency, or move onboarding, membership, currency, pricing, activation, or finance authority into presentation code.
## UX-9B presentation boundary

UX-9B is frontend presentation and copy only. It adds no migration, RPC, view, Edge Function, dependency, pricing/plan calculation, dashboard calculation, currency calculation, onboarding authority, finance authority, or POS-mode change. Desktop sidebar scrolling is CSS-owned; production QA remains read-only.
