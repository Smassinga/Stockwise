-- OPS-1: targeted, localisable notification events with legacy compatibility.

alter table public.notifications
  add column event_type text,
  add column category text,
  add column payload jsonb not null default '{}'::jsonb,
  add column deduplication_key text,
  add column severity text,
  add column action_url text,
  add column occurred_at timestamptz,
  add column dismissed_at timestamptz,
  add column resolved_at timestamptz;

update public.notifications set
  category=coalesce(category,'legacy'),severity=coalesce(severity,level,'info'),
  action_url=coalesce(action_url,url),occurred_at=coalesce(occurred_at,created_at)
where category is null or severity is null or action_url is null or occurred_at is null;

alter table public.notifications
  add constraint notifications_category_check check (category is null or category in ('approvals','inventory','orders','service_jobs','receivables','payables','users_access','imports','communications','system','legacy')),
  add constraint notifications_severity_check check (severity is null or severity in ('info','success','warning','error','critical')),
  add constraint notifications_action_url_safe check (action_url is null or (action_url like '/%' and action_url not like '//%'));

-- Preserve immutable business evidence while allowing the event producer to
-- refresh deduplicated events and users to mark or dismiss their own rows.
create or replace function public.only_read_at_changes()
returns trigger language plpgsql
set search_path=pg_catalog,public,extensions
as $$
begin
  if current_user in ('postgres','service_role') then return new; end if;
  if (to_jsonb(new) - array['read_at','dismissed_at']) <> (to_jsonb(old) - array['read_at','dismissed_at']) then
    raise exception 'Only read_at and dismissed_at can be updated on notifications';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then raise exception 'read_at can only be set once'; end if;
  if old.dismissed_at is not null and new.dismissed_at is distinct from old.dismissed_at then raise exception 'dismissed_at can only be set once'; end if;
  if new.read_at is not null and new.read_at < old.created_at then raise exception 'read_at is invalid'; end if;
  if new.dismissed_at is not null and new.dismissed_at < old.created_at then raise exception 'dismissed_at is invalid'; end if;
  return new;
end;
$$;

create unique index notifications_event_dedup_unique
  on public.notifications(company_id,user_id,deduplication_key)
  where deduplication_key is not null and resolved_at is null;
create index notifications_user_history_idx
  on public.notifications(company_id,user_id,occurred_at desc,id desc);

create table public.notification_preferences (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('approvals','inventory','orders','service_jobs','receivables','payables','users_access','imports','communications','system')),
  in_app_mode text not null default 'immediate' check (in_app_mode in ('immediate','digest','off')),
  email_mode text not null default 'off' check (email_mode in ('immediate','digest','off')),
  updated_at timestamptz not null default now(),
  primary key(company_id,user_id,category)
);
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
create policy notification_preferences_select_self on public.notification_preferences for select to authenticated
  using(company_id=public.current_company_id() and user_id=auth.uid());
create policy notification_preferences_insert_self on public.notification_preferences for insert to authenticated
  with check(company_id=public.current_company_id() and user_id=auth.uid());
create policy notification_preferences_update_self on public.notification_preferences for update to authenticated
  using(company_id=public.current_company_id() and user_id=auth.uid())
  with check(company_id=public.current_company_id() and user_id=auth.uid());
revoke all on table public.notification_preferences from public,anon;
grant select,insert,update on table public.notification_preferences to authenticated;

create or replace function public.stockwise_emit_notification_event(
  p_company_id uuid,p_user_id uuid,p_event_type text,p_category text,p_payload jsonb,
  p_deduplication_key text,p_severity text,p_action_url text,p_fallback_title text,p_fallback_body text
) returns uuid language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_id uuid;
begin
  if p_company_id is null or p_user_id is null or nullif(btrim(p_event_type),'') is null then return null; end if;
  if p_action_url is not null and (p_action_url not like '/%' or p_action_url like '//%') then
    raise exception 'notification_action_url_invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.company_members cm where cm.company_id=p_company_id and cm.user_id=p_user_id and cm.status='active') then return null; end if;
  if exists(select 1 from public.notification_preferences np where np.company_id=p_company_id and np.user_id=p_user_id and np.category=p_category and np.in_app_mode='off')
     and not (p_category='system' and p_severity in ('critical','error')) then return null; end if;
  insert into public.notifications(company_id,user_id,level,title,body,url,icon,meta,event_type,category,payload,deduplication_key,severity,action_url,occurred_at)
  values(p_company_id,p_user_id,p_severity,p_fallback_title,p_fallback_body,p_action_url,null,p_payload,p_event_type,p_category,coalesce(p_payload,'{}'::jsonb),p_deduplication_key,p_severity,p_action_url,now())
  on conflict(company_id,user_id,deduplication_key) where deduplication_key is not null and resolved_at is null
  do update set occurred_at=excluded.occurred_at,payload=excluded.payload,severity=excluded.severity,
    title=excluded.title,body=excluded.body,action_url=excluded.action_url,url=excluded.url,read_at=null,dismissed_at=null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.stockwise_notify_company_roles(
  p_company_id uuid,p_roles public.member_role[],p_event_type text,p_category text,p_payload jsonb,
  p_dedup_prefix text,p_severity text,p_action_url text,p_title text,p_body text,p_exclude_user uuid default null
) returns integer language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_member record; v_count integer:=0;
begin
  for v_member in select cm.user_id from public.company_members cm where cm.company_id=p_company_id and cm.status='active' and cm.role=any(p_roles) and (p_exclude_user is null or cm.user_id<>p_exclude_user)
  loop
    perform public.stockwise_emit_notification_event(p_company_id,v_member.user_id,p_event_type,p_category,p_payload,p_dedup_prefix||':'||v_member.user_id,p_severity,p_action_url,p_title,p_body);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.stockwise_stock_exception_notifications()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_item public.items%rowtype; v_qty numeric; v_event text; v_title text;
begin
  select * into v_item from public.items where id=new.item_id and company_id=new.company_id;
  if v_item.id is null or v_item.min_stock is null then return new; end if;
  select coalesce(sum(qty),0) into v_qty from public.stock_levels where company_id=new.company_id and item_id=new.item_id and warehouse_id=new.warehouse_id;
  if v_qty<=0 then v_event:='inventory.out_of_stock'; v_title:='Out of stock';
  elsif v_qty<=v_item.min_stock then v_event:='inventory.low_stock'; v_title:='Low stock';
  else
    update public.notifications set resolved_at=now() where company_id=new.company_id and event_type in ('inventory.low_stock','inventory.out_of_stock') and deduplication_key like 'stock:'||new.item_id||':'||new.warehouse_id||':%' and resolved_at is null;
    return new;
  end if;
  perform public.stockwise_notify_company_roles(new.company_id,array['OWNER','ADMIN','MANAGER']::public.member_role[],v_event,'inventory',jsonb_build_object('itemId',new.item_id,'item',v_item.name,'warehouseId',new.warehouse_id,'quantity',v_qty,'minimum',v_item.min_stock),'stock:'||new.item_id||':'||new.warehouse_id,case when v_event='inventory.out_of_stock' then 'error' else 'warning' end,'/stock-levels',v_title,v_item.name,null);
  return new;
end; $$;

create trigger stock_levels_exception_notifications after insert or update of qty on public.stock_levels
for each row execute function public.stockwise_stock_exception_notifications();

create or replace function public.stockwise_service_job_notifications()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_event text; v_severity text:='info';
begin
  if tg_op='UPDATE' and new.execution_status='completed' and old.execution_status is distinct from 'completed' then v_event:='service_job.completed';
  elsif tg_op='UPDATE' and new.costing_status='open' and old.costing_status='finalised' then v_event:='service_job.costing_reopened'; v_severity:='warning';
  else return new; end if;
  if new.created_by is not null then perform public.stockwise_emit_notification_event(new.company_id,new.created_by,v_event,'service_jobs',jsonb_build_object('serviceJobId',new.id,'reference',new.job_reference),'service-job:'||new.id||':'||v_event||':'||new.created_by,v_severity,'/service-jobs',case when v_event='service_job.completed' then 'Service Job completed' else 'Service Job costing reopened' end,new.job_reference); end if;
  perform public.stockwise_notify_company_roles(new.company_id,array['OWNER','ADMIN','MANAGER']::public.member_role[],v_event,'service_jobs',jsonb_build_object('serviceJobId',new.id,'reference',new.job_reference),'service-job:'||new.id||':'||v_event,v_severity,'/service-jobs',case when v_event='service_job.completed' then 'Service Job completed' else 'Service Job costing reopened' end,new.job_reference,new.created_by);
  return new;
end; $$;
create trigger service_jobs_actionable_notifications after update of execution_status,costing_status on public.service_jobs
for each row execute function public.stockwise_service_job_notifications();

create or replace function public.stockwise_member_change_notifications()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_event text;
begin
  if tg_op='UPDATE' and new.status='active' and old.status is distinct from 'active' then v_event:='member.activated';
  elsif tg_op='UPDATE' and new.role is distinct from old.role then v_event:='member.role_changed';
  elsif tg_op='UPDATE' and new.status='disabled' and old.status is distinct from 'disabled' then v_event:='member.disabled';
  else return new; end if;
  perform public.stockwise_emit_notification_event(new.company_id,new.user_id,v_event,'users_access',jsonb_build_object('role',new.role,'status',new.status),'member:'||new.company_id||':'||new.user_id||':'||v_event,'info','/profile','Membership updated','Your StockWise membership was updated.');
  perform public.stockwise_notify_company_roles(new.company_id,array['OWNER','ADMIN']::public.member_role[],v_event,'users_access',jsonb_build_object('memberUserId',new.user_id,'role',new.role,'status',new.status),'member-admin:'||new.company_id||':'||new.user_id||':'||v_event,'info','/users','Member updated','A company membership changed.',new.user_id);
  return new;
end; $$;
create trigger company_members_actionable_notifications after update of role,status on public.company_members
for each row execute function public.stockwise_member_change_notifications();

alter function public.stockwise_emit_notification_event(uuid,uuid,text,text,jsonb,text,text,text,text,text) owner to postgres;
alter function public.stockwise_notify_company_roles(uuid,public.member_role[],text,text,jsonb,text,text,text,text,text,uuid) owner to postgres;
revoke all on function public.stockwise_emit_notification_event(uuid,uuid,text,text,jsonb,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.stockwise_notify_company_roles(uuid,public.member_role[],text,text,jsonb,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.stockwise_emit_notification_event(uuid,uuid,text,text,jsonb,text,text,text,text,text) to service_role;
grant execute on function public.stockwise_notify_company_roles(uuid,public.member_role[],text,text,jsonb,text,text,text,text,text,uuid) to service_role;
