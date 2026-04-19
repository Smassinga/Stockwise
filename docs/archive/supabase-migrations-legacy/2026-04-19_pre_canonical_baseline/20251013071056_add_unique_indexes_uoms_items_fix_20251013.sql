BEGIN;
CREATE EXTENSION IF NOT EXISTS citext;

-- Conditionally add the unique constraint for uom_conversions (company_id, from_uom_id, to_uom_id)
DO $$
DECLARE
  con_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class t   ON t.oid = c.conrelid
    JOIN   pg_namespace n ON n.oid = t.relnamespace
    WHERE  c.conname = 'uom_conversions_unique_company_from_to'
           AND n.nspname = 'public'
  ) INTO con_exists;

  IF NOT con_exists THEN
    EXECUTE 'ALTER TABLE public.uom_conversions
             ADD CONSTRAINT uom_conversions_unique_company_from_to
             UNIQUE (company_id, from_uom_id, to_uom_id)';
  END IF;
END$$;

-- Supporting lookup index (if absent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'i' AND c.relname = 'uom_conversions_company_lookup_idx' AND n.nspname='public') THEN
    CREATE INDEX uom_conversions_company_lookup_idx
      ON public.uom_conversions (company_id, from_uom_id, to_uom_id);
  END IF;
END$$;

-- Case-insensitive SKU uniqueness within a company
CREATE UNIQUE INDEX IF NOT EXISTS items_company_sku_ci_unique
  ON public.items (company_id, lower(sku));

COMMIT;;
