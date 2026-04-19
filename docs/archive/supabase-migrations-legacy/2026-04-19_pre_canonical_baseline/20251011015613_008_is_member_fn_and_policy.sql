-- Helper: membership check that works under RLS via SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_member(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = p_company_id
      AND cm.user_id = uid
      AND (cm.is_active IS NULL OR cm.is_active = true)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_member(uuid) TO anon, authenticated;

-- Policy using the definer function (keeps previous policies too).
DO $$ BEGIN
  BEGIN
    CREATE POLICY payment_terms_select_is_member ON public.payment_terms
      FOR SELECT
      USING (public.is_member(payment_terms.company_id));
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
