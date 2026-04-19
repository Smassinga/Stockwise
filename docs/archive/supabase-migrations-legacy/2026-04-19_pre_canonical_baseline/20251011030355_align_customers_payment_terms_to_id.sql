BEGIN;

-- 1) Ensure column exists
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_terms_id uuid NULL
  REFERENCES public.payment_terms(id) ON DELETE SET NULL;

-- 2) Backfill from legacy text column (payment_terms) when id is null
WITH norm AS (
  SELECT id AS customer_id, upper(trim(payment_terms)) AS pt
  FROM public.customers
  WHERE payment_terms IS NOT NULL AND payment_terms_id IS NULL
),
match_direct AS (
  SELECT n.customer_id, pt.id AS terms_id
  FROM norm n
  JOIN public.payment_terms pt
    ON upper(pt.code) = n.pt OR upper(pt.name) = n.pt
),
match_alias AS (
  SELECT n.customer_id, pt.id AS terms_id
  FROM norm n
  JOIN public.payment_terms pt
    ON (n.pt IN ('COD','CASH ON DELIVERY','IMMEDIATE','IMEDIATO') AND pt.code = 'IMMEDIATE')
    OR (n.pt IN ('NET 7','NET7')  AND pt.code = 'NET_7')
    OR (n.pt IN ('NET 10','NET10') AND pt.code = 'NET_10')
    OR (n.pt IN ('NET 15','NET15') AND pt.code = 'NET_15')
    OR (n.pt IN ('NET 30','NET30') AND pt.code = 'NET_30')
    OR (n.pt IN ('NET 45','NET45') AND pt.code = 'NET_45')
    OR (n.pt IN ('NET 60','NET60') AND pt.code = 'NET_60')
)
UPDATE public.customers c
SET payment_terms_id = COALESCE(md.terms_id, ma.terms_id)
FROM match_direct md
FULL OUTER JOIN match_alias ma ON ma.customer_id = md.customer_id
WHERE c.id = COALESCE(md.customer_id, ma.customer_id)
  AND c.payment_terms_id IS NULL;

-- 3) Keep legacy text in sync going forward (for UI/compat).
CREATE OR REPLACE FUNCTION public.sync_customer_payment_terms_text()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  IF NEW.payment_terms_id IS NOT NULL THEN
     SELECT code INTO v FROM public.payment_terms WHERE id = NEW.payment_terms_id;
     NEW.payment_terms := v;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_customer_terms_text ON public.customers;
CREATE TRIGGER trg_sync_customer_terms_text
BEFORE INSERT OR UPDATE OF payment_terms_id
ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_payment_terms_text();

COMMIT;;
