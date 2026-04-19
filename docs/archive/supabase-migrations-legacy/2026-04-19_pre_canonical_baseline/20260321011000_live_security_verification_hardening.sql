CREATE OR REPLACE FUNCTION public.current_user_company_ids()
 RETURNS uuid[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET row_security TO 'off'
AS $function$
  select coalesce(array_agg(cm.company_id), '{}')
  from public.company_members cm
  where cm.user_id = auth.uid()
    and cm.status = 'active'::member_status;
$function$;

CREATE OR REPLACE FUNCTION public.auth_company_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select cm.company_id
  from public.company_members cm
  where (
      (cm.user_id is not null and cm.user_id = auth.uid())
      or (
        cm.user_id is null
        and cm.email is not null
        and exists (
          select 1
          from auth.users u
          where u.id = auth.uid()
            and lower(u.email) = lower(cm.email)
        )
      )
    )
    and cm.status = 'active'::member_status;
$function$;

CREATE OR REPLACE FUNCTION public.current_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select uac.company_id
  from public.user_active_company uac
  join public.company_members cm
    on cm.company_id = uac.company_id
   and cm.user_id = uac.user_id
   and cm.status = 'active'::member_status
  where uac.user_id = auth.uid()
  order by uac.updated_at desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.active_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  with primary_source as (
    select uac.company_id
    from public.user_active_company uac
    join public.company_members cm
      on cm.company_id = uac.company_id
     and cm.user_id = uac.user_id
     and cm.status = 'active'::member_status
    where uac.user_id = auth.uid()
    order by uac.updated_at desc
    limit 1
  ),
  fallback as (
    select cm.company_id
    from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
    order by cm.role asc, cm.created_at asc
    limit 1
  )
  select coalesce(
    (select company_id from primary_source),
    (select company_id from fallback)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_member_of_company(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.status = 'active'::member_status
      and (
        m.user_id = auth.uid()
        or lower(m.email) = lower(coalesce((auth.jwt() ->> 'email')::text, ''))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_company_member(target_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select exists (
    select 1
    from public.company_members cm
    where cm.company_id = target_company
      and cm.user_id = auth.uid()
      and cm.status = 'active'::member_status
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_company_role(cid uuid, p_roles member_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  select exists(
    select 1
    from public.company_members m
    where m.company_id = cid
      and m.user_id = auth.uid()
      and m.status = 'active'::member_status
      and m.role = any(p_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.bank_account_balances(p_company uuid)
 RETURNS TABLE(bank_id uuid, balance_base numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select ba.id as bank_id, coalesce(sum(t.amount_base), 0) as balance_base
  from public.bank_accounts ba
  left join public.bank_transactions t
    on t.bank_id = ba.id
  where ba.company_id = p_company
  group by ba.id
  order by ba.id;
end
$function$;

CREATE OR REPLACE FUNCTION public.cash_get_book(p_company uuid)
 RETURNS TABLE(id uuid, company_id uuid, beginning_balance_base numeric, beginning_as_of date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select b.id, b.company_id, b.beginning_balance_base, b.beginning_as_of::date
  from public.cash_books b
  where b.company_id = p_company
  order by b.beginning_as_of desc
  limit 1;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_book(p_company uuid)
 RETURNS TABLE(id uuid, company_id uuid, beginning_balance_base numeric, beginning_as_of date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select id, company_id, beginning_balance_base, beginning_as_of
  from public.cash_books
  where company_id = p_company
  order by beginning_as_of desc
  limit 1;
end
$function$;

CREATE OR REPLACE FUNCTION public.cash_summary(p_company uuid, p_from date, p_to date)
 RETURNS TABLE(beginning numeric, inflows numeric, outflows numeric, net numeric, ending numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  with params as (
    select p_company as company_id,
           p_from::date as dfrom,
           (p_to::date + interval '1 day')::date as dto_ex
  ),
  opening as (
    select coalesce((
             select coalesce(sum(ct.amount_base), 0)
             from public.cash_transactions ct
             where ct.company_id = (select company_id from params)
               and ct.happened_at < (select dfrom from params)
           ), 0)
         + coalesce((
             select coalesce(sum(ct.amount_base), 0)
             from public.cash_transactions ct
             where ct.company_id = (select company_id from params)
               and ct.happened_at = (select dfrom from params)
               and ct.type = 'adjustment'
               and ct.memo ilike 'Opening balance%'
           ), 0) as beginning
  ),
  inrange as (
    select *
    from public.cash_transactions ct
    where ct.company_id = (select company_id from params)
      and ct.happened_at >= (select dfrom from params)
      and ct.happened_at <  (select dto_ex from params)
      and not (
        ct.happened_at = (select dfrom from params)
        and ct.type = 'adjustment'
        and ct.memo ilike 'Opening balance%'
      )
  ),
  agg as (
    select
      coalesce(sum(case when type = 'sale_receipt' then amount_base else 0 end), 0) as inflows,
      coalesce(sum(case when type = 'purchase_payment' then abs(amount_base) else 0 end), 0) as outflows,
      coalesce(sum(amount_base), 0) as delta_all
    from inrange
  )
  select
    (select beginning from opening) as beginning,
    agg.inflows as inflows,
    agg.outflows as outflows,
    (agg.inflows - agg.outflows) as net,
    (select beginning from opening) + agg.delta_all as ending
  from agg;
end
$function$;

CREATE OR REPLACE FUNCTION public.cash_ledger(p_company uuid, p_from date, p_to date)
 RETURNS TABLE(id uuid, happened_at date, type text, ref_type text, ref_id uuid, memo text, amount_base numeric, running_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  with params as (
    select p_company as company_id,
           p_from::date as dfrom,
           (p_to::date + interval '1 day')::date as dto_ex
  ),
  opening as (
    select coalesce((
             select coalesce(sum(ct.amount_base), 0)
             from public.cash_transactions ct
             where ct.company_id = (select company_id from params)
               and ct.happened_at < (select dfrom from params)
           ), 0)
         + coalesce((
             select coalesce(sum(ct.amount_base), 0)
             from public.cash_transactions ct
             where ct.company_id = (select company_id from params)
               and ct.happened_at = (select dfrom from params)
               and ct.type = 'adjustment'
               and ct.memo ilike 'Opening balance%'
           ), 0) as beginning
  ),
  tx as (
    select
      ct.id,
      ct.happened_at::date,
      ct.type::text,
      ct.ref_type::text,
      ct.ref_id::uuid,
      ct.memo,
      ct.amount_base,
      ct.created_at
    from public.cash_transactions ct
    where ct.company_id = (select company_id from params)
      and ct.happened_at >= (select dfrom from params)
      and ct.happened_at <  (select dto_ex from params)
      and not (
        ct.happened_at = (select dfrom from params)
        and ct.type = 'adjustment'
        and ct.memo ilike 'Opening balance%'
      )
  ),
  tx_running as (
    select
      t.*,
      ((select beginning from opening)
        + sum(t.amount_base) over (
            order by t.happened_at, t.created_at, t.id
            rows between unbounded preceding and current row
          )
      )::numeric as running_balance
    from tx t
  ),
  opening_row as (
    select
      null::uuid as id,
      (select dfrom from params) as happened_at,
      'opening'::text as type,
      null::text as ref_type,
      null::uuid as ref_id,
      'Opening balance'::text as memo,
      0::numeric as amount_base,
      (select beginning from opening)::numeric as running_balance,
      '00000000-0000-0000-0000-000000000000'::uuid as sort_id,
      'epoch'::timestamp as sort_ts
  ),
  detail_rows as (
    select
      r.id,
      r.happened_at,
      r.type,
      r.ref_type,
      r.ref_id,
      r.memo,
      r.amount_base,
      r.running_balance,
      r.id as sort_id,
      r.created_at as sort_ts
    from tx_running r
  )
  select id, happened_at, type, ref_type, ref_id, memo, amount_base, running_balance
  from (
    select * from opening_row
    union all
    select * from detail_rows
  ) u
  order by happened_at, sort_ts, sort_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_approvals_queue_raw(p_company uuid)
 RETURNS TABLE(kind text, ref_id uuid, order_no text, status text, total_amount_base numeric, cash_posted_base numeric, balance_due_base numeric, suggested_amount_base numeric, last_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company is distinct from public.current_company_id()
       or not public.is_company_member(auth.uid(), p_company, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::text[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  return query
  select
    'SO'::text as kind,
    s.id as ref_id,
    s.order_no,
    s.status::text as status,
    s.total_amount_base,
    coalesce(s.cash_received_base, 0) as cash_posted_base,
    (s.total_amount_base - coalesce(s.cash_received_base, 0)) as balance_due_base,
    greatest(s.total_amount_base - coalesce(s.cash_received_base, 0), 0) as suggested_amount_base,
    s.last_ship_activity_at as last_activity_at
  from public.v_so_cash_status s
  where s.company_id = p_company
    and (s.total_amount_base - coalesce(s.cash_received_base, 0)) > 0

  union all

  select
    'PO'::text as kind,
    p.id as ref_id,
    p.order_no,
    p.status::text as status,
    p.total_amount_base,
    coalesce(p.cash_paid_base, 0) as cash_posted_base,
    (p.total_amount_base + coalesce(p.cash_paid_base, 0)) as balance_due_base,
    greatest(p.total_amount_base + coalesce(p.cash_paid_base, 0), 0) as suggested_amount_base,
    p.last_receive_activity_at as last_activity_at
  from public.v_po_cash_status p
  where p.company_id = p_company
    and (p.total_amount_base + coalesce(p.cash_paid_base, 0)) > 0

  order by last_activity_at desc nulls last, order_no;
end
$function$;

CREATE OR REPLACE FUNCTION public.update_company_settings(p_company_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_current jsonb;
  v_merged jsonb;
  v_defaults jsonb := public.company_settings_defaults();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or p_company_id is distinct from public.current_company_id()
       or not public.has_company_role(p_company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select data into v_current
  from public.company_settings
  where company_id = p_company_id
  for update;

  v_merged := public.jsonb_deep_merge(v_defaults, public.jsonb_deep_merge(coalesce(v_current, '{}'::jsonb), coalesce(p_patch, '{}'::jsonb)));
  v_merged := jsonb_set(v_merged, '{notifications,recipients,emails}', coalesce((v_merged #> '{notifications,recipients,emails}'), '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,phones}', coalesce((v_merged #> '{notifications,recipients,phones}'), '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,whatsapp}', coalesce((v_merged #> '{notifications,recipients,whatsapp}'), '[]'::jsonb), true);

  if (v_merged #>> '{notifications,dailyDigestTime}') is null then
    v_merged := jsonb_set(v_merged, '{notifications,dailyDigestTime}', to_jsonb('08:00'), true);
  end if;
  if (v_merged #>> '{notifications,timezone}') is null then
    v_merged := jsonb_set(v_merged, '{notifications,timezone}', to_jsonb('Africa/Maputo'), true);
  end if;

  insert into public.company_settings(company_id, data, updated_at)
  values (p_company_id, v_merged, now())
  on conflict (company_id) do update
    set data = excluded.data, updated_at = now()
  returning data into v_merged;

  return v_merged;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_base_currency_for_current_company(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_company_id uuid := public.current_company_id();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or v_company_id is null
       or not public.has_company_role(v_company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  perform 1 from public.currencies where code = p_code;
  if not found then
    raise exception 'Unknown currency code: %', p_code using errcode = '22023';
  end if;

  insert into public.company_settings (company_id, base_currency_code, updated_at, updated_by)
  values (v_company_id, p_code, now(), auth.uid())
  on conflict (company_id) do update
    set base_currency_code = excluded.base_currency_code,
        updated_at = now(),
        updated_by = auth.uid();
end
$function$;

CREATE OR REPLACE FUNCTION public.add_allowed_currency_for_current_company(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_company_id uuid := public.current_company_id();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or v_company_id is null
       or not public.has_company_role(v_company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  insert into public.company_currencies(company_id, currency_code)
  values (v_company_id, p_code)
  on conflict do nothing;
end
$function$;

CREATE OR REPLACE FUNCTION public.remove_allowed_currency_for_current_company(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_company_id uuid := public.current_company_id();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null
       or v_company_id is null
       or not public.has_company_role(v_company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  delete from public.company_currencies
  where company_id = v_company_id
    and currency_code = p_code;
end
$function$;

DROP POLICY IF EXISTS notifications_select_all ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_all ON public.notifications;
DROP POLICY IF EXISTS notifications_update_all ON public.notifications;
DROP POLICY IF EXISTS notifications_delete_all ON public.notifications;
DROP POLICY IF EXISTS "read company notifications" ON public.notifications;
DROP POLICY IF EXISTS "mark notifications read" ON public.notifications;
DROP POLICY IF EXISTS notifications_read_company ON public.notifications;

CREATE POLICY notifications_select_active_company
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

CREATE POLICY notifications_mark_read_active_company
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (user_id = auth.uid() OR user_id IS NULL)
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

DROP POLICY IF EXISTS company_settings_upsert_v2 ON public.company_settings;
DROP POLICY IF EXISTS merged_insert ON public.company_settings;
DROP POLICY IF EXISTS merged_update ON public.company_settings;
DROP POLICY IF EXISTS merged_select ON public.company_settings;
DROP POLICY IF EXISTS select_by_membership ON public.company_settings;
DROP POLICY IF EXISTS _delete_delete ON public.company_settings;

CREATE POLICY company_settings_select_active_company
  ON public.company_settings
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY company_settings_insert_manager_plus
  ON public.company_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coalesce(company_id, public.current_company_id()) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY company_settings_update_manager_plus
  ON public.company_settings
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY company_settings_delete_manager_plus
  ON public.company_settings
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

DROP POLICY IF EXISTS cc_delete_in_company ON public.company_currencies;
DROP POLICY IF EXISTS cc_insert_in_company ON public.company_currencies;
DROP POLICY IF EXISTS cc_update_in_company ON public.company_currencies;
DROP POLICY IF EXISTS company_currencies_select_v2 ON public.company_currencies;
DROP POLICY IF EXISTS company_currencies_write_v2 ON public.company_currencies;

CREATE POLICY company_currencies_select_active_company
  ON public.company_currencies
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY company_currencies_insert_operator_plus
  ON public.company_currencies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coalesce(company_id, public.current_company_id()) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

CREATE POLICY company_currencies_update_operator_plus
  ON public.company_currencies
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

CREATE POLICY company_currencies_delete_operator_plus
  ON public.company_currencies
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

DROP POLICY IF EXISTS fx_delete_in_company ON public.fx_rates;
DROP POLICY IF EXISTS fx_insert_in_company ON public.fx_rates;
DROP POLICY IF EXISTS fx_update_in_company ON public.fx_rates;
DROP POLICY IF EXISTS fx_write_all ON public.fx_rates;
DROP POLICY IF EXISTS merged_select ON public.fx_rates;

CREATE POLICY fx_rates_select_active_company
  ON public.fx_rates
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY fx_rates_insert_operator_plus
  ON public.fx_rates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coalesce(company_id, public.current_company_id()) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

CREATE POLICY fx_rates_update_operator_plus
  ON public.fx_rates
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

CREATE POLICY fx_rates_delete_operator_plus
  ON public.fx_rates
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

DROP POLICY IF EXISTS uom_conversions_select ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_insert ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_update ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_delete ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_select_own_company ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_insert_own_company ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_update_own_company ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_delete_own_company ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_ins ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_upd ON public.uom_conversions;
DROP POLICY IF EXISTS uom_conversions_del ON public.uom_conversions;
DROP POLICY IF EXISTS uomc_select ON public.uom_conversions;

CREATE POLICY uom_conversions_select_scoped
  ON public.uom_conversions
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NULL
    OR company_id = public.current_company_id()
  );

CREATE POLICY uom_conversions_insert_operator_plus
  ON public.uom_conversions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

CREATE POLICY uom_conversions_update_operator_plus
  ON public.uom_conversions
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

CREATE POLICY uom_conversions_delete_operator_plus
  ON public.uom_conversions
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR']::member_role[])
  );

DROP POLICY IF EXISTS bank_accounts_insert ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_update ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_delete ON public.bank_accounts;
DROP POLICY IF EXISTS bank_accounts_write ON public.bank_accounts;

CREATE POLICY bank_accounts_insert_manager_plus
  ON public.bank_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    coalesce(company_id, public.current_company_id()) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY bank_accounts_update_manager_plus
  ON public.bank_accounts
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY bank_accounts_delete_manager_plus
  ON public.bank_accounts
  FOR DELETE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

DROP POLICY IF EXISTS tx_insert_members ON public.bank_transactions;
DROP POLICY IF EXISTS tx_update_members ON public.bank_transactions;

CREATE POLICY bank_transactions_insert_active_company
  ON public.bank_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_transactions.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  );

CREATE POLICY bank_transactions_update_active_company
  ON public.bank_transactions
  FOR UPDATE
  TO authenticated
  USING (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_transactions.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  )
  WITH CHECK (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_transactions.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  );

DROP POLICY IF EXISTS stmts_insert_members ON public.bank_statements;
DROP POLICY IF EXISTS stmts_update_members ON public.bank_statements;
DROP POLICY IF EXISTS stmts_delete_unreconciled ON public.bank_statements;

CREATE POLICY bank_statements_insert_active_company
  ON public.bank_statements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_statements.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  );

CREATE POLICY bank_statements_update_active_company
  ON public.bank_statements
  FOR UPDATE
  TO authenticated
  USING (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_statements.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  )
  WITH CHECK (
    exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_statements.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  );

CREATE POLICY bank_statements_delete_active_company
  ON public.bank_statements
  FOR DELETE
  TO authenticated
  USING (
    reconciled = false
    AND exists (
      select 1
      from public.bank_accounts ba
      where ba.id = bank_statements.bank_id
        and ba.company_id = public.current_company_id()
    )
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  );

DROP POLICY IF EXISTS cash_books_select ON public.cash_books;
DROP POLICY IF EXISTS cash_books_insert ON public.cash_books;
DROP POLICY IF EXISTS cash_books_update ON public.cash_books;

CREATE POLICY cash_books_select_active_company
  ON public.cash_books
  FOR SELECT
  TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY cash_books_insert_manager_plus
  ON public.cash_books
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY cash_books_update_manager_plus
  ON public.cash_books
  FOR UPDATE
  TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

DROP POLICY IF EXISTS cash_tx_insert ON public.cash_transactions;

CREATE POLICY cash_transactions_insert_active_company
  ON public.cash_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_company_role(company_id, ARRAY['OWNER','ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[])
  );

DROP POLICY IF EXISTS "Authenticated upload bank statements" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update bank statements" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete bank statements" ON storage.objects;
DROP POLICY IF EXISTS "bank stmts select" ON storage.objects;
DROP POLICY IF EXISTS "bank stmts insert" ON storage.objects;
DROP POLICY IF EXISTS "bank stmts update" ON storage.objects;
DROP POLICY IF EXISTS "bank stmts delete" ON storage.objects;
DROP POLICY IF EXISTS "Give users authenticated access to folder 1l5awph_0" ON storage.objects;
DROP POLICY IF EXISTS "Give users authenticated access to folder 1l5awph_1" ON storage.objects;
DROP POLICY IF EXISTS "Give users authenticated access to folder 1l5awph_2" ON storage.objects;
DROP POLICY IF EXISTS "Give users authenticated access to folder 1l5awph_3" ON storage.objects;
DROP POLICY IF EXISTS "bank-stmts-objects-select" ON storage.objects;
DROP POLICY IF EXISTS "bank-stmts-objects-insert" ON storage.objects;
DROP POLICY IF EXISTS "bank-stmts-objects-delete" ON storage.objects;

CREATE POLICY bank_statements_objects_select_scoped
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'bank-statements'
    AND exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::member_status
      where ba.id = (
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
          else null
        end
      )
        and ba.company_id = public.current_company_id()
    )
  );

CREATE POLICY bank_statements_objects_insert_scoped
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'bank-statements'
    AND exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::member_status
      where ba.id = (
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
          else null
        end
      )
        and ba.company_id = public.current_company_id()
    )
  );

CREATE POLICY bank_statements_objects_update_scoped
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'bank-statements'
    AND exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::member_status
      where ba.id = (
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
          else null
        end
      )
        and ba.company_id = public.current_company_id()
    )
  )
  WITH CHECK (
    bucket_id = 'bank-statements'
    AND exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::member_status
      where ba.id = (
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
          else null
        end
      )
        and ba.company_id = public.current_company_id()
    )
  );

CREATE POLICY bank_statements_objects_delete_scoped
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'bank-statements'
    AND exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::member_status
      where ba.id = (
        case
          when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then split_part(name, '/', 1)::uuid
          else null
        end
      )
        and ba.company_id = public.current_company_id()
    )
  );

DROP POLICY IF EXISTS "Authenticated upload brand logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update brand logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete brand logos" ON storage.objects;

CREATE POLICY brand_logos_insert_scoped
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'brand-logos'
    AND (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY brand_logos_update_scoped
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'brand-logos'
    AND (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  )
  WITH CHECK (
    bucket_id = 'brand-logos'
    AND (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

CREATE POLICY brand_logos_delete_scoped
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'brand-logos'
    AND (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    AND public.has_company_role(public.current_company_id(), ARRAY['OWNER','ADMIN','MANAGER']::member_role[])
  );

REVOKE ALL ON FUNCTION public.build_daily_digest_payload(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_daily_digest_payload(uuid, date, text) TO service_role;

REVOKE ALL ON FUNCTION public.invoke_digest_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_digest_worker() TO service_role;

REVOKE ALL ON FUNCTION public.debug_my_company(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_my_company(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_stock_row(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_stock_row(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.cash_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_summary(uuid, date, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cash_ledger(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_ledger(uuid, date, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.build_from_bom(uuid, numeric, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_from_bom(uuid, numeric, uuid, text, uuid, text) TO authenticated;

REVOKE ALL ON TABLE public.notifications FROM anon;
REVOKE ALL ON TABLE public.company_settings FROM anon;
REVOKE SELECT ON TABLE public.uom_conversions FROM anon;
