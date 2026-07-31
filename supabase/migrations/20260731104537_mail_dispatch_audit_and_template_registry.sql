-- OPS-1: private evidence for application-email rendering and delivery.

create table app.mail_dispatch_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  worker text not null,
  template_key text not null,
  template_version integer not null check (template_version > 0),
  language text not null check (language in ('en','pt')),
  recipient text not null,
  subject text not null,
  status text not null check (status in ('rendered','accepted','sent','retrying','failed','permanent_failure')),
  provider text,
  provider_message_id text,
  job_reference text,
  attempt integer not null default 1 check (attempt > 0),
  error_category text,
  qa boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  constraint mail_dispatch_events_no_rendered_html check (length(subject) <= 500),
  constraint mail_dispatch_events_recipient_length check (length(recipient) <= 320)
);

create index mail_dispatch_events_recent_idx on app.mail_dispatch_events(created_at desc);
create index mail_dispatch_events_worker_status_idx on app.mail_dispatch_events(worker,status,created_at desc);
create index mail_dispatch_events_company_idx on app.mail_dispatch_events(company_id,created_at desc) where company_id is not null;
alter table app.mail_dispatch_events enable row level security;
alter table app.mail_dispatch_events force row level security;
revoke all on table app.mail_dispatch_events from public,anon,authenticated;

create or replace function public.platform_admin_list_mail_dispatches(p_limit integer default 100)
returns table(
  id uuid,company_id uuid,worker text,template_key text,template_version integer,
  language text,recipient text,subject text,status text,provider text,
  provider_message_id text,job_reference text,attempt integer,error_category text,
  qa boolean,created_at timestamptz,sent_at timestamptz,failed_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode='42501';
  end if;
  return query select e.id,e.company_id,e.worker,e.template_key,e.template_version,
    e.language,e.recipient,e.subject,e.status,e.provider,e.provider_message_id,
    e.job_reference,e.attempt,e.error_category,e.qa,e.created_at,e.sent_at,e.failed_at
  from app.mail_dispatch_events e order by e.created_at desc limit least(greatest(coalesce(p_limit,100),1),500);
end;
$$;

create or replace function public.record_mail_dispatch_event(p_event jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare v_id uuid;
begin
  insert into app.mail_dispatch_events(
    company_id,worker,template_key,template_version,language,recipient,subject,status,
    provider,provider_message_id,job_reference,attempt,error_category,qa,sent_at,failed_at
  ) values (
    nullif(p_event->>'company_id','')::uuid,p_event->>'worker',p_event->>'template_key',
    coalesce((p_event->>'template_version')::integer,1),p_event->>'language',p_event->>'recipient',
    p_event->>'subject',p_event->>'status',nullif(p_event->>'provider',''),nullif(p_event->>'provider_message_id',''),
    nullif(p_event->>'job_reference',''),coalesce((p_event->>'attempt')::integer,1),nullif(p_event->>'error_category',''),
    coalesce((p_event->>'qa')::boolean,false),case when p_event->>'status' in ('accepted','sent') then now() end,
    case when p_event->>'status' in ('failed','permanent_failure') then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

alter function public.platform_admin_list_mail_dispatches(integer) owner to postgres;
alter function public.record_mail_dispatch_event(jsonb) owner to postgres;
revoke all on function public.platform_admin_list_mail_dispatches(integer) from public,anon;
grant execute on function public.platform_admin_list_mail_dispatches(integer) to authenticated;
revoke all on function public.record_mail_dispatch_event(jsonb) from public,anon,authenticated;
grant execute on function public.record_mail_dispatch_event(jsonb) to service_role;

comment on table app.mail_dispatch_events is
  'Private email dispatch metadata. Rendered HTML, SMTP secrets, tokens, and session data are intentionally excluded.';
