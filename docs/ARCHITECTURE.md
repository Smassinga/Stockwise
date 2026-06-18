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
- `posting_requests` is the shared backend idempotency ledger. It governs assembly posting, normal web Point of Sale, PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, adjustment, and Production Run post/reversal workflows.
- Tauri packages the current frontend. It does not introduce a separate desktop-only or Android-only business logic layer.
- The maintained enforcement, rate-limiting, monitoring, and scaling baseline is documented in [SECURITY_AND_SCALE_BASELINE.md](SECURITY_AND_SCALE_BASELINE.md); recovery and rollback procedures are documented in [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md).

## Canonical Data Direction

- the active migration history starts from the canonical baseline plus forward migrations only
- `stock_movements` is the stock ledger
- `stock_levels` is the derived availability and weighted-average rollup
- `posting_requests` is the company-scoped idempotency ledger for governed posting workflows
- governed stock-posting operation types are domain-specific: `assembly.build`, `assembly.build_sources`, `operator.sale`, `purchase.receive`, `sales.ship`, `opening_stock.import`, `stock.receipt`, `stock.issue`, `stock.transfer`, `stock.adjustment`, `production.run.post`, and `production.run.reverse`
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

The first Production Runs package is live as of 2026-06-18. Hosted Supabase is aligned through `20260615213640_add_production_run_posting.sql`, and the production frontend is commit `4f82c5a feat(production): add governed production runs`.

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
