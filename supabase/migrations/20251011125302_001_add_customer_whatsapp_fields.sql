ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp_msisdn text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_source text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_whatsapp_msisdn_ck'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_whatsapp_msisdn_ck
      CHECK (whatsapp_msisdn IS NULL OR whatsapp_msisdn ~ '^\+[1-9][0-9]{7,14}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS customers_company_msisdn_idx
  ON public.customers (company_id, whatsapp_msisdn)
  WHERE whatsapp_msisdn IS NOT NULL;;
