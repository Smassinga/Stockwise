-- Keep cash and customers without a collections control readable in the
-- receivables report. A lateral join condition does not guarantee that
-- PostgreSQL will avoid evaluating the resolver with null anchor arguments.
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
    select case
      when ctrl.id is null then null::date
      else (public.ar_resolve_exposure_anchor(p_company_id,ctrl.active_anchor_kind,ctrl.active_anchor_id)->>'due_date')::date
    end due_date
  )anchor on true;
  return jsonb_set(v_result,'{rows}',coalesce(v_rows,'[]'),true);
end $$;

alter function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) owner to postgres;
revoke all on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) from public,anon;
grant execute on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) to authenticated;

comment on function public.get_operational_report(uuid,text,date,date,uuid,uuid,boolean,integer) is
  'Returns authoritative operational reports and null-safe collections context for receivables rows.';
