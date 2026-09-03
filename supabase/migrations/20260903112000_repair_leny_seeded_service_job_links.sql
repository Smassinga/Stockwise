do $$
declare
  v_company_id uuid;
  v_actor_id uuid;
  v_target_count integer;
  v_inserted_count integer;
begin
  select c.id
    into v_company_id
  from public.companies c
  where c.name = 'Leny Doçuras'
    and exists (
      select 1
      from public.company_members cm
      where cm.company_id = c.id
        and lower(cm.email) = 'massingasamuel@hotmail.com'
        and cm.status = 'active'
    )
  order by c.created_at desc nulls last
  limit 1;

  if v_company_id is null then
    return;
  end if;

  select cm.user_id
    into v_actor_id
  from public.company_members cm
  where cm.company_id = v_company_id
    and lower(cm.email) = 'massingasamuel@hotmail.com'
    and cm.status = 'active'
  limit 1;

  if v_actor_id is null then
    raise exception 'leny_service_job_repair_actor_missing';
  end if;

  select count(*)
    into v_target_count
  from public.service_jobs sj
  where sj.company_id = v_company_id
    and sj.job_reference like 'LEN-SVC-%'
    and sj.sales_order_id is not null
    and not exists (
      select 1
      from public.service_job_lines sjl
      where sjl.service_job_id = sj.id
        and sjl.active_link
    );

  with target_jobs as (
    select
      sj.id as service_job_id,
      sj.sales_order_id,
      sj.created_at as job_created_at
    from public.service_jobs sj
    where sj.company_id = v_company_id
      and sj.job_reference like 'LEN-SVC-%'
      and sj.sales_order_id is not null
      and not exists (
        select 1
        from public.service_job_lines sjl
        where sjl.service_job_id = sj.id
          and sjl.active_link
      )
  ), eligible_lines as (
    select
      tj.service_job_id,
      tj.job_created_at,
      sol.id as sales_order_line_id,
      sol.item_id as service_item_id,
      coalesce(nullif(btrim(sol.description), ''), i.name) as description_snapshot,
      sol.qty as commercial_quantity,
      count(*) over (partition by tj.service_job_id) as candidate_count
    from target_jobs tj
    join public.sales_order_lines sol
      on sol.company_id = v_company_id
     and sol.so_id = tj.sales_order_id
    join public.items i
      on i.company_id = v_company_id
     and i.id = sol.item_id
     and i.primary_role = 'service'
  ), inserted as (
    insert into public.service_job_lines (
      company_id,
      service_job_id,
      sales_order_line_id,
      service_item_id,
      description_snapshot,
      billing_basis,
      commercial_quantity,
      created_at,
      active_link
    )
    select
      v_company_id,
      el.service_job_id,
      el.sales_order_line_id,
      el.service_item_id,
      el.description_snapshot,
      'per_job',
      el.commercial_quantity,
      el.job_created_at,
      true
    from eligible_lines el
    where el.candidate_count = 1
      and not exists (
        select 1
        from public.service_job_lines existing
        where existing.sales_order_line_id = el.sales_order_line_id
          and existing.active_link
      )
    on conflict (service_job_id, sales_order_line_id) do nothing
    returning service_job_id, sales_order_line_id
  )
  insert into public.service_job_events (
    company_id,
    service_job_id,
    event_type,
    occurred_at,
    actor_id,
    reason,
    metadata
  )
  select
    v_company_id,
    inserted.service_job_id,
    'sales_order_line_link_repaired',
    now(),
    v_actor_id,
    'Repair missing historical Service Job line link from the Leny six-month QA seed.',
    jsonb_build_object('salesOrderLineId', inserted.sales_order_line_id, 'repairScope', 'leny_busy_company_seed')
  from inserted;

  get diagnostics v_inserted_count = row_count;

  if exists (
    select 1
    from public.service_jobs sj
    where sj.company_id = v_company_id
      and sj.job_reference like 'LEN-SVC-%'
      and sj.sales_order_id is not null
      and not exists (
        select 1
        from public.service_job_lines sjl
        where sjl.service_job_id = sj.id
          and sjl.active_link
      )
  ) then
    raise exception 'leny_service_job_repair_incomplete';
  end if;

  if v_target_count > 0 and v_inserted_count <> v_target_count then
    raise exception 'leny_service_job_repair_count_mismatch target %, repaired %', v_target_count, v_inserted_count;
  end if;
end
$$;