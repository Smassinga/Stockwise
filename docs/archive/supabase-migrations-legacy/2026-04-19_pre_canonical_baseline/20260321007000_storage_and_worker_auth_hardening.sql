BEGIN;

CREATE OR REPLACE FUNCTION public.try_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;

  RETURN p_value::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_company_storage_prefix(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.company_id = p_company_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role IN ('OWNER'::member_role, 'ADMIN'::member_role, 'MANAGER'::member_role)
  );
$$;

REVOKE ALL ON FUNCTION public.try_uuid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_manage_company_storage_prefix(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_company_storage_prefix(uuid) TO authenticated, service_role;

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
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (
        policyname ILIKE '%brand%logo%'
        OR coalesce(qual, '') ILIKE '%brand-logos%'
        OR coalesce(with_check, '') ILIKE '%brand-logos%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
  END LOOP;

  EXECUTE 'CREATE POLICY brand_logos_manager_insert ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = ''brand-logos''
      AND public.can_manage_company_storage_prefix(
        public.try_uuid(split_part(name, ''/'', 1))
      )
    )';

  EXECUTE 'CREATE POLICY brand_logos_manager_update ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = ''brand-logos''
      AND public.can_manage_company_storage_prefix(
        public.try_uuid(split_part(name, ''/'', 1))
      )
    )
    WITH CHECK (
      bucket_id = ''brand-logos''
      AND public.can_manage_company_storage_prefix(
        public.try_uuid(split_part(name, ''/'', 1))
      )
    )';

  EXECUTE 'CREATE POLICY brand_logos_manager_delete ON storage.objects
    FOR DELETE
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
