begin;

create or replace function public.po_trim_and_close(p_company_id uuid, p_po_id uuid)
returns table(closed boolean, removed_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_member boolean;
  v_line_count integer := 0;
  v_received_line_count integer := 0;
  v_partial_line_count integer := 0;
begin
  select exists(
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and (m.user_id = auth.uid() or lower(m.email) = lower(coalesce(auth.email(), '')))
      and coalesce(m.status, 'active') in ('active', 'invited')
  ) into v_is_member;

  if not v_is_member then
    raise exception 'not allowed';
  end if;

  /*
   * Receiving is an operational event. It must not delete purchase-order lines,
   * because the lines remain the AP billing source until the vendor bill exists.
   */
  with line_receipts as (
    select
      pol.id,
      coalesce(pol.qty, 0) as ordered_qty,
      coalesce(sum(
        case
          when sm.type = 'receive'
           and sm.ref_type = 'PO'
           and sm.company_id = p_company_id
           and sm.ref_id = p_po_id::text
           and sm.ref_line_id = pol.id
          then coalesce(sm.qty, 0)
          else 0
        end
      ), 0) as received_qty
    from public.purchase_order_lines pol
    left join public.stock_movements sm
      on sm.ref_line_id = pol.id
     and sm.company_id = p_company_id
     and sm.ref_type = 'PO'
     and sm.ref_id = p_po_id::text
    where pol.company_id = p_company_id
      and pol.po_id = p_po_id
    group by pol.id, pol.qty
  )
  select
    count(*)::integer,
    count(*) filter (where received_qty >= ordered_qty and ordered_qty > 0)::integer,
    count(*) filter (where received_qty > 0 and received_qty < ordered_qty)::integer
    into v_line_count, v_received_line_count, v_partial_line_count
  from line_receipts;

  if v_line_count > 0 and v_received_line_count = v_line_count then
    update public.purchase_orders
       set status = 'closed'::po_status,
           received_at = coalesce(received_at, now()),
           updated_at = now()
     where id = p_po_id
       and company_id = p_company_id
       and lower(coalesce(status::text, '')) not in ('cancelled', 'canceled');

    return query select true, 0;
    return;
  end if;

  if v_partial_line_count > 0 or v_received_line_count > 0 then
    update public.purchase_orders
       set status = 'partially_received'::po_status,
           updated_at = now()
     where id = p_po_id
       and company_id = p_company_id
       and lower(coalesce(status::text, '')) not in ('closed', 'cancelled', 'canceled');
  end if;

  return query select false, 0;
end;
$function$;

create or replace function public.create_vendor_bill_draft_from_purchase_order(
  p_company_id uuid,
  p_purchase_order_id uuid,
  p_supplier_invoice_reference text default null,
  p_supplier_invoice_date date default null,
  p_bill_date date default null,
  p_due_date date default null,
  p_currency_code text default null,
  p_fx_to_base numeric default null,
  p_lines jsonb default '[]'::jsonb
)
returns public.vendor_bills
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_po public.purchase_orders%rowtype;
  v_bill public.vendor_bills%rowtype;
  v_bill_date date;
  v_due_date date;
  v_currency_code text;
  v_fx_to_base numeric;
  v_line_count integer := 0;
  v_expected_line_count integer := 0;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_total_amount numeric := 0;
  v_derive_lines boolean := false;
begin
  if p_company_id is null or p_purchase_order_id is null then
    raise exception using
      message = 'A company and purchase order are required before creating a vendor bill draft.';
  end if;

  if not public.finance_documents_can_prepare_draft(p_company_id) then
    raise exception using
      message = 'Vendor bill draft creation access denied.';
  end if;

  select po.*
    into v_po
  from public.purchase_orders po
  where po.company_id = p_company_id
    and po.id = p_purchase_order_id;

  if v_po.id is null then
    raise exception using
      message = 'Purchase order not found for the active company.';
  end if;

  if lower(coalesce(v_po.status::text, '')) not in ('approved', 'open', 'authorised', 'authorized', 'submitted', 'partially_received', 'closed') then
    raise exception using
      message = 'Only approved, receiving, or closed purchase orders can create vendor bill drafts.';
  end if;

  if exists (
    select 1
    from public.vendor_bills vb
    where vb.company_id = p_company_id
      and vb.purchase_order_id = p_purchase_order_id
      and vb.document_workflow_status in ('draft', 'posted')
  ) then
    raise exception using
      message = 'A draft or posted vendor bill already exists for this purchase order.';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception using
      message = 'Vendor bill draft lines must be provided as a JSON array.';
  end if;

  v_expected_line_count := coalesce(jsonb_array_length(coalesce(p_lines, '[]'::jsonb)), 0);
  v_derive_lines := v_expected_line_count = 0;

  create temporary table if not exists pg_temp.vendor_bill_draft_source_lines (
    source_key text not null,
    purchase_order_line_id uuid null,
    item_id uuid null,
    description text not null,
    qty numeric not null,
    unit_cost numeric not null,
    tax_rate numeric null,
    tax_amount numeric not null,
    line_total numeric not null,
    sort_order integer not null
  ) on commit drop;

  truncate table pg_temp.vendor_bill_draft_source_lines;

  if not v_derive_lines then
    insert into pg_temp.vendor_bill_draft_source_lines (
      source_key,
      purchase_order_line_id,
      item_id,
      description,
      qty,
      unit_cost,
      tax_rate,
      tax_amount,
      line_total,
      sort_order
    )
    select
      pol.id::text as source_key,
      pol.id,
      coalesce(src.item_id, pol.item_id),
      coalesce(
        nullif(btrim(src.description), ''),
        nullif(btrim(pol.description), ''),
        nullif(btrim(it.name), ''),
        nullif(btrim(it.sku), ''),
        'Item'
      ) as description,
      round(coalesce(src.qty, 0), 6) as qty,
      round(coalesce(src.unit_cost, 0), 6) as unit_cost,
      case
        when src.tax_rate is null then null
        else round(src.tax_rate, 4)
      end as tax_rate,
      round(coalesce(src.tax_amount, 0), 2) as tax_amount,
      round(coalesce(src.line_total, 0), 2) as line_total,
      coalesce(src.sort_order, pol.line_no, 0) as sort_order
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as src(
      purchase_order_line_id uuid,
      item_id uuid,
      description text,
      qty numeric,
      unit_cost numeric,
      tax_rate numeric,
      tax_amount numeric,
      line_total numeric,
      sort_order integer
    )
    join public.purchase_order_lines pol
      on pol.company_id = p_company_id
     and pol.po_id = p_purchase_order_id
     and pol.id = src.purchase_order_line_id
    left join public.items it
      on it.company_id = p_company_id
     and it.id = coalesce(src.item_id, pol.item_id)
    where round(coalesce(src.qty, 0), 6) > 0
      and (round(coalesce(src.line_total, 0), 2) > 0 or round(coalesce(src.tax_amount, 0), 2) > 0);

    get diagnostics v_line_count = row_count;

    if v_line_count <> v_expected_line_count then
      raise exception using
        message = 'Every vendor bill draft line must point to a valid purchase-order line with a positive quantity and amount.';
    end if;
  else
    insert into pg_temp.vendor_bill_draft_source_lines (
      source_key,
      purchase_order_line_id,
      item_id,
      description,
      qty,
      unit_cost,
      tax_rate,
      tax_amount,
      line_total,
      sort_order
    )
    select
      pol.id::text as source_key,
      pol.id,
      pol.item_id,
      coalesce(
        nullif(btrim(pol.description), ''),
        nullif(btrim(it.name), ''),
        nullif(btrim(it.sku), ''),
        'Item'
      ) as description,
      round(coalesce(pol.qty, 0), 6) as qty,
      round(coalesce(pol.unit_price, 0), 6) as unit_cost,
      null::numeric as tax_rate,
      0::numeric as tax_amount,
      round(coalesce(pol.line_total, coalesce(pol.qty, 0) * coalesce(pol.unit_price, 0)), 2) as line_total,
      coalesce(pol.line_no, 0) as sort_order
    from public.purchase_order_lines pol
    left join public.items it
      on it.company_id = p_company_id
     and it.id = pol.item_id
    where pol.company_id = p_company_id
      and pol.po_id = p_purchase_order_id
      and round(coalesce(pol.qty, 0), 6) > 0
      and round(coalesce(pol.line_total, coalesce(pol.qty, 0) * coalesce(pol.unit_price, 0)), 2) > 0;

    insert into pg_temp.vendor_bill_draft_source_lines (
      source_key,
      purchase_order_line_id,
      item_id,
      description,
      qty,
      unit_cost,
      tax_rate,
      tax_amount,
      line_total,
      sort_order
    )
    with receipt_rollup as (
      select
        sm.ref_line_id,
        sm.item_id,
        coalesce(sum(coalesce(sm.qty, sm.qty_base, 0)), 0) as qty,
        coalesce(sum(coalesce(sm.total_value, coalesce(sm.qty, sm.qty_base, 0) * coalesce(sm.unit_cost, 0))), 0) as line_total,
        min(sm.created_at) as first_received_at
      from public.stock_movements sm
      where sm.company_id = p_company_id
        and sm.ref_type = 'PO'
        and sm.type = 'receive'
        and sm.ref_id = p_purchase_order_id::text
        and (
          sm.ref_line_id is null
          or not exists (
            select 1
            from public.purchase_order_lines pol
            where pol.company_id = p_company_id
              and pol.po_id = p_purchase_order_id
              and pol.id = sm.ref_line_id
          )
        )
      group by sm.ref_line_id, sm.item_id
    )
    select
      coalesce(rr.ref_line_id::text, 'receipt:' || coalesce(rr.item_id::text, 'line') || ':' || row_number() over (order by rr.first_received_at, rr.item_id)::text) as source_key,
      null::uuid as purchase_order_line_id,
      rr.item_id,
      coalesce(
        nullif(btrim(it.name), ''),
        nullif(btrim(it.sku), ''),
        'Received purchase line'
      ) as description,
      round(rr.qty, 6) as qty,
      case
        when rr.qty > 0 then round(rr.line_total / rr.qty, 6)
        else round(rr.line_total, 6)
      end as unit_cost,
      null::numeric as tax_rate,
      0::numeric as tax_amount,
      round(rr.line_total, 2) as line_total,
      10000 + row_number() over (order by rr.first_received_at, rr.item_id)::integer as sort_order
    from receipt_rollup rr
    left join public.items it
      on it.company_id = p_company_id
     and it.id = rr.item_id
    where round(rr.qty, 6) > 0
      and round(rr.line_total, 2) > 0
      and (
        rr.ref_line_id is not null
        or not exists (select 1 from pg_temp.vendor_bill_draft_source_lines)
      );
  end if;

  select count(*)::integer
    into v_line_count
  from pg_temp.vendor_bill_draft_source_lines;

  if v_line_count = 0 then
    raise exception using
      message = 'The selected purchase order has no positive purchasable lines to bill.';
  end if;

  select
    round(coalesce(sum(line_total), 0), 2),
    round(coalesce(sum(tax_amount), 0), 2)
    into v_subtotal, v_tax_total
  from pg_temp.vendor_bill_draft_source_lines;

  if v_derive_lines then
    v_tax_total := round(coalesce(v_po.tax_total, 0), 2);

    if v_tax_total > 0 and v_subtotal <= 0 then
      raise exception using
        message = 'The selected purchase order has tax recorded but no positive subtotal to bill.';
    end if;

    if v_tax_total > 0 then
      with ordered as (
        select
          source_key,
          line_total,
          sort_order,
          row_number() over (order by sort_order, source_key) as rn,
          count(*) over () as ct
        from pg_temp.vendor_bill_draft_source_lines
      ),
      allocated as (
        select
          source_key,
          case
            when rn = ct then round(v_tax_total - coalesce(sum(round(line_total / nullif(v_subtotal, 0) * v_tax_total, 2)) over (order by sort_order, source_key rows between unbounded preceding and 1 preceding), 0), 2)
            else round(line_total / nullif(v_subtotal, 0) * v_tax_total, 2)
          end as allocated_tax
        from ordered
      )
      update pg_temp.vendor_bill_draft_source_lines src
         set tax_amount = allocated.allocated_tax,
             tax_rate = round((v_tax_total / nullif(v_subtotal, 0)) * 100, 4)
      from allocated
      where allocated.source_key = src.source_key;
    end if;
  end if;

  v_total_amount := round(v_subtotal + v_tax_total, 2);
  v_bill_date := coalesce(p_bill_date, p_supplier_invoice_date, current_date);
  v_due_date := coalesce(p_due_date, v_po.due_date, v_bill_date);
  if v_due_date < v_bill_date then
    v_due_date := v_bill_date;
  end if;

  v_currency_code := coalesce(nullif(btrim(coalesce(p_currency_code, '')), ''), v_po.currency_code::text, 'MZN');
  v_fx_to_base := coalesce(p_fx_to_base, v_po.fx_to_base, 1);
  if coalesce(v_fx_to_base, 0) <= 0 then
    v_fx_to_base := 1;
  end if;

  insert into public.vendor_bills (
    company_id,
    purchase_order_id,
    supplier_id,
    supplier_invoice_reference,
    supplier_invoice_date,
    bill_date,
    due_date,
    currency_code,
    fx_to_base,
    subtotal,
    tax_total,
    total_amount,
    document_workflow_status,
    approval_status,
    created_by
  ) values (
    p_company_id,
    p_purchase_order_id,
    v_po.supplier_id,
    nullif(btrim(coalesce(p_supplier_invoice_reference, '')), ''),
    p_supplier_invoice_date,
    v_bill_date,
    v_due_date,
    v_currency_code,
    v_fx_to_base,
    v_subtotal,
    v_tax_total,
    v_total_amount,
    'draft',
    'draft',
    auth.uid()
  )
  returning * into v_bill;

  insert into public.vendor_bill_lines (
    company_id,
    vendor_bill_id,
    purchase_order_line_id,
    item_id,
    description,
    qty,
    unit_cost,
    tax_rate,
    tax_amount,
    line_total,
    sort_order
  )
  select
    p_company_id,
    v_bill.id,
    purchase_order_line_id,
    item_id,
    description,
    qty,
    unit_cost,
    tax_rate,
    tax_amount,
    line_total,
    sort_order
  from pg_temp.vendor_bill_draft_source_lines
  order by sort_order, source_key;

  return v_bill;
end;
$function$;

grant execute on function public.create_vendor_bill_draft_from_purchase_order(
  uuid,
  uuid,
  text,
  date,
  date,
  date,
  text,
  numeric,
  jsonb
) to authenticated;

commit;
