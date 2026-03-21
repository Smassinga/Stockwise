CREATE OR REPLACE FUNCTION public.active_company_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH primary_source AS (
    SELECT uac.company_id
    FROM public.user_active_company uac
    WHERE uac.user_id = auth.uid()
    LIMIT 1
  ),
  fallback AS (
    SELECT cm.company_id
    FROM public.company_members cm
    WHERE cm.user_id = auth.uid()
    ORDER BY cm.role ASC, cm.created_at ASC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT company_id FROM primary_source),
    (SELECT company_id FROM fallback)
  );
$$;;
