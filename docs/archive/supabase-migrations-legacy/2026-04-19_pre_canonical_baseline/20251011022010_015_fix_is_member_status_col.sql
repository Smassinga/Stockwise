-- Replace prior is_member() that referenced a non-existent cm.is_active
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
  -- Your company_members schema uses a text status column (e.g., 'active')
  RETURN EXISTS (
    SELECT 1
    FROM public.company_members cm
    WHERE cm.company_id = p_company_id
      AND cm.user_id = uid
      AND (cm.status IS NULL OR cm.status = 'active')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_member(uuid) TO anon, authenticated;;
