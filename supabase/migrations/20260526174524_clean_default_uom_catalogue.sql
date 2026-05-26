set check_function_bodies = off;

drop view if exists public.uom;

create or replace function public.uom_default_catalogue()
returns table(code text, name text, family text, sort_order integer)
language sql
stable
set search_path = pg_catalog, public
as $$
  values
    ('EA', 'Each', 'count', 10),
    ('PCS', 'Pieces', 'count', 20),
    ('PAIR', 'Pair', 'count', 30),
    ('SET', 'Set', 'count', 40),
    ('PACK', 'Pack', 'count', 50),
    ('BOX', 'Box', 'count', 60),
    ('BAG', 'Bag', 'count', 70),
    ('CASE', 'Case', 'count', 80),
    ('CARTON', 'Carton', 'count', 90),
    ('ROLL', 'Roll', 'count', 100),
    ('SHEET', 'Sheet', 'count', 110),
    ('MG', 'Milligram', 'mass', 200),
    ('G', 'Gram', 'mass', 210),
    ('KG', 'Kilogram', 'mass', 220),
    ('T', 'Tonne', 'mass', 230),
    ('MM', 'Millimetre', 'length', 300),
    ('CM', 'Centimetre', 'length', 310),
    ('M', 'Metre', 'length', 320),
    ('KM', 'Kilometre', 'length', 330),
    ('CM2', 'Square centimetre', 'area', 400),
    ('M2', 'Square metre', 'area', 410),
    ('ML', 'Millilitre', 'volume', 500),
    ('L', 'Litre', 'volume', 510),
    ('M3', 'Cubic metre', 'volume', 520),
    ('MIN', 'Minute', 'time', 600),
    ('HOUR', 'Hour', 'time', 610),
    ('DAY', 'Day', 'time', 620),
    ('PALLET', 'Pallet', 'count', 700),
    ('CRATE', 'Crate', 'count', 710),
    ('BUNDLE', 'Bundle', 'count', 720)
$$;

create or replace function public.canonical_uom_code(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_value is null or btrim(p_value) = '' then null
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('EA', 'EACH', 'EACHES') then 'EA'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('PCS', 'PIECE', 'PIECES') then 'PCS'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('PAIR', 'PAIRS') then 'PAIR'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('SET', 'SETS') then 'SET'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('PACK', 'PACKS') then 'PACK'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('BOX', 'BOXES') then 'BOX'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('BAG', 'BAGS') then 'BAG'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('CASE', 'CASES') then 'CASE'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('CARTON', 'CARTONS') then 'CARTON'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('ROLL', 'ROLLS') then 'ROLL'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('SHEET', 'SHEETS') then 'SHEET'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('MG', 'MILLIGRAM', 'MILLIGRAMS') then 'MG'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('G', 'GRAM', 'GRAMS') then 'G'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('KG', 'KILOGRAM', 'KILOGRAMS') then 'KG'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('T', 'TONNE', 'TONNES', 'METRICTON', 'METRICTONNE') then 'T'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('MM', 'MILLIMETRE', 'MILLIMETER', 'MILLIMETRES', 'MILLIMETERS') then 'MM'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('CM', 'CENTIMETRE', 'CENTIMETER', 'CENTIMETRES', 'CENTIMETERS') then 'CM'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('M', 'METRE', 'METER', 'METRES', 'METERS') then 'M'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('KM', 'KILOMETRE', 'KILOMETER', 'KILOMETRES', 'KILOMETERS') then 'KM'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('CM2', 'SQUARECENTIMETRE', 'SQUARECENTIMETER') then 'CM2'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('M2', 'SQUAREMETRE', 'SQUAREMETER') then 'M2'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('ML', 'MILLILITRE', 'MILLILITER', 'MILLILITRES', 'MILLILITERS') then 'ML'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('L', 'LITRE', 'LITER', 'LITRES', 'LITERS') then 'L'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('M3', 'CUBICMETRE', 'CUBICMETER') then 'M3'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('MIN', 'MINUTE', 'MINUTES') then 'MIN'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('HOUR', 'HOURS', 'HR', 'HRS') then 'HOUR'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('DAY', 'DAYS') then 'DAY'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('PALLET', 'PALLETS') then 'PALLET'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('CRATE', 'CRATES') then 'CRATE'
    when regexp_replace(upper(btrim(p_value)), '[^A-Z0-9]+', '', 'g') in ('BUNDLE', 'BUNDLES') then 'BUNDLE'
    else null
  end
$$;

create or replace function public.uom_code_looks_generated(p_code text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_code is null then false
    else upper(btrim(p_code)) ~ '^UI-[A-Z0-9]+$'
      or upper(btrim(p_code)) ~ '^[A-Z0-9]+-[A-Z0-9-]+-(EA|EACH|PCS|PAIR|SET|PACK|BOX|BAG|CASE|CARTON|ROLL|SHEET|MG|G|KG|T|MM|CM|M|KM|CM2|M2|ML|L|M3|MIN|HOUR|DAY|PALLET|CRATE|BUNDLE)$'
  end
$$;

alter table public.uoms
  drop constraint if exists uoms_family_chk;

update public.uoms
   set code = upper(btrim(code)),
       name = btrim(name),
       family = case
         when lower(btrim(family)) = any (array['mass', 'volume', 'length', 'count', 'time', 'area', 'other'])
           then lower(btrim(family))
         else 'other'
       end
 where code is distinct from upper(btrim(code))
    or name is distinct from btrim(name)
    or family is distinct from lower(btrim(family))
    or lower(btrim(family)) <> all (array['mass', 'volume', 'length', 'count', 'time', 'area', 'other']);

alter table public.uoms
  add constraint uoms_family_chk
  check (family = any (array['mass', 'volume', 'length', 'count', 'time', 'area', 'other']));

alter table public.uoms
  drop constraint if exists uoms_code_not_empty,
  drop constraint if exists uoms_name_not_empty;

alter table public.uoms
  add constraint uoms_code_not_empty check (btrim(code) <> ''),
  add constraint uoms_name_not_empty check (btrim(name) <> '');

create or replace function public.normalize_and_validate_uom()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.code := upper(btrim(coalesce(new.code, '')));
  new.name := btrim(coalesce(new.name, ''));
  new.family := lower(btrim(coalesce(new.family, '')));

  if new.code = '' then
    raise exception 'uom_code_required' using errcode = '23514';
  end if;

  if new.name = '' then
    raise exception 'uom_name_required' using errcode = '23514';
  end if;

  if new.family = '' then
    raise exception 'uom_family_required' using errcode = '23514';
  end if;

  if public.uom_code_looks_generated(new.code) then
    raise exception 'uom_code_looks_item_specific' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_and_validate_uom on public.uoms;

create trigger normalize_and_validate_uom
before insert or update on public.uoms
for each row
execute function public.normalize_and_validate_uom();

create or replace function public.seed_default_uoms()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.uoms (id, code, name, family)
  select 'uom_' || lower(d.code), d.code, d.name, d.family
  from public.uom_default_catalogue() d
  on conflict (code) do update
    set name = excluded.name,
        family = excluded.family
    where public.uoms.name is distinct from excluded.name
       or public.uoms.family is distinct from excluded.family;

  insert into public.uom_conversions (from_uom_id, to_uom_id, factor, company_id)
  select f.id, t.id, v.factor, null::uuid
  from (
    values
      ('G', 'MG', 1000::numeric),
      ('KG', 'G', 1000::numeric),
      ('T', 'KG', 1000::numeric),
      ('CM', 'MM', 10::numeric),
      ('M', 'CM', 100::numeric),
      ('KM', 'M', 1000::numeric),
      ('M2', 'CM2', 10000::numeric),
      ('L', 'ML', 1000::numeric),
      ('M3', 'L', 1000::numeric),
      ('HOUR', 'MIN', 60::numeric),
      ('DAY', 'HOUR', 24::numeric)
  ) as v(from_code, to_code, factor)
  join public.uoms f on f.code = v.from_code
  join public.uoms t on t.code = v.to_code
  on conflict (from_uom_id, to_uom_id) do nothing;
end;
$$;

create or replace function public.repair_generated_uoms()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_items integer := 0;
  v_purchase_lines integer := 0;
  v_sales_lines integer := 0;
  v_stock_movements integer := 0;
  v_conversions integer := 0;
  v_deleted integer := 0;
begin
  perform public.seed_default_uoms();

  create temporary table if not exists pg_temp.uom_repair_map (
    polluted_id text primary key,
    canonical_id text not null,
    canonical_code text not null
  ) on commit drop;

  truncate table pg_temp.uom_repair_map;

  insert into pg_temp.uom_repair_map (polluted_id, canonical_id, canonical_code)
  select polluted.id, canonical.id, canonical.code
  from public.uoms polluted
  join public.uoms canonical
    on canonical.code = public.canonical_uom_code(polluted.name)
  where polluted.id <> canonical.id
    and public.uom_code_looks_generated(polluted.code);

  update public.items i
     set base_uom_id = m.canonical_id
  from pg_temp.uom_repair_map m
  where i.base_uom_id = m.polluted_id;
  get diagnostics v_items = row_count;

  update public.purchase_order_lines l
     set uom_id = m.canonical_id
  from pg_temp.uom_repair_map m
  where l.uom_id = m.polluted_id;
  get diagnostics v_purchase_lines = row_count;

  update public.sales_order_lines l
     set uom_id = m.canonical_id
  from pg_temp.uom_repair_map m
  where l.uom_id = m.polluted_id;
  get diagnostics v_sales_lines = row_count;

  update public.stock_movements s
     set uom_id = m.canonical_id
  from pg_temp.uom_repair_map m
  where s.uom_id = m.polluted_id;
  get diagnostics v_stock_movements = row_count;

  delete from public.uom_conversions c
  using pg_temp.uom_repair_map m
  where c.from_uom_id = m.polluted_id
     or c.to_uom_id = m.polluted_id;
  get diagnostics v_conversions = row_count;

  delete from public.uoms u
  using pg_temp.uom_repair_map m
  where u.id = m.polluted_id
    and not exists (select 1 from public.items i where i.base_uom_id = u.id)
    and not exists (select 1 from public.purchase_order_lines l where l.uom_id = u.id)
    and not exists (select 1 from public.sales_order_lines l where l.uom_id = u.id)
    and not exists (select 1 from public.stock_movements s where s.uom_id = u.id)
    and not exists (select 1 from public.uom_conversions c where c.from_uom_id = u.id or c.to_uom_id = u.id);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'items_remapped', v_items,
    'purchase_order_lines_remapped', v_purchase_lines,
    'sales_order_lines_remapped', v_sales_lines,
    'stock_movements_remapped', v_stock_movements,
    'conversions_deleted', v_conversions,
    'uoms_deleted', v_deleted
  );
end;
$$;

select public.repair_generated_uoms();

create or replace view public.uom
with (security_invoker = on)
as
select id, code, name, family
from public.uoms;

create or replace function public.create_company_and_bootstrap(p_name text)
returns table(out_company_id uuid, company_name text, out_role public.member_role)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_company_id uuid;
  v_trial_started_at timestamptz := timezone('utc', now());
  v_trial_expires_at timestamptz := timezone('utc', now()) + interval '7 days';
  v_purge_scheduled_at timestamptz := timezone('utc', now()) + interval '21 days';
  v_rate_allowed boolean;
  v_rate_retry integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'create_company_and_bootstrap',
    v_user::text,
    3600,
    3
  );

  if coalesce(v_rate_allowed, false) = false then
    raise exception 'company_bootstrap_rate_limited_retry_after_%s', coalesce(v_rate_retry, 3600)
      using errcode = 'P0001';
  end if;

  perform public.seed_default_uoms();

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user;

  select cm.company_id
    into v_company_id
  from public.company_members cm
  where cm.user_id = v_user
    and cm.status = 'active'::member_status
  order by cm.created_at asc, cm.company_id asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id as out_company_id,
             c.name as company_name,
             cm.role as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id = v_user
       and cm.status = 'active'::member_status
      where c.id = v_company_id
      order by cm.created_at asc, cm.company_id asc
      limit 1;
    return;
  end if;

  with activated as (
    update public.company_members m
       set user_id = v_user,
           status = 'active'::member_status
     where m.status = 'invited'::member_status
       and (
         m.user_id = v_user
         or (
           v_email is not null
           and lower(m.email) = v_email
           and (m.user_id is null or m.user_id = v_user)
         )
       )
    returning m.company_id, m.created_at
  )
  select a.company_id
    into v_company_id
  from activated a
  order by a.created_at asc nulls last, a.company_id asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id as out_company_id,
             c.name as company_name,
             cm.role as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id = v_user
       and cm.status = 'active'::member_status
      where c.id = v_company_id
      order by cm.created_at asc, cm.company_id asc
      limit 1;
    return;
  end if;

  insert into public.companies (name, owner_user_id)
  values (coalesce(nullif(trim(p_name), ''), 'My Company'), v_user)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, email, role, status, invited_by)
  values (v_company_id, v_user, v_email, 'OWNER'::member_role, 'active'::member_status, v_user)
  on conflict on constraint company_members_pkey do update
    set user_id = excluded.user_id,
        role = 'OWNER'::member_role,
        status = 'active'::member_status,
        invited_by = excluded.invited_by;

  insert into public.company_settings (company_id, data)
  values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;

  perform public.seed_default_payment_terms(v_company_id);

  insert into public.company_subscription_state (
    company_id,
    plan_code,
    subscription_status,
    trial_started_at,
    trial_expires_at,
    purge_scheduled_at,
    access_granted_by,
    access_granted_at,
    grant_reason,
    updated_by
  )
  values (
    v_company_id,
    'trial_7d',
    'trial'::public.subscription_status,
    v_trial_started_at,
    v_trial_expires_at,
    v_purge_scheduled_at,
    v_user,
    v_trial_started_at,
    'Initial 7-day trial',
    v_user
  )
  on conflict (company_id) do nothing;

  perform public.sync_company_purge_queue(
    v_company_id,
    v_purge_scheduled_at,
    'Scheduled operational-data purge after 7-day trial expiry',
    v_user
  );

  perform public.record_company_access_audit(
    v_company_id,
    null,
    'trial_7d',
    null,
    'trial'::public.subscription_status,
    'Initial 7-day trial',
    jsonb_build_object(
      'trial_started_at', v_trial_started_at,
      'trial_expires_at', v_trial_expires_at,
      'purge_scheduled_at', v_purge_scheduled_at
    )
  );

  return query
    select c.id as out_company_id,
           c.name as company_name,
           'OWNER'::member_role as out_role
    from public.companies c
    where c.id = v_company_id
    limit 1;

exception
  when others then
    raise exception 'bootstrap_error: % (SQLSTATE=%)', sqlerrm, sqlstate;
end;
$$;

revoke all on function public.create_company_and_bootstrap(text) from public;
grant all on function public.create_company_and_bootstrap(text) to authenticated;
grant all on function public.create_company_and_bootstrap(text) to service_role;

revoke all on function public.uom_default_catalogue() from public;
revoke all on function public.canonical_uom_code(text) from public;
revoke all on function public.uom_code_looks_generated(text) from public;
revoke all on function public.normalize_and_validate_uom() from public;
revoke all on function public.seed_default_uoms() from public;
revoke all on function public.repair_generated_uoms() from public;

grant execute on function public.seed_default_uoms() to authenticated, service_role;
grant execute on function public.canonical_uom_code(text) to authenticated, service_role;
grant execute on function public.uom_code_looks_generated(text) to authenticated, service_role;
grant execute on function public.repair_generated_uoms() to service_role;
