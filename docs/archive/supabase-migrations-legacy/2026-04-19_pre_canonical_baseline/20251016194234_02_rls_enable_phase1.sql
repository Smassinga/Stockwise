DO $$ BEGIN
  PERFORM 1;
END $$;

-- Enable RLS on target tables (idempotent-ish: check catalog first)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r'
             AND c.relname IN ('ai_command_log','ai_notes','ai_ops_allowlist','ai_probe','ai_schema_cache','ai_tmp_probe','app_secrets','company_digest_state','digest_events','digest_queue','number_sequences','user_profiles')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END$$;

-- Minimal policies: service_role only (create if missing)
DO $$
DECLARE t text; polname text; sql text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_secrets','digest_queue','company_digest_state','digest_events','number_sequences'] LOOP
    polname := t||'_service_only';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=polname) THEN
      sql := format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', polname, t);
      EXECUTE sql;
    END IF;
  END LOOP;
END$$;;
