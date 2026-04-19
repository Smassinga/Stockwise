CREATE OR REPLACE FUNCTION public.build_due_reminder_batch(
  p_company_id uuid,
  p_local_day date,
  p_timezone text,
  p_lead_days int[]
)
RETURNS jsonb
LANGUAGE sql
AS $$
WITH base AS (
  SELECT
    so.id,
    COALESCE(so.public_id, so.code, 'SO-'||left(so.id::text,8)) AS so_code,
    so.total_amount::numeric AS amount,
    COALESCE(so.currency_code, 'MZN') AS currency,
    so.bill_to_name AS customer_name,
    so.bill_to_email,
    so.order_date::date,
    so.due_date::date,
    so.payment_terms,
    so.payment_terms_id,
    (CASE
      WHEN so.due_date IS NOT NULL THEN so.due_date::date
      WHEN so.payment_terms_id IS NOT NULL THEN
        so.order_date::date + COALESCE((SELECT net_days FROM public.payment_terms pt WHERE pt.id = so.payment_terms_id),0)
      WHEN COALESCE(upper(btrim(so.payment_terms)),'') IN ('COD','CASH','IMMEDIATE') THEN so.order_date::date
      WHEN upper(COALESCE(so.payment_terms,'')) LIKE 'NET %' THEN
        so.order_date::date + COALESCE(NULLIF(regexp_replace(upper(so.payment_terms), '^NET\s+',''),'' )::int,0)
      ELSE so.order_date::date
    END) AS effective_due_date
  FROM public.sales_orders so
  WHERE so.company_id = p_company_id
    AND COALESCE(so.status::text,'') NOT IN ('cancelled','void','draft')
), want AS (
  SELECT b.*, (b.effective_due_date - p_local_day)::int AS lead
  FROM base b
  WHERE (b.effective_due_date - p_local_day)::int = ANY(p_lead_days)
), out AS (
  SELECT jsonb_build_object(
    'reminders', COALESCE(jsonb_agg(jsonb_build_object(
      'so_id', w.id,
      'so_code', w.so_code,
      'amount', w.amount,
      'currency', w.currency,
      'customer_name', w.customer_name,
      'due_date', w.effective_due_date::text,
      'days_until_due', w.lead,
      'email', NULLIF(w.bill_to_email,'')
    ) ORDER BY w.effective_due_date, w.so_code), '[]'::jsonb)
  ) AS payload
  FROM want w
)
SELECT (SELECT payload FROM out);
$$;;
