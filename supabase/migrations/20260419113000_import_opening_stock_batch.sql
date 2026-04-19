create or replace function public.import_opening_stock_batch(
  p_company_id uuid,
  p_rows jsonb default '[]'::jsonb
)
returns table (
  imported_rows integer,
  bucket_count integer,
  total_qty_base numeric
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_active_company uuid := public.active_company_id();
  v_member_role public.member_role;
  v_invalid record;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'Select a company before importing opening stock.' using errcode = 'P0001';
  end if;

  if v_active_company is null or v_active_company <> p_company_id then
    raise exception 'Switch into the target company before importing opening stock.' using errcode = '42501';
  end if;

  select cm.role
    into v_member_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = v_user
    and cm.status = 'active'::public.member_status
  limit 1;

  if v_member_role is null then
    raise exception 'You do not have access to import opening stock in this company.' using errcode = '42501';
  end if;

  if v_member_role not in (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) then
    raise exception 'Only operators and above can import opening stock.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one opening-stock row before importing.' using errcode = 'P0001';
  end if;

  create temporary table tmp_opening_stock_rows (
    row_no integer not null,
    item_id uuid,
    uom_id uuid,
    qty numeric,
    qty_base numeric,
    unit_cost numeric,
    total_value numeric,
    warehouse_to_id uuid,
    bin_to_id text,
    notes text
  ) on commit drop;

  insert into tmp_opening_stock_rows (
    row_no,
    item_id,
    uom_id,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id,
    bin_to_id,
    notes
  )
  select
    ordinality::integer,
    nullif(trim(row_data ->> 'item_id'), '')::uuid,
    nullif(trim(row_data ->> 'uom_id'), '')::uuid,
    coalesce(nullif(trim(row_data ->> 'qty'), '')::numeric, 0),
    coalesce(nullif(trim(row_data ->> 'qty_base'), '')::numeric, 0),
    greatest(coalesce(nullif(trim(row_data ->> 'unit_cost'), '')::numeric, 0), 0),
    greatest(coalesce(nullif(trim(row_data ->> 'total_value'), '')::numeric, 0), 0),
    nullif(trim(row_data ->> 'warehouse_to_id'), '')::uuid,
    nullif(trim(row_data ->> 'bin_to_id'), ''),
    nullif(trim(row_data ->> 'notes'), '')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as rows(row_data, ordinality);

  select *
    into v_invalid
  from tmp_opening_stock_rows r
  where r.item_id is null
     or r.uom_id is null
     or r.warehouse_to_id is null
     or r.bin_to_id is null
     or coalesce(r.qty, 0) <= 0
     or coalesce(r.qty_base, 0) <= 0
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % is incomplete. Recheck the imported item, UOM, location, and quantity.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.item_id
    into v_invalid
  from tmp_opening_stock_rows r
  left join public.items i
    on i.id = r.item_id
   and i.company_id = p_company_id
  where i.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references an item that does not belong to this company.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.uom_id
    into v_invalid
  from tmp_opening_stock_rows r
  left join public.uoms u
    on u.id = r.uom_id
  where u.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a unit of measure that does not exist.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.warehouse_to_id
    into v_invalid
  from tmp_opening_stock_rows r
  left join public.warehouses w
    on w.id = r.warehouse_to_id
   and w.company_id = p_company_id
  where w.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a warehouse that does not belong to this company.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.bin_to_id
    into v_invalid
  from tmp_opening_stock_rows r
  left join public.bins b
    on b.id = r.bin_to_id
   and b.company_id = p_company_id
   and b."warehouseId" = r.warehouse_to_id
  where b.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a bin that does not belong to the selected warehouse.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  create temporary table tmp_opening_stock_baseline (
    item_id uuid not null,
    warehouse_id uuid not null,
    bin_id text not null,
    qty numeric not null,
    avg_cost numeric not null,
    allocated_qty numeric not null
  ) on commit drop;

  insert into tmp_opening_stock_baseline (
    item_id,
    warehouse_id,
    bin_id,
    qty,
    avg_cost,
    allocated_qty
  )
  select
    buckets.item_id,
    buckets.warehouse_to_id,
    buckets.bin_to_id,
    coalesce(sl.qty, 0),
    coalesce(sl.avg_cost, 0),
    coalesce(sl.allocated_qty, 0)
  from (
    select distinct
      r.item_id,
      r.warehouse_to_id,
      r.bin_to_id
    from tmp_opening_stock_rows r
  ) buckets
  left join public.stock_levels sl
    on sl.company_id = p_company_id
   and sl.item_id = buckets.item_id
   and sl.warehouse_id = buckets.warehouse_to_id
   and sl.bin_id = buckets.bin_to_id;

  insert into public.stock_movements (
    company_id,
    type,
    item_id,
    uom_id,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id,
    bin_to_id,
    notes,
    created_by,
    ref_type,
    ref_id,
    ref_line_id
  )
  select
    p_company_id,
    'receive',
    r.item_id,
    r.uom_id,
    r.qty,
    r.qty_base,
    r.unit_cost,
    case
      when r.total_value > 0 then r.total_value
      else round(r.qty_base * r.unit_cost, 2)
    end,
    r.warehouse_to_id,
    r.bin_to_id,
    coalesce(r.notes, 'Stock inicial'),
    v_user,
    'ADJUST',
    null,
    null
  from tmp_opening_stock_rows r
  order by r.row_no;

  get diagnostics imported_rows = row_count;

  with grouped as (
    select
      r.item_id,
      r.warehouse_to_id as warehouse_id,
      r.bin_to_id as bin_id,
      round(sum(r.qty_base), 6) as incoming_qty,
      round(sum(
        case
          when r.total_value > 0 then r.total_value
          else r.qty_base * r.unit_cost
        end
      ), 6) as incoming_value
    from tmp_opening_stock_rows r
    group by r.item_id, r.warehouse_to_id, r.bin_to_id
  )
  insert into public.stock_levels (
    company_id,
    item_id,
    warehouse_id,
    bin_id,
    qty,
    avg_cost,
    allocated_qty
  )
  select
    p_company_id,
    g.item_id,
    g.warehouse_id,
    g.bin_id,
    round(coalesce(b.qty, 0) + g.incoming_qty, 6),
    case
      when coalesce(b.qty, 0) + g.incoming_qty > 0 then
        round(
          ((coalesce(b.qty, 0) * coalesce(b.avg_cost, 0)) + g.incoming_value)
          / (coalesce(b.qty, 0) + g.incoming_qty),
          6
        )
      else 0
    end,
    coalesce(b.allocated_qty, 0)
  from grouped g
  left join tmp_opening_stock_baseline b
    on b.item_id = g.item_id
   and b.warehouse_id = g.warehouse_id
   and b.bin_id = g.bin_id
  on conflict (company_id, item_id, warehouse_id, bin_id) do update
    set qty = excluded.qty,
        avg_cost = excluded.avg_cost,
        allocated_qty = excluded.allocated_qty,
        updated_at = now();

  get diagnostics bucket_count = row_count;

  select round(coalesce(sum(r.qty_base), 0), 6)
    into total_qty_base
  from tmp_opening_stock_rows r;

  return next;
end;
$$;

grant execute on function public.import_opening_stock_batch(uuid, jsonb) to authenticated;
grant execute on function public.import_opening_stock_batch(uuid, jsonb) to service_role;
