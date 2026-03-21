DO $$ BEGIN
  BEGIN
    CREATE POLICY payment_terms_select_membership ON public.payment_terms
      FOR SELECT
      USING (EXISTS (
        SELECT 1 FROM public.company_members cm
        WHERE cm.company_id = payment_terms.company_id
          AND cm.user_id = auth.uid()
      ));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
