BEGIN;

CREATE OR REPLACE FUNCTION public.active_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH active_selected AS (
    SELECT uac.company_id
    FROM public.user_active_company uac
    JOIN public.company_members cm
      ON cm.company_id = uac.company_id
     AND cm.user_id = uac.user_id
     AND cm.status = 'active'
    WHERE uac.user_id = auth.uid()
    ORDER BY uac.updated_at DESC
    LIMIT 1
  ),
  active_fallback AS (
    SELECT cm.company_id
    FROM public.company_members cm
    WHERE cm.user_id = auth.uid()
      AND cm.status = 'active'
    ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT company_id FROM active_selected),
    (SELECT company_id FROM active_fallback)
  );
$function$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.active_company_id();
$function$;

DROP POLICY IF EXISTS company_members_select_self_companies ON public.company_members;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_members'
      AND policyname = 'company_members_select_self'
  ) THEN
    CREATE POLICY company_members_select_self
      ON public.company_members
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END
$$;

DROP POLICY IF EXISTS profiles_select_same_company ON public.profiles;

CREATE POLICY profiles_select_same_company
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.company_members me
      JOIN public.company_members them
        ON them.company_id = me.company_id
       AND them.user_id = profiles.id
       AND them.status = 'active'
      WHERE me.user_id = auth.uid()
        AND me.status = 'active'
        AND public.role_rank(public.actor_role_for(me.company_id)) >= public.role_rank('MANAGER'::member_role)
    )
  );

COMMIT;
