do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'subscription_status'
  ) then
    create type public.subscription_status as enum (
      'trial',
      'active_paid',
      'expired',
      'suspended',
      'disabled'
    );
  end if;
end
$$;

create table if not exists public.plan_catalog (
  code text primary key,
  display_name text not null,
  monthly_price_mzn numeric(12,2),
  six_month_price_mzn numeric(12,2),
  annual_price_mzn numeric(12,2),
  onboarding_fee_mzn numeric(12,2),
  starting_price_mzn numeric(12,2),
  trial_days integer not null default 0 check (trial_days >= 0 and trial_days <= 365),
  sort_order integer not null default 100,
  is_public boolean not null default true,
  manual_activation_only boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  email text not null unique,
  is_active boolean not null default true,
  granted_by uuid,
  granted_at timestamptz not null default timezone('utc', now()),
  note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.company_subscription_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_code text not null references public.plan_catalog(code),
  subscription_status public.subscription_status not null,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  paid_until timestamptz,
  access_granted_by uuid,
  access_granted_at timestamptz,
  grant_reason text,
  access_revoked_by uuid,
  access_revoked_at timestamptz,
  revoke_reason text,
  purge_scheduled_at timestamptz,
  purge_completed_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    subscription_status <> 'trial'
    or (trial_started_at is not null and trial_expires_at is not null and trial_expires_at > trial_started_at)
  )
);

create table if not exists public.company_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  previous_plan_code text references public.plan_catalog(code),
  next_plan_code text references public.plan_catalog(code),
  previous_status public.subscription_status,
  next_status public.subscription_status not null,
  actor_user_id uuid,
  actor_email text,
  reason text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.company_purge_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'completed', 'cancelled')),
  target_scope jsonb not null default jsonb_build_object('operational_data', true, 'identity_credentials', false),
  reason text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

alter table public.plan_catalog enable row level security;
alter table public.platform_admins enable row level security;
alter table public.company_subscription_state enable row level security;
alter table public.company_access_audit_log enable row level security;
alter table public.company_purge_queue enable row level security;

create or replace function public.touch_updated_at_column()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists bu_plan_catalog_touch_updated_at on public.plan_catalog;
create trigger bu_plan_catalog_touch_updated_at
before update on public.plan_catalog
for each row
execute function public.touch_updated_at_column();

drop trigger if exists bu_platform_admins_touch_updated_at on public.platform_admins;
create trigger bu_platform_admins_touch_updated_at
before update on public.platform_admins
for each row
execute function public.touch_updated_at_column();

drop trigger if exists bu_company_subscription_state_touch_updated_at on public.company_subscription_state;
create trigger bu_company_subscription_state_touch_updated_at
before update on public.company_subscription_state
for each row
execute function public.touch_updated_at_column();

drop trigger if exists bu_company_purge_queue_touch_updated_at on public.company_purge_queue;
create trigger bu_company_purge_queue_touch_updated_at
before update on public.company_purge_queue
for each row
execute function public.touch_updated_at_column();

insert into public.plan_catalog (
  code,
  display_name,
  monthly_price_mzn,
  six_month_price_mzn,
  annual_price_mzn,
  onboarding_fee_mzn,
  starting_price_mzn,
  trial_days,
  sort_order,
  is_public,
  manual_activation_only
)
values
  ('trial_7d', '7-day Trial', null, null, null, null, null, 7, 5, false, true),
  ('starter', 'Starter', 2001.00, 11385.00, 20010.00, 5175.00, null, 7, 10, true, true),
  ('growth', 'Growth', 3381.00, 19251.00, 33810.00, 10350.00, null, 7, 20, true, true),
  ('business', 'Business', 5451.00, 31050.00, 54510.00, 17250.00, null, 7, 30, true, true),
  ('managed_business_plus', 'Managed Business+', null, null, 82800.00, null, 82800.00, 7, 40, true, true),
  ('legacy_manual', 'Legacy Manual Access', null, null, null, null, null, 0, 90, false, true)
on conflict (code) do update
set display_name = excluded.display_name,
    monthly_price_mzn = excluded.monthly_price_mzn,
    six_month_price_mzn = excluded.six_month_price_mzn,
    annual_price_mzn = excluded.annual_price_mzn,
    onboarding_fee_mzn = excluded.onboarding_fee_mzn,
    starting_price_mzn = excluded.starting_price_mzn,
    trial_days = excluded.trial_days,
    sort_order = excluded.sort_order,
    is_public = excluded.is_public,
    manual_activation_only = excluded.manual_activation_only;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.is_active
      and (
        pa.user_id = auth.uid()
        or lower(pa.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
  );
$$;

create or replace function public.company_access_effective_status(p_company_id uuid)
returns public.subscription_status
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
declare
  v_state public.company_subscription_state%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  select *
    into v_state
  from public.company_subscription_state css
  where css.company_id = p_company_id;

  if not found then
    return 'disabled'::public.subscription_status;
  end if;

  if v_state.subscription_status = 'trial'::public.subscription_status
     and v_state.trial_expires_at is not null
     and v_state.trial_expires_at <= v_now then
    return 'expired'::public.subscription_status;
  end if;

  if v_state.subscription_status = 'active_paid'::public.subscription_status
     and v_state.paid_until is not null
     and v_state.paid_until <= v_now then
    return 'expired'::public.subscription_status;
  end if;

  return v_state.subscription_status;
end;
$$;

create or replace function public.company_access_is_enabled(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  select public.company_access_effective_status(p_company_id) in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status);
$$;

create or replace function public.member_has_company_access(
  p_company_id uuid,
  p_include_invited boolean default false
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and (
        cm.user_id = auth.uid()
        or lower(cm.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
      and cm.status = any(
        case
          when p_include_invited
            then array['active'::public.member_status, 'invited'::public.member_status]
          else array['active'::public.member_status]
        end
      )
  )
  and public.company_access_is_enabled(p_company_id);
$$;

create or replace function public.sync_company_purge_queue(
  p_company_id uuid,
  p_scheduled_for timestamptz,
  p_reason text,
  p_created_by uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
begin
  if p_scheduled_for is null then
    update public.company_purge_queue
       set status = 'cancelled',
           reason = coalesce(nullif(trim(p_reason), ''), reason),
           updated_at = timezone('utc', now())
     where company_id = p_company_id
       and status in ('scheduled', 'processing');
    return;
  end if;

  insert into public.company_purge_queue (
    company_id,
    scheduled_for,
    status,
    reason,
    created_by
  )
  values (
    p_company_id,
    p_scheduled_for,
    'scheduled',
    coalesce(nullif(trim(p_reason), ''), 'Scheduled operational trial-data purge'),
    p_created_by
  )
  on conflict (company_id) do update
     set scheduled_for = excluded.scheduled_for,
         status = 'scheduled',
         reason = excluded.reason,
         completed_at = null,
         updated_at = timezone('utc', now());
end;
$$;

create or replace function public.record_company_access_audit(
  p_company_id uuid,
  p_previous_plan_code text,
  p_next_plan_code text,
  p_previous_status public.subscription_status,
  p_next_status public.subscription_status,
  p_reason text,
  p_context jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  insert into public.company_access_audit_log (
    company_id,
    previous_plan_code,
    next_plan_code,
    previous_status,
    next_status,
    actor_user_id,
    actor_email,
    reason,
    context
  )
  values (
    p_company_id,
    p_previous_plan_code,
    p_next_plan_code,
    p_previous_status,
    p_next_status,
    auth.uid(),
    nullif(trim(coalesce((auth.jwt() ->> 'email')::text, '')), ''),
    nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(p_context, '{}'::jsonb)
  );
$$;

create or replace function public.get_my_company_access_state(p_company_id uuid default null)
returns table (
  company_id uuid,
  company_name text,
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
  manual_activation_only boolean
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  with target_company as (
    select coalesce(
      p_company_id,
      (
        select uac.company_id
        from public.user_active_company uac
        join public.company_members cm
          on cm.company_id = uac.company_id
         and cm.user_id = uac.user_id
         and cm.status = 'active'::public.member_status
        where uac.user_id = auth.uid()
        order by uac.updated_at desc
        limit 1
      )
    ) as company_id
  )
  select
    c.id,
    c.name,
    css.plan_code,
    pc.display_name,
    css.subscription_status,
    public.company_access_effective_status(c.id) as effective_status,
    css.trial_started_at,
    css.trial_expires_at,
    css.paid_until,
    css.purge_scheduled_at,
    css.purge_completed_at,
    public.company_access_is_enabled(c.id) as access_enabled,
    pc.manual_activation_only
  from target_company tc
  join public.companies c
    on c.id = tc.company_id
  join public.company_subscription_state css
    on css.company_id = c.id
  join public.plan_catalog pc
    on pc.code = css.plan_code
  where exists (
    select 1
    from public.company_members cm
    where cm.company_id = c.id
      and (
        cm.user_id = auth.uid()
        or lower(cm.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
      and cm.status = any(array['active'::public.member_status, 'invited'::public.member_status])
  );
$$;

create or replace function public.get_platform_admin_status()
returns table (
  is_admin boolean
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  select public.is_platform_admin();
$$;

create or replace function public.platform_admin_list_company_access(p_search text default null)
returns table (
  company_id uuid,
  company_name text,
  owner_user_id uuid,
  plan_code text,
  plan_name text,
  subscription_status public.subscription_status,
  effective_status public.subscription_status,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  paid_until timestamptz,
  purge_scheduled_at timestamptz,
  purge_completed_at timestamptz,
  member_count integer,
  active_member_count integer,
  access_enabled boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  select
    c.id,
    c.name,
    c.owner_user_id,
    css.plan_code,
    pc.display_name,
    css.subscription_status,
    public.company_access_effective_status(c.id) as effective_status,
    css.trial_started_at,
    css.trial_expires_at,
    css.paid_until,
    css.purge_scheduled_at,
    css.purge_completed_at,
    (
      select count(*)::integer
      from public.company_members cm
      where cm.company_id = c.id
    ) as member_count,
    (
      select count(*)::integer
      from public.company_members cm
      where cm.company_id = c.id
        and cm.status = 'active'::public.member_status
    ) as active_member_count,
    public.company_access_is_enabled(c.id) as access_enabled,
    css.updated_at
  from public.companies c
  join public.company_subscription_state css
    on css.company_id = c.id
  join public.plan_catalog pc
    on pc.code = css.plan_code
  where public.is_platform_admin()
    and (
      p_search is null
      or btrim(p_search) = ''
      or c.name ilike '%' || btrim(p_search) || '%'
      or c.id::text = btrim(p_search)
      or css.plan_code ilike '%' || btrim(p_search) || '%'
    )
  order by css.updated_at desc, c.created_at desc;
$$;

create or replace function public.platform_admin_list_company_access_events(p_company_id uuid)
returns table (
  id uuid,
  company_id uuid,
  previous_plan_code text,
  next_plan_code text,
  previous_status public.subscription_status,
  next_status public.subscription_status,
  actor_user_id uuid,
  actor_email text,
  reason text,
  context jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
  select
    log.id,
    log.company_id,
    log.previous_plan_code,
    log.next_plan_code,
    log.previous_status,
    log.next_status,
    log.actor_user_id,
    log.actor_email,
    log.reason,
    log.context,
    log.created_at
  from public.company_access_audit_log log
  where public.is_platform_admin()
    and log.company_id = p_company_id
  order by log.created_at desc;
$$;

create or replace function public.platform_admin_set_company_access(
  p_company_id uuid,
  p_plan_code text,
  p_status public.subscription_status,
  p_paid_until timestamptz default null,
  p_trial_expires_at timestamptz default null,
  p_purge_scheduled_at timestamptz default null,
  p_reason text default null
)
returns table (
  company_id uuid,
  plan_code text,
  subscription_status public.subscription_status,
  effective_status public.subscription_status,
  trial_expires_at timestamptz,
  paid_until timestamptz,
  purge_scheduled_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set row_security to off
as $$
declare
  v_existing public.company_subscription_state%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_rate_allowed boolean;
  v_rate_retry integer;
  v_trial_expires_at timestamptz;
  v_purge_scheduled_at timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'platform_admin_set_company_access',
    coalesce(auth.uid()::text, lower(coalesce((auth.jwt() ->> 'email')::text, 'anonymous'))),
    60,
    30
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'platform_admin_rate_limited_retry_after_%s', coalesce(v_rate_retry, 60)
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.plan_catalog pc
    where pc.code = p_plan_code
  ) then
    raise exception 'invalid_plan_code' using errcode = '22023';
  end if;

  select *
    into v_existing
  from public.company_subscription_state css
  where css.company_id = p_company_id
  for update;

  if not found then
    raise exception 'company_subscription_state_missing' using errcode = 'P0001';
  end if;

  v_trial_expires_at := case
    when p_status = 'trial'::public.subscription_status then coalesce(p_trial_expires_at, v_now + interval '7 days')
    else null
  end;

  v_purge_scheduled_at := case
    when p_status = 'trial'::public.subscription_status then coalesce(p_purge_scheduled_at, v_trial_expires_at + interval '14 days')
    when p_status = 'expired'::public.subscription_status then coalesce(p_purge_scheduled_at, v_now + interval '14 days')
    else null
  end;

  update public.company_subscription_state
     set plan_code = p_plan_code,
         subscription_status = p_status,
         trial_started_at = case
           when p_status = 'trial'::public.subscription_status then coalesce(v_existing.trial_started_at, v_now)
           else v_existing.trial_started_at
         end,
         trial_expires_at = case
           when p_status = 'trial'::public.subscription_status then v_trial_expires_at
           else null
         end,
         paid_until = case
           when p_status = 'active_paid'::public.subscription_status then p_paid_until
           else null
         end,
         access_granted_by = case
           when p_status in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status) then auth.uid()
           else v_existing.access_granted_by
         end,
         access_granted_at = case
           when p_status in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status) then v_now
           else v_existing.access_granted_at
         end,
         grant_reason = case
           when p_status in ('trial'::public.subscription_status, 'active_paid'::public.subscription_status) then nullif(trim(coalesce(p_reason, '')), '')
           else v_existing.grant_reason
         end,
         access_revoked_by = case
           when p_status in ('expired'::public.subscription_status, 'suspended'::public.subscription_status, 'disabled'::public.subscription_status) then auth.uid()
           else null
         end,
         access_revoked_at = case
           when p_status in ('expired'::public.subscription_status, 'suspended'::public.subscription_status, 'disabled'::public.subscription_status) then v_now
           else null
         end,
         revoke_reason = case
           when p_status in ('expired'::public.subscription_status, 'suspended'::public.subscription_status, 'disabled'::public.subscription_status) then nullif(trim(coalesce(p_reason, '')), '')
           else null
         end,
         purge_scheduled_at = v_purge_scheduled_at,
         updated_by = auth.uid()
   where company_id = p_company_id;

  perform public.sync_company_purge_queue(
    p_company_id,
    v_purge_scheduled_at,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Subscription access updated'),
    auth.uid()
  );

  perform public.record_company_access_audit(
    p_company_id,
    v_existing.plan_code,
    p_plan_code,
    v_existing.subscription_status,
    p_status,
    p_reason,
    jsonb_build_object(
      'paid_until', p_paid_until,
      'trial_expires_at', v_trial_expires_at,
      'purge_scheduled_at', v_purge_scheduled_at
    )
  );

  return query
  select
    css.company_id,
    css.plan_code,
    css.subscription_status,
    public.company_access_effective_status(css.company_id),
    css.trial_expires_at,
    css.paid_until,
    css.purge_scheduled_at
  from public.company_subscription_state css
  where css.company_id = p_company_id;
end;
$$;

create or replace function public.create_company_and_bootstrap(p_name text)
returns table(out_company_id uuid, company_name text, out_role member_role)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_company_id uuid;
  v_trial_started_at timestamptz := timezone('utc', now());
  v_trial_expires_at timestamptz := timezone('utc', now()) + interval '7 days';
  v_purge_scheduled_at timestamptz := timezone('utc', now()) + interval '21 days';
  v_rate_allowed boolean;
  v_rate_retry integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'create_company_and_bootstrap',
    v_user::text,
    3600,
    3
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'company_bootstrap_rate_limited_retry_after_%s', coalesce(v_rate_retry, 3600)
      using errcode = 'P0001';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user;

  select cm.company_id
    into v_company_id
  from public.company_members cm
  where cm.user_id = v_user
    and cm.status = 'active'::member_status
  order by cm.created_at asc, cm.company_id asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id as out_company_id,
             c.name as company_name,
             cm.role as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id = v_user
       and cm.status = 'active'::member_status
      where c.id = v_company_id
      order by cm.created_at asc, cm.company_id asc
      limit 1;
    return;
  end if;

  with activated as (
    update public.company_members m
       set user_id = v_user,
           status = 'active'::member_status
     where m.status = 'invited'::member_status
       and (
         m.user_id = v_user
         or (
           v_email is not null
           and lower(m.email) = v_email
           and (m.user_id is null or m.user_id = v_user)
         )
       )
    returning m.company_id, m.created_at
  )
  select a.company_id
    into v_company_id
  from activated a
  order by a.created_at asc nulls last, a.company_id asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id as out_company_id,
             c.name as company_name,
             cm.role as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id = v_user
       and cm.status = 'active'::member_status
      where c.id = v_company_id
      order by cm.created_at asc, cm.company_id asc
      limit 1;
    return;
  end if;

  insert into public.companies (name, owner_user_id)
  values (coalesce(nullif(trim(p_name), ''), 'My Company'), v_user)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, email, role, status, invited_by)
  values (v_company_id, v_user, v_email, 'OWNER'::member_role, 'active'::member_status, v_user)
  on conflict on constraint company_members_pkey do update
    set user_id = excluded.user_id,
        role = 'OWNER'::member_role,
        status = 'active'::member_status,
        invited_by = excluded.invited_by;

  insert into public.company_settings (company_id, data)
  values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;

  perform public.seed_default_payment_terms(v_company_id);

  insert into public.company_subscription_state (
    company_id,
    plan_code,
    subscription_status,
    trial_started_at,
    trial_expires_at,
    purge_scheduled_at,
    access_granted_by,
    access_granted_at,
    grant_reason,
    updated_by
  )
  values (
    v_company_id,
    'trial_7d',
    'trial'::public.subscription_status,
    v_trial_started_at,
    v_trial_expires_at,
    v_purge_scheduled_at,
    v_user,
    v_trial_started_at,
    'Initial 7-day trial',
    v_user
  )
  on conflict (company_id) do nothing;

  perform public.sync_company_purge_queue(
    v_company_id,
    v_purge_scheduled_at,
    'Scheduled operational-data purge after 7-day trial expiry',
    v_user
  );

  perform public.record_company_access_audit(
    v_company_id,
    null,
    'trial_7d',
    null,
    'trial'::public.subscription_status,
    'Initial 7-day trial',
    jsonb_build_object(
      'trial_started_at', v_trial_started_at,
      'trial_expires_at', v_trial_expires_at,
      'purge_scheduled_at', v_purge_scheduled_at
    )
  );

  return query
    select c.id as out_company_id,
           c.name as company_name,
           'OWNER'::member_role as out_role
    from public.companies c
    where c.id = v_company_id
    limit 1;

exception
  when others then
    raise exception 'bootstrap_error: % (SQLSTATE=%)', sqlerrm, sqlstate;
end;
$$;

insert into public.company_subscription_state (
  company_id,
  plan_code,
  subscription_status,
  access_granted_by,
  access_granted_at,
  grant_reason,
  updated_by
)
select
  c.id,
  'legacy_manual',
  'active_paid'::public.subscription_status,
  c.owner_user_id,
  timezone('utc', now()),
  'Legacy manual access backfill',
  c.owner_user_id
from public.companies c
where not exists (
  select 1
  from public.company_subscription_state css
  where css.company_id = c.id
);

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select uac.company_id
  from public.user_active_company uac
  join public.company_members cm
    on cm.company_id = uac.company_id
   and cm.user_id = uac.user_id
   and cm.status = 'active'::member_status
  where uac.user_id = auth.uid()
    and public.company_access_is_enabled(uac.company_id)
  order by uac.updated_at desc
  limit 1;
$$;

create or replace function public.active_company_id()
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  with primary_source as (
    select uac.company_id
    from public.user_active_company uac
    join public.company_members cm
      on cm.company_id = uac.company_id
     and cm.user_id = uac.user_id
     and cm.status = 'active'::member_status
    where uac.user_id = auth.uid()
      and public.company_access_is_enabled(uac.company_id)
    order by uac.updated_at desc
    limit 1
  ),
  fallback as (
    select cm.company_id
    from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
      and public.company_access_is_enabled(cm.company_id)
    order by cm.role asc, cm.created_at asc
    limit 1
  )
  select coalesce(
    (select company_id from primary_source),
    (select company_id from fallback)
  );
$$;

create or replace function public.current_user_company_ids()
returns uuid[]
language sql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
set row_security to off
as $$
  select coalesce(array_agg(cm.company_id), '{}')
  from public.company_members cm
  where cm.user_id = auth.uid()
    and cm.status = 'active'::member_status
    and public.company_access_is_enabled(cm.company_id);
$$;

create or replace function public.has_company_role(cid uuid, p_roles member_role[])
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists(
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active'::member_status
      and m.role = any(p_roles)
  )
  and public.company_access_is_enabled(cid);
$$;

create or replace function public.has_company_role_any_status(cid uuid, p_roles member_role[])
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = any(array['active'::public.member_status, 'invited'::public.member_status])
      and m.role = any(p_roles)
  )
  and public.company_access_is_enabled(cid);
$$;

create or replace function public.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company
      and cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
  )
  and public.company_access_is_enabled(target_company);
$$;

create or replace function public.is_company_member(
  p_company_id uuid,
  p_status member_status[] default array['active'::member_status, 'invited'::member_status]
)
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.status = any(p_status)
  )
  and public.company_access_is_enabled(p_company_id);
$$;

create or replace function public.is_company_member(
  p_user uuid,
  p_company uuid,
  p_roles text[] default array['OWNER'::text, 'ADMIN'::text, 'MANAGER'::text, 'OPERATOR'::text, 'VIEWER'::text]
)
returns boolean
language sql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists (
    select 1
    from public.company_members m
    where m.user_id = coalesce(p_user, auth.uid())
      and m.company_id = p_company
      and m.status = 'active'::member_status
      and (
        p_roles is null
        or m.role::text = any (p_roles)
      )
  )
  and public.company_access_is_enabled(p_company);
$$;

create or replace function public.is_member_of_company(cid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.status = 'active'::member_status
      and (
        m.user_id = auth.uid()
        or lower(m.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
  )
  and public.company_access_is_enabled(cid);
$$;

create or replace function public.is_member_by_jwt(p_company_id uuid)
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and coalesce(cm.status,'active') in ('active','invited')
      and (
        cm.user_id = auth.uid()
        or lower(cm.email) = lower(coalesce(auth.jwt() ->> 'email',''))
      )
  )
  and public.company_access_is_enabled(p_company_id);
$$;

create or replace function public.actor_role_for(p_company uuid)
returns member_role
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
set row_security to 'off'
as $$
  select cm.role
  from public.company_members cm
  where cm.company_id = p_company
    and cm.user_id = auth.uid()
    and cm.status = 'active'
    and public.company_access_is_enabled(p_company)
  order by public.role_rank(cm.role) desc, cm.created_at asc
  limit 1
$$;

create or replace function public.finance_documents_can_read(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  )
  and public.company_access_is_enabled(p_company_id);
$$;

create or replace function public.finance_documents_has_min_role(p_company_id uuid, p_min_role member_role)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.finance_documents_is_system_context()
      or (
        public.company_access_is_enabled(p_company_id)
        and exists (
          select 1
          from public.company_members cm
          where cm.company_id = p_company_id
            and cm.user_id = auth.uid()
            and cm.status = 'active'
            and cm.role <= p_min_role
        )
      );
$$;

create or replace function public.finance_documents_can_write(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select public.finance_documents_can_prepare_draft(p_company_id);
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.company_access_effective_status(uuid) to authenticated;
grant execute on function public.company_access_is_enabled(uuid) to authenticated;
grant execute on function public.member_has_company_access(uuid, boolean) to authenticated;
grant execute on function public.get_my_company_access_state(uuid) to authenticated;
grant execute on function public.get_platform_admin_status() to authenticated;
grant execute on function public.platform_admin_list_company_access(text) to authenticated;
grant execute on function public.platform_admin_list_company_access_events(uuid) to authenticated;
grant execute on function public.platform_admin_set_company_access(uuid, text, public.subscription_status, timestamptz, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.create_company_and_bootstrap(text) to authenticated;
grant usage on type public.subscription_status to authenticated;

drop policy if exists platform_admins_self_status on public.platform_admins;
create policy platform_admins_self_status
  on public.platform_admins
  for select
  to authenticated
  using (
    is_active
    and (
      user_id = auth.uid()
      or lower(email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
    )
  );
