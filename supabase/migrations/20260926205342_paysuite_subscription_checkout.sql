begin;

-- PaySuite checkout is a separate ledger from assisted payment evidence. Its
-- reference and price are immutable after creation and never come from a client.
create table public.paysuite_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  request_key uuid not null,
  reference text not null unique,
  plan_code text not null references public.plan_catalog(code),
  billing_period text not null check (billing_period in ('monthly', 'six_month', 'annual')),
  gross_amount numeric(18,2) not null check (gross_amount > 0),
  currency_code text not null default 'MZN' check (currency_code = 'MZN'),
  state text not null default 'initiating' check (state in ('initiating', 'checkout_ready', 'paid', 'failed', 'requires_review')),
  provider_payment_id text unique,
  checkout_url text,
  checkout_started_at timestamptz,
  provider_status text,
  provider_verified_at timestamptz,
  paid_until timestamptz,
  review_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_id, request_key),
  check (state <> 'paid' or (provider_payment_id is not null and provider_verified_at is not null and paid_until is not null))
);

create index paysuite_subscription_payments_company_created_idx
  on public.paysuite_subscription_payments(company_id, created_at desc);
create index paysuite_subscription_payments_pending_idx
  on public.paysuite_subscription_payments(created_at)
  where state in ('initiating', 'checkout_ready');

alter table public.paysuite_subscription_payments enable row level security;
alter table public.paysuite_subscription_payments force row level security;

create policy paysuite_subscription_payments_member_read
  on public.paysuite_subscription_payments for select to authenticated
  using (exists (
    select 1 from public.company_members cm
    where cm.company_id = paysuite_subscription_payments.company_id
      and cm.user_id = (select auth.uid()) and cm.status = 'active'::public.member_status
  ));

revoke all on public.paysuite_subscription_payments from public, anon, authenticated;
grant select on public.paysuite_subscription_payments to authenticated;
grant select, insert, update on public.paysuite_subscription_payments to service_role;

create or replace function public.create_paysuite_subscription_intent(
  p_company_id uuid, p_plan_code text, p_period text, p_request_key uuid
) returns public.paysuite_subscription_payments
language plpgsql security definer
set search_path = 'pg_catalog', 'public' set row_security = off
as $$
declare v_plan record; v_state public.company_subscription_state%rowtype;
  v_row public.paysuite_subscription_payments%rowtype; v_id uuid := gen_random_uuid();
begin
  perform public.payment_request_assert_company_actor(p_company_id, true);
  perform public.payment_request_enforce_rate_limit('paysuite_checkout', auth.uid()::text, 6);
  if p_request_key is null then raise exception 'request_key_required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company_id::text, 0));
  select * into v_row from public.paysuite_subscription_payments
   where company_id = p_company_id and request_key = p_request_key;
  if found then
    if v_row.plan_code <> p_plan_code or v_row.billing_period <> p_period then
      raise exception 'request_key_payload_mismatch' using errcode='22023';
    end if;
    return v_row;
  end if;
  select * into v_plan from public.payment_request_plan_snapshot(p_plan_code, p_period);
  if not found or v_plan.amount is null or v_plan.amount <= 0 then
    raise exception 'payment_plan_not_available' using errcode='22023';
  end if;
  select * into v_state from public.company_subscription_state
    where company_id = p_company_id for update;
  if not found then raise exception 'company_subscription_state_missing'; end if;
  if v_state.subscription_status in ('suspended','disabled') then
    raise exception 'company_self_activation_blocked' using errcode='42501';
  end if;
  if v_state.subscription_status = 'active_paid' and v_state.paid_until > now()
    and v_state.plan_code <> p_plan_code then
    raise exception 'plan_change_requires_review' using errcode='22023';
  end if;
  if exists (
    select 1 from public.company_payment_requests r
    where r.company_id=p_company_id
      and r.status in ('draft','submitted','under_review','needs_correction')
  ) then raise exception 'assisted_request_pending' using errcode='23505'; end if;
  if exists (
    select 1 from public.paysuite_subscription_payments r
    where r.company_id=p_company_id and r.state='requires_review'
  ) then raise exception 'checkout_requires_review' using errcode='23505'; end if;
  -- A recent incomplete checkout is returned instead of creating another charge.
  select * into v_row from public.paysuite_subscription_payments
   where company_id=p_company_id and state in ('initiating','checkout_ready')
     and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if found then
    if v_row.plan_code <> p_plan_code or v_row.billing_period <> p_period then
      raise exception 'checkout_already_pending' using errcode='23505';
    end if;
    return v_row;
  end if;
  insert into public.paysuite_subscription_payments
    (id, company_id, created_by, request_key, reference, plan_code, billing_period, gross_amount)
  values (v_id, p_company_id, auth.uid(), p_request_key,
    'SW'||upper(replace(v_id::text, '-', '')), v_plan.plan_code, v_plan.period, v_plan.amount)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_paysuite_subscription_intent(uuid,text,text,uuid) from public,anon;
grant execute on function public.create_paysuite_subscription_intent(uuid,text,text,uuid) to authenticated;

-- Called only after the server verifies payment with PaySuite's GET endpoint.
-- The row lock makes repeated webhooks, polls, and recovery runs idempotent.
create or replace function public.apply_verified_paysuite_payment(
  p_payment_id uuid, p_provider_id text, p_reference text,
  p_amount numeric, p_currency text, p_provider_status text
) returns jsonb language plpgsql security definer
set search_path = 'pg_catalog', 'public' set row_security = off
as $$
declare v_payment public.paysuite_subscription_payments%rowtype;
  v_state public.company_subscription_state%rowtype;
  v_start timestamptz; v_until timestamptz; v_now timestamptz := timezone('utc',now());
begin
  select * into v_payment from public.paysuite_subscription_payments
    where id=p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if v_payment.state='paid' then
    if v_payment.provider_payment_id <> p_provider_id then raise exception 'provider_payment_mismatch'; end if;
    return jsonb_build_object('state','paid','paid_until',v_payment.paid_until);
  end if;
  if v_payment.provider_payment_id is distinct from p_provider_id
    or v_payment.reference is distinct from p_reference
    or v_payment.gross_amount is distinct from p_amount
    or p_currency <> 'MZN' or p_provider_status <> 'paid' then
    raise exception 'provider_payment_mismatch' using errcode='22023';
  end if;
  select * into v_state from public.company_subscription_state
    where company_id=v_payment.company_id for update;
  if not found then raise exception 'company_subscription_state_missing'; end if;
  if v_state.subscription_status in ('suspended','disabled')
    or (v_state.subscription_status='active_paid' and v_state.paid_until>v_now
      and v_state.plan_code<>v_payment.plan_code) then
    update public.paysuite_subscription_payments
      set state='requires_review', provider_status='paid', provider_verified_at=v_now,
          review_reason='restricted_or_plan_changed', updated_at=v_now
      where id=p_payment_id;
    return jsonb_build_object('state','requires_review');
  end if;
  v_start := case when v_state.subscription_status='active_paid' and v_state.paid_until>v_now
    then v_state.paid_until else v_now end;
  v_until := case v_payment.billing_period when 'monthly' then v_start+interval '1 month'
    when 'six_month' then v_start+interval '6 months'
    when 'annual' then v_start+interval '1 year' else null end;
  if v_until is null then raise exception 'invalid_billing_period'; end if;
  update public.company_subscription_state
    set plan_code=v_payment.plan_code, subscription_status='active_paid',
      paid_until=v_until, trial_expires_at=null, purge_scheduled_at=null,
      access_granted_by=null, access_granted_at=v_now,
      grant_reason='Verified PaySuite payment '||v_payment.reference,
      access_revoked_by=null, access_revoked_at=null, revoke_reason=null,
      updated_by=null, updated_at=v_now
    where company_id=v_payment.company_id;
  perform public.sync_company_purge_queue(v_payment.company_id,null,'Verified PaySuite payment',null);
  insert into public.company_access_audit_log
    (company_id, previous_plan_code, next_plan_code, previous_status, next_status,
     actor_user_id, actor_email, reason, context)
  values (v_payment.company_id, v_state.plan_code, v_payment.plan_code,
    v_state.subscription_status, 'active_paid', null, 'paysuite',
    'Verified PaySuite payment '||v_payment.reference,
    jsonb_build_object('provider_payment_id',p_provider_id,'payment_id',p_payment_id,
      'gross_amount',p_amount,'currency',p_currency,'paid_until',v_until));
  update public.paysuite_subscription_payments
    set state='paid', provider_status='paid', provider_verified_at=v_now,
      paid_until=v_until, review_reason=null, updated_at=v_now where id=p_payment_id;
  return jsonb_build_object('state','paid','paid_until',v_until);
end;
$$;

revoke all on function public.apply_verified_paysuite_payment(uuid,text,text,numeric,text,text)
  from public,anon,authenticated;
grant execute on function public.apply_verified_paysuite_payment(uuid,text,text,numeric,text,text)
  to service_role;

commit;
