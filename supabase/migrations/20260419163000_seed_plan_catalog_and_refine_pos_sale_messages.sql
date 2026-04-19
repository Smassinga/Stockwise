insert into public.plan_catalog (
  code,
  display_name,
  monthly_price_mzn,
  six_month_price_mzn,
  annual_price_mzn,
  onboarding_fee_mzn,
  starting_price_mzn,
  trial_days,
  sort_order,
  is_public,
  manual_activation_only
)
values
  ('trial_7d', '7-day Trial', null, null, null, null, null, 7, 0, false, true),
  ('starter', 'Starter', 2001, 11385, 20010, 5175, null, 0, 10, true, true),
  ('growth', 'Growth', 3381, 19251, 33810, 10350, null, 0, 20, true, true),
  ('business', 'Business', 5451, 31050, 54510, 17250, null, 0, 30, true, true),
  ('managed_business_plus', 'Managed Business+', null, null, 82800, null, 82800, 0, 40, true, true),
  ('legacy_manual', 'Legacy Manual Access', null, null, null, null, null, 0, 90, false, true)
on conflict (code) do update
set
  display_name = excluded.display_name,
  monthly_price_mzn = excluded.monthly_price_mzn,
  six_month_price_mzn = excluded.six_month_price_mzn,
  annual_price_mzn = excluded.annual_price_mzn,
  onboarding_fee_mzn = excluded.onboarding_fee_mzn,
  starting_price_mzn = excluded.starting_price_mzn,
  trial_days = excluded.trial_days,
  sort_order = excluded.sort_order,
  is_public = excluded.is_public,
  manual_activation_only = excluded.manual_activation_only,
  updated_at = timezone('utc', now());


create or replace function public.create_operator_sale_issue(
  p_company_id uuid,
  p_bin_from_id text,
  p_customer_id uuid default null,
  p_order_date date default current_date,
  p_currency_code text default 'MZN',
  p_fx_to_base numeric default 1,
  p_reference_no text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb
)
returns table(
  sales_order_id uuid,
  order_no text,
  customer_id uuid,
  customer_name text,
  line_count integer,
  total_amount numeric
)
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_active_company uuid := public.active_company_id();
  v_member_role public.member_role;
  v_source_bin record;
  v_customer record;
  v_line record;
  v_item record;
  v_so_id uuid;
  v_order_no text;
  v_so_line_id uuid;
  v_subtotal numeric := 0;
  v_line_total numeric := 0;
  v_line_qty numeric := 0;
  v_line_price numeric := 0;
  v_available_qty numeric := 0;
  v_line_cost numeric := 0;
  v_line_count integer := 0;
  v_normalized_currency text := upper(coalesce(nullif(trim(p_currency_code), ''), 'MZN'));
  v_fx_to_base numeric := case when coalesce(p_fx_to_base, 0) > 0 then p_fx_to_base else 1 end;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'Select a company before posting the sale.' using errcode = 'P0001';
  end if;

  if v_active_company is null or v_active_company <> p_company_id then
    raise exception 'Switch into the target company before posting the sale.' using errcode = '42501';
  end if;

  select cm.role
    into v_member_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = v_user
    and cm.status = 'active'::public.member_status
  limit 1;

  if v_member_role is null then
    raise exception 'You do not have access to post Point of Sale sales in this company.' using errcode = '42501';
  end if;

  if v_member_role not in (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) then
    raise exception 'Only operators and above can post sales from Point of Sale.' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before posting the sale.' using errcode = 'P0001';
  end if;

  select
    b.id,
    b.code,
    b.name,
    b."warehouseId" as warehouse_id,
    w.name as warehouse_name
    into v_source_bin
  from public.bins b
  join public.warehouses w
    on w.id = b."warehouseId"
   and w.company_id = p_company_id
  where b.id = p_bin_from_id
    and b.company_id = p_company_id
  limit 1;

  if v_source_bin.id is null then
    raise exception 'Choose a valid source bin before posting the sale.' using errcode = 'P0001';
  end if;

  if p_customer_id is null then
    insert into public.customers (
      company_id,
      code,
      name,
      is_cash
    )
    values (
      p_company_id,
      'CASH',
      'Cash Customer',
      true
    )
    on conflict (company_id, code) do update
      set
        name = public.customers.name,
        is_cash = true
    returning id, name, email, tax_id, billing_address, shipping_address, is_cash
      into v_customer;
  else
    select
      c.id,
      c.name,
      c.email,
      c.tax_id,
      c.billing_address,
      c.shipping_address
      into v_customer
    from public.customers c
    where c.company_id = p_company_id
      and c.id = p_customer_id
    limit 1;

    if v_customer.id is null then
      raise exception 'The selected customer does not belong to this company.' using errcode = 'P0001';
    end if;
  end if;

  for v_line in
    select ordinality::integer as line_no, value as line_data
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality
  loop
    select
      i.id,
      i.name,
      i.sku,
      i.base_uom_id,
      coalesce(i.unit_price, 0) as default_unit_price,
      coalesce(i.track_inventory, true) as track_inventory,
      coalesce(i.can_sell, true) as can_sell
      into v_item
    from public.items i
    where i.company_id = p_company_id
      and i.id = nullif(trim(v_line.line_data ->> 'item_id'), '')::uuid
    limit 1;

    if v_item.id is null then
      raise exception 'Point of Sale line % references an unknown item.', v_line.line_no using errcode = 'P0001';
    end if;

    if coalesce(v_item.track_inventory, false) = false then
      raise exception 'Point of Sale line % uses an item that is not tracked in stock.', v_line.line_no using errcode = 'P0001';
    end if;

    if coalesce(v_item.can_sell, false) = false then
      raise exception 'Point of Sale line % uses an item that is not marked for selling.', v_line.line_no using errcode = 'P0001';
    end if;

    v_line_qty := coalesce(nullif(trim(v_line.line_data ->> 'qty'), '')::numeric, 0);
    if v_line_qty <= 0 then
      raise exception 'Point of Sale line % needs a quantity above zero.', v_line.line_no using errcode = 'P0001';
    end if;

    v_line_price := coalesce(
      nullif(trim(v_line.line_data ->> 'unit_price'), '')::numeric,
      v_item.default_unit_price,
      0
    );
    if v_line_price < 0 then
      raise exception 'Point of Sale line % cannot use a negative sell price.', v_line.line_no using errcode = 'P0001';
    end if;

    select
      greatest(coalesce(sl.qty, 0) - coalesce(sl.allocated_qty, 0), 0),
      coalesce(sl.avg_cost, 0)
      into v_available_qty, v_line_cost
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = v_item.id
      and sl.warehouse_id = v_source_bin.warehouse_id
      and sl.bin_id = v_source_bin.id
    limit 1;

    if coalesce(v_available_qty, 0) < v_line_qty then
      raise exception 'Point of Sale line % does not have enough stock for %.', v_line.line_no, coalesce(v_item.name, v_item.sku, 'the selected item')
        using errcode = 'P0001';
    end if;

    v_line_total := round(v_line_qty * v_line_price, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_line_count := v_line_count + 1;
  end loop;

  insert into public.sales_orders (
    company_id,
    customer_id,
    customer,
    status,
    order_date,
    due_date,
    currency_code,
    fx_to_base,
    reference_no,
    notes,
    created_by,
    bill_to_name,
    bill_to_email,
    bill_to_tax_id,
    bill_to_billing_address,
    bill_to_shipping_address,
    subtotal,
    tax_total,
    total,
    total_amount
  )
  values (
    p_company_id,
    v_customer.id,
    v_customer.name,
    'shipped',
    coalesce(p_order_date, current_date),
    coalesce(p_order_date, current_date),
    v_normalized_currency,
    v_fx_to_base,
    nullif(trim(p_reference_no), ''),
    nullif(trim(p_notes), ''),
    v_user,
    v_customer.name,
    v_customer.email,
    v_customer.tax_id,
    v_customer.billing_address,
    v_customer.shipping_address,
    round(v_subtotal, 2),
    0,
    round(v_subtotal, 2),
    round(v_subtotal, 2)
  )
  returning public.sales_orders.id, public.sales_orders.order_no
    into v_so_id, v_order_no;

  for v_line in
    select ordinality::integer as line_no, value as line_data
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality
  loop
    select
      i.id,
      i.name,
      i.sku,
      i.base_uom_id,
      coalesce(i.unit_price, 0) as default_unit_price
      into v_item
    from public.items i
    where i.company_id = p_company_id
      and i.id = nullif(trim(v_line.line_data ->> 'item_id'), '')::uuid
    limit 1;

    v_line_qty := coalesce(nullif(trim(v_line.line_data ->> 'qty'), '')::numeric, 0);
    v_line_price := coalesce(
      nullif(trim(v_line.line_data ->> 'unit_price'), '')::numeric,
      v_item.default_unit_price,
      0
    );
    v_line_total := round(v_line_qty * v_line_price, 2);

    select coalesce(sl.avg_cost, 0)
      into v_line_cost
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = v_item.id
      and sl.warehouse_id = v_source_bin.warehouse_id
      and sl.bin_id = v_source_bin.id
    limit 1;

    insert into public.sales_order_lines (
      company_id,
      so_id,
      item_id,
      uom_id,
      description,
      line_no,
      qty,
      shipped_qty,
      is_shipped,
      shipped_at,
      unit_price,
      discount_pct,
      line_total
    )
    values (
      p_company_id,
      v_so_id,
      v_item.id,
      v_item.base_uom_id,
      coalesce(v_item.name, v_item.sku, 'Sale line'),
      v_line.line_no,
      v_line_qty,
      v_line_qty,
      true,
      now(),
      v_line_price,
      0,
      v_line_total
    )
    returning id into v_so_line_id;

    insert into public.stock_movements (
      company_id,
      type,
      item_id,
      uom_id,
      qty,
      qty_base,
      unit_cost,
      total_value,
      warehouse_from_id,
      bin_from_id,
      notes,
      created_by,
      ref_type,
      ref_id,
      ref_line_id
    )
    values (
      p_company_id,
      'issue',
      v_item.id,
      v_item.base_uom_id,
      v_line_qty,
      v_line_qty,
      v_line_cost,
      round(v_line_cost * v_line_qty, 2),
      v_source_bin.warehouse_id,
      v_source_bin.id,
      trim(
        both ' '
        from concat(
          'Point of Sale sale from ',
          coalesce(v_source_bin.warehouse_name, 'warehouse'),
          ' / ',
          coalesce(v_source_bin.code, v_source_bin.name, 'bin'),
          case when nullif(trim(p_notes), '') is not null then ' | ' || trim(p_notes) else '' end
        )
      ),
      v_user,
      'SO',
      v_so_id,
      v_so_line_id
    );
  end loop;

  sales_order_id := v_so_id;
  order_no := v_order_no;
  customer_id := v_customer.id;
  customer_name := v_customer.name;
  line_count := v_line_count;
  total_amount := round(v_subtotal, 2);

  return next;
end;
$$;
