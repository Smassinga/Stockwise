CREATE OR REPLACE FUNCTION public.invoke_due_reminder_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    text := COALESCE(
               current_setting('app.due_reminder_worker_url', true),
               current_setting('app.reminder_hook_url', true)
             );
  v_secret text := COALESCE(
               current_setting('app.due_reminder_worker_secret', true),
               current_setting('app.reminder_hook_secret', true)
             );
  v_req    bigint;
  v_status integer;
  v_headers jsonb;
  v_body   text;
BEGIN
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url/secret (or legacy app.reminder_hook_url/secret)';
  END IF;

  -- net.http_post returns a request id (bigint), not a JSON payload.
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'x-webhook-secret', v_secret,
      'content-type','application/json'
    ),
    body := jsonb_build_object('source','pg_cron')
  ) INTO v_req;

  -- Collect the response so the job is synchronous-ish and we can expose details.
  SELECT status, headers, body
    INTO v_status, v_headers, v_body
  FROM net.http_collect(v_req);

  RETURN jsonb_build_object(
    'request_id', v_req,
    'status', v_status,
    'headers', v_headers,
    'body', v_body
  );
END;
$$;;
