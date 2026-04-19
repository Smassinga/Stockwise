create or replace function public.sales_invoice_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Sales invoices must start in draft status.';
    end if;

    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('issued', 'voided') then
          raise exception using
            message = format(
              'Sales invoice status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'issued' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Sales invoice status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if old.document_workflow_status in ('issued', 'voided')
     and row(
       old.company_id,
       old.sales_order_id,
       old.customer_id,
       old.internal_reference,
       old.invoice_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount
     ) is distinct from row(
       new.company_id,
       new.sales_order_id,
       new.customer_id,
       new.internal_reference,
       new.invoice_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount
     ) then
    raise exception using
      message = 'Issued or voided sales invoices cannot change company, linkage, reference, dates, currency, FX, or totals.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_bill_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Vendor bills must start in draft status.';
    end if;

    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Vendor bill status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Vendor bill status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Vendor bill status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Vendor bill status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if old.document_workflow_status = 'posted'
     and row(
       old.company_id,
       old.purchase_order_id,
       old.supplier_id,
       old.internal_reference,
       old.supplier_invoice_reference,
       old.supplier_invoice_date,
       old.bill_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.posted_at,
       old.posted_by,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.purchase_order_id,
       new.supplier_id,
       new.internal_reference,
       new.supplier_invoice_reference,
       new.supplier_invoice_date,
       new.bill_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.posted_at,
       new.posted_by,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Posted vendor bills cannot change company, linkage, references, dates, currency, FX, totals, posting audit fields, or creation audit fields.';
  end if;

  if old.document_workflow_status = 'posted'
     and new.document_workflow_status = 'posted'
     and row(
       old.voided_at,
       old.voided_by,
       old.void_reason
     ) is distinct from row(
       new.voided_at,
       new.voided_by,
       new.void_reason
     ) then
    raise exception using
      message = 'Posted vendor bills cannot change void metadata without transitioning to voided.';
  end if;

  if old.document_workflow_status = 'voided'
     and row(
       old.company_id,
       old.purchase_order_id,
       old.supplier_id,
       old.internal_reference,
       old.supplier_invoice_reference,
       old.supplier_invoice_date,
       old.bill_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.posted_at,
       old.posted_by,
       old.voided_at,
       old.voided_by,
       old.void_reason,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.purchase_order_id,
       new.supplier_id,
       new.internal_reference,
       new.supplier_invoice_reference,
       new.supplier_invoice_date,
       new.bill_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.posted_at,
       new.posted_by,
       new.voided_at,
       new.voided_by,
       new.void_reason,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Voided vendor bills cannot change company, linkage, references, dates, currency, FX, totals, or audit fields.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_invoice_line_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.qty = 0 and (new.line_total <> 0 or new.tax_amount <> 0) then
    raise exception using
      message = 'Sales invoice lines with zero quantity must also have zero tax and zero line total.';
  end if;

  if new.line_total = 0 and new.qty > 0 and new.unit_price > 0 then
    raise exception using
      message = 'Sales invoice lines with quantity and unit price above zero cannot have a zero line total.';
  end if;

  if new.line_total < new.tax_amount then
    raise exception using
      message = 'Sales invoice line tax cannot exceed the stored line total.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_bill_line_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.qty = 0 and (new.line_total <> 0 or new.tax_amount <> 0) then
    raise exception using
      message = 'Vendor bill lines with zero quantity must also have zero tax and zero line total.';
  end if;

  if new.line_total = 0 and new.qty > 0 and new.unit_cost > 0 then
    raise exception using
      message = 'Vendor bill lines with quantity and unit cost above zero cannot have a zero line total.';
  end if;

  if new.line_total < new.tax_amount then
    raise exception using
      message = 'Vendor bill line tax cannot exceed the stored line total.';
  end if;

  return new;
end;
$$;

create or replace function public.vendor_bill_lines_parent_post_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_bill_id uuid;
  v_status text;
begin
  v_bill_id := case when tg_op = 'DELETE' then old.vendor_bill_id else new.vendor_bill_id end;

  select vb.document_workflow_status
    into v_status
  from public.vendor_bills vb
  where vb.id = v_bill_id;

  if coalesce(v_status, '') in ('posted', 'voided') then
    raise exception using
      message = 'vendor_bill_lines_parent_locked';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_invoice_lines_nonnegative_fields'
      and conrelid = 'public.sales_invoice_lines'::regclass
  ) then
    alter table public.sales_invoice_lines
      add constraint sales_invoice_lines_nonnegative_fields
      check (
        qty >= 0
        and unit_price >= 0
        and (tax_rate is null or tax_rate >= 0)
        and tax_amount >= 0
        and line_total >= 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendor_bill_lines_nonnegative_fields'
      and conrelid = 'public.vendor_bill_lines'::regclass
  ) then
    alter table public.vendor_bill_lines
      add constraint vendor_bill_lines_nonnegative_fields
      check (
        qty >= 0
        and unit_cost >= 0
        and (tax_rate is null or tax_rate >= 0)
        and tax_amount >= 0
        and line_total >= 0
      );
  end if;
end;
$$;

drop trigger if exists sales_invoices_hardening on public.sales_invoices;
create trigger sales_invoices_hardening
before insert or update on public.sales_invoices
for each row execute function public.sales_invoice_hardening_guard();

drop trigger if exists vendor_bills_hardening on public.vendor_bills;
create trigger vendor_bills_hardening
before insert or update on public.vendor_bills
for each row execute function public.vendor_bill_hardening_guard();

drop trigger if exists sales_invoice_lines_hardening on public.sales_invoice_lines;
create trigger sales_invoice_lines_hardening
before insert or update on public.sales_invoice_lines
for each row execute function public.sales_invoice_line_hardening_guard();

drop trigger if exists vendor_bill_lines_hardening on public.vendor_bill_lines;
create trigger vendor_bill_lines_hardening
before insert or update on public.vendor_bill_lines
for each row execute function public.vendor_bill_line_hardening_guard();

drop trigger if exists biu_30_vendor_bill_lines_parent_post_guard on public.vendor_bill_lines;
create trigger biu_30_vendor_bill_lines_parent_post_guard
before insert or update on public.vendor_bill_lines
for each row execute function public.vendor_bill_lines_parent_post_guard();

drop trigger if exists bd_30_vendor_bill_lines_parent_post_guard on public.vendor_bill_lines;
create trigger bd_30_vendor_bill_lines_parent_post_guard
before delete on public.vendor_bill_lines
for each row execute function public.vendor_bill_lines_parent_post_guard();

comment on function public.sales_invoice_hardening_guard() is
  'Hardens sales invoice workflow transitions and core-field immutability after issue or void.';

comment on function public.vendor_bill_hardening_guard() is
  'Hardens vendor bill workflow transitions and core-field immutability after posting or void.';

comment on function public.sales_invoice_line_hardening_guard() is
  'Applies minimal sales invoice line consistency checks without enforcing exact pricing arithmetic.';

comment on function public.vendor_bill_line_hardening_guard() is
  'Applies minimal vendor bill line consistency checks without enforcing exact cost arithmetic.';

comment on function public.vendor_bill_lines_parent_post_guard() is
  'Prevents insert, update, or delete on vendor bill lines after the parent vendor bill is posted or voided.';
