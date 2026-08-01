-- COMMS-3A: governed company communication routing and immutable sender evidence.

create table public.company_communication_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  finance_email text,
  invitation_reply_to_email text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint company_communication_profiles_finance_email_check
    check (finance_email is null or finance_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint company_communication_profiles_invitation_email_check
    check (invitation_reply_to_email is null or invitation_reply_to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create or replace function public.normalize_company_communication_profile()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.finance_email := nullif(lower(btrim(coalesce(new.finance_email, ''))), '');
  new.invitation_reply_to_email := nullif(lower(btrim(coalesce(new.invitation_reply_to_email, ''))), '');
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger company_communication_profiles_normalize
before insert or update on public.company_communication_profiles
for each row execute function public.normalize_company_communication_profile();

alter table public.company_communication_profiles enable row level security;
alter table public.company_communication_profiles force row level security;

create policy company_communication_profiles_select_company
on public.company_communication_profiles for select to authenticated
using (company_id = public.current_company_id());

create policy company_communication_profiles_insert_owner_admin
on public.company_communication_profiles for insert to authenticated
with check (
  company_id = public.current_company_id()
  and public.has_company_role(company_id, array['OWNER'::public.member_role,'ADMIN'::public.member_role])
);

create policy company_communication_profiles_update_owner_admin
on public.company_communication_profiles for update to authenticated
using (
  company_id = public.current_company_id()
  and public.has_company_role(company_id, array['OWNER'::public.member_role,'ADMIN'::public.member_role])
)
with check (
  company_id = public.current_company_id()
  and public.has_company_role(company_id, array['OWNER'::public.member_role,'ADMIN'::public.member_role])
);

revoke all on table public.company_communication_profiles from public, anon;
grant select, insert, update on table public.company_communication_profiles to authenticated;
grant all on table public.company_communication_profiles to service_role;

alter table app.mail_dispatch_events
  add column from_name text,
  add column from_email text,
  add column reply_to_name text,
  add column reply_to_email text,
  add column identity_category text,
  add column company_name_snapshot text,
  add constraint mail_dispatch_events_identity_category_check check (
    identity_category is null or identity_category in ('commercial','internal_intelligence','member_invitation','platform')
  );

drop function public.platform_admin_list_mail_dispatches(integer);
create function public.platform_admin_list_mail_dispatches(p_limit integer default 100)
returns table(
  id uuid,company_id uuid,worker text,template_key text,template_version integer,
  language text,recipient text,subject text,status text,provider text,
  provider_message_id text,job_reference text,attempt integer,error_category text,
  qa boolean,created_at timestamptz,sent_at timestamptz,failed_at timestamptz,
  from_name text,from_email text,reply_to_name text,reply_to_email text,
  identity_category text,company_name_snapshot text
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
    e.job_reference,e.attempt,e.error_category,e.qa,e.created_at,e.sent_at,e.failed_at,
    e.from_name,e.from_email,e.reply_to_name,e.reply_to_email,e.identity_category,e.company_name_snapshot
  from app.mail_dispatch_events e order by e.created_at desc
  limit least(greatest(coalesce(p_limit,100),1),500);
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
    provider,provider_message_id,job_reference,attempt,error_category,qa,sent_at,failed_at,
    from_name,from_email,reply_to_name,reply_to_email,identity_category,company_name_snapshot
  ) values (
    nullif(p_event->>'company_id','')::uuid,p_event->>'worker',p_event->>'template_key',
    coalesce((p_event->>'template_version')::integer,1),p_event->>'language',p_event->>'recipient',
    p_event->>'subject',p_event->>'status',nullif(p_event->>'provider',''),nullif(p_event->>'provider_message_id',''),
    nullif(p_event->>'job_reference',''),coalesce((p_event->>'attempt')::integer,1),nullif(p_event->>'error_category',''),
    coalesce((p_event->>'qa')::boolean,false),case when p_event->>'status' in ('accepted','sent') then now() end,
    case when p_event->>'status' in ('failed','permanent_failure') then now() end,
    nullif(p_event->>'from_name',''),nullif(p_event->>'from_email',''),nullif(p_event->>'reply_to_name',''),
    nullif(p_event->>'reply_to_email',''),nullif(p_event->>'identity_category',''),nullif(p_event->>'company_name_snapshot','')
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

comment on table public.company_communication_profiles is
  'Company-owned email routing preferences. The authenticated StockWise sender address remains platform controlled.';
