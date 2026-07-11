begin;

create or replace function public.payment_request_payload_hash(p_payload jsonb)
returns text language sql immutable
set search_path = 'pg_catalog', 'extensions'
as $$ select encode(extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public.payment_request_reference_fingerprint(p_value text)
returns text language sql immutable
set search_path = 'pg_catalog', 'extensions'
as $$
  select case when nullif(regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z0-9]+', '', 'g'), '') is null then null
    else encode(extensions.digest(convert_to(regexp_replace(lower(btrim(p_value)), '[^a-z0-9]+', '', 'g'), 'UTF8'), 'sha256'), 'hex') end
$$;

create or replace function public.payment_request_user_has_role(p_company_id uuid, p_roles public.member_role[])
returns boolean language sql stable security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = p_company_id and cm.user_id = auth.uid()
      and cm.status = 'active'::public.member_status and cm.role = any(p_roles)
  )
$$;

create or replace function public.payment_request_assert_company_actor(p_company_id uuid, p_mutation boolean default true)
returns void language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
declare v_status public.subscription_status;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not public.payment_request_user_has_role(p_company_id, array['OWNER','ADMIN']::public.member_role[]) then
    raise exception 'owner_or_admin_required' using errcode = '42501';
  end if;
  if p_mutation then
    select public.company_access_effective_status(p_company_id) into v_status;
    if v_status in ('suspended'::public.subscription_status, 'disabled'::public.subscription_status) then
      raise exception 'company_self_activation_blocked' using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function public.payment_request_enforce_rate_limit(p_scope text, p_subject text, p_max integer)
returns void language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
declare v_allowed boolean; v_retry integer;
begin
  select allowed, retry_after_seconds into v_allowed, v_retry
  from public.consume_security_rate_limit(p_scope, p_subject, 60, p_max);
  if not coalesce(v_allowed, false) then
    raise exception 'payment_request_rate_limited_retry_after_%', coalesce(v_retry, 60) using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.payment_request_claim(
  p_company_id uuid, p_operation_type text, p_request_key text, p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
declare v_key text := nullif(btrim(coalesce(p_request_key, '')), ''); v_hash text; v_row public.posting_requests%rowtype;
begin
  if v_key is null then raise exception 'request_key_required' using errcode = '22023'; end if;
  v_hash := public.payment_request_payload_hash(p_payload);
  insert into public.posting_requests(company_id, operation_type, request_key, payload_hash, status, created_by)
  values (p_company_id, p_operation_type, v_key, v_hash, 'in_progress', auth.uid())
  on conflict (company_id, operation_type, request_key) do nothing;
  select * into v_row from public.posting_requests
  where company_id = p_company_id and operation_type = p_operation_type and request_key = v_key for update;
  if v_row.payload_hash <> v_hash then raise exception 'request_key_payload_mismatch' using errcode = '22023'; end if;
  if v_row.status = 'succeeded' then return v_row.result_payload; end if;
  if v_row.status <> 'in_progress' or v_row.created_by is distinct from auth.uid() then
    raise exception 'request_in_progress' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create or replace function public.payment_request_finish(
  p_company_id uuid, p_operation_type text, p_request_key text, p_result jsonb, p_ref_type text, p_ref_id text
) returns jsonb language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
begin
  update public.posting_requests set status='succeeded', result_payload=p_result,
    result_ref_type=p_ref_type, result_ref_id=p_ref_id, updated_at=timezone('utc', now())
  where company_id=p_company_id and operation_type=p_operation_type and request_key=btrim(p_request_key) and status='in_progress';
  if not found then raise exception 'posting_request_completion_failed'; end if;
  return p_result;
end;
$$;

create or replace function public.payment_request_append_event(
  p_request_id uuid, p_event_type text, p_previous_status text, p_new_status text,
  p_actor_class text, p_reason text default null, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
declare v_company uuid; v_sequence bigint; v_id uuid;
begin
  update public.company_payment_requests set latest_event_sequence=latest_event_sequence+1,
    updated_at=timezone('utc', now()), updated_by=auth.uid()
  where id=p_request_id returning company_id, latest_event_sequence into v_company, v_sequence;
  if not found then raise exception 'payment_request_not_found'; end if;
  insert into public.company_payment_request_events(request_id,company_id,sequence,event_type,previous_status,new_status,actor_user_id,actor_class,reason,metadata)
  values(p_request_id,v_company,v_sequence,p_event_type,p_previous_status,p_new_status,auth.uid(),p_actor_class,nullif(btrim(coalesce(p_reason,'')),''),coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.payment_request_plan_snapshot(p_plan_code text, p_period text)
returns table(plan_code text, plan_name text, amount numeric, period text)
language sql stable security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
  select pc.code, pc.display_name,
    case p_period when 'monthly' then pc.monthly_price_mzn when 'six_month' then pc.six_month_price_mzn when 'annual' then pc.annual_price_mzn end::numeric(18,2),
    p_period
  from public.plan_catalog pc
  where pc.code=p_plan_code and pc.is_public=true and p_period in ('monthly','six_month','annual')
    and case p_period when 'monthly' then pc.monthly_price_mzn when 'six_month' then pc.six_month_price_mzn when 'annual' then pc.annual_price_mzn end is not null
$$;

create or replace function public.payment_request_validate_proof(p_request_id uuid)
returns table(path text, mime_type text, size_bytes bigint)
language plpgsql security definer
set search_path = 'pg_catalog', 'public', 'storage'
set row_security = off
as $$
declare v_request public.company_payment_requests%rowtype; v_object storage.objects%rowtype; v_expected text;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id;
  if not found then raise exception 'payment_request_not_found'; end if;
  v_expected := v_request.company_id::text || '/' || v_request.id::text || '/proof';
  select * into v_object from storage.objects where bucket_id='payment-proofs' and name=v_expected;
  if not found then raise exception 'payment_proof_required' using errcode='22023'; end if;
  mime_type := coalesce(v_object.metadata->>'mimetype','');
  size_bytes := coalesce((v_object.metadata->>'size')::bigint,0);
  if mime_type not in ('image/jpeg','image/png','application/pdf') then raise exception 'payment_proof_invalid_type' using errcode='22023'; end if;
  if size_bytes < 1 or size_bytes > 5242880 then raise exception 'payment_proof_invalid_size' using errcode='22023'; end if;
  path := v_expected; return next;
end;
$$;

create or replace function public.list_available_payment_plans()
returns table(plan_code text, display_name text, billing_period text, amount numeric, currency_code text)
language sql stable security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
  select pc.code, pc.display_name, v.period, v.amount::numeric(18,2), 'MZN'::text
  from public.plan_catalog pc
  cross join lateral (values ('monthly',pc.monthly_price_mzn),('six_month',pc.six_month_price_mzn),('annual',pc.annual_price_mzn)) v(period,amount)
  where auth.uid() is not null
    and exists(select 1 from public.company_members cm where cm.user_id=auth.uid() and cm.status='active'::public.member_status)
    and pc.is_public=true and v.amount is not null and v.amount > 0
  order by pc.sort_order, case v.period when 'monthly' then 1 when 'six_month' then 2 else 3 end
$$;

create or replace function public.list_available_payment_channels()
returns table(
  id uuid, method_code text, display_name text, provider_category text, destination_identifier text,
  account_name text, currency_code text, customer_instructions text, is_active boolean,
  sort_order integer, effective_from timestamptz, effective_until timestamptz, created_at timestamptz, updated_at timestamptz
) language sql stable security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
  select c.id,c.method_code,c.display_name,c.provider_category,c.destination_identifier,c.account_name,c.currency_code,
    c.customer_instructions,c.is_active,c.sort_order,c.effective_from,c.effective_until,c.created_at,c.updated_at
  from public.platform_payment_channels c
  where auth.uid() is not null
    and exists(select 1 from public.company_members cm where cm.user_id=auth.uid() and cm.status='active'::public.member_status)
    and c.is_active
    and (c.effective_from is null or c.effective_from<=timezone('utc',now()))
    and (c.effective_until is null or c.effective_until>timezone('utc',now()))
  order by c.sort_order,c.display_name
$$;

create or replace function public.create_company_payment_request(
  p_company_id uuid, p_plan_code text, p_billing_period text, p_payment_channel_id uuid, p_request_key text
) returns jsonb language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
declare v_replay jsonb; v_plan record; v_channel public.platform_payment_channels%rowtype; v_id uuid:=gen_random_uuid(); v_num bigint; v_ref text; v_result jsonb;
begin
  perform public.payment_request_assert_company_actor(p_company_id,true);
  perform public.payment_request_enforce_rate_limit('payment_request_create',auth.uid()::text,10);
  v_replay:=public.payment_request_claim(p_company_id,'subscription.payment_request.create',p_request_key,
    jsonb_build_object('company_id',p_company_id,'plan_code',p_plan_code,'period',p_billing_period,'channel_id',p_payment_channel_id));
  if v_replay is not null then return v_replay; end if;
  select * into v_plan from public.payment_request_plan_snapshot(p_plan_code,p_billing_period);
  if not found or v_plan.amount is null or v_plan.amount<=0 then raise exception 'payment_plan_not_available' using errcode='22023'; end if;
  select * into v_channel from public.platform_payment_channels where id=p_payment_channel_id and is_active
    and (effective_from is null or effective_from<=timezone('utc',now())) and (effective_until is null or effective_until>timezone('utc',now()));
  if not found then raise exception 'payment_channel_not_available' using errcode='22023'; end if;
  insert into public.company_payment_request_counters(company_id,next_number) values(p_company_id,2)
  on conflict(company_id) do update set next_number=company_payment_request_counters.next_number+1,updated_at=timezone('utc',now())
  returning next_number-1 into v_num;
  v_ref:='PAY-'||upper(substr(replace(p_company_id::text,'-',''),1,6))||'-'||lpad(v_num::text,6,'0');
  insert into public.company_payment_requests(id,reference,company_id,requested_plan_code,plan_name_snapshot,plan_price_snapshot,billing_period_snapshot,
    expected_amount_snapshot,currency_snapshot,payment_channel_id,payment_provider_category_snapshot,payment_channel_display_snapshot,payment_destination_snapshot,payment_instructions_snapshot,created_by)
  values(v_id,v_ref,p_company_id,v_plan.plan_code,v_plan.plan_name,v_plan.amount,v_plan.period,v_plan.amount,v_channel.currency_code,
    v_channel.id,v_channel.provider_category,v_channel.display_name,v_channel.destination_identifier,v_channel.customer_instructions,auth.uid());
  perform public.payment_request_append_event(v_id,'created',null,'draft','company_user',null,
    jsonb_build_object('plan_code',v_plan.plan_code,'period',v_plan.period,'expected_amount',v_plan.amount,'channel_id',v_channel.id));
  v_result:=jsonb_build_object('request_id',v_id,'reference',v_ref,'status','draft','upload_path',p_company_id::text||'/'||v_id::text||'/proof',
    'expected_amount',v_plan.amount,'currency',v_channel.currency_code);
  return public.payment_request_finish(p_company_id,'subscription.payment_request.create',p_request_key,v_result,'company_payment_request',v_id::text);
end;
$$;

create or replace function public.update_company_payment_request_draft(
  p_request_id uuid, p_plan_code text, p_billing_period text, p_payment_channel_id uuid,
  p_payer_name text, p_payer_phone text, p_transaction_reference text, p_declared_amount numeric, p_note text, p_request_key text
) returns jsonb language plpgsql security definer
set search_path = 'pg_catalog', 'public'
set row_security = off
as $$
declare v_request public.company_payment_requests%rowtype; v_plan record; v_channel public.platform_payment_channels%rowtype; v_replay jsonb; v_result jsonb; v_amount numeric(18,2); v_fp text;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_request_assert_company_actor(v_request.company_id,true);
  if v_request.status not in ('draft','needs_correction') then raise exception 'payment_request_not_editable'; end if;
  if p_declared_amount is null or p_declared_amount<=0 then raise exception 'declared_amount_must_be_positive' using errcode='22023'; end if;
  v_amount:=round(p_declared_amount,2);
  v_fp:=public.payment_request_reference_fingerprint(p_transaction_reference);
  if v_fp is null then raise exception 'transaction_reference_required' using errcode='22023'; end if;
  v_replay:=public.payment_request_claim(v_request.company_id,'subscription.payment_request.update',p_request_key,jsonb_build_object(
    'request_id',p_request_id,'plan_code',p_plan_code,'period',p_billing_period,'channel_id',p_payment_channel_id,
    'payer_name',btrim(p_payer_name),'payer_phone',btrim(p_payer_phone),'reference_fingerprint',v_fp,'amount',v_amount,'note',btrim(coalesce(p_note,''))));
  if v_replay is not null then return v_replay; end if;
  select * into v_plan from public.payment_request_plan_snapshot(p_plan_code,p_billing_period);
  if not found then raise exception 'payment_plan_not_available'; end if;
  select * into v_channel from public.platform_payment_channels where id=p_payment_channel_id and is_active
    and (effective_from is null or effective_from<=timezone('utc',now())) and (effective_until is null or effective_until>timezone('utc',now()));
  if not found then raise exception 'payment_channel_not_available'; end if;
  update public.company_payment_requests set requested_plan_code=v_plan.plan_code,plan_name_snapshot=v_plan.plan_name,
    plan_price_snapshot=v_plan.amount,billing_period_snapshot=v_plan.period,expected_amount_snapshot=v_plan.amount,
    currency_snapshot=v_channel.currency_code,payment_channel_id=v_channel.id,payment_provider_category_snapshot=v_channel.provider_category,payment_channel_display_snapshot=v_channel.display_name,
    payment_destination_snapshot=v_channel.destination_identifier,payment_instructions_snapshot=v_channel.customer_instructions,
    payer_name=nullif(btrim(p_payer_name),''),payer_phone=nullif(btrim(p_payer_phone),''),
    provider_transaction_reference=btrim(p_transaction_reference),provider_reference_fingerprint=v_fp,declared_paid_amount=v_amount,
    amount_mismatch=(v_amount<>v_plan.amount),company_submission_note=nullif(btrim(coalesce(p_note,'')),''),updated_by=auth.uid(),updated_at=timezone('utc',now())
  where id=p_request_id;
  v_result:=jsonb_build_object('request_id',p_request_id,'status',v_request.status,'expected_amount',v_plan.amount,'declared_amount',v_amount,'amount_mismatch',v_amount<>v_plan.amount);
  return public.payment_request_finish(v_request.company_id,'subscription.payment_request.update',p_request_key,v_result,'company_payment_request',p_request_id::text);
end;
$$;

create or replace function public.attach_company_payment_request_proof(p_request_id uuid, p_request_key text)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype; v_proof record; v_replay jsonb; v_result jsonb;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_request_assert_company_actor(v_request.company_id,true);
  if v_request.status not in ('draft','needs_correction') then raise exception 'payment_request_not_editable'; end if;
  v_replay:=public.payment_request_claim(v_request.company_id,'subscription.payment_request.proof.attach',p_request_key,jsonb_build_object('request_id',p_request_id));
  if v_replay is not null then return v_replay; end if;
  select * into v_proof from public.payment_request_validate_proof(p_request_id);
  update public.company_payment_requests set proof_bucket='payment-proofs',proof_path=v_proof.path,
    proof_mime_type=v_proof.mime_type,proof_size_bytes=v_proof.size_bytes,updated_by=auth.uid(),updated_at=timezone('utc',now()) where id=p_request_id;
  perform public.payment_request_append_event(p_request_id,'proof_attached',v_request.status,v_request.status,'company_user',null,
    jsonb_build_object('mime_type',v_proof.mime_type,'size_bytes',v_proof.size_bytes));
  v_result:=jsonb_build_object('request_id',p_request_id,'proof_attached',true,'mime_type',v_proof.mime_type,'size_bytes',v_proof.size_bytes);
  return public.payment_request_finish(v_request.company_id,'subscription.payment_request.proof.attach',p_request_key,v_result,'company_payment_request',p_request_id::text);
end;
$$;

create or replace function public.payment_request_submit_internal(p_request_id uuid, p_request_key text, p_is_resubmit boolean)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype; v_proof record; v_replay jsonb; v_result jsonb; v_op text; v_event text;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_request_assert_company_actor(v_request.company_id,true);
  if (p_is_resubmit and v_request.status<>'needs_correction') or (not p_is_resubmit and v_request.status<>'draft') then
    raise exception 'payment_request_not_submittable';
  end if;
  if nullif(btrim(coalesce(v_request.payer_name,'')),'') is null then raise exception 'payer_name_required'; end if;
  if v_request.provider_reference_fingerprint is null then raise exception 'transaction_reference_required'; end if;
  if v_request.declared_paid_amount is null or v_request.declared_paid_amount<=0 then raise exception 'declared_amount_must_be_positive'; end if;
  if not exists(select 1 from public.plan_catalog pc where pc.code=v_request.requested_plan_code and pc.is_public) then raise exception 'payment_plan_not_available'; end if;
  if not exists(select 1 from public.platform_payment_channels pc where pc.id=v_request.payment_channel_id and pc.is_active
    and (pc.effective_from is null or pc.effective_from<=timezone('utc',now())) and (pc.effective_until is null or pc.effective_until>timezone('utc',now()))) then raise exception 'payment_channel_not_available'; end if;
  v_op:=case when p_is_resubmit then 'subscription.payment_request.resubmit' else 'subscription.payment_request.submit' end;
  v_event:=case when p_is_resubmit then 'resubmitted' else 'submitted' end;
  perform public.payment_request_enforce_rate_limit('payment_request_submit',auth.uid()::text,15);
  v_replay:=public.payment_request_claim(v_request.company_id,v_op,p_request_key,jsonb_build_object('request_id',p_request_id,'fingerprint',v_request.provider_reference_fingerprint));
  if v_replay is not null then return v_replay; end if;
  select * into v_proof from public.payment_request_validate_proof(p_request_id);
  if exists(select 1 from public.company_payment_requests other where other.id<>p_request_id
    and other.payment_provider_category_snapshot=v_request.payment_provider_category_snapshot and other.provider_reference_fingerprint=v_request.provider_reference_fingerprint
    and other.status in ('submitted','under_review','needs_correction','approved')) then
    raise exception 'provider_reference_already_used' using errcode='23505';
  end if;
  update public.company_payment_requests set status='submitted',proof_bucket='payment-proofs',proof_path=v_proof.path,
    proof_mime_type=v_proof.mime_type,proof_size_bytes=v_proof.size_bytes,submitted_by=auth.uid(),submitted_at=timezone('utc',now()),
    correction_reason=null,updated_by=auth.uid(),updated_at=timezone('utc',now()) where id=p_request_id;
  perform public.payment_request_append_event(p_request_id,v_event,v_request.status,'submitted','company_user',v_request.company_submission_note,
    jsonb_build_object('amount_mismatch',v_request.amount_mismatch));
  insert into public.company_control_action_log(company_id,action_type,actor_user_id,actor_email,reason,context)
  values(v_request.company_id,'payment_request_submitted',auth.uid(),auth.jwt()->>'email',coalesce(v_request.company_submission_note,'Payment activation request submitted'),jsonb_build_object('request_id',p_request_id,'reference',v_request.reference));
  v_result:=jsonb_build_object('request_id',p_request_id,'reference',v_request.reference,'status','submitted');
  return public.payment_request_finish(v_request.company_id,v_op,p_request_key,v_result,'company_payment_request',p_request_id::text);
end;
$$;

create or replace function public.submit_company_payment_request(p_request_id uuid,p_request_key text)
returns jsonb language sql security definer set search_path='pg_catalog','public'
as $$ select public.payment_request_submit_internal(p_request_id,p_request_key,false) $$;

create or replace function public.resubmit_company_payment_request(p_request_id uuid,p_request_key text)
returns jsonb language sql security definer set search_path='pg_catalog','public'
as $$ select public.payment_request_submit_internal(p_request_id,p_request_key,true) $$;

create or replace function public.cancel_company_payment_request(p_request_id uuid,p_reason text,p_request_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype; v_replay jsonb; v_result jsonb;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_request_assert_company_actor(v_request.company_id,true);
  if v_request.status not in ('draft','submitted','under_review','needs_correction') then raise exception 'payment_request_not_cancellable'; end if;
  v_replay:=public.payment_request_claim(v_request.company_id,'subscription.payment_request.cancel',p_request_key,jsonb_build_object('request_id',p_request_id,'reason',btrim(coalesce(p_reason,''))));
  if v_replay is not null then return v_replay; end if;
  update public.company_payment_requests set status='cancelled',cancelled_by=auth.uid(),cancelled_at=timezone('utc',now()),updated_by=auth.uid(),updated_at=timezone('utc',now()) where id=p_request_id;
  perform public.payment_request_append_event(p_request_id,'cancelled',v_request.status,'cancelled','company_user',p_reason);
  insert into public.company_control_action_log(company_id,action_type,actor_user_id,actor_email,reason,context)
  values(v_request.company_id,'payment_request_cancelled',auth.uid(),auth.jwt()->>'email',coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Company cancelled payment request'),jsonb_build_object('request_id',p_request_id));
  v_result:=jsonb_build_object('request_id',p_request_id,'status','cancelled');
  return public.payment_request_finish(v_request.company_id,'subscription.payment_request.cancel',p_request_key,v_result,'company_payment_request',p_request_id::text);
end;
$$;

create or replace function public.list_my_company_payment_requests(p_company_id uuid)
returns setof public.company_payment_requests language plpgsql security definer
set search_path='pg_catalog','public' set row_security=off
as $$ begin
  if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and status='active'::public.member_status) then
    raise exception 'company_membership_required' using errcode='42501'; end if;
  return query select * from public.company_payment_requests where company_id=p_company_id order by created_at desc;
end $$;

create or replace function public.get_my_company_payment_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id;
  if not found or not exists(select 1 from public.company_members where company_id=v_request.company_id and user_id=auth.uid() and status='active'::public.member_status) then
    raise exception 'payment_request_not_found'; end if;
  return jsonb_build_object('request',to_jsonb(v_request),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.sequence) from public.company_payment_request_events e where e.request_id=p_request_id),'[]'::jsonb));
end $$;

create or replace function public.authorize_company_payment_proof_access(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype;
begin
  select * into v_request from public.company_payment_requests where id=p_request_id;
  if not found or not exists(select 1 from public.company_members where company_id=v_request.company_id and user_id=auth.uid() and status='active'::public.member_status) then raise exception 'payment_request_not_found'; end if;
  if v_request.proof_path is null then raise exception 'payment_proof_required'; end if;
  perform public.payment_request_enforce_rate_limit('payment_proof_signed_url',auth.uid()::text,20);
  return jsonb_build_object('bucket','payment-proofs','path',v_request.proof_path,'expires_in',120);
end $$;

create or replace function public.platform_admin_list_payment_channels()
returns setof public.platform_payment_channels language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$ begin if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
return query select * from public.platform_payment_channels order by sort_order,display_name; end $$;

create or replace function public.platform_admin_upsert_payment_channel(
  p_id uuid,p_method_code text,p_display_name text,p_provider_category text,p_destination_identifier text,p_account_name text,
  p_currency_code text,p_operator_instructions text,p_customer_instructions text,p_is_active boolean,p_sort_order integer,
  p_effective_from timestamptz,p_effective_until timestamptz
) returns uuid language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid()); v_event text; v_snapshot jsonb;
begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  if p_provider_category not in ('mpesa','emola','mkesh','bank_transfer','other') then raise exception 'invalid_provider_category'; end if;
  if nullif(btrim(coalesce(p_method_code,'')),'') is null or nullif(btrim(coalesce(p_display_name,'')),'') is null
    or nullif(btrim(coalesce(p_destination_identifier,'')),'') is null or nullif(btrim(coalesce(p_customer_instructions,'')),'') is null then raise exception 'payment_channel_fields_required'; end if;
  v_event:=case when p_id is null then 'created' else 'updated' end;
  insert into public.platform_payment_channels(id,method_code,display_name,provider_category,destination_identifier,account_name,currency_code,
    operator_instructions,customer_instructions,is_active,sort_order,effective_from,effective_until,created_by,updated_by)
  values(v_id,lower(btrim(p_method_code)),btrim(p_display_name),p_provider_category,btrim(p_destination_identifier),nullif(btrim(coalesce(p_account_name,'')),''),
    upper(coalesce(nullif(btrim(p_currency_code),''),'MZN')),nullif(btrim(coalesce(p_operator_instructions,'')),''),btrim(p_customer_instructions),coalesce(p_is_active,false),coalesce(p_sort_order,100),p_effective_from,p_effective_until,auth.uid(),auth.uid())
  on conflict(id) do update set method_code=excluded.method_code,display_name=excluded.display_name,provider_category=excluded.provider_category,
    destination_identifier=excluded.destination_identifier,account_name=excluded.account_name,currency_code=excluded.currency_code,
    operator_instructions=excluded.operator_instructions,customer_instructions=excluded.customer_instructions,is_active=excluded.is_active,
    sort_order=excluded.sort_order,effective_from=excluded.effective_from,effective_until=excluded.effective_until,updated_by=auth.uid(),updated_at=timezone('utc',now());
  select to_jsonb(c)-'created_by'-'updated_by' into v_snapshot from public.platform_payment_channels c where c.id=v_id;
  insert into public.platform_payment_channel_events(channel_id,event_type,actor_user_id,actor_email,snapshot) values(v_id,v_event,auth.uid(),auth.jwt()->>'email',v_snapshot);
  return v_id;
end $$;

create or replace function public.platform_admin_set_payment_channel_status(p_channel_id uuid,p_is_active boolean)
returns uuid language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_snapshot jsonb;
begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  update public.platform_payment_channels set is_active=p_is_active,updated_by=auth.uid(),updated_at=timezone('utc',now()) where id=p_channel_id;
  if not found then raise exception 'payment_channel_not_found'; end if;
  select to_jsonb(c)-'created_by'-'updated_by' into v_snapshot from public.platform_payment_channels c where c.id=p_channel_id;
  insert into public.platform_payment_channel_events(channel_id,event_type,actor_user_id,actor_email,snapshot)
  values(p_channel_id,case when p_is_active then 'activated' else 'deactivated' end,auth.uid(),auth.jwt()->>'email',v_snapshot);
  return p_channel_id;
end $$;

create or replace function public.platform_admin_list_payment_requests(p_status text default null,p_search text default null)
returns table(request_data jsonb) language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$ begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  return query select to_jsonb(r)||jsonb_build_object('company_name',c.name,'current_access_status',public.company_access_effective_status(r.company_id),
    'current_plan_code',s.plan_code,'current_paid_until',s.paid_until)
  from public.company_payment_requests r join public.companies c on c.id=r.company_id
  join public.company_subscription_state s on s.company_id=r.company_id
  where (p_status is null or r.status=p_status) and (nullif(btrim(coalesce(p_search,'')),'') is null or c.name ilike '%'||btrim(p_search)||'%' or r.reference ilike '%'||btrim(p_search)||'%')
  order by coalesce(r.submitted_at,r.created_at) desc;
end $$;

create or replace function public.platform_admin_get_payment_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  select jsonb_build_object('request',to_jsonb(r)||jsonb_build_object('company_name',c.name,'current_access_status',public.company_access_effective_status(r.company_id),
    'current_plan_code',s.plan_code,'current_paid_until',s.paid_until),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.sequence) from public.company_payment_request_events e where e.request_id=r.id),'[]'::jsonb))
  into v_result from public.company_payment_requests r join public.companies c on c.id=r.company_id join public.company_subscription_state s on s.company_id=r.company_id where r.id=p_request_id;
  if v_result is null then raise exception 'payment_request_not_found'; end if; return v_result;
end $$;

create or replace function public.platform_admin_authorize_payment_proof_access(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$ declare v_path text; begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  perform public.payment_request_enforce_rate_limit('platform_payment_proof_signed_url',auth.uid()::text,60);
  select proof_path into v_path from public.company_payment_requests where id=p_request_id;
  if v_path is null then raise exception 'payment_proof_required'; end if;
  return jsonb_build_object('bucket','payment-proofs','path',v_path,'expires_in',120);
end $$;

create or replace function public.platform_admin_payment_request_transition(
  p_request_id uuid,p_request_key text,p_operation text,p_event text,p_target_status text,p_reason text,p_allowed_statuses text[]
) returns jsonb language plpgsql security definer set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype; v_replay jsonb; v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  select * into v_request from public.company_payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_request_enforce_rate_limit('platform_payment_review',auth.uid()::text,60);
  v_replay:=public.payment_request_claim(v_request.company_id,p_operation,p_request_key,jsonb_build_object('request_id',p_request_id,'target_status',p_target_status,'reason',btrim(coalesce(p_reason,''))));
  if v_replay is not null then return v_replay; end if;
  if not (v_request.status=any(p_allowed_statuses)) then raise exception 'payment_request_transition_not_allowed'; end if;
  if p_target_status in ('needs_correction','rejected') and nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'review_reason_required'; end if;
  update public.company_payment_requests set status=p_target_status,platform_review_note=nullif(btrim(coalesce(p_reason,'')),''),
    correction_reason=case when p_target_status='needs_correction' then btrim(p_reason) else correction_reason end,
    reviewed_by=auth.uid(),reviewed_at=timezone('utc',now()),
    rejected_by=case when p_target_status='rejected' then auth.uid() else rejected_by end,
    rejected_at=case when p_target_status='rejected' then timezone('utc',now()) else rejected_at end,
    updated_by=auth.uid(),updated_at=timezone('utc',now()) where id=p_request_id;
  perform public.payment_request_append_event(p_request_id,p_event,v_request.status,p_target_status,'platform_admin',p_reason);
  insert into public.company_control_action_log(company_id,action_type,actor_user_id,actor_email,reason,context)
  values(v_request.company_id,case p_target_status when 'under_review' then 'payment_request_review_started' when 'needs_correction' then 'payment_request_correction_requested' else 'payment_request_rejected' end,
    auth.uid(),auth.jwt()->>'email',coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Payment request review started'),jsonb_build_object('request_id',p_request_id,'reference',v_request.reference));
  v_result:=jsonb_build_object('request_id',p_request_id,'reference',v_request.reference,'status',p_target_status);
  return public.payment_request_finish(v_request.company_id,p_operation,p_request_key,v_result,'company_payment_request',p_request_id::text);
end $$;

create or replace function public.platform_admin_start_payment_review(p_request_id uuid,p_note text,p_request_key text)
returns jsonb language sql security definer set search_path='pg_catalog','public'
as $$ select public.platform_admin_payment_request_transition(p_request_id,p_request_key,'subscription.payment_request.review','review_started','under_review',p_note,array['submitted']) $$;

create or replace function public.platform_admin_request_payment_correction(p_request_id uuid,p_reason text,p_request_key text)
returns jsonb language sql security definer set search_path='pg_catalog','public'
as $$ select public.platform_admin_payment_request_transition(p_request_id,p_request_key,'subscription.payment_request.correction','correction_requested','needs_correction',p_reason,array['submitted','under_review']) $$;

create or replace function public.platform_admin_reject_payment_request(p_request_id uuid,p_reason text,p_request_key text)
returns jsonb language sql security definer set search_path='pg_catalog','public'
as $$ select public.platform_admin_payment_request_transition(p_request_id,p_request_key,'subscription.payment_request.reject','rejected','rejected',p_reason,array['submitted','under_review']) $$;

create or replace function public.platform_admin_approve_payment_request(p_request_id uuid,p_review_note text,p_request_key text)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','public' set row_security=off
as $$
declare v_request public.company_payment_requests%rowtype; v_state public.company_subscription_state%rowtype; v_proof record;
  v_replay jsonb; v_result jsonb; v_now timestamptz:=timezone('utc',now()); v_start timestamptz; v_until timestamptz; v_access record;
begin
  if not public.is_platform_admin() then raise exception 'platform_admin_required' using errcode='42501'; end if;
  select * into v_request from public.company_payment_requests where id=p_request_id for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_request_enforce_rate_limit('platform_payment_approve',auth.uid()::text,30);
  v_replay:=public.payment_request_claim(v_request.company_id,'subscription.payment_request.approve',p_request_key,
    jsonb_build_object('request_id',p_request_id,'review_note',btrim(coalesce(p_review_note,''))));
  if v_replay is not null then return v_replay; end if;
  if v_request.status not in ('submitted','under_review') then raise exception 'payment_request_not_approvable'; end if;
  if v_request.provider_reference_fingerprint is null then raise exception 'transaction_reference_required'; end if;
  select * into v_proof from public.payment_request_validate_proof(p_request_id);
  if not exists(select 1 from public.plan_catalog where code=v_request.requested_plan_code) then raise exception 'requested_plan_no_longer_exists'; end if;
  if exists(select 1 from public.company_payment_requests other where other.id<>p_request_id
    and other.payment_provider_category_snapshot=v_request.payment_provider_category_snapshot and other.provider_reference_fingerprint=v_request.provider_reference_fingerprint and other.status='approved') then
    raise exception 'provider_reference_already_approved' using errcode='23505'; end if;
  select * into v_state from public.company_subscription_state where company_id=v_request.company_id for update;
  if not found then raise exception 'company_subscription_state_missing'; end if;
  v_start:=case when v_state.subscription_status='active_paid'::public.subscription_status and v_state.paid_until>v_now then v_state.paid_until else v_now end;
  v_until:=case v_request.billing_period_snapshot when 'monthly' then v_start+interval '1 month' when 'six_month' then v_start+interval '6 months' when 'annual' then v_start+interval '1 year' else null end;
  if v_until is null then raise exception 'invalid_billing_period_snapshot'; end if;
  select * into v_access from public.platform_admin_set_company_access(v_request.company_id,v_request.requested_plan_code,'active_paid'::public.subscription_status,v_until,null,null,
    coalesce(nullif(btrim(coalesce(p_review_note,'')),''),'Verified payment activation '||v_request.reference));
  update public.company_payment_requests set status='approved',platform_review_note=nullif(btrim(coalesce(p_review_note,'')),''),reviewed_by=auth.uid(),reviewed_at=v_now,
    approved_by=auth.uid(),approved_at=v_now,access_start_snapshot=v_start,approved_paid_until_snapshot=v_until,updated_by=auth.uid(),updated_at=v_now where id=p_request_id;
  perform public.payment_request_append_event(p_request_id,'approved',v_request.status,'approved','platform_admin',p_review_note,
    jsonb_build_object('plan_code',v_request.requested_plan_code,'access_start',v_start,'paid_until',v_until));
  perform public.payment_request_append_event(p_request_id,'access_activated','approved','approved','platform_admin',p_review_note,
    jsonb_build_object('effective_status',v_access.effective_status,'plan_code',v_access.plan_code,'paid_until',v_access.paid_until));
  insert into public.company_control_action_log(company_id,action_type,actor_user_id,actor_email,reason,context)
  values(v_request.company_id,'payment_request_approved',auth.uid(),auth.jwt()->>'email',coalesce(nullif(btrim(coalesce(p_review_note,'')),''),'Verified payment activation approved'),
    jsonb_build_object('request_id',p_request_id,'reference',v_request.reference,'plan_code',v_request.requested_plan_code,'access_start',v_start,'paid_until',v_until));
  v_result:=jsonb_build_object('request_id',p_request_id,'reference',v_request.reference,'status','approved','plan_code',v_request.requested_plan_code,
    'access_start',v_start,'paid_until',v_until,'effective_status',v_access.effective_status);
  return public.payment_request_finish(v_request.company_id,'subscription.payment_request.approve',p_request_key,v_result,'company_payment_request',p_request_id::text);
end $$;

revoke all on function public.payment_request_payload_hash(jsonb) from public,anon,authenticated;
revoke all on function public.payment_request_reference_fingerprint(text) from public,anon,authenticated;
revoke all on function public.payment_request_user_has_role(uuid,public.member_role[]) from public,anon,authenticated;
revoke all on function public.payment_request_assert_company_actor(uuid,boolean) from public,anon,authenticated;
revoke all on function public.payment_request_enforce_rate_limit(text,text,integer) from public,anon,authenticated;
revoke all on function public.payment_request_claim(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.payment_request_finish(uuid,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.payment_request_append_event(uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.payment_request_plan_snapshot(text,text) from public,anon,authenticated;
revoke all on function public.payment_request_validate_proof(uuid) from public,anon,authenticated;
revoke all on function public.payment_request_submit_internal(uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.platform_admin_payment_request_transition(uuid,text,text,text,text,text,text[]) from public,anon,authenticated;

revoke all on function public.list_available_payment_plans() from public,anon;
revoke all on function public.list_available_payment_channels() from public,anon;
revoke all on function public.create_company_payment_request(uuid,text,text,uuid,text) from public,anon;
revoke all on function public.update_company_payment_request_draft(uuid,text,text,uuid,text,text,text,numeric,text,text) from public,anon;
revoke all on function public.attach_company_payment_request_proof(uuid,text) from public,anon;
revoke all on function public.submit_company_payment_request(uuid,text) from public,anon;
revoke all on function public.resubmit_company_payment_request(uuid,text) from public,anon;
revoke all on function public.cancel_company_payment_request(uuid,text,text) from public,anon;
revoke all on function public.list_my_company_payment_requests(uuid) from public,anon;
revoke all on function public.get_my_company_payment_request(uuid) from public,anon;
revoke all on function public.authorize_company_payment_proof_access(uuid) from public,anon;
revoke all on function public.platform_admin_list_payment_channels() from public,anon;
revoke all on function public.platform_admin_upsert_payment_channel(uuid,text,text,text,text,text,text,text,text,boolean,integer,timestamptz,timestamptz) from public,anon;
revoke all on function public.platform_admin_set_payment_channel_status(uuid,boolean) from public,anon;
revoke all on function public.platform_admin_list_payment_requests(text,text) from public,anon;
revoke all on function public.platform_admin_get_payment_request(uuid) from public,anon;
revoke all on function public.platform_admin_authorize_payment_proof_access(uuid) from public,anon;
revoke all on function public.platform_admin_start_payment_review(uuid,text,text) from public,anon;
revoke all on function public.platform_admin_request_payment_correction(uuid,text,text) from public,anon;
revoke all on function public.platform_admin_reject_payment_request(uuid,text,text) from public,anon;
revoke all on function public.platform_admin_approve_payment_request(uuid,text,text) from public,anon;

grant execute on function public.list_available_payment_plans() to authenticated;
grant execute on function public.list_available_payment_channels() to authenticated;
grant execute on function public.create_company_payment_request(uuid,text,text,uuid,text) to authenticated;
grant execute on function public.update_company_payment_request_draft(uuid,text,text,uuid,text,text,text,numeric,text,text) to authenticated;
grant execute on function public.attach_company_payment_request_proof(uuid,text) to authenticated;
grant execute on function public.submit_company_payment_request(uuid,text) to authenticated;
grant execute on function public.resubmit_company_payment_request(uuid,text) to authenticated;
grant execute on function public.cancel_company_payment_request(uuid,text,text) to authenticated;
grant execute on function public.list_my_company_payment_requests(uuid) to authenticated;
grant execute on function public.get_my_company_payment_request(uuid) to authenticated;
grant execute on function public.authorize_company_payment_proof_access(uuid) to authenticated;
grant execute on function public.platform_admin_list_payment_channels() to authenticated;
grant execute on function public.platform_admin_upsert_payment_channel(uuid,text,text,text,text,text,text,text,text,boolean,integer,timestamptz,timestamptz) to authenticated;
grant execute on function public.platform_admin_set_payment_channel_status(uuid,boolean) to authenticated;
grant execute on function public.platform_admin_list_payment_requests(text,text) to authenticated;
grant execute on function public.platform_admin_get_payment_request(uuid) to authenticated;
grant execute on function public.platform_admin_authorize_payment_proof_access(uuid) to authenticated;
grant execute on function public.platform_admin_start_payment_review(uuid,text,text) to authenticated;
grant execute on function public.platform_admin_request_payment_correction(uuid,text,text) to authenticated;
grant execute on function public.platform_admin_reject_payment_request(uuid,text,text) to authenticated;
grant execute on function public.platform_admin_approve_payment_request(uuid,text,text) to authenticated;

grant select,insert,update,delete on public.platform_payment_channels,public.platform_payment_channel_events,public.company_payment_request_counters,
  public.company_payment_requests,public.company_payment_request_events to service_role;

commit;
