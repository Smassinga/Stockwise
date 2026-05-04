-- POS sales are paid immediately, but ordinary settlement writes remain finance-sensitive.
-- This migration adds one narrow POS sale-receipt path and fixes landed-cost preview/apply
-- edge cases found during mobile/runtime validation.

create or replace function public.finance_document_settlement_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_company_id uuid;
  v_bank_id uuid;
  v_ref_type text;
  v_tx_type text;
  v_amount_base numeric;
  v_pos_settlement_bypass boolean := coalesce(current_setting('stockwise.pos_settlement_bypass', true), '') = 'on';
begin
  if tg_table_name = 'cash_transactions' then
    if tg_op = 'INSERT' then
      v_ref_type := new.ref_type;
      v_tx_type := new.type;
      v_company_id := new.company_id;
      v_amount_base := new.amount_base;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
      v_tx_type := coalesce(new.type, old.type);
      v_company_id := coalesce(new.company_id, old.company_id);
      v_amount_base := coalesce(new.amount_base, old.amount_base);
    end if;

    if v_pos_settlement_bypass
       and v_ref_type = 'SO'
       and v_tx_type = 'sale_receipt'
       and coalesce(v_amount_base, 0) > 0 then
      return new;
    end if;

    if (
      v_tx_type in ('sale_receipt', 'purchase_payment')
      or v_ref_type in ('SO', 'PO', 'SI', 'VB')
    ) and not public.finance_documents_can_manage_settlement(v_company_id) then
      raise exception using
        message = 'Settlement-linked cash transactions require finance authority.';
    end if;
    return new;
  end if;

  if tg_table_name = 'bank_transactions' then
    if tg_op = 'INSERT' then
      v_ref_type := new.ref_type;
      v_bank_id := new.bank_id;
      v_amount_base := new.amount_base;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
      v_bank_id := coalesce(new.bank_id, old.bank_id);
      v_amount_base := coalesce(new.amount_base, old.amount_base);
    end if;

    select ba.company_id
      into v_company_id
    from public.bank_accounts ba
    where ba.id = v_bank_id;

    if v_pos_settlement_bypass
       and v_ref_type = 'SO'
       and coalesce(v_amount_base, 0) > 0 then
      return new;
    end if;

    if v_ref_type in ('SO', 'PO', 'SI', 'VB')
       and not public.finance_documents_can_manage_settlement(v_company_id) then
      raise exception using
        message = 'Settlement-linked bank transactions require finance authority.';
    end if;
    return new;
  end if;

  raise exception using
    message = format('finance_document_settlement_guard does not support table %s.', tg_table_name);
end;
$$;

alter function public.finance_document_settlement_guard() owner to postgres;
revoke all on function public.finance_document_settlement_guard() from public;
grant all on function public.finance_document_settlement_guard() to authenticated;

create or replace function public.create_operator_sale_issue_with_settlement(
  p_company_id uuid,
  p_bin_from_id text,
  p_customer_id uuid default null,
  p_order_date date default current_date,
  p_currency_code text default 'MZN',
  p_fx_to_base numeric default 1,
  p_reference_no text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_settlement_method text default 'cash',
  p_bank_account_id uuid default null
)
returns table(
  sales_order_id uuid,
  order_no text,
  customer_id uuid,
  customer_name text,
  line_count integer,
  total_amount numeric,
  settlement_method text,
  settlement_id uuid,
  settled_amount_base numeric,
  bank_account_id uuid
)
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_sale record;
  v_method text := lower(coalesce(nullif(trim(p_settlement_method), ''), 'cash'));
  v_order_date date := coalesce(p_order_date, current_date);
  v_fx_to_base numeric := case when coalesce(p_fx_to_base, 0) > 0 then p_fx_to_base else 1 end;
  v_bank_company_id uuid;
  v_settlement_id uuid;
  v_settled_amount_base numeric;
begin
  if v_method not in ('cash', 'bank') then
    raise exception 'Payment destination must be Cash or Bank.' using errcode = 'P0001';
  end if;

  if v_method = 'bank' and p_bank_account_id is null then
    raise exception 'Choose a bank account before posting a bank POS settlement.' using errcode = 'P0001';
  end if;

  if v_method = 'bank' then
    select ba.company_id
      into v_bank_company_id
    from public.bank_accounts ba
    where ba.id = p_bank_account_id
    limit 1;

    if v_bank_company_id is null or v_bank_company_id <> p_company_id then
      raise exception 'The selected bank account does not belong to this company.' using errcode = 'P0001';
    end if;
  end if;

  select *
    into v_sale
  from public.create_operator_sale_issue(
    p_company_id,
    p_bin_from_id,
    p_customer_id,
    v_order_date,
    p_currency_code,
    v_fx_to_base,
    p_reference_no,
    p_notes,
    p_lines
  );

  if v_sale.sales_order_id is null then
    raise exception 'Could not create the POS sale before settlement.' using errcode = 'P0001';
  end if;

  v_settled_amount_base := round(coalesce(v_sale.total_amount, 0) * v_fx_to_base, 2);

  if v_settled_amount_base <= 0 then
    raise exception 'POS settlement amount must be greater than zero.' using errcode = 'P0001';
  end if;

  perform set_config('stockwise.pos_settlement_bypass', 'on', true);

  if v_method = 'cash' then
    insert into public.cash_transactions (
      company_id,
      happened_at,
      type,
      ref_type,
      ref_id,
      memo,
      amount_base
    ) values (
      p_company_id,
      v_order_date,
      'sale_receipt',
      'SO',
      v_sale.sales_order_id,
      trim(
        both ' '
        from concat(
          'Point of Sale receipt',
          case when nullif(v_sale.order_no, '') is not null then ' for ' || v_sale.order_no else '' end
        )
      ),
      v_settled_amount_base
    )
    returning id into v_settlement_id;
  else
    insert into public.bank_transactions (
      bank_id,
      happened_at,
      memo,
      amount_base,
      reconciled,
      ref_type,
      ref_id
    ) values (
      p_bank_account_id,
      v_order_date,
      trim(
        both ' '
        from concat(
          'Point of Sale receipt',
          case when nullif(v_sale.order_no, '') is not null then ' for ' || v_sale.order_no else '' end
        )
      ),
      v_settled_amount_base,
      false,
      'SO',
      v_sale.sales_order_id
    )
    returning id into v_settlement_id;
  end if;

  sales_order_id := v_sale.sales_order_id;
  order_no := v_sale.order_no;
  customer_id := v_sale.customer_id;
  customer_name := v_sale.customer_name;
  line_count := v_sale.line_count;
  total_amount := v_sale.total_amount;
  settlement_method := v_method;
  settlement_id := v_settlement_id;
  settled_amount_base := v_settled_amount_base;
  bank_account_id := case when v_method = 'bank' then p_bank_account_id else null end;

  return next;
end;
$$;

alter function public.create_operator_sale_issue_with_settlement(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid) owner to postgres;
revoke all on function public.create_operator_sale_issue_with_settlement(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid) from public;
grant all on function public.create_operator_sale_issue_with_settlement(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid) to authenticated;

comment on function public.create_operator_sale_issue_with_settlement(uuid, text, uuid, date, text, numeric, text, text, jsonb, text, uuid)
  is 'Creates a POS sales order through the canonical operator sale RPC and records the immediate cash or bank sale receipt in the existing settlement ledgers.';

create or replace function public.apply_landed_cost_run(
  p_company_id uuid,
  p_purchase_order_id uuid,
  p_supplier_id uuid,
  p_applied_by uuid,
  p_currency_code text,
  p_fx_to_base numeric,
  p_allocation_method text,
  p_total_extra_cost numeric,
  p_notes text,
  p_charges jsonb,
  p_lines jsonb
)
returns table(run_id uuid, line_count integer, total_applied_value numeric, total_unapplied_value numeric)
language plpgsql
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_run_id uuid;
  v_bucket record;
  v_charge jsonb;
  v_po record;
  v_charge_amount numeric;
  v_charge_label text;
  v_line_count integer := 0;
  v_total_applied numeric := 0;
  v_total_unapplied numeric := 0;
  v_total_extra_cost numeric := 0;
  v_total_extra_cost_base numeric := 0;
  v_total_receipt_qty numeric := 0;
  v_total_receipt_value numeric := 0;
  v_allocated_so_far numeric := 0;
  v_bucket_count integer := 0;
  v_allocated_extra numeric := 0;
  v_delta_per_received_unit numeric := 0;
  v_impacted_qty numeric := 0;
  v_applied numeric := 0;
  v_unapplied numeric := 0;
  v_new_avg_cost numeric := 0;
  v_stock_movement_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_fx_to_base numeric := 1;
  v_normalized_charges jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if p_company_id is null or p_purchase_order_id is null then
    raise exception 'company_id_required';
  end if;

  if p_company_id <> current_company_id() then
    raise exception 'company_scope_mismatch';
  end if;

  if not has_company_role(
    p_company_id,
    array['OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role, 'OPERATOR'::member_role]
  ) then
    raise exception 'insufficient_company_role';
  end if;

  if p_allocation_method not in ('quantity', 'value', 'equal') then
    raise exception 'invalid_allocation_method';
  end if;

  select
    po.id,
    po.company_id,
    po.supplier_id,
    coalesce(nullif(trim(po.currency_code), ''), coalesce(nullif(trim(p_currency_code), ''), 'USD')) as currency_code,
    coalesce(nullif(po.fx_to_base, 0), nullif(p_fx_to_base, 0), 1) as fx_to_base
  into v_po
  from public.purchase_orders po
  where po.id = p_purchase_order_id
    and po.company_id = p_company_id;

  if not found then
    raise exception 'purchase_order_not_found';
  end if;

  v_fx_to_base := coalesce(v_po.fx_to_base, 1);
  if v_fx_to_base <= 0 then
    raise exception 'invalid_fx_to_base';
  end if;

  for v_charge in
    select value
    from jsonb_array_elements(coalesce(p_charges, '[]'::jsonb))
  loop
    v_charge_amount := round(
      case
        when nullif(trim(v_charge->>'amount'), '') is null then 0
        else (v_charge->>'amount')::numeric
      end,
      6
    );

    if v_charge_amount = 0 then
      continue;
    end if;

    v_charge_label := coalesce(nullif(trim(v_charge->>'label'), ''), 'Other cost');
    v_total_extra_cost := round(v_total_extra_cost + v_charge_amount, 6);
    v_total_extra_cost_base := round(v_total_extra_cost_base + round(v_charge_amount * v_fx_to_base, 6), 6);
    v_normalized_charges := v_normalized_charges || jsonb_build_array(
      jsonb_build_object(
        'label', v_charge_label,
        'amount', v_charge_amount,
        'amount_base', round(v_charge_amount * v_fx_to_base, 6)
      )
    );
  end loop;

  if v_total_extra_cost_base <= 0 then
    raise exception 'total_extra_cost_required';
  end if;

  create temp table landed_cost_receipt_buckets (
    bucket_ordinal integer not null,
    item_id uuid not null,
    item_label text null,
    po_line_id uuid null,
    warehouse_id uuid null,
    bin_id text null,
    stock_level_id uuid null,
    received_qty_base numeric not null,
    receipt_value_base numeric not null,
    on_hand_qty_base numeric not null,
    previous_avg_cost numeric not null
  ) on commit drop;

  insert into landed_cost_receipt_buckets (
    bucket_ordinal,
    item_id,
    item_label,
    po_line_id,
    warehouse_id,
    bin_id,
    stock_level_id,
    received_qty_base,
    receipt_value_base,
    on_hand_qty_base,
    previous_avg_cost
  )
  with receipt_buckets as (
    select
      sm.item_id,
      min(nullif(sm.ref_line_id::text, '')) as po_line_id_text,
      sm.warehouse_to_id as warehouse_id,
      sm.bin_to_id as bin_id,
      round(sum(coalesce(sm.qty_base, 0)), 6) as received_qty_base,
      round(sum(coalesce(sm.total_value, sm.unit_cost * sm.qty_base, 0)), 6) as receipt_value_base
    from public.stock_movements sm
    where sm.company_id = p_company_id
      and sm.type = 'receive'
      and sm.ref_type = 'PO'
      and sm.ref_id = p_purchase_order_id::text
    group by
      sm.item_id,
      sm.warehouse_to_id,
      sm.bin_to_id
  ),
  bucket_rows as (
    select
      row_number() over (
        order by
          coalesce(i.name, rb.item_id::text),
          rb.item_id,
          coalesce(rb.warehouse_id::text, ''),
          coalesce(rb.bin_id, '')
      )::integer as bucket_ordinal,
      rb.item_id,
      trim(
        coalesce(i.name, rb.item_id::text)
        || case
             when nullif(i.sku, '') is not null then ' (' || i.sku || ')'
             else ''
           end
      ) as item_label,
      case
        when rb.po_line_id_text is null then null
        else rb.po_line_id_text::uuid
      end as po_line_id,
      rb.warehouse_id,
      rb.bin_id,
      sl.id as stock_level_id,
      rb.received_qty_base,
      rb.receipt_value_base,
      round(coalesce(sl.qty, 0), 6) as on_hand_qty_base,
      round(coalesce(sl.avg_cost, 0), 6) as previous_avg_cost
    from receipt_buckets rb
    join public.items i
      on i.id = rb.item_id
     and i.company_id = p_company_id
    left join public.stock_levels sl
      on sl.company_id = p_company_id
     and sl.item_id = rb.item_id
     and sl.warehouse_id is not distinct from rb.warehouse_id
     and sl.bin_id is not distinct from rb.bin_id
    where rb.received_qty_base > 0
  )
  select
    bucket_ordinal,
    item_id,
    item_label,
    po_line_id,
    warehouse_id,
    bin_id,
    stock_level_id,
    received_qty_base,
    receipt_value_base,
    on_hand_qty_base,
    previous_avg_cost
  from bucket_rows;

  select
    count(*),
    coalesce(sum(received_qty_base), 0),
    coalesce(sum(receipt_value_base), 0)
  into
    v_bucket_count,
    v_total_receipt_qty,
    v_total_receipt_value
  from landed_cost_receipt_buckets;

  if v_bucket_count = 0 then
    raise exception 'no_receipts_found_for_purchase_order';
  end if;

  if p_allocation_method = 'value' and v_total_receipt_value <= 0 then
    raise exception 'value_allocation_requires_receipt_value';
  end if;

  insert into public.landed_cost_runs (
    company_id,
    purchase_order_id,
    supplier_id,
    applied_by,
    currency_code,
    fx_to_base,
    allocation_method,
    total_extra_cost,
    total_applied_value,
    total_unapplied_value,
    notes,
    charges
  ) values (
    p_company_id,
    p_purchase_order_id,
    v_po.supplier_id,
    coalesce(auth.uid(), p_applied_by),
    upper(v_po.currency_code),
    v_fx_to_base,
    p_allocation_method,
    v_total_extra_cost,
    0,
    0,
    nullif(trim(p_notes), ''),
    v_normalized_charges
  )
  returning id into v_run_id;

  for v_bucket in
    select *
    from landed_cost_receipt_buckets
    order by bucket_ordinal
  loop
    v_allocated_extra := case
      when v_bucket.bucket_ordinal = v_bucket_count then
        round(v_total_extra_cost_base - v_allocated_so_far, 6)
      when p_allocation_method = 'quantity' then
        round(
          v_total_extra_cost_base
          * case
              when v_total_receipt_qty > 0 then v_bucket.received_qty_base / v_total_receipt_qty
              else 0
            end,
          6
        )
      when p_allocation_method = 'value' then
        round(v_total_extra_cost_base * (v_bucket.receipt_value_base / v_total_receipt_value), 6)
      else
        round(v_total_extra_cost_base / v_bucket_count, 6)
    end;

    v_allocated_so_far := round(v_allocated_so_far + v_allocated_extra, 6);
    v_delta_per_received_unit := case
      when v_bucket.received_qty_base > 0 then round(v_allocated_extra / v_bucket.received_qty_base, 6)
      else 0
    end;
    v_impacted_qty := round(greatest(0, least(v_bucket.on_hand_qty_base, v_bucket.received_qty_base)), 6);
    v_applied := round(v_delta_per_received_unit * v_impacted_qty, 6);
    v_unapplied := round(greatest(0, v_allocated_extra - v_applied), 6);
    v_new_avg_cost := case
      when v_bucket.on_hand_qty_base > 0 then
        round(v_bucket.previous_avg_cost + (v_applied / v_bucket.on_hand_qty_base), 6)
      else
        round(v_bucket.previous_avg_cost, 6)
    end;
    v_stock_movement_id := null;

    if v_bucket.stock_level_id is not null and v_applied <> 0 then
      update public.stock_levels
      set
        avg_cost = v_new_avg_cost,
        updated_at = v_now
      where id = v_bucket.stock_level_id
        and company_id = p_company_id
        and item_id = v_bucket.item_id
        and warehouse_id is not distinct from v_bucket.warehouse_id
        and bin_id is not distinct from v_bucket.bin_id;

      if not found then
        raise exception 'stock_level_scope_mismatch';
      end if;

      insert into public.stock_movements (
        company_id,
        type,
        item_id,
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
      ) values (
        p_company_id,
        'adjust',
        v_bucket.item_id,
        0,
        0,
        v_new_avg_cost,
        v_applied,
        v_bucket.warehouse_id,
        v_bucket.bin_id,
        coalesce(nullif(trim(p_notes), ''), 'Landed cost revaluation'),
        coalesce(auth.uid()::text, coalesce(p_applied_by::text, 'landed_cost')),
        'PO',
        p_purchase_order_id::text,
        case
          when v_bucket.po_line_id is null then null
          else v_bucket.po_line_id
        end
      )
      returning id into v_stock_movement_id;
    end if;

    insert into public.landed_cost_run_lines (
      run_id,
      company_id,
      purchase_order_id,
      po_line_id,
      item_id,
      item_label,
      warehouse_id,
      bin_id,
      stock_level_id,
      stock_movement_id,
      received_qty_base,
      impacted_qty_base,
      on_hand_qty_base,
      allocated_extra,
      applied_revaluation,
      unapplied_value,
      previous_avg_cost,
      new_avg_cost
    ) values (
      v_run_id,
      p_company_id,
      p_purchase_order_id,
      v_bucket.po_line_id,
      v_bucket.item_id,
      nullif(v_bucket.item_label, ''),
      v_bucket.warehouse_id,
      v_bucket.bin_id,
      v_bucket.stock_level_id,
      v_stock_movement_id,
      v_bucket.received_qty_base,
      v_impacted_qty,
      v_bucket.on_hand_qty_base,
      v_allocated_extra,
      v_applied,
      v_unapplied,
      v_bucket.previous_avg_cost,
      v_new_avg_cost
    );

    v_line_count := v_line_count + 1;
    v_total_applied := round(v_total_applied + v_applied, 6);
    v_total_unapplied := round(v_total_unapplied + v_unapplied, 6);
  end loop;

  update public.landed_cost_runs
  set
    total_applied_value = v_total_applied,
    total_unapplied_value = v_total_unapplied
  where id = v_run_id;

  return query
  select v_run_id, v_line_count, v_total_applied, v_total_unapplied;
end;
$$;

alter function public.apply_landed_cost_run(uuid, uuid, uuid, uuid, text, numeric, text, numeric, text, jsonb, jsonb) owner to postgres;
grant all on function public.apply_landed_cost_run(uuid, uuid, uuid, uuid, text, numeric, text, numeric, text, jsonb, jsonb) to authenticated;
