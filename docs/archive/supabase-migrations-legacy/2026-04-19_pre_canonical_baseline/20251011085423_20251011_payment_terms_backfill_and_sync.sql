-- 1) Ensure default payment terms exist per company that appears in customers or sales_orders
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid() if not present

WITH companies AS (
  SELECT DISTINCT company_id FROM public.customers WHERE company_id IS NOT NULL
  UNION
  SELECT DISTINCT company_id FROM public.sales_orders WHERE company_id IS NOT NULL
),
defaults AS (
  SELECT * FROM (VALUES
    ('IMMEDIATE','Immediate',0),
    ('NET 7','Net 7',7),
    ('NET 10','Net 10',10),
    ('NET 15','Net 15',15),
    ('NET 30','Net 30',30),
    ('NET 45','Net 45',45),
    ('NET 60','Net 60',60)
  ) AS t(code,name,net_days)
)
INSERT INTO public.payment_terms(id, company_id, code, name, net_days, created_at)
SELECT gen_random_uuid(), c.company_id, d.code, d.name, d.net_days, now()
FROM companies c
CROSS JOIN defaults d
LEFT JOIN public.payment_terms pt ON pt.company_id = c.company_id AND UPPER(pt.code) = UPPER(d.code)
WHERE pt.id IS NULL;

-- 2) Backfill payment_terms_id on customers from text column (with normalization)
WITH norm AS (
  SELECT
    c.id,
    c.company_id,
    CASE
      WHEN c.payment_terms IS NULL OR btrim(c.payment_terms) = '' THEN NULL
      WHEN UPPER(btrim(c.payment_terms)) IN ('COD','CASH','IMMEDIATE') THEN 'IMMEDIATE'
      WHEN UPPER(c.payment_terms) LIKE 'NET%7%' THEN 'NET 7'
      WHEN UPPER(c.payment_terms) LIKE 'NET%10%' THEN 'NET 10'
      WHEN UPPER(c.payment_terms) LIKE 'NET%15%' THEN 'NET 15'
      WHEN UPPER(c.payment_terms) LIKE 'NET%30%' THEN 'NET 30'
      WHEN UPPER(c.payment_terms) LIKE 'NET%45%' THEN 'NET 45'
      WHEN UPPER(c.payment_terms) LIKE 'NET%60%' THEN 'NET 60'
      ELSE NULL
    END AS code
  FROM public.customers c
)
UPDATE public.customers c
SET payment_terms_id = pt.id
FROM norm n
JOIN public.payment_terms pt
  ON pt.company_id = n.company_id AND pt.code = n.code
WHERE c.id = n.id
  AND n.code IS NOT NULL
  AND (c.payment_terms_id IS NULL OR c.payment_terms_id <> pt.id);

-- 3) Backfill payment_terms_id on sales_orders from text column (with normalization)
WITH norm AS (
  SELECT
    so.id,
    so.company_id,
    CASE
      WHEN so.payment_terms IS NULL OR btrim(so.payment_terms) = '' THEN NULL
      WHEN UPPER(btrim(so.payment_terms)) IN ('COD','CASH','IMMEDIATE') THEN 'IMMEDIATE'
      WHEN UPPER(so.payment_terms) LIKE 'NET%7%' THEN 'NET 7'
      WHEN UPPER(so.payment_terms) LIKE 'NET%10%' THEN 'NET 10'
      WHEN UPPER(so.payment_terms) LIKE 'NET%15%' THEN 'NET 15'
      WHEN UPPER(so.payment_terms) LIKE 'NET%30%' THEN 'NET 30'
      WHEN UPPER(so.payment_terms) LIKE 'NET%45%' THEN 'NET 45'
      WHEN UPPER(so.payment_terms) LIKE 'NET%60%' THEN 'NET 60'
      ELSE NULL
    END AS code
  FROM public.sales_orders so
)
UPDATE public.sales_orders so
SET payment_terms_id = pt.id
FROM norm n
JOIN public.payment_terms pt
  ON pt.company_id = n.company_id AND pt.code = n.code
WHERE so.id = n.id
  AND n.code IS NOT NULL
  AND (so.payment_terms_id IS NULL OR so.payment_terms_id <> pt.id);

-- 4) Keep columns in sync going forward while frontend migrates
CREATE OR REPLACE FUNCTION public.sync_payment_terms_customers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_terms_id IS NOT NULL AND (NEW.payment_terms IS NULL OR NEW.payment_terms = '') THEN
    SELECT code INTO NEW.payment_terms FROM public.payment_terms WHERE id = NEW.payment_terms_id;
  ELSIF (NEW.payment_terms_id IS NULL) AND NEW.payment_terms IS NOT NULL THEN
    SELECT pt.id INTO NEW.payment_terms_id
    FROM public.payment_terms pt
    WHERE pt.company_id = NEW.company_id
      AND UPPER(pt.code) = UPPER(NEW.payment_terms)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payment_terms_customers ON public.customers;
CREATE TRIGGER trg_sync_payment_terms_customers
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_terms_customers();

CREATE OR REPLACE FUNCTION public.sync_payment_terms_sales_orders()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_terms_id IS NOT NULL AND (NEW.payment_terms IS NULL OR NEW.payment_terms = '') THEN
    SELECT code INTO NEW.payment_terms FROM public.payment_terms WHERE id = NEW.payment_terms_id;
  ELSIF (NEW.payment_terms_id IS NULL) AND NEW.payment_terms IS NOT NULL THEN
    SELECT pt.id INTO NEW.payment_terms_id
    FROM public.payment_terms pt
    WHERE pt.company_id = NEW.company_id
      AND UPPER(pt.code) = UPPER(NEW.payment_terms)
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payment_terms_sales_orders ON public.sales_orders;
CREATE TRIGGER trg_sync_payment_terms_sales_orders
BEFORE INSERT OR UPDATE ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_terms_sales_orders();

-- 5) Add FKs if missing (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_customers_payment_terms') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT fk_customers_payment_terms
      FOREIGN KEY (payment_terms_id) REFERENCES public.payment_terms(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_orders_payment_terms') THEN
    ALTER TABLE public.sales_orders
      ADD CONSTRAINT fk_sales_orders_payment_terms
      FOREIGN KEY (payment_terms_id) REFERENCES public.payment_terms(id) ON DELETE SET NULL;
  END IF;
END$$;;
