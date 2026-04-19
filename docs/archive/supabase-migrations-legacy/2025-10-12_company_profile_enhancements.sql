BEGIN;

-- Add explicit preferred language (optional but recommended)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS preferred_lang text
  CHECK (preferred_lang IN ('en','pt') OR preferred_lang IS NULL);

-- Normalize Mozambique spellings to ISO code
UPDATE public.companies
SET country_code = 'MZ'
WHERE upper(country_code) IN ('MOZAMBIQUE','MOÇAMBIQUE','MOCAMBIQUE','MOZ','MOC');

-- Optional: constrain country_code to 2 letters if you're ready on the UI
-- ALTER TABLE public.companies
--   ADD CONSTRAINT companies_country_code_iso2
--   CHECK (country_code IS NULL OR country_code ~ '^[A-Za-z]{2}$');

COMMIT;