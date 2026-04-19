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
  v_row record;
  v_updated_bucket_count integer := 0;
  v_inserted_bucket_count integer := 0;
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

  create temporary table tmp_opening_stock_rows_raw (
    row_no integer not null,
    item_id_text text,
    uom_id_text text,
    qty numeric,
    qty_base numeric,
    unit_cost numeric,
    total_value numeric,
    warehouse_to_id_text text,
    bin_to_id text,
    notes text
  ) on commit drop;

  insert into tmp_opening_stock_rows_raw (
    row_no,
    item_id_text,
    uom_id_text,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id_text,
    bin_to_id,
    notes
  )
  select
    ordinality::integer,
    nullif(trim(row_data ->> 'item_id'), ''),
    nullif(trim(row_data ->> 'uom_id'), ''),
    coalesce(nullif(trim(row_data ->> 'qty'), '')::numeric, 0),
    coalesce(nullif(trim(row_data ->> 'qty_base'), '')::numeric, 0),
    greatest(coalesce(nullif(trim(row_data ->> 'unit_cost'), '')::numeric, 0), 0),
    greatest(coalesce(nullif(trim(row_data ->> 'total_value'), '')::numeric, 0), 0),
    nullif(trim(row_data ->> 'warehouse_to_id'), ''),
    nullif(trim(row_data ->> 'bin_to_id'), ''),
    nullif(trim(row_data ->> 'notes'), '')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as rows(row_data, ordinality);

  select *
    into v_invalid
  from tmp_opening_stock_rows_raw r
  where r.item_id_text is null
     or r.uom_id_text is null
     or r.warehouse_to_id_text is null
     or r.bin_to_id is null
     or coalesce(r.qty, 0) <= 0
     or coalesce(r.qty_base, 0) <= 0
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % is incomplete. Recheck the imported item, UOM, location, and quantity.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.item_id_text
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.items i
    on i.id::text = r.item_id_text
   and i.company_id = p_company_id
  where i.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references an item that does not belong to this company.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.uom_id_text
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.uoms u
    on u.id::text = r.uom_id_text
  where u.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a unit of measure that does not exist.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  select r.row_no, r.warehouse_to_id_text
    into v_invalid
  from tmp_opening_stock_rows_raw r
  left join public.warehouses w
    on w.id::text = r.warehouse_to_id_text
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
  from tmp_opening_stock_rows_raw r
  left join public.bins b
    on b.id::text = r.bin_to_id
   and b.company_id = p_company_id
   and b."warehouseId"::text = r.warehouse_to_id_text
  where b.id is null
  order by r.row_no
  limit 1;

  if found then
    raise exception 'Opening-stock row % references a bin that does not belong to the selected warehouse.', v_invalid.row_no
      using errcode = 'P0001';
  end if;

  create temporary table tmp_opening_stock_rows (
    row_no integer not null,
    item_id uuid not null,
    uom_id uuid not null,
    qty numeric not null,
    qty_base numeric not null,
    unit_cost numeric not null,
    total_value numeric not null,
    warehouse_to_id uuid not null,
    bin_to_id text not null,
    notes text not null
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
    r.row_no,
    r.item_id_text::uuid,
    r.uom_id_text::uuid,
    r.qty,
    r.qty_base,
    r.unit_cost,
    case
      when r.total_value > 0 then r.total_value
      else round(r.qty_base * r.unit_cost, 2)
    end,
    r.warehouse_to_id_text::uuid,
    r.bin_to_id,
    coalesce(r.notes, 'Stock inicial')
  from tmp_opening_stock_rows_raw r;

  create temporary table tmp_opening_stock_baseline (
    item_id uuid not null,
    warehouse_key text not null,
    bin_key text not null,
    qty numeric not null,
    avg_cost numeric not null,
    allocated_qty numeric not null
  ) on commit drop;

  insert into tmp_opening_stock_baseline (
    item_id,
    warehouse_key,
    bin_key,
    qty,
    avg_cost,
    allocated_qty
  )
  select
    buckets.item_id,
    buckets.warehouse_to_id::text,
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
   and sl.warehouse_id::text = buckets.warehouse_to_id::text
   and sl.bin_id::text = buckets.bin_to_id;

  imported_rows := 0;

  for v_row in
    select *
    from tmp_opening_stock_rows
    order by row_no
  loop
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
    values (
      p_company_id,
      'receive',
      v_row.item_id,
      v_row.uom_id,
      v_row.qty,
      v_row.qty_base,
      v_row.unit_cost,
      v_row.total_value,
      v_row.warehouse_to_id,
      v_row.bin_to_id,
      v_row.notes,
      v_user,
      'ADJUST',
      null,
      null
    );

    imported_rows := imported_rows + 1;
  end loop;

  create temporary table tmp_opening_stock_final_levels (
    item_id uuid not null,
    warehouse_to_id uuid not null,
    bin_to_id text not null,
    final_qty numeric not null,
    final_avg_cost numeric not null,
    allocated_qty numeric not null
  ) on commit drop;

  insert into tmp_opening_stock_final_levels (
    item_id,
    warehouse_to_id,
    bin_to_id,
    final_qty,
    final_avg_cost,
    allocated_qty
  )
  select
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    round(coalesce(b.qty, 0) + sum(r.qty_base), 6),
    case
      when coalesce(b.qty, 0) + sum(r.qty_base) > 0 then
        round(
          ((coalesce(b.qty, 0) * coalesce(b.avg_cost, 0)) + sum(r.total_value))
          / (coalesce(b.qty, 0) + sum(r.qty_base)),
          6
        )
      else 0
    end,
    coalesce(b.allocated_qty, 0)
  from tmp_opening_stock_rows r
  left join tmp_opening_stock_baseline b
    on b.item_id = r.item_id
   and b.warehouse_key = r.warehouse_to_id::text
   and b.bin_key = r.bin_to_id
  group by
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    b.qty,
    b.avg_cost,
    b.allocated_qty;

  update public.stock_levels sl
     set qty = f.final_qty,
         avg_cost = f.final_avg_cost,
         allocated_qty = f.allocated_qty,
         updated_at = now()
  from tmp_opening_stock_final_levels f
  where sl.company_id = p_company_id
    and sl.item_id = f.item_id
    and sl.warehouse_id::text = f.warehouse_to_id::text
    and sl.bin_id::text = f.bin_to_id;

  get diagnostics v_updated_bucket_count = row_count;

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
    f.item_id,
    f.warehouse_to_id,
    f.bin_to_id,
    f.final_qty,
    f.final_avg_cost,
    f.allocated_qty
  from tmp_opening_stock_final_levels f
  where not exists (
    select 1
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = f.item_id
      and sl.warehouse_id::text = f.warehouse_to_id::text
      and sl.bin_id::text = f.bin_to_id
  );

  get diagnostics v_inserted_bucket_count = row_count;
  bucket_count := v_updated_bucket_count + v_inserted_bucket_count;

  select round(coalesce(sum(r.qty_base), 0), 6)
    into total_qty_base
  from tmp_opening_stock_rows r;

  return next;
end;
$$;

grant execute on function public.import_opening_stock_batch(uuid, jsonb) to authenticated;
grant execute on function public.import_opening_stock_batch(uuid, jsonb) to service_role;
