-- Complete the SECURITY DEFINER closeout by removing legacy anonymous membership execution
-- and tightening legacy policy roles to the signed-in application role.

alter policy merged_select on public.companies to authenticated;
alter policy merged_update on public.companies to authenticated;

alter policy _delete_delete on public.order_counters to authenticated;
alter policy _insert_insert on public.order_counters to authenticated;
alter policy _select_select on public.order_counters to authenticated;
alter policy _update_update on public.order_counters to authenticated;

alter policy merged_delete on public.stock_levels to authenticated;
alter policy merged_insert on public.stock_levels to authenticated;
alter policy merged_update on public.stock_levels to authenticated;

revoke select on table public.stock_levels from anon;

revoke execute on function public.is_company_member(uuid, uuid, text[]) from anon;
revoke execute on function public.is_company_member(uuid) from anon;
revoke execute on function public.is_member_of_company(uuid) from anon;

grant execute on function public.is_company_member(uuid, uuid, text[]) to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.is_member_of_company(uuid) to authenticated;

alter function public.normalize_supplier_invoice_reference(text)
  set search_path = pg_catalog, public, extensions;
alter function public.role_rank(public.member_role)
  set search_path = pg_catalog, public, extensions;
alter function public.parse_due_reminder_lead_days(jsonb)
  set search_path = pg_catalog, public, extensions;
alter function public.parse_due_reminder_send_at(jsonb)
  set search_path = pg_catalog, public, extensions;

-- Fail this migration if the intended boundary is not true after the change.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'security_definer_public_execute_regression';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'security_definer_anon_execute_regression';
  end if;

  if has_table_privilege('anon', 'public.stock_levels', 'SELECT') then
    raise exception 'stock_levels_anon_select_regression';
  end if;
end
$$;
