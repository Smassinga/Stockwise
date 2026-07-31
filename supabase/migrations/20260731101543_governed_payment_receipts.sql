-- OPS-1: immutable, settlement-anchored payment receipts.

create table public.payment_receipt_sequences (
  company_id uuid primary key references public.companies(id) on delete restrict,
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  receipt_reference text not null,
  source_kind text not null check (source_kind in ('pos','sales_order','sales_invoice')),
  source_id uuid not null,
  settlement_id uuid not null,
  settlement_channel text not null check (settlement_channel in ('cash','bank')),
  sales_order_id uuid references public.sales_orders(id) on delete restrict,
  sales_invoice_id uuid references public.sales_invoices(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  customer_snapshot jsonb not null default '{}'::jsonb,
  company_identity_snapshot jsonb not null,
  currency_code text not null,
  amount_received numeric(20,6) not null check (amount_received > 0),
  remaining_balance numeric(20,6) not null check (remaining_balance >= 0),
  payment_method text not null,
  destination_snapshot jsonb not null default '{}'::jsonb,
  payment_at timestamptz not null,
  document_references jsonb not null default '{}'::jsonb,
  line_evidence jsonb not null default '[]'::jsonb,
  non_fiscal boolean not null default false,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  request_key text,
  voids_receipt_id uuid references public.payment_receipts(id) on delete restrict,
  voided_by_receipt_id uuid references public.payment_receipts(id) on delete restrict,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint payment_receipts_company_reference_unique unique (company_id, receipt_reference),
  constraint payment_receipts_settlement_unique unique (settlement_channel, settlement_id),
  constraint payment_receipts_source_anchor_check check (
    (source_kind = 'sales_invoice' and sales_invoice_id is not null)
    or (source_kind in ('pos','sales_order') and sales_order_id is not null)
  )
);

create index payment_receipts_company_issued_idx
  on public.payment_receipts(company_id, issued_at desc, id desc);
create index payment_receipts_sales_order_idx
  on public.payment_receipts(company_id, sales_order_id, issued_at desc)
  where sales_order_id is not null;
create index payment_receipts_sales_invoice_idx
  on public.payment_receipts(company_id, sales_invoice_id, issued_at desc)
  where sales_invoice_id is not null;

alter table public.payment_receipt_sequences enable row level security;
alter table public.payment_receipt_sequences force row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_receipts force row level security;

create policy payment_receipts_select_company_members
  on public.payment_receipts for select to authenticated
  using (company_id = public.current_company_id());

revoke all on table public.payment_receipt_sequences from public, anon, authenticated;
revoke all on table public.payment_receipts from public, anon, authenticated;
grant select on table public.payment_receipts to authenticated;

create or replace function public.stockwise_next_receipt_reference(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_next bigint;
begin
  insert into public.payment_receipt_sequences(company_id, last_value)
  values (p_company_id, 1)
  on conflict (company_id) do update
    set last_value = public.payment_receipt_sequences.last_value + 1,
        updated_at = now()
  returning last_value into v_next;

  return 'RCT-' || to_char(current_date, 'YYYY') || '-' || lpad(v_next::text, 8, '0');
end;
$$;

create or replace function public.stockwise_reject_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'issued_receipt_is_immutable' using errcode = '42501';
end;
$$;

create trigger payment_receipts_immutable_update
before update or delete on public.payment_receipts
for each row execute function public.stockwise_reject_receipt_mutation();

create or replace function public.stockwise_issue_payment_receipt(
  p_channel text,
  p_settlement_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing uuid;
  v_company_id uuid;
  v_ref_type text;
  v_ref_id uuid;
  v_amount numeric;
  v_payment_at timestamptz;
  v_actor uuid;
  v_destination jsonb := '{}'::jsonb;
  v_order public.sales_orders%rowtype;
  v_invoice public.sales_invoices%rowtype;
  v_customer jsonb := '{}'::jsonb;
  v_company jsonb;
  v_order_id uuid;
  v_invoice_id uuid;
  v_customer_id uuid;
  v_source_kind text;
  v_source_id uuid;
  v_currency text;
  v_remaining numeric;
  v_document_refs jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_receipt_id uuid;
begin
  select id into v_existing
  from public.payment_receipts
  where settlement_channel = p_channel and settlement_id = p_settlement_id;
  if v_existing is not null then return v_existing; end if;

  if p_channel = 'cash' then
    select ct.company_id, ct.ref_type, ct.ref_id, abs(ct.amount_base),
           ct.happened_at::timestamptz,
           case when coalesce(ct.user_ref, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then ct.user_ref::uuid else auth.uid() end,
           jsonb_build_object('kind','cash','label','Cash')
      into v_company_id, v_ref_type, v_ref_id, v_amount, v_payment_at, v_actor, v_destination
    from public.cash_transactions ct
    where ct.id = p_settlement_id and ct.type = 'sale_receipt' and ct.amount_base > 0;
  elsif p_channel = 'bank' then
    select ba.company_id, bt.ref_type, bt.ref_id, abs(bt.amount_base),
           bt.happened_at::timestamptz, auth.uid(),
           jsonb_build_object('kind','bank','bank_account_id',ba.id,'name',ba.name,'currency_code',ba.currency_code)
      into v_company_id, v_ref_type, v_ref_id, v_amount, v_payment_at, v_actor, v_destination
    from public.bank_transactions bt
    join public.bank_accounts ba on ba.id = bt.bank_id
    where bt.id = p_settlement_id and bt.amount_base > 0;
  else
    raise exception 'receipt_channel_invalid' using errcode = '22023';
  end if;

  if v_company_id is null or v_ref_type not in ('SO','SI') then return null; end if;

  if v_ref_type = 'SI' then
    select * into v_invoice from public.sales_invoices where id = v_ref_id and company_id = v_company_id;
    if v_invoice.id is null then raise exception 'receipt_anchor_not_found'; end if;
    v_invoice_id := v_invoice.id;
    v_order_id := v_invoice.sales_order_id;
    v_customer_id := v_invoice.customer_id;
    v_source_kind := 'sales_invoice';
    v_source_id := v_invoice.id;
    v_currency := coalesce(v_invoice.currency_code, 'MZN');
    v_document_refs := jsonb_build_object('sales_invoice',coalesce(v_invoice.internal_reference,v_invoice.id::text));
    if v_order_id is not null then
      select * into v_order from public.sales_orders where id = v_order_id;
      v_document_refs := v_document_refs || jsonb_build_object('sales_order',coalesce(v_order.order_no,v_order.id::text));
    end if;
  else
    select * into v_order from public.sales_orders where id = v_ref_id and company_id = v_company_id;
    if v_order.id is null then raise exception 'receipt_anchor_not_found'; end if;
    v_order_id := v_order.id;
    v_customer_id := v_order.customer_id;
    v_source_kind := case when v_order.pos_tax_mode_snapshot is not null then 'pos' else 'sales_order' end;
    v_source_id := v_order.id;
    v_currency := coalesce(v_order.currency_code, 'MZN');
    v_document_refs := jsonb_build_object('sales_order',coalesce(v_order.order_no,v_order.id::text));
  end if;

  select to_jsonb(c) - 'created_by' - 'updated_by' into v_company
  from public.companies c where c.id = v_company_id;
  if v_customer_id is not null then
    select to_jsonb(c) - 'company_id' - 'created_by' - 'updated_by' into v_customer
    from public.customers c where c.id = v_customer_id and c.company_id = v_company_id;
  end if;

  select greatest(coalesce(a.outstanding_base,0),0) into v_remaining
  from public.resolve_settlement_anchor(v_company_id, v_ref_type, v_ref_id) a;

  if v_source_kind = 'pos' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'description',coalesce(i.name,sol.description),
        'sku',i.sku,
        'quantity',sol.qty,
        'uom',coalesce(u.code,u.name,sol.uom_id),
        'unit_price',sol.unit_price,
        'discount',coalesce(sol.discount_pct,0),
        'subtotal',sol.line_total,
        'tax',coalesce(sol.tax_amount,0),
        'total',sol.line_total + coalesce(sol.tax_amount,0)
      ) order by sol.line_no, sol.id
    ),'[]'::jsonb) into v_lines
    from public.sales_order_lines sol
    left join public.items i on i.id = sol.item_id
    left join public.uoms u on u.id = sol.uom_id
    where sol.so_id = v_order_id;
  end if;

  insert into public.payment_receipts(
    company_id, receipt_reference, source_kind, source_id, settlement_id,
    settlement_channel, sales_order_id, sales_invoice_id, customer_id,
    customer_snapshot, company_identity_snapshot, currency_code,
    amount_received, remaining_balance, payment_method, destination_snapshot,
    payment_at, document_references, line_evidence, non_fiscal, issued_by,
    request_key
  ) values (
    v_company_id, public.stockwise_next_receipt_reference(v_company_id), v_source_kind,
    v_source_id, p_settlement_id, p_channel, v_order_id, v_invoice_id, v_customer_id,
    coalesce(v_customer,'{}'::jsonb), v_company, v_currency, v_amount,
    coalesce(v_remaining,0), p_channel, v_destination, v_payment_at,
    v_document_refs, v_lines, coalesce(v_order.pos_tax_mode_snapshot = 'non_fiscal',false),
    v_actor, null
  )
  on conflict (settlement_channel, settlement_id) do nothing
  returning id into v_receipt_id;

  if v_receipt_id is null then
    select id into v_receipt_id from public.payment_receipts
    where settlement_channel = p_channel and settlement_id = p_settlement_id;
  end if;
  return v_receipt_id;
end;
$$;

create or replace function public.stockwise_cash_receipt_trigger()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if new.type = 'sale_receipt' and new.amount_base > 0 and new.ref_type in ('SO','SI') then
    perform public.stockwise_issue_payment_receipt('cash', new.id);
  end if;
  return new;
end;
$$;

create or replace function public.stockwise_bank_receipt_trigger()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if new.amount_base > 0 and new.ref_type in ('SO','SI') then
    perform public.stockwise_issue_payment_receipt('bank', new.id);
  end if;
  return new;
end;
$$;

create trigger cash_transactions_issue_payment_receipt
after insert on public.cash_transactions for each row
execute function public.stockwise_cash_receipt_trigger();
create trigger bank_transactions_issue_payment_receipt
after insert on public.bank_transactions for each row
execute function public.stockwise_bank_receipt_trigger();

create or replace function public.get_payment_receipt(p_receipt_id uuid)
returns setof public.payment_receipts
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select * from public.payment_receipts where id = p_receipt_id;
$$;

create or replace function public.list_payment_receipts(
  p_sales_order_id uuid default null,
  p_sales_invoice_id uuid default null
) returns setof public.payment_receipts
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select * from public.payment_receipts
  where (p_sales_order_id is null or sales_order_id = p_sales_order_id)
    and (p_sales_invoice_id is null or sales_invoice_id = p_sales_invoice_id)
  order by issued_at desc, id desc;
$$;

alter function public.stockwise_next_receipt_reference(uuid) owner to postgres;
alter function public.stockwise_issue_payment_receipt(text,uuid) owner to postgres;
alter function public.stockwise_cash_receipt_trigger() owner to postgres;
alter function public.stockwise_bank_receipt_trigger() owner to postgres;
alter function public.stockwise_reject_receipt_mutation() owner to postgres;
revoke all on function public.stockwise_next_receipt_reference(uuid) from public, anon, authenticated;
revoke all on function public.stockwise_issue_payment_receipt(text,uuid) from public, anon, authenticated;
revoke all on function public.stockwise_cash_receipt_trigger() from public, anon, authenticated;
revoke all on function public.stockwise_bank_receipt_trigger() from public, anon, authenticated;
revoke all on function public.stockwise_reject_receipt_mutation() from public, anon, authenticated;
revoke all on function public.get_payment_receipt(uuid) from public, anon;
revoke all on function public.list_payment_receipts(uuid,uuid) from public, anon;
grant execute on function public.get_payment_receipt(uuid) to authenticated;
grant execute on function public.list_payment_receipts(uuid,uuid) to authenticated;

comment on table public.payment_receipts is
  'Immutable proof-of-payment evidence issued once per authoritative cash or bank settlement.';
