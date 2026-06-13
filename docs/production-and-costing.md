# Production & Costing

This document records the current Production & Costing direction.

## Phase 1 Current State

Phase 1 upgrades the existing Assembly/BOM page into the **Recipes & Assemblies** workspace. It is a UX and workflow-clarity pass over the existing BOM and assembly behavior.

What changed:

- the user-facing concept is now Recipes & Assemblies
- the workspace uses premium header, summary cards, mobile ingredient/component cards, readiness panels, and estimated material-cost explanation
- current assembly estimates are labelled as **estimated material cost**
- the estimate is based on current weighted-average stock cost from existing stock levels
- the page remains Android/mobile friendly and avoids desktop-only table dependence for component review

What did not change:

- no Supabase schema migration was introduced
- no stock posting logic changed
- no valuation logic changed
- no POS pricing logic changed
- no finance posting, settlement, invoice issuance, RLS, entitlement, or access-control logic changed
- `stock_movements` remains the canonical stock ledger
- `stock_levels` remains derived by existing database logic
- item default selling price remains commercial and separate from stock cost

## Explicit Future Scope

Full Production & Costing remains future work:

- Production Runs
- frozen cost snapshots
- labour, utilities, overhead, recurring costs, and allocation rules
- production variance
- controlled production-run reversal and backend idempotency
- Growth Batches for livestock, poultry, fish, crops, and nurseries
- margin, break-even, yield, waste, mortality, and batch comparison dashboards

## Backend Review Boundary

The existing `build_from_bom` path remains the simple assembly posting path.

The following existing backend functions were not expanded in Phase 1 and need separate backend review before future Production & Costing work depends on them:

- `build_from_bom_sources`
- `inv_issue_component`
- `inv_receive_finished`

Future posting/costing phases must add dedicated regression coverage before changing inventory valuation, stock posting, finance posting, or production costing behavior.

## Phase A1 Assembly Backend Hardening

Phase A1 hardens the current assembly RPCs without introducing Production Runs, Growth Batches, labour/utilities/overhead allocation, frozen cost snapshots, or biological costing.

What changed:

- `build_from_bom` now enforces active-company and OPERATOR+ backend authority before posting
- `build_from_bom` links component issue and finished receipt movements to the generated build with `ref_type = 'BUILD'` and `ref_id = build_id`
- `build_from_bom_sources` remains callable for the current `/bom` source-routing flow, but now applies the same company, active-BOM, role, item, warehouse, and bin validations
- source-split assembly posting now creates a `builds` row and links all assembly movements to that build
- legacy helper RPCs `inv_issue_component` and `inv_receive_finished` are restricted from normal client execution and no longer create zero `stock_levels` rows directly

What did not change:

- no POS pricing, finance posting, invoice issuance, settlements, entitlement, Platform Control, company-access, subscription, or broader access-control model changes were introduced
- `stock_movements` remains the stock ledger
- `stock_levels` remains the trigger-derived availability and weighted-average rollup
- item default selling price remains `items.unit_price` and is not derived from stock cost

## Phase A2.1/A2.2 Assembly Idempotency

Phase A2.1 introduces `posting_requests` as the reusable company-scoped backend idempotency ledger.

Phase A2.2 applies that foundation to existing assembly posting only:

- `post_build_from_bom` wraps the hardened simple assembly build path and returns the original build id on successful replay
- `post_build_from_bom_sources` wraps source-split assembly posting and returns the build id for first success and replay
- repeated calls with the same request key and same payload do not create duplicate builds or stock movements
- reused request keys with changed payloads are rejected

What did not change:

- no Production Runs or Growth Batches were implemented
- no labour, utilities, overhead, frozen cost snapshots, or biological costing were implemented
- no POS, PO receiving, sales-order shipping, opening-stock import, manual stock movement, finance posting, invoice issuance, settlement, entitlement, Platform Control, company-access, or subscription idempotency was added
- `stock_movements` remains the ledger and `stock_levels` remains the derived rollup
- `apply_stock_delta` concurrency behavior is unchanged
- item default selling price remains `items.unit_price` and is not derived from stock cost

Phase A2.3 is still required before Production Runs: concurrent stock-decrement safety, simultaneous assembly/POS/receipt stress coverage, and follow-on idempotency rollout for other stock-sensitive workflows.
