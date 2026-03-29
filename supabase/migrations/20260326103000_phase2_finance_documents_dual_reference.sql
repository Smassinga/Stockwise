create table if not exists public.document_number_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  document_type text not null check (document_type in ('sales_invoice', 'vendor_bill')),
  next_number integer not null default 1 check (next_number >= 1),
  updated_at timestamptz not null default now(),
  primary key (company_id, document_type)
);

create or replace function public.finance_documents_can_read(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and cm.status in ('active', 'invited')
  );
$$;

create or replace function public.finance_documents_can_write(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and cm.role in ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR')
  );
$$;

create or replace function public.finance_documents_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_supplier_invoice_reference(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g')), '');
$$;

create or replace function public.finance_document_company_prefix(p_company_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_prefix text;
  v_name text;
begin
  if p_company_id is null then
    return 'CMP';
  end if;

  if to_regprocedure('public.company_prefix3(uuid)') is not null then
    begin
      execute 'select public.company_prefix3($1)' into v_prefix using p_company_id;
    exception when others then
      v_prefix := null;
    end;
  end if;

  if v_prefix is null or btrim(v_prefix) = '' then
    select c.name
      into v_name
    from public.companies c
    where c.id = p_company_id;

    v_prefix := upper(substr(regexp_replace(coalesce(v_name, ''), '[^A-Za-z0-9]', '', 'g'), 1, 3));
  end if;

  v_prefix := upper(coalesce(nullif(btrim(v_prefix), ''), 'CMP'));
  if length(v_prefix) < 3 then
    v_prefix := rpad(v_prefix, 3, 'X');
  end if;

  return substr(v_prefix, 1, 3);
end;
$$;

create or replace function public.next_finance_document_reference(p_company_id uuid, p_document_type text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sequence integer;
  v_prefix text;
  v_code text;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if p_document_type not in ('sales_invoice', 'vendor_bill') then
    raise exception 'unsupported_finance_document_type: %', p_document_type;
  end if;

  insert into public.document_number_counters (company_id, document_type, next_number)
  values (p_company_id, p_document_type, 1)
  on conflict (company_id, document_type) do nothing;

  update public.document_number_counters dnc
     set next_number = dnc.next_number + 1,
         updated_at = now()
   where dnc.company_id = p_company_id
     and dnc.document_type = p_document_type
  returning dnc.next_number - 1 into v_sequence;

  if v_sequence is null then
    raise exception 'finance_document_counter_update_failed';
  end if;

  v_prefix := public.finance_document_company_prefix(p_company_id);
  v_code := case
    when p_document_type = 'sales_invoice' then 'INV'
    when p_document_type = 'vendor_bill' then 'VB'
    else 'DOC'
  end;

  return v_prefix || '-' || v_code || lpad(v_sequence::text, 5, '0');
end;
$$;

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sales_order_id uuid null references public.sales_orders(id) on delete set null,
  customer_id uuid null references public.customers(id) on delete set null,
  internal_reference text not null,
  invoice_date date not null default current_date,
  due_date date not null,
  currency_code text not null default 'MZN',
  fx_to_base numeric not null default 1 check (fx_to_base > 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total_amount numeric not null default 0 check (total_amount >= 0),
  document_workflow_status text not null default 'draft'
    check (document_workflow_status in ('draft', 'issued', 'voided')),
  issued_at timestamptz null,
  issued_by uuid null references auth.users(id) on delete set null,
  voided_at timestamptz null,
  voided_by uuid null references auth.users(id) on delete set null,
  void_reason text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_invoices_internal_reference_format
    check (internal_reference ~ '^[A-Z0-9]{3}-INV[0-9]{5}$')
);

create unique index if not exists sales_invoices_company_internal_reference_key
  on public.sales_invoices (company_id, internal_reference);

create index if not exists sales_invoices_company_order_idx
  on public.sales_invoices (company_id, sales_order_id);

create index if not exists sales_invoices_company_due_idx
  on public.sales_invoices (company_id, due_date);

create table if not exists public.sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sales_invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  sales_order_line_id uuid null references public.sales_order_lines(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 0,
  unit_price numeric not null default 0,
  tax_rate numeric null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_invoice_lines_invoice_idx
  on public.sales_invoice_lines (sales_invoice_id, sort_order, created_at);

create index if not exists sales_invoice_lines_company_idx
  on public.sales_invoice_lines (company_id);

create table if not exists public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_order_id uuid null references public.purchase_orders(id) on delete set null,
  supplier_id uuid null references public.suppliers(id) on delete set null,
  internal_reference text not null,
  supplier_invoice_reference text null,
  supplier_invoice_reference_normalized text generated always as (public.normalize_supplier_invoice_reference(supplier_invoice_reference)) stored,
  supplier_invoice_date date null,
  bill_date date not null default current_date,
  due_date date not null,
  currency_code text not null default 'MZN',
  fx_to_base numeric not null default 1 check (fx_to_base > 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total_amount numeric not null default 0 check (total_amount >= 0),
  document_workflow_status text not null default 'draft'
    check (document_workflow_status in ('draft', 'posted', 'voided')),
  posted_at timestamptz null,
  posted_by uuid null references auth.users(id) on delete set null,
  voided_at timestamptz null,
  voided_by uuid null references auth.users(id) on delete set null,
  void_reason text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_bills_internal_reference_format
    check (internal_reference ~ '^[A-Z0-9]{3}-VB[0-9]{5}$')
);

create unique index if not exists vendor_bills_company_internal_reference_key
  on public.vendor_bills (company_id, internal_reference);

create index if not exists vendor_bills_company_supplier_reference_idx
  on public.vendor_bills (company_id, supplier_id, supplier_invoice_reference_normalized)
  where supplier_invoice_reference_normalized is not null;

create unique index if not exists vendor_bills_posted_supplier_reference_key
  on public.vendor_bills (company_id, supplier_id, supplier_invoice_reference_normalized)
  where document_workflow_status = 'posted'
    and supplier_invoice_reference_normalized is not null;

create index if not exists vendor_bills_company_due_idx
  on public.vendor_bills (company_id, due_date);

create index if not exists vendor_bills_company_po_idx
  on public.vendor_bills (company_id, purchase_order_id);

create table if not exists public.vendor_bill_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_bill_id uuid not null references public.vendor_bills(id) on delete cascade,
  purchase_order_line_id uuid null references public.purchase_order_lines(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 0,
  unit_cost numeric not null default 0,
  tax_rate numeric null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_bill_lines_bill_idx
  on public.vendor_bill_lines (vendor_bill_id, sort_order, created_at);

create index if not exists vendor_bill_lines_company_idx
  on public.vendor_bill_lines (company_id);

create or replace function public.sales_invoice_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_invoice_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'sales_invoice');
  end if;

  if new.document_workflow_status = 'issued' then
    if new.due_date is null then
      raise exception 'sales_invoice_due_date_required_for_issue';
    end if;
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.issued_by is null then
      new.issued_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.vendor_bill_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'vendor_bill_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'vendor_bill');
  end if;

  if new.document_workflow_status = 'posted' then
    if new.due_date is null then
      raise exception 'vendor_bill_due_date_required_for_post';
    end if;
    if new.posted_at is null then
      new.posted_at := now();
    end if;
    if new.posted_by is null then
      new.posted_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.finance_document_line_company_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_parent_company_id uuid;
begin
  if tg_table_name = 'sales_invoice_lines' then
    select si.company_id into v_parent_company_id
    from public.sales_invoices si
    where si.id = new.sales_invoice_id;
  elsif tg_table_name = 'vendor_bill_lines' then
    select vb.company_id into v_parent_company_id
    from public.vendor_bills vb
    where vb.id = new.vendor_bill_id;
  end if;

  if v_parent_company_id is null then
    raise exception 'finance_document_parent_not_found';
  end if;

  new.company_id := v_parent_company_id;
  return new;
end;
$$;

drop trigger if exists sales_invoices_assign_reference on public.sales_invoices;
create trigger sales_invoices_assign_reference
before insert or update on public.sales_invoices
for each row execute function public.sales_invoice_assign_reference();

drop trigger if exists sales_invoices_touch_updated_at on public.sales_invoices;
create trigger sales_invoices_touch_updated_at
before update on public.sales_invoices
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists sales_invoice_lines_touch_updated_at on public.sales_invoice_lines;
create trigger sales_invoice_lines_touch_updated_at
before update on public.sales_invoice_lines
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists sales_invoice_lines_company_guard on public.sales_invoice_lines;
create trigger sales_invoice_lines_company_guard
before insert or update on public.sales_invoice_lines
for each row execute function public.finance_document_line_company_guard();

drop trigger if exists vendor_bills_assign_reference on public.vendor_bills;
create trigger vendor_bills_assign_reference
before insert or update on public.vendor_bills
for each row execute function public.vendor_bill_assign_reference();

drop trigger if exists vendor_bills_touch_updated_at on public.vendor_bills;
create trigger vendor_bills_touch_updated_at
before update on public.vendor_bills
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists vendor_bill_lines_touch_updated_at on public.vendor_bill_lines;
create trigger vendor_bill_lines_touch_updated_at
before update on public.vendor_bill_lines
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists vendor_bill_lines_company_guard on public.vendor_bill_lines;
create trigger vendor_bill_lines_company_guard
before insert or update on public.vendor_bill_lines
for each row execute function public.finance_document_line_company_guard();

alter table public.sales_invoices enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.vendor_bills enable row level security;
alter table public.vendor_bill_lines enable row level security;
alter table public.document_number_counters enable row level security;

drop policy if exists sales_invoices_select on public.sales_invoices;
create policy sales_invoices_select
on public.sales_invoices
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists sales_invoices_insert on public.sales_invoices;
create policy sales_invoices_insert
on public.sales_invoices
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_invoices_update on public.sales_invoices;
create policy sales_invoices_update
on public.sales_invoices
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_invoice_lines_select on public.sales_invoice_lines;
create policy sales_invoice_lines_select
on public.sales_invoice_lines
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists sales_invoice_lines_insert on public.sales_invoice_lines;
create policy sales_invoice_lines_insert
on public.sales_invoice_lines
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_invoice_lines_update on public.sales_invoice_lines;
create policy sales_invoice_lines_update
on public.sales_invoice_lines
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_bills_select on public.vendor_bills;
create policy vendor_bills_select
on public.vendor_bills
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists vendor_bills_insert on public.vendor_bills;
create policy vendor_bills_insert
on public.vendor_bills
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_bills_update on public.vendor_bills;
create policy vendor_bills_update
on public.vendor_bills
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_bill_lines_select on public.vendor_bill_lines;
create policy vendor_bill_lines_select
on public.vendor_bill_lines
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists vendor_bill_lines_insert on public.vendor_bill_lines;
create policy vendor_bill_lines_insert
on public.vendor_bill_lines
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_bill_lines_update on public.vendor_bill_lines;
create policy vendor_bill_lines_update
on public.vendor_bill_lines
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists document_number_counters_select on public.document_number_counters;
create policy document_number_counters_select
on public.document_number_counters
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists document_number_counters_write on public.document_number_counters;
create policy document_number_counters_write
on public.document_number_counters
for all
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

revoke all on public.document_number_counters from public, anon;
revoke all on public.sales_invoices from public, anon;
revoke all on public.sales_invoice_lines from public, anon;
revoke all on public.vendor_bills from public, anon;
revoke all on public.vendor_bill_lines from public, anon;

grant select, insert, update on public.document_number_counters to authenticated;
grant select, insert, update on public.sales_invoices to authenticated;
grant select, insert, update on public.sales_invoice_lines to authenticated;
grant select, insert, update on public.vendor_bills to authenticated;
grant select, insert, update on public.vendor_bill_lines to authenticated;

comment on table public.sales_invoices is
  'Step 2 finance-document foundation. Sales invoices use Stockwise-generated internal references as the primary outbound AR document identity.';

comment on table public.vendor_bills is
  'Step 2 finance-document foundation. Vendor bills keep a Stockwise internal reference plus the supplier invoice reference as separate documentary identity.';

comment on column public.sales_invoices.internal_reference is
  'System-generated internal business reference in the format PREFIX-INV00001.';

comment on column public.vendor_bills.internal_reference is
  'System-generated internal business reference in the format PREFIX-VB00001.';

comment on column public.vendor_bills.supplier_invoice_reference is
  'Supplier-provided invoice reference preserved exactly as received.';

comment on column public.vendor_bills.supplier_invoice_date is
  'Supplier-provided invoice date preserved for documentary fidelity.';

comment on column public.vendor_bills.supplier_invoice_reference_normalized is
  'Trimmed and uppercased helper used for duplicate detection without changing the raw supplier reference.';
