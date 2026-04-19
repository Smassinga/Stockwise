BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.ai_exec_one(text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'public.ai_exec_one(text, boolean) not found';
  END IF;

  REVOKE ALL ON FUNCTION public.ai_exec_one(text, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.ai_exec_one(text, boolean) TO service_role;
END
$$;

COMMIT;
