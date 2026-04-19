# StockWise Architecture

This document describes the current application shape after the canonical migration reset, schema cleanup, Platform Control hardening, Point of Sale work, and onboarding/import pass.

## Application Shape

StockWise is a React + TypeScript application backed by Supabase and packaged for web first, with Tauri desktop and Android shells consuming the same frontend.

Primary layers:

- routes and feature workspaces under `src/pages`
- shared UI, layout, and brand components under `src/components`
- workflow helpers, data mappers, and commercial/access helpers under `src/lib`
- Supabase schema, policies, RPCs, views, and Edge Functions under `supabase`
- Tauri desktop and Android shell metadata under `src-tauri`

## Current Product Surfaces

The maintained product surfaces are:

- dashboard and operational review
- Point of Sale for fast small-store counter sales with a default walk-in / cash customer
- items, UOM, warehouses, bins, stock levels, and stock movements
- BOM and assembly, including lightweight time planning
- purchase orders, sales orders, vendor bills, and sales invoices
- settlements, bank, and cash workflows
- onboarding import for opening/master data
- platform control for company access, trials, manual paid activation, and guarded reset operations

## Authority Split

- Supabase RPCs, policies, and views are the authority for stock posting, finance posting, reconciliation, entitlement state, and access restriction.
- Frontend pages are responsible for workflow clarity, guided inputs, and operator/admin usability.
- Tauri packages the current frontend. It does not introduce a separate desktop-only or Android-only business logic layer.

## Canonical Data Direction

- the active migration history starts from the canonical baseline plus forward migrations only
- `stock_movements` is the stock ledger
- `stock_levels` is the derived availability and weighted-average rollup
- `company_members` + `member_role` is the company membership and authority model
- `profiles` + `user_active_company` is the active signed-in user context
- `company_subscription_state` + `platform_admins` is the tenant entitlement and control-plane model

## Android-First and Tauri Position

- mobile UX is a general app concern, not a separate product mode
- the small-screen shell prioritizes a smaller route set and clearer vertical flow
- Point of Sale and onboarding import are packaged into Tauri builds exactly as they exist on the web app
- desktop and Android releases must reflect current StockWise branding, route naming, and operator-facing copy

## Guardrails

- keep Supabase-managed `storage` internals out of tracked app migrations
- keep custom global roles in `supabase/roles.sql`
- treat `db pull` `*_remote_schema.sql` files as review artifacts by default
- do not use inventory cost as a default selling price
- validate finance and operational continuity with `npm run test:finance-regression`
