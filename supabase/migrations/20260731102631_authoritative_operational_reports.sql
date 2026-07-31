-- OPS-1: one authenticated, company-scoped reporting surface. React selects a
-- report and receives only that report's server-aggregated result.

create or replace function public.get_operational_report(
  p_company_id uuid,
  p_report_code text,
  p_start_date date,
  p_end_date date,
  p_warehouse_id uuid default null,
  p_customer_id uuid default null,
  p_include_cash boolean default true,
  p_slow_days integer default 90
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code text := lower(nullif(btrim(coalesce(p_report_code,'')),''));
  v_result jsonb;
  v_days integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_company_id is null or p_company_id is distinct from public.current_company_id()
     or not public.member_has_company_access(p_company_id,false) then
    raise exception 'company_access_denied' using errcode='42501';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'invalid_report_period' using errcode='22007';
  end if;
  if p_warehouse_id is not null and not exists (
    select 1 from public.warehouses w where w.id=p_warehouse_id and w.company_id=p_company_id
  ) then raise exception 'warehouse_access_denied' using errcode='42501'; end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id=p_customer_id and c.company_id=p_company_id
  ) then raise exception 'customer_access_denied' using errcode='42501'; end if;
  v_days := greatest(coalesce(p_slow_days,90),1);

  if v_code = 'performance' then
    return public.get_owner_dashboard(
      p_company_id,p_start_date,p_end_date,
      p_start_date-(p_end_date-p_start_date+1),p_start_date-1,p_warehouse_id
    );
  elsif v_code = 'product-profitability' then
    v_result := public.get_owner_dashboard(
      p_company_id,p_start_date,p_end_date,
      p_start_date-(p_end_date-p_start_date+1),p_start_date-1,p_warehouse_id
    );
    return jsonb_build_object('rows',v_result->'products','summary',v_result->'summary');
  elsif v_code = 'inventory-valuation' then
    select jsonb_build_object(
      'asOf',now(),'rows',coalesce(jsonb_agg(jsonb_build_object(
        'itemId',i.id,'item',i.name,'sku',i.sku,'warehouseId',w.id,'warehouse',w.name,
        'binId',b.id,'bin',b.name,'quantity',sl.qty,'uom',i.base_uom_id,
        'weightedAverageCost',sl.avg_cost,'inventoryValue',case when sl.avg_cost is null then null else sl.qty*sl.avg_cost end,
        'missingCost',sl.qty<>0 and sl.avg_cost is null
      ) order by i.name,w.name,b.name),'[]'::jsonb)) into v_result
    from public.stock_levels sl
    join public.items i on i.id=sl.item_id and i.company_id=sl.company_id
    join public.warehouses w on w.id=sl.warehouse_id and w.company_id=sl.company_id
    left join public.bins b on b.id=sl.bin_id and b.company_id=sl.company_id
    where sl.company_id=p_company_id and (p_warehouse_id is null or sl.warehouse_id=p_warehouse_id);
    return v_result;
  elsif v_code = 'stock-movement-ledger' then
    select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object(
      'id',sm.id,'occurredAt',sm.created_at,'movementKind',sm.type,'item',i.name,'sku',i.sku,
      'quantity',sm.qty,'baseQuantity',sm.qty_base,'uom',sm.uom_id,
      'warehouseFrom',wf.name,'binFrom',bf.name,'warehouseTo',wt.name,'binTo',bt.name,
      'unitCost',sm.unit_cost,'totalCost',sm.total_value,'referenceType',sm.ref_type,
      'reference',coalesce(so.order_no,po.order_no,sm.ref_type),'actor',p.full_name
    ) order by sm.created_at desc,sm.id desc),'[]'::jsonb)) into v_result
    from public.stock_movements sm
    join public.items i on i.id=sm.item_id and i.company_id=sm.company_id
    left join public.warehouses wf on wf.id=sm.warehouse_from_id
    left join public.warehouses wt on wt.id=sm.warehouse_to_id
    left join public.bins bf on bf.id=sm.bin_from_id
    left join public.bins bt on bt.id=sm.bin_to_id
    left join public.sales_orders so on sm.ref_type='SO' and so.id=sm.ref_id
    left join public.purchase_orders po on sm.ref_type='PO' and po.id=sm.ref_id
    left join public.profiles p on p.id=sm.created_by
    where sm.company_id=p_company_id and sm.created_at::date between p_start_date and p_end_date
      and (p_warehouse_id is null or sm.warehouse_from_id=p_warehouse_id or sm.warehouse_to_id=p_warehouse_id);
    return v_result;
  elsif v_code = 'inventory-ageing' then
    with last_out as (
      select sm.item_id,sm.warehouse_from_id warehouse_id,max(sm.created_at) last_movement
      from public.stock_movements sm where sm.company_id=p_company_id and sm.qty_base<0
      group by sm.item_id,sm.warehouse_from_id
    )
    select jsonb_build_object('thresholdDays',v_days,'rows',coalesce(jsonb_agg(jsonb_build_object(
      'itemId',i.id,'item',i.name,'sku',i.sku,'warehouseId',w.id,'warehouse',w.name,
      'lastSaleOrIssueAt',lo.last_movement,'daysWithoutMovement',coalesce(current_date-lo.last_movement::date,current_date-i.created_at::date),
      'quantity',sum(sl.qty),'inventoryValue',case when count(*) filter(where sl.qty<>0 and sl.avg_cost is null)>0 then null else sum(sl.qty*sl.avg_cost) end,
      'slowMoving',coalesce(current_date-lo.last_movement::date,current_date-i.created_at::date)>=v_days,
      'stockStatus',case when sum(sl.qty)<=0 then 'out_of_stock' when i.min_stock is not null and sum(sl.qty)<=i.min_stock then 'low_stock' else 'in_stock' end
    ) order by coalesce(lo.last_movement,i.created_at)),'[]'::jsonb)) into v_result
    from public.stock_levels sl join public.items i on i.id=sl.item_id and i.company_id=sl.company_id
    join public.warehouses w on w.id=sl.warehouse_id left join last_out lo on lo.item_id=sl.item_id and lo.warehouse_id=sl.warehouse_id
    where sl.company_id=p_company_id and (p_warehouse_id is null or sl.warehouse_id=p_warehouse_id)
    group by i.id,w.id,lo.last_movement;
    return v_result;
  elsif v_code = 'customer-location' then
    with order_facts as (
      select so.id,so.customer_id,coalesce(c.name,so.bill_to_name,'Walk-in / cash customer') customer,
        coalesce(c.billing_address,c.shipping_address,'No location') customer_location,
        coalesce(w.name,'No location') operational_location,
        coalesce(max(ss.created_at),so.shipped_at) completed_at,
        coalesce(so.total_amount,so.total,0)*coalesce(so.fx_to_base,1) sales,
        coalesce(sum(abs(coalesce(sm.total_value,sm.unit_cost*ss.qty_base))),0) known_cogs,
        count(ss.id) filter(where coalesce(sm.total_value,sm.unit_cost*ss.qty_base) is null) missing_cost,
        coalesce(c.is_cash,true) is_cash
      from public.sales_orders so left join public.customers c on c.id=so.customer_id and c.company_id=so.company_id
      left join public.sales_shipments ss on ss.so_id=so.id and ss.company_id=so.company_id
      left join public.stock_movements sm on sm.id=ss.movement_id and sm.company_id=so.company_id
      left join public.warehouses w on w.id=sm.warehouse_from_id
      where so.company_id=p_company_id and lower(so.status::text) in ('shipped','closed')
        and (p_customer_id is null or so.customer_id=p_customer_id)
        and (p_include_cash or not coalesce(c.is_cash,true))
        and (p_warehouse_id is null or sm.warehouse_from_id=p_warehouse_id)
      group by so.id,c.id,w.id
    ), grouped as (
      select customer_id,customer,customer_location,operational_location,is_cash,
        count(*) transactions,sum(sales) operational_sales,sum(known_cogs) known_cogs,sum(missing_cost) missing_cost_count,
        max(completed_at) last_completed_purchase
      from order_facts where completed_at::date between p_start_date and p_end_date
      group by customer_id,customer,customer_location,operational_location,is_cash
    )
    select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object(
      'customerId',customer_id,'customer',customer,'customerLocation',customer_location,'operationalLocation',operational_location,
      'cashActivity',is_cash,'transactions',transactions,'operationalSales',operational_sales,'knownCogs',known_cogs,
      'grossProfit',case when missing_cost_count=0 then operational_sales-known_cogs end,
      'grossMargin',case when missing_cost_count=0 and operational_sales<>0 then (operational_sales-known_cogs)/operational_sales*100 end,
      'missingCostCount',missing_cost_count,'outstandingBalance',null,'overdueBalance',null,'lastCompletedPurchase',last_completed_purchase
    ) order by operational_sales desc),'[]'::jsonb)) into v_result from grouped;
    return v_result;
  elsif v_code = 'supplier-payables' then
    with bills as (
      select s.id supplier_id,s.name supplier,coalesce(s.notes,'No location') supplier_location,
        sum(vb.total_amount*coalesce(vb.fx_to_base,1)) vendor_bill_value,
        max(vb.bill_date) last_bill_date,
        sum(case when vb.due_date<current_date then vb.total_amount*coalesce(vb.fx_to_base,1) else 0 end) overdue_amount
      from public.vendor_bills vb join public.suppliers s on s.id=vb.supplier_id and s.company_id=vb.company_id
      where vb.company_id=p_company_id and vb.document_workflow_status='posted' and vb.bill_date between p_start_date and p_end_date
      group by s.id
    ), commitments as (
      select po.supplier_id,sum(coalesce(po.total_amount,po.total,0)*coalesce(po.fx_to_base,1)) purchase_order_value
      from public.purchase_orders po where po.company_id=p_company_id and po.order_date between p_start_date and p_end_date group by po.supplier_id
    )
    select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object(
      'supplierId',b.supplier_id,'supplier',b.supplier,'supplierLocation',b.supplier_location,
      'vendorBillValue',b.vendor_bill_value,'paidAmount',null,'outstandingAmount',null,'overdueAmount',b.overdue_amount,
      'lastBillDate',b.last_bill_date,'purchaseOrderValue',coalesce(c.purchase_order_value,0)
    ) order by b.vendor_bill_value desc),'[]'::jsonb)) into v_result from bills b left join commitments c using(supplier_id);
    return v_result;
  elsif v_code = 'service-job-profitability' then
    select jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object(
      'serviceJobId',sj.id,'serviceJob',sj.job_reference,'customer',coalesce(c.name,'Walk-in / cash customer'),
      'service',sj.title,'completionDate',sj.actual_completion,'materials',sj.material_cost,'labour',sj.labour_cost,
      'subcontractors',sj.subcontractor_cost,'supplierAllocations',sj.supplier_cost,'otherDirectCost',sj.other_direct_cost,
      'totalActualCost',case when sj.costing_status='finalised' then sj.total_actual_cost end,
      'operationalSales',(select sum(sol.line_total*coalesce(so.fx_to_base,1)) from public.service_job_lines sjl join public.sales_order_lines sol on sol.id=sjl.sales_order_line_id join public.sales_orders so on so.id=sj.sales_order_id where sjl.service_job_id=sj.id and sjl.active_link),
      'grossProfit',case when sj.costing_status='finalised' then (select sum(sol.line_total*coalesce(so.fx_to_base,1)) from public.service_job_lines sjl join public.sales_order_lines sol on sol.id=sjl.sales_order_line_id join public.sales_orders so on so.id=sj.sales_order_id where sjl.service_job_id=sj.id and sjl.active_link)-sj.total_actual_cost end,
      'costingState',sj.costing_status
    ) order by sj.actual_completion desc),'[]'::jsonb)) into v_result
    from public.service_jobs sj left join public.customers c on c.id=sj.customer_id
    where sj.company_id=p_company_id and sj.execution_status='completed' and sj.actual_completion::date between p_start_date and p_end_date;
    return v_result;
  elsif v_code = 'order-fulfilment' then
    select jsonb_build_object(
      'submitted',count(*) filter(where lower(status::text)='submitted'),
      'confirmed',count(*) filter(where lower(status::text)='confirmed'),
      'allocated',count(*) filter(where lower(status::text)='allocated'),
      'shippedCompleted',count(*) filter(where lower(status::text)='shipped'),
      'closed',count(*) filter(where lower(status::text)='closed'),
      'cancelled',count(*) filter(where lower(status::text)='cancelled'),
      'openBacklog',count(*) filter(where lower(status::text) in ('submitted','confirmed','allocated')),
      'completionRate',case when count(*) filter(where lower(status::text)<>'draft')>0 then count(*) filter(where lower(status::text) in ('shipped','closed'))::numeric/count(*) filter(where lower(status::text)<>'draft')*100 end,
      'averageFulfilmentDays',avg(extract(epoch from (coalesce(shipped_at,updated_at)-created_at))/86400) filter(where lower(status::text) in ('shipped','closed')),
      'overdueOrders',count(*) filter(where due_date<current_date and lower(status::text) not in ('shipped','closed','cancelled'))
    ) into v_result from public.sales_orders where company_id=p_company_id and order_date between p_start_date and p_end_date;
    return v_result;
  end if;
  raise exception 'unsupported_report_code' using errcode='22023';
end;
$$;

alter function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) owner to postgres;
revoke all on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) from public,anon;
grant execute on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) to authenticated;
comment on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) is
  'Authoritative OPS-1 report catalogue. Performance and product results reuse the owner-dashboard RPC; all other results aggregate server-side without client row limits.';
