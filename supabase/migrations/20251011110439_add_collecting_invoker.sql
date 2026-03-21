CREATE OR REPLACE FUNCTION public.invoke_due_reminder_worker_collect()
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
  v_res    net.http_response_result;
BEGIN
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;
  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs || jsonb_build_object('x-webhook-secret', v_secret);
  END IF;
  SELECT net.http_post(
           url := v_url,
           body := jsonb_build_object('source','pg_cron'),
           params := '{}'::jsonb,
           headers := v_hdrs,
           timeout_milliseconds := 8000
         )
    INTO v_req;
  SELECT net.http_collect_response(v_req, false) INTO v_res;
  RETURN jsonb_build_object(
    'request_id', v_req,
    'status',     v_res.status,
    'message',    v_res.message,
    'response',   to_jsonb(v_res.response)
  );
END;
$$;;
