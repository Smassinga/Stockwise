alter table public.document_number_counters
  drop constraint if exists document_number_counters_document_type_check;

alter table public.document_number_counters
  add constraint document_number_counters_document_type_check
  check (document_type in ('sales_invoice', 'vendor_bill', 'vendor_credit_note', 'vendor_debit_note'));

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

  if not public.finance_documents_can_write(p_company_id) then
    raise exception 'finance_document_company_write_denied';
  end if;

  if p_document_type not in ('sales_invoice', 'vendor_bill', 'vendor_credit_note', 'vendor_debit_note') then
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
    when p_document_type = 'vendor_credit_note' then 'VCN'
    when p_document_type = 'vendor_debit_note' then 'VDN'
    else 'DOC'
  end;

  return v_prefix || '-' || v_code || lpad(v_sequence::text, 5, '0');
end;
$$;

create table if not exists public.vendor_credit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  original_vendor_bill_id uuid not null references public.vendor_bills(id) on delete restrict,
  supplier_id uuid null references public.suppliers(id) on delete set null,
  internal_reference text not null,
  supplier_document_reference text null,
  supplier_document_reference_normalized text generated always as (public.normalize_supplier_invoice_reference(supplier_document_reference)) stored,
  note_date date not null default current_date,
  due_date date null,
  currency_code text not null default 'MZN',
  fx_to_base numeric not null default 1 check (fx_to_base > 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total_amount numeric not null default 0 check (total_amount >= 0),
  subtotal_base numeric not null default 0 check (subtotal_base >= 0),
  tax_total_base numeric not null default 0 check (tax_total_base >= 0),
  total_amount_base numeric not null default 0 check (total_amount_base >= 0),
  adjustment_reason_text text not null default '',
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
  constraint vendor_credit_notes_internal_reference_format
    check (internal_reference ~ '^[A-Z0-9]{3}-VCN[0-9]{5}$')
);

create unique index if not exists vendor_credit_notes_company_internal_reference_key
  on public.vendor_credit_notes (company_id, internal_reference);

create index if not exists vendor_credit_notes_original_bill_idx
  on public.vendor_credit_notes (company_id, original_vendor_bill_id);

create table if not exists public.vendor_credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_credit_note_id uuid not null references public.vendor_credit_notes(id) on delete cascade,
  vendor_bill_line_id uuid null references public.vendor_bill_lines(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 0,
  unit_cost numeric not null default 0,
  tax_rate numeric null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_credit_note_lines_nonnegative_fields
    check (
      qty >= 0
      and unit_cost >= 0
      and (tax_rate is null or tax_rate >= 0)
      and tax_amount >= 0
      and line_total >= 0
    )
);

create index if not exists vendor_credit_note_lines_note_idx
  on public.vendor_credit_note_lines (vendor_credit_note_id, sort_order, created_at);

create table if not exists public.vendor_debit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  original_vendor_bill_id uuid not null references public.vendor_bills(id) on delete restrict,
  supplier_id uuid null references public.suppliers(id) on delete set null,
  internal_reference text not null,
  supplier_document_reference text null,
  supplier_document_reference_normalized text generated always as (public.normalize_supplier_invoice_reference(supplier_document_reference)) stored,
  note_date date not null default current_date,
  due_date date not null,
  currency_code text not null default 'MZN',
  fx_to_base numeric not null default 1 check (fx_to_base > 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total_amount numeric not null default 0 check (total_amount >= 0),
  subtotal_base numeric not null default 0 check (subtotal_base >= 0),
  tax_total_base numeric not null default 0 check (tax_total_base >= 0),
  total_amount_base numeric not null default 0 check (total_amount_base >= 0),
  adjustment_reason_text text not null default '',
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
  constraint vendor_debit_notes_internal_reference_format
    check (internal_reference ~ '^[A-Z0-9]{3}-VDN[0-9]{5}$')
);

create unique index if not exists vendor_debit_notes_company_internal_reference_key
  on public.vendor_debit_notes (company_id, internal_reference);

create index if not exists vendor_debit_notes_original_bill_idx
  on public.vendor_debit_notes (company_id, original_vendor_bill_id);

create table if not exists public.vendor_debit_note_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_debit_note_id uuid not null references public.vendor_debit_notes(id) on delete cascade,
  vendor_bill_line_id uuid null references public.vendor_bill_lines(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 0,
  unit_cost numeric not null default 0,
  tax_rate numeric null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_debit_note_lines_nonnegative_fields
    check (
      qty >= 0
      and unit_cost >= 0
      and (tax_rate is null or tax_rate >= 0)
      and tax_amount >= 0
      and line_total >= 0
    )
);

create index if not exists vendor_debit_note_lines_note_idx
  on public.vendor_debit_note_lines (vendor_debit_note_id, sort_order, created_at);

create or replace function public.vendor_note_line_company_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_parent_company_id uuid;
  v_original_bill_id uuid;
  v_vendor_bill_id uuid;
begin
  if tg_table_name = 'vendor_credit_note_lines' then
    select vcn.company_id, vcn.original_vendor_bill_id
      into v_parent_company_id, v_original_bill_id
    from public.vendor_credit_notes vcn
    where vcn.id = new.vendor_credit_note_id;
  elsif tg_table_name = 'vendor_debit_note_lines' then
    select vdn.company_id, vdn.original_vendor_bill_id
      into v_parent_company_id, v_original_bill_id
    from public.vendor_debit_notes vdn
    where vdn.id = new.vendor_debit_note_id;
  else
    raise exception using
      message = format('vendor_note_line_company_guard does not support table %s.', tg_table_name);
  end if;

  if v_parent_company_id is null then
    raise exception 'finance_document_parent_not_found';
  end if;

  if new.vendor_bill_line_id is not null then
    select vbl.vendor_bill_id
      into v_vendor_bill_id
    from public.vendor_bill_lines vbl
    where vbl.id = new.vendor_bill_line_id;

    if v_vendor_bill_id is null then
      raise exception using
        message = 'Vendor adjustment lines must reference an existing vendor bill line.';
    end if;

    if v_vendor_bill_id is distinct from v_original_bill_id then
      raise exception using
        message = 'Vendor adjustment lines must reference lines from the original vendor bill.';
    end if;
  end if;

  new.company_id := v_parent_company_id;
  return new;
end;
$$;

create or replace function public.vendor_note_line_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.line_total, 0) = 0
     and coalesce(new.qty, 0) > 0
     and coalesce(new.unit_cost, 0) > 0 then
    raise exception using
      message = 'Vendor adjustment lines with quantity and unit cost above zero cannot have a zero line total.';
  end if;

  if coalesce(new.line_total, 0) < coalesce(new.tax_amount, 0) then
    raise exception using
      message = 'Vendor adjustment line tax cannot exceed the stored line total.';
  end if;

  if coalesce(new.qty, 0) = 0
     and coalesce(new.line_total, 0) > 0
     and coalesce(new.unit_cost, 0) <= 0 then
    raise exception using
      message = 'Vendor adjustment lines with a value-only adjustment must keep a positive unit cost.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_credit_note_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'vendor_credit_note_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'vendor_credit_note');
  end if;

  if new.document_workflow_status = 'posted' then
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

create or replace function public.vendor_debit_note_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'vendor_debit_note_internal_reference_immutable';
  end if;

  if new.internal_reference is null or btrim(new.internal_reference) = '' then
    new.internal_reference := public.next_finance_document_reference(new.company_id, 'vendor_debit_note');
  end if;

  if new.document_workflow_status = 'posted' then
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

create or replace function public.vendor_credit_note_validate_post()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_bill public.vendor_bills%rowtype;
  v_rollup record;
  v_over_credit boolean;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'posted'
     or coalesce(old.document_workflow_status, 'draft') = 'posted' then
    return new;
  end if;

  select vb.*
    into v_bill
  from public.vendor_bills vb
  where vb.id = new.original_vendor_bill_id;

  if v_bill.id is null then
    raise exception using
      message = 'Vendor credit notes require an original vendor bill.';
  end if;

  if v_bill.document_workflow_status <> 'posted' then
    raise exception using
      message = 'Supplier credit notes can only be posted against a posted vendor bill.';
  end if;

  select
    count(*)::integer as line_count,
    coalesce(sum(coalesce(vcnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(vcnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(vcnl.line_total, 0) + coalesce(vcnl.tax_amount, 0)), 0)::numeric as total_amount
    into v_rollup
  from public.vendor_credit_note_lines vcnl
  where vcnl.vendor_credit_note_id = new.id;

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Supplier credit notes require at least one line before posting.';
  end if;

  select exists (
    with existing_credit_rollup as (
      select
        vcnl_existing.vendor_bill_line_id,
        coalesce(sum(coalesce(vcnl_existing.qty, 0)), 0)::numeric as credited_qty,
        coalesce(sum(coalesce(vcnl_existing.line_total, 0)), 0)::numeric as credited_line_total,
        coalesce(sum(coalesce(vcnl_existing.tax_amount, 0)), 0)::numeric as credited_tax_amount
      from public.vendor_credit_note_lines vcnl_existing
      join public.vendor_credit_notes vcn_existing
        on vcn_existing.id = vcnl_existing.vendor_credit_note_id
      where vcn_existing.original_vendor_bill_id = new.original_vendor_bill_id
        and vcn_existing.document_workflow_status = 'posted'
        and vcn_existing.id <> new.id
        and vcnl_existing.vendor_bill_line_id is not null
      group by vcnl_existing.vendor_bill_line_id
    )
    select 1
    from public.vendor_credit_note_lines vcnl_current
    join public.vendor_bill_lines vbl
      on vbl.id = vcnl_current.vendor_bill_line_id
    left join existing_credit_rollup ecr
      on ecr.vendor_bill_line_id = vcnl_current.vendor_bill_line_id
    where vcnl_current.vendor_credit_note_id = new.id
      and (
        coalesce(vcnl_current.qty, 0) > greatest(coalesce(vbl.qty, 0) - coalesce(ecr.credited_qty, 0), 0) + 0.0001
        or coalesce(vcnl_current.line_total, 0) > greatest(coalesce(vbl.line_total, 0) - coalesce(ecr.credited_line_total, 0), 0) + 0.005
        or coalesce(vcnl_current.tax_amount, 0) > greatest(coalesce(vbl.tax_amount, 0) - coalesce(ecr.credited_tax_amount, 0), 0) + 0.005
      )
  ) into v_over_credit;

  if coalesce(v_over_credit, false) then
    raise exception using
      message = 'Supplier credit note lines exceed the remaining quantity, taxable value, or tax still available on the original vendor bill.';
  end if;

  new.supplier_id := coalesce(new.supplier_id, v_bill.supplier_id);
  new.currency_code := coalesce(new.currency_code, v_bill.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_bill.fx_to_base, 1);
  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_base := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_base := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_base := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.total_amount, 0) <= 0 then
    raise exception using
      message = 'Supplier credit notes require a positive total before posting.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_debit_note_validate_post()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_bill public.vendor_bills%rowtype;
  v_rollup record;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'posted'
     or coalesce(old.document_workflow_status, 'draft') = 'posted' then
    return new;
  end if;

  select vb.*
    into v_bill
  from public.vendor_bills vb
  where vb.id = new.original_vendor_bill_id;

  if v_bill.id is null then
    raise exception using
      message = 'Vendor debit notes require an original vendor bill.';
  end if;

  if v_bill.document_workflow_status <> 'posted' then
    raise exception using
      message = 'Supplier debit notes can only be posted against a posted vendor bill.';
  end if;

  select
    count(*)::integer as line_count,
    coalesce(sum(coalesce(vdnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(vdnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(vdnl.line_total, 0) + coalesce(vdnl.tax_amount, 0)), 0)::numeric as total_amount
    into v_rollup
  from public.vendor_debit_note_lines vdnl
  where vdnl.vendor_debit_note_id = new.id;

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Supplier debit notes require at least one line before posting.';
  end if;

  new.supplier_id := coalesce(new.supplier_id, v_bill.supplier_id);
  new.currency_code := coalesce(new.currency_code, v_bill.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_bill.fx_to_base, 1);
  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_base := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_base := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_base := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.total_amount, 0) <= 0 then
    raise exception using
      message = 'Supplier debit notes require a positive total before posting.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_credit_note_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Supplier credit notes must start in draft status.';
    end if;
    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Supplier credit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Supplier credit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Supplier credit note status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Supplier credit note status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if old.document_workflow_status = 'posted'
     and row(
       old.company_id,
       old.original_vendor_bill_id,
       old.supplier_id,
       old.internal_reference,
       old.supplier_document_reference,
       old.note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_base,
       old.tax_total_base,
       old.total_amount_base,
       old.adjustment_reason_text,
       old.posted_at,
       old.posted_by,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.original_vendor_bill_id,
       new.supplier_id,
       new.internal_reference,
       new.supplier_document_reference,
       new.note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_base,
       new.tax_total_base,
       new.total_amount_base,
       new.adjustment_reason_text,
       new.posted_at,
       new.posted_by,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Posted supplier credit notes cannot change linkage, references, dates, currency, totals, or adjustment reasons.';
  end if;

  if old.document_workflow_status = 'voided'
     and row(
       old.company_id,
       old.original_vendor_bill_id,
       old.supplier_id,
       old.internal_reference,
       old.supplier_document_reference,
       old.note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_base,
       old.tax_total_base,
       old.total_amount_base,
       old.adjustment_reason_text,
       old.posted_at,
       old.posted_by,
       old.voided_at,
       old.voided_by,
       old.void_reason,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.original_vendor_bill_id,
       new.supplier_id,
       new.internal_reference,
       new.supplier_document_reference,
       new.note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_base,
       new.tax_total_base,
       new.total_amount_base,
       new.adjustment_reason_text,
       new.posted_at,
       new.posted_by,
       new.voided_at,
       new.voided_by,
       new.void_reason,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Voided supplier credit notes are immutable.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_debit_note_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Supplier debit notes must start in draft status.';
    end if;
    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Supplier debit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Supplier debit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Supplier debit note status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Supplier debit note status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if old.document_workflow_status = 'posted'
     and row(
       old.company_id,
       old.original_vendor_bill_id,
       old.supplier_id,
       old.internal_reference,
       old.supplier_document_reference,
       old.note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_base,
       old.tax_total_base,
       old.total_amount_base,
       old.adjustment_reason_text,
       old.posted_at,
       old.posted_by,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.original_vendor_bill_id,
       new.supplier_id,
       new.internal_reference,
       new.supplier_document_reference,
       new.note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_base,
       new.tax_total_base,
       new.total_amount_base,
       new.adjustment_reason_text,
       new.posted_at,
       new.posted_by,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Posted supplier debit notes cannot change linkage, references, dates, currency, totals, or adjustment reasons.';
  end if;

  if old.document_workflow_status = 'voided'
     and row(
       old.company_id,
       old.original_vendor_bill_id,
       old.supplier_id,
       old.internal_reference,
       old.supplier_document_reference,
       old.note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_base,
       old.tax_total_base,
       old.total_amount_base,
       old.adjustment_reason_text,
       old.posted_at,
       old.posted_by,
       old.voided_at,
       old.voided_by,
       old.void_reason,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.original_vendor_bill_id,
       new.supplier_id,
       new.internal_reference,
       new.supplier_document_reference,
       new.note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_base,
       new.tax_total_base,
       new.total_amount_base,
       new.adjustment_reason_text,
       new.posted_at,
       new.posted_by,
       new.voided_at,
       new.voided_by,
       new.void_reason,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Voided supplier debit notes are immutable.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_note_lines_parent_status_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_note_id uuid;
  v_status text;
begin
  if tg_table_name = 'vendor_credit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.vendor_credit_note_id;
    else
      v_note_id := new.vendor_credit_note_id;
    end if;

    select vcn.document_workflow_status
      into v_status
    from public.vendor_credit_notes vcn
    where vcn.id = v_note_id;
  elsif tg_table_name = 'vendor_debit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.vendor_debit_note_id;
    else
      v_note_id := new.vendor_debit_note_id;
    end if;

    select vdn.document_workflow_status
      into v_status
    from public.vendor_debit_notes vdn
    where vdn.id = v_note_id;
  else
    raise exception using
      message = format('vendor_note_lines_parent_status_guard does not support table %s.', tg_table_name);
  end if;

  if v_status in ('posted', 'voided') then
    raise exception using
      message = 'Posted or voided supplier adjustment notes cannot change line items.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.post_vendor_credit_note(p_note_id uuid)
returns public.vendor_credit_notes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_note public.vendor_credit_notes;
begin
  select vcn.*
    into v_note
  from public.vendor_credit_notes vcn
  where vcn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Supplier credit note not found.';
  end if;

  if not public.finance_documents_can_write(v_note.company_id) then
    raise exception using
      message = 'Supplier credit note post access denied.';
  end if;

  update public.vendor_credit_notes vcn
     set document_workflow_status = 'posted'
   where vcn.id = p_note_id
  returning vcn.* into v_note;

  return v_note;
end;
$$;

create or replace function public.post_vendor_debit_note(p_note_id uuid)
returns public.vendor_debit_notes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_note public.vendor_debit_notes;
begin
  select vdn.*
    into v_note
  from public.vendor_debit_notes vdn
  where vdn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Supplier debit note not found.';
  end if;

  if not public.finance_documents_can_write(v_note.company_id) then
    raise exception using
      message = 'Supplier debit note post access denied.';
  end if;

  update public.vendor_debit_notes vdn
     set document_workflow_status = 'posted'
   where vdn.id = p_note_id
  returning vdn.* into v_note;

  return v_note;
end;
$$;

alter table public.finance_document_events
  drop constraint if exists finance_document_events_document_kind_check;

alter table public.finance_document_events
  add constraint finance_document_events_document_kind_check
  check (document_kind in ('sales_invoice', 'sales_credit_note', 'sales_debit_note', 'vendor_bill', 'vendor_credit_note', 'vendor_debit_note', 'saft_moz_export'));

create or replace function public.append_finance_document_event(
  p_company_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_event_type text,
  p_from_status text default null,
  p_to_status text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid;
begin
  if p_company_id is null then
    raise exception using
      message = 'Finance document events require a company id.';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception using
      message = 'Finance document event write access denied.';
  end if;

  if p_document_kind not in ('sales_invoice', 'sales_credit_note', 'sales_debit_note', 'vendor_bill', 'vendor_credit_note', 'vendor_debit_note', 'saft_moz_export') then
    raise exception using
      message = format('Unsupported finance document event kind: %s.', coalesce(p_document_kind, '<null>'));
  end if;

  if p_document_id is null then
    raise exception using
      message = 'Finance document events require a document id.';
  end if;

  if nullif(btrim(coalesce(p_event_type, '')), '') is null then
    raise exception using
      message = 'Finance document events require an event type.';
  end if;

  insert into public.finance_document_events (
    company_id,
    document_kind,
    document_id,
    event_type,
    from_status,
    to_status,
    actor_user_id,
    payload
  )
  values (
    p_company_id,
    p_document_kind,
    p_document_id,
    btrim(p_event_type),
    p_from_status,
    p_to_status,
    auth.uid(),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.finance_document_header_event_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_document_kind text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_payload jsonb;
  v_row jsonb;
begin
  v_document_kind := case tg_table_name
    when 'sales_invoices' then 'sales_invoice'
    when 'sales_credit_notes' then 'sales_credit_note'
    when 'sales_debit_notes' then 'sales_debit_note'
    when 'vendor_bills' then 'vendor_bill'
    when 'vendor_credit_notes' then 'vendor_credit_note'
    when 'vendor_debit_notes' then 'vendor_debit_note'
    else null
  end;

  if v_document_kind is null then
    raise exception using
      message = format('finance_document_header_event_journal does not support table %s.', tg_table_name);
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'draft_created';
    v_from_status := null;
    v_to_status := new.document_workflow_status;
  elsif tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    v_from_status := old.document_workflow_status;
    v_to_status := new.document_workflow_status;
    v_event_type := case new.document_workflow_status
      when 'issued' then 'issued'
      when 'posted' then 'posted'
      when 'voided' then 'voided'
      else 'status_changed'
    end;
  else
    return null;
  end if;

  v_row := to_jsonb(new);
  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'internal_reference', v_row ->> 'internal_reference',
      'document_status', v_row ->> 'document_workflow_status',
      'source_origin', v_row ->> 'source_origin',
      'supplier_reference',
      coalesce(v_row ->> 'supplier_invoice_reference', v_row ->> 'supplier_document_reference')
    )
  );

  perform public.append_finance_document_event(
    new.company_id,
    v_document_kind,
    new.id,
    v_event_type,
    v_from_status,
    v_to_status,
    v_payload
  );

  return null;
end;
$$;

drop trigger if exists ai_10_vendor_bill_event_journal on public.vendor_bills;
create trigger ai_10_vendor_bill_event_journal
after insert on public.vendor_bills
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists au_10_vendor_bill_event_journal on public.vendor_bills;
create trigger au_10_vendor_bill_event_journal
after update on public.vendor_bills
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists biu_10_vendor_credit_note_assign_reference on public.vendor_credit_notes;
create trigger biu_10_vendor_credit_note_assign_reference
before insert or update on public.vendor_credit_notes
for each row execute function public.vendor_credit_note_assign_reference();

drop trigger if exists biu_30_vendor_credit_note_validate_post on public.vendor_credit_notes;
create trigger biu_30_vendor_credit_note_validate_post
before update on public.vendor_credit_notes
for each row execute function public.vendor_credit_note_validate_post();

drop trigger if exists biu_40_vendor_credit_note_hardening on public.vendor_credit_notes;
create trigger biu_40_vendor_credit_note_hardening
before insert or update on public.vendor_credit_notes
for each row execute function public.vendor_credit_note_hardening_guard();

drop trigger if exists bu_90_vendor_credit_note_touch_updated_at on public.vendor_credit_notes;
create trigger bu_90_vendor_credit_note_touch_updated_at
before update on public.vendor_credit_notes
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists biu_10_vendor_credit_note_lines_company_guard on public.vendor_credit_note_lines;
create trigger biu_10_vendor_credit_note_lines_company_guard
before insert or update on public.vendor_credit_note_lines
for each row execute function public.vendor_note_line_company_guard();

drop trigger if exists biu_20_vendor_credit_note_lines_hardening on public.vendor_credit_note_lines;
create trigger biu_20_vendor_credit_note_lines_hardening
before insert or update on public.vendor_credit_note_lines
for each row execute function public.vendor_note_line_hardening_guard();

drop trigger if exists biu_30_vendor_credit_note_lines_parent_status_guard on public.vendor_credit_note_lines;
create trigger biu_30_vendor_credit_note_lines_parent_status_guard
before insert or update on public.vendor_credit_note_lines
for each row execute function public.vendor_note_lines_parent_status_guard();

drop trigger if exists bd_30_vendor_credit_note_lines_parent_status_guard on public.vendor_credit_note_lines;
create trigger bd_30_vendor_credit_note_lines_parent_status_guard
before delete on public.vendor_credit_note_lines
for each row execute function public.vendor_note_lines_parent_status_guard();

drop trigger if exists bu_90_vendor_credit_note_lines_touch_updated_at on public.vendor_credit_note_lines;
create trigger bu_90_vendor_credit_note_lines_touch_updated_at
before update on public.vendor_credit_note_lines
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists ai_10_vendor_credit_note_event_journal on public.vendor_credit_notes;
create trigger ai_10_vendor_credit_note_event_journal
after insert on public.vendor_credit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists au_10_vendor_credit_note_event_journal on public.vendor_credit_notes;
create trigger au_10_vendor_credit_note_event_journal
after update on public.vendor_credit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists biu_10_vendor_debit_note_assign_reference on public.vendor_debit_notes;
create trigger biu_10_vendor_debit_note_assign_reference
before insert or update on public.vendor_debit_notes
for each row execute function public.vendor_debit_note_assign_reference();

drop trigger if exists biu_30_vendor_debit_note_validate_post on public.vendor_debit_notes;
create trigger biu_30_vendor_debit_note_validate_post
before update on public.vendor_debit_notes
for each row execute function public.vendor_debit_note_validate_post();

drop trigger if exists biu_40_vendor_debit_note_hardening on public.vendor_debit_notes;
create trigger biu_40_vendor_debit_note_hardening
before insert or update on public.vendor_debit_notes
for each row execute function public.vendor_debit_note_hardening_guard();

drop trigger if exists bu_90_vendor_debit_note_touch_updated_at on public.vendor_debit_notes;
create trigger bu_90_vendor_debit_note_touch_updated_at
before update on public.vendor_debit_notes
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists biu_10_vendor_debit_note_lines_company_guard on public.vendor_debit_note_lines;
create trigger biu_10_vendor_debit_note_lines_company_guard
before insert or update on public.vendor_debit_note_lines
for each row execute function public.vendor_note_line_company_guard();

drop trigger if exists biu_20_vendor_debit_note_lines_hardening on public.vendor_debit_note_lines;
create trigger biu_20_vendor_debit_note_lines_hardening
before insert or update on public.vendor_debit_note_lines
for each row execute function public.vendor_note_line_hardening_guard();

drop trigger if exists biu_30_vendor_debit_note_lines_parent_status_guard on public.vendor_debit_note_lines;
create trigger biu_30_vendor_debit_note_lines_parent_status_guard
before insert or update on public.vendor_debit_note_lines
for each row execute function public.vendor_note_lines_parent_status_guard();

drop trigger if exists bd_30_vendor_debit_note_lines_parent_status_guard on public.vendor_debit_note_lines;
create trigger bd_30_vendor_debit_note_lines_parent_status_guard
before delete on public.vendor_debit_note_lines
for each row execute function public.vendor_note_lines_parent_status_guard();

drop trigger if exists bu_90_vendor_debit_note_lines_touch_updated_at on public.vendor_debit_note_lines;
create trigger bu_90_vendor_debit_note_lines_touch_updated_at
before update on public.vendor_debit_note_lines
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists ai_10_vendor_debit_note_event_journal on public.vendor_debit_notes;
create trigger ai_10_vendor_debit_note_event_journal
after insert on public.vendor_debit_notes
for each row execute function public.finance_document_header_event_journal();

drop trigger if exists au_10_vendor_debit_note_event_journal on public.vendor_debit_notes;
create trigger au_10_vendor_debit_note_event_journal
after update on public.vendor_debit_notes
for each row execute function public.finance_document_header_event_journal();

alter table public.vendor_credit_notes enable row level security;
alter table public.vendor_credit_note_lines enable row level security;
alter table public.vendor_debit_notes enable row level security;
alter table public.vendor_debit_note_lines enable row level security;

drop policy if exists vendor_credit_notes_select on public.vendor_credit_notes;
create policy vendor_credit_notes_select
on public.vendor_credit_notes
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists vendor_credit_notes_insert on public.vendor_credit_notes;
create policy vendor_credit_notes_insert
on public.vendor_credit_notes
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_credit_notes_update on public.vendor_credit_notes;
create policy vendor_credit_notes_update
on public.vendor_credit_notes
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_credit_note_lines_select on public.vendor_credit_note_lines;
create policy vendor_credit_note_lines_select
on public.vendor_credit_note_lines
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists vendor_credit_note_lines_insert on public.vendor_credit_note_lines;
create policy vendor_credit_note_lines_insert
on public.vendor_credit_note_lines
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_credit_note_lines_update on public.vendor_credit_note_lines;
create policy vendor_credit_note_lines_update
on public.vendor_credit_note_lines
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_debit_notes_select on public.vendor_debit_notes;
create policy vendor_debit_notes_select
on public.vendor_debit_notes
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists vendor_debit_notes_insert on public.vendor_debit_notes;
create policy vendor_debit_notes_insert
on public.vendor_debit_notes
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_debit_notes_update on public.vendor_debit_notes;
create policy vendor_debit_notes_update
on public.vendor_debit_notes
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_debit_note_lines_select on public.vendor_debit_note_lines;
create policy vendor_debit_note_lines_select
on public.vendor_debit_note_lines
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists vendor_debit_note_lines_insert on public.vendor_debit_note_lines;
create policy vendor_debit_note_lines_insert
on public.vendor_debit_note_lines
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists vendor_debit_note_lines_update on public.vendor_debit_note_lines;
create policy vendor_debit_note_lines_update
on public.vendor_debit_note_lines
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

revoke all on public.vendor_credit_notes from public, anon;
revoke all on public.vendor_credit_note_lines from public, anon;
revoke all on public.vendor_debit_notes from public, anon;
revoke all on public.vendor_debit_note_lines from public, anon;

grant select, insert, update on public.vendor_credit_notes to authenticated;
grant select, insert, update on public.vendor_credit_note_lines to authenticated;
grant select, insert, update on public.vendor_debit_notes to authenticated;
grant select, insert, update on public.vendor_debit_note_lines to authenticated;

revoke all on function public.post_vendor_credit_note(uuid) from public, anon;
revoke all on function public.post_vendor_debit_note(uuid) from public, anon;
grant execute on function public.post_vendor_credit_note(uuid) to authenticated;
grant execute on function public.post_vendor_debit_note(uuid) to authenticated;

drop view if exists public.v_vendor_bill_state;

create view public.v_vendor_bill_state as
with line_rollup as (
  select
    vbl.vendor_bill_id,
    count(*)::integer as line_count
  from public.vendor_bill_lines vbl
  group by vbl.vendor_bill_id
),
duplicate_groups as (
  select
    vb.company_id,
    vb.supplier_id,
    vb.supplier_invoice_reference_normalized
  from public.vendor_bills vb
  where vb.document_workflow_status <> 'voided'
    and vb.supplier_invoice_reference_normalized is not null
  group by vb.company_id, vb.supplier_id, vb.supplier_invoice_reference_normalized
  having count(*) > 1
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as vendor_bill_id,
    coalesce(sum(ct.amount_base), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'VB'
    and ct.type = 'purchase_payment'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as vendor_bill_id,
    coalesce(sum(bt.amount_base), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'VB'
  group by bt.ref_id
),
credit_rollup as (
  select
    vcn.company_id,
    vcn.original_vendor_bill_id as vendor_bill_id,
    count(*) filter (where vcn.document_workflow_status = 'posted')::integer as credit_note_count,
    coalesce(sum(coalesce(vcn.total_amount_base, 0)) filter (where vcn.document_workflow_status = 'posted'), 0)::numeric as credited_total_base
  from public.vendor_credit_notes vcn
  group by vcn.company_id, vcn.original_vendor_bill_id
),
debit_rollup as (
  select
    vdn.company_id,
    vdn.original_vendor_bill_id as vendor_bill_id,
    count(*) filter (where vdn.document_workflow_status = 'posted')::integer as debit_note_count,
    coalesce(sum(coalesce(vdn.total_amount_base, 0)) filter (where vdn.document_workflow_status = 'posted'), 0)::numeric as debited_total_base
  from public.vendor_debit_notes vdn
  group by vdn.company_id, vdn.original_vendor_bill_id
)
select
  vb.id,
  vb.company_id,
  vb.purchase_order_id,
  vb.supplier_id,
  vb.internal_reference,
  vb.supplier_invoice_reference,
  vb.supplier_invoice_reference_normalized,
  coalesce(nullif(vb.supplier_invoice_reference, ''), vb.internal_reference) as primary_reference,
  vb.supplier_invoice_date,
  vb.bill_date,
  vb.due_date,
  coalesce(nullif(s.name, ''), nullif(po.supplier_name, ''), nullif(po.supplier, '')) as counterparty_name,
  po.order_no,
  coalesce(vb.currency_code, 'MZN') as currency_code,
  coalesce(vb.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(vb.subtotal, 0)::numeric as subtotal,
  coalesce(vb.tax_total, 0)::numeric as tax_total,
  coalesce(vb.total_amount, 0)::numeric as total_amount,
  (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))::numeric as total_amount_base,
  vb.document_workflow_status,
  coalesce(lr.line_count, 0) as line_count,
  (dg.company_id is not null) as duplicate_supplier_reference_exists,
  'vendor_bill'::text as financial_anchor,
  coalesce(cr.settled_base, 0)::numeric as cash_paid_base,
  coalesce(br.settled_base, 0)::numeric as bank_paid_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as settled_base,
  coalesce(cnr.credit_note_count, 0)::integer as credit_note_count,
  coalesce(cnr.credited_total_base, 0)::numeric as credited_total_base,
  coalesce(dnr.debit_note_count, 0)::integer as debit_note_count,
  coalesce(dnr.debited_total_base, 0)::numeric as debited_total_base,
  greatest(
    (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
    + coalesce(dnr.debited_total_base, 0)
    - coalesce(cnr.credited_total_base, 0),
    0
  )::numeric as current_legal_total_base,
  greatest(
    greatest(
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - coalesce(cnr.credited_total_base, 0),
      0
    )
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
    0
  )::numeric as outstanding_base,
  case
    when coalesce(cnr.credited_total_base, 0) >= (
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - 0.005
    ) then 'fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'partially_credited'
    else 'not_credited'
  end::text as credit_status,
  case
    when coalesce(cnr.credited_total_base, 0) > 0.005
      and coalesce(dnr.debited_total_base, 0) > 0.005 then 'credited_and_debited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'credited'
    when coalesce(dnr.debited_total_base, 0) > 0.005 then 'debited'
    else 'none'
  end::text as adjustment_status,
  case
    when greatest(
      greatest(
        (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
        + coalesce(dnr.debited_total_base, 0)
        - coalesce(cnr.credited_total_base, 0),
        0
      )
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when vb.due_date is not null
      and vb.due_date < current_date
      and greatest(
        greatest(
          (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
          + coalesce(dnr.debited_total_base, 0)
          - coalesce(cnr.credited_total_base, 0),
          0
        )
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
        0
      ) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end::text as settlement_status,
  case
    when vb.document_workflow_status = 'draft' then 'draft'
    when vb.document_workflow_status = 'voided' then 'voided'
    when coalesce(cnr.credited_total_base, 0) >= (
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - 0.005
    ) then 'posted_fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'posted_partially_credited'
    when greatest(
      greatest(
        (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
        + coalesce(dnr.debited_total_base, 0)
        - coalesce(cnr.credited_total_base, 0),
        0
      )
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'posted_settled'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'posted_partially_settled'
    when vb.due_date is not null and vb.due_date < current_date then 'posted_overdue'
    else 'posted_open'
  end::text as resolution_status
from public.vendor_bills vb
left join public.suppliers s on s.id = vb.supplier_id
left join public.purchase_orders po on po.id = vb.purchase_order_id
left join line_rollup lr on lr.vendor_bill_id = vb.id
left join duplicate_groups dg
  on dg.company_id = vb.company_id
 and dg.supplier_id is not distinct from vb.supplier_id
 and dg.supplier_invoice_reference_normalized = vb.supplier_invoice_reference_normalized
left join cash_rollup cr on cr.vendor_bill_id = vb.id and cr.company_id = vb.company_id
left join bank_rollup br on br.vendor_bill_id = vb.id
left join credit_rollup cnr on cnr.vendor_bill_id = vb.id and cnr.company_id = vb.company_id
left join debit_rollup dnr on dnr.vendor_bill_id = vb.id and dnr.company_id = vb.company_id;

alter view public.v_vendor_bill_state set (security_invoker = true);

grant select on public.v_vendor_bill_state to authenticated;

comment on table public.vendor_credit_notes is
  'Supplier credit notes linked to the original posted vendor bill so AP liability can be reduced without breaking the audit chain.';

comment on table public.vendor_debit_notes is
  'Supplier debit notes linked to the original posted vendor bill so AP liability can increase coherently through the same document chain.';

comment on view public.v_vendor_bill_state is
  'Finance-document settlement read model for vendor bills. Posted vendor bills remain the AP anchor while supplier credit and debit notes adjust the effective legal liability.';
