-- COMMS-3B: durable adaptive reminder stages and atomic provider claims.

create table app.due_reminder_stage_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  anchor_kind text not null check (anchor_kind in ('sales_order','sales_invoice')),
  anchor_id uuid not null,
  exposure_chain_id uuid,
  document_reference_snapshot text not null,
  due_date_snapshot date not null,
  stage_offset_days integer not null check (stage_offset_days between -365 and 365),
  relative_state text not null check (relative_state in ('upcoming','due_tomorrow','due_today','overdue')),
  tone text not null check (tone in ('friendly','gentle_urgency','action_required','overdue','escalated')),
  recipient text not null,
  language text not null check (language in ('en','pt')),
  outstanding_amount_snapshot numeric not null check (outstanding_amount_snapshot >= 0),
  currency_code text not null,
  from_name_snapshot text,
  from_email_snapshot text,
  reply_to_name_snapshot text,
  reply_to_email_snapshot text,
  identity_category text,
  company_name_snapshot text,
  status text not null default 'processing' check (status in ('pending','processing','accepted','failed','skipped','superseded')),
  attempts integer not null default 1 check (attempts > 0),
  provider_message_id text,
  dispatch_audit_id uuid references app.mail_dispatch_events(id) on delete set null,
  skipped_reason text,
  queued_at timestamptz not null default now(),
  accepted_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,anchor_kind,anchor_id,due_date_snapshot,stage_offset_days,recipient,language)
);

create index due_reminder_stage_company_recent_idx
  on app.due_reminder_stage_dispatches(company_id,created_at desc);
create index due_reminder_stage_processing_idx
  on app.due_reminder_stage_dispatches(status,updated_at) where status='processing';
alter table app.due_reminder_stage_dispatches enable row level security;
alter table app.due_reminder_stage_dispatches force row level security;
revoke all on table app.due_reminder_stage_dispatches from public,anon,authenticated;

create or replace function public.due_reminder_stage_metadata(p_offset_days integer)
returns jsonb language sql immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'offsetDays', p_offset_days,
    'exactDays', abs(p_offset_days),
    'relativeState', case when p_offset_days = 1 then 'due_tomorrow' when p_offset_days = 0 then 'due_today' when p_offset_days < 0 then 'overdue' else 'upcoming' end,
    'tone', case when p_offset_days >= 7 then 'friendly' when p_offset_days > 0 then 'gentle_urgency' when p_offset_days = 0 then 'action_required' when p_offset_days >= -7 then 'overdue' else 'escalated' end
  );
$$;

create or replace function public.reserve_due_reminder_stage(p_event jsonb)
returns app.due_reminder_stage_dispatches
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_row app.due_reminder_stage_dispatches;
begin
  -- Recover a provider acceptance recorded after the worker lost its response.
  update app.due_reminder_stage_dispatches s
  set status='accepted',provider_message_id=e.provider_message_id,dispatch_audit_id=e.id,
      accepted_at=coalesce(e.sent_at,e.created_at),updated_at=now(),skipped_reason=null
  from app.mail_dispatch_events e
  where s.company_id=(p_event->>'company_id')::uuid
    and s.anchor_kind=p_event->>'anchor_kind'
    and s.anchor_id=(p_event->>'anchor_id')::uuid
    and s.due_date_snapshot=(p_event->>'due_date')::date
    and s.stage_offset_days=(p_event->>'stage_offset_days')::integer
    and s.recipient=lower(p_event->>'recipient')
    and s.language=p_event->>'language'
    and s.status='processing'
    and e.job_reference=s.id::text
    and e.status in ('accepted','sent');

  update app.due_reminder_stage_dispatches
  set status='superseded',skipped_reason='due_date_changed',updated_at=now()
  where company_id=(p_event->>'company_id')::uuid
    and anchor_kind=p_event->>'anchor_kind'
    and anchor_id=(p_event->>'anchor_id')::uuid
    and due_date_snapshot<>(p_event->>'due_date')::date
    and status in ('pending','processing','failed');

  insert into app.due_reminder_stage_dispatches(
    company_id,anchor_kind,anchor_id,exposure_chain_id,document_reference_snapshot,
    due_date_snapshot,stage_offset_days,relative_state,tone,recipient,language,
    outstanding_amount_snapshot,currency_code,from_name_snapshot,from_email_snapshot,
    reply_to_name_snapshot,reply_to_email_snapshot,identity_category,company_name_snapshot,status
  ) values (
    (p_event->>'company_id')::uuid,p_event->>'anchor_kind',(p_event->>'anchor_id')::uuid,
    nullif(p_event->>'exposure_chain_id','')::uuid,p_event->>'document_reference',
    (p_event->>'due_date')::date,(p_event->>'stage_offset_days')::integer,
    p_event->>'relative_state',p_event->>'tone',lower(p_event->>'recipient'),p_event->>'language',
    (p_event->>'outstanding_amount')::numeric,upper(p_event->>'currency_code'),
    p_event->>'from_name',p_event->>'from_email',p_event->>'reply_to_name',p_event->>'reply_to_email',
    p_event->>'identity_category',p_event->>'company_name','processing'
  )
  on conflict (company_id,anchor_kind,anchor_id,due_date_snapshot,stage_offset_days,recipient,language)
  do update set
    status='processing',attempts=app.due_reminder_stage_dispatches.attempts+1,
    outstanding_amount_snapshot=excluded.outstanding_amount_snapshot,
    updated_at=now(),skipped_reason=null,failed_at=null
  where app.due_reminder_stage_dispatches.status in ('pending','failed')
     or (app.due_reminder_stage_dispatches.status='processing'
       and app.due_reminder_stage_dispatches.updated_at < now()-interval '15 minutes'
       and not exists (
         select 1 from app.mail_dispatch_events e
         where e.job_reference=app.due_reminder_stage_dispatches.id::text
           and e.status in ('accepted','sent')
       ))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.build_adaptive_due_reminder_batch(
  p_company_id uuid,p_local_day date,p_timezone text,p_stage_offsets integer[]
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_base jsonb; v_rows jsonb;
begin
  if coalesce(array_length(p_stage_offsets,1),0)=0
     or exists(select 1 from unnest(p_stage_offsets) d where d < -365 or d > 365)
     or (select count(*) from unnest(p_stage_offsets) d) > 24
     or (select count(*) from unnest(p_stage_offsets) d) <> (select count(distinct d) from unnest(p_stage_offsets) d) then
    raise exception 'invalid_due_reminder_stage_offsets' using errcode='22023';
  end if;

  -- The maintained builder remains the active-anchor and outstanding-balance authority.
  v_base := public.build_due_reminder_batch(
    p_company_id,p_local_day,p_timezone,
    array(select generate_series(-365,365))
  );

  select coalesce(jsonb_agg(
    r || jsonb_build_object(
      'stage_offset_days',stage.offset_days,
      'relative_state',public.due_reminder_stage_metadata(stage.offset_days)->>'relativeState',
      'tone',public.due_reminder_stage_metadata(stage.offset_days)->>'tone'
    ) order by (r->>'days_until_due')::integer,r->>'document_reference'
  ),'[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_base->'reminders','[]'::jsonb)) r
  cross join lateral (
    select min(d)::integer offset_days
    from unnest(p_stage_offsets) d
    where d >= (r->>'days_until_due')::integer
  ) stage
  where stage.offset_days is not null;

  return jsonb_set(v_base,'{reminders}',v_rows,true);
end;
$$;

create or replace function public.finish_due_reminder_stage(
  p_stage_id uuid,p_status text,p_provider_message_id text default null,
  p_dispatch_audit_id uuid default null,p_reason text default null
)
returns boolean language plpgsql security definer
set search_path = pg_catalog, app
as $$
begin
  if p_status not in ('accepted','failed','skipped','superseded') then
    raise exception 'invalid_due_reminder_stage_status' using errcode='22023';
  end if;
  update app.due_reminder_stage_dispatches set
    status=p_status,provider_message_id=nullif(p_provider_message_id,''),dispatch_audit_id=p_dispatch_audit_id,
    skipped_reason=nullif(p_reason,''),accepted_at=case when p_status='accepted' then now() else accepted_at end,
    failed_at=case when p_status='failed' then now() else failed_at end,updated_at=now()
  where id=p_stage_id and status='processing';
  return found;
end;
$$;

revoke all on function public.due_reminder_stage_metadata(integer) from public,anon,authenticated;
grant execute on function public.due_reminder_stage_metadata(integer) to service_role;
revoke all on function public.reserve_due_reminder_stage(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_due_reminder_stage(jsonb) to service_role;
revoke all on function public.finish_due_reminder_stage(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_due_reminder_stage(uuid,text,text,uuid,text) to service_role;
revoke all on function public.build_adaptive_due_reminder_batch(uuid,date,text,integer[]) from public,anon,authenticated;
grant execute on function public.build_adaptive_due_reminder_batch(uuid,date,text,integer[]) to service_role;

comment on table app.due_reminder_stage_dispatches is
  'One immutable logical reminder stage per anchor, due-date version, recipient, and language. Accepted stages cannot be reclaimed.';
