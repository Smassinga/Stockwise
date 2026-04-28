set check_function_bodies = off;

create or replace function public.create_company_and_bootstrap(p_name text)
returns table(out_company_id uuid, company_name text, out_role public.member_role)
language plpgsql
security definer
set search_path = pg_catalog, public
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

create or replace function public.accept_my_invite(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_role public.company_members.role%type;
  v_invited_by uuid;
  v_now timestamptz := now();
  v_has_any_invites boolean := false;
begin
  select lower(email) into v_email from auth.users where id = v_user_id;
  if v_user_id is null or v_email is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select i.role, i.created_by
    into v_role, v_invited_by
  from public.company_invites i
  where i.company_id = p_company_id
    and lower(i.email::text) = v_email
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > v_now)
  order by i.created_at desc, i.id desc
  limit 1;

  if v_role is null then
    select exists(
      select 1
      from public.company_invites i
      where i.company_id = p_company_id
        and lower(i.email::text) = v_email
    )
      into v_has_any_invites;

    if v_has_any_invites then
      raise exception 'invite_invalid_or_expired' using errcode = '22023';
    end if;

    select cm.role, cm.invited_by
      into v_role, v_invited_by
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.status = 'invited'::public.member_status
      and (cm.user_id = v_user_id or lower(cm.email) = v_email)
    order by cm.created_at desc
    limit 1;

    if v_role is null then
      raise exception 'invite_not_found' using errcode = '22023';
    end if;
  end if;

  insert into public.company_members (company_id, email, user_id, role, status, invited_by, created_at)
  values (p_company_id, v_email, v_user_id, v_role, 'active', v_invited_by, v_now)
  on conflict (company_id, email) do update
    set user_id = excluded.user_id,
        role = excluded.role,
        status = 'active',
        invited_by = coalesce(excluded.invited_by, public.company_members.invited_by);

  update public.company_invites
     set accepted_at = coalesce(accepted_at, v_now)
   where company_id = p_company_id
     and lower(email::text) = v_email
     and accepted_at is null
     and (expires_at is null or expires_at > v_now);

  return true;
end;
$$;

comment on function public.accept_my_invite(uuid)
  is 'Promote the authenticated user''s pending invite to an active membership for the selected company, while rejecting expired invite rows.';

create or replace function public.list_my_pending_company_invitations()
returns table(
  company_id uuid,
  company_name text,
  role public.member_role,
  invitation_status text,
  invited_at timestamptz,
  expires_at timestamptz,
  inviter_user_id uuid,
  inviter_name text,
  inviter_email text,
  source text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = v_user_id;
  if v_user_id is null or v_email is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return query
  with active_companies as (
    select distinct cm.company_id
    from public.company_members cm
    where (cm.user_id = v_user_id or lower(cm.email) = v_email)
      and cm.status = 'active'::public.member_status
  ),
  latest_invites as (
    select distinct on (i.company_id)
      i.company_id,
      coalesce(nullif(c.trade_name, ''), nullif(c.legal_name, ''), c.name) as company_name,
      i.role,
      i.created_at as invited_at,
      i.expires_at,
      i.created_by as inviter_user_id,
      coalesce(nullif(p.full_name, ''), nullif(p.name, ''), nullif(split_part(coalesce(p.email::text, ''), '@', 1), '')) as inviter_name,
      p.email::text as inviter_email,
      'invite'::text as source
    from public.company_invites i
    join public.companies c on c.id = i.company_id
    left join public.profiles p on p.id = i.created_by
    where lower(i.email::text) = v_email
      and i.accepted_at is null
      and (i.expires_at is null or i.expires_at > now())
      and not exists (
        select 1
        from active_companies ac
        where ac.company_id = i.company_id
      )
    order by i.company_id, i.created_at desc, i.id desc
  ),
  legacy_memberships as (
    select
      cm.company_id,
      coalesce(nullif(c.trade_name, ''), nullif(c.legal_name, ''), c.name) as company_name,
      cm.role,
      cm.created_at as invited_at,
      null::timestamptz as expires_at,
      cm.invited_by as inviter_user_id,
      coalesce(nullif(p.full_name, ''), nullif(p.name, ''), nullif(split_part(coalesce(p.email::text, ''), '@', 1), '')) as inviter_name,
      p.email::text as inviter_email,
      'membership'::text as source
    from public.company_members cm
    join public.companies c on c.id = cm.company_id
    left join public.profiles p on p.id = cm.invited_by
    where cm.status = 'invited'::public.member_status
      and (cm.user_id = v_user_id or lower(cm.email) = v_email)
      and not exists (
        select 1
        from latest_invites li
        where li.company_id = cm.company_id
      )
      and not exists (
        select 1
        from active_companies ac
        where ac.company_id = cm.company_id
      )
  )
  select
    li.company_id,
    li.company_name,
    li.role,
    'pending'::text as invitation_status,
    li.invited_at,
    li.expires_at,
    li.inviter_user_id,
    li.inviter_name,
    li.inviter_email,
    li.source
  from latest_invites li
  union all
  select
    lm.company_id,
    lm.company_name,
    lm.role,
    'pending'::text as invitation_status,
    lm.invited_at,
    lm.expires_at,
    lm.inviter_user_id,
    lm.inviter_name,
    lm.inviter_email,
    lm.source
  from legacy_memberships lm
  order by invited_at desc nulls last, company_name asc;
end;
$$;

comment on function public.list_my_pending_company_invitations()
  is 'Returns the authenticated user''s pending company invitations using the current account email, including company and inviter metadata for onboarding.';

grant execute on function public.list_my_pending_company_invitations() to authenticated;
