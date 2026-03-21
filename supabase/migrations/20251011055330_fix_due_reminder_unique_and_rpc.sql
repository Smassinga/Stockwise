-- 1) Ensure unique index exists with a stable name used by ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS uq_due_reminder_unique
  ON public.due_reminder_queue (company_id, run_for_local_date, timezone);

-- 2) Create/replace RPC to enqueue reminders (force-capable)
CREATE OR REPLACE FUNCTION public.enqueue_due_reminders_for_all_companies(
  p_local_day date,
  p_force boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH cfg AS (
    SELECT
      cs.company_id,
      COALESCE(cs.data->'dueReminders'->>'timezone', cs.data->'notifications'->>'timezone','Africa/Maputo') AS tz,
      COALESCE(cs.data->'dueReminders'->'leadDays','[3,1,0,-3]'::jsonb) AS lead_days,
      COALESCE(cs.data->'dueReminders'->'recipients','[]'::jsonb) AS recipients,
      COALESCE(cs.data->'dueReminders'->'bcc','[]'::jsonb) AS bcc,
      COALESCE(cs.data->'dueReminders'->>'invoiceBaseUrl','https://app.stockwise.app/invoices') AS invoice_base_url,
      COALESCE(cs.data->'dueReminders'->'hours','[9]'::jsonb) AS hours
    FROM public.company_settings cs
    WHERE COALESCE( (cs.data->'dueReminders'->>'enabled')::boolean, true) = true
  ), want_now AS (
    SELECT c.*,
      (date_part('hour', timezone(c.tz, now()))::int) AS local_hour,
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(c.hours) h
        WHERE (h::int) = date_part('hour', timezone(c.tz, now()))::int
      ) AS hour_match
    FROM cfg c
  ), to_enqueue AS (
    SELECT
      w.company_id,
      p_local_day::date AS run_for_local_date,
      w.tz::text AS timezone,
      jsonb_build_object(
        'channels', jsonb_build_object('email', true),
        'recipients', jsonb_build_object('emails', w.recipients),
        'lead_days', w.lead_days,
        'bcc', w.bcc,
        'invoice_base_url', w.invoice_base_url
      ) AS payload
    FROM want_now w
    LEFT JOIN public.due_reminder_queue q
      ON q.company_id = w.company_id
     AND q.run_for_local_date = p_local_day
     AND q.timezone = w.tz
    WHERE (p_force OR w.hour_match)
      AND (p_force OR q.id IS NULL)
  )
  INSERT INTO public.due_reminder_queue(company_id, run_for_local_date, timezone, payload, status, attempts, created_at)
  SELECT company_id, run_for_local_date, timezone, payload, 'pending', 0, now()
  FROM to_enqueue
  ON CONFLICT ON CONSTRAINT uq_due_reminder_unique
  DO UPDATE SET
    payload = EXCLUDED.payload,
    status = 'pending',
    attempts = 0,
    next_attempt_at = NULL,
    processed_at = NULL
  WHERE p_force;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 3) Make the function callable from the client
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders_for_all_companies(date, boolean) TO anon, authenticated;;
