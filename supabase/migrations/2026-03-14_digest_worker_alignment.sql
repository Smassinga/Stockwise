BEGIN;

CREATE OR REPLACE FUNCTION app.call_digest_worker(payload jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'private'
AS $function$
DECLARE
  v_key      text := (SELECT val FROM private.app_secrets WHERE key = 'DIGEST_FN_KEY');
  v_url      text := 'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/digest-worker';
  v_resp     jsonb;
  v_status   int;
  v_content  text;
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'private.app_secrets.DIGEST_FN_KEY not set';
    RETURN;
  END IF;

  SELECT to_jsonb(
           net.http_post(
             url := v_url,
             headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || v_key,
               'x-webhook-secret', v_key
             ),
             body := COALESCE(payload, '{}'::jsonb)
           )
         )
    INTO v_resp;

  v_status := COALESCE(
    NULLIF(v_resp->>'status', '')::int,
    NULLIF(v_resp->>'status_code', '')::int,
    0
  );
  v_content := COALESCE(v_resp->>'content', v_resp->>'body', '');

  IF COALESCE(v_status, 0) NOT IN (200, 202) THEN
    RAISE WARNING 'digest-worker responded %: %',
      v_status,
      LEFT(COALESCE(v_content, ''), 300);
  END IF;
END
$function$;

-- Stale digests are not useful to deliver after an outage; clear old backlog so the worker
-- can focus on the current local day instead of replaying historical email.
UPDATE public.digest_queue
   SET status = 'failed',
       error = CASE
         WHEN COALESCE(error, '') = '' THEN 'Skipped stale digest backlog after worker recovery'
         ELSE error
       END,
       next_attempt_at = NULL
 WHERE status = 'pending'
   AND run_for_local_date < CURRENT_DATE;

COMMIT;
