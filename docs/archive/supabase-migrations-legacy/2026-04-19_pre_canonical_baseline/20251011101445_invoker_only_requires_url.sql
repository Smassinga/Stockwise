CREATE OR REPLACE FUNCTION public.invoke_due_reminder_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url     text := COALESCE(
               current_setting('app.due_reminder_worker_url', true),
               current_setting('app.reminder_hook_url', true)
             );
  v_secret  text := COALESCE(
               current_setting('app.due_reminder_worker_secret', true),
               current_setting('app.reminder_hook_secret', true)
             );
  v_req     bigint;
  v_status  integer;
  v_headers jsonb;
  v_body    text;
  v_hdrs    jsonb := jsonb_build_object('content-type','application/json');
BEGIN
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Missing config: app.due_reminder_worker_url';
  END IF;

  IF v_secret IS NOT NULL THEN
    v_hdrs := v_hdrs || jsonb_build_object('x-webhook-secret', v_secret);
  END IF;

  SELECT net.http_post(
           url := v_url,
           headers := v_hdrs,
           body := jsonb_build_object('source','pg_cron')
         )
    INTO v_req;

  SELECT status, headers, body
    INTO v_status, v_headers, v_body
    FROM net.http_collect(v_req);

  RETURN jsonb_build_object(
    'request_id', v_req,
    'status',     v_status,
    'body',       v_body
  );
END;
$$;;
