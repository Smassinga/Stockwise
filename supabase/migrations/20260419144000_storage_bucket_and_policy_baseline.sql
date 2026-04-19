begin;

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'Supabase storage schema is not initialized for canonical replay';
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values
  ('brand-logos', 'brand-logos', true),
  ('bank-statements', 'bank-statements', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

drop policy if exists "Authenticated upload bank statements" on storage.objects;
drop policy if exists "Authenticated update bank statements" on storage.objects;
drop policy if exists "Authenticated delete bank statements" on storage.objects;
drop policy if exists "bank stmts select" on storage.objects;
drop policy if exists "bank stmts insert" on storage.objects;
drop policy if exists "bank stmts update" on storage.objects;
drop policy if exists "bank stmts delete" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1l5awph_0" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1l5awph_1" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1l5awph_2" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1l5awph_3" on storage.objects;
drop policy if exists "bank-stmts-objects-select" on storage.objects;
drop policy if exists "bank-stmts-objects-insert" on storage.objects;
drop policy if exists "bank-stmts-objects-delete" on storage.objects;
drop policy if exists "bank_statements_objects_select_scoped" on storage.objects;
drop policy if exists "bank_statements_objects_insert_scoped" on storage.objects;
drop policy if exists "bank_statements_objects_update_scoped" on storage.objects;
drop policy if exists "bank_statements_objects_delete_scoped" on storage.objects;

drop policy if exists "Authenticated upload brand logos" on storage.objects;
drop policy if exists "Authenticated update brand logos" on storage.objects;
drop policy if exists "Authenticated delete brand logos" on storage.objects;
drop policy if exists "brand_logos_insert_scoped" on storage.objects;
drop policy if exists "brand_logos_update_scoped" on storage.objects;
drop policy if exists "brand_logos_delete_scoped" on storage.objects;
drop policy if exists "brand_logos_manager_select" on storage.objects;
drop policy if exists "brand_logos_manager_insert" on storage.objects;
drop policy if exists "brand_logos_manager_update" on storage.objects;
drop policy if exists "brand_logos_manager_delete" on storage.objects;

create policy bank_statements_objects_select_scoped
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'bank-statements'
    and exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::public.member_status
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

create policy bank_statements_objects_insert_scoped
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'bank-statements'
    and exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::public.member_status
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

create policy bank_statements_objects_update_scoped
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'bank-statements'
    and exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::public.member_status
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
  with check (
    bucket_id = 'bank-statements'
    and exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::public.member_status
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

create policy bank_statements_objects_delete_scoped
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'bank-statements'
    and exists (
      select 1
      from public.bank_accounts ba
      join public.company_members cm
        on cm.company_id = ba.company_id
       and cm.user_id = auth.uid()
       and cm.status = 'active'::public.member_status
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

create policy brand_logos_insert_scoped
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'brand-logos'
    and (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    and public.has_company_role(
      public.current_company_id(),
      array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[]
    )
  );

create policy brand_logos_update_scoped
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'brand-logos'
    and (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    and public.has_company_role(
      public.current_company_id(),
      array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[]
    )
  )
  with check (
    bucket_id = 'brand-logos'
    and (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    and public.has_company_role(
      public.current_company_id(),
      array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[]
    )
  );

create policy brand_logos_delete_scoped
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'brand-logos'
    and (
      case
        when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then split_part(name, '/', 1)::uuid
        else null
      end
    ) = public.current_company_id()
    and public.has_company_role(
      public.current_company_id(),
      array['OWNER', 'ADMIN', 'MANAGER']::public.member_role[]
    )
  );

create policy brand_logos_manager_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'brand-logos'
    and public.can_manage_company_storage_prefix(
      public.try_uuid(split_part(name, '/', 1))
    )
  );

create policy brand_logos_manager_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'brand-logos'
    and public.can_manage_company_storage_prefix(
      public.try_uuid(split_part(name, '/', 1))
    )
  );

create policy brand_logos_manager_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'brand-logos'
    and public.can_manage_company_storage_prefix(
      public.try_uuid(split_part(name, '/', 1))
    )
  )
  with check (
    bucket_id = 'brand-logos'
    and public.can_manage_company_storage_prefix(
      public.try_uuid(split_part(name, '/', 1))
    )
  );

create policy brand_logos_manager_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'brand-logos'
    and public.can_manage_company_storage_prefix(
      public.try_uuid(split_part(name, '/', 1))
    )
  );

commit;
