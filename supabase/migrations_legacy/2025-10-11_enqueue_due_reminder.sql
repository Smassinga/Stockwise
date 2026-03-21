BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_due_reminder(
  p_company_id uuid,
  p_local_day date,
  p_timezone text,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

GRANT EXECUTE ON FUNCTION public.enqueue_due_reminder(uuid, date, text, jsonb)
  TO authenticated, anon, service_role;

COMMIT;