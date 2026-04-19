create or replace function public.cash_summary(p_company uuid, p_from date, p_to date)
 returns table(beginning numeric, inflows numeric, outflows numeric, net numeric, ending numeric)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
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
    select
      p_company as company_id,
      p_from::date as dfrom,
      (p_to::date + interval '1 day')::date as dto_ex
  ),
  opening as (
    select (
      coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at < (select p.dfrom from params p)
      ), 0)
      + coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at = (select p.dfrom from params p)
          and ct.type = 'adjustment'
          and ct.memo ilike 'Opening balance%'
      ), 0)
    )::numeric as opening_balance
  ),
  inrange as (
    select ct.*
    from public.cash_transactions ct
    where ct.company_id = (select p.company_id from params p)
      and ct.happened_at >= (select p.dfrom from params p)
      and ct.happened_at < (select p.dto_ex from params p)
      and not (
        ct.happened_at = (select p.dfrom from params p)
        and ct.type = 'adjustment'
        and ct.memo ilike 'Opening balance%'
      )
  ),
  agg as (
    select
      coalesce(sum(case when ir.type = 'sale_receipt' then ir.amount_base else 0 end), 0)::numeric as inflows_amount,
      coalesce(sum(case when ir.type = 'purchase_payment' then abs(ir.amount_base) else 0 end), 0)::numeric as outflows_amount,
      coalesce(sum(ir.amount_base), 0)::numeric as delta_all
    from inrange ir
  )
  select
    o.opening_balance as beginning,
    a.inflows_amount as inflows,
    a.outflows_amount as outflows,
    (a.inflows_amount - a.outflows_amount)::numeric as net,
    (o.opening_balance + a.delta_all)::numeric as ending
  from opening o
  cross join agg a;
end
$function$;

create or replace function public.cash_ledger(p_company uuid, p_from date, p_to date)
 returns table(id uuid, happened_at date, type text, ref_type text, ref_id uuid, memo text, amount_base numeric, running_balance numeric)
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
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
    select
      p_company as company_id,
      p_from::date as dfrom,
      (p_to::date + interval '1 day')::date as dto_ex
  ),
  opening as (
    select (
      coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at < (select p.dfrom from params p)
      ), 0)
      + coalesce((
        select coalesce(sum(ct.amount_base), 0)
        from public.cash_transactions ct
        where ct.company_id = (select p.company_id from params p)
          and ct.happened_at = (select p.dfrom from params p)
          and ct.type = 'adjustment'
          and ct.memo ilike 'Opening balance%'
      ), 0)
    )::numeric as opening_balance
  ),
  tx as (
    select
      ct.id as tx_id,
      ct.happened_at::date as tx_happened_at,
      ct.type::text as tx_type,
      ct.ref_type::text as tx_ref_type,
      ct.ref_id::uuid as tx_ref_id,
      ct.memo as tx_memo,
      ct.amount_base as tx_amount_base,
      ct.created_at as tx_created_at
    from public.cash_transactions ct
    where ct.company_id = (select p.company_id from params p)
      and ct.happened_at >= (select p.dfrom from params p)
      and ct.happened_at < (select p.dto_ex from params p)
      and not (
        ct.happened_at = (select p.dfrom from params p)
        and ct.type = 'adjustment'
        and ct.memo ilike 'Opening balance%'
      )
  ),
  tx_running as (
    select
      t.tx_id,
      t.tx_happened_at,
      t.tx_type,
      t.tx_ref_type,
      t.tx_ref_id,
      t.tx_memo,
      t.tx_amount_base,
      (
        (select o.opening_balance from opening o)
        + sum(t.tx_amount_base) over (
            order by t.tx_happened_at, t.tx_created_at, t.tx_id
            rows between unbounded preceding and current row
          )
      )::numeric as tx_running_balance,
      t.tx_created_at
    from tx t
  ),
  opening_row as (
    select
      null::uuid as row_id,
      (select p.dfrom from params p) as row_happened_at,
      'opening'::text as row_type,
      null::text as row_ref_type,
      null::uuid as row_ref_id,
      'Opening balance'::text as row_memo,
      0::numeric as row_amount_base,
      (select o.opening_balance from opening o)::numeric as row_running_balance,
      '00000000-0000-0000-0000-000000000000'::uuid as sort_id,
      'epoch'::timestamp as sort_ts
  ),
  detail_rows as (
    select
      r.tx_id as row_id,
      r.tx_happened_at as row_happened_at,
      r.tx_type as row_type,
      r.tx_ref_type as row_ref_type,
      r.tx_ref_id as row_ref_id,
      r.tx_memo as row_memo,
      r.tx_amount_base as row_amount_base,
      r.tx_running_balance as row_running_balance,
      r.tx_id as sort_id,
      r.tx_created_at as sort_ts
    from tx_running r
  )
  select
    u.row_id as id,
    u.row_happened_at as happened_at,
    u.row_type as type,
    u.row_ref_type as ref_type,
    u.row_ref_id as ref_id,
    u.row_memo as memo,
    u.row_amount_base as amount_base,
    u.row_running_balance as running_balance
  from (
    select * from opening_row
    union all
    select * from detail_rows
  ) u
  order by u.row_happened_at, u.sort_ts, u.sort_id;
end
$function$;
