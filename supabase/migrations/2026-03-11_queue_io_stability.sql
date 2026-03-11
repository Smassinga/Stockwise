BEGIN;

-- Reduce write amplification on queue tables by removing redundant indexes.
DROP INDEX IF EXISTS public.idx_due_queue_next_attempt;
DROP INDEX IF EXISTS public.ix_due_reminder_queue_status_next;
DROP INDEX IF EXISTS public.uq_due_reminder_active_key;
DROP INDEX IF EXISTS public.ix_stock_movements_ref;
DROP INDEX IF EXISTS public.ix_stock_movements_company_id_fk;

-- Keep queue hot paths index-friendly.
CREATE INDEX IF NOT EXISTS idx_due_reminder_queue_pending_ready
  ON public.due_reminder_queue (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_due_reminder_queue_processing_created
  ON public.due_reminder_queue (created_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_digest_queue_pending_ready
  ON public.digest_queue (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_digest_queue_processing_created
  ON public.digest_queue (created_at)
  WHERE status = 'processing';

-- Avoid repeated queue scans + repeated HTTP invocations per cron tick.
CREATE OR REPLACE FUNCTION public.kick_due_reminder_worker()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_local_day date := (timezone('Africa/Maputo', now()))::date;
BEGIN
  PERFORM public.enqueue_due_reminders_for_all_companies(v_local_day, false);
  PERFORM public.invoke_due_reminder_worker();
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stuck_due_reminders(
  p_stuck_after interval DEFAULT interval '15 minutes',
  p_max_attempts integer DEFAULT 8
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH moved AS (
    UPDATE public.due_reminder_queue q
       SET attempts = COALESCE(q.attempts, 0) + 1,
           status = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts
               THEN 'failed'
             ELSE 'pending'
           END,
           next_attempt_at = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts THEN NULL
             ELSE now() + make_interval(mins => LEAST(60, power(2, LEAST(6, COALESCE(q.attempts, 0) + 1))::int))
           END
     WHERE q.status = 'processing'
       AND q.created_at < now() - p_stuck_after
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM moved;

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stuck_digests(
  p_stuck_after interval DEFAULT interval '15 minutes',
  p_max_attempts integer DEFAULT 5
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_rows integer := 0;
BEGIN
  WITH moved AS (
    UPDATE public.digest_queue q
       SET attempts = COALESCE(q.attempts, 0) + 1,
           status = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts THEN 'failed'
             ELSE 'pending'
           END,
           next_attempt_at = CASE
             WHEN COALESCE(q.attempts, 0) + 1 >= p_max_attempts THEN NULL
             ELSE now() + make_interval(mins => LEAST(60, power(2, LEAST(6, COALESCE(q.attempts, 0) + 1))::int))
           END,
           error = CASE
             WHEN q.error IS NULL OR q.error = '' THEN 'Recovered stale processing job'
             ELSE q.error
           END
     WHERE q.status = 'processing'
       AND q.created_at < now() - p_stuck_after
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM moved;

  RETURN v_rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prune_worker_queues(
  p_due_days integer DEFAULT 14,
  p_digest_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_due_deleted integer := 0;
  v_digest_deleted integer := 0;
BEGIN
  DELETE FROM public.due_reminder_queue q
   WHERE q.status IN ('done', 'failed')
     AND COALESCE(q.processed_at, q.created_at) < now() - make_interval(days => GREATEST(1, p_due_days));
  GET DIAGNOSTICS v_due_deleted = ROW_COUNT;

  DELETE FROM public.digest_queue q
   WHERE q.status IN ('done', 'failed')
     AND COALESCE(q.processed_at, q.created_at) < now() - make_interval(days => GREATEST(1, p_digest_days));
  GET DIAGNOSTICS v_digest_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'due_deleted', v_due_deleted,
    'digest_deleted', v_digest_deleted
  );
END;
$function$;

-- Disable duplicate / overlapping cron jobs that were causing repeated worker kicks.
DO $$
DECLARE
  v_name text;
  v_jobid integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'so-due-reminders-every-15m',
    'due-reminders:kick',
    'due_reminder_tick',
    'due_reminder_invoke',
    'due_reminder_enqueue_every_15',
    'due_reminder_enqueue'
  ]
  LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = v_name;
    IF v_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_jobid);
    END IF;
  END LOOP;
END $$;

-- Keep one due-reminder enqueue + invoke path.
DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'due-reminders:enqueue';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'due-reminders:enqueue',
    '*/15 * * * *',
    'SELECT public.enqueue_due_reminders_for_all_companies(CURRENT_DATE, FALSE);'
  );
END $$;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'due_reminder_invoke_minutely';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'due_reminder_invoke_minutely',
    '* * * * *',
    'select public.invoke_due_reminder_worker();'
  );
END $$;

-- Lower unnecessary digest churn; function itself is date/time gated.
DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'run_digest_worker';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'run_digest_worker',
    '*/5 * * * *',
    'select app.call_digest_worker();'
  );
END $$;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'queue_daily_digests';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'queue_daily_digests',
    '*/30 * * * *',
    'select public.process_daily_digests();'
  );
END $$;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'requeue_failed_digests';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'requeue_failed_digests',
    '*/15 * * * *',
    'select public.requeue_failed_digests();'
  );
END $$;

-- Add/refresh operational maintenance jobs.
DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'requeue_stuck_due_reminders';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'requeue_stuck_due_reminders',
    '*/10 * * * *',
    'select public.requeue_stuck_due_reminders();'
  );
END $$;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'requeue_stuck_digests';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'requeue_stuck_digests',
    '*/10 * * * *',
    'select public.requeue_stuck_digests();'
  );
END $$;

DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'prune_worker_queues_daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule(
    'prune_worker_queues_daily',
    '10 2 * * *',
    'select public.prune_worker_queues(14, 30);'
  );
END $$;

-- One-time healing for currently stuck jobs.
SELECT public.requeue_stuck_due_reminders(interval '15 minutes', 8);
SELECT public.requeue_stuck_digests(interval '15 minutes', 5);

COMMIT;
