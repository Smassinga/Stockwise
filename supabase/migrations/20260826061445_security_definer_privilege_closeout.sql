-- StockWise security-definer privilege closeout.
-- Existing SECURITY DEFINER routines must never rely on PostgreSQL's default PUBLIC EXECUTE.
-- Client-facing RPCs keep their explicit role grants. Internal helpers and trigger functions become non-client-callable.

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', r.oid::regprocedure);
  end loop;
end
$$;

-- Trigger functions are runtime plumbing, never Data API RPCs.
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', r.oid::regprocedure);
  end loop;
end
$$;

-- Obsolete destructive legacy reset. The maintained replacement is
-- platform_admin_reset_company_operational_data(...), which performs its own platform-admin authorization.
drop function if exists public.reset_company_data(uuid, boolean);

-- RLS/read helpers that legitimately execute in authenticated sessions.
grant execute on function public.actor_role_for(uuid) to authenticated;
grant execute on function public.can_read_company(uuid, text[]) to authenticated;
grant execute on function public.current_user_company_ids() to authenticated;
grant execute on function public.display_name_for_user(uuid) to authenticated;
grant execute on function public.get_active_company() to authenticated;
grant execute on function public.my_role(uuid) to authenticated;

-- Legacy invitation compatibility remains authenticated-only.
grant execute on function public.accept_company_invite(uuid) to authenticated;

-- Finance capability predicates are safe authenticated read helpers and may be
-- called by maintained RPC/UI paths without regaining PUBLIC/anon exposure.
grant execute on function public.finance_documents_can_approve(uuid) to authenticated;
grant execute on function public.finance_documents_can_issue_adjustment(uuid) to authenticated;
grant execute on function public.finance_documents_can_issue_legal(uuid) to authenticated;
grant execute on function public.finance_documents_can_manage_due_reminders(uuid) to authenticated;
grant execute on function public.finance_documents_can_manage_settlement(uuid) to authenticated;
grant execute on function public.finance_documents_can_post_adjustment(uuid) to authenticated;
grant execute on function public.finance_documents_can_prepare_draft(uuid) to authenticated;
grant execute on function public.finance_documents_can_submit_for_approval(uuid) to authenticated;
grant execute on function public.finance_documents_can_void(uuid) to authenticated;
grant execute on function public.finance_documents_has_min_role(uuid, public.member_role) to authenticated;

comment on function public.apply_stock_delta(uuid, text, uuid, numeric, numeric)
is 'Internal stock rollup helper invoked by governed stock-movement trigger paths. Direct PUBLIC/anon/authenticated execution is intentionally revoked.';

comment on function public.record_company_control_action(uuid, text, text, jsonb)
is 'Internal audit writer. Direct PUBLIC/anon/authenticated execution is intentionally revoked; guarded platform-admin routines call it under definer context.';

comment on function public.sync_company_purge_queue(uuid, timestamptz, text, uuid)
is 'Internal purge-queue synchronizer. Direct PUBLIC/anon/authenticated execution is intentionally revoked; guarded platform-admin routines call it under definer context.';
