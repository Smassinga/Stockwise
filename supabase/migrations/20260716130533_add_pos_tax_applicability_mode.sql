-- POS Tax Applicability And Non-Fiscal Sales Mode
--
-- POS remains an operational Sales Order plus immediate settlement. Companies
-- must explicitly choose configured tax or non-fiscal operation; NULL remains
-- visibly unconfigured. No legal rate or treatment is inferred by this change.

alter table public.company_tax_settings
  add column pos_sales_tax_mode text,
  add column pos_sales_exemption_reason_text text,
  add constraint company_tax_settings_pos_mode_check
    check (pos_sales_tax_mode is null or pos_sales_tax_mode in ('configured', 'non_fiscal')),
  add constraint company_tax_settings_pos_reason_check
    check (
      pos_sales_tax_mode is not distinct from 'configured'
      or pos_sales_exemption_reason_text is null
    );

-- Existing companies are configured only when their existing sales default is
-- effective today. Missing or inactive defaults remain unconfigured. No company
-- is silently placed into non-fiscal mode.
update public.company_tax_settings settings
set pos_sales_tax_mode = 'configured'
where settings.pos_sales_tax_mode is null
  and exists (
    select 1
    from public.company_tax_options option_row
    where option_row.company_id = settings.company_id
      and option_row.id = settings.default_sales_tax_option_id
      and option_row.is_active
      and option_row.effective_from <= current_date
      and (option_row.effective_until is null or option_row.effective_until >= current_date)
  );

alter table public.sales_orders
  add column pos_tax_mode_snapshot text,
  add constraint sales_orders_pos_tax_mode_snapshot_check
    check (pos_tax_mode_snapshot is null or pos_tax_mode_snapshot in ('configured', 'non_fiscal'));

alter table public.sales_order_lines
  drop constraint sales_order_lines_tax_treatment_check;
alter table public.sales_order_lines
  add constraint sales_order_lines_tax_treatment_check
    check (
      tax_treatment_snapshot is null
      or tax_treatment_snapshot in ('standard', 'zero', 'exempt', 'non_fiscal')
    );

create or replace function public.commercial_tax_resolve_pos_context(
  p_company_id uuid,
  p_effective_date date default current_date,
  p_lock boolean default false
)
returns table(
  pos_mode text,
  tax_option_id uuid,
  tax_option_code text,
  tax_treatment text,
  tax_label text,
  tax_rate numeric,
  requires_exemption_reason boolean,
  exemption_reason_text text,
  ready boolean,
  blocker text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_settings public.company_tax_settings%rowtype;
  v_option public.company_tax_options%rowtype;
  v_date date := coalesce(p_effective_date, current_date);
begin
  if p_company_id is null then
    raise exception 'commercial_tax_company_required';
  end if;

  if p_lock then
    select * into v_settings
    from public.company_tax_settings
    where company_id = p_company_id
    for share;
  else
    select * into v_settings
    from public.company_tax_settings
    where company_id = p_company_id;
  end if;

  pos_mode := v_settings.pos_sales_tax_mode;
  tax_option_id := null;
  tax_option_code := null;
  tax_treatment := null;
  tax_label := null;
  tax_rate := null;
  requires_exemption_reason := false;
  exemption_reason_text := null;
  ready := false;
  blocker := null;

  if v_settings.company_id is null or pos_mode is null then
    blocker := 'commercial_tax_pos_mode_unconfigured';
    return next;
    return;
  end if;

  if pos_mode = 'non_fiscal' then
    tax_option_code := 'POS_NON_FISCAL';
    tax_treatment := 'non_fiscal';
    tax_label := 'Tax not applied';
    tax_rate := 0;
    ready := true;
    return next;
    return;
  end if;

  if v_settings.default_sales_tax_option_id is null then
    blocker := 'commercial_tax_pos_default_unconfigured';
    return next;
    return;
  end if;

  if p_lock then
    select * into v_option
    from public.company_tax_options
    where company_id = p_company_id
      and id = v_settings.default_sales_tax_option_id
    for share;
  else
    select * into v_option
    from public.company_tax_options
    where company_id = p_company_id
      and id = v_settings.default_sales_tax_option_id;
  end if;

  if v_option.id is null
     or not v_option.is_active
     or v_option.effective_from > v_date
     or (v_option.effective_until is not null and v_option.effective_until < v_date) then
    blocker := 'commercial_tax_pos_default_inactive';
    return next;
    return;
  end if;

  exemption_reason_text := nullif(btrim(coalesce(v_settings.pos_sales_exemption_reason_text, '')), '');
  if v_option.requires_exemption_reason and exemption_reason_text is null then
    blocker := 'commercial_tax_pos_exemption_reason_required';
    return next;
    return;
  end if;

  tax_option_id := v_option.id;
  tax_option_code := v_option.code;
  tax_treatment := v_option.treatment_type;
  tax_label := v_option.display_name;
  tax_rate := v_option.rate;
  requires_exemption_reason := v_option.requires_exemption_reason;
  ready := true;
  return next;
end;
$$;

create or replace function public.set_company_pos_tax_mode(
  p_company_id uuid,
  p_mode text,
  p_default_exemption_reason_text text default null
)
returns public.company_tax_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_reason text := nullif(btrim(coalesce(p_default_exemption_reason_text, '')), '');
  v_before public.company_tax_settings%rowtype;
  v_after public.company_tax_settings%rowtype;
  v_option public.company_tax_options%rowtype;
begin
  perform public.commercial_tax_require_admin(p_company_id);

  if v_mode not in ('configured', 'non_fiscal') then
    raise exception 'commercial_tax_pos_mode_invalid';
  end if;

  select * into v_before
  from public.company_tax_settings
  where company_id = p_company_id
  for update;

  if v_mode = 'configured' then
    if v_before.company_id is null or v_before.default_sales_tax_option_id is null then
      raise exception 'commercial_tax_pos_default_unconfigured';
    end if;

    select * into v_option
    from public.company_tax_options
    where company_id = p_company_id
      and id = v_before.default_sales_tax_option_id
    for update;

    if v_option.id is null
       or not v_option.is_active
       or v_option.effective_from > current_date
       or (v_option.effective_until is not null and v_option.effective_until < current_date) then
      raise exception 'commercial_tax_pos_default_inactive';
    end if;
    if v_option.requires_exemption_reason and v_reason is null then
      raise exception 'commercial_tax_pos_exemption_reason_required';
    end if;
    if not v_option.requires_exemption_reason then
      v_reason := null;
    end if;
  else
    v_reason := null;
  end if;

  if v_before.company_id is not null
     and v_before.pos_sales_tax_mode is not distinct from v_mode
     and v_before.pos_sales_exemption_reason_text is not distinct from v_reason then
    return v_before;
  end if;

  insert into public.company_tax_settings (
    company_id,
    default_sales_tax_option_id,
    default_purchase_tax_option_id,
    pos_sales_tax_mode,
    pos_sales_exemption_reason_text,
    created_by,
    updated_by
  ) values (
    p_company_id,
    null,
    null,
    v_mode,
    v_reason,
    v_actor,
    v_actor
  )
  on conflict (company_id) do update
    set pos_sales_tax_mode = excluded.pos_sales_tax_mode,
        pos_sales_exemption_reason_text = excluded.pos_sales_exemption_reason_text,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_after;

  insert into public.company_tax_configuration_events (
    company_id,
    event_type,
    before_state,
    after_state,
    actor_user_id
  ) values (
    p_company_id,
    'pos_tax_mode_changed',
    case when v_before.company_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    v_actor
  );

  return v_after;
end;
$$;

create or replace function public.commercial_tax_sales_order_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pos_context record;
  v_operator_sale boolean :=
    coalesce(current_setting('stockwise.commercial_tax_operator_sale', true), '') = 'on';
begin
  new.tax_exemption_reason_text := nullif(btrim(coalesce(new.tax_exemption_reason_text, '')), '');

  if tg_op = 'INSERT' then
    if v_operator_sale then
      select * into v_pos_context
      from public.commercial_tax_resolve_pos_context(
        new.company_id,
        coalesce(new.order_date, current_date),
        true
      );
      if not coalesce(v_pos_context.ready, false) then
        raise exception '%', coalesce(v_pos_context.blocker, 'commercial_tax_pos_mode_unconfigured');
      end if;
      new.pos_tax_mode_snapshot := v_pos_context.pos_mode;
      new.tax_exemption_reason_text := case
        when v_pos_context.pos_mode = 'configured' then v_pos_context.exemption_reason_text
        else null
      end;
    elsif new.pos_tax_mode_snapshot is not null then
      raise exception 'commercial_tax_pos_snapshot_database_managed';
    end if;

    if new.tax_calculation_mode = 'line' then
      if v_operator_sale then
        new.subtotal := 0;
        new.tax_total := 0;
        new.total := 0;
        new.total_amount := 0;
      elsif round(coalesce(new.subtotal, 0), 2) <> 0
         or round(coalesce(new.tax_total, 0), 2) <> 0
         or round(coalesce(new.total, 0), 2) <> 0
         or round(coalesce(new.total_amount, 0), 2) <> 0 then
        raise exception 'commercial_tax_header_totals_derived';
      end if;
      new.tax_configuration_version := 1;
    end if;
    return new;
  end if;

  if new.pos_tax_mode_snapshot is distinct from old.pos_tax_mode_snapshot then
    raise exception 'commercial_tax_pos_snapshot_immutable';
  end if;
  if new.tax_calculation_mode is distinct from old.tax_calculation_mode
     or new.tax_configuration_version is distinct from old.tax_configuration_version then
    raise exception 'commercial_tax_mode_immutable';
  end if;
  if old.tax_calculation_mode = 'line' then
    if coalesce(current_setting('stockwise.commercial_tax_rollup', true), '') <> 'on'
       and row(new.subtotal, new.tax_total, new.total, new.total_amount)
           is distinct from row(old.subtotal, old.tax_total, old.total, old.total_amount) then
      raise exception 'commercial_tax_header_totals_derived';
    end if;
    if old.status::text <> 'draft'
       and new.tax_exemption_reason_text is distinct from old.tax_exemption_reason_text then
      raise exception 'commercial_tax_sales_order_locked';
    end if;
    if old.status::text = 'draft'
       and new.status::text <> 'draft'
       and lower(new.status::text) not in ('cancelled', 'canceled') then
      perform public.commercial_tax_assert_order_ready('sales_order', old.id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.commercial_tax_apply_sales_order_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.sales_orders%rowtype;
  v_option public.company_tax_options%rowtype;
  v_pos_context record;
  v_commercial_changed boolean := false;
  v_operator_sale boolean :=
    coalesce(current_setting('stockwise.commercial_tax_operator_sale', true), '') = 'on';
begin
  select * into v_order
  from public.sales_orders
  where id = coalesce(new.so_id, old.so_id)
  for update;

  if v_order.id is null then
    raise exception 'commercial_tax_sales_order_not_found';
  end if;
  if v_order.tax_calculation_mode <> 'line' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_order.status::text <> 'draft' then
      raise exception 'commercial_tax_sales_line_locked';
    end if;
    return old;
  end if;

  new.company_id := v_order.company_id;
  if tg_op = 'INSERT' and v_operator_sale then
    select * into v_pos_context
    from public.commercial_tax_resolve_pos_context(
      v_order.company_id,
      coalesce(v_order.order_date, current_date),
      true
    );
    if not coalesce(v_pos_context.ready, false) then
      raise exception '%', coalesce(v_pos_context.blocker, 'commercial_tax_pos_mode_unconfigured');
    end if;
    if v_order.pos_tax_mode_snapshot is distinct from v_pos_context.pos_mode then
      raise exception 'commercial_tax_pos_context_changed';
    end if;
    if v_pos_context.pos_mode = 'configured' then
      new.tax_option_id := v_pos_context.tax_option_id;
    else
      new.tax_option_id := null;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_commercial_changed := true;
  else
    v_commercial_changed := row(
      new.item_id, new.uom_id, new.description, new.line_no, new.qty,
      new.unit_price, new.discount_pct, new.line_total, new.tax_option_id,
      new.tax_option_code_snapshot, new.tax_treatment_snapshot, new.tax_label_snapshot,
      new.tax_rate, new.tax_amount, new.tax_requires_exemption_reason
    ) is distinct from row(
      old.item_id, old.uom_id, old.description, old.line_no, old.qty,
      old.unit_price, old.discount_pct, old.line_total, old.tax_option_id,
      old.tax_option_code_snapshot, old.tax_treatment_snapshot, old.tax_label_snapshot,
      old.tax_rate, old.tax_amount, old.tax_requires_exemption_reason
    );
  end if;

  if v_order.status::text <> 'draft'
     and not (v_operator_sale and tg_op = 'INSERT') then
    if v_commercial_changed then
      raise exception 'commercial_tax_sales_line_locked';
    end if;
    return new;
  end if;

  if lower(coalesce(new.qty::text, '')) in ('nan', 'infinity', '-infinity')
     or lower(coalesce(new.unit_price::text, '')) in ('nan', 'infinity', '-infinity')
     or lower(coalesce(new.discount_pct::text, '')) in ('nan', 'infinity', '-infinity')
     or coalesce(new.qty, 0) <= 0
     or coalesce(new.unit_price, 0) < 0
     or coalesce(new.discount_pct, 0) < 0
     or coalesce(new.discount_pct, 0) > 100 then
    raise exception 'commercial_tax_sales_line_amount_invalid';
  end if;

  new.discount_pct := coalesce(new.discount_pct, 0);
  new.line_total := round(new.qty * new.unit_price * (1 - new.discount_pct / 100), 2);

  if tg_op = 'INSERT' and v_operator_sale then
    if v_pos_context.pos_mode = 'non_fiscal' then
      new.tax_option_id := null;
      new.tax_option_code_snapshot := 'POS_NON_FISCAL';
      new.tax_treatment_snapshot := 'non_fiscal';
      new.tax_label_snapshot := 'Tax not applied';
      new.tax_rate := 0;
      new.tax_amount := 0;
      new.tax_requires_exemption_reason := false;
      return new;
    end if;
  end if;

  if new.tax_option_id is null then
    if tg_op = 'INSERT' and (
      new.tax_rate is not null or new.tax_amount is not null
      or new.tax_option_code_snapshot is not null or new.tax_treatment_snapshot is not null
    ) then
      raise exception 'commercial_tax_option_required';
    end if;
    new.tax_option_code_snapshot := null;
    new.tax_treatment_snapshot := null;
    new.tax_label_snapshot := null;
    new.tax_rate := null;
    new.tax_amount := null;
    new.tax_requires_exemption_reason := null;
    return new;
  end if;

  select * into v_option
  from public.company_tax_options
  where company_id = v_order.company_id and id = new.tax_option_id;

  if v_option.id is null then
    raise exception 'commercial_tax_option_cross_company_or_missing';
  end if;
  if not v_option.is_active
     or v_option.effective_from > coalesce(v_order.order_date, current_date)
     or (v_option.effective_until is not null and v_option.effective_until < coalesce(v_order.order_date, current_date)) then
    raise exception 'commercial_tax_option_inactive';
  end if;
  if v_operator_sale and v_option.requires_exemption_reason
     and nullif(btrim(coalesce(v_order.tax_exemption_reason_text, '')), '') is null then
    raise exception 'commercial_tax_pos_exemption_reason_required';
  end if;

  new.tax_option_code_snapshot := v_option.code;
  new.tax_treatment_snapshot := v_option.treatment_type;
  new.tax_label_snapshot := v_option.display_name;
  new.tax_rate := v_option.rate;
  new.tax_amount := round(new.line_total * v_option.rate / 100, 2);
  new.tax_requires_exemption_reason := v_option.requires_exemption_reason;
  return new;
end;
$$;

create or replace function public.commercial_tax_order_readiness(
  p_document_type text,
  p_document_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company_id uuid;
  v_mode text;
  v_pos_mode text;
  v_reason text;
  v_order_date date;
  v_line_count integer := 0;
  v_unconfigured integer := 0;
  v_inactive integer := 0;
  v_reason_required integer := 0;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_header_subtotal numeric := 0;
  v_header_tax numeric := 0;
  v_header_total numeric := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_document_type = 'sales_order' then
    select company_id, tax_calculation_mode, pos_tax_mode_snapshot,
           tax_exemption_reason_text, order_date, subtotal, tax_total, total
      into v_company_id, v_mode, v_pos_mode,
           v_reason, v_order_date, v_header_subtotal, v_header_tax, v_header_total
    from public.sales_orders where id = p_document_id;
  elsif p_document_type = 'purchase_order' then
    select company_id, tax_calculation_mode, null::text,
           tax_exemption_reason_text, order_date, subtotal, tax_total, total
      into v_company_id, v_mode, v_pos_mode,
           v_reason, v_order_date, v_header_subtotal, v_header_tax, v_header_total
    from public.purchase_orders where id = p_document_id;
  else
    raise exception 'commercial_tax_document_type_invalid';
  end if;

  if v_company_id is null or not public.finance_documents_can_read(v_company_id) then
    raise exception 'commercial_tax_document_not_found' using errcode = '42501';
  end if;
  if v_mode = 'legacy_header' then
    return jsonb_build_object(
      'ready', true,
      'mode', v_mode,
      'pos_tax_mode', v_pos_mode,
      'blockers', v_blockers
    );
  end if;

  if p_document_type = 'sales_order' and v_pos_mode = 'non_fiscal' then
    select count(*),
           count(*) filter (
             where line.tax_option_id is not null
                or line.tax_option_code_snapshot is distinct from 'POS_NON_FISCAL'
                or line.tax_treatment_snapshot is distinct from 'non_fiscal'
                or line.tax_label_snapshot is distinct from 'Tax not applied'
                or round(coalesce(line.tax_rate, 0), 4) <> 0
                or round(coalesce(line.tax_amount, 0), 2) <> 0
                or coalesce(line.tax_requires_exemption_reason, false)
           ),
           round(coalesce(sum(round(line.line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(line.tax_amount, 0)), 0), 2)
      into v_line_count, v_unconfigured, v_subtotal, v_tax_total
    from public.sales_order_lines line
    where line.so_id = p_document_id;
  elsif p_document_type = 'sales_order' then
    select count(*),
           count(*) filter (where line.tax_option_id is null or line.tax_amount is null),
           count(*) filter (
             where line.tax_option_id is not null and (
               option_row.id is null or not option_row.is_active
               or option_row.effective_from > coalesce(v_order_date, current_date)
               or (option_row.effective_until is not null and option_row.effective_until < coalesce(v_order_date, current_date))
             )
           ),
           count(*) filter (where coalesce(line.tax_requires_exemption_reason, false)),
           round(coalesce(sum(round(line.line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(line.tax_amount, 0)), 0), 2)
      into v_line_count, v_unconfigured, v_inactive, v_reason_required, v_subtotal, v_tax_total
    from public.sales_order_lines line
    left join public.company_tax_options option_row
      on option_row.company_id = line.company_id and option_row.id = line.tax_option_id
    where line.so_id = p_document_id;
  else
    select count(*),
           count(*) filter (where line.tax_option_id is null or line.tax_amount is null),
           count(*) filter (
             where line.tax_option_id is not null and (
               option_row.id is null or not option_row.is_active
               or option_row.effective_from > coalesce(v_order_date, current_date)
               or (option_row.effective_until is not null and option_row.effective_until < coalesce(v_order_date, current_date))
             )
           ),
           count(*) filter (where coalesce(line.tax_requires_exemption_reason, false)),
           round(coalesce(sum(round(line.line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(line.tax_amount, 0)), 0), 2)
      into v_line_count, v_unconfigured, v_inactive, v_reason_required, v_subtotal, v_tax_total
    from public.purchase_order_lines line
    left join public.company_tax_options option_row
      on option_row.company_id = line.company_id and option_row.id = line.tax_option_id
    where line.po_id = p_document_id;
  end if;

  if v_line_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_lines_required');
  end if;
  if v_unconfigured > 0 then
    v_blockers := v_blockers || jsonb_build_array(
      case when v_pos_mode = 'non_fiscal'
        then 'commercial_tax_non_fiscal_snapshot_invalid'
        else 'commercial_tax_lines_unconfigured'
      end
    );
  end if;
  if v_inactive > 0 then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_lines_inactive');
  end if;
  if v_reason_required > 0 and nullif(btrim(coalesce(v_reason, '')), '') is null then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_exemption_reason_required');
  end if;
  if round(coalesce(v_header_subtotal, 0), 2) <> round(v_subtotal, 2)
     or round(coalesce(v_header_tax, 0), 2) <> round(v_tax_total, 2)
     or round(coalesce(v_header_total, 0), 2) <> round(v_subtotal + v_tax_total, 2) then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_totals_out_of_sync');
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'mode', v_mode,
    'pos_tax_mode', v_pos_mode,
    'blockers', v_blockers,
    'line_count', v_line_count,
    'unconfigured_line_count', v_unconfigured,
    'inactive_line_count', v_inactive,
    'subtotal', round(v_subtotal, 2),
    'tax_total', round(v_tax_total, 2),
    'total', round(v_subtotal + v_tax_total, 2)
  );
end;
$$;

create or replace function public.commercial_tax_non_fiscal_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.sales_order_id is not null
     and exists (
       select 1
       from public.sales_orders source_order
       where source_order.id = new.sales_order_id
         and source_order.company_id = new.company_id
         and source_order.pos_tax_mode_snapshot = 'non_fiscal'
     ) then
    raise exception 'commercial_tax_non_fiscal_pos_invoice_forbidden';
  end if;
  return new;
end;
$$;

create trigger biu_04_sales_invoice_non_fiscal_pos_guard
before insert or update of sales_order_id, company_id, document_workflow_status
on public.sales_invoices
for each row execute function public.commercial_tax_non_fiscal_invoice_guard();

create or replace function public.preview_operator_sale(
  p_company_id uuid,
  p_bin_from_id text default null,
  p_customer_id uuid default null,
  p_order_date date default current_date,
  p_currency_code text default 'MZN',
  p_fx_to_base numeric default 1,
  p_lines jsonb default '[]'::jsonb,
  p_settlement_method text default 'cash',
  p_bank_account_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_active_company_id uuid := public.current_company_id();
  v_member_role public.member_role;
  v_context record;
  v_source_bin record;
  v_customer_company uuid;
  v_bank_company uuid;
  v_line record;
  v_item record;
  v_qty numeric;
  v_price numeric;
  v_line_subtotal numeric;
  v_line_tax numeric;
  v_available numeric;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_line_count integer := 0;
  v_line_previews jsonb := '[]'::jsonb;
  v_method text := lower(coalesce(nullif(btrim(p_settlement_method), ''), 'cash'));
  v_date date := coalesce(p_order_date, current_date);
  v_fx numeric := coalesce(p_fx_to_base, 0);
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_company_id is null or v_active_company_id is distinct from p_company_id then
    raise exception 'commercial_tax_pos_company_access_denied' using errcode = '42501';
  end if;

  select cm.role into v_member_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = v_user
    and cm.status = 'active'::public.member_status
  limit 1;
  if v_member_role not in (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) then
    raise exception 'commercial_tax_pos_preview_forbidden' using errcode = '42501';
  end if;

  select * into v_context
  from public.commercial_tax_resolve_pos_context(p_company_id, v_date, false);
  if not coalesce(v_context.ready, false) then
    return jsonb_build_object(
      'ready', false,
      'mode', v_context.pos_mode,
      'blockers', jsonb_build_array(v_context.blocker),
      'subtotal', 0,
      'tax_total', 0,
      'total', 0,
      'settled_amount_base', 0,
      'lines', '[]'::jsonb
    );
  end if;

  if lower(coalesce(v_fx::text, '')) in ('nan', 'infinity', '-infinity') or v_fx <= 0 then
    raise exception 'commercial_tax_pos_fx_invalid';
  end if;
  if nullif(btrim(coalesce(p_currency_code, '')), '') is null then
    raise exception 'commercial_tax_pos_currency_required';
  end if;
  if v_method not in ('cash', 'bank') then
    raise exception 'commercial_tax_pos_payment_method_invalid';
  end if;

  select b.id, b."warehouseId" as warehouse_id
    into v_source_bin
  from public.bins b
  join public.warehouses w
    on w.id = b."warehouseId" and w.company_id = p_company_id
  where b.id = p_bin_from_id
    and b.company_id = p_company_id
  limit 1;
  if v_source_bin.id is null then
    raise exception 'commercial_tax_pos_source_bin_invalid';
  end if;

  if p_customer_id is not null then
    select c.company_id into v_customer_company
    from public.customers c
    where c.id = p_customer_id;
    if v_customer_company is distinct from p_company_id then
      raise exception 'commercial_tax_pos_customer_invalid';
    end if;
  end if;

  if v_method = 'bank' then
    if p_bank_account_id is null then
      raise exception 'commercial_tax_pos_bank_required';
    end if;
    select ba.company_id into v_bank_company
    from public.bank_accounts ba
    where ba.id = p_bank_account_id;
    if v_bank_company is distinct from p_company_id then
      raise exception 'commercial_tax_pos_bank_invalid';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'commercial_tax_pos_lines_required';
  end if;

  for v_line in
    select ordinality::integer as line_no, value as line_data
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality
  loop
    select i.id, i.company_id, i.name, i.unit_price,
           coalesce(i.track_inventory, true) as track_inventory,
           coalesce(i.can_sell, true) as can_sell
      into v_item
    from public.items i
    where i.id = nullif(btrim(v_line.line_data ->> 'item_id'), '')::uuid
      and i.company_id = p_company_id;
    if v_item.id is null then
      raise exception 'commercial_tax_pos_item_invalid';
    end if;
    if not v_item.track_inventory or not v_item.can_sell then
      raise exception 'commercial_tax_pos_item_not_sellable';
    end if;

    v_qty := coalesce(nullif(btrim(v_line.line_data ->> 'qty'), '')::numeric, 0);
    v_price := coalesce(
      nullif(btrim(v_line.line_data ->> 'unit_price'), '')::numeric,
      v_item.unit_price,
      0
    );
    if lower(coalesce(v_qty::text, '')) in ('nan', 'infinity', '-infinity')
       or lower(coalesce(v_price::text, '')) in ('nan', 'infinity', '-infinity')
       or v_qty <= 0 or v_price < 0 then
      raise exception 'commercial_tax_pos_line_amount_invalid';
    end if;

    select greatest(coalesce(sl.qty, 0) - coalesce(sl.allocated_qty, 0), 0)
      into v_available
    from public.stock_levels sl
    where sl.company_id = p_company_id
      and sl.item_id = v_item.id
      and sl.warehouse_id = v_source_bin.warehouse_id
      and sl.bin_id = v_source_bin.id;
    if coalesce(v_available, 0) < v_qty then
      raise exception 'commercial_tax_pos_stock_insufficient';
    end if;

    v_line_subtotal := round(v_qty * v_price, 2);
    v_line_tax := case
      when v_context.pos_mode = 'non_fiscal' then 0
      else round(v_line_subtotal * v_context.tax_rate / 100, 2)
    end;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;
    v_line_count := v_line_count + 1;
    v_line_previews := v_line_previews || jsonb_build_array(jsonb_build_object(
      'line_no', v_line.line_no,
      'item_id', v_item.id,
      'subtotal', v_line_subtotal,
      'tax_option_code', v_context.tax_option_code,
      'tax_treatment', v_context.tax_treatment,
      'tax_label', v_context.tax_label,
      'tax_rate', v_context.tax_rate,
      'tax_amount', v_line_tax,
      'total', round(v_line_subtotal + v_line_tax, 2)
    ));
  end loop;

  v_subtotal := round(v_subtotal, 2);
  v_tax_total := round(v_tax_total, 2);
  return jsonb_build_object(
    'ready', true,
    'mode', v_context.pos_mode,
    'mode_label', case
      when v_context.pos_mode = 'non_fiscal' then 'Non-fiscal POS sale'
      else v_context.tax_label
    end,
    'blockers', '[]'::jsonb,
    'tax_option_code', v_context.tax_option_code,
    'tax_treatment', v_context.tax_treatment,
    'tax_label', v_context.tax_label,
    'tax_rate', v_context.tax_rate,
    'requires_exemption_reason', v_context.requires_exemption_reason,
    'exemption_reason_configured', v_context.exemption_reason_text is not null,
    'line_count', v_line_count,
    'subtotal', v_subtotal,
    'tax_total', v_tax_total,
    'total', round(v_subtotal + v_tax_total, 2),
    'settled_amount_base', round((v_subtotal + v_tax_total) * v_fx, 2),
    'settlement_method', v_method,
    'bank_account_id', case when v_method = 'bank' then p_bank_account_id else null end,
    'lines', v_line_previews
  );
end;
$$;

revoke all on function public.commercial_tax_resolve_pos_context(uuid, date, boolean)
  from public, anon, authenticated;
revoke all on function public.commercial_tax_non_fiscal_invoice_guard()
  from public, anon, authenticated;
revoke all on function public.set_company_pos_tax_mode(uuid, text, text)
  from public, anon;
grant execute on function public.set_company_pos_tax_mode(uuid, text, text)
  to authenticated;
revoke all on function public.preview_operator_sale(uuid, text, uuid, date, text, numeric, jsonb, text, uuid)
  from public, anon;
grant execute on function public.preview_operator_sale(uuid, text, uuid, date, text, numeric, jsonb, text, uuid)
  to authenticated;

-- The legacy compatibility helper no longer remains callable by unauthenticated
-- roles. Authenticated compatibility is retained; maintained clients use the
-- posting_requests-governed post_operator_sale entry point.
revoke execute on function public.create_operator_sale_issue(uuid, text, uuid, date, text, numeric, text, text, jsonb)
  from public, anon;
grant execute on function public.create_operator_sale_issue(uuid, text, uuid, date, text, numeric, text, text, jsonb)
  to authenticated;

comment on column public.company_tax_settings.pos_sales_tax_mode is
  'Company-owned POS tax handling: configured, non_fiscal, or NULL when unconfigured.';
comment on column public.company_tax_settings.pos_sales_exemption_reason_text is
  'Optional configured POS document reason used only when the selected default tax option requires one.';
comment on column public.sales_orders.pos_tax_mode_snapshot is
  'Immutable database-stamped POS tax mode. NULL identifies non-POS and legacy Sales Orders.';
comment on function public.set_company_pos_tax_mode(uuid, text, text) is
  'ADMIN/OWNER-only audited configuration for future Point of Sale tax handling.';
comment on function public.preview_operator_sale(uuid, text, uuid, date, text, numeric, jsonb, text, uuid) is
  'Read-only authoritative POS tax and settlement preview using the same company resolver as posting.';
