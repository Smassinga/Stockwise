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
- item default selling price remains `items.unit_price` and is not derived from stock cost

## Phase A2.3 Stock Rollup Concurrency Safety

Phase A2.3 hardens the shared `apply_stock_delta` rollup path used by stock movement inserts. This is a stock-engine safety change, not a costing-policy change.

What changed:

- negative stock deltas are guarded by an atomic conditional update on the affected `stock_levels` bucket
- concurrent receipts into the same bucket use nullable-bin aware upserts so receipt quantity and weighted-average updates are not lost
- duplicate bucket preflight is explicit; hosted deployment must stop for manual cleanup if duplicate `stock_levels` buckets already exist
- regression coverage now includes concurrent assembly issue protection, concurrent receipt rollup, movement-ledger reconciliation, and POS-versus-assembly stock competition

What did not change:

- no Production Runs or Growth Batches were implemented
- no labour, utilities, overhead, frozen cost snapshots, or biological costing were implemented
- no POS pricing, finance posting, invoice issuance, settlement, entitlement, Platform Control, company-access, or subscription behavior changed
- no idempotency was added to POS, PO receiving, sales-order shipping, opening-stock import, or manual movements
- `stock_movements` remains the ledger and `stock_levels` remains the derived rollup
- reversals remain append-only compensating movements

## Production Release Closeout

The A1 through A2.3 chain is live in hosted Supabase as of 13 June 2026, with the production frontend and backend aligned at commit `2bfb31d`.

Production smoke validation passed against a controlled assembly target:

- `/bom` loaded as Recipes & Assemblies
- one UI submit created exactly one build
- seven component issue movements and one finished-item receipt movement were created
- all assembly movements were linked through `ref_type = 'BUILD'` and the generated build id
- component stock decreased and finished stock increased according to the BOM quantities
- no stock bucket became negative
- duplicate stock bucket detection returned zero rows
- weighted-average cost updated according to the existing rollup policy
- `items.unit_price` remained unchanged and separate from inventory cost
- one `posting_requests` row recorded the successful `assembly.build` result
- production Postgres logs showed no relevant error during the smoke window

The follow-up durable success confirmation on `/bom` is a UI feedback improvement only. It does not change posting authority, request-key generation, idempotency behavior, valuation, stock movement insertion, finance posting, POS, PO receiving, opening-stock import, sales shipping, manual movements, access control, Platform Control, or subscriptions.

## Phase A2.4a.1 Normal Web POS Idempotency

Phase A2.4a.1 starts the governed-posting expansion beyond assembly by adding an idempotent wrapper for normal web Point of Sale posting.

Release boundary:

- this package is live and production-smoke validated as of 14 June 2026
- hosted migration `20260613144412_add_idempotent_operator_sale.sql` is applied, and the production frontend is aligned at commit `80c7c70`
- the legacy POS RPCs remain executable during the compatibility window

What changed:

- `post_operator_sale` wraps the existing POS sale-and-settlement backend transaction with `posting_requests`
- the operation type is `operator.sale`
- same-key/same-payload replay returns the original sales order result without creating another sales order, sales-order line, stock movement, or settlement
- same-key/changed-payload requests are rejected before business rows are created
- the web POS flow now calls `post_operator_sale`
- POS commercial pricing remains based on `items.unit_price` or the operator's explicit line price override, not inventory cost
- production smoke submitted exactly one controlled cash sale for `Leny Doçuras`, creating one sales order, one line, one issue movement, one cash transaction, and one idempotency request
- the smoke moved stock from `2` to `1`, left `items.unit_price` at `1500`, created no duplicate or negative stock bucket, and recorded one succeeded `operator.sale` request referencing the sales order

What did not change:

- no PO receiving, sales-order shipping, opening-stock import, manual receipt/issue, transfer, or adjustment idempotency was added
- no POS pricing policy, stock valuation policy, finance posting, invoice issuance, settlement model, entitlement, Platform Control, company-access, or subscription behavior changed
- the legacy POS RPCs remain temporarily executable for migration/deployment compatibility and stale Tauri clients
- A2.4a.2 must review maintained Tauri/packaged-client posture and then close normal authenticated legacy POS execution

## Consolidated A2.4/A2.5 Local Package

The consolidated A2.4/A2.5 package is implemented locally to move the remaining maintained stock-posting workflows behind backend-authoritative, transactional, idempotent RPCs.

What changed locally:

- normal web PO receiving calls `post_purchase_receipt` with operation type `purchase.receive`
- normal web sales shipping calls `post_sales_shipment` with operation type `sales.ship`
- opening-stock import calls `post_opening_stock_import` with operation type `opening_stock.import`
- maintained manual stock posting uses `post_stock_receipt`, `post_stock_issue`, `post_stock_transfer`, and `post_stock_adjustment`
- manual operation types are `stock.receipt`, `stock.issue`, `stock.transfer`, and `stock.adjustment`
- replay of the same request key and payload returns the original result without duplicating document progress or stock movements
- reusing a request key with a changed payload is rejected
- transfer posting creates both sides atomically or neither side
- adjustment posting remains movement-based and append-only
- `stock_movements` remains the ledger and `stock_levels` remains trigger-derived

What did not change:

- no Production Runs, Growth Batches, Cost Analysis Dashboard, Advanced Allocation, or Industry Templates were implemented
- no POS legacy RPC revocation was included; A2.4a.2 remains deferred
- no POS pricing policy, stock valuation policy, finance posting, invoice issuance, settlement model, entitlement, Platform Control, company-access, or subscription behavior changed
- reversals remain compensating movements rather than edits or deletes to posted movements

Production Runs may start only after this consolidated package is locally validated, reviewed, deployed, and production-smoke validated. A2.4a.2 remains a separate compatibility/authority-closure package.
