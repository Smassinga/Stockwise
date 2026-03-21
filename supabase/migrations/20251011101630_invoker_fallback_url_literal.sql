CREATE OR REPLACE FUNCTION public.invoke_due_reminder_worker()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := COALESCE(
               current_setting('app.due_reminder_worker_url', true),
               'https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/due-reminder-worker'
             );
  v_req     bigint;
  v_status  integer;
  v_headers jsonb;
  v_body    text;
BEGIN
  SELECT net.http_post(
           url := v_url,
           headers := jsonb_build_object('content-type','application/json'),
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
