create or replace function public.sales_invoice_issue_readiness_mz(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.sales_invoices%rowtype;
  v_company public.companies%rowtype;
  v_customer public.customers%rowtype;
  v_order public.sales_orders%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_line_count integer := 0;
  v_exempt_line_count integer := 0;
  v_blockers text[] := array[]::text[];
  v_seller_legal_name text;
  v_seller_nuit text;
  v_seller_address_line1 text;
  v_buyer_legal_name text;
  v_buyer_nuit text;
  v_buyer_address_line1 text;
  v_document_language_code text;
  v_computer_phrase text;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_read(v_row.company_id) then
    raise exception 'finance_document_company_access_denied';
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = v_row.company_id;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = v_row.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_row.customer_id is not null then
    select cu.*
      into v_customer
    from public.customers cu
    where cu.company_id = v_row.company_id
      and cu.id = v_row.customer_id;
  end if;

  if v_row.sales_order_id is not null then
    select so.*
      into v_order
    from public.sales_orders so
    where so.company_id = v_row.company_id
      and so.id = v_row.sales_order_id;
  end if;

  v_seller_legal_name := nullif(
    btrim(
      coalesce(
        v_row.seller_legal_name_snapshot,
        v_company.legal_name,
        v_company.trade_name,
        v_company.name,
        ''
      )
    ),
    ''
  );
  v_seller_nuit := nullif(btrim(coalesce(v_row.seller_nuit_snapshot, v_company.tax_id, '')), '');
  v_seller_address_line1 := nullif(btrim(coalesce(v_row.seller_address_line1_snapshot, v_company.address_line1, '')), '');

  v_buyer_legal_name := nullif(
    btrim(
      coalesce(
        v_row.buyer_legal_name_snapshot,
        v_order.bill_to_name,
        v_customer.name,
        ''
      )
    ),
    ''
  );
  v_buyer_nuit := nullif(
    btrim(
      coalesce(
        v_row.buyer_nuit_snapshot,
        v_order.bill_to_tax_id,
        v_customer.tax_id,
        ''
      )
    ),
    ''
  );
  v_buyer_address_line1 := nullif(
    btrim(
      coalesce(
        v_row.buyer_address_line1_snapshot,
        v_order.bill_to_billing_address,
        v_customer.billing_address,
        ''
      )
    ),
    ''
  );

  v_document_language_code := nullif(
    btrim(
      coalesce(
        v_row.document_language_code_snapshot,
        v_settings.document_language_code,
        ''
      )
    ),
    ''
  );
  v_computer_phrase := nullif(
    btrim(
      coalesce(
        v_row.computer_processed_phrase_snapshot,
        v_settings.computer_processed_phrase_text,
        ''
      )
    ),
    ''
  );

  if v_row.document_workflow_status <> 'draft' then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_not_draft');
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'approved' then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_approved_status');
  end if;

  if v_settings.company_id is null then
    v_blockers := array_append(v_blockers, 'company_fiscal_settings_missing');
  end if;

  if v_row.invoice_date is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_invoice_date');
  end if;

  if v_row.due_date is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_due_date');
  elsif v_row.invoice_date is not null and v_row.due_date < v_row.invoice_date then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_invalid_due_date');
  end if;

  if coalesce(v_row.fx_to_base, 0) <= 0 then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_invalid_fx');
  end if;

  if v_row.source_origin = 'native'
     and (
       v_row.fiscal_series_code is null
       or v_row.fiscal_year is null
       or v_row.fiscal_sequence_number is null
     ) then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_missing_fiscal_identity');
  end if;

  if v_row.source_origin = 'native' and v_row.invoice_date is not null and v_settings.company_id is not null then
    begin
      select *
        into v_series
      from public.resolve_fiscal_series(v_row.company_id, 'sales_invoice', v_row.invoice_date);

      if v_row.fiscal_series_code is distinct from v_series.series_code
         or v_row.fiscal_year is distinct from v_series.fiscal_year then
        v_blockers := array_append(v_blockers, 'sales_invoice_issue_series_mismatch');
      end if;
    exception
      when others then
        v_blockers := array_append(v_blockers, sqlerrm);
    end;
  end if;

  if v_seller_legal_name is null or v_seller_nuit is null or v_seller_address_line1 is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_seller_snapshot');
  end if;

  if v_buyer_legal_name is null or v_buyer_nuit is null or v_buyer_address_line1 is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_buyer_snapshot');
  end if;

  if v_document_language_code is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_document_language');
  end if;

  if v_computer_phrase is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_computer_phrase');
  end if;

  if coalesce(v_row.subtotal, 0) < 0
     or coalesce(v_row.tax_total, 0) < 0
     or coalesce(v_row.total_amount, 0) < 0
     or coalesce(v_row.subtotal_mzn, 0) < 0
     or coalesce(v_row.tax_total_mzn, 0) < 0
     or coalesce(v_row.total_amount_mzn, 0) < 0 then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_invalid_totals');
  end if;

  select count(*),
         count(*) filter (
           where coalesce(sil.line_total, 0) > 0
             and coalesce(sil.tax_rate, 0) <= 0
         )
    into v_line_count, v_exempt_line_count
  from public.sales_invoice_lines sil
  where sil.sales_invoice_id = v_row.id;

  if v_line_count < 1 then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_lines');
  end if;

  if coalesce(v_exempt_line_count, 0) > 0
     and nullif(btrim(coalesce(v_row.vat_exemption_reason_text, '')), '') is null then
    v_blockers := array_append(v_blockers, 'sales_invoice_issue_requires_vat_exemption_reason');
  end if;

  return jsonb_build_object(
    'can_issue',
    coalesce(array_length(v_blockers, 1), 0) = 0,
    'blockers',
    coalesce(to_jsonb(v_blockers), '[]'::jsonb),
    'document_workflow_status',
    v_row.document_workflow_status,
    'approval_status',
    coalesce(v_row.approval_status, 'draft')
  );
end;
$function$;

create or replace function public.prepare_sales_invoice_for_issue_mz(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.sales_invoices%rowtype;
  v_company public.companies%rowtype;
  v_customer public.customers%rowtype;
  v_order public.sales_orders%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_reference_match text[];
  v_fiscal_series_code text;
  v_fiscal_year integer;
  v_fiscal_sequence_number integer;
  v_seller_legal_name text;
  v_seller_trade_name text;
  v_seller_nuit text;
  v_seller_address_line1 text;
  v_seller_address_line2 text;
  v_seller_city text;
  v_seller_state text;
  v_seller_postal_code text;
  v_seller_country_code text;
  v_buyer_legal_name text;
  v_buyer_nuit text;
  v_buyer_address_line1 text;
  v_buyer_address_line2 text;
  v_buyer_country_code text;
  v_document_language_code text;
  v_computer_phrase text;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_issue_legal(v_row.company_id) then
    raise exception 'sales_invoice_issue_access_denied';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    return v_row;
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = v_row.company_id;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = v_row.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_row.customer_id is not null then
    select cu.*
      into v_customer
    from public.customers cu
    where cu.company_id = v_row.company_id
      and cu.id = v_row.customer_id;
  end if;

  if v_row.sales_order_id is not null then
    select so.*
      into v_order
    from public.sales_orders so
    where so.company_id = v_row.company_id
      and so.id = v_row.sales_order_id;
  end if;

  v_reference_match := regexp_match(coalesce(v_row.internal_reference, ''), '([A-Z]+)([0-9]{4})-([0-9]{5})$');
  v_fiscal_series_code := case
    when v_row.fiscal_series_code is not null then v_row.fiscal_series_code
    when v_reference_match is not null then v_reference_match[1]
    else null
  end;
  v_fiscal_year := case
    when v_row.fiscal_year is not null then v_row.fiscal_year
    when v_reference_match is not null then v_reference_match[2]::integer
    else null
  end;
  v_fiscal_sequence_number := case
    when v_row.fiscal_sequence_number is not null then v_row.fiscal_sequence_number
    when v_reference_match is not null then v_reference_match[3]::integer
    else null
  end;

  v_seller_legal_name := nullif(
    btrim(
      coalesce(
        v_row.seller_legal_name_snapshot,
        v_company.legal_name,
        v_company.trade_name,
        v_company.name,
        ''
      )
    ),
    ''
  );
  v_seller_trade_name := nullif(
    btrim(
      coalesce(
        v_row.seller_trade_name_snapshot,
        v_company.trade_name,
        v_company.name,
        ''
      )
    ),
    ''
  );
  v_seller_nuit := nullif(btrim(coalesce(v_row.seller_nuit_snapshot, v_company.tax_id, '')), '');
  v_seller_address_line1 := nullif(btrim(coalesce(v_row.seller_address_line1_snapshot, v_company.address_line1, '')), '');
  v_seller_address_line2 := nullif(btrim(coalesce(v_row.seller_address_line2_snapshot, v_company.address_line2, '')), '');
  v_seller_city := nullif(btrim(coalesce(v_row.seller_city_snapshot, v_company.city, '')), '');
  v_seller_state := nullif(btrim(coalesce(v_row.seller_state_snapshot, v_company.state, '')), '');
  v_seller_postal_code := nullif(btrim(coalesce(v_row.seller_postal_code_snapshot, v_company.postal_code, '')), '');
  v_seller_country_code := nullif(btrim(coalesce(v_row.seller_country_code_snapshot, v_company.country_code, '')), '');

  v_buyer_legal_name := nullif(
    btrim(
      coalesce(
        v_row.buyer_legal_name_snapshot,
        v_order.bill_to_name,
        v_customer.name,
        ''
      )
    ),
    ''
  );
  v_buyer_nuit := nullif(
    btrim(
      coalesce(
        v_row.buyer_nuit_snapshot,
        v_order.bill_to_tax_id,
        v_customer.tax_id,
        ''
      )
    ),
    ''
  );
  v_buyer_address_line1 := nullif(
    btrim(
      coalesce(
        v_row.buyer_address_line1_snapshot,
        v_order.bill_to_billing_address,
        v_customer.billing_address,
        ''
      )
    ),
    ''
  );
  v_buyer_address_line2 := nullif(
    btrim(
      coalesce(
        v_row.buyer_address_line2_snapshot,
        v_order.bill_to_shipping_address,
        v_customer.shipping_address,
        ''
      )
    ),
    ''
  );
  v_buyer_country_code := nullif(
    btrim(
      coalesce(
        v_row.buyer_country_code_snapshot,
        v_company.country_code,
        ''
      )
    ),
    ''
  );

  v_document_language_code := nullif(
    btrim(
      coalesce(
        v_row.document_language_code_snapshot,
        v_settings.document_language_code,
        ''
      )
    ),
    ''
  );
  v_computer_phrase := nullif(
    btrim(
      coalesce(
        v_row.computer_processed_phrase_snapshot,
        v_settings.computer_processed_phrase_text,
        ''
      )
    ),
    ''
  );

  perform set_config('stockwise.sales_invoice_issue_prepare_bypass', 'on', true);

  update public.sales_invoices si
     set fiscal_series_code = coalesce(v_fiscal_series_code, si.fiscal_series_code),
         fiscal_year = coalesce(v_fiscal_year, si.fiscal_year),
         fiscal_sequence_number = coalesce(v_fiscal_sequence_number, si.fiscal_sequence_number),
         seller_legal_name_snapshot = coalesce(v_seller_legal_name, si.seller_legal_name_snapshot),
         seller_trade_name_snapshot = coalesce(v_seller_trade_name, si.seller_trade_name_snapshot),
         seller_nuit_snapshot = coalesce(v_seller_nuit, si.seller_nuit_snapshot),
         seller_address_line1_snapshot = coalesce(v_seller_address_line1, si.seller_address_line1_snapshot),
         seller_address_line2_snapshot = coalesce(v_seller_address_line2, si.seller_address_line2_snapshot),
         seller_city_snapshot = coalesce(v_seller_city, si.seller_city_snapshot),
         seller_state_snapshot = coalesce(v_seller_state, si.seller_state_snapshot),
         seller_postal_code_snapshot = coalesce(v_seller_postal_code, si.seller_postal_code_snapshot),
         seller_country_code_snapshot = coalesce(v_seller_country_code, si.seller_country_code_snapshot),
         buyer_legal_name_snapshot = coalesce(v_buyer_legal_name, si.buyer_legal_name_snapshot),
         buyer_nuit_snapshot = coalesce(v_buyer_nuit, si.buyer_nuit_snapshot),
         buyer_address_line1_snapshot = coalesce(v_buyer_address_line1, si.buyer_address_line1_snapshot),
         buyer_address_line2_snapshot = coalesce(v_buyer_address_line2, si.buyer_address_line2_snapshot),
         buyer_country_code_snapshot = coalesce(v_buyer_country_code, si.buyer_country_code_snapshot),
         document_language_code_snapshot = coalesce(v_document_language_code, si.document_language_code_snapshot),
         computer_processed_phrase_snapshot = coalesce(v_computer_phrase, si.computer_processed_phrase_snapshot),
         subtotal_mzn = case
           when coalesce(si.fx_to_base, 0) > 0 then round((coalesce(si.subtotal, 0) * si.fx_to_base)::numeric, 2)
           else si.subtotal_mzn
         end,
         tax_total_mzn = case
           when coalesce(si.fx_to_base, 0) > 0 then round((coalesce(si.tax_total, 0) * si.fx_to_base)::numeric, 2)
           else si.tax_total_mzn
         end,
         total_amount_mzn = case
           when coalesce(si.fx_to_base, 0) > 0 then round((coalesce(si.total_amount, 0) * si.fx_to_base)::numeric, 2)
           else si.total_amount_mzn
         end
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.sales_invoice_hardening_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if tg_op = 'INSERT' then
    if not public.finance_documents_can_prepare_draft(v_company_id) then
      raise exception using
        message = 'Sales invoice draft creation access denied.';
    end if;

    new.document_workflow_status := coalesce(new.document_workflow_status, 'draft');
    new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), 'draft');

    if new.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Sales invoices must start in draft status.';
    end if;

    if new.approval_status <> 'draft' then
      raise exception using
        message = 'Sales invoices must start with draft approval status.';
    end if;

    new.approval_requested_at := null;
    new.approval_requested_by := null;
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), old.approval_status, 'draft');

  if current_setting('stockwise.sales_invoice_issue_prepare_bypass', true) = 'on' then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Only draft sales invoices can be prepared for issue.';
    end if;

    if new.document_workflow_status is distinct from old.document_workflow_status
       or new.approval_status is distinct from old.approval_status then
      raise exception using
        message = 'Sales invoice issue preparation cannot change approval or workflow status.';
    end if;

    if (to_jsonb(new) - array[
      'updated_at',
      'fiscal_series_code',
      'fiscal_year',
      'fiscal_sequence_number',
      'seller_legal_name_snapshot',
      'seller_trade_name_snapshot',
      'seller_nuit_snapshot',
      'seller_address_line1_snapshot',
      'seller_address_line2_snapshot',
      'seller_city_snapshot',
      'seller_state_snapshot',
      'seller_postal_code_snapshot',
      'seller_country_code_snapshot',
      'buyer_legal_name_snapshot',
      'buyer_nuit_snapshot',
      'buyer_address_line1_snapshot',
      'buyer_address_line2_snapshot',
      'buyer_country_code_snapshot',
      'document_language_code_snapshot',
      'computer_processed_phrase_snapshot',
      'subtotal_mzn',
      'tax_total_mzn',
      'total_amount_mzn'
    ]) is distinct from
      (to_jsonb(old) - array[
        'updated_at',
        'fiscal_series_code',
        'fiscal_year',
        'fiscal_sequence_number',
        'seller_legal_name_snapshot',
        'seller_trade_name_snapshot',
        'seller_nuit_snapshot',
        'seller_address_line1_snapshot',
        'seller_address_line2_snapshot',
        'seller_city_snapshot',
        'seller_state_snapshot',
        'seller_postal_code_snapshot',
        'seller_country_code_snapshot',
        'buyer_legal_name_snapshot',
        'buyer_nuit_snapshot',
        'buyer_address_line1_snapshot',
        'buyer_address_line2_snapshot',
        'buyer_country_code_snapshot',
        'document_language_code_snapshot',
        'computer_processed_phrase_snapshot',
        'subtotal_mzn',
        'tax_total_mzn',
        'total_amount_mzn'
      ]) then
      raise exception using
        message = 'Sales invoice issue preparation may only update legal snapshot fields.';
    end if;

    return new;
  end if;

  if new.approval_status is distinct from old.approval_status then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Sales invoice approval state cannot change once the document is issued or voided.';
    end if;

    case old.approval_status
      when 'draft' then
        if new.approval_status <> 'pending_approval' then
          raise exception using
            message = 'Sales invoices can only move from draft to pending approval.';
        end if;
        if not public.finance_documents_can_submit_for_approval(v_company_id) then
          raise exception using
            message = 'Sales invoice approval request access denied.';
        end if;
        new.approval_requested_at := coalesce(new.approval_requested_at, now());
        new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
        new.approved_at := null;
        new.approved_by := null;
      when 'pending_approval' then
        if new.approval_status = 'approved' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Sales invoice approval access denied.';
          end if;
          new.approval_requested_at := coalesce(old.approval_requested_at, new.approval_requested_at, now());
          new.approval_requested_by := coalesce(old.approval_requested_by, new.approval_requested_by, auth.uid());
          new.approved_at := coalesce(new.approved_at, now());
          new.approved_by := coalesce(new.approved_by, auth.uid());
        elsif new.approval_status = 'draft' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Sales invoice approval reset access denied.';
          end if;
          new.approval_requested_at := null;
          new.approval_requested_by := null;
          new.approved_at := null;
          new.approved_by := null;
        else
          raise exception using
            message = 'Sales invoices can only move from pending approval to approved or back to draft.';
        end if;
      when 'approved' then
        if new.approval_status <> 'draft' then
          raise exception using
            message = 'Approved sales invoices can only be returned to draft before issue.';
        end if;
        if not public.finance_documents_can_approve(v_company_id) then
          raise exception using
            message = 'Sales invoice approval reset access denied.';
        end if;
        new.approval_requested_at := null;
        new.approval_requested_by := null;
        new.approved_at := null;
        new.approved_by := null;
      else
        raise exception using
          message = format('Sales invoice approval state %s is not recognized.', old.approval_status);
    end case;

    if new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by']) then
      raise exception using
        message = 'Sales invoice approval transitions cannot edit draft content. Save draft changes before approval routing.';
    end if;
  elsif old.document_workflow_status = 'draft' then
    if old.approval_status = 'draft' then
      if new.document_workflow_status = old.document_workflow_status
         and not public.finance_documents_can_prepare_draft(v_company_id) then
        raise exception using
          message = 'Sales invoice draft edit access denied.';
      end if;
    elsif new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception using
        message = 'Sales invoices are locked once they are pending approval or approved. Return the document to draft before editing it.';
    end if;
  elsif old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided sales invoices are immutable.';
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status = 'issued' then
          if old.approval_status <> 'approved' then
            raise exception using
              message = 'Sales invoices must be approved before issue.';
          end if;
          if not public.finance_documents_can_issue_legal(v_company_id) then
            raise exception 'sales_invoice_issue_access_denied';
          end if;
        elsif new.document_workflow_status = 'voided' then
          if not public.finance_documents_can_void(v_company_id) then
            raise exception using
              message = 'Sales invoice void access denied.';
          end if;
        else
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

  return new;
end;
$function$;

comment on function public.sales_invoice_issue_readiness_mz(uuid) is
  'Returns Mozambique issue-time readiness for one sales invoice using the same finance/legal requirements the UI should surface before calling the issue RPC.';

comment on function public.prepare_sales_invoice_for_issue_mz(uuid) is
  'Backfills issue-time legal snapshots and base totals for a draft sales invoice through a narrow, controlled path before issue.';

revoke all on function public.sales_invoice_issue_readiness_mz(uuid) from public, anon;
grant execute on function public.sales_invoice_issue_readiness_mz(uuid) to authenticated;

revoke all on function public.prepare_sales_invoice_for_issue_mz(uuid) from public, anon;
grant execute on function public.prepare_sales_invoice_for_issue_mz(uuid) to authenticated;
