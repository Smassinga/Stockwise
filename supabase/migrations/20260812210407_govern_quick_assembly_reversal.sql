alter table public.builds
  add column if not exists status text not null default 'posted',
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id) on delete set null,
  add column if not exists reversal_reason text;

alter table public.builds
  drop constraint if exists builds_status_check;

alter table public.builds
  add constraint builds_status_check check (status in ('posted', 'reversed'));

create index if not exists builds_company_status_created_idx
  on public.builds(company_id, status, created_at desc);

create or replace function public.reverse_build(
  p_build_id uuid,
  p_reason text,
  p_request_key text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company_id uuid := public.current_company_id();
  v_request_key text := nullif(btrim(coalesce(p_request_key, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payload_hash text;
  v_request public.posting_requests%rowtype;
  v_build public.builds%rowtype;
  v_issue_count integer;
  v_receive_count integer;
  v_reversal_movement_id uuid;
  r public.stock_movements%rowtype;
begin
  if v_company_id is null then
    raise exception 'No active company selected' using errcode = '42501';
  end if;

  if v_request_key is null then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'reversal_reason_required' using errcode = '22023';
  end if;

  if not public.has_company_role(
    v_company_id,
    array['OWNER','ADMIN','MANAGER']::public.member_role[]
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'company_id', v_company_id,
    'build_id', p_build_id,
    'reason', v_reason
  )::text);

  loop
    begin
      insert into public.posting_requests (
        company_id,
        operation_type,
        request_key,
        payload_hash,
        status,
        created_by,
        expires_at
      ) values (
        v_company_id,
        'assembly.build.reverse',
        v_request_key,
        v_payload_hash,
        'in_progress',
        auth.uid(),
        now() + interval '180 days'
      )
      returning * into v_request;
      exit;
    exception when unique_violation then
      select *
        into v_request
      from public.posting_requests pr
      where pr.company_id = v_company_id
        and pr.operation_type = 'assembly.build.reverse'
        and pr.request_key = v_request_key
      for update;

      if not found then
        continue;
      end if;

      if v_request.payload_hash is distinct from v_payload_hash then
        raise exception 'idempotency_key_payload_mismatch' using errcode = '22023';
      end if;

      if v_request.status = 'succeeded' then
        if v_request.result_ref_id is null then
          raise exception 'idempotency_result_missing' using errcode = 'P0001';
        end if;
        return v_request.result_ref_id::uuid;
      elsif v_request.status = 'in_progress' then
        raise exception 'request_in_progress' using errcode = '55P03';
      else
        raise exception 'idempotency_request_failed_use_new_key' using errcode = 'P0001';
      end if;
    end;
  end loop;

  select *
    into v_build
  from public.builds b
  where b.id = p_build_id
    and b.company_id = v_company_id
  for update;

  if not found then
    raise exception 'build_not_found' using errcode = 'P0002';
  end if;

  if v_build.status <> 'posted' then
    raise exception 'build_not_reversible_status_%', v_build.status using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.stock_movements sm
    where sm.company_id = v_company_id
      and sm.ref_type = 'BUILD_REVERSAL'
      and sm.ref_id = p_build_id::text
  ) then
    raise exception 'build_already_reversed' using errcode = '22023';
  end if;

  select
    count(*) filter (where sm.type = 'issue'),
    count(*) filter (where sm.type = 'receive')
    into v_issue_count, v_receive_count
  from public.stock_movements sm
  where sm.company_id = v_company_id
    and sm.ref_type = 'BUILD'
    and sm.ref_id = p_build_id::text;

  if coalesce(v_issue_count, 0) = 0 or coalesce(v_receive_count, 0) = 0 then
    raise exception 'build_original_movements_missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.stock_movements sm
    where sm.company_id = v_company_id
      and sm.ref_type = 'BUILD'
      and sm.ref_id = p_build_id::text
      and sm.type not in ('issue', 'receive')
  ) then
    raise exception 'build_original_movements_invalid' using errcode = 'P0001';
  end if;

  -- Remove every finished-output receipt first. The existing stock rollup trigger
  -- atomically blocks the whole transaction if any original output bucket no
  -- longer contains enough stock to reverse safely.
  for r in
    select sm.*
    from public.stock_movements sm
    where sm.company_id = v_company_id
      and sm.ref_type = 'BUILD'
      and sm.ref_id = p_build_id::text
      and sm.type = 'receive'
    order by sm.created_at, sm.id
  loop
    insert into public.stock_movements (
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
      notes, ref_type, ref_id, ref_line_id, created_by
    ) values (
      v_company_id, 'issue', r.item_id, r.uom_id, r.qty, r.qty_base,
      r.unit_cost, r.total_value,
      r.warehouse_to_id, r.bin_to_id, null, null,
      'Quick assembly reversal: ' || v_reason,
      'BUILD_REVERSAL', p_build_id::text, r.id, auth.uid()::text
    )
    returning id into v_reversal_movement_id;
  end loop;

  -- Restore each historically consumed component to its original source bucket
  -- using the frozen unit cost carried by the original issue movement.
  for r in
    select sm.*
    from public.stock_movements sm
    where sm.company_id = v_company_id
      and sm.ref_type = 'BUILD'
      and sm.ref_id = p_build_id::text
      and sm.type = 'issue'
    order by sm.created_at, sm.id
  loop
    insert into public.stock_movements (
      company_id, type, item_id, uom_id, qty, qty_base, unit_cost, total_value,
      warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id,
      notes, ref_type, ref_id, ref_line_id, created_by
    ) values (
      v_company_id, 'receive', r.item_id, r.uom_id, r.qty, r.qty_base,
      r.unit_cost, r.total_value,
      null, null, r.warehouse_from_id, r.bin_from_id,
      'Quick assembly reversal: ' || v_reason,
      'BUILD_REVERSAL', p_build_id::text, r.id, auth.uid()::text
    )
    returning id into v_reversal_movement_id;
  end loop;

  update public.builds
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = auth.uid(),
         reversal_reason = v_reason
   where id = p_build_id
     and company_id = v_company_id;

  update public.posting_requests
     set status = 'succeeded',
         result_ref_type = 'BUILD_REVERSAL',
         result_ref_id = p_build_id::text,
         result_payload = jsonb_build_object(
           'build_id', p_build_id,
           'status', 'reversed',
           'reason', v_reason
         ),
         error_code = null,
         error_message = null,
         updated_at = now()
   where id = v_request.id;

  return p_build_id;
end;
$$;

alter function public.reverse_build(uuid, text, text) owner to postgres;
revoke all on function public.reverse_build(uuid, text, text) from public, anon;
grant execute on function public.reverse_build(uuid, text, text) to authenticated, service_role;

comment on function public.reverse_build(uuid, text, text) is
  'Governed idempotent MANAGER+ reversal of a posted Quick Assembly build using append-only compensating stock movements at original historical costs.';
