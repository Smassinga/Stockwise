alter table public.boms
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

create or replace function public.guard_bom_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null and not public.has_company_role(
    old.company_id,
    array['OWNER','ADMIN','MANAGER']::public.member_role[]
  ) then
    raise exception 'recipe_delete_forbidden' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.builds b where b.bom_id = old.id and b.company_id = old.company_id
  ) or exists (
    select 1 from public.production_runs pr where pr.bom_id = old.id and pr.company_id = old.company_id
  ) then
    raise exception 'recipe_has_posting_history_use_archive' using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists boms_govern_delete on public.boms;
create trigger boms_govern_delete
before delete on public.boms
for each row execute function public.guard_bom_delete();

create or replace function public.remove_recipe(p_bom_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company_id uuid := public.current_company_id();
  v_bom public.boms%rowtype;
  v_build_count bigint;
  v_run_count bigint;
begin
  if v_company_id is null then
    raise exception 'No active company selected' using errcode = '42501';
  end if;

  if not public.has_company_role(
    v_company_id,
    array['OWNER','ADMIN','MANAGER']::public.member_role[]
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select *
    into v_bom
  from public.boms b
  where b.id = p_bom_id
    and b.company_id = v_company_id
  for update;

  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_build_count
  from public.builds b
  where b.bom_id = p_bom_id
    and b.company_id = v_company_id;

  select count(*) into v_run_count
  from public.production_runs pr
  where pr.bom_id = p_bom_id
    and pr.company_id = v_company_id;

  if v_build_count > 0 or v_run_count > 0 then
    update public.boms
       set is_active = false,
           archived_at = coalesce(archived_at, now()),
           archived_by = coalesce(archived_by, auth.uid()),
           archive_reason = coalesce(archive_reason, 'Recipe retained because production history exists')
     where id = p_bom_id
       and company_id = v_company_id;

    return jsonb_build_object(
      'bom_id', p_bom_id,
      'action', 'archived',
      'build_count', v_build_count,
      'production_run_count', v_run_count
    );
  end if;

  delete from public.boms
  where id = p_bom_id
    and company_id = v_company_id;

  return jsonb_build_object(
    'bom_id', p_bom_id,
    'action', 'deleted',
    'build_count', 0,
    'production_run_count', 0
  );
end;
$$;

alter function public.guard_bom_delete() owner to postgres;
alter function public.remove_recipe(uuid) owner to postgres;
revoke all on function public.guard_bom_delete() from public, anon, authenticated;
revoke all on function public.remove_recipe(uuid) from public, anon;
grant execute on function public.remove_recipe(uuid) to authenticated, service_role;

comment on function public.remove_recipe(uuid) is
  'MANAGER+ governed recipe removal. Never-used recipes are deleted with their components; recipes referenced by Quick Assemblies or Production Runs are retained and archived.';
