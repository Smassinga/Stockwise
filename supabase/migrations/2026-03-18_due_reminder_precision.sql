BEGIN;

CREATE OR REPLACE FUNCTION public.parse_due_reminder_send_at(
  p_settings jsonb
)
RETURNS time
LANGUAGE sql
IMMUTABLE
AS $$
  WITH due_cfg AS (
    SELECT COALESCE(p_settings->'dueReminders', '{}'::jsonb) AS cfg
  ),
  explicit_time AS (
    SELECT NULLIF(trim(cfg->>'sendAt'), '') AS send_at_text
    FROM due_cfg
  ),
  legacy_time AS (
    SELECT
      CASE
        WHEN jsonb_typeof(cfg->'hours') = 'array' AND jsonb_array_length(cfg->'hours') > 0
          THEN NULLIF(cfg->'hours'->>0, '')::numeric
        ELSE NULL
      END AS hour_value
    FROM due_cfg
  )
  SELECT COALESCE(
    CASE
      WHEN explicit_time.send_at_text ~ '^\d{2}:\d{2}$'
        THEN explicit_time.send_at_text::time
      ELSE NULL
    END,
    make_time(
      GREATEST(0, LEAST(23, floor(COALESCE(legacy_time.hour_value, 9))::int)),
      GREATEST(
        0,
        LEAST(
          59,
          round((COALESCE(legacy_time.hour_value, 9) - floor(COALESCE(legacy_time.hour_value, 9))) * 60)::int
        )
      ),
      0
    )
  )
  FROM explicit_time, legacy_time;
$$;

CREATE OR REPLACE FUNCTION public.parse_due_reminder_lead_days(
  p_settings jsonb
)
RETURNS int[]
LANGUAGE sql
IMMUTABLE
AS $$
  WITH due_cfg AS (
    SELECT CASE
      WHEN jsonb_typeof(COALESCE(p_settings->'dueReminders'->'leadDays', '[]'::jsonb)) = 'array'
        THEN COALESCE(p_settings->'dueReminders'->'leadDays', '[]'::jsonb)
      ELSE '[]'::jsonb
    END AS cfg
  ),
  parsed AS (
    SELECT DISTINCT (value)::int AS offset_days
    FROM due_cfg, jsonb_array_elements_text(cfg)
    WHERE value ~ '^-?\d+$'
  ),
  sorted AS (
    SELECT offset_days
    FROM parsed
    ORDER BY
      CASE
        WHEN offset_days > 0 THEN 0
        WHEN offset_days = 0 THEN 1
        ELSE 2
      END,
      CASE
        WHEN offset_days > 0 THEN -offset_days
        WHEN offset_days < 0 THEN abs(offset_days)
        ELSE 0
      END
  )
  SELECT COALESCE(
    ARRAY(SELECT offset_days FROM sorted),
    ARRAY[]::int[]
  );
$$;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminder_for_company(
  p_company_id uuid,
  p_local_day date,
  p_force boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company record;
  v_settings jsonb := '{}'::jsonb;
  v_due_cfg jsonb := '{}'::jsonb;
  v_timezone text := 'Africa/Maputo';
  v_local_now timestamp without time zone;
  v_run_day date;
  v_send_at time;
  v_send_window_start timestamp without time zone;
  v_send_window_end timestamp without time zone;
  v_lead_days int[];
  v_lang text := 'en';
  v_payload jsonb;
  v_bcc jsonb := '[]'::jsonb;
  v_existing_id bigint;
  v_job_id bigint := 0;
BEGIN
  SELECT
    c.id,
    c.preferred_lang,
    cs.data
  INTO v_company
  FROM public.companies c
  LEFT JOIN public.company_settings cs
    ON cs.company_id = c.id
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_settings := COALESCE(v_company.data, '{}'::jsonb);
  v_due_cfg := COALESCE(v_settings->'dueReminders', '{}'::jsonb);

  IF NOT p_force AND COALESCE(NULLIF(v_due_cfg->>'enabled', '')::boolean, true) = false THEN
    RETURN 0;
  END IF;

  v_timezone := COALESCE(
    NULLIF(v_due_cfg->>'timezone', ''),
    NULLIF(v_settings->'notifications'->>'timezone', ''),
    'Africa/Maputo'
  );
  v_local_now := timezone(v_timezone, now());
  v_run_day := COALESCE(
    CASE WHEN p_force THEN p_local_day ELSE NULL END,
    v_local_now::date
  );
  v_send_at := public.parse_due_reminder_send_at(v_settings);
  v_lead_days := public.parse_due_reminder_lead_days(v_settings);

  IF COALESCE(array_length(v_lead_days, 1), 0) = 0 THEN
    v_lead_days := ARRAY[3, 1, 0, -3];
  END IF;

  v_lang := lower(COALESCE(
    NULLIF(v_company.preferred_lang, ''),
    NULLIF(v_settings->'locale'->>'language', ''),
    'en'
  ));
  IF v_lang NOT IN ('en', 'pt') THEN
    v_lang := 'en';
  END IF;

  IF jsonb_typeof(v_due_cfg->'bcc') = 'array' THEN
    v_bcc := v_due_cfg->'bcc';
  END IF;

  IF NOT p_force THEN
    v_send_window_start := v_local_now::date + v_send_at;
    -- Cron runs every minute. A short buffer keeps minute precision without missing slightly late ticks.
    v_send_window_end := v_send_window_start + interval '2 minutes';

    IF v_local_now < v_send_window_start OR v_local_now >= v_send_window_end THEN
      RETURN 0;
    END IF;
  END IF;

  IF p_force THEN
    DELETE FROM public.due_reminder_queue
    WHERE company_id = p_company_id
      AND run_for_local_date = v_run_day;
  ELSE
    SELECT id
    INTO v_existing_id
    FROM public.due_reminder_queue
    WHERE company_id = p_company_id
      AND run_for_local_date = v_run_day
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN 0;
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'channels', jsonb_build_object('email', true),
    'lead_days', to_jsonb(v_lead_days),
    'bcc', v_bcc,
    'lang', v_lang
  );

  IF NULLIF(v_due_cfg->>'invoiceBaseUrl', '') IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object(
      'invoice_base_url',
      v_due_cfg->>'invoiceBaseUrl'
    );
  END IF;

  v_job_id := public.enqueue_due_reminder(
    p_company_id,
    v_run_day,
    v_timezone,
    v_payload
  );

  RETURN COALESCE(v_job_id, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminder_for_company(
  p_company_id uuid,
  p_local_day date
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.enqueue_due_reminder_for_company(p_company_id, p_local_day, false);
$$;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminders_for_all_companies(
  p_local_day date,
  p_force boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company record;
  v_job_id bigint;
  v_count integer := 0;
BEGIN
  FOR v_company IN
    SELECT id
    FROM public.companies
  LOOP
    v_job_id := public.enqueue_due_reminder_for_company(v_company.id, p_local_day, p_force);
    IF COALESCE(v_job_id, 0) > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminders_for_all_companies(
  p_local_day date
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.enqueue_due_reminders_for_all_companies(p_local_day, false);
$$;

GRANT EXECUTE ON FUNCTION public.parse_due_reminder_send_at(jsonb)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.parse_due_reminder_lead_days(jsonb)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminder_for_company(uuid, date, boolean)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminder_for_company(uuid, date)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders_for_all_companies(date, boolean)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders_for_all_companies(date)
  TO authenticated, anon, service_role;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'due-reminders:enqueue';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'due-reminders:enqueue',
    '* * * * *',
    'SELECT public.enqueue_due_reminders_for_all_companies(CURRENT_DATE, FALSE);'
  );
END $$;

COMMIT;
