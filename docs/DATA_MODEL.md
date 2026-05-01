# StockWise Data Model

This document records the current schema truth after the canonical baseline reset and the first cleanup pass on top of it.

## What Is Canonical

### Company membership and access

Canonical structures:

- `companies`
- `company_members`
- `member_role`
- `member_status`
- `profiles`
- `user_active_company`
- `company_subscription_state`
- `platform_admins`

Current rules:

- company membership and authority live in `company_members`
- company role semantics use `member_role`
- company role definitions are exposed in the app under Users > Role definitions and must stay aligned with the checks in `src/lib/roles.ts` and `src/lib/permissions.ts`
- company roles are `OWNER`, `ADMIN`, `MANAGER`, `OPERATOR`, and `VIEWER`; the UI explains practical can/cannot-do boundaries without inventing permissions that are not enforced
- user profile and sign-in metadata live in `profiles`
- active company context lives in `user_active_company`
- entitlement state lives in `company_subscription_state`
- platform-admin access is separate via `platform_admins` and is not granted by company ownership or membership role

Legacy structures removed in cleanup:

- `user_profiles`
- `company_role`

### Inventory and stock truth

Canonical structures:

- `items`
- `items_view`
- `warehouses`
- `bins`
- `stock_movements`
- `stock_levels`
- `boms`
- `bom_components`

Current rules:

- `stock_movements` is the canonical stock ledger
- `stock_levels` is the rollup used for availability and weighted-average bucket cost
- `movements` is no longer part of the intended product direction

Legacy structures removed in cleanup:

- `movements`

### Item commercial pricing

Current commercial default:

- sellable items store the default sell price in `items.unit_price`
- `items_view.unitPrice` exposes it to the app
- Point of Sale prefills line pricing from `items.unit_price`
- Point of Sale never uses stock cost or weighted-average valuation as the default sell price

### Walk-in / cash sale model

Current rule:

- quick store-counter sales default to the company cash customer
- `create_operator_sale_issue(...)` creates or reuses that customer when a named customer is not selected
- named customer override is optional

## Settings Models

These tables are both still active and intentionally retained for now:

- `company_settings`
  - company-scoped structured JSON and finance/reminder configuration
- `app_settings`
  - app-level shared JSON configuration and fallback behavior still used by current code
- `settings`
  - smaller legacy config table still used by current app code for base-currency and report-source behavior

`settings` and `app_settings` are not clean enough to consolidate blindly in this pass because both are still used by live code paths. Future consolidation should happen only with a deliberate forward migration and code cutover.

## Finance and settlement anchors

Canonical active anchors:

- AR: issued sales invoices
- AP: posted vendor bills

Legacy orders may still appear as history or operational parents, but reconciliation and settlement truth now follow finance-document anchors.

## Current design summary

One clean model per responsibility:

- membership/roles: `company_members` + `member_role`
- user profile/sign-in state: `profiles`
- active company: `user_active_company`
- stock ledger: `stock_movements`
- item default sell price: `items.unit_price`
- entitlement/control plane: `company_subscription_state` + `platform_admins`
