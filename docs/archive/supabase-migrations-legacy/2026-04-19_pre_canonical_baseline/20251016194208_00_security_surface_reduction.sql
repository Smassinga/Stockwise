DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_command_log','ai_notes','ai_ops_allowlist','ai_probe','ai_schema_cache','ai_tmp_probe',
    'app_secrets','company_digest_state','digest_events','digest_queue','number_sequences','user_profiles'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', t);
  END LOOP;
END$$;;
