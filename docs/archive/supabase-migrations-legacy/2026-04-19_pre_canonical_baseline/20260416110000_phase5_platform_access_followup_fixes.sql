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
set row_security to 'off'
as $function$
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

  update public.company_subscription_state css
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
   where css.company_id = p_company_id;

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
$function$;

grant execute on function public.platform_admin_set_company_access(
  uuid,
  text,
  public.subscription_status,
  timestamptz,
  timestamptz,
  timestamptz,
  text
) to authenticated;
