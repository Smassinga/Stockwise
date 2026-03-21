DO $$ BEGIN
  BEGIN
    CREATE POLICY user_active_company_select_self ON public.user_active_company
      FOR SELECT
      USING (user_id = auth.uid());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
