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
  order_candidates AS (
    SELECT
      'sales_order'::text AS anchor_kind,
      so.id AS anchor_id,
      COALESCE(NULLIF(so.order_no, ''), NULLIF(so.code, ''), so.id::text) AS document_reference,
      so.id AS sales_order_id,
      COALESCE(NULLIF(so.order_no, ''), NULLIF(so.code, ''), so.id::text) AS sales_order_reference,
      NULL::uuid AS sales_invoice_id,
      NULL::text AS sales_invoice_reference,
      sos.due_date AS due_date,
      sos.legacy_outstanding_base::numeric AS amount,
      COALESCE(NULLIF(so.bill_to_email, ''), NULLIF(c.email, '')) AS email,
      COALESCE(NULLIF(c.name, ''), NULLIF(sos.counterparty_name, ''), NULLIF(so.customer, '')) AS customer_name,
      (sos.due_date - p_local_day) AS days_until_due,
      sos.currency_code,
      sos.settlement_status,
      NULL::text AS resolution_status,
      NULL::text AS language_hint
    FROM public.v_sales_order_state sos
    JOIN public.sales_orders so
      ON so.id = sos.id
    LEFT JOIN public.customers c
      ON c.id = so.customer_id
    WHERE sos.company_id = p_company_id
      AND sos.workflow_status = 'approved'
      AND sos.financial_anchor = 'legacy_order_link'
      AND sos.due_date IS NOT NULL
      AND sos.legacy_outstanding_base > 0.005
  ),
  invoice_candidates AS (
    SELECT
      'sales_invoice'::text AS anchor_kind,
      si.id AS anchor_id,
      COALESCE(NULLIF(si.internal_reference, ''), si.id::text) AS document_reference,
      si.sales_order_id AS sales_order_id,
      COALESCE(NULLIF(so.order_no, ''), NULLIF(so.code, ''), so.id::text) AS sales_order_reference,
      si.id AS sales_invoice_id,
      COALESCE(NULLIF(si.internal_reference, ''), si.id::text) AS sales_invoice_reference,
      vis.due_date AS due_date,
      vis.outstanding_base::numeric AS amount,
      COALESCE(NULLIF(so.bill_to_email, ''), NULLIF(c.email, '')) AS email,
      COALESCE(NULLIF(si.buyer_legal_name_snapshot, ''), NULLIF(vis.counterparty_name, ''), NULLIF(c.name, '')) AS customer_name,
      (vis.due_date - p_local_day) AS days_until_due,
      vis.currency_code,
      vis.settlement_status,
      vis.resolution_status,
      CASE
        WHEN lower(COALESCE(si.document_language_code_snapshot, '')) LIKE 'pt%' THEN 'pt'
        WHEN lower(COALESCE(si.document_language_code_snapshot, '')) LIKE 'en%' THEN 'en'
        ELSE NULL
      END::text AS language_hint
    FROM public.v_sales_invoice_state vis
    JOIN public.sales_invoices si
      ON si.id = vis.id
    LEFT JOIN public.sales_orders so
      ON so.id = si.sales_order_id
    LEFT JOIN public.customers c
      ON c.id = si.customer_id
    WHERE vis.company_id = p_company_id
      AND si.document_workflow_status = 'issued'
      AND vis.due_date IS NOT NULL
      AND vis.outstanding_base > 0.005
  ),
  filtered AS (
    SELECT candidate.*
    FROM (
      SELECT * FROM order_candidates
      UNION ALL
      SELECT * FROM invoice_candidates
    ) candidate
    JOIN cfg
      ON cfg.d = candidate.days_until_due
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'anchor_kind', anchor_kind,
               'anchor_id', anchor_id,
               'document_reference', document_reference,
               'due_date', to_char(due_date, 'YYYY-MM-DD'),
               'amount', amount,
               'email', email,
               'customer_name', customer_name,
               'days_until_due', days_until_due,
               'currency_code', currency_code,
               'settlement_status', settlement_status,
               'resolution_status', resolution_status,
               'sales_order_id', sales_order_id,
               'sales_order_reference', sales_order_reference,
               'sales_invoice_id', sales_invoice_id,
               'sales_invoice_reference', sales_invoice_reference,
               'language_hint', language_hint
             )
             ORDER BY days_until_due, due_date, document_reference
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
  v_document_base_url text;
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

  v_document_base_url := COALESCE(
    NULLIF(v_due_cfg->>'documentBaseUrl', ''),
    NULLIF(v_due_cfg->>'invoiceBaseUrl', '')
  );

  IF v_document_base_url IS NOT NULL THEN
    v_payload := v_payload
      || jsonb_build_object('document_base_url', v_document_base_url)
      || jsonb_build_object('invoice_base_url', v_document_base_url);
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

COMMIT;
