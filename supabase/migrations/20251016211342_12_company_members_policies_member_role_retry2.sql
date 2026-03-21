ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_select_mgr_plus') THEN
    EXECUTE 'DROP POLICY cm_select_mgr_plus ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_insert_mgr_plus') THEN
    EXECUTE 'DROP POLICY cm_insert_mgr_plus ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_update_mgr_plus') THEN
    EXECUTE 'DROP POLICY cm_update_mgr_plus ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_delete_mgr_plus') THEN
    EXECUTE 'DROP POLICY cm_delete_mgr_plus ON public.company_members';
  END IF;
END$$;

CREATE POLICY cm_select_mgr_plus ON public.company_members
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
    AND role_rank(public.my_role(company_id)) >= role_rank('MANAGER'::member_role)
  );

CREATE POLICY cm_insert_mgr_plus ON public.company_members
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
    AND role_rank(public.my_role(company_id)) >= role_rank('MANAGER'::member_role)
    AND role_rank(role) <= role_rank(public.my_role(company_id))
    AND (role <> 'OWNER'::member_role OR public.my_role(company_id) = 'OWNER'::member_role)
  );

CREATE POLICY cm_update_mgr_plus ON public.company_members
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
    AND role_rank(public.my_role(company_id)) >= role_rank('MANAGER'::member_role)
    AND role_rank(role) <= role_rank(public.my_role(company_id))
  )
  WITH CHECK (
    role_rank(public.my_role(company_id)) >= role_rank('MANAGER'::member_role)
    AND role_rank(role) <= role_rank(public.my_role(company_id))
    AND (role <> 'OWNER'::member_role OR public.my_role(company_id) = 'OWNER'::member_role)
  );

CREATE POLICY cm_delete_mgr_plus ON public.company_members
  FOR DELETE TO authenticated
  USING (
    company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
    AND role_rank(public.my_role(company_id)) >= role_rank('MANAGER'::member_role)
    AND role_rank(role) <= role_rank(public.my_role(company_id))
    AND user_id IS DISTINCT FROM auth.uid()
  );;
