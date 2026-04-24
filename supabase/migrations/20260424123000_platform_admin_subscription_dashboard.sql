create or replace function public.platform_admin_list_company_subscription_dashboard(
  p_search text default null
)
returns table(
  company_id uuid,
  company_name text,
  company_email text,
  owner_user_id uuid,
  plan_code text,
  plan_name text,
  subscription_status public.subscription_status,
  effective_status public.subscription_status,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  paid_until timestamptz,
  access_expires_at timestamptz,
  purge_scheduled_at timestamptz,
  purge_completed_at timestamptz,
  member_count integer,
  active_member_count integer,
  access_enabled boolean,
  updated_at timestamptz,
  company_created_at timestamptz,
  latest_member_last_sign_in_at timestamptz,
  notification_recipient_email text,
  monthly_price_mzn numeric,
  annual_price_mzn numeric,
  starting_price_mzn numeric,
  manual_activation_only boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $$
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
      c.owner_user_id,
      c.created_at as company_created_at,
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
      css.updated_at,
      pc.monthly_price_mzn,
      pc.annual_price_mzn,
      pc.starting_price_mzn,
      pc.manual_activation_only
    from public.companies c
    join public.company_subscription_state css
      on css.company_id = c.id
    join public.plan_catalog pc
      on pc.code = css.plan_code
    where (
      p_search is null
      or btrim(p_search) = ''
      or c.name ilike '%' || btrim(p_search) || '%'
      or c.id::text = btrim(p_search)
      or css.plan_code ilike '%' || btrim(p_search) || '%'
      or pc.display_name ilike '%' || btrim(p_search) || '%'
      or coalesce(c.email::text, '') ilike '%' || btrim(p_search) || '%'
    )
  ),
  member_counts as (
    select
      cm.company_id,
      count(*)::integer as member_count,
      count(*) filter (where cm.status = 'active'::public.member_status)::integer as active_member_count
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    group by cm.company_id
  ),
  latest_member_activity as (
    select
      cm.company_id,
      max(coalesce(p.last_sign_in_at, u.last_sign_in_at)) as latest_member_last_sign_in_at
    from public.company_members cm
    join base b
      on b.id = cm.company_id
    left join public.profiles p
      on p.id = cm.user_id
    left join auth.users u
      on u.id = cm.user_id
    where cm.status = 'active'::public.member_status
    group by cm.company_id
  )
  select
    b.id as company_id,
    b.name as company_name,
    b.company_email,
    b.owner_user_id,
    b.plan_code,
    b.plan_name,
    b.subscription_status,
    b.effective_status,
    b.trial_started_at,
    b.trial_expires_at,
    b.paid_until,
    case
      when b.effective_status = 'active_paid'::public.subscription_status and b.paid_until is not null then b.paid_until
      else coalesce(b.trial_expires_at, b.paid_until)
    end as access_expires_at,
    b.purge_scheduled_at,
    b.purge_completed_at,
    coalesce(mc.member_count, 0) as member_count,
    coalesce(mc.active_member_count, 0) as active_member_count,
    b.access_enabled,
    b.updated_at,
    b.company_created_at,
    lma.latest_member_last_sign_in_at,
    coalesce(b.company_email, recipient.email) as notification_recipient_email,
    b.monthly_price_mzn,
    b.annual_price_mzn,
    b.starting_price_mzn,
    b.manual_activation_only
  from base b
  left join member_counts mc
    on mc.company_id = b.id
  left join latest_member_activity lma
    on lma.company_id = b.id
  left join lateral (
    select coalesce(
      nullif(trim(p.email::text), ''),
      nullif(trim(u.email), ''),
      nullif(trim(cm.email), '')
    ) as email
    from public.company_members cm
    left join public.profiles p
      on p.id = cm.user_id
    left join auth.users u
      on u.id = cm.user_id
    where cm.company_id = b.id
      and cm.status = 'active'::public.member_status
      and cm.role in ('OWNER'::public.member_role, 'ADMIN'::public.member_role)
    order by
      case
        when cm.user_id = b.owner_user_id then 0
        when cm.role = 'OWNER'::public.member_role then 1
        else 2
      end,
      cm.created_at asc,
      cm.user_id asc
    limit 1
  ) recipient
    on true
  order by b.updated_at desc, b.company_created_at desc;
end;
$$;

alter function public.platform_admin_list_company_subscription_dashboard(text) owner to postgres;

grant execute on function public.platform_admin_list_company_subscription_dashboard(text) to authenticated;
grant execute on function public.platform_admin_list_company_subscription_dashboard(text) to service_role;
