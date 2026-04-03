alter table public.sales_invoices
  add column if not exists vat_exemption_reason_text text null;

alter table public.sales_credit_notes
  add column if not exists vat_exemption_reason_text text null;

comment on column public.sales_invoices.vat_exemption_reason_text is
  'Manual Mozambique VAT exemption reason captured before invoice issue when exempt lines exist.';

comment on column public.sales_credit_notes.vat_exemption_reason_text is
  'Manual Mozambique VAT exemption reason captured before credit-note issue when exempt lines exist.';

create or replace function public.sales_credit_note_line_rollup(p_note_id uuid)
returns table (
  line_count integer,
  exempt_line_count integer,
  subtotal numeric,
  tax_total numeric,
  total_amount numeric
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    count(*)::integer as line_count,
    count(*) filter (
      where coalesce(scnl.line_total, 0) > 0
        and coalesce(scnl.tax_rate, 0) <= 0
    )::integer as exempt_line_count,
    coalesce(sum(coalesce(scnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(scnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(scnl.line_total, 0) + coalesce(scnl.tax_amount, 0)), 0)::numeric as total_amount
  from public.sales_credit_note_lines scnl
  where scnl.sales_credit_note_id = p_note_id;
$$;

create or replace function public.sales_invoice_validate_issue_mz()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_line_count integer;
  v_exempt_line_count integer;
  v_settings public.company_fiscal_settings%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = new.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  new.vat_exemption_reason_text := nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), '');

  if new.invoice_date is null then
    raise exception 'sales_invoice_issue_requires_invoice_date';
  end if;

  if new.due_date is null then
    raise exception 'sales_invoice_issue_requires_due_date';
  end if;

  if new.due_date < new.invoice_date then
    raise exception 'sales_invoice_issue_invalid_due_date';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception 'sales_invoice_issue_invalid_fx';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception 'sales_invoice_issue_missing_fiscal_identity';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_invoice', new.invoice_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception 'sales_invoice_issue_series_mismatch';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_address_line1_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_seller_snapshot';
  end if;

  if nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_address_line1_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_buyer_snapshot';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_document_language';
  end if;

  if nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_computer_phrase';
  end if;

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception 'sales_invoice_issue_invalid_totals';
  end if;

  select count(*),
         count(*) filter (
           where coalesce(sil.line_total, 0) > 0
             and coalesce(sil.tax_rate, 0) <= 0
         )
    into v_line_count, v_exempt_line_count
  from public.sales_invoice_lines sil
  where sil.sales_invoice_id = new.id;

  if v_line_count < 1 then
    raise exception 'sales_invoice_issue_requires_lines';
  end if;

  if coalesce(v_exempt_line_count, 0) > 0
     and new.vat_exemption_reason_text is null then
    raise exception 'sales_invoice_issue_requires_vat_exemption_reason';
  end if;

  return new;
end;
$$;

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
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
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
       old.total_amount,
       old.source_origin,
       old.moz_document_code,
       old.fiscal_series_code,
       old.fiscal_year,
       old.fiscal_sequence_number,
       old.seller_legal_name_snapshot,
       old.seller_trade_name_snapshot,
       old.seller_nuit_snapshot,
       old.seller_address_line1_snapshot,
       old.seller_address_line2_snapshot,
       old.seller_city_snapshot,
       old.seller_state_snapshot,
       old.seller_postal_code_snapshot,
       old.seller_country_code_snapshot,
       old.buyer_legal_name_snapshot,
       old.buyer_nuit_snapshot,
       old.buyer_address_line1_snapshot,
       old.buyer_address_line2_snapshot,
       old.buyer_city_snapshot,
       old.buyer_state_snapshot,
       old.buyer_postal_code_snapshot,
       old.buyer_country_code_snapshot,
       old.document_language_code_snapshot,
       old.computer_processed_phrase_snapshot,
       old.vat_exemption_reason_text,
       old.subtotal_mzn,
       old.tax_total_mzn,
       old.total_amount_mzn,
       old.compliance_rule_version_snapshot,
       old.issued_at,
       old.issued_by,
       old.voided_at,
       old.voided_by,
       old.void_reason,
       old.created_by,
       old.created_at
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
       new.total_amount,
       new.source_origin,
       new.moz_document_code,
       new.fiscal_series_code,
       new.fiscal_year,
       new.fiscal_sequence_number,
       new.seller_legal_name_snapshot,
       new.seller_trade_name_snapshot,
       new.seller_nuit_snapshot,
       new.seller_address_line1_snapshot,
       new.seller_address_line2_snapshot,
       new.seller_city_snapshot,
       new.seller_state_snapshot,
       new.seller_postal_code_snapshot,
       new.seller_country_code_snapshot,
       new.buyer_legal_name_snapshot,
       new.buyer_nuit_snapshot,
       new.buyer_address_line1_snapshot,
       new.buyer_address_line2_snapshot,
       new.buyer_city_snapshot,
       new.buyer_state_snapshot,
       new.buyer_postal_code_snapshot,
       new.buyer_country_code_snapshot,
       new.document_language_code_snapshot,
       new.computer_processed_phrase_snapshot,
       new.vat_exemption_reason_text,
       new.subtotal_mzn,
       new.tax_total_mzn,
       new.total_amount_mzn,
       new.compliance_rule_version_snapshot,
       new.issued_at,
       new.issued_by,
       new.voided_at,
       new.voided_by,
       new.void_reason,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Issued or voided sales invoices cannot change company, linkage, legal reference, dates, currency, FX, totals, or fiscal snapshots.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_credit_note_snapshot_fiscal_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.sales_invoices%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception 'sales_note_original_invoice_missing';
  end if;

  new.customer_id := coalesce(new.customer_id, v_invoice.customer_id);
  new.currency_code := coalesce(new.currency_code, v_invoice.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_invoice.fx_to_base, 1);
  new.seller_legal_name_snapshot := coalesce(new.seller_legal_name_snapshot, v_invoice.seller_legal_name_snapshot);
  new.seller_trade_name_snapshot := coalesce(new.seller_trade_name_snapshot, v_invoice.seller_trade_name_snapshot);
  new.seller_nuit_snapshot := coalesce(new.seller_nuit_snapshot, v_invoice.seller_nuit_snapshot);
  new.seller_address_line1_snapshot := coalesce(new.seller_address_line1_snapshot, v_invoice.seller_address_line1_snapshot);
  new.seller_address_line2_snapshot := coalesce(new.seller_address_line2_snapshot, v_invoice.seller_address_line2_snapshot);
  new.seller_city_snapshot := coalesce(new.seller_city_snapshot, v_invoice.seller_city_snapshot);
  new.seller_state_snapshot := coalesce(new.seller_state_snapshot, v_invoice.seller_state_snapshot);
  new.seller_postal_code_snapshot := coalesce(new.seller_postal_code_snapshot, v_invoice.seller_postal_code_snapshot);
  new.seller_country_code_snapshot := coalesce(new.seller_country_code_snapshot, v_invoice.seller_country_code_snapshot);
  new.buyer_legal_name_snapshot := coalesce(new.buyer_legal_name_snapshot, v_invoice.buyer_legal_name_snapshot);
  new.buyer_nuit_snapshot := coalesce(new.buyer_nuit_snapshot, v_invoice.buyer_nuit_snapshot);
  new.buyer_address_line1_snapshot := coalesce(new.buyer_address_line1_snapshot, v_invoice.buyer_address_line1_snapshot);
  new.buyer_address_line2_snapshot := coalesce(new.buyer_address_line2_snapshot, v_invoice.buyer_address_line2_snapshot);
  new.buyer_city_snapshot := coalesce(new.buyer_city_snapshot, v_invoice.buyer_city_snapshot);
  new.buyer_state_snapshot := coalesce(new.buyer_state_snapshot, v_invoice.buyer_state_snapshot);
  new.buyer_postal_code_snapshot := coalesce(new.buyer_postal_code_snapshot, v_invoice.buyer_postal_code_snapshot);
  new.buyer_country_code_snapshot := coalesce(new.buyer_country_code_snapshot, v_invoice.buyer_country_code_snapshot);
  new.document_language_code_snapshot := coalesce(new.document_language_code_snapshot, v_invoice.document_language_code_snapshot);
  new.computer_processed_phrase_snapshot := coalesce(new.computer_processed_phrase_snapshot, v_invoice.computer_processed_phrase_snapshot);
  new.compliance_rule_version_snapshot := coalesce(new.compliance_rule_version_snapshot, v_invoice.compliance_rule_version_snapshot);
  new.vat_exemption_reason_text := coalesce(
    nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), ''),
    nullif(btrim(coalesce(v_invoice.vat_exemption_reason_text, '')), ''),
    null
  );

  update public.sales_credit_note_lines scnl
     set product_code_snapshot = coalesce(
           scnl.product_code_snapshot,
           src.invoice_product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           scnl.unit_of_measure_snapshot,
           src.invoice_unit_of_measure_snapshot,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           src.invoice_tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        scnl2.id as sales_credit_note_line_id,
        sil.product_code_snapshot as invoice_product_code_snapshot,
        sil.unit_of_measure_snapshot as invoice_unit_of_measure_snapshot,
        sil.tax_category_code as invoice_tax_category_code,
        nullif(i.sku, '') as item_sku,
        scnl2.item_id::text as item_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_credit_note_lines scnl2
      left join public.sales_invoice_lines sil
        on sil.id is not distinct from scnl2.sales_invoice_line_id
      left join public.items i
        on i.id is not distinct from scnl2.item_id
      where scnl2.sales_credit_note_id = new.id
    ) src
   where scnl.id = src.sales_credit_note_line_id;

  update public.sales_credit_note_lines scnl
     set product_code_snapshot = coalesce(scnl.product_code_snapshot, scnl.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(scnl.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where scnl.sales_credit_note_id = new.id
     and (scnl.product_code_snapshot is null
       or scnl.unit_of_measure_snapshot is null
       or scnl.tax_category_code is null);

  return new;
end;
$$;

create or replace function public.sales_credit_note_validate_issue_mz()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_rollup record;
  v_invoice public.sales_invoices%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_invalid_source_line_count integer;
  v_line_violation_count integer;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception using
      message = 'Credit notes require an original issued sales invoice.';
  end if;

  if v_invoice.document_workflow_status <> 'issued' then
    raise exception using
      message = 'Credit notes can only be issued against an issued sales invoice.';
  end if;

  if v_invoice.company_id <> new.company_id then
    raise exception using
      message = 'Credit note company must match the original sales invoice company.';
  end if;

  if coalesce(new.customer_id, v_invoice.customer_id) is distinct from v_invoice.customer_id then
    raise exception using
      message = 'Credit note customer must match the original sales invoice customer.';
  end if;

  new.vat_exemption_reason_text := nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), '');

  if nullif(btrim(coalesce(new.correction_reason_text, '')), '') is null then
    raise exception using
      message = 'Credit notes require a correction reason.';
  end if;

  if new.credit_note_date is null then
    raise exception using
      message = 'Credit notes require a note date before issue.';
  end if;

  if new.credit_note_date < v_invoice.invoice_date then
    raise exception using
      message = 'Credit note date cannot be earlier than the original sales invoice date.';
  end if;

  if new.currency_code is distinct from v_invoice.currency_code then
    raise exception using
      message = 'Credit note currency must match the original sales invoice currency.';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception using
      message = 'Credit notes require a positive FX rate.';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception using
      message = 'Credit notes require fiscal series, year, and sequence before issue.';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_credit_note', new.credit_note_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception using
        message = 'Credit note fiscal series metadata does not match the active company series.';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null then
    raise exception using
      message = 'Credit notes require seller and buyer fiscal snapshots before issue.';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception using
      message = 'Credit notes require document language and computer-processing wording before issue.';
  end if;

  select *
    into v_rollup
  from public.sales_credit_note_line_rollup(new.id);

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Credit notes require at least one line before issue.';
  end if;

  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_mzn := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception using
      message = 'Credit notes require non-negative totals.';
  end if;

  select count(*)
    into v_invalid_source_line_count
  from public.sales_credit_note_lines scnl
  join public.sales_invoice_lines sil
    on sil.id = scnl.sales_invoice_line_id
  where scnl.sales_credit_note_id = new.id
    and sil.sales_invoice_id is distinct from new.original_sales_invoice_id;

  if coalesce(v_invalid_source_line_count, 0) > 0 then
    raise exception using
      message = 'Credit notes cannot issue with source-linked lines from a different original sales invoice.';
  end if;

  with current_lines as (
    select
      scnl.sales_invoice_line_id,
      coalesce(sum(coalesce(scnl.qty, 0)), 0)::numeric as qty,
      coalesce(sum(coalesce(scnl.line_total, 0)), 0)::numeric as line_total,
      coalesce(sum(coalesce(scnl.tax_amount, 0)), 0)::numeric as tax_amount,
      max(coalesce(scnl.tax_rate, 0))::numeric as tax_rate,
      count(distinct coalesce(scnl.tax_rate, 0))::integer as tax_rate_variant_count
    from public.sales_credit_note_lines scnl
    where scnl.sales_credit_note_id = new.id
    group by scnl.sales_invoice_line_id
  ),
  issued_rollup as (
    select
      scnl.sales_invoice_line_id,
      coalesce(sum(coalesce(scnl.qty, 0)), 0)::numeric as credited_qty,
      coalesce(sum(coalesce(scnl.line_total, 0)), 0)::numeric as credited_line_total,
      coalesce(sum(coalesce(scnl.tax_amount, 0)), 0)::numeric as credited_tax_amount
    from public.sales_credit_note_lines scnl
    join public.sales_credit_notes scn
      on scn.id = scnl.sales_credit_note_id
    where scn.company_id = new.company_id
      and scn.original_sales_invoice_id = new.original_sales_invoice_id
      and scn.document_workflow_status = 'issued'
      and scn.id <> new.id
      and scnl.sales_invoice_line_id is not null
    group by scnl.sales_invoice_line_id
  )
  select count(*)
    into v_line_violation_count
  from current_lines cl
  left join public.sales_invoice_lines sil
    on sil.id = cl.sales_invoice_line_id
  left join issued_rollup ir
    on ir.sales_invoice_line_id = cl.sales_invoice_line_id
  where cl.sales_invoice_line_id is null
     or sil.id is null
     or (coalesce(cl.line_total, 0) <= 0 and coalesce(cl.tax_amount, 0) <= 0)
     or coalesce(cl.tax_rate_variant_count, 0) > 1
     or (coalesce(cl.qty, 0) > 0 and coalesce(sil.qty, 0) <= 0)
     or coalesce(cl.qty, 0) + coalesce(ir.credited_qty, 0) - coalesce(sil.qty, 0) > 0.005
     or coalesce(cl.line_total, 0) + coalesce(ir.credited_line_total, 0) - coalesce(sil.line_total, 0) > 0.005
     or coalesce(cl.tax_amount, 0) + coalesce(ir.credited_tax_amount, 0) - coalesce(sil.tax_amount, 0) > 0.005
     or coalesce(cl.tax_rate, 0) is distinct from coalesce(sil.tax_rate, 0);

  if coalesce(v_line_violation_count, 0) > 0 then
    raise exception using
      message = 'Credit note lines exceed the remaining quantity, taxable value, or tax still available on the original invoice.';
  end if;

  if coalesce(v_rollup.exempt_line_count, 0) > 0
     and new.vat_exemption_reason_text is null then
    raise exception using
      message = 'Credit notes with VAT-exempt lines require a VAT exemption reason before issue.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_credit_note_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id
     and exists (
       select 1
       from public.sales_credit_note_lines scnl
       where scnl.sales_credit_note_id = old.id
         and scnl.sales_invoice_line_id is not null
     ) then
    raise exception using
      message = 'Credit notes cannot change the original sales invoice after source-linked lines exist.';
  end if;

  if tg_op = 'INSERT' and new.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Sales credit notes must be created in draft status.';
  end if;

  if tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    if old.document_workflow_status = 'draft'
       and new.document_workflow_status in ('issued', 'voided') then
      null;
    elsif new.document_workflow_status = old.document_workflow_status then
      null;
    else
      raise exception using
        message = 'Credit note workflow only allows draft to issued or draft to voided transitions.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('issued', 'voided')
     and row(
       old.company_id,
       old.original_sales_invoice_id,
       old.customer_id,
       old.internal_reference,
       old.source_origin,
       old.moz_document_code,
       old.fiscal_series_code,
       old.fiscal_year,
       old.fiscal_sequence_number,
       old.credit_note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_mzn,
       old.tax_total_mzn,
       old.total_amount_mzn,
       old.correction_reason_code,
       old.correction_reason_text,
       old.vat_exemption_reason_text,
       old.seller_legal_name_snapshot,
       old.seller_trade_name_snapshot,
       old.seller_nuit_snapshot,
       old.seller_address_line1_snapshot,
       old.seller_address_line2_snapshot,
       old.seller_city_snapshot,
       old.seller_state_snapshot,
       old.seller_postal_code_snapshot,
       old.seller_country_code_snapshot,
       old.buyer_legal_name_snapshot,
       old.buyer_nuit_snapshot,
       old.buyer_address_line1_snapshot,
       old.buyer_address_line2_snapshot,
       old.buyer_city_snapshot,
       old.buyer_state_snapshot,
       old.buyer_postal_code_snapshot,
       old.buyer_country_code_snapshot,
       old.document_language_code_snapshot,
       old.computer_processed_phrase_snapshot,
       old.compliance_rule_version_snapshot,
       old.issued_at,
       old.issued_by,
       old.voided_at,
       old.voided_by,
       old.void_reason,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.original_sales_invoice_id,
       new.customer_id,
       new.internal_reference,
       new.source_origin,
       new.moz_document_code,
       new.fiscal_series_code,
       new.fiscal_year,
       new.fiscal_sequence_number,
       new.credit_note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_mzn,
       new.tax_total_mzn,
       new.total_amount_mzn,
       new.correction_reason_code,
       new.correction_reason_text,
       new.vat_exemption_reason_text,
       new.seller_legal_name_snapshot,
       new.seller_trade_name_snapshot,
       new.seller_nuit_snapshot,
       new.seller_address_line1_snapshot,
       new.seller_address_line2_snapshot,
       new.seller_city_snapshot,
       new.seller_state_snapshot,
       new.seller_postal_code_snapshot,
       new.seller_country_code_snapshot,
       new.buyer_legal_name_snapshot,
       new.buyer_nuit_snapshot,
       new.buyer_address_line1_snapshot,
       new.buyer_address_line2_snapshot,
       new.buyer_city_snapshot,
       new.buyer_state_snapshot,
       new.buyer_postal_code_snapshot,
       new.buyer_country_code_snapshot,
       new.document_language_code_snapshot,
       new.computer_processed_phrase_snapshot,
       new.compliance_rule_version_snapshot,
       new.issued_at,
       new.issued_by,
       new.voided_at,
       new.voided_by,
       new.void_reason,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Issued or voided credit notes cannot change linkage, references, fiscal snapshots, dates, currency, FX, totals, or correction reasons.';
  end if;

  return new;
end;
$$;
