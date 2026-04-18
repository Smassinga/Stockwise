begin;

create table if not exists public.company_control_action_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  action_type text not null
    check (action_type in ('operational_reset')),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_email text null,
  reason text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.company_control_action_log enable row level security;

create index if not exists company_control_action_log_company_created_idx
  on public.company_control_action_log (company_id, created_at desc);

revoke all on public.company_control_action_log from public, anon, authenticated;

create or replace function public.record_company_control_action(
  p_company_id uuid,
  p_action_type text,
  p_reason text,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $function$
declare
  v_action_id uuid;
begin
  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  )
  values (
    p_company_id,
    p_action_type,
    auth.uid(),
    nullif(trim(coalesce((auth.jwt() ->> 'email')::text, '')), ''),
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No reason recorded'),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_action_id;

  return v_action_id;
end;
$function$;

create or replace function public.sales_invoice_lines_parent_issue_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_invoice_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_invoice_id := case when tg_op = 'DELETE' then old.sales_invoice_id else new.sales_invoice_id end;

  select si.document_workflow_status
    into v_status
  from public.sales_invoices si
  where si.id = v_invoice_id;

  if coalesce(v_status, '') in ('issued', 'voided') then
    raise exception 'sales_invoice_lines_parent_locked';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function public.sales_note_lines_parent_issue_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_note_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'sales_credit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.sales_credit_note_id;
    else
      v_note_id := new.sales_credit_note_id;
    end if;

    select scn.document_workflow_status
      into v_status
    from public.sales_credit_notes scn
    where scn.id = v_note_id;
  elsif tg_table_name = 'sales_debit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.sales_debit_note_id;
    else
      v_note_id := new.sales_debit_note_id;
    end if;

    select sdn.document_workflow_status
      into v_status
    from public.sales_debit_notes sdn
    where sdn.id = v_note_id;
  else
    raise exception using
      message = format('sales_note_lines_parent_issue_guard does not support table %s.', tg_table_name);
  end if;

  if v_status in ('issued', 'voided') then
    raise exception using
      message = 'Issued or voided sales notes cannot change line items.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function public.vendor_bill_lines_parent_post_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_bill_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

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
$function$;

create or replace function public.vendor_note_lines_parent_status_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_note_id uuid;
  v_status text;
begin
  if public.finance_documents_internal_transition_bypass() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

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
$function$;

create or replace function public.platform_admin_get_company_detail(p_company_id uuid)
returns table (
  company_id uuid,
  company_name text,
  legal_name text,
  trade_name text,
  company_created_at timestamptz,
  owner_user_id uuid,
  owner_full_name text,
  owner_email text,
  owner_member_role public.member_role,
  owner_member_status public.member_status,
  owner_member_since timestamptz,
  owner_source text,
  owner_last_sign_in_at timestamptz,
  latest_member_user_id uuid,
  latest_member_full_name text,
  latest_member_email text,
  latest_member_role public.member_role,
  latest_member_last_sign_in_at timestamptz,
  member_count integer,
  active_member_count integer,
  plan_code text,
  plan_name text,
  subscription_status public.subscription_status,
  effective_status public.subscription_status,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  paid_until timestamptz,
  purge_scheduled_at timestamptz,
  purge_completed_at timestamptz,
  access_enabled boolean,
  manual_activation_only boolean,
  reset_allowed boolean,
  reset_blocked_reason text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      c.id,
      c.name,
      c.legal_name,
      c.trade_name,
      c.created_at,
      c.owner_user_id,
      css.plan_code,
      pc.display_name as plan_name,
      css.subscription_status,
      public.company_access_effective_status(c.id) as effective_status,
      css.trial_started_at,
      css.trial_expires_at,
      css.paid_until,
      css.purge_scheduled_at,
      css.purge_completed_at,
      public.company_access_is_enabled(c.id) as access_enabled,
      pc.manual_activation_only
    from public.companies c
    join public.company_subscription_state css
      on css.company_id = c.id
    join public.plan_catalog pc
      on pc.code = css.plan_code
    where c.id = p_company_id
  ),
  owner_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
      and cm.role = 'OWNER'::public.member_role
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ),
  admin_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
      and cm.role = 'ADMIN'::public.member_role
    order by cm.created_at asc, cm.user_id asc
    limit 1
  ),
  owner_choice as (
    select
      coalesce(
        b.owner_user_id,
        om.user_id,
        am.user_id
      ) as user_id,
      case
        when b.owner_user_id is not null then 'company_owner'
        when om.user_id is not null then 'active_owner_member'
        when am.user_id is not null then 'active_admin_member'
        else 'not_captured'
      end as owner_source
    from base b
    left join owner_member om on true
    left join admin_member am on true
  ),
  owner_membership as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from owner_choice oc
    join base b
      on true
    left join public.company_members cm
      on cm.company_id = b.id
     and cm.user_id = oc.user_id
    left join public.profiles p
      on p.id = oc.user_id
    order by
      case when cm.status = 'active'::public.member_status then 0 else 1 end,
      case
        when cm.role = 'OWNER'::public.member_role then 0
        when cm.role = 'ADMIN'::public.member_role then 1
        else 2
      end,
      cm.created_at asc nulls last
    limit 1
  ),
  latest_member as (
    select
      cm.user_id,
      cm.role,
      p.full_name,
      coalesce(p.email::text, cm.email) as email,
      p.last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    where cm.status = 'active'::public.member_status
    order by p.last_sign_in_at desc nulls last, cm.created_at desc
    limit 1
  ),
  member_stats as (
    select
      count(*)::integer as member_count,
      count(*) filter (where cm.status = 'active'::public.member_status)::integer as active_member_count
    from public.company_members cm
    join base b
      on b.id = cm.company_id
  )
  select
    b.id,
    b.name,
    b.legal_name,
    b.trade_name,
    b.created_at,
    coalesce(oc.user_id, om.user_id, b.owner_user_id),
    coalesce(om.full_name, om.email, null),
    coalesce(om.email, null),
    om.role,
    om.status,
    om.created_at,
    oc.owner_source,
    om.last_sign_in_at,
    lm.user_id,
    lm.full_name,
    lm.email,
    lm.role,
    lm.last_sign_in_at,
    coalesce(ms.member_count, 0),
    coalesce(ms.active_member_count, 0),
    b.plan_code,
    b.plan_name,
    b.subscription_status,
    b.effective_status,
    b.trial_started_at,
    b.trial_expires_at,
    b.paid_until,
    b.purge_scheduled_at,
    b.purge_completed_at,
    b.access_enabled,
    b.manual_activation_only,
    (b.effective_status <> 'active_paid'::public.subscription_status) as reset_allowed,
    case
      when b.effective_status = 'active_paid'::public.subscription_status
        then 'Move the company out of active paid access before resetting operational data.'
      else null
    end as reset_blocked_reason
  from base b
  left join owner_choice oc on true
  left join owner_membership om on true
  left join latest_member lm on true
  left join member_stats ms on true;
end;
$function$;

create or replace function public.platform_admin_list_company_control_actions(p_company_id uuid)
returns table (
  id uuid,
  company_id uuid,
  action_type text,
  actor_user_id uuid,
  actor_email text,
  reason text,
  context jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
  select
    log.id,
    log.company_id,
    log.action_type,
    log.actor_user_id,
    log.actor_email,
    log.reason,
    log.context,
    log.created_at
  from public.company_control_action_log log
  where log.company_id = p_company_id
  order by log.created_at desc;
end;
$function$;

create or replace function public.platform_admin_reset_company_operational_data(
  p_company_id uuid,
  p_confirmation text,
  p_reason text
)
returns table (
  company_id uuid,
  performed_at timestamptz,
  deleted_summary jsonb,
  preserved_scope jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $function$
declare
  v_now timestamptz := timezone('utc', now());
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_effective_status public.subscription_status;
  v_rate_allowed boolean;
  v_rate_retry integer;
  v_rows integer := 0;
  v_summary jsonb := '{}'::jsonb;
  v_preserved_scope jsonb := jsonb_build_object(
    'retained', jsonb_build_array(
      'company_shell',
      'company_memberships',
      'user_active_company',
      'company_settings',
      'payment_terms',
      'company_currencies',
      'company_fiscal_settings',
      'finance_document_fiscal_series',
      'document_number_counters',
      'subscription_state',
      'company_access_audit_log',
      'company_purge_queue',
      'company_control_action_log',
      'platform_admin_identity',
      'auth_credentials'
    )
  );
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'platform_admin_reset_company_operational_data',
    coalesce(auth.uid()::text, lower(coalesce((auth.jwt() ->> 'email')::text, 'anonymous'))),
    900,
    2
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'platform_admin_company_reset_rate_limited_retry_after_%s', coalesce(v_rate_retry, 900)
      using errcode = 'P0001';
  end if;

  if p_company_id is null then
    raise exception 'company_reset_company_required' using errcode = '22023';
  end if;

  if p_confirmation is distinct from p_company_id::text then
    raise exception 'company_reset_confirmation_mismatch' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'company_reset_reason_required' using errcode = 'P0001';
  end if;

  perform 1
  from public.companies c
  where c.id = p_company_id
  for update;

  if not found then
    raise exception 'company_not_found' using errcode = 'P0001';
  end if;

  perform 1
  from public.company_subscription_state css
  where css.company_id = p_company_id
  for update;

  if not found then
    raise exception 'company_subscription_state_missing' using errcode = 'P0001';
  end if;

  v_effective_status := public.company_access_effective_status(p_company_id);

  if v_effective_status = 'active_paid'::public.subscription_status then
    raise exception 'company_reset_active_paid_not_allowed' using errcode = 'P0001';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  delete from public.notifications where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('notifications', v_rows);

  delete from public.due_reminder_queue where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('due_reminder_queue', v_rows);

  delete from public.whatsapp_webhook_events where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('whatsapp_webhook_events', v_rows);

  delete from public.whatsapp_outbox where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('whatsapp_outbox', v_rows);

  delete from public.bank_transactions
  where bank_id in (
    select ba.id
    from public.bank_accounts ba
    where ba.company_id = p_company_id
  );
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bank_transactions', v_rows);

  delete from public.cash_transactions where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('cash_transactions', v_rows);

  delete from public.fiscal_document_artifacts where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('fiscal_document_artifacts', v_rows);

  delete from public.finance_document_events where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('finance_document_events', v_rows);

  delete from public.landed_cost_run_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('landed_cost_run_lines', v_rows);

  delete from public.landed_cost_runs where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('landed_cost_runs', v_rows);

  delete from public.sales_credit_note_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_credit_note_lines', v_rows);

  delete from public.sales_debit_note_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_debit_note_lines', v_rows);

  delete from public.vendor_credit_note_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_credit_note_lines', v_rows);

  delete from public.vendor_debit_note_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_debit_note_lines', v_rows);

  delete from public.vendor_bill_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_bill_lines', v_rows);

  delete from public.sales_invoice_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_invoice_lines', v_rows);

  delete from public.sales_credit_notes where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_credit_notes', v_rows);

  delete from public.sales_debit_notes where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_debit_notes', v_rows);

  delete from public.vendor_credit_notes where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_credit_notes', v_rows);

  delete from public.vendor_debit_notes where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_debit_notes', v_rows);

  delete from public.saft_moz_exports where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('saft_moz_exports', v_rows);

  delete from public.vendor_bills where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('vendor_bills', v_rows);

  delete from public.sales_invoices where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_invoices', v_rows);

  delete from public.purchase_order_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('purchase_order_lines', v_rows);

  delete from public.sales_order_lines where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_order_lines', v_rows);

  delete from public.purchase_orders where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('purchase_orders', v_rows);

  delete from public.sales_orders where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('sales_orders', v_rows);

  delete from public.stock_movements where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('stock_movements', v_rows);

  delete from public.stock_levels where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('stock_levels', v_rows);

  delete from public.builds where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('builds', v_rows);

  delete from public.bom_components
  where bom_id in (
    select b.id
    from public.boms b
    where b.company_id = p_company_id
  );
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bom_components', v_rows);

  delete from public.boms where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('boms', v_rows);

  delete from public.bank_accounts where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bank_accounts', v_rows);

  delete from public.cash_books where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('cash_books', v_rows);

  delete from public.bins
  where "warehouseId" in (
    select w.id
    from public.warehouses w
    where w.company_id = p_company_id
  );
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('bins', v_rows);

  delete from public.warehouses where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('warehouses', v_rows);

  delete from public.customers where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('customers', v_rows);

  delete from public.suppliers where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('suppliers', v_rows);

  delete from public.items where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('items', v_rows);

  delete from public.uom_conversions where company_id = p_company_id;
  get diagnostics v_rows = row_count;
  v_summary := v_summary || jsonb_build_object('uom_conversions', v_rows);

  update public.company_subscription_state css
     set purge_scheduled_at = null,
         purge_completed_at = v_now,
         updated_by = auth.uid()
   where css.company_id = p_company_id;

  insert into public.company_purge_queue (
    company_id,
    scheduled_for,
    status,
    target_scope,
    reason,
    created_by,
    completed_at
  )
  values (
    p_company_id,
    v_now,
    'completed',
    jsonb_build_object('operational_data', true, 'identity_credentials', false),
    v_reason,
    auth.uid(),
    v_now
  )
  on conflict (company_id) do update
     set scheduled_for = excluded.scheduled_for,
         status = 'completed',
         target_scope = excluded.target_scope,
         reason = excluded.reason,
         completed_at = excluded.completed_at,
         updated_at = v_now;

  perform public.record_company_control_action(
    p_company_id,
    'operational_reset',
    v_reason,
    jsonb_build_object(
      'effective_status', v_effective_status,
      'deleted_summary', v_summary,
      'preserved_scope', v_preserved_scope
    )
  );

  return query
  select
    p_company_id,
    v_now,
    v_summary,
    v_preserved_scope;
end;
$function$;

grant execute on function public.platform_admin_get_company_detail(uuid) to authenticated;
grant execute on function public.platform_admin_list_company_control_actions(uuid) to authenticated;
grant execute on function public.platform_admin_reset_company_operational_data(uuid, text, text) to authenticated;

commit;
