-- COMMS-3C: governed current collections control plus immutable operational evidence.

create table public.ar_collection_controls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  exposure_chain_id uuid not null,
  active_anchor_kind text not null check (active_anchor_kind in ('sales_order','sales_invoice')),
  active_anchor_id uuid not null,
  active_document_reference text not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name_snapshot text,
  status text not null default 'active' check (status in ('active','paused','disputed','promise_to_pay','manual_follow_up','closed')),
  reason_code text,
  reason_note text,
  owner_user_id uuid,
  next_action_at timestamptz,
  pause_until timestamptz,
  dispute_category text,
  dispute_summary text,
  disputed_amount numeric check (disputed_amount is null or disputed_amount >= 0),
  undisputed_amount numeric check (undisputed_amount is null or undisputed_amount >= 0),
  dispute_opened_at timestamptz,
  dispute_follow_up_at timestamptz,
  dispute_supporting_reference text,
  current_promise_id uuid,
  version integer not null default 1 check (version > 0),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  unique (company_id, exposure_chain_id)
);

create index ar_collection_controls_anchor_idx
  on public.ar_collection_controls(company_id,active_anchor_kind,active_anchor_id);
create index ar_collection_controls_follow_up_idx
  on public.ar_collection_controls(company_id,status,next_action_at)
  where status <> 'closed';

create table public.ar_collection_control_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  control_id uuid not null references public.ar_collection_controls(id) on delete restrict,
  exposure_chain_id uuid not null,
  active_anchor_kind text not null check (active_anchor_kind in ('sales_order','sales_invoice')),
  active_anchor_id uuid not null,
  document_reference_snapshot text not null,
  event_type text not null check (event_type in (
    'control_activated','reminder_paused','pause_extended','pause_expired',
    'dispute_opened','dispute_updated','dispute_resolved',
    'promise_recorded','promise_revised','promise_kept','promise_partially_kept',
    'promise_broken','promise_cancelled','manual_follow_up_assigned',
    'manual_follow_up_completed','control_reactivated','anchor_moved_to_invoice',
    'control_closed_after_settlement'
  )),
  previous_status text,
  new_status text not null,
  reason_code text,
  safe_note text,
  owner_user_id_snapshot uuid,
  owner_name_snapshot text,
  promise_id uuid,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,idempotency_key),
  check (jsonb_typeof(metadata) = 'object')
);

create index ar_collection_events_timeline_idx
  on public.ar_collection_control_events(company_id,exposure_chain_id,occurred_at desc,id desc);

alter table public.ar_collection_controls enable row level security;
alter table public.ar_collection_controls force row level security;
alter table public.ar_collection_control_events enable row level security;
alter table public.ar_collection_control_events force row level security;

create policy ar_collection_controls_company_read
  on public.ar_collection_controls for select to authenticated
  using (public.member_has_company_access(company_id));
create policy ar_collection_events_company_read
  on public.ar_collection_control_events for select to authenticated
  using (public.member_has_company_access(company_id));

revoke all on table public.ar_collection_controls from public,anon,authenticated;
revoke all on table public.ar_collection_control_events from public,anon,authenticated;
grant select on table public.ar_collection_controls to authenticated;
grant select on table public.ar_collection_control_events to authenticated;
grant all on table public.ar_collection_controls to service_role;
grant all on table public.ar_collection_control_events to service_role;

create or replace function public.ar_collection_events_immutable()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'collection_control_events_are_immutable' using errcode='55000';
end;
$$;

create trigger ar_collection_control_events_immutable
before update or delete on public.ar_collection_control_events
for each row execute function public.ar_collection_events_immutable();

create or replace function public.ar_resolve_exposure_anchor(
  p_company_id uuid,p_anchor_kind text,p_anchor_id uuid
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v jsonb;
begin
  if p_anchor_kind='sales_order' then
    select jsonb_build_object(
      'company_id',so.company_id,'exposure_chain_id',so.id,
      'active_anchor_kind',case when sos.financial_anchor='sales_invoice' then 'sales_invoice' else 'sales_order' end,
      'active_anchor_id',coalesce(sos.financial_anchor_document_id,so.id),
      'active_document_reference',coalesce(sos.financial_anchor_reference,so.order_no,so.code,so.id::text),
      'customer_id',so.customer_id,'customer_name',coalesce(c.name,so.bill_to_name,so.customer),
      'due_date',case when sos.financial_anchor='sales_invoice' then vis.due_date else sos.due_date end,
      'outstanding_amount',case when sos.financial_anchor='sales_invoice' then vis.outstanding_base else sos.legacy_outstanding_base end,
      'settled_amount',case when sos.financial_anchor='sales_invoice' then vis.settled_base else sos.legacy_settled_base end,
      'credited_amount',case when sos.financial_anchor='sales_invoice' then vis.credited_total_base else 0 end,
      'total_amount',case when sos.financial_anchor='sales_invoice' then vis.current_legal_total_base else sos.total_amount_base end,
      'currency_code',case when sos.financial_anchor='sales_invoice' then vis.currency_code else sos.currency_code::text end,
      'financial_status',case when sos.financial_anchor='sales_invoice' then vis.resolution_status else sos.settlement_status end
    ) into v
    from public.sales_orders so
    join public.v_sales_order_state sos on sos.id=so.id
    left join public.v_sales_invoice_state vis on vis.id=sos.financial_anchor_document_id
    left join public.customers c on c.id=so.customer_id
    where so.id=p_anchor_id and so.company_id=p_company_id;
  elsif p_anchor_kind='sales_invoice' then
    select jsonb_build_object(
      'company_id',si.company_id,'exposure_chain_id',coalesce(si.sales_order_id,si.id),
      'active_anchor_kind','sales_invoice','active_anchor_id',si.id,
      'active_document_reference',si.internal_reference,
      'customer_id',si.customer_id,'customer_name',coalesce(c.name,si.buyer_legal_name_snapshot,vis.counterparty_name),
      'due_date',vis.due_date,'outstanding_amount',vis.outstanding_base,
      'settled_amount',vis.settled_base,'credited_amount',vis.credited_total_base,
      'total_amount',vis.current_legal_total_base,'currency_code',vis.currency_code,
      'financial_status',vis.resolution_status
    ) into v
    from public.sales_invoices si
    join public.v_sales_invoice_state vis on vis.id=si.id
    left join public.customers c on c.id=si.customer_id
    where si.id=p_anchor_id and si.company_id=p_company_id
      and si.document_workflow_status='issued';
  else
    raise exception 'invalid_collection_anchor_kind' using errcode='22023';
  end if;
  if v is null then raise exception 'collection_anchor_not_found' using errcode='P0002'; end if;
  return v;
end;
$$;

create or replace function public.ar_require_collection_manager(p_company_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if not public.has_company_role(p_company_id,array['OWNER'::public.member_role,'ADMIN'::public.member_role,'MANAGER'::public.member_role]) then
    raise exception 'collections_manager_role_required' using errcode='42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.ar_append_collection_event(
  p_control public.ar_collection_controls,p_event_type text,p_previous_status text,
  p_reason_code text,p_note text,p_actor uuid,p_idempotency_key text,
  p_promise_id uuid default null,p_metadata jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid; v_owner_name text;
begin
  if p_control.owner_user_id is not null then
    select coalesce(nullif(p.full_name,''),nullif(p.name,''),cm.email::text)
    into v_owner_name
    from public.company_members cm
    left join public.profiles p on p.id=cm.user_id
    where cm.company_id=p_control.company_id and cm.user_id=p_control.owner_user_id
    limit 1;
  end if;
  insert into public.ar_collection_control_events(
    company_id,control_id,exposure_chain_id,active_anchor_kind,active_anchor_id,
    document_reference_snapshot,event_type,previous_status,new_status,reason_code,
    safe_note,owner_user_id_snapshot,owner_name_snapshot,promise_id,actor_user_id,idempotency_key,metadata
  ) values (
    p_control.company_id,p_control.id,p_control.exposure_chain_id,p_control.active_anchor_kind,
    p_control.active_anchor_id,p_control.active_document_reference,p_event_type,p_previous_status,
    p_control.status,nullif(btrim(p_reason_code),''),nullif(btrim(left(p_note,2000)),''),
    p_control.owner_user_id,v_owner_name,p_promise_id,p_actor,p_idempotency_key,coalesce(p_metadata,'{}'::jsonb)
  ) on conflict(company_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ar_get_or_create_collection_control(
  p_company_id uuid,p_anchor_kind text,p_anchor_id uuid,p_actor uuid
)
returns public.ar_collection_controls language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_anchor jsonb; v_row public.ar_collection_controls; v_previous text;
begin
  v_anchor:=public.ar_resolve_exposure_anchor(p_company_id,p_anchor_kind,p_anchor_id);
  select * into v_row from public.ar_collection_controls
  where company_id=p_company_id and exposure_chain_id=(v_anchor->>'exposure_chain_id')::uuid for update;
  if not found then
    insert into public.ar_collection_controls(
      company_id,exposure_chain_id,active_anchor_kind,active_anchor_id,active_document_reference,
      customer_id,customer_name_snapshot,created_by,updated_by
    ) values (
      p_company_id,(v_anchor->>'exposure_chain_id')::uuid,v_anchor->>'active_anchor_kind',
      (v_anchor->>'active_anchor_id')::uuid,v_anchor->>'active_document_reference',
      nullif(v_anchor->>'customer_id','')::uuid,v_anchor->>'customer_name',p_actor,p_actor
    ) returning * into v_row;
    perform public.ar_append_collection_event(v_row,'control_activated',null,'default_active',null,p_actor,
      'control-created:'||v_row.id,null,jsonb_build_object('source','lazy_creation'));
  elsif v_row.active_anchor_kind='sales_order' and v_anchor->>'active_anchor_kind'='sales_invoice' then
    v_previous:=v_row.status;
    update public.ar_collection_controls set
      active_anchor_kind='sales_invoice',active_anchor_id=(v_anchor->>'active_anchor_id')::uuid,
      active_document_reference=v_anchor->>'active_document_reference',customer_id=nullif(v_anchor->>'customer_id','')::uuid,
      customer_name_snapshot=v_anchor->>'customer_name',version=version+1,updated_at=now(),updated_by=coalesce(p_actor,updated_by)
    where id=v_row.id returning * into v_row;
    perform public.ar_append_collection_event(v_row,'anchor_moved_to_invoice',v_previous,'issued_invoice_active',null,p_actor,
      'anchor-moved:'||v_row.id||':'||v_row.active_anchor_id,null,
      jsonb_build_object('previousAnchorKind','sales_order'));
    update app.due_reminder_stage_dispatches set status='superseded',skipped_reason='anchor_moved_to_invoice',updated_at=now()
    where company_id=p_company_id and exposure_chain_id=v_row.exposure_chain_id
      and anchor_kind='sales_order' and status in ('pending','processing','failed');
  end if;
  return v_row;
end;
$$;

create or replace function public.ar_apply_collection_control(p_command jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_company uuid:=(p_command->>'company_id')::uuid;
  v_actor uuid; v_control public.ar_collection_controls; v_previous text;
  v_action text:=p_command->>'action'; v_request text:=nullif(btrim(p_command->>'request_key'),'');
  v_event text; v_reason text:=nullif(btrim(p_command->>'reason_code'),'');
  v_note text:=nullif(btrim(p_command->>'note'),''); v_owner uuid:=nullif(p_command->>'owner_user_id','')::uuid;
  v_version integer:=nullif(p_command->>'expected_version','')::integer; v_existing_control_id uuid;
begin
  v_actor:=public.ar_require_collection_manager(v_company);
  if v_request is null then raise exception 'request_key_required' using errcode='22023'; end if;
  if v_owner is not null and not exists(
    select 1 from public.company_members cm
    where cm.company_id=v_company and cm.user_id=v_owner and cm.status='active'
  ) then raise exception 'invalid_collection_owner' using errcode='22023'; end if;
  select control_id into v_existing_control_id from public.ar_collection_control_events where company_id=v_company and idempotency_key=v_request;
  if v_existing_control_id is not null then
    select * into v_control from public.ar_collection_controls where id=v_existing_control_id;
    return jsonb_build_object('control',to_jsonb(v_control),'idempotentReplay',true);
  end if;
  v_control:=public.ar_get_or_create_collection_control(v_company,p_command->>'anchor_kind',(p_command->>'anchor_id')::uuid,v_actor);
  select * into v_control from public.ar_collection_controls where id=v_control.id for update;
  if v_version is not null and v_version<>0 and v_version<>v_control.version then raise exception 'stale_collection_control_version' using errcode='40001'; end if;
  v_previous:=v_control.status;

  if v_action='activate' then
    update public.ar_collection_controls set status='active',reason_code=v_reason,reason_note=v_note,
      pause_until=null,dispute_category=null,dispute_summary=null,disputed_amount=null,undisputed_amount=null,
      dispute_opened_at=null,dispute_follow_up_at=null,dispute_supporting_reference=null,current_promise_id=null,
      next_action_at=null,version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
    v_event:=case when v_previous='active' then 'control_activated' else 'control_reactivated' end;
  elsif v_action='pause' then
    if v_reason not in ('awaiting_payment_confirmation','customer_requested_time','internal_review','document_correction','management_instruction','other')
      or nullif(p_command->>'pause_until','')::timestamptz<=now() or v_owner is null then
      raise exception 'invalid_collection_pause' using errcode='22023';
    end if;
    update public.ar_collection_controls set status='paused',reason_code=v_reason,reason_note=v_note,
      owner_user_id=v_owner,pause_until=(p_command->>'pause_until')::timestamptz,
      next_action_at=coalesce(nullif(p_command->>'next_action_at','')::timestamptz,(p_command->>'pause_until')::timestamptz),
      current_promise_id=null,version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
    v_event:=case when v_previous='paused' then 'pause_extended' else 'reminder_paused' end;
  elsif v_action='open_dispute' or v_action='update_dispute' then
    if nullif(p_command->>'dispute_category','') not in ('pricing','quantity','service_quality','delivery','tax','duplicate_document','incorrect_customer_details','payment_allocation','credit_note_pending','missing_support','other')
      or nullif(btrim(p_command->>'dispute_summary'),'') is null or v_owner is null then
      raise exception 'invalid_collection_dispute' using errcode='22023';
    end if;
    update public.ar_collection_controls set status='disputed',reason_code=v_reason,reason_note=v_note,
      owner_user_id=v_owner,dispute_category=p_command->>'dispute_category',
      dispute_summary=left(p_command->>'dispute_summary',2000),
      disputed_amount=nullif(p_command->>'disputed_amount','')::numeric,
      undisputed_amount=nullif(p_command->>'undisputed_amount','')::numeric,
      dispute_opened_at=coalesce(dispute_opened_at,now()),
      dispute_follow_up_at=nullif(p_command->>'follow_up_at','')::timestamptz,
      dispute_supporting_reference=nullif(btrim(p_command->>'supporting_reference'),''),
      next_action_at=nullif(p_command->>'follow_up_at','')::timestamptz,current_promise_id=null,
      version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
    v_event:=case when v_action='update_dispute' then 'dispute_updated' else 'dispute_opened' end;
  elsif v_action='resolve_dispute' then
    if v_previous<>'disputed' or nullif(p_command->>'resolution_outcome','') not in ('customer_accepted','company_accepted','partial_agreement','credit_or_adjustment_issued','document_corrected','payment_received','no_change','cancelled') or v_note is null then
      raise exception 'invalid_dispute_resolution' using errcode='22023';
    end if;
    update public.ar_collection_controls set status=case when coalesce((public.ar_resolve_exposure_anchor(v_company,v_control.active_anchor_kind,v_control.active_anchor_id)->>'outstanding_amount')::numeric,0)<=0.005 then 'closed' else coalesce(nullif(p_command->>'resulting_status',''),'manual_follow_up') end,
      reason_code=p_command->>'resolution_outcome',reason_note=v_note,next_action_at=nullif(p_command->>'next_action_at','')::timestamptz,
      closed_at=case when coalesce((public.ar_resolve_exposure_anchor(v_company,v_control.active_anchor_kind,v_control.active_anchor_id)->>'outstanding_amount')::numeric,0)<=0.005 then now() else null end,
      version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
    if v_control.status not in ('active','manual_follow_up','closed') then raise exception 'invalid_dispute_resulting_status' using errcode='22023'; end if;
    v_event:='dispute_resolved';
  elsif v_action='assign_manual_follow_up' then
    if v_owner is null or v_reason is null or nullif(p_command->>'next_action_at','') is null then raise exception 'invalid_manual_follow_up' using errcode='22023'; end if;
    update public.ar_collection_controls set status='manual_follow_up',reason_code=v_reason,reason_note=v_note,
      owner_user_id=v_owner,next_action_at=(p_command->>'next_action_at')::timestamptz,current_promise_id=null,
      version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
    v_event:='manual_follow_up_assigned';
  elsif v_action='complete_manual_follow_up' then
    if v_previous<>'manual_follow_up' or nullif(p_command->>'resulting_status','') not in ('active','paused','disputed','promise_to_pay','closed') then raise exception 'invalid_manual_follow_up_completion' using errcode='22023'; end if;
    update public.ar_collection_controls set status=p_command->>'resulting_status',reason_code=v_reason,reason_note=v_note,
      next_action_at=nullif(p_command->>'next_action_at','')::timestamptz,
      version=version+1,updated_at=now(),updated_by=v_actor where id=v_control.id returning * into v_control;
    v_event:='manual_follow_up_completed';
  else
    raise exception 'invalid_collection_control_action' using errcode='22023';
  end if;

  if v_control.status<>'active' then
    update app.due_reminder_stage_dispatches set status='superseded',skipped_reason='collection_'||v_control.status,updated_at=now()
    where company_id=v_company and exposure_chain_id=v_control.exposure_chain_id and status in ('pending','processing','failed');
  end if;
  perform public.ar_append_collection_event(v_control,v_event,v_previous,v_reason,v_note,v_actor,v_request,null,
    jsonb_strip_nulls(jsonb_build_object('resolutionOutcome',p_command->>'resolution_outcome')));
  return jsonb_build_object('control',to_jsonb(v_control));
end;
$$;

create or replace function public.get_ar_collection_workspace(p_anchor_kind text,p_anchor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_company uuid; v_anchor jsonb; v_control public.ar_collection_controls; v_chain uuid;
begin
  v_company:=public.current_company_id();
  if auth.uid() is null or v_company is null or not public.member_has_company_access(v_company) then raise exception 'company_access_required' using errcode='42501'; end if;
  v_anchor:=public.ar_resolve_exposure_anchor(v_company,p_anchor_kind,p_anchor_id);
  v_chain:=(v_anchor->>'exposure_chain_id')::uuid;
  select * into v_control from public.ar_collection_controls where company_id=v_company and exposure_chain_id=v_chain;
  return jsonb_build_object(
    'anchor',v_anchor,
    'control',case when v_control.id is null then jsonb_build_object('status','active','version',0,'isDefault',true) else to_jsonb(v_control) end,
    'promise',null,
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc) from (select * from public.ar_collection_control_events where company_id=v_company and exposure_chain_id=v_chain order by occurred_at desc,id desc limit 100) e),'[]'::jsonb),
    'reminders',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'stageOffsetDays',s.stage_offset_days,'acceptedAt',s.accepted_at,'skipReason',s.skipped_reason,'documentReference',s.document_reference_snapshot) order by s.created_at desc) from (select * from app.due_reminder_stage_dispatches where company_id=v_company and exposure_chain_id=v_chain order by created_at desc limit 50) s),'[]'::jsonb)
  );
end;
$$;

create or replace function public.set_collection_active(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','activate')) $$;
create or replace function public.pause_collection_reminders(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','pause')) $$;
create or replace function public.open_collection_dispute(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','open_dispute')) $$;
create or replace function public.update_collection_dispute(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','update_dispute')) $$;
create or replace function public.resolve_collection_dispute(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','resolve_dispute')) $$;
create or replace function public.assign_manual_follow_up(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','assign_manual_follow_up')) $$;
create or replace function public.complete_manual_follow_up(p_command jsonb) returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.ar_apply_collection_control(p_command||jsonb_build_object('action','complete_manual_follow_up')) $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure proc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'ar_resolve_exposure_anchor','ar_require_collection_manager','ar_append_collection_event',
      'ar_get_or_create_collection_control','ar_apply_collection_control','get_ar_collection_workspace',
      'set_collection_active','pause_collection_reminders','open_collection_dispute','update_collection_dispute',
      'resolve_collection_dispute','assign_manual_follow_up','complete_manual_follow_up'
    ) loop
    execute format('revoke all on function %s from public,anon',r.proc);
  end loop;
end $$;

grant execute on function public.get_ar_collection_workspace(text,uuid) to authenticated;
grant execute on function public.set_collection_active(jsonb) to authenticated;
grant execute on function public.pause_collection_reminders(jsonb) to authenticated;
grant execute on function public.open_collection_dispute(jsonb) to authenticated;
grant execute on function public.update_collection_dispute(jsonb) to authenticated;
grant execute on function public.resolve_collection_dispute(jsonb) to authenticated;
grant execute on function public.assign_manual_follow_up(jsonb) to authenticated;
grant execute on function public.complete_manual_follow_up(jsonb) to authenticated;
grant execute on function public.ar_resolve_exposure_anchor(uuid,text,uuid) to service_role;
grant execute on function public.ar_get_or_create_collection_control(uuid,text,uuid,uuid) to service_role;
grant execute on function public.ar_append_collection_event(public.ar_collection_controls,text,text,text,text,uuid,text,uuid,jsonb) to service_role;

comment on table public.ar_collection_controls is 'One governed current collections state per receivable exposure chain. Mutations are RPC-only.';
comment on table public.ar_collection_control_events is 'Append-only collections timeline evidence; corrections are later events.';
