-- Per-company WhatsApp credentials (isolation by tenant)
CREATE TABLE IF NOT EXISTS public.whatsapp_credentials (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  waba_id text,
  phone_number_id text NOT NULL,
  -- Store short-lived tokens here only if you must; prefer external secret manager.
  access_token text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.whatsapp_credentials ENABLE ROW LEVEL SECURITY;

-- No direct client access; only service role or definer functions.
DO $$ BEGIN
  BEGIN
    CREATE POLICY whatsapp_credentials_deny_all ON public.whatsapp_credentials
      FOR ALL USING (false) WITH CHECK (false);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Helper function to fetch creds (for server-side or privileged RPCs if needed)
CREATE OR REPLACE FUNCTION public.get_company_whatsapp_creds(p_company_id uuid)
RETURNS TABLE(waba_id text, phone_number_id text, access_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public AS $$
  SELECT waba_id, phone_number_id, access_token
  FROM public.whatsapp_credentials
  WHERE company_id = p_company_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_whatsapp_creds(uuid) TO anon, authenticated;

-- Optional: trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;

DROP TRIGGER IF EXISTS set_updated_at_whatsapp_credentials ON public.whatsapp_credentials;
CREATE TRIGGER set_updated_at_whatsapp_credentials
BEFORE UPDATE ON public.whatsapp_credentials
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
;
