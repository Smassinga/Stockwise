-- Admin-only (per company) UPSERT for whatsapp_credentials via SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.upsert_whatsapp_credentials(
  p_company_id uuid,
  p_phone_number_id text,
  p_access_token text,
  p_waba_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  role text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Require OWNER or ADMIN in company_members
  SELECT cm.role INTO role
  FROM public.company_members cm
  WHERE cm.company_id = p_company_id AND cm.user_id = uid AND cm.status = 'active'
  LIMIT 1;

  IF role IS NULL OR role NOT IN ('OWNER','ADMIN') THEN
    RAISE EXCEPTION 'permission denied: admin required';
  END IF;

  INSERT INTO public.whatsapp_credentials(company_id, phone_number_id, access_token, waba_id)
  VALUES (p_company_id, p_phone_number_id, p_access_token, p_waba_id)
  ON CONFLICT (company_id) DO UPDATE
    SET phone_number_id = EXCLUDED.phone_number_id,
        access_token = EXCLUDED.access_token,
        waba_id = EXCLUDED.waba_id,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_whatsapp_credentials(uuid, text, text, text) TO authenticated;;
