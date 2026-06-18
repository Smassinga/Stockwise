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
- `profiles.phone_number` is an optional user contact field captured from signup/profile edits; it is not used for authentication, invitation matching, membership, tenant selection, or entitlement
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
- `posting_requests`
- `boms`
- `bom_components`

Current rules:

- `stock_movements` is the canonical stock ledger
- `stock_levels` is the derived rollup used for availability and weighted-average bucket cost
- stock movement trigger rollups use atomic negative-delta guards and receipt upserts so concurrent issue/receipt inserts cannot lose bucket updates or silently overdraw stock
- `posting_requests` is the reusable company-scoped backend idempotency ledger for posting workflows; it covers assembly and normal web Point of Sale today, and the consolidated A2.4/A2.5 local package extends the pattern to PO receiving, sales shipping, opening-stock import, manual receipt/issue, transfer, and adjustment
- application code that records a stock receipt, issue, transfer, or adjustment should insert the `stock_movements` row and let database triggers update `stock_levels`; it should not also mutate `stock_levels` directly for the same event
- assembly posting uses `build_from_bom` or the hardened source-split `build_from_bom_sources` path; both create `stock_movements` rows with `ref_type = 'BUILD'` and a build `ref_id`
- idempotent assembly posting uses `post_build_from_bom` and `post_build_from_bom_sources`; repeated calls with the same request key and same payload return the original build id, while reused keys with changed payloads are rejected
- idempotent normal web POS posting is implemented in the A2.4a.1 package through `post_operator_sale` with operation type `operator.sale`; repeated calls with the same request key and same payload return the original sales order result, while reused keys with changed payloads are rejected
- the consolidated A2.4/A2.5 local package adds dedicated governed posting RPCs for the remaining maintained stock-posting workflows: `post_purchase_receipt` (`purchase.receive`), `post_sales_shipment` (`sales.ship`), `post_opening_stock_import` (`opening_stock.import`), `post_stock_receipt` (`stock.receipt`), `post_stock_issue` (`stock.issue`), `post_stock_transfer` (`stock.transfer`), and `post_stock_adjustment` (`stock.adjustment`)
- these RPCs preserve `stock_movements` as the append-only ledger and `stock_levels` as the trigger-derived rollup; replay cannot duplicate stock or document progress, and same-key/changed-payload requests are rejected before business rows are created
- helper RPCs such as `inv_issue_component` and `inv_receive_finished` are legacy/internal utilities, not normal client-facing assembly APIs
- canonical UOM identifiers remain text (`uoms.id`, `items.base_uom_id`, and `stock_movements.uom_id`); opening-stock import must preserve text IDs such as `uom_ea` and must not cast them to UUID
- legacy POS RPCs remain temporarily executable for deployment and stale-client compatibility; A2.4a.2 must close normal authenticated legacy execution after frontend and Tauri distribution posture is reviewed
- maintained frontend PO receiving, sales-order shipping, opening-stock import, and manual movement flows are moved behind dedicated RPC/idempotency boundaries in the consolidated A2.4/A2.5 local package; production rollout and smoke validation remain separate release steps
- remaining direct movement access is limited to read/reporting paths, local regression setup fixtures, and stale or legacy helper surfaces. `src/lib/sales.ts` still contains an old direct stock-movement helper with no maintained frontend caller; legacy POS RPC closure remains A2.4a.2.
- `movements` is no longer part of the intended product direction
- the `/movements` UI is a register over `stock_movements`, not a separate data model; visual filtering, badges, and mobile cards must not imply manual `stock_levels` posting or a different costing policy

Legacy structures removed in cleanup:

- `movements`

### Item commercial pricing

Current commercial default:

- sellable items store the default sell price in `items.unit_price`
- `items_view.unitPrice` exposes it to the app
- Point of Sale prefills line pricing from `items.unit_price`
- Point of Sale never uses stock cost or weighted-average valuation as the default sell price
- assembly material cost estimates and build receipt unit costs must not mutate `items.unit_price`

### Walk-in / cash sale model

Current rule:

- quick store-counter sales default to the company cash customer
- the A2.4a.1 web POS cutover calls `post_operator_sale(...)`, which delegates to the existing sale-and-settlement RPC path and creates or reuses the cash customer when a named customer is not selected
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
- posting idempotency: `posting_requests` for assembly, normal web POS, and the consolidated A2.4/A2.5 local stock-posting RPCs
- item default sell price: `items.unit_price`

## Production Runs

The local Production Runs package adds a planned-versus-actual production model. It is not live until the new migrations are applied to hosted Supabase.

Tables:

- `production_runs` stores the header, reference, BOM snapshot, finished item, planned/actual output, destination, status, cost totals, movement links, actor timestamps, and reversal metadata.
- `production_run_inputs` stores deterministic input lines, source BOM component links, input item/UOM, planned and actual quantities, source bucket, frozen input WAC, frozen input total, original issue movement, and reversal receipt movement.
- `production_run_outputs` stores output lines. The first UI supports exactly one primary finished output, while the table shape leaves room for future multi-output/by-product expansion.
- `production_run_extra_costs` stores additional direct production-cost snapshots in `labour`, `utilities`, `overhead`, `transport`, or `other` categories.
- `production_run_counters` generates non-fiscal company-scoped production run references.

Lifecycle:

- `draft`: editable by OPERATOR+ through `update_production_run_draft`.
- `posted`: immutable production result; stock movements and cost snapshots are frozen.
- `reversed`: original posted run remains auditable and compensating movements are linked.
- `cancelled`: draft-only closure with no stock movement.
- normal authenticated clients can read company-scoped Production Run rows but cannot directly insert, update, or delete Production Run business rows; mutation is RPC-only.
- first-release Production Run input and output quantities use each item base UOM. `production_run_inputs.uom_id`, `production_run_outputs.uom_id`, and `production_runs.output_uom_id` must match the relevant item `base_uom_id`; general UOM conversion is deferred.

Posting and reversal:

- `post_production_run` uses operation type `production.run.post`.
- `reverse_production_run` uses operation type `production.run.reverse`.
- both use `posting_requests`, mandatory request keys, deterministic payload hashes, replay safety, and payload-mismatch rejection.
- posting writes input issues and one output receipt with `ref_type = 'PRODUCTION_RUN'`.
- reversal writes compensating output issue and input receipts with `ref_type = 'PRODUCTION_RUN_REVERSAL'`.
- neither path mutates `stock_levels` directly or updates `items.unit_price`.

Additional direct costs do not create bank, cash, supplier, vendor-bill, or journal rows. They are cost snapshots used to calculate total production cost and output unit cost.
- entitlement/control plane: `company_subscription_state` + `platform_admins`
