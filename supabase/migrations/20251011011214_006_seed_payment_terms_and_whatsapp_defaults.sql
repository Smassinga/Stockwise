-- Seed common payment terms per company (idempotent)
WITH companies AS (SELECT id AS company_id FROM public.companies)
INSERT INTO public.payment_terms (company_id, code, name, net_days, description)
SELECT c.company_id, v.code, v.name, v.net_days, v.description
FROM companies c
CROSS JOIN (VALUES
  ('IMMEDIATE','Immediate',0,'Due on receipt'),
  ('NET7','Net 7',7,'Due in 7 days'),
  ('NET14','Net 14',14,'Due in 14 days'),
  ('NET15','Net 15',15,'Due in 15 days'),
  ('NET30','Net 30',30,'Due in 30 days'),
  ('NET45','Net 45',45,'Due in 45 days')
) AS v(code,name,net_days,description)
ON CONFLICT (company_id, code) DO NOTHING;

-- Ensure a company_settings row exists for each company
INSERT INTO public.company_settings (company_id, data)
SELECT id, '{}'::jsonb FROM public.companies co
ON CONFLICT (company_id) DO NOTHING;

-- Add whatsapp defaults only if missing (do not overwrite existing)
UPDATE public.company_settings cs
SET data = jsonb_set(
  cs.data,
  '{whatsapp}',
  jsonb_build_object(
    'enabled', true,
    'default_language', 'en',
    'customer_template', 'so_due_reminder',
    'internal_template', 'po_due_alert',
    'ops_msisdn_list', '[]'::jsonb,
    'send_days_before_due', '[3,0]'::jsonb,
    'respect_business_hours', true,
    'allow_marketing', false
  ),
  true
)
WHERE (cs.data->'whatsapp') IS NULL;;
