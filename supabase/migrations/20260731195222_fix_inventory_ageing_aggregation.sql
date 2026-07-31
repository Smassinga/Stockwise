alter function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer)
  rename to get_operational_report_ops1_base;

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
set search_path = pg_catalog, public
as $$
declare
  v_code text := lower(nullif(btrim(coalesce(p_report_code, '')), ''));
  v_result jsonb;
  v_days integer := greatest(coalesce(p_slow_days, 90), 1);
begin
  if v_code <> 'inventory-ageing' then
    return public.get_operational_report_ops1_base(
      p_company_id,
      p_report_code,
      p_start_date,
      p_end_date,
      p_warehouse_id,
      p_customer_id,
      p_include_cash,
      p_slow_days
    );
  end if;

  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_company_id is null
     or p_company_id is distinct from public.current_company_id()
     or not public.member_has_company_access(p_company_id, false) then
    raise exception 'company_access_denied' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'invalid_report_period' using errcode = '22007';
  end if;
  if p_warehouse_id is not null and not exists (
    select 1
    from public.warehouses w
    where w.id = p_warehouse_id and w.company_id = p_company_id
  ) then
    raise exception 'warehouse_access_denied' using errcode = '42501';
  end if;

  with last_out as (
    select
      sm.item_id,
      sm.warehouse_from_id as warehouse_id,
      max(sm.created_at) as last_movement
    from public.stock_movements sm
    where sm.company_id = p_company_id and sm.qty_base < 0
    group by sm.item_id, sm.warehouse_from_id
  ), ageing_rows as (
    select
      i.id as item_id,
      i.name as item,
      i.sku,
      w.id as warehouse_id,
      w.name as warehouse,
      lo.last_movement,
      coalesce(current_date - lo.last_movement::date, current_date - i.created_at::date) as days_without_movement,
      sum(sl.qty) as quantity,
      case
        when count(*) filter (where sl.qty <> 0 and sl.avg_cost is null) > 0 then null
        else sum(sl.qty * sl.avg_cost)
      end as inventory_value,
      coalesce(current_date - lo.last_movement::date, current_date - i.created_at::date) >= v_days as slow_moving,
      case
        when sum(sl.qty) <= 0 then 'out_of_stock'
        when i.min_stock is not null and sum(sl.qty) <= i.min_stock then 'low_stock'
        else 'in_stock'
      end as stock_status,
      i.created_at
    from public.stock_levels sl
    join public.items i on i.id = sl.item_id and i.company_id = sl.company_id
    join public.warehouses w on w.id = sl.warehouse_id
    left join last_out lo on lo.item_id = sl.item_id and lo.warehouse_id = sl.warehouse_id
    where sl.company_id = p_company_id
      and (p_warehouse_id is null or sl.warehouse_id = p_warehouse_id)
    group by i.id, w.id, lo.last_movement
  )
  select jsonb_build_object(
    'thresholdDays', v_days,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'itemId', item_id,
      'item', item,
      'sku', sku,
      'warehouseId', warehouse_id,
      'warehouse', warehouse,
      'lastSaleOrIssueAt', last_movement,
      'daysWithoutMovement', days_without_movement,
      'quantity', quantity,
      'inventoryValue', inventory_value,
      'slowMoving', slow_moving,
      'stockStatus', stock_status
    ) order by coalesce(last_movement, created_at)), '[]'::jsonb)
  ) into v_result
  from ageing_rows;

  return v_result;
end;
$$;

alter function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) owner to postgres;
revoke all on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) from public, anon;
grant execute on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) to authenticated;

revoke all on function public.get_operational_report_ops1_base(uuid,text,date,date,uuid,uuid,boolean,integer) from public, anon;
grant execute on function public.get_operational_report_ops1_base(uuid,text,date,date,uuid,uuid,boolean,integer) to authenticated;

comment on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) is
  'Authoritative OPS-1 report catalogue wrapper. Inventory ageing aggregates stock rows before JSON rendering; other reports delegate to the maintained OPS-1 implementation.';
