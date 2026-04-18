begin;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.company_control_action_log'::regclass
      and conname = 'company_control_action_log_action_type_check'
  ) then
    alter table public.company_control_action_log
      drop constraint company_control_action_log_action_type_check;
  end if;
exception
  when undefined_table then
    null;
end;
$$;

alter table public.company_control_action_log
  add constraint company_control_action_log_action_type_check
  check (
    action_type in (
      'operational_reset',
      'access_email_expiry_warning_sent',
      'access_email_purge_warning_sent',
      'access_email_activation_confirmation_sent'
    )
  );

create or replace function public.platform_admin_resolve_company_notification_recipient(p_company_id uuid)
returns table (
  recipient_email text,
  recipient_name text,
  recipient_source text
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
      nullif(trim(coalesce(c.email::text, '')), '') as company_email,
      c.owner_user_id
    from public.companies c
    where c.id = p_company_id
  ),
  owner_member as (
    select
      cm.user_id,
      cm.role,
      cm.status,
      cm.created_at,
      p.full_name,
      nullif(trim(coalesce(p.email::text, cm.email, '')), '') as email
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
      nullif(trim(coalesce(p.email::text, cm.email, '')), '') as email
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
      ) as user_id
    from base b
    left join owner_member om on true
    left join admin_member am on true
  ),
  owner_profile as (
    select
      coalesce(p.full_name, cm.email, p.email::text) as full_name,
      nullif(trim(coalesce(p.email::text, cm.email, '')), '') as email
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
  )
  select
    coalesce(b.company_email, op.email, am.email) as recipient_email,
    case
      when b.company_email is not null then coalesce(nullif(trim(coalesce(b.name, '')), ''), 'Company contact')
      when op.full_name is not null then op.full_name
      when op.email is not null then op.email
      when am.full_name is not null then am.full_name
      when am.email is not null then am.email
      else null
    end as recipient_name,
    case
      when b.company_email is not null then 'company_email'
      when op.email is not null then 'owner_email'
      when am.email is not null then 'active_admin_email'
      else 'not_captured'
    end as recipient_source
  from base b
  left join owner_profile op on true
  left join admin_member am on true;
end;
$function$;

drop function if exists public.platform_admin_get_company_detail(uuid);

create or replace function public.platform_admin_get_company_detail(p_company_id uuid)
returns table (
  company_id uuid,
  company_name text,
  legal_name text,
  trade_name text,
  company_email text,
  company_preferred_lang text,
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
  access_granted_at timestamptz,
  paid_until timestamptz,
  purge_scheduled_at timestamptz,
  purge_completed_at timestamptz,
  access_enabled boolean,
  manual_activation_only boolean,
  notification_recipient_email text,
  notification_recipient_name text,
  notification_recipient_source text,
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
      nullif(trim(coalesce(c.email::text, '')), '') as company_email,
      c.preferred_lang,
      c.created_at,
      c.owner_user_id,
      css.plan_code,
      pc.display_name as plan_name,
      css.subscription_status,
      public.company_access_effective_status(c.id) as effective_status,
      css.trial_started_at,
      css.trial_expires_at,
      css.access_granted_at,
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
  ),
  notification_recipient as (
    select *
    from public.platform_admin_resolve_company_notification_recipient(p_company_id)
  )
  select
    b.id,
    b.name,
    b.legal_name,
    b.trade_name,
    b.company_email,
    b.preferred_lang,
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
    b.access_granted_at,
    b.paid_until,
    b.purge_scheduled_at,
    b.purge_completed_at,
    b.access_enabled,
    b.manual_activation_only,
    nr.recipient_email,
    nr.recipient_name,
    nr.recipient_source,
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
  left join member_stats ms on true
  left join notification_recipient nr on true;
end;
$function$;

create or replace function public.platform_admin_record_company_access_email(
  p_company_id uuid,
  p_template_key text,
  p_recipient_email text,
  p_recipient_source text,
  p_subject text,
  p_reason text default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $function$
declare
  v_action_type text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_recipient_email text := nullif(trim(coalesce(p_recipient_email, '')), '');
  v_recipient_source text := nullif(trim(coalesce(p_recipient_source, '')), '');
  v_subject text := nullif(trim(coalesce(p_subject, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  if p_company_id is null then
    raise exception 'company_required' using errcode = '22023';
  end if;

  if v_recipient_email is null then
    raise exception 'company_notification_recipient_missing' using errcode = 'P0001';
  end if;

  if v_subject is null then
    raise exception 'company_access_email_subject_required' using errcode = 'P0001';
  end if;

  v_action_type := case trim(coalesce(p_template_key, ''))
    when 'expiry_warning' then 'access_email_expiry_warning_sent'
    when 'purge_warning' then 'access_email_purge_warning_sent'
    when 'activation_confirmation' then 'access_email_activation_confirmation_sent'
    else null
  end;

  if v_action_type is null then
    raise exception 'company_access_email_template_invalid' using errcode = '22023';
  end if;

  return public.record_company_control_action(
    p_company_id,
    v_action_type,
    coalesce(v_reason, 'Company access email sent'),
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'template_key', trim(coalesce(p_template_key, '')),
      'recipient_email', v_recipient_email,
      'recipient_source', coalesce(v_recipient_source, 'not_captured'),
      'subject', v_subject
    )
  );
end;
$function$;

grant execute on function public.platform_admin_resolve_company_notification_recipient(uuid) to authenticated;
grant execute on function public.platform_admin_get_company_detail(uuid) to authenticated;
grant execute on function public.platform_admin_record_company_access_email(uuid, text, text, text, text, text, jsonb) to authenticated;

commit;
