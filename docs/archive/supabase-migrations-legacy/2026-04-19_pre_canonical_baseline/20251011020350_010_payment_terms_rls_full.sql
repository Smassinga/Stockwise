-- Expand RLS to cover insert/update/delete using is_member()
DO $$ BEGIN
  BEGIN
    CREATE POLICY payment_terms_insert_is_member ON public.payment_terms
      FOR INSERT
      WITH CHECK (public.is_member(company_id));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY payment_terms_update_is_member ON public.payment_terms
      FOR UPDATE
      USING (public.is_member(company_id))
      WITH CHECK (public.is_member(company_id));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY payment_terms_delete_is_member ON public.payment_terms
      FOR DELETE
      USING (public.is_member(company_id));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
