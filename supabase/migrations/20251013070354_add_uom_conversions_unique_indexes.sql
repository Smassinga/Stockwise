-- Ensure unique constraints for company-scoped and global UoM conversions
-- Company-specific conversions: one row per (company_id, from_uom_id, to_uom_id)
CREATE UNIQUE INDEX IF NOT EXISTS uom_conversions_uniq_company_from_to
  ON public.uom_conversions (company_id, from_uom_id, to_uom_id)
  WHERE company_id IS NOT NULL;

-- Global default conversions (company_id IS NULL): one row per (from_uom_id, to_uom_id)
CREATE UNIQUE INDEX IF NOT EXISTS uom_conversions_uniq_global_from_to
  ON public.uom_conversions (from_uom_id, to_uom_id)
  WHERE company_id IS NULL;

-- Optional: basic sanity on factor values (kept lightweight to avoid breaking existing rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uom_conversions_factor_positive'
  ) THEN
    ALTER TABLE public.uom_conversions
      ADD CONSTRAINT uom_conversions_factor_positive CHECK (factor > 0);
  END IF;
END$$;;
