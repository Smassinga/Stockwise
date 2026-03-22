# Finance-Document Step 1 Transition Notes

## Scope

Step 1 introduces canonical order-state read models and user-facing semantics cleanup only.

It does not:
- create finance documents
- cut settlement writes over to invoices or bills
- rewrite historical order-linked settlement records

## Validation pack

Use these comparisons before any Step 2 or Step 4 cutover work:

- Compare legacy order header statuses against:
  - `public.v_sales_order_state.workflow_status`
  - `public.v_sales_order_state.fulfilment_status`
  - `public.v_purchase_order_state.workflow_status`
  - `public.v_purchase_order_state.receipt_status`
- Compare legacy settlement rows in the UI against:
  - `public.v_sales_order_state.legacy_settled_base`
  - `public.v_sales_order_state.legacy_outstanding_base`
  - `public.v_purchase_order_state.legacy_paid_base`
  - `public.v_purchase_order_state.legacy_outstanding_base`
- Compare dashboard and revenue-report buckets before and after the Step 1 semantics change.
  Revenue and margin reporting should now read as operational shipment-linked signals, not settlement-cleared finance truth.

## Transitional debt: reminders

The due-reminder path remains explicitly sales-order-based in Step 1 and must not be treated as the canonical finance-document model.

Current debt surface:
- `public.v_due_sales_orders`
- `public.build_due_reminder_batch(...)`
- `public.enqueue_due_reminders_for_all_companies(...)`
- `public.invoke_due_reminder_worker(...)`
- [due-reminder-worker/index.ts](/C:/Dev/Stockwise/supabase/functions/due-reminder-worker/index.ts)

Current interpretation:
- reminder eligibility is still derived from sales-order due data
- reminder balances still depend on legacy order-linked settlement assumptions
- invoice and bill settlement state is not yet the reminder source of truth

Owner:
- finance-document refactor follow-up after Step 2 finance-document schema is live

Exit criteria:
- add an invoice-based due view for receivables reminders
- move reminder queue generation away from `v_due_sales_orders`
- keep SO reminders readable only as legacy history during transition

## Cutover guardrail

Do not move settlement writes to invoice or bill allocations until:
- canonical order-state views are live
- finance-document views are live
- order financial rollups show legacy and canonical amounts side by side
- live-company comparison mismatches are documented and understood
