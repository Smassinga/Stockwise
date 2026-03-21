DO $$ BEGIN
  -- Drop existing to avoid signature conflicts
  PERFORM 1 FROM pg_proc WHERE proname='role_rank' AND oid = 'public.role_rank(member_role)'::regprocedure;
EXCEPTION WHEN undefined_function THEN
  -- ignore
END $$;

-- Safer explicit drop if exists by signature
DO $$ BEGIN
  EXECUTE 'DROP FUNCTION IF EXISTS public.role_rank(member_role)';
EXCEPTION WHEN OTHERS THEN END $$;

CREATE OR REPLACE FUNCTION public.role_rank(r member_role)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'VIEWER'   THEN 0
    WHEN 'OPERATOR' THEN 10
    WHEN 'MANAGER'  THEN 20
    WHEN 'ADMIN'    THEN 30
    WHEN 'OWNER'    THEN 40
  END
$$;

CREATE OR REPLACE FUNCTION public.my_role(p_company uuid)
RETURNS member_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  SELECT cm.role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
  LIMIT 1
$$;;
