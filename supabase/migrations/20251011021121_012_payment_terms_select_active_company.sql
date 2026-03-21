-- Permit SELECT on payment_terms if caller's active company matches the row company_id
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT (
    SELECT uac.company_id
    FROM public.user_active_company uac
    WHERE uac.user_id = auth.uid()
    ORDER BY uac.updated_at DESC
    LIMIT 1
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_company_id() TO anon, authenticated;

DO $$ BEGIN
  BEGIN
    CREATE POLICY payment_terms_select_active ON public.payment_terms
      FOR SELECT
      USING (payment_terms.company_id = public.current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
