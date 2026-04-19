CREATE OR REPLACE FUNCTION public.invoke_due_reminder_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    text := COALESCE(
                current_setting('app.due_reminder_worker_url', true),
                'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/due-reminder-worker'
              );
  v_secret text := current_setting('app.due_reminder_worker_secret', true);
  v_hdrs   jsonb := jsonb_build_object('content-type','application/json');
  v_req    bigint;
BEGIN
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;

  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs
      || jsonb_build_object('x-webhook-secret', v_secret)
      || jsonb_build_object('authorization', 'Bearer '||v_secret);
  END IF;

  SELECT net.http_post(
           url := v_url,
           body := jsonb_build_object('source','pg_cron'),
           params := '{}'::jsonb,
           headers := v_hdrs,
           timeout_milliseconds := 3000
         )
    INTO v_req;

  RETURN jsonb_build_object('request_id', v_req, 'queued', true);
END;
$$;;
