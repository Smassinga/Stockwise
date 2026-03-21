BEGIN;

-- Ensure http/pg_cron if available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'http') THEN
    CREATE EXTENSION IF NOT EXISTS http;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  END IF;
END$$;

-- Helper to enqueue with sane defaults
CREATE OR REPLACE FUNCTION public.enqueue_due_reminder_for_company(p_company_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hours int[]; v_tz text; v_today date; v_payload jsonb; v_job_id bigint;
BEGIN
  SELECT COALESCE(settings->>'timezone','Africa/Maputo'),
         COALESCE((settings->'reminders'->'hours')::int[], ARRAY[9])
  INTO v_tz, v_hours
  FROM public.company_settings
  WHERE company_id = p_company_id;

  v_today := CURRENT_DATE;
  v_payload := jsonb_build_object(
    'channels', jsonb_build_object('email', true),
    'lead_days', jsonb_build_array(3,1,0,-3)
  );

  SELECT public.enqueue_due_reminder(p_company_id, v_today, COALESCE(v_tz,'Africa/Maputo'), v_payload) INTO v_job_id;
  RETURN v_job_id;
END$$;

-- HTTP kicker for the worker (expects custom GUCs set; safe if missing)
CREATE OR REPLACE FUNCTION public.kick_due_reminder_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE url text := current_setting('supabase.functions.url', true);
        secret text := current_setting('supabase.functions.reminder_secret', true);
BEGIN
  IF url IS NULL THEN RETURN; END IF;
  PERFORM http(
      'POST',
      url || '/due-reminder-worker',
      ARRAY[http_header('x-webhook-secret', COALESCE(secret,''))],
      NULL, NULL, NULL
    );
END$$;

-- Schedule every 15 minutes via pg_cron (idempotent)
DO $cron$
DECLARE job_exists boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'so-due-reminders-every-15m') INTO job_exists;
    IF NOT job_exists THEN
      PERFORM cron.schedule('so-due-reminders-every-15m', '*/15 * * * *', $$SELECT public.kick_due_reminder_worker();$$);
    END IF;
  END IF;
END
$cron$;

COMMIT;;
