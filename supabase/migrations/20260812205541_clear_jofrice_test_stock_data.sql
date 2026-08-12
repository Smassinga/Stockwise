-- One-off pre-go-live data correction for Jofrice's Beauty.
-- Preserve master data while removing the inspected stock test chain.
-- The migration is guarded so it no-ops when the production-only target is absent
-- and aborts if the inspected test-only state changed before execution.

do $$
declare
  v_company_id uuid;
  v_match_count bigint;
begin
  select count(*) into v_match_count
  from public.companies
  where name = 'Jofrice''s Beauty'
    and created_at = '2026-08-12 16:14:21.757428+00'::timestamptz;

  if v_match_count = 0 then
    raise notice 'Jofrice stock test cleanup: target company not present, no-op.';
    return;
  end if;

  if v_match_count <> 1 then
    raise exception 'Jofrice stock test cleanup guard: expected exactly one target company, found %', v_match_count;
  end if;

  select id into v_company_id
  from public.companies
  where name = 'Jofrice''s Beauty'
    and created_at = '2026-08-12 16:14:21.757428+00'::timestamptz;

  if (select count(*) from public.items where company_id = v_company_id) <> 10
     or (select count(*) from public.warehouses where company_id = v_company_id) <> 1
     or (select count(*) from public.bins where company_id = v_company_id) <> 1
     or (select count(*) from public.boms where company_id = v_company_id) <> 2
     or (select count(*) from public.stock_levels where company_id = v_company_id) <> 7
     or (select count(*) from public.stock_movements where company_id = v_company_id) <> 27
     or (select count(*) from public.builds where company_id = v_company_id) <> 2
     or (select count(*) from public.purchase_orders where company_id = v_company_id) <> 3
     or (select count(*) from public.purchase_order_lines where company_id = v_company_id) <> 6
     or (select count(*) from public.purchase_orders where company_id = v_company_id and status::text = 'closed') <> 3
     or (select count(*) from public.sales_orders where company_id = v_company_id) <> 1
     or (select count(*) from public.sales_order_lines where company_id = v_company_id) <> 1
     or (select count(*) from public.sales_orders where company_id = v_company_id and status::text = 'shipped') <> 1
     or (select count(*) from public.sales_shipments where company_id = v_company_id) <> 1
     or (select count(*) from public.payment_receipts where company_id = v_company_id) <> 1
     or (select count(*) from public.cash_transactions where company_id = v_company_id) <> 1
     or (select count(*) from public.revenue_events where company_id = v_company_id) <> 1
     or (select count(*) from public.posting_requests where company_id = v_company_id) <> 17
     or (select count(*) from public.posting_requests where company_id = v_company_id and operation_type in ('assembly.build','operator.sale','purchase.receive','stock.adjustment','stock.issue','stock.receipt')) <> 17
     or (select count(*) from public.landed_cost_runs where company_id = v_company_id) <> 2
     or (select count(*) from public.landed_cost_run_lines where company_id = v_company_id) <> 4
     or (select count(*) from public.sales_invoices where company_id = v_company_id) <> 0
     or (select count(*) from public.vendor_bills where company_id = v_company_id) <> 0
     or (select count(*) from public.service_jobs where company_id = v_company_id) <> 0
     or (select count(*) from public.growth_batches where company_id = v_company_id) <> 0
     or (select count(*) from public.production_runs where company_id = v_company_id) <> 0
     or (select count(*) from public.inventory_movements where company_id = v_company_id) <> 0
     or (select count(*) from public.item_moving_average where company_id = v_company_id) <> 0
     or exists (
       select 1 from public.stock_movements
       where company_id = v_company_id
         and created_at > '2026-08-12 19:32:11.470959+00'::timestamptz
     )
  then
    raise exception 'Jofrice stock test cleanup guard: inspected test state changed; no rows were deleted.';
  end if;

  -- Controlled pre-go-live test-data correction. Any exception rolls back
  -- both data changes and the temporary trigger state changes.
  execute 'alter table public.payment_receipts disable trigger payment_receipts_immutable_update';
  execute 'alter table public.purchase_order_lines disable trigger biud_05_purchase_order_line_commercial_tax';
  execute 'alter table public.purchase_order_lines disable trigger aiud_90_purchase_order_line_tax_rollup';
  execute 'alter table public.sales_order_lines disable trigger biud_05_sales_order_line_commercial_tax';
  execute 'alter table public.sales_order_lines disable trigger aiud_90_sales_order_line_tax_rollup';

  delete from public.payment_receipts where company_id = v_company_id;
  delete from public.cash_transactions where company_id = v_company_id;
  delete from public.revenue_events where company_id = v_company_id;
  delete from public.sales_shipments where company_id = v_company_id;
  delete from public.stock_movements where company_id = v_company_id;
  delete from public.stock_levels where company_id = v_company_id;
  delete from public.item_moving_average where company_id = v_company_id;
  delete from public.inventory_movements where company_id = v_company_id;
  delete from public.builds where company_id = v_company_id;

  delete from public.landed_cost_run_lines where company_id = v_company_id;
  delete from public.landed_cost_runs where company_id = v_company_id;

  delete from public.purchase_order_lines where company_id = v_company_id;
  delete from public.purchase_orders where company_id = v_company_id;

  delete from public.sales_order_lines where company_id = v_company_id;
  delete from public.sales_orders where company_id = v_company_id;

  delete from public.posting_requests
  where company_id = v_company_id
    and operation_type in ('assembly.build','operator.sale','purchase.receive','stock.adjustment','stock.issue','stock.receipt');

  execute 'alter table public.payment_receipts enable trigger payment_receipts_immutable_update';
  execute 'alter table public.purchase_order_lines enable trigger biud_05_purchase_order_line_commercial_tax';
  execute 'alter table public.purchase_order_lines enable trigger aiud_90_purchase_order_line_tax_rollup';
  execute 'alter table public.sales_order_lines enable trigger biud_05_sales_order_line_commercial_tax';
  execute 'alter table public.sales_order_lines enable trigger aiud_90_sales_order_line_tax_rollup';

  if (select count(*) from public.stock_levels where company_id = v_company_id) <> 0
     or (select count(*) from public.stock_movements where company_id = v_company_id) <> 0
     or (select count(*) from public.builds where company_id = v_company_id) <> 0
     or (select count(*) from public.purchase_order_lines where company_id = v_company_id) <> 0
     or (select count(*) from public.purchase_orders where company_id = v_company_id) <> 0
     or (select count(*) from public.sales_order_lines where company_id = v_company_id) <> 0
     or (select count(*) from public.sales_orders where company_id = v_company_id) <> 0
     or (select count(*) from public.sales_shipments where company_id = v_company_id) <> 0
     or (select count(*) from public.payment_receipts where company_id = v_company_id) <> 0
     or (select count(*) from public.cash_transactions where company_id = v_company_id) <> 0
     or (select count(*) from public.revenue_events where company_id = v_company_id) <> 0
     or (select count(*) from public.posting_requests where company_id = v_company_id and operation_type in ('assembly.build','operator.sale','purchase.receive','stock.adjustment','stock.issue','stock.receipt')) <> 0
     or (select count(*) from public.landed_cost_runs where company_id = v_company_id) <> 0
     or (select count(*) from public.landed_cost_run_lines where company_id = v_company_id) <> 0
  then
    raise exception 'Jofrice stock test cleanup verification failed; transaction rolled back.';
  end if;

  if (select count(*) from public.items where company_id = v_company_id) <> 10
     or (select count(*) from public.warehouses where company_id = v_company_id) <> 1
     or (select count(*) from public.bins where company_id = v_company_id) <> 1
     or (select count(*) from public.boms where company_id = v_company_id) <> 2
  then
    raise exception 'Jofrice stock test cleanup master-data guard failed; transaction rolled back.';
  end if;
end
$$;
