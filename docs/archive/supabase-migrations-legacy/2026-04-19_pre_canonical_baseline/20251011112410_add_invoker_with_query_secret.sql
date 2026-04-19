CREATE OR REPLACE FUNCTION public.invoke_due_reminder_worker_qs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_base   text := COALESCE(
                current_setting('app.due_reminder_worker_url', true),
                'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/due-reminder-worker'
              );
  v_secret text := current_setting('app.due_reminder_worker_secret', true);
  v_url    text := v_base;
  v_hdrs   jsonb := jsonb_build_object('content-type','application/json');
  v_req    bigint;
BEGIN
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;

  -- keep headers (both) AND pass secret via query param to satisfy authorized() when DEBUG_ACCEPT_QUERY_KEY=true
  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs
      || jsonb_build_object('x-webhook-secret', v_secret)
      || jsonb_build_object('authorization', 'Bearer '||v_secret);
    v_url := v_base || CASE WHEN position('?' in v_base) > 0 THEN '&' ELSE '?' END || 'key=' || v_secret;
  END IF;

  SELECT net.http_post(
           url := v_url,
           body := jsonb_build_object('source','pg_cron'),
           params := '{}'::jsonb,
           headers := v_hdrs,
           timeout_milliseconds := 5000
         )
    INTO v_req;

  RETURN jsonb_build_object('request_id', v_req, 'queued', true, 'url', v_url);
END;
$$;;
