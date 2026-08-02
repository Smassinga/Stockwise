-- COMMS-3C: promises, evaluation, suppression, notifications, and report visibility.

create table public.ar_payment_promises (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  exposure_chain_id uuid not null,
  anchor_kind_snapshot text not null check (anchor_kind_snapshot in ('sales_order','sales_invoice')),
  anchor_id_snapshot uuid not null,
  document_reference_snapshot text not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name_snapshot text,
  promised_amount numeric not null check (promised_amount > 0),
  currency_code text not null,
  promised_date date not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null,
  source text not null check (source in ('customer_email','customer_call','customer_message','internal_agreement','other')),
  note text,
  status text not null default 'open' check (status in ('open','kept','partially_kept','broken','cancelled','superseded')),
  outstanding_amount_at_recording numeric not null check (outstanding_amount_at_recording > 0),
  settled_amount_at_recording numeric not null default 0,
  credited_amount_at_recording numeric not null default 0,
  settled_amount_during_promise numeric not null default 0 check (settled_amount_during_promise >= 0),
  evaluated_at timestamptz,
  kept_at timestamptz,
  broken_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  superseded_by uuid references public.ar_payment_promises(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ar_payment_promises_one_open_idx
  on public.ar_payment_promises(company_id,exposure_chain_id) where status='open';
create index ar_payment_promises_evaluation_idx
  on public.ar_payment_promises(company_id,promised_date) where status='open';

alter table public.ar_collection_controls
  add constraint ar_collection_controls_current_promise_fk
  foreign key(current_promise_id) references public.ar_payment_promises(id) on delete restrict;
alter table public.ar_collection_control_events
  add constraint ar_collection_control_events_promise_fk
  foreign key(promise_id) references public.ar_payment_promises(id) on delete restrict;

alter table public.ar_payment_promises enable row level security;
alter table public.ar_payment_promises force row level security;
create policy ar_payment_promises_company_read on public.ar_payment_promises
  for select to authenticated using(public.member_has_company_access(company_id));
revoke all on table public.ar_payment_promises from public,anon,authenticated;
grant select on table public.ar_payment_promises to authenticated;
grant all on table public.ar_payment_promises to service_role;

create or replace function public.ar_payment_promises_immutable_history()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if old.company_id<>new.company_id or old.exposure_chain_id<>new.exposure_chain_id
    or old.anchor_kind_snapshot<>new.anchor_kind_snapshot or old.anchor_id_snapshot<>new.anchor_id_snapshot
    or old.document_reference_snapshot<>new.document_reference_snapshot or old.customer_id is distinct from new.customer_id
    or old.promised_amount<>new.promised_amount or old.currency_code<>new.currency_code
    or old.promised_date<>new.promised_date or old.recorded_at<>new.recorded_at
    or old.recorded_by<>new.recorded_by or old.source<>new.source or old.note is distinct from new.note
    or old.outstanding_amount_at_recording<>new.outstanding_amount_at_recording
    or old.settled_amount_at_recording<>new.settled_amount_at_recording
    or old.credited_amount_at_recording<>new.credited_amount_at_recording then
    raise exception 'payment_promise_evidence_is_immutable' using errcode='55000';
  end if;
  return new;
end $$;
create trigger ar_payment_promises_immutable_history before update on public.ar_payment_promises
for each row execute function public.ar_payment_promises_immutable_history();

alter table app.due_reminder_stage_dispatches
  add column eligibility_result text,
  add column skip_reason text,
  add column collection_control_id uuid references public.ar_collection_controls(id) on delete set null,
  add column collection_control_version integer,
  add column promise_id uuid references public.ar_payment_promises(id) on delete set null,
  add column evaluated_at timestamptz;

create or replace function public.ar_emit_collection_notification(
  p_control public.ar_collection_controls,p_event_type text,p_payload jsonb,p_dedup_suffix text,p_severity text default 'info'
)
returns void language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_user uuid; v_url text;
begin
  v_url:=case when p_control.active_anchor_kind='sales_invoice'
    then '/sales-invoices/'||p_control.active_anchor_id::text||'?panel=collections'
    else '/orders?tab=sales&orderId='||p_control.active_anchor_id::text||'&panel=collections' end;
  if p_control.owner_user_id is not null then
    perform public.stockwise_emit_notification_event(p_control.company_id,p_control.owner_user_id,p_event_type,'receivables',
      p_payload,'collections:'||p_control.id||':'||p_dedup_suffix||':'||p_control.owner_user_id,p_severity,v_url,
      'Collections follow-up','A receivable requires attention.');
  else
    for v_user in select cm.user_id from public.company_members cm
      where cm.company_id=p_control.company_id and cm.status='active' and cm.user_id is not null
        and cm.role in ('OWNER','ADMIN','MANAGER') loop
      perform public.stockwise_emit_notification_event(p_control.company_id,v_user,p_event_type,'receivables',
        p_payload,'collections:'||p_control.id||':'||p_dedup_suffix||':'||v_user,p_severity,v_url,
        'Collections follow-up','A receivable requires attention.');
    end loop;
  end if;
end $$;

create or replace function public.ar_record_payment_promise(p_command jsonb,p_revision boolean default false)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app
as $$
declare
  v_company uuid:=(p_command->>'company_id')::uuid; v_actor uuid;
  v_control public.ar_collection_controls; v_anchor jsonb; v_old public.ar_payment_promises;
  v_new public.ar_payment_promises; v_amount numeric; v_date date; v_request text; v_existing_control_id uuid; v_existing_promise_id uuid;
begin
  v_actor:=public.ar_require_collection_manager(v_company);
  v_request:=nullif(btrim(p_command->>'request_key'),'');
  if v_request is null then raise exception 'request_key_required' using errcode='22023'; end if;
  if nullif(p_command->>'owner_user_id','') is not null and not exists(
    select 1 from public.company_members cm
    where cm.company_id=v_company and cm.user_id=(p_command->>'owner_user_id')::uuid and cm.status='active'
  ) then raise exception 'invalid_collection_owner' using errcode='22023'; end if;
  select control_id,promise_id into v_existing_control_id,v_existing_promise_id from public.ar_collection_control_events where company_id=v_company and idempotency_key=v_request;
  if v_existing_control_id is not null then
    select * into v_control from public.ar_collection_controls where id=v_existing_control_id;
    select * into v_new from public.ar_payment_promises where id=v_existing_promise_id;
    return jsonb_build_object('control',to_jsonb(v_control),'promise',to_jsonb(v_new),'idempotentReplay',true);
  end if;
  v_control:=public.ar_get_or_create_collection_control(v_company,p_command->>'anchor_kind',(p_command->>'anchor_id')::uuid,v_actor);
  select * into v_control from public.ar_collection_controls where id=v_control.id for update;
  if nullif(p_command->>'expected_version','') is not null and (p_command->>'expected_version')::integer<>0 and (p_command->>'expected_version')::integer<>v_control.version then raise exception 'stale_collection_control_version' using errcode='40001'; end if;
  v_anchor:=public.ar_resolve_exposure_anchor(v_company,v_control.active_anchor_kind,v_control.active_anchor_id);
  v_amount:=(p_command->>'promised_amount')::numeric; v_date:=(p_command->>'promised_date')::date;
  if v_amount<=0 or v_amount>(v_anchor->>'outstanding_amount')::numeric+0.005 then raise exception 'invalid_promise_amount' using errcode='22023'; end if;
  if v_date < (now() at time zone coalesce(nullif(p_command->>'timezone',''),'Africa/Maputo'))::date then raise exception 'promise_date_in_past' using errcode='22023'; end if;
  if p_command->>'source' not in ('customer_email','customer_call','customer_message','internal_agreement','other') then raise exception 'invalid_promise_source' using errcode='22023'; end if;
  select * into v_old from public.ar_payment_promises where company_id=v_company and exposure_chain_id=v_control.exposure_chain_id and status='open' for update;
  if v_old.id is not null and not p_revision then raise exception 'open_payment_promise_exists' using errcode='23505'; end if;
  if v_old.id is not null then
    update public.ar_payment_promises set status='superseded',updated_at=now() where id=v_old.id;
  end if;
  insert into public.ar_payment_promises(
    company_id,exposure_chain_id,anchor_kind_snapshot,anchor_id_snapshot,document_reference_snapshot,
    customer_id,customer_name_snapshot,promised_amount,currency_code,promised_date,recorded_by,source,note,
    outstanding_amount_at_recording,settled_amount_at_recording,credited_amount_at_recording
  ) values (
    v_company,v_control.exposure_chain_id,v_control.active_anchor_kind,v_control.active_anchor_id,
    v_control.active_document_reference,v_control.customer_id,v_control.customer_name_snapshot,v_amount,
    upper(v_anchor->>'currency_code'),v_date,v_actor,p_command->>'source',nullif(btrim(p_command->>'note'),''),
    (v_anchor->>'outstanding_amount')::numeric,coalesce((v_anchor->>'settled_amount')::numeric,0),coalesce((v_anchor->>'credited_amount')::numeric,0)
  ) returning * into v_new;
  if v_old.id is not null then
    update public.ar_payment_promises set superseded_by=v_new.id,updated_at=now() where id=v_old.id;
  end if;
  update public.ar_collection_controls set status='promise_to_pay',current_promise_id=v_new.id,
    owner_user_id=coalesce(nullif(p_command->>'owner_user_id','')::uuid,v_actor),
    next_action_at=coalesce(nullif(p_command->>'next_follow_up_at','')::timestamptz,(v_date+1)::timestamp at time zone coalesce(nullif(p_command->>'timezone',''),'Africa/Maputo')),
    reason_code='promise_recorded',reason_note=nullif(btrim(p_command->>'note'),''),
    version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
  update app.due_reminder_stage_dispatches set status='superseded',eligibility_result='suppressed',
    skip_reason='promise_open',skipped_reason='promise_open',collection_control_id=v_control.id,
    collection_control_version=v_control.version,promise_id=v_new.id,evaluated_at=now(),updated_at=now()
  where company_id=v_company and exposure_chain_id=v_control.exposure_chain_id and status in ('pending','processing','failed');
  perform public.ar_append_collection_event(v_control,case when v_old.id is null then 'promise_recorded' else 'promise_revised' end,
    case when v_old.id is null then 'active' else 'promise_to_pay' end,'promise_to_pay',p_command->>'note',v_actor,v_request,v_new.id,
    jsonb_build_object('promisedAmount',v_amount,'promisedDate',v_date,'source',p_command->>'source','supersededPromiseId',v_old.id));
  return jsonb_build_object('control',to_jsonb(v_control),'promise',to_jsonb(v_new));
end $$;

create or replace function public.record_payment_promise(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_record_payment_promise(p_command,false) $$;
create or replace function public.revise_payment_promise(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_record_payment_promise(p_command,true) $$;

create or replace function public.cancel_payment_promise(p_command jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_company uuid:=(p_command->>'company_id')::uuid; v_actor uuid; v_control public.ar_collection_controls; v_promise public.ar_payment_promises; v_request text:=nullif(btrim(p_command->>'request_key'),''); v_existing_control_id uuid;
begin
  v_actor:=public.ar_require_collection_manager(v_company);
  if v_request is null or nullif(btrim(p_command->>'reason'),'') is null then raise exception 'promise_cancellation_reason_required' using errcode='22023'; end if;
  select control_id into v_existing_control_id from public.ar_collection_control_events where company_id=v_company and idempotency_key=v_request;
  if v_existing_control_id is not null then
    select * into v_control from public.ar_collection_controls where id=v_existing_control_id;
    return jsonb_build_object('control',to_jsonb(v_control),'idempotentReplay',true);
  end if;
  select * into v_control from public.ar_collection_controls where company_id=v_company and exposure_chain_id=(p_command->>'exposure_chain_id')::uuid for update;
  if v_control.status<>'promise_to_pay' then raise exception 'open_payment_promise_not_found' using errcode='P0002'; end if;
  select * into v_promise from public.ar_payment_promises where id=v_control.current_promise_id and status='open' for update;
  update public.ar_payment_promises set status='cancelled',cancelled_at=now(),cancellation_reason=left(p_command->>'reason',2000),updated_at=now() where id=v_promise.id;
  update public.ar_collection_controls set status='manual_follow_up',current_promise_id=null,reason_code='promise_cancelled',reason_note=left(p_command->>'reason',2000),
    next_action_at=nullif(p_command->>'next_action_at','')::timestamptz,version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
  perform public.ar_append_collection_event(v_control,'promise_cancelled','promise_to_pay','promise_cancelled',p_command->>'reason',v_actor,v_request,v_promise.id,'{}');
  return jsonb_build_object('control',to_jsonb(v_control),'promiseId',v_promise.id);
end $$;

create or replace function public.evaluate_payment_promises(
  p_company_id uuid,p_local_day date,p_timezone text,p_promise_id uuid default null
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare r record; v_anchor jsonb; v_covered numeric; v_result text; v_control public.ar_collection_controls; v_event text; v_count int:=0;
begin
  if nullif(btrim(p_timezone),'') is null then
    raise exception 'company_timezone_required' using errcode='22023';
  end if;
  for r in select p.* from public.ar_payment_promises p
    where p.company_id=p_company_id and p.status='open' and p.promised_date<p_local_day
      and (p_promise_id is null or p.id=p_promise_id)
    for update skip locked
  loop
    select * into v_control from public.ar_collection_controls where company_id=p_company_id and exposure_chain_id=r.exposure_chain_id for update;
    if v_control.id is null then continue; end if;
    v_anchor:=public.ar_resolve_exposure_anchor(p_company_id,v_control.active_anchor_kind,v_control.active_anchor_id);
    v_covered:=greatest(coalesce((v_anchor->>'settled_amount')::numeric,0)-r.settled_amount_at_recording,0)+greatest(coalesce((v_anchor->>'credited_amount')::numeric,0)-r.credited_amount_at_recording,0);
    v_result:=case when (v_anchor->>'outstanding_amount')::numeric<=0.005 or v_covered+0.005>=r.promised_amount then 'kept' when v_covered>0.005 then 'partially_kept' else 'broken' end;
    update public.ar_payment_promises set status=v_result,settled_amount_during_promise=v_covered,evaluated_at=now(),
      kept_at=case when v_result='kept' then now() else null end,broken_at=case when v_result='broken' then now() else null end,updated_at=now() where id=r.id;
    update public.ar_collection_controls set status=case when (v_anchor->>'outstanding_amount')::numeric<=0.005 then 'closed' else 'manual_follow_up' end,
      current_promise_id=null,reason_code='promise_'||v_result,
      next_action_at=case when (v_anchor->>'outstanding_amount')::numeric<=0.005 then null else now() end,
      closed_at=case when (v_anchor->>'outstanding_amount')::numeric<=0.005 then now() else null end,
      version=version+1,updated_at=now(),updated_by=coalesce(v_control.owner_user_id,v_control.updated_by) where id=v_control.id returning * into v_control;
    v_event:=case v_result when 'kept' then 'promise_kept' when 'partially_kept' then 'promise_partially_kept' else 'promise_broken' end;
    perform public.ar_append_collection_event(v_control,v_event,'promise_to_pay','promise_evaluated',null,null,
      'promise-evaluated:'||r.id,r.id,jsonb_build_object('coveredAmount',v_covered,'outstandingAmount',v_anchor->>'outstanding_amount'));
    perform public.ar_emit_collection_notification(v_control,'collections.promise_'||v_result,
      jsonb_build_object('reference',v_control.active_document_reference,'promiseAmount',r.promised_amount,'coveredAmount',v_covered,'status',v_result),
      'promise:'||r.id||':'||v_result,case when v_result='kept' then 'success' else 'warning' end);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('evaluated',v_count);
end $$;

create or replace function public.check_due_reminder_collection_eligibility(
  p_company_id uuid,p_anchor_kind text,p_anchor_id uuid,p_due_date date,p_stage_id uuid default null
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app
as $$
declare v_anchor jsonb; v_control public.ar_collection_controls; v_reason text; v_allowed boolean:=true; v_chain uuid;
begin
  v_anchor:=public.ar_resolve_exposure_anchor(p_company_id,p_anchor_kind,p_anchor_id);
  v_chain:=(v_anchor->>'exposure_chain_id')::uuid;
  select * into v_control from public.ar_collection_controls where company_id=p_company_id and exposure_chain_id=v_chain for update;
  if v_control.id is not null and v_control.active_anchor_kind='sales_order' and v_anchor->>'active_anchor_kind'='sales_invoice' then
    v_control:=public.ar_get_or_create_collection_control(p_company_id,p_anchor_kind,p_anchor_id,null);
  end if;
  if v_control.status='paused' and v_control.pause_until<=now() then
    update public.ar_collection_controls set status='active',pause_until=null,next_action_at=null,version=version+1,updated_at=now() where id=v_control.id returning * into v_control;
    perform public.ar_append_collection_event(v_control,'pause_expired','paused','pause_expired',null,null,'pause-expired:'||v_control.id||':'||extract(epoch from v_control.updated_at)::bigint,null,'{}');
    perform public.ar_emit_collection_notification(v_control,'collections.pause_expired',jsonb_build_object('reference',v_control.active_document_reference),'pause-expired:'||v_control.version,'info');
  end if;
  if v_control.status is not null and v_control.status<>'active' then
    v_allowed:=false; v_reason:=case v_control.status when 'paused' then 'collection_paused' when 'disputed' then 'collection_disputed' when 'promise_to_pay' then 'promise_open' when 'manual_follow_up' then 'manual_follow_up_required' else 'collection_closed' end;
  elsif v_anchor->>'active_anchor_kind'<>p_anchor_kind or (v_anchor->>'active_anchor_id')::uuid<>p_anchor_id then v_allowed:=false; v_reason:='anchor_superseded';
  elsif (v_anchor->>'due_date')::date<>p_due_date then v_allowed:=false; v_reason:='due_date_changed';
  elsif coalesce((v_anchor->>'outstanding_amount')::numeric,0)<=0.005 then v_allowed:=false; v_reason:='exposure_resolved';
  end if;
  if p_stage_id is not null then
    update app.due_reminder_stage_dispatches set eligibility_result=case when v_allowed then 'eligible' else 'suppressed' end,
      skip_reason=v_reason,collection_control_id=v_control.id,collection_control_version=v_control.version,
      promise_id=v_control.current_promise_id,evaluated_at=now(),
      status=case when not v_allowed and status='processing' then 'skipped' else status end,
      skipped_reason=case when not v_allowed then v_reason else skipped_reason end,updated_at=now()
    where id=p_stage_id and company_id=p_company_id;
  end if;
  return jsonb_build_object('allowed',v_allowed,'reason',v_reason,'controlId',v_control.id,'controlVersion',v_control.version,
    'promiseId',v_control.current_promise_id,'activeAnchorKind',v_anchor->>'active_anchor_kind','activeAnchorId',v_anchor->>'active_anchor_id',
    'outstandingAmount',(v_anchor->>'outstanding_amount')::numeric,'exposureChainId',v_chain);
end $$;

create or replace function public.sync_ar_collection_controls(p_company_id uuid,p_local_day date,p_timezone text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app
as $$
declare r public.ar_collection_controls; v_anchor jsonb; v_previous text; v_promise public.ar_payment_promises; v_count integer:=0;
begin
  for r in select * from public.ar_collection_controls where company_id=p_company_id and status<>'closed' for update skip locked loop
    v_anchor:=public.ar_resolve_exposure_anchor(p_company_id,r.active_anchor_kind,r.active_anchor_id);
    if r.active_anchor_kind='sales_order' and v_anchor->>'active_anchor_kind'='sales_invoice' then
      r:=public.ar_get_or_create_collection_control(p_company_id,'sales_order',r.active_anchor_id,null);
      v_anchor:=public.ar_resolve_exposure_anchor(p_company_id,r.active_anchor_kind,r.active_anchor_id);
    end if;
    if coalesce((v_anchor->>'outstanding_amount')::numeric,0)<=0.005 then
      v_previous:=r.status;
      if r.current_promise_id is not null then
        select * into v_promise from public.ar_payment_promises where id=r.current_promise_id and status='open' for update;
        if v_promise.id is not null then
          update public.ar_payment_promises set status='kept',settled_amount_during_promise=greatest(coalesce((v_anchor->>'settled_amount')::numeric,0)-v_promise.settled_amount_at_recording,0)+greatest(coalesce((v_anchor->>'credited_amount')::numeric,0)-v_promise.credited_amount_at_recording,0),evaluated_at=now(),kept_at=now(),updated_at=now() where id=v_promise.id;
          perform public.ar_append_collection_event(r,'promise_kept',v_previous,'settlement_evidence',null,null,'promise-settled:'||v_promise.id,v_promise.id,'{}');
        end if;
      end if;
      update public.ar_collection_controls set status='closed',current_promise_id=null,reason_code='exposure_resolved',next_action_at=null,closed_at=now(),version=version+1,updated_at=now() where id=r.id returning * into r;
      update app.due_reminder_stage_dispatches set status='superseded',eligibility_result='suppressed',skip_reason='exposure_resolved',skipped_reason='exposure_resolved',collection_control_id=r.id,collection_control_version=r.version,evaluated_at=now(),updated_at=now()
      where company_id=p_company_id and exposure_chain_id=r.exposure_chain_id and status in ('pending','processing','failed');
      perform public.ar_append_collection_event(r,'control_closed_after_settlement',v_previous,'exposure_resolved',null,null,'control-closed:'||r.id||':'||r.version,null,jsonb_build_object('outstandingAmount',0));
      perform public.ar_emit_collection_notification(r,'collections.control_closed',jsonb_build_object('reference',r.active_document_reference),'closed:'||r.version,'success');
      v_count:=v_count+1;
    elsif r.status='paused' and r.pause_until is not null and (r.pause_until at time zone p_timezone)::date<p_local_day then
      v_previous:=r.status;
      update public.ar_collection_controls set status='active',pause_until=null,next_action_at=null,reason_code='pause_expired',version=version+1,updated_at=now() where id=r.id returning * into r;
      perform public.ar_append_collection_event(r,'pause_expired',v_previous,'pause_expired',null,null,'pause-expired:'||r.id||':'||r.version,null,'{}');
      perform public.ar_emit_collection_notification(r,'collections.pause_expired',jsonb_build_object('reference',r.active_document_reference),'pause-expired:'||r.version,'info');
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('updated',v_count);
end $$;

create or replace function public.emit_collection_follow_up_notifications(p_company_id uuid,p_local_day date,p_timezone text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare r public.ar_collection_controls; v_event text; v_count integer:=0;
begin
  for r in select * from public.ar_collection_controls where company_id=p_company_id and status<>'closed' loop
    v_event:=null;
    if r.status='paused' and r.pause_until is not null and (r.pause_until at time zone p_timezone)::date=p_local_day then v_event:='collections.pause_expiring_today';
    elsif r.status='disputed' and r.dispute_follow_up_at is not null and (r.dispute_follow_up_at at time zone p_timezone)::date<=p_local_day then v_event:='collections.dispute_follow_up_due';
    elsif r.status='promise_to_pay' and exists(select 1 from public.ar_payment_promises p where p.id=r.current_promise_id and p.status='open' and p.promised_date=p_local_day) then v_event:='collections.promise_due_today';
    elsif r.status='manual_follow_up' and r.next_action_at is not null and (r.next_action_at at time zone p_timezone)::date<=p_local_day then v_event:='collections.manual_follow_up_due';
    end if;
    if v_event is not null then
      perform public.ar_emit_collection_notification(r,v_event,jsonb_build_object('reference',r.active_document_reference,'status',r.status),v_event||':'||p_local_day,'warning');
      v_count:=v_count+1;
    end if;
  end loop;
  return jsonb_build_object('notificationsEvaluated',v_count);
end $$;

create or replace function public.ar_collection_invoice_anchor_trigger()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,app
as $$
declare v_control public.ar_collection_controls; v_previous text;
begin
  if new.document_workflow_status<>'issued' or new.sales_order_id is null then return new; end if;
  select * into v_control from public.ar_collection_controls where company_id=new.company_id and exposure_chain_id=new.sales_order_id for update;
  if v_control.id is null or (v_control.active_anchor_kind='sales_invoice' and v_control.active_anchor_id=new.id) then return new; end if;
  v_previous:=v_control.status;
  update public.ar_collection_controls set active_anchor_kind='sales_invoice',active_anchor_id=new.id,
    active_document_reference=new.internal_reference,customer_id=new.customer_id,
    customer_name_snapshot=coalesce(new.buyer_legal_name_snapshot,customer_name_snapshot),
    version=version+1,updated_at=now(),updated_by=coalesce(auth.uid(),updated_by)
  where id=v_control.id returning * into v_control;
  update app.due_reminder_stage_dispatches set status='superseded',eligibility_result='suppressed',
    skip_reason='anchor_moved_to_invoice',skipped_reason='anchor_moved_to_invoice',
    collection_control_id=v_control.id,collection_control_version=v_control.version,evaluated_at=now(),updated_at=now()
  where company_id=new.company_id and exposure_chain_id=new.sales_order_id and anchor_kind='sales_order' and status in ('pending','processing','failed');
  perform public.ar_append_collection_event(v_control,'anchor_moved_to_invoice',v_previous,'issued_invoice_active',null,auth.uid(),
    'anchor-moved:'||v_control.id||':'||new.id,null,jsonb_build_object('salesOrderId',new.sales_order_id));
  return new;
end $$;

create trigger ar_collection_invoice_anchor_after_issue
after insert or update of document_workflow_status on public.sales_invoices
for each row execute function public.ar_collection_invoice_anchor_trigger();

create or replace function public.build_adaptive_due_reminder_batch(
  p_company_id uuid,p_local_day date,p_timezone text,p_stage_offsets integer[]
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app
as $$
declare v_base jsonb; v_rows jsonb; v_suppressed jsonb;
begin
  if coalesce(array_length(p_stage_offsets,1),0)=0 or exists(select 1 from unnest(p_stage_offsets)d where d< -365 or d>365)
    or (select count(*) from unnest(p_stage_offsets)d)>24
    or (select count(*) from unnest(p_stage_offsets)d)<>(select count(distinct d) from unnest(p_stage_offsets)d) then
    raise exception 'invalid_due_reminder_stage_offsets' using errcode='22023';
  end if;
  perform public.sync_ar_collection_controls(p_company_id,p_local_day,p_timezone);
  perform public.emit_collection_follow_up_notifications(p_company_id,p_local_day,p_timezone);
  perform public.evaluate_payment_promises(p_company_id,p_local_day,p_timezone);
  v_base:=public.build_due_reminder_batch(p_company_id,p_local_day,p_timezone,array(select generate_series(-365,365)));
  with candidates as (
    select r,stage.offset_days,coalesce(nullif(r->>'sales_order_id','')::uuid,(r->>'anchor_id')::uuid) chain_id
    from jsonb_array_elements(coalesce(v_base->'reminders','[]'))r
    cross join lateral(select min(d)::integer offset_days from unnest(p_stage_offsets)d where d >= (r->>'days_until_due')::integer)stage
    where stage.offset_days is not null
  ), classified as (
    select c.*,coalesce(ctrl.status,'active') control_status,ctrl.id control_id,ctrl.version control_version,ctrl.current_promise_id
    from candidates c left join public.ar_collection_controls ctrl on ctrl.company_id=p_company_id and ctrl.exposure_chain_id=c.chain_id
  )
  select coalesce(jsonb_agg(r||jsonb_build_object('stage_offset_days',offset_days,'relative_state',public.due_reminder_stage_metadata(offset_days)->>'relativeState','tone',public.due_reminder_stage_metadata(offset_days)->>'tone','exposure_chain_id',chain_id,'collection_control_id',control_id,'collection_control_version',control_version) order by (r->>'days_until_due')::integer,r->>'document_reference') filter(where control_status='active'),'[]'),
    coalesce(jsonb_agg(r||jsonb_build_object('stage_offset_days',offset_days,'exposure_chain_id',chain_id,'collection_control_id',control_id,'collection_control_version',control_version,'promise_id',current_promise_id,'skip_reason',case control_status when 'paused' then 'collection_paused' when 'disputed' then 'collection_disputed' when 'promise_to_pay' then 'promise_open' when 'manual_follow_up' then 'manual_follow_up_required' else 'collection_closed' end)) filter(where control_status<>'active'),'[]')
  into v_rows,v_suppressed from classified;
  return jsonb_set(jsonb_set(v_base,'{reminders}',v_rows,true),'{suppressed}',v_suppressed,true);
end $$;

-- Retain the report's financial authority and enrich only collections context.
alter function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) rename to get_operational_report_core;
create or replace function public.get_operational_report(
  p_company_id uuid,p_report_code text,p_start_date date,p_end_date date,
  p_warehouse_id uuid default null,p_customer_id uuid default null,
  p_include_cash boolean default true,p_slow_days integer default 90
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_result jsonb; v_rows jsonb;
begin
  v_result:=public.get_operational_report_core(p_company_id,p_report_code,p_start_date,p_end_date,p_warehouse_id,p_customer_id,p_include_cash,p_slow_days);
  if lower(p_report_code)<>'customer-location' then return v_result; end if;
  select coalesce(jsonb_agg(row_value||jsonb_strip_nulls(jsonb_build_object(
    'collectionStatus',ctrl.status,'collectionOwnerId',ctrl.owner_user_id,'collectionOwner',owner.label,'nextActionAt',ctrl.next_action_at,
    'promiseDate',promise.promised_date,'promisedAmount',promise.promised_amount,'promiseStatus',promise.status,
    'disputeCategory',ctrl.dispute_category,
    'daysOverdue',case when anchor.due_date is not null then greatest(current_date-anchor.due_date,0) end,
    'lastReminderStage',stage.stage_offset_days,'lastReminderAcceptedAt',stage.accepted_at
  ))), '[]'::jsonb) into v_rows
  from jsonb_array_elements(coalesce(v_result->'rows','[]')) row_value
  left join lateral(
    select c.* from public.ar_collection_controls c where c.company_id=p_company_id and c.customer_id=nullif(row_value->>'customerId','')::uuid order by c.updated_at desc limit 1
  )ctrl on true
  left join lateral(
    select coalesce(nullif(p.full_name,''),nullif(p.name,''),p.email::text,cm.email) label
    from public.company_members cm left join public.profiles p on p.id=cm.user_id
    where cm.company_id=p_company_id and cm.user_id=ctrl.owner_user_id limit 1
  )owner on true
  left join lateral(
    select p.* from public.ar_payment_promises p
    where p.company_id=p_company_id and p.exposure_chain_id=ctrl.exposure_chain_id
    order by (p.id=ctrl.current_promise_id) desc,p.created_at desc
    limit 1
  )promise on ctrl.id is not null
  left join lateral(
    select s.stage_offset_days,s.accepted_at from app.due_reminder_stage_dispatches s where s.company_id=p_company_id and s.exposure_chain_id=ctrl.exposure_chain_id and s.status='accepted' order by s.accepted_at desc limit 1
  )stage on true
  left join lateral(
    select (public.ar_resolve_exposure_anchor(p_company_id,ctrl.active_anchor_kind,ctrl.active_anchor_id)->>'due_date')::date due_date
  )anchor on ctrl.id is not null;
  return jsonb_set(v_result,'{rows}',coalesce(v_rows,'[]'),true);
end $$;

create or replace function public.get_ar_collection_workspace(p_anchor_kind text,p_anchor_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,app
as $$
declare v_company uuid; v_anchor jsonb; v_control public.ar_collection_controls; v_chain uuid; v_timezone text;
begin
  v_company:=public.current_company_id();
  if auth.uid() is null or v_company is null or not public.member_has_company_access(v_company) then raise exception 'company_access_required' using errcode='42501'; end if;
  select coalesce(nullif(cs.data#>>'{dueReminders,timezone}',''),'Africa/Maputo') into v_timezone from public.company_settings cs where cs.company_id=v_company;
  v_timezone:=coalesce(v_timezone,'Africa/Maputo');
  perform public.sync_ar_collection_controls(v_company,(now() at time zone v_timezone)::date,v_timezone);
  v_anchor:=public.ar_resolve_exposure_anchor(v_company,p_anchor_kind,p_anchor_id); v_chain:=(v_anchor->>'exposure_chain_id')::uuid;
  select * into v_control from public.ar_collection_controls where company_id=v_company and exposure_chain_id=v_chain;
  return jsonb_build_object('anchor',v_anchor,
    'control',case when v_control.id is null then jsonb_build_object('status','active','version',0,'isDefault',true) else to_jsonb(v_control) end,
    'promise',(select to_jsonb(p) from public.ar_payment_promises p where p.id=v_control.current_promise_id),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc) from (select * from public.ar_collection_control_events where company_id=v_company and exposure_chain_id=v_chain order by occurred_at desc,id desc limit 100)e),'[]'),
    'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'stageOffsetDays',s.stage_offset_days,'acceptedAt',s.accepted_at,'skipReason',coalesce(s.skip_reason,s.skipped_reason),'documentReference',s.document_reference_snapshot) order by s.created_at desc) from (select * from app.due_reminder_stage_dispatches where company_id=v_company and exposure_chain_id=v_chain order by created_at desc limit 50)s),'[]'));
end $$;

do $$ declare r record; begin for r in select p.oid::regprocedure proc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ar_emit_collection_notification','ar_record_payment_promise','record_payment_promise','revise_payment_promise','cancel_payment_promise','evaluate_payment_promises','check_due_reminder_collection_eligibility','sync_ar_collection_controls','emit_collection_follow_up_notifications','ar_collection_invoice_anchor_trigger','build_adaptive_due_reminder_batch','get_operational_report','get_operational_report_core','get_ar_collection_workspace') loop execute format('revoke all on function %s from public,anon,authenticated',r.proc); end loop; end $$;

grant execute on function public.record_payment_promise(jsonb) to authenticated;
grant execute on function public.revise_payment_promise(jsonb) to authenticated;
grant execute on function public.cancel_payment_promise(jsonb) to authenticated;
grant execute on function public.get_ar_collection_workspace(text,uuid) to authenticated;
grant execute on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) to authenticated;
grant execute on function public.build_adaptive_due_reminder_batch(uuid,date,text,integer[]) to service_role;
grant execute on function public.check_due_reminder_collection_eligibility(uuid,text,uuid,date,uuid) to service_role;
grant execute on function public.evaluate_payment_promises(uuid,date,text,uuid) to service_role;
grant execute on function public.sync_ar_collection_controls(uuid,date,text) to service_role;
grant execute on function public.emit_collection_follow_up_notifications(uuid,date,text) to service_role;

comment on table public.ar_payment_promises is 'Governed promise-to-pay evidence. Promises never post settlement, alter due dates, or create accounting entries.';
