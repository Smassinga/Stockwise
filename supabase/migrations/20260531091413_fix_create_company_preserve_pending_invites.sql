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

  perform public.seed_default_uoms();

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

  -- Creating a company must not accept, activate, or consume pending invitations.
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

comment on function public.create_company_and_bootstrap(text)
  is 'Create the authenticated user''s own company or return an existing active company. Pending invitations are left untouched and require explicit acceptance.';

revoke all on function public.create_company_and_bootstrap(text) from public;
grant all on function public.create_company_and_bootstrap(text) to authenticated;
grant all on function public.create_company_and_bootstrap(text) to service_role;
