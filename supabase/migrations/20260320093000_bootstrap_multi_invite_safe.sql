BEGIN;

CREATE OR REPLACE FUNCTION public.create_company_and_bootstrap(p_name text)
RETURNS TABLE(out_company_id uuid, company_name text, out_role member_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_company_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT lower(u.email) INTO v_email
  FROM auth.users u
  WHERE u.id = v_user;

  SELECT cm.company_id
    INTO v_company_id
  FROM public.company_members cm
  WHERE cm.user_id = v_user
    AND cm.status = 'active'::member_status
  ORDER BY cm.created_at ASC, cm.company_id ASC
  LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id AS out_company_id,
             c.name AS company_name,
             cm.role AS out_role
      FROM public.companies c
      JOIN public.company_members cm
        ON cm.company_id = c.id
       AND cm.user_id = v_user
       AND cm.status = 'active'::member_status
      WHERE c.id = v_company_id
      ORDER BY cm.created_at ASC, cm.company_id ASC
      LIMIT 1;
    RETURN;
  END IF;

  WITH activated AS (
    UPDATE public.company_members m
       SET user_id = v_user,
           status = 'active'::member_status
     WHERE m.status = 'invited'::member_status
       AND (
         m.user_id = v_user
         OR (
           v_email IS NOT NULL
           AND lower(m.email) = v_email
           AND (m.user_id IS NULL OR m.user_id = v_user)
         )
       )
    RETURNING m.company_id, m.created_at
  )
  SELECT a.company_id
    INTO v_company_id
  FROM activated a
  ORDER BY a.created_at ASC NULLS LAST, a.company_id ASC
  LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    RETURN QUERY
      SELECT c.id AS out_company_id,
             c.name AS company_name,
             cm.role AS out_role
      FROM public.companies c
      JOIN public.company_members cm
        ON cm.company_id = c.id
       AND cm.user_id = v_user
       AND cm.status = 'active'::member_status
      WHERE c.id = v_company_id
      ORDER BY cm.created_at ASC, cm.company_id ASC
      LIMIT 1;
    RETURN;
  END IF;

  INSERT INTO public.companies (name, owner_user_id)
  VALUES (COALESCE(NULLIF(trim(p_name), ''), 'My Company'), v_user)
  RETURNING id INTO v_company_id;

  INSERT INTO public.company_members (company_id, user_id, email, role, status, invited_by)
  VALUES (v_company_id, v_user, v_email, 'OWNER'::member_role, 'active'::member_status, v_user)
  ON CONFLICT ON CONSTRAINT company_members_pkey DO UPDATE
    SET user_id = EXCLUDED.user_id,
        role = 'OWNER'::member_role,
        status = 'active'::member_status,
        invited_by = EXCLUDED.invited_by;

  INSERT INTO public.company_settings (company_id, data)
  VALUES (v_company_id, '{}'::jsonb)
  ON CONFLICT (company_id) DO NOTHING;

  PERFORM public.seed_default_payment_terms(v_company_id);

  RETURN QUERY
    SELECT c.id AS out_company_id,
           c.name AS company_name,
           'OWNER'::member_role AS out_role
    FROM public.companies c
    WHERE c.id = v_company_id
    LIMIT 1;

EXCEPTION
  WHEN others THEN
    RAISE EXCEPTION 'bootstrap_error: % (SQLSTATE=%)', SQLERRM, SQLSTATE;
END;
$function$;

COMMIT;
