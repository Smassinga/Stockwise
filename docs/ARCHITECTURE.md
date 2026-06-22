# StockWise Architecture

This document describes the current application shape after the canonical migration reset, schema cleanup, Platform Control hardening, Point of Sale work, and onboarding/import pass.

## Application Shape

StockWise is a React + TypeScript application backed by Supabase and packaged for web first, with Tauri desktop and Android shells consuming the same frontend.

Primary layers:

- routes and feature workspaces under `src/pages`
- shared UI, layout, and brand components under `src/components`
- premium UI primitives for cockpit pages and operational registers under `src/components/premium`
- workflow helpers, data mappers, and commercial/access helpers under `src/lib`
- Supabase schema, policies, RPCs, views, and Edge Functions under `supabase`
- Tauri desktop and Android shell metadata under `src-tauri`

## Current Product Surfaces

The maintained product surfaces are:

- dashboard and operational review
- premium dashboard cockpit for operating status, action needed, recent activity, and shipment-linked performance
- premium register primitives applied first to Items and Stock Levels, with desktop tables and Android card lists sharing sorting, filtering, pagination, and status presentation patterns
- premium onboarding and administration surfaces for explicit company setup, backed Settings navigation, and canonical Users/Roles review
- Point of Sale for fast small-store counter sales with a default walk-in / cash customer
- items, UOM, warehouses, bins, stock levels, and stock movements
- BOM and assembly, including lightweight time planning
- purchase orders, sales orders, vendor bills, and sales invoices
- settlements, bank, and cash workflows
- Growth Batches for group-level biological and agricultural batch tracking
- onboarding import for opening/master data
- platform control for company access, trials, manual paid activation, and guarded reset operations

## Onboarding Entry

- public signup uses Supabase Auth only; production users must confirm email before normal app access, then choose company creation or explicit invitation acceptance
- signup may capture an optional phone number as profile contact data, but phone is not a login factor, OTP path, membership key, or tenant-access signal
- Brevo-backed Supabase Auth email templates handle confirmation, password reset, invite, and email-change messages; no parallel auth or organisation system is used
- Supabase password recovery callbacks route to `/update-password` before normal membership routing; the update screen changes the password through Supabase Auth, clears the recovery marker, and returns the user to login
- authenticated users who already have an active company membership continue into the dashboard under the existing active-company rules
- authenticated users without an active membership land on `/onboarding`
- onboarding now supports two first-class paths: join an invited company or create a new company
- onboarding company creation is intentionally minimal and only requires the company name; legal identity, address, contacts, logo, bank details, tax details, and other deeper setup remain editable later in `Settings`
- after company creation, onboarding shows the setup checklist for company profile, fiscal/legal readiness, users, and opening data; these are navigation and readiness cues, not new backend workflow gates
- pending invitation discovery is email-bound and uses a dedicated authenticated RPC that only returns invites for the signed-in account email
- invitation acceptance stays secure through the authenticated email match plus invite validity checks; expired invite rows are excluded from the onboarding list and rejected on acceptance
- choosing `Create new company` no longer auto-consumes pending invitations; the invitation record remains pending unless the user explicitly accepts it
- the `admin-users/sync` edge function may link invite rows to the authenticated user id after sign-in, but it must not auto-activate invited memberships; invite acceptance remains an explicit onboarding or invite-link action

## Authority Split

- Supabase RPCs, policies, and views are the authority for stock posting, finance posting, reconciliation, entitlement state, and access restriction.
- Frontend pages are responsible for workflow clarity, guided inputs, and operator/admin usability.
- `posting_requests` is the shared backend idempotency ledger. It governs assembly posting, normal web Point of Sale, PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, adjustment, Production Run post/reversal, and Growth Batch create/activate/cancel/measurement/direct-cost workflows. The local Growth Batches G3 package adds stock-input posting and compensating reversal operation types pending hosted rollout.
- Tauri packages the current frontend. It does not introduce a separate desktop-only or Android-only business logic layer.
- The maintained enforcement, rate-limiting, monitoring, and scaling baseline is documented in [SECURITY_AND_SCALE_BASELINE.md](SECURITY_AND_SCALE_BASELINE.md); recovery and rollback procedures are documented in [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md).

## Canonical Data Direction

- the active migration history starts from the canonical baseline plus forward migrations only
- `stock_movements` is the stock ledger
- `stock_levels` is the derived availability and weighted-average rollup
- `posting_requests` is the company-scoped idempotency ledger for governed posting workflows
- governed operation types are domain-specific: `assembly.build`, `assembly.build_sources`, `operator.sale`, `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, `stock.adjustment`, `production.run.post`, `production.run.reverse`, `growth.batch.create`, `growth.batch.activate`, `growth.batch.cancel`, `growth.batch.measurement`, and `growth.batch.cost`
- `company_members` + `member_role` is the company membership and authority model
- `profiles` + `user_active_company` is the active signed-in user context
- `company_subscription_state` + `platform_admins` is the tenant entitlement and control-plane model

## Android-First and Tauri Position

- mobile UX is a general app concern, not a separate product mode
- the shell now uses adaptive page-width variants instead of one rigid content canvas, so dashboard-style pages and task workspaces can use wider screens more intelligently without losing readable structure
- the small-screen shell prioritizes a smaller route set, clearer vertical flow, and a persistent bottom navigation dock that stays visually separated from page content
- dashboard mobile flow prioritizes Today/status, Action Needed, Quick Actions, and Recent Activity before deeper chart review
- the Android runtime now fits the system window area and uses safe-area-aware top/bottom spacing instead of allowing app chrome to collide with the status bar
- the mobile drawer has its own scroll body so lower navigation entries remain reachable on shorter Android screens
- compact review-heavy pages such as Items, Movements, and Stock Levels should expose card/register views before falling back to horizontal tables
- onboarding, Settings, and Users/Roles should preserve the same Android-first principle: decision cards, setup categories, role explanations, invite forms, and member cards must remain usable without hover or horizontal-table dependence
- register import/export controls must wrap existing approved workflows; visual register work must not create new posting, costing, access-control, or data-import authority
- Point of Sale and onboarding import are packaged into Tauri builds exactly as they exist on the web app
- because installed Tauri builds can lag the web deployment, legacy POS RPC execution remains a temporary compatibility boundary until A2.4a.2 reviews maintained desktop/Android clients and closes normal legacy execution

## Production Runs Architecture

The first Production Runs package is live as of 2026-06-18. Its rollout aligned hosted Supabase through `20260615213640_add_production_run_posting.sql`, and the production frontend was commit `4f82c5a feat(production): add governed production runs`. Hosted Supabase is now further aligned through the Growth Batches G1-G2 migration `20260619175129_add_growth_batch_lifecycle_events.sql`.

Production Runs add a richer operational path beside quick assembly:

- `/bom` remains the Recipes & Assemblies workspace for recipe maintenance and simple quick-build stock transformations.
- `/production-runs` manages planned versus actual production, frozen costing, additional direct costs, posting, and controlled reversal.

New tables:

- `production_runs`
- `production_run_inputs`
- `production_run_outputs`
- `production_run_extra_costs`
- `production_run_counters`

New RPCs:

- `create_production_run_draft`
- `update_production_run_draft`
- `cancel_production_run_draft`
- `preview_production_run`
- `post_production_run`
- `reverse_production_run`

Posting uses `posting_requests` with operation type `production.run.post`. Reversal uses `posting_requests` with operation type `production.run.reverse`. Both require a nonblank request key, replay the same result for the same key and payload, and reject changed payloads under the same key.

Authority remains domain-specific:

- VIEWER can read permitted Production Run records.
- OPERATOR+ can create/edit drafts, preview, and post.
- MANAGER+ can reverse posted runs.
- authenticated clients have company-scoped read access to Production Run tables, but no direct table INSERT, UPDATE, or DELETE authority; draft/post/reverse mutations are RPC-only.

Production Run posting writes only `stock_movements`; `stock_levels` remains trigger-derived. Additional direct costs are production cost snapshots only and do not create finance postings.
- first-release Production Run quantities are recorded in each item base UOM only; generic Production Run UOM conversion is deferred to a later explicit design pass.
- desktop and Android releases must reflect current StockWise branding, route naming, and operator-facing copy

Production smoke validation used `Leny Doçuras` and Production Run `LEN-PR000000001`: setup receipt added Fermento through the maintained Movements UI, posting created seven input issues plus one output receipt, reversal created one compensating output issue plus seven input receipts, duplicate/negative stock checks stayed zero, and `items.unit_price` remained commercial.

## Growth Batches G1-G2 Architecture

Growth Batches G1-G2 is live in production as of 2026-06-20. Hosted Supabase is aligned through `20260619175129_add_growth_batch_lifecycle_events.sql`, the production frontend is commit `c7b5e299c277c28faf78fc5f19e4fe43fbfb20d3`, and the production route is `/growth-batches`.

The rollout applied the two Growth Batch migrations:

- `20260619175117_add_growth_batches_foundation.sql`
- `20260619175129_add_growth_batch_lifecycle_events.sql`

Production smoke validation passed through the maintained UI using the controlled `Leny Doçuras` tenant and retained active batch `LEN-GB000000001`.

The G1-G2 boundary is intentionally narrow:

- `/growth-batches` manages group-level biological or agricultural batches, not per-animal or per-plant stock.
- supported lifecycle actions are draft creation/editing, draft cancellation, activation, measurements, and memo direct costs.
- unsupported actions remain disabled/future scope: physical stock inputs, mortality/shrinkage, transfers, harvests/splits, completion, reversal, fair-value adjustments, FIFO, COGS, and finance posting.
- direct costs are Growth Batch memo rollups only. They do not create bank, cash, vendor bill, settlement, journal, invoice, stock movement, or `items.unit_price` changes.
- primary quantities are base-UOM-style entries only for this phase. Count quantities must be whole numbers, weight measurements use the batch `weight_uom_id`, area observations use the batch `area_uom_id`, and generic Growth Batch UOM conversion is deferred.
- the batch start date is the operational lifecycle boundary. Activation rejects future start dates; measurement and memo direct-cost effective dates must be on or after the start date and not in the future. Server-created timestamps remain separate from operator-entered effective dates.
- Growth Batch histories expose `event_sequence`, effective date, created timestamp, and event id. Callers must order histories explicitly, normally by `event_sequence`.
- authenticated clients may read permitted Growth Batch tables/views, but business mutation is RPC-only and protected by RLS, validation triggers, and request-key idempotency where duplicate submission risk exists.

New tables:

- `growth_batches`
- `growth_batch_counters`
- `growth_batch_events`
- `growth_batch_measurements`
- `growth_batch_direct_costs`

New read models:

- `growth_batches_register`
- `growth_batch_current_state`
- `growth_batch_event_timeline`
- `growth_batch_measurement_history`
- `growth_batch_direct_cost_history`

New RPCs:

- `create_growth_batch_draft`
- `update_growth_batch_draft`
- `cancel_growth_batch_draft`
- `activate_growth_batch`
- `record_growth_batch_measurement`
- `record_growth_batch_direct_cost`

Growth Batch operation types use `posting_requests` for create, activation, cancellation, measurement, and direct-cost replay safety: `growth.batch.create`, `growth.batch.activate`, `growth.batch.cancel`, `growth.batch.measurement`, and `growth.batch.cost`.

## Growth Batches G3 Local Stock-Input Package

Growth Batches G3 is complete locally and is not yet hosted or live. Hosted production remains aligned through 28 migrations at `20260619175129_add_growth_batch_lifecycle_events.sql`; the local branch adds two pending migrations for a 30-migration local chain:

- `20260620132646_add_growth_batch_stock_inputs.sql`
- `20260620132656_add_growth_batch_stock_input_posting.sql`

The G3 package keeps Growth Batches group-level and adds governed physical stock input for active batches only:

- `stock_input` and `stock_input_reversal` Growth Batch event types.
- immutable stock-input detail lines and immutable reversal-detail lines.
- one append-only `stock_movements` issue per input line, referenced with `ref_type = 'GROWTH_BATCH_INPUT'`, `ref_id = growth_batch_event_id`, and `ref_line_id = growth_batch_stock_inputs.id`.
- one compensating `stock_movements` receipt per reversal line, referenced with `ref_type = 'GROWTH_BATCH_INPUT_REVERSAL'`, `ref_id = reversal_event_id`, and `ref_line_id = growth_batch_stock_input_reversal_lines.id`.
- base-UOM-only consumed inventory lines; Growth Batch primary quantity, weight UOM, area UOM, and consumed item UOM remain separate domains with no conversion engine.
- source WAC is frozen into stock-input detail rows as material cost. Memo direct costs remain separate and non-financial.
- material, total, and remaining Growth Batch rollups are recalculated from immutable input/reversal details plus existing memo direct costs while the batch row is locked.
- `preview_growth_batch_stock_input`, `post_growth_batch_stock_input`, and `reverse_growth_batch_stock_input` preserve RPC-only mutation, company role checks, entitlement checks, RLS/FORCE RLS, and request-key idempotency for posting/reversal.

Local validation has passed: local replay of 30 migrations, Growth Batches regression `5/5`, complete finance regression `31/31`, independent implementation inspection, authenticated local visual QA at `1440`, `1200`, `820`, and `390` in light and dark mode, static validation, and build. The package is ready for normal-user staging, commit, push, and CI. Hosted rollout has not started and no production smoke has been performed for G3.

G3 does not add mortality, shrinkage, transfers, harvests/splits, completion, whole-batch reversal, FIFO biological layers, COGS, fair-value accounting, automatic finance posting, vendor-bill allocation, supplier liabilities, cash/bank settlement, profitability dashboards, per-animal/per-plant records, or generic UOM conversion.

## Notification Direction

- `public.notifications` remains the company-scoped notification feed consumed by the shell
- notifications should stay high-signal; approval requests, finance issue/post milestones, critical treasury approvals, and company-access events are in scope, while low-value draft churn is not
- finance lifecycle notifications now fan out from `finance_document_events` instead of duplicating logic inside every frontend page

## Guardrails

- keep Supabase-managed `storage` internals out of tracked app migrations
- keep custom global roles in `supabase/roles.sql`
- treat `db pull` `*_remote_schema.sql` files as review artifacts by default
- do not use inventory cost as a default selling price
- validate finance and operational continuity with `npm run test:finance-regression`
- keep UI polish inside the existing Tailwind/shadcn-style system unless a new dependency is explicitly justified
