BEGIN;

DO $$
DECLARE
  pol record;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;

  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND (
        policyname ILIKE '%brand%logo%'
        OR coalesce(qual, '') ILIKE '%brand-logos%'
        OR coalesce(with_check, '') ILIKE '%brand-logos%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
  END LOOP;

  EXECUTE 'CREATE POLICY brand_logos_manager_select ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = ''brand-logos''
      AND public.can_manage_company_storage_prefix(
        public.try_uuid(split_part(name, ''/'', 1))
      )
    )';
END
$$;

COMMIT;
