DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_select') THEN
    EXECUTE 'DROP POLICY cm_select ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_insert') THEN
    EXECUTE 'DROP POLICY cm_insert ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_update') THEN
    EXECUTE 'DROP POLICY cm_update ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_delete') THEN
    EXECUTE 'DROP POLICY cm_delete ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_update_manage') THEN
    EXECUTE 'DROP POLICY cm_update_manage ON public.company_members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_members' AND policyname='cm_delete_manage') THEN
    EXECUTE 'DROP POLICY cm_delete_manage ON public.company_members';
  END IF;
END $$;;
