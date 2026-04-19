BEGIN;

-- 1) Ensure due_date column exists on sales_orders
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS due_date date NULL;

-- 2) Helper: compute due date from order_date + terms (IMMEDIATE -> same day)
CREATE OR REPLACE FUNCTION public.compute_due_date(p_order_date date, p_terms_id uuid)
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN p_order_date IS NULL THEN NULL
           WHEN p_terms_id IS NULL THEN p_order_date
           ELSE p_order_date + COALESCE(pt.net_days, 0)
         END
  FROM public.payment_terms pt
  WHERE pt.id = p_terms_id;
$$;

-- 3) Trigger to keep due_date in sync on insert/update
CREATE OR REPLACE FUNCTION public.trg_sales_orders_set_due_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := public.compute_due_date(NEW.order_date, NEW.payment_terms_id);
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_sales_orders_set_due_date ON public.sales_orders;
CREATE TRIGGER trg_sales_orders_set_due_date
BEFORE INSERT OR UPDATE OF order_date, payment_terms_id
ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_sales_orders_set_due_date();

-- 4) Backfill missing due_date from existing data
UPDATE public.sales_orders so
SET due_date = public.compute_due_date(so.order_date, so.payment_terms_id)
WHERE so.due_date IS NULL;

COMMIT;;
