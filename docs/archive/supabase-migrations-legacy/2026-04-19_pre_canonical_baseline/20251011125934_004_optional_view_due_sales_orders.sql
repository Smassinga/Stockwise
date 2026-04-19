CREATE OR REPLACE VIEW public.v_due_sales_orders AS
SELECT
  so.company_id,
  so.id AS so_id,
  so.code,
  so.customer_id,
  so.due_date,
  so.total AS total_amount,
  so.currency_code,
  (SELECT COALESCE(SUM(ct.amount_base / NULLIF(so.fx_to_base, 0)), 0)
     FROM public.cash_transactions ct
     WHERE ct.company_id = so.company_id
       AND ct.ref_type = 'SO'
       AND ct.ref_id = so.id) AS paid_amount,
  GREATEST(so.total - (
    SELECT COALESCE(SUM(ct.amount_base / NULLIF(so.fx_to_base, 0)), 0)
    FROM public.cash_transactions ct
    WHERE ct.company_id = so.company_id
      AND ct.ref_type = 'SO'
      AND ct.ref_id = so.id
  ), 0) AS balance_due
FROM public.sales_orders so
WHERE so.status NOT IN ('cancelled','closed')
  AND so.due_date IS NOT NULL;;
