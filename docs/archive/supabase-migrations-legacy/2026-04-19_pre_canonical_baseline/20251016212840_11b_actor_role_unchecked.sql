CREATE OR REPLACE FUNCTION public.actor_role_for(p_company uuid)
RETURNS member_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
  SELECT cm.role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
  LIMIT 1
$$;;
