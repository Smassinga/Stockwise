-- INTERNAL RECEIVABLES ALERTS
--
-- Internal, company-user alerts are evaluated from the final Package A
-- receivables read model. Customer email reminders remain a separate channel.
-- No customer email or external provider is required by this migration.

create extension if not exists pg_cron;

-- Purchase/sales approval triggers call this legacy producer through their
-- hardened trigger functions. Keep that path working after direct notification
-- INSERT is revoked; direct client execution is revoked below.
create or replace function public.emit_cash_approval_notif(
  p_company_id uuid,
  p_title text,
  p_body text,
  p_url text,
  p_level text default 'warning'
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
begin
  if auth.uid() is not null and (
    p_company_id is distinct from public.current_company_id()
    or not public.has_company_role(
      p_company_id,
      array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
    )
  ) then
    raise exception 'notification_company_access_denied' using errcode='42501';
  end if;
  if p_url is not null and (p_url not like '/%' or p_url like '//%') then
    raise exception 'notification_action_url_invalid' using errcode='22023';
  end if;

  if not exists(
    select 1 from public.notifications n
    where n.company_id=p_company_id
      and n.title=p_title
      and coalesce(n.url,'')=coalesce(p_url,'')
      and n.created_at>=now()-interval '10 minutes'
  ) then
    insert into public.notifications(id,company_id,user_id,level,title,body,url,created_at)
    values(gen_random_uuid(),p_company_id,null,p_level,p_title,p_body,p_url,now());
  end if;
end
$$;

alter function public.emit_cash_approval_notif(uuid,text,text,text,text) owner to postgres;
revoke all on function public.emit_cash_approval_notif(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.emit_cash_approval_notif(uuid,text,text,text,text) to service_role;

-- These are the only legacy request-role callers of the emitter. Run the
-- trigger bodies as their postgres owner so the now-internal emitter remains
-- callable, without exposing a general notification-forging RPC.
create or replace function public.tg_po_awaiting_notify()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  was_awaiting boolean:=false;
  now_awaiting boolean:=false;
  bal numeric;
  title text;
  body text;
  url text;
begin
  if tg_op='INSERT' then
    now_awaiting:=public.po_is_awaiting_now(new);
  else
    was_awaiting:=public.po_is_awaiting_now(old);
    now_awaiting:=public.po_is_awaiting_now(new);
  end if;
  if now_awaiting and not was_awaiting then
    bal:=public.po_balance_due_base(new);
    title:='Awaiting approval: Purchase Order';
    body:=format('PO %s • Due %s',coalesce(new.order_no,left(new.id::text,8)),coalesce(bal,0));
    url:='/cash/approvals';
    perform public.emit_cash_approval_notif(new.company_id,title,body,url,'warning');
  end if;
  return new;
end
$$;

create or replace function public.tg_so_awaiting_notify()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  was_awaiting boolean:=false;
  now_awaiting boolean:=false;
  bal numeric;
  title text;
  body text;
  url text;
begin
  if tg_op='INSERT' then
    now_awaiting:=public.so_is_awaiting_now(new);
  else
    was_awaiting:=public.so_is_awaiting_now(old);
    now_awaiting:=public.so_is_awaiting_now(new);
  end if;
  if now_awaiting and not was_awaiting then
    bal:=public.so_balance_due_base(new);
    title:='Awaiting approval: Sales Order';
    body:=format('SO %s • Due %s',coalesce(new.order_no,left(new.id::text,8)),coalesce(bal,0));
    url:='/cash/approvals';
    perform public.emit_cash_approval_notif(new.company_id,title,body,url,'warning');
  end if;
  return new;
end
$$;

alter function public.tg_po_awaiting_notify() owner to postgres;
alter function public.tg_so_awaiting_notify() owner to postgres;
revoke all on function public.tg_po_awaiting_notify() from public,anon,authenticated;
revoke all on function public.tg_so_awaiting_notify() from public,anon,authenticated;

-- Normal authenticated users may read their company/user feed and may set only
-- the lifecycle columns allowed by only_read_at_changes(). Notification
-- creation remains exclusively inside governed database producers.
drop policy if exists notifications_insert_operator_plus_scoped on public.notifications;
revoke all on table public.notifications from public, anon, authenticated;
grant select, update on table public.notifications to authenticated;
alter table public.notifications force row level security;

-- Remove inherited baseline privileges that are broader than the self-service
-- preference contract. RLS still enforces company + authenticated user scope.
revoke all on table public.notification_preferences from public, anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;

-- The current client uses Postgres Changes for the notification bell. Add only
-- the existing RLS-protected notification table, and keep replay idempotent.
do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(
       select 1
       from pg_catalog.pg_publication_rel pr
       join pg_catalog.pg_publication p on p.oid=pr.prpubid
       where p.pubname='supabase_realtime'
         and pr.prrelid='public.notifications'::regclass
     ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;

-- Active receivables alerts are refreshed or resolved by company and user on
-- every company evaluation. Keep that bounded without indexing JSON payloads.
create index if not exists notifications_active_receivables_idx
  on public.notifications(company_id,user_id,event_type)
  where resolved_at is null and category='receivables';

create or replace function public.evaluate_receivable_internal_alerts(
  p_company_id uuid,
  p_local_day date,
  p_timezone text,
  p_stage_offsets integer[]
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  r record;
  m record;
  a record;
  v_event_type text;
  v_severity text;
  v_dedupe_key text;
  v_identity text;
  v_context_identity text;
  v_action_url text;
  v_payload jsonb;
  v_title text;
  v_body text;
  v_active_keys text[]:='{}'::text[];
  v_active_contexts text[]:='{}'::text[];
  v_group_count integer:=0;
  v_notification_count integer:=0;
  v_refreshed_count integer:=0;
  v_resolved_count integer:=0;
begin
  if p_company_id is null or p_local_day is null then
    raise exception 'receivables_alert_company_and_day_required' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_timezone,'')),'') is null
     or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'receivables_alert_timezone_invalid' using errcode='22023';
  end if;
  if coalesce(array_length(p_stage_offsets,1),0)=0
     or array_length(p_stage_offsets,1)>24
     or exists(select 1 from unnest(p_stage_offsets) d where d < -365 or d > 365)
     or (select count(*) from unnest(p_stage_offsets))
        <> (select count(distinct d) from unnest(p_stage_offsets) d) then
    raise exception 'receivables_alert_offsets_invalid' using errcode='22023';
  end if;

  -- One company evaluator at a time. Repeated scheduler calls remain harmless
  -- because each company/user/business-date bucket has one active identity.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stockwise:receivables-internal-alerts:'||p_company_id::text,0
    )
  ) then
    return jsonb_build_object('companyId',p_company_id,'businessDate',p_local_day,'skipped','already_running');
  end if;

  -- Keep collections controls current even when customer email delivery is
  -- disabled. These functions change control evidence only; they do not post
  -- finance, settlement, or receipt entries.
  perform public.sync_ar_collection_controls(p_company_id,p_local_day,p_timezone);
  perform public.evaluate_payment_promises(p_company_id,p_local_day,p_timezone);
  perform public.emit_collection_follow_up_notifications(p_company_id,p_local_day,p_timezone);

  for r in
    with eligible as (
      select
        e.company_id,
        e.customer_id,
        e.exposure_chain_id,
        e.customer_name,
        upper(coalesce(nullif(e.base_currency_code,''),'MZN')) currency_code,
        e.due_date,
        (e.due_date-p_local_day)::integer bucket_offset_days,
        e.outstanding_amount_base
      from public.v_customer_receivable_exposures e
      where e.company_id=p_company_id
        and e.customer_id is not null
        and e.due_date is not null
        and e.outstanding_amount_base>0.005
        and not e.collections_suppressed
        and (e.due_date-p_local_day)::integer=any(p_stage_offsets)
    ), grouped as (
      select
        e.company_id,e.customer_id,
        max(nullif(btrim(e.customer_name),'')) customer_name,
        e.currency_code,e.bucket_offset_days,
        count(*)::integer document_count,
        sum(e.outstanding_amount_base)::numeric(18,2) outstanding_amount,
        jsonb_agg(distinct e.exposure_chain_id::text order by e.exposure_chain_id::text) exposure_chain_ids,
        min(e.due_date) oldest_due_date,
        max(e.due_date) nearest_due_date
      from eligible e
      group by e.company_id,e.customer_id,e.currency_code,e.bucket_offset_days
    )
    select g.*,
      coalesce(c.unapplied_credit_base,0::numeric)::numeric(18,2) unallocated_customer_credit
    from grouped g
    left join public.v_customer_unapplied_credit c
      on c.company_id=g.company_id
     and c.customer_id=g.customer_id
     and upper(c.currency_code)=g.currency_code
    order by g.customer_id,g.currency_code,g.bucket_offset_days desc
  loop
    v_group_count:=v_group_count+1;
    if r.bucket_offset_days>0 then
      v_event_type:='receivables.due_soon';
      v_severity:=case when r.bucket_offset_days<=1 then 'warning' else 'info' end;
      v_title:='Payments due soon';
    elsif r.bucket_offset_days=0 then
      v_event_type:='receivables.due_today';
      v_severity:='warning';
      v_title:='Due today';
    elsif r.bucket_offset_days<=-15 then
      v_event_type:='receivables.severely_overdue';
      v_severity:='critical';
      v_title:='Customer severely overdue';
    else
      v_event_type:='receivables.overdue';
      v_severity:='warning';
      v_title:='Customer overdue';
    end if;

    v_dedupe_key:=concat_ws(':','receivables-due',r.customer_id,r.currency_code,r.bucket_offset_days,p_local_day);
    v_action_url:=format(
      '/settlements?view=receipts&side=ar&customerId=%s&companyId=%s',
      r.customer_id,p_company_id
    );
    v_payload:=jsonb_build_object(
      'customerId',r.customer_id,
      'customerName',coalesce(r.customer_name,'Customer'),
      'documentCount',r.document_count,
      'outstandingAmount',r.outstanding_amount,
      'currencyCode',r.currency_code,
      'bucketOffsetDays',r.bucket_offset_days,
      'nearestDueDate',r.nearest_due_date,
      'oldestDueDate',r.oldest_due_date,
      'businessDate',p_local_day,
      'exposureChainIds',r.exposure_chain_ids,
      'unallocatedCustomerCredit',r.unallocated_customer_credit,
      'arContext','customer-receivables'
    );
    v_body:=format(
      '%s has %s open receivable document%s totalling %s %s.',
      coalesce(r.customer_name,'Customer'),r.document_count,
      case when r.document_count=1 then '' else 's' end,
      r.currency_code,r.outstanding_amount
    );

    for m in
      select cm.user_id
      from public.company_members cm
      where cm.company_id=p_company_id
        and cm.user_id is not null
        and cm.status='active'
        and cm.role=any(array['OWNER','ADMIN','MANAGER']::public.member_role[])
        and not exists(
          select 1 from public.notification_preferences np
          where np.company_id=cm.company_id
            and np.user_id=cm.user_id
            and np.category='receivables'
            and np.in_app_mode='off'
        )
    loop
      v_identity:=v_dedupe_key||':'||m.user_id;
      v_context_identity:=r.customer_id||':'||r.currency_code||':'||m.user_id;
      v_active_keys:=array_append(v_active_keys,v_identity);
      v_active_contexts:=array_append(v_active_contexts,v_context_identity);

      insert into public.notifications(
        company_id,user_id,level,title,body,url,icon,meta,
        event_type,category,payload,deduplication_key,severity,action_url,occurred_at
      ) values (
        p_company_id,m.user_id,v_severity,v_title,v_body,v_action_url,null,v_payload,
        v_event_type,'receivables',v_payload,v_dedupe_key,v_severity,v_action_url,now()
      )
      on conflict(company_id,user_id,deduplication_key)
        where deduplication_key is not null and resolved_at is null
      do update set
        level=excluded.level,
        title=excluded.title,
        body=excluded.body,
        url=excluded.url,
        meta=excluded.meta,
        event_type=excluded.event_type,
        category=excluded.category,
        payload=excluded.payload,
        severity=excluded.severity,
        action_url=excluded.action_url;
      v_notification_count:=v_notification_count+1;
    end loop;
  end loop;

  -- A stage creates an alert once. Later evaluations refresh that same active
  -- cohort from the authoritative AR view even on non-stage days, so partial
  -- allocations never leave stale amounts and no daily duplicate is created.
  for a in
    with active_notifications as (
      select n.id,n.payload
      from public.notifications n
      where n.company_id=p_company_id
        and n.category='receivables'
        and n.event_type in (
          'receivables.due_soon','receivables.due_today',
          'receivables.overdue','receivables.severely_overdue'
        )
        and n.resolved_at is null
    ), refreshed as (
      select
        n.id,n.payload existing_payload,
        max(nullif(btrim(e.customer_name),'')) customer_name,
        upper(coalesce(nullif(e.base_currency_code,''),'MZN')) currency_code,
        count(*)::integer document_count,
        sum(e.outstanding_amount_base)::numeric(18,2) outstanding_amount,
        min(e.due_date) oldest_due_date,
        max(e.due_date) nearest_due_date,
        (min(e.due_date)-p_local_day)::integer bucket_offset_days
      from active_notifications n
      join public.v_customer_receivable_exposures e
        on e.company_id=p_company_id
       and e.customer_id::text=nullif(n.payload->>'customerId','')
       and upper(coalesce(nullif(e.base_currency_code,''),'MZN'))=
           upper(coalesce(n.payload->>'currencyCode','MZN'))
       and e.due_date is not null
       and e.outstanding_amount_base>0.005
       and not e.collections_suppressed
       and case when jsonb_typeof(n.payload->'exposureChainIds')='array' then
         jsonb_array_length(n.payload->'exposureChainIds')=0
         or exists(
           select 1
           from jsonb_array_elements_text(n.payload->'exposureChainIds') chain(value)
           where chain.value=e.exposure_chain_id::text
         )
       else true end
      group by
        n.id,
        n.payload,
        upper(coalesce(nullif(e.base_currency_code,''),'MZN'))
    )
    select refreshed_row.*,
      coalesce(c.unapplied_credit_base,0::numeric)::numeric(18,2) unallocated_customer_credit
    from refreshed refreshed_row
    left join public.v_customer_unapplied_credit c
      on c.company_id=p_company_id
     and c.customer_id::text=nullif(refreshed_row.existing_payload->>'customerId','')
     and upper(c.currency_code)=refreshed_row.currency_code
  loop
    if a.bucket_offset_days>0 then
      v_event_type:='receivables.due_soon';
      v_severity:=case when a.bucket_offset_days<=1 then 'warning' else 'info' end;
      v_title:='Payments due soon';
    elsif a.bucket_offset_days=0 then
      v_event_type:='receivables.due_today';
      v_severity:='warning';
      v_title:='Due today';
    elsif a.bucket_offset_days<=-15 then
      v_event_type:='receivables.severely_overdue';
      v_severity:='critical';
      v_title:='Customer severely overdue';
    else
      v_event_type:='receivables.overdue';
      v_severity:='warning';
      v_title:='Customer overdue';
    end if;

    v_payload:=coalesce(a.existing_payload,'{}'::jsonb)||jsonb_build_object(
      'customerName',coalesce(a.customer_name,a.existing_payload->>'customerName','Customer'),
      'documentCount',a.document_count,
      'outstandingAmount',a.outstanding_amount,
      'currencyCode',a.currency_code,
      'bucketOffsetDays',a.bucket_offset_days,
      'nearestDueDate',a.nearest_due_date,
      'oldestDueDate',a.oldest_due_date,
      'businessDate',p_local_day,
      'unallocatedCustomerCredit',a.unallocated_customer_credit
    );
    v_body:=format(
      '%s has %s open receivable document%s totalling %s %s.',
      coalesce(a.customer_name,a.existing_payload->>'customerName','Customer'),a.document_count,
      case when a.document_count=1 then '' else 's' end,
      a.currency_code,a.outstanding_amount
    );

    update public.notifications
    set level=v_severity,title=v_title,body=v_body,meta=v_payload,
      event_type=v_event_type,payload=v_payload,severity=v_severity
    where id=a.id;
    v_refreshed_count:=v_refreshed_count+1;
  end loop;

  -- Resolve only when the customer/currency exposure has actually cleared or
  -- become collection-suppressed, the recipient is no longer eligible, or a
  -- newer configured bucket for that same context was emitted. History stays.
  update public.notifications n
  set resolved_at=now()
  where n.company_id=p_company_id
    and n.category='receivables'
    and n.event_type in (
      'receivables.due_soon','receivables.due_today',
      'receivables.overdue','receivables.severely_overdue'
    )
    and n.resolved_at is null
    and (
      not exists(
        select 1 from public.company_members cm
        where cm.company_id=n.company_id and cm.user_id=n.user_id
          and cm.status='active'
          and cm.role=any(array['OWNER','ADMIN','MANAGER']::public.member_role[])
      )
      or exists(
        select 1 from public.notification_preferences np
        where np.company_id=n.company_id and np.user_id=n.user_id
          and np.category='receivables' and np.in_app_mode='off'
      )
      or not exists(
        select 1 from public.v_customer_receivable_exposures e
        where e.company_id=n.company_id
          and e.customer_id::text=nullif(n.payload->>'customerId','')
          and upper(coalesce(nullif(e.base_currency_code,''),'MZN'))=upper(coalesce(n.payload->>'currencyCode','MZN'))
          and e.outstanding_amount_base>0.005
          and not e.collections_suppressed
          and case when jsonb_typeof(n.payload->'exposureChainIds')='array' then
            jsonb_array_length(n.payload->'exposureChainIds')=0
            or exists(
              select 1
              from jsonb_array_elements_text(n.payload->'exposureChainIds') chain(value)
              where chain.value=e.exposure_chain_id::text
            )
          else true end
      )
      or (
        ((n.payload->>'customerId')||':'||upper(coalesce(n.payload->>'currencyCode','MZN'))||':'||n.user_id::text)=any(v_active_contexts)
        and (n.deduplication_key||':'||n.user_id::text)<>all(v_active_keys)
      )
    );
  get diagnostics v_resolved_count=row_count;

  return jsonb_build_object(
    'companyId',p_company_id,
    'businessDate',p_local_day,
    'timezone',p_timezone,
    'groups',v_group_count,
    'notificationsEvaluated',v_notification_count,
    'notificationsRefreshed',v_refreshed_count,
    'resolved',v_resolved_count
  );
end
$$;

create or replace function public.run_receivable_internal_alert_scheduler(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  r record;
  v_timezone text;
  v_local_timestamp timestamp;
  v_local_day date;
  v_send_text text;
  v_send_time time;
  v_scheduled_local timestamp;
  v_offsets integer[];
  v_offsets_defaulted boolean:=false;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_evaluated integer:=0;
  v_skipped integer:=0;
begin
  for r in
    select cs.company_id,coalesce(cs.data,'{}'::jsonb) settings
    from public.company_settings cs
    where lower(coalesce(cs.data#>>'{dueReminders,internalAlertsEnabled}','false'))
      in ('true','1','yes','on')
  loop
    v_timezone:=coalesce(nullif(btrim(r.settings#>>'{dueReminders,timezone}'),''),'Africa/Maputo');
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'companyId',r.company_id,'skipped','invalid_timezone','timezone',v_timezone
      ));
      v_skipped:=v_skipped+1;
      continue;
    end if;

    v_local_timestamp:=p_now at time zone v_timezone;
    v_local_day:=v_local_timestamp::date;
    v_send_text:=coalesce(nullif(btrim(r.settings#>>'{dueReminders,sendAt}'),''),'09:00');
    begin
      if v_send_text!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'invalid';
      end if;
      v_send_time:=v_send_text::time;
    exception when others then
      v_send_time:='09:00'::time;
    end;
    v_scheduled_local:=v_local_day+v_send_time;
    if v_local_timestamp<v_scheduled_local
       or v_local_timestamp>=v_scheduled_local+interval '1 hour' then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    v_offsets:=null;
    v_offsets_defaulted:=false;
    begin
      if jsonb_typeof(coalesce(r.settings#>'{dueReminders,leadDays}','[3,1,0,-3]'::jsonb))<>'array' then
        raise exception 'invalid_offsets';
      end if;
      select array_agg(value order by case when value>0 then 0 when value=0 then 1 else 2 end,
        case when value>0 then -value else abs(value) end)
      into v_offsets
      from (
        select distinct raw_value::integer value
        from jsonb_array_elements_text(
          coalesce(r.settings#>'{dueReminders,leadDays}','[3,1,0,-3]'::jsonb)
        ) source(raw_value)
        where raw_value~'^-?[0-9]+$' and raw_value::integer between -365 and 365
        limit 24
      ) offsets;
      if coalesce(array_length(v_offsets,1),0)=0 then raise exception 'invalid_offsets'; end if;
    exception when others then
      v_offsets:=array[3,1,0,-3];
      v_offsets_defaulted:=true;
    end;

    begin
      v_result:=public.evaluate_receivable_internal_alerts(
        r.company_id,v_local_day,v_timezone,v_offsets
      );
      if v_offsets_defaulted then
        v_result:=v_result||jsonb_build_object('scheduleOffsetsDefaulted',true);
      end if;
      v_results:=v_results||jsonb_build_array(v_result);
      v_evaluated:=v_evaluated+1;
    exception when others then
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'companyId',r.company_id,'businessDate',v_local_day,
        'skipped','evaluation_failed','sqlstate',sqlstate
      ));
      v_skipped:=v_skipped+1;
    end;
  end loop;

  return jsonb_build_object(
    'evaluatedCompanies',v_evaluated,
    'skippedCompanies',v_skipped,
    'results',v_results
  );
end
$$;

alter function public.evaluate_receivable_internal_alerts(uuid,date,text,integer[]) owner to postgres;
alter function public.run_receivable_internal_alert_scheduler(timestamptz) owner to postgres;
revoke all on function public.evaluate_receivable_internal_alerts(uuid,date,text,integer[]) from public,anon,authenticated;
revoke all on function public.run_receivable_internal_alert_scheduler(timestamptz) from public,anon,authenticated;
grant execute on function public.evaluate_receivable_internal_alerts(uuid,date,text,integer[]) to service_role;
grant execute on function public.run_receivable_internal_alert_scheduler(timestamptz) to service_role;

comment on function public.evaluate_receivable_internal_alerts(uuid,date,text,integer[]) is
  'Emits user-targeted, customer/currency/bucket receivables alerts from v_customer_receivable_exposures without netting unapplied credit.';
comment on function public.run_receivable_internal_alert_scheduler(timestamptz) is
  'Runs enabled internal receivables alerts in each company timezone, independently of customer email reminders and Brevo.';

-- Fifteen-minute polling preserves minute-aware company schedules. The
-- evaluator deduplicates each company/user/business-date bucket, so overlapping
-- retries cannot create a second alert.
select cron.schedule(
  'stockwise-receivables-internal-alerts',
  '*/15 * * * *',
  'select public.run_receivable_internal_alert_scheduler();'
);
