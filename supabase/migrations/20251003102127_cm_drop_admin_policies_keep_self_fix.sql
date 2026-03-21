DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='company_members'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.company_members', pol.policyname);
  END LOOP;
  ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
  CREATE POLICY cm_self_read ON public.company_members
    FOR SELECT USING (user_id = auth.uid());
END$$;;
