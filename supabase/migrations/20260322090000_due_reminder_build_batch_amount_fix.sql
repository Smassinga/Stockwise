BEGIN;

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
      coalesce(so.total_amount, so.total, 0) AS amount,
      c.email AS email,
      c.name AS customer_name,
      (so.due_date - p_local_day) AS days_until_due
    FROM public.sales_orders so
    JOIN public.customers c
      ON c.id = so.customer_id
    WHERE so.company_id = p_company_id
      AND so.due_date IS NOT NULL
      AND coalesce(so.total_amount, so.total, 0) > 0
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

COMMIT;
