-- Drop conflicting function signature first (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname='public' AND p.proname='set_active_company' AND p.pronargs=1) THEN
    DROP FUNCTION public.set_active_company(uuid);
  END IF;
END$$;

-- Recreate with expected signature
create or replace function public.set_active_company(p_company uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company
      and m.user_id = auth.uid()
      and m.status in ('active','invited')
  ) then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  insert into public.user_prefs as up (user_id, active_company_id, updated_at)
    values (auth.uid(), p_company, now())
  on conflict (user_id) do update set active_company_id = excluded.active_company_id, updated_at = now();
  return true;
end;$$;

grant execute on function public.set_active_company(uuid) to anon, authenticated;
;
