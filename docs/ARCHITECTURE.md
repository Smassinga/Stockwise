# StockWise Architecture

This document is the current high-level architecture summary, not a generated system brochure.

## Application Shape

StockWise is a React + TypeScript frontend backed by Supabase.

Primary layers:

- React routes and page workspaces under `src/pages`
- shared UI and layout components under `src/components`
- workflow and data helpers under `src/lib`
- Supabase schema, functions, policies, and edge functions under `supabase`

## Current Product Areas

- operational inventory and warehouse control
- purchasing, sales, cash, bank, and settlements
- Mozambique finance-document issuance and reconciliation
- platform access control and manual entitlement operations
- Android-first operational flows such as Point of Sale

## Data Authority

- database helpers and RPCs are the authority for finance posting, entitlement state, and operational guardrails
- frontend pages are responsible for workflow clarity and safe input, not for inventing core financial or access truth

## Canonical Schema Direction

- canonical replay starts from the new baseline plus forward migrations
- `stock_movements` is the inventory ledger
- `company_members` + `member_role` is the company access model
- `profiles` carries sign-in/profile metadata
- `user_active_company` carries active-company context

## Current Technical Guardrails

- keep Supabase-managed `storage` internals out of app migrations
- keep custom global roles in `supabase/roles.sql`
- treat `db pull` `*_remote_schema.sql` files as review artifacts by default
- validate finance-critical changes with `npm run test:finance-regression`
