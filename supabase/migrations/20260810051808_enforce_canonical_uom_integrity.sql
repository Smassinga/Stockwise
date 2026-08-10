set check_function_bodies = off;

-- UOMs are a single global catalogue. These nullable fields are provenance,
-- not company ownership or row scope.
alter table public.uoms
  add column if not exists created_by_user_id uuid,
  add column if not exists created_for_company_id uuid;

comment on column public.uoms.created_by_user_id is
  'Authenticated actor that created a governed custom global UOM. Null for legacy and seeded rows.';
comment on column public.uoms.created_for_company_id is
  'Active company context used to authorize governed custom global UOM creation. This is provenance, not ownership.';

create or replace function public.normalized_uom_name(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select nullif(
    regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^[:alnum:]]+', '', 'g'),
    ''
  )
$$;

create or replace function public.uom_equivalence_key(
  p_code text,
  p_name text,
  p_family text
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when public.canonical_uom_code(p_code) is not null
      then 'canonical:' || public.canonical_uom_code(p_code)
    when public.canonical_uom_code(p_name) is not null
      then 'canonical:' || public.canonical_uom_code(p_name)
    else 'custom:' || lower(btrim(coalesce(p_family, 'other'))) || ':' ||
      coalesce(public.normalized_uom_name(p_name), '')
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
      or upper(btrim(p_code)) ~ '^(EA|EACH|PCS|PAIR|SET|PACK|BOX|BAG|CASE|CARTON|ROLL|SHEET|MG|G|KG|T|MM|CM|M|KM|CM2|M2|ML|L|M3|MIN|HOUR|DAY|PALLET|CRATE|BUNDLE)-[A-F0-9]{8}$'
      or upper(btrim(p_code)) ~ '^[A-Z0-9]+-[A-Z0-9-]+-(EA|EACH|PCS|PAIR|SET|PACK|BOX|BAG|CASE|CARTON|ROLL|SHEET|MG|G|KG|T|MM|CM|M|KM|CM2|M2|ML|L|M3|MIN|HOUR|DAY|PALLET|CRATE|BUNDLE)$'
  end
$$;

-- The two generated Each rows were proven unreferenced across every hosted
-- physical UOM reference and logical JSON/view/function reference before this
-- migration was created. Re-check every declared foreign key at apply time so
-- an unexpected new reference blocks deletion instead of being rewritten or
-- nullified by an ON DELETE action.
do $$
declare
  v_candidate record;
  v_reference record;
  v_count bigint;
  v_candidate_count integer;
  v_deleted integer;
begin
  select count(*)
    into v_candidate_count
  from public.uoms
  where id in (
    'c09965f9-909f-4453-b26e-7dcebda1c1f5',
    'f99c4bf9-0fa6-4feb-b732-8b69ca695f74'
  );

  if v_candidate_count not in (0, 2) then
    raise exception 'uom_integrity_partial_candidate_set:%', v_candidate_count;
  end if;

  if v_candidate_count = 2 then
    for v_candidate in
      select *
      from (values
        ('c09965f9-909f-4453-b26e-7dcebda1c1f5'::text, 'EA-4DBCF6D0'::text),
        ('f99c4bf9-0fa6-4feb-b732-8b69ca695f74'::text, 'EA-8CEB9D40'::text)
      ) as candidates(id, code)
    loop
    if not exists (
      select 1
      from public.uoms u
      where u.id = v_candidate.id
        and u.code = v_candidate.code
        and u.name = 'Each'
        and u.family = 'count'
    ) then
      raise exception 'uom_integrity_candidate_changed:%', v_candidate.id;
    end if;

    for v_reference in
      select
        source_namespace.nspname as schema_name,
        source_table.relname as table_name,
        source_column.attname as column_name
      from pg_catalog.pg_constraint fk
      join pg_catalog.pg_class source_table on source_table.oid = fk.conrelid
      join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
      join lateral unnest(fk.conkey) with ordinality as source_key(attnum, ordinality) on true
      join pg_catalog.pg_attribute source_column
        on source_column.attrelid = source_table.oid
       and source_column.attnum = source_key.attnum
      where fk.contype = 'f'
        and fk.confrelid = 'public.uoms'::regclass
    loop
      execute format(
        'select count(*) from %I.%I where %I = $1',
        v_reference.schema_name,
        v_reference.table_name,
        v_reference.column_name
      ) into v_count using v_candidate.id;

      if v_count <> 0 then
        raise exception 'uom_integrity_candidate_referenced:%:%.%.%:%',
          v_candidate.id,
          v_reference.schema_name,
          v_reference.table_name,
          v_reference.column_name,
          v_count;
      end if;
      end loop;
    end loop;
  end if;

  delete from public.uoms
  where id in (
    'c09965f9-909f-4453-b26e-7dcebda1c1f5',
    'f99c4bf9-0fa6-4feb-b732-8b69ca695f74'
  );
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_candidate_count then
    raise exception 'uom_integrity_expected_deletions:%:got:%', v_candidate_count, v_deleted;
  end if;
end
$$;

create unique index if not exists uq_uoms_semantic_equivalence
  on public.uoms (public.uom_equivalence_key(code, name, family));

create or replace function public.normalize_and_validate_uom()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_code_canonical text;
  v_name_canonical text;
  v_equivalent_id text;
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

  v_code_canonical := public.canonical_uom_code(new.code);
  v_name_canonical := public.canonical_uom_code(new.name);

  if v_code_canonical is not null
     and v_name_canonical is not null
     and v_code_canonical <> v_name_canonical then
    raise exception 'uom_canonical_identity_conflict' using errcode = '23514';
  end if;

  select u.id
    into v_equivalent_id
  from public.uoms u
  where u.id <> new.id
    and (
      upper(u.code) = new.code
      or public.uom_equivalence_key(u.code, u.name, u.family) =
         public.uom_equivalence_key(new.code, new.name, new.family)
    )
  order by u.created_at, u.id
  limit 1;

  if v_equivalent_id is not null then
    raise exception 'uom_equivalent_exists:%', v_equivalent_id using errcode = '23505';
  end if;

  return new;
end;
$$;

drop policy if exists uoms_insert_operator_plus_scoped on public.uoms;
drop policy if exists uoms_update_operator_plus_scoped on public.uoms;
drop policy if exists uoms_delete_manager_plus_or_platform_admin on public.uoms;

revoke all on table public.uoms from anon, authenticated;
grant select on table public.uoms to anon, authenticated;

create or replace function public.create_uom(
  p_code text,
  p_name text,
  p_family text
)
returns table(
  id text,
  code text,
  name text,
  family text,
  created_at timestamptz,
  was_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_company_id uuid := public.current_company_id();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_family text := lower(btrim(coalesce(p_family, '')));
  v_key text;
  v_code_match public.uoms%rowtype;
  v_existing public.uoms%rowtype;
  v_created public.uoms%rowtype;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_company_id is null
     or not public.has_company_role(
       v_company_id,
       array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
     ) then
    raise exception 'uom_create_forbidden' using errcode = '42501';
  end if;

  if v_code = '' then
    raise exception 'uom_code_required' using errcode = '23514';
  end if;

  if v_name = '' then
    raise exception 'uom_name_required' using errcode = '23514';
  end if;

  if v_family <> all (array['mass', 'volume', 'length', 'count', 'time', 'area', 'other']) then
    raise exception 'uom_family_invalid' using errcode = '23514';
  end if;

  if public.uom_code_looks_generated(v_code) then
    raise exception 'uom_code_looks_item_specific' using errcode = '23514';
  end if;

  if public.canonical_uom_code(v_code) is not null
     and public.canonical_uom_code(v_name) is not null
     and public.canonical_uom_code(v_code) <> public.canonical_uom_code(v_name) then
    raise exception 'uom_canonical_identity_conflict' using errcode = '23514';
  end if;

  v_key := public.uom_equivalence_key(v_code, v_name, v_family);

  select u.*
    into v_code_match
  from public.uoms u
  where upper(u.code) = v_code
  order by u.created_at, u.id
  limit 1;

  if found then
    if (
      public.canonical_uom_code(v_code) is not null
      and public.canonical_uom_code(v_name) = public.canonical_uom_code(v_code)
    ) or (
      public.canonical_uom_code(v_code) is null
      and public.normalized_uom_name(v_code_match.name) = public.normalized_uom_name(v_name)
      and v_code_match.family = v_family
    ) then
      return query
      select v_code_match.id, v_code_match.code, v_code_match.name, v_code_match.family,
             v_code_match.created_at, false;
      return;
    end if;

    raise exception 'uom_code_exists:%', v_code_match.id using errcode = '23505';
  end if;

  select u.*
    into v_existing
  from public.uoms u
  where public.uom_equivalence_key(u.code, u.name, u.family) = v_key
  order by u.created_at, u.id
  limit 1;

  if found then
    return query
    select v_existing.id, v_existing.code, v_existing.name, v_existing.family,
           v_existing.created_at, false;
    return;
  end if;

  begin
    insert into public.uoms (
      code,
      name,
      family,
      created_by_user_id,
      created_for_company_id
    ) values (
      v_code,
      v_name,
      v_family,
      v_actor,
      v_company_id
    )
    returning * into v_created;
  exception
    when unique_violation then
      select u.*
        into v_existing
      from public.uoms u
      where public.uom_equivalence_key(u.code, u.name, u.family) = v_key
      order by u.created_at, u.id
      limit 1;

      if found then
        return query
        select v_existing.id, v_existing.code, v_existing.name, v_existing.family,
               v_existing.created_at, false;
        return;
      end if;
      raise;
  end;

  return query
  select v_created.id, v_created.code, v_created.name, v_created.family,
         v_created.created_at, true;
end;
$$;

revoke all on function public.normalized_uom_name(text) from public;
revoke all on function public.uom_equivalence_key(text, text, text) from public;
revoke all on function public.create_uom(text, text, text) from public;
revoke execute on function public.seed_default_uoms() from authenticated;

grant execute on function public.normalized_uom_name(text) to authenticated, service_role;
grant execute on function public.uom_equivalence_key(text, text, text) to authenticated, service_role;
grant execute on function public.create_uom(text, text, text) to authenticated;
grant execute on function public.create_uom(text, text, text) to service_role;

comment on function public.create_uom(text, text, text) is
  'Governed creation of reusable global UOMs. Reuses an equivalent catalogue row and records actor/company provenance for new custom units.';
