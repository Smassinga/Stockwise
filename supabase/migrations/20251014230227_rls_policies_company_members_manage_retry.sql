alter table public.company_members enable row level security;
grant select, update, delete on public.company_members to authenticated;

-- Drop if exist then create
do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='company_members' and policyname='cm_update_manage') then
    execute 'drop policy cm_update_manage on public.company_members';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='company_members' and policyname='cm_delete_manage') then
    execute 'drop policy cm_delete_manage on public.company_members';
  end if;
end $$;

create policy cm_update_manage
  on public.company_members
  for update
  to authenticated
  using ( public.has_company_role_any_status(company_id, array['OWNER','ADMIN','MANAGER']::public.member_role[]) )
  with check ( public.has_company_role_any_status(company_id, array['OWNER','ADMIN','MANAGER']::public.member_role[]) );

create policy cm_delete_manage
  on public.company_members
  for delete
  to authenticated
  using ( public.has_company_role_any_status(company_id, array['OWNER','ADMIN','MANAGER']::public.member_role[]) );;
