BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminders_for_all_companies(
  p_local_day date DEFAULT current_date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  INSERT INTO public.due_reminder_queue (company_id, run_for_local_date, timezone, payload, status, attempts, created_at)
  SELECT
    cs.company_id,
    p_local_day,
    COALESCE(
      cs.data->'dueReminders'->>'timezone',
      cs.data->'notifications'->>'timezone',
      'Africa/Maputo'
    )::text AS tz,
    jsonb_build_object(
      'channels',   jsonb_build_object('email', true),
      'recipients', jsonb_build_object(
        'emails', COALESCE(
          cs.data->'dueReminders'->'recipients',
          cs.data->'notifications'->'recipients'->'emails',
          '[]'::jsonb
        )
      ),
      'bcc',             COALESCE(cs.data->'dueReminders'->'bcc', '[]'::jsonb),
      'lead_days',       COALESCE(cs.data->'dueReminders'->'leadDays', '[3,1,0,-3]'::jsonb),
      'invoice_base_url',COALESCE(cs.data->'dueReminders'->>'invoiceBaseUrl', 'https://app.stockwise.app/invoices')
    ) AS payload,
    'pending'::text AS status,
    0 AS attempts,
    now()
  FROM public.company_settings cs
  JOIN public.companies c ON c.id = cs.company_id
  WHERE COALESCE( (cs.data->'dueReminders'->>'enabled')::boolean, true ) = true
  ON CONFLICT ON CONSTRAINT uq_due_reminder_unique DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.enqueue_due_reminders_for_all_companies(date) IS 'Enqueue one due_reminder_queue job per company for the given local day, using company_settings.data->dueReminders. Respects uq_due_reminder_unique and skips duplicates.';

COMMIT;;
