CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  target_msisdn text NOT NULL CHECK (target_msisdn ~ '^\+[1-9][0-9]{7,14}$'),
  category text NOT NULL CHECK (category IN ('utility','marketing')),
  type text NOT NULL CHECK (type IN ('template','text')),
  template_name text,
  template_lang text,
  template_components jsonb,
  body_text text,
  related_type text CHECK (related_type IN ('PO','SO')),
  related_id uuid,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','read','failed','canceled')),
  provider_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS whatsapp_outbox_company_status_sched_idx
  ON public.whatsapp_outbox (company_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  provider_message_id text,
  event_type text NOT NULL,
  event jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_webhook_events_company_msgid_idx
  ON public.whatsapp_webhook_events (company_id, provider_message_id);

ALTER TABLE public.whatsapp_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  BEGIN
    CREATE POLICY whatsapp_outbox_select ON public.whatsapp_outbox
      FOR SELECT USING (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY whatsapp_outbox_insert ON public.whatsapp_outbox
      FOR INSERT WITH CHECK (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY whatsapp_outbox_update ON public.whatsapp_outbox
      FOR UPDATE USING (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY whatsapp_webhook_events_select ON public.whatsapp_webhook_events
      FOR SELECT USING (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY whatsapp_webhook_events_insert ON public.whatsapp_webhook_events
      FOR INSERT WITH CHECK (company_id = current_company_id());
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;;
