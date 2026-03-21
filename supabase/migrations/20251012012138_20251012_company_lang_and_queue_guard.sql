BEGIN;
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS preferred_lang text
  CHECK (preferred_lang IN ('en','pt'));

-- Normalize Mozambique spellings to ISO
UPDATE public.companies
SET country_code = 'MZ'
WHERE country_code ILIKE 'mozambique'
   OR country_code ILIKE 'moçambique'
   OR country_code ILIKE 'mocambique';

-- Uppercase any 2-letter codes
UPDATE public.companies
SET country_code = UPPER(country_code)
WHERE country_code ~ '^[a-z]{2}$';

-- Guard: only one job per company per local day
CREATE UNIQUE INDEX IF NOT EXISTS uq_due_reminder_queue_company_day
  ON public.due_reminder_queue(company_id, run_for_local_date);
COMMIT;;
