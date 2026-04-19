BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.security_rate_limits (
  scope text NOT NULL,
  subject text NOT NULL,
  bucket_start timestamptz NOT NULL,
  window_seconds integer NOT NULL CHECK (window_seconds BETWEEN 1 AND 86400),
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  first_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_seen_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (scope, subject, bucket_start)
);

ALTER TABLE app.security_rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'app'
      AND tablename = 'security_rate_limits'
      AND policyname = 'security_rate_limits_service_only'
  ) THEN
    CREATE POLICY security_rate_limits_service_only
      ON app.security_rate_limits
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

REVOKE ALL ON TABLE app.security_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.security_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_security_rate_limit(
  p_scope text,
  p_subject text,
  p_window_seconds integer,
  p_max_hits integer
)
RETURNS TABLE(
  allowed boolean,
  hit_count integer,
  retry_after_seconds integer,
  bucket_started_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
DECLARE
  v_now timestamptz := timezone('utc', now());
  v_bucket timestamptz;
  v_count integer;
  v_retry integer;
BEGIN
  IF COALESCE(btrim(p_scope), '') = '' THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_subject), '') = '' THEN
    RAISE EXCEPTION 'subject_required' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_window_seconds' USING ERRCODE = '22023';
  END IF;
  IF p_max_hits IS NULL OR p_max_hits < 1 OR p_max_hits > 10000 THEN
    RAISE EXCEPTION 'invalid_max_hits' USING ERRCODE = '22023';
  END IF;

  v_bucket := to_timestamp(floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds);

  INSERT INTO app.security_rate_limits (
    scope,
    subject,
    bucket_start,
    window_seconds,
    hit_count,
    first_seen_at,
    last_seen_at
  )
  VALUES (
    p_scope,
    p_subject,
    v_bucket,
    p_window_seconds,
    1,
    v_now,
    v_now
  )
  ON CONFLICT (scope, subject, bucket_start)
  DO UPDATE
     SET hit_count = app.security_rate_limits.hit_count + 1,
         last_seen_at = v_now
  RETURNING app.security_rate_limits.hit_count
    INTO v_count;

  v_retry := GREATEST(
    0,
    CEIL(
      EXTRACT(
        EPOCH FROM ((v_bucket + make_interval(secs => p_window_seconds)) - v_now)
      )
    )::integer
  );

  RETURN QUERY
    SELECT v_count <= p_max_hits,
           v_count,
           CASE WHEN v_count <= p_max_hits THEN 0 ELSE v_retry END,
           v_bucket;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_security_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_security_rate_limit(text, text, integer, integer) TO service_role;

DROP POLICY IF EXISTS "allow_auth_all" ON public.due_reminder_queue;

CREATE OR REPLACE FUNCTION public.actor_role_for(p_company uuid)
RETURNS member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $function$
  SELECT cm.role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.my_role(p_company uuid)
RETURNS member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT cm.role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1
$function$;

DROP FUNCTION IF EXISTS public.set_active_company(uuid);

CREATE OR REPLACE FUNCTION public.set_active_company(p_company uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = p_company
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not an active member of this company' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_active_company AS uac (user_id, company_id, updated_at)
  VALUES (auth.uid(), p_company, now())
  ON CONFLICT (user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        updated_at = now();

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invite_company_member(p_company uuid, p_email text, p_role member_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_token uuid;
  v_actor_role member_role;
  v_target_role member_role;
  v_target_status member_status;
  v_limit record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL THEN
    RAISE EXCEPTION 'role_required' USING ERRCODE = '22023';
  END IF;

  SELECT cm.role
    INTO v_actor_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF v_actor_role IS NULL OR public.role_rank(v_actor_role) < public.role_rank('MANAGER'::member_role) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  IF (
    (v_actor_role = 'OWNER')
    OR (v_actor_role = 'ADMIN' AND p_role = ANY (ARRAY['ADMIN','MANAGER','OPERATOR','VIEWER']::member_role[]))
    OR (v_actor_role = 'MANAGER' AND p_role = ANY (ARRAY['MANAGER','OPERATOR','VIEWER']::member_role[]))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'invite_company_member_actor',
    auth.uid()::text || ':' || p_company::text,
    900,
    20
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'invite_company_member_target',
    p_company::text || ':' || v_email,
    1800,
    3
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT cm.role, cm.status
    INTO v_target_role, v_target_status
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND lower(cm.email) = v_email
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_target_status = 'active' THEN
      RAISE EXCEPTION 'already_active' USING ERRCODE = '23505';
    END IF;

    IF public.role_rank(v_target_role) > public.role_rank(v_actor_role)
      OR (v_target_role = 'OWNER' AND v_actor_role <> 'OWNER') THEN
      RAISE EXCEPTION 'target_not_allowed' USING ERRCODE = '42501';
    END IF;

    UPDATE public.company_members
       SET role = p_role,
           status = 'invited',
           invited_by = auth.uid()
     WHERE company_id = p_company
       AND lower(email) = v_email;
  ELSE
    INSERT INTO public.company_members(company_id, email, role, status, invited_by)
    VALUES (p_company, v_email, p_role, 'invited', auth.uid());
  END IF;

  INSERT INTO public.company_invites(company_id, email, role)
  VALUES (p_company, v_email, p_role)
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reinvite_company_member(p_company uuid, p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $function$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_token uuid;
  v_actor_role member_role;
  v_target_role member_role;
  v_target_status member_status;
  v_limit record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  SELECT cm.role
    INTO v_actor_role
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND cm.user_id = auth.uid()
    AND cm.status = 'active'
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF v_actor_role IS NULL OR public.role_rank(v_actor_role) < public.role_rank('MANAGER'::member_role) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'reinvite_company_member_actor',
    auth.uid()::text || ':' || p_company::text,
    900,
    20
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT allowed, hit_count, retry_after_seconds, bucket_started_at
    INTO v_limit
  FROM public.consume_security_rate_limit(
    'reinvite_company_member_target',
    p_company::text || ':' || v_email,
    1800,
    3
  );

  IF NOT COALESCE(v_limit.allowed, false) THEN
    RAISE EXCEPTION 'rate limit exceeded'
      USING ERRCODE = 'P0001',
            DETAIL = format('retry_after_seconds=%s', COALESCE(v_limit.retry_after_seconds, 0));
  END IF;

  SELECT cm.role, cm.status
    INTO v_target_role, v_target_status
  FROM public.company_members cm
  WHERE cm.company_id = p_company
    AND lower(cm.email) = v_email
  ORDER BY public.role_rank(cm.role) DESC, cm.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_target_status = 'active' THEN
      RAISE EXCEPTION 'already_active' USING ERRCODE = '23505';
    END IF;

    IF public.role_rank(v_target_role) > public.role_rank(v_actor_role)
      OR (v_target_role = 'OWNER' AND v_actor_role <> 'OWNER') THEN
      RAISE EXCEPTION 'target_not_allowed' USING ERRCODE = '42501';
    END IF;

    UPDATE public.company_members
       SET status = 'invited',
           invited_by = auth.uid()
     WHERE company_id = p_company
       AND lower(email) = v_email;
  ELSE
    IF (
      (v_actor_role = 'OWNER')
      OR (v_actor_role = 'ADMIN')
      OR (v_actor_role = 'MANAGER')
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'role_not_allowed' USING ERRCODE = '42501';
    END IF;

    v_target_role := 'VIEWER'::member_role;

    INSERT INTO public.company_members(company_id, email, role, status, invited_by)
    VALUES (p_company, v_email, v_target_role, 'invited', auth.uid());
  END IF;

  INSERT INTO public.company_invites(company_id, email, role)
  VALUES (p_company, v_email, COALESCE(v_target_role, 'VIEWER'::member_role))
  RETURNING token INTO v_token;

  RETURN v_token;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_company_whatsapp_creds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_whatsapp_creds(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.active_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_company_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_active_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_company(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_member(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_payment_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_terms(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.invite_company_member(uuid, text, member_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_company_member(uuid, text, member_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reinvite_company_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reinvite_company_member(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sync_invites_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_invites_for_me() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_company_and_bootstrap(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_company_and_bootstrap(text) TO authenticated, service_role;

REVOKE SELECT ON TABLE public.company_members FROM anon;
REVOKE ALL ON TABLE public.user_active_company FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_active_company TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name = 'v_due_sales_orders'
  ) THEN
    EXECUTE 'REVOKE ALL ON TABLE public.v_due_sales_orders FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.v_due_sales_orders TO service_role';
  END IF;
END
$$;

COMMIT;
