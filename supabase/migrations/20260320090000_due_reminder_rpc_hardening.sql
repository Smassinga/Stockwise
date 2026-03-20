BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminder(
  p_company_id uuid,
  p_local_day date,
  p_timezone text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.due_reminder_queue (
    company_id,
    run_for_local_date,
    timezone,
    payload,
    status,
    created_at
  ) VALUES (
    p_company_id,
    p_local_day,
    p_timezone,
    p_payload,
    'pending',
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION public.build_due_reminder_batch(
  p_company_id uuid,
  p_local_day date,
  p_timezone text,
  p_lead_days int[] DEFAULT ARRAY[3,1,0,-3]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_rows jsonb;
BEGIN
  v_start_utc := timezone('UTC', timezone(p_timezone, p_local_day::timestamp));
  v_end_utc := v_start_utc + interval '1 day';

  WITH cfg AS (
    SELECT unnest(p_lead_days) AS d
  ),
  candidates AS (
    SELECT
      so.id AS so_id,
      so.code AS so_code,
      so.due_date AS due_date,
      coalesce(so.total_amount, so.total, so.grand_total, 0) AS amount,
      c.email AS email,
      c.name AS customer_name,
      (so.due_date - p_local_day) AS days_until_due
    FROM public.sales_orders so
    JOIN public.customers c
      ON c.id = so.customer_id
    WHERE so.company_id = p_company_id
      AND so.due_date IS NOT NULL
      AND coalesce(so.total_amount, so.total, so.grand_total, 0) > 0
      AND coalesce(lower(so.status), '') NOT IN ('cancelled', 'void', 'draft')
  ),
  filtered AS (
    SELECT *
    FROM candidates cand
    JOIN cfg
      ON cfg.d = cand.days_until_due
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'so_id', so_id,
               'so_code', so_code,
               'due_date', to_char(due_date, 'YYYY-MM-DD'),
               'amount', amount,
               'email', email,
               'customer_name', customer_name,
               'days_until_due', days_until_due
             )
             ORDER BY days_until_due, due_date, so_code
           ),
           '[]'::jsonb
         )
    INTO v_rows
  FROM filtered;

  RETURN jsonb_build_object(
    'window', jsonb_build_object(
      'local_day', to_char(p_local_day, 'YYYY-MM-DD'),
      'timezone', p_timezone,
      'start_utc', to_char(v_start_utc, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
      'end_utc', to_char((v_end_utc - interval '1 second'), 'YYYY-MM-DD"T"HH24:MI:SSOF')
    ),
    'reminders', v_rows
  );
END
$$;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminder_for_company(
  p_company_id uuid,
  p_local_day date,
  p_force boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.enqueue_due_reminders_for_all_companies(p_local_day, false);
$$;

REVOKE ALL ON FUNCTION public.parse_due_reminder_send_at(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.parse_due_reminder_lead_days(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_due_reminder(uuid, date, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_due_reminder_batch(uuid, date, text, int[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_due_reminder_for_company(uuid, date, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_due_reminder_for_company(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_due_reminders_for_all_companies(date, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_due_reminders_for_all_companies(date)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.parse_due_reminder_send_at(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.parse_due_reminder_lead_days(jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminder(uuid, date, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.build_due_reminder_batch(uuid, date, text, int[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminder_for_company(uuid, date, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminder_for_company(uuid, date)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders_for_all_companies(date, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders_for_all_companies(date)
  TO service_role;

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.invoke_due_reminder_worker()',
    'public.kick_due_reminder_worker()'
  ]
  LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
    END IF;
  END LOOP;
END
$$;

COMMIT;
