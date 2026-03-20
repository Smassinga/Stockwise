BEGIN;

ALTER TABLE IF EXISTS public.due_reminder_queue
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL;

DO $$
BEGIN
  IF to_regclass('public.digest_queue') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.digest_queue ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL';
  END IF;
END
$$;

UPDATE public.due_reminder_queue
   SET processing_started_at = timezone('utc', now())
 WHERE status = 'processing'
   AND processing_started_at IS NULL;

DO $$
BEGIN
  IF to_regclass('public.digest_queue') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.digest_queue
         SET processing_started_at = timezone('utc', now())
       WHERE status = 'processing'
         AND processing_started_at IS NULL
    $sql$;
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_due_reminder_queue_processing_created;
CREATE INDEX IF NOT EXISTS idx_due_reminder_queue_processing_started
  ON public.due_reminder_queue (processing_started_at)
  WHERE status = 'processing';

DO $$
BEGIN
  IF to_regclass('public.digest_queue') IS NOT NULL THEN
    EXECUTE 'DROP INDEX IF EXISTS public.idx_digest_queue_processing_created';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_digest_queue_processing_started ON public.digest_queue (processing_started_at) WHERE status = ''processing''';
  END IF;
END
$$;

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
           END,
           processing_started_at = NULL
     WHERE q.status = 'processing'
       AND q.processing_started_at IS NOT NULL
       AND q.processing_started_at < now() - p_stuck_after
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
           END,
           processing_started_at = NULL
     WHERE q.status = 'processing'
       AND q.processing_started_at IS NOT NULL
       AND q.processing_started_at < now() - p_stuck_after
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM moved;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.kick_due_reminder_worker()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stuck_due_reminders(interval, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stuck_digests(interval, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_worker_queues(integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kick_due_reminder_worker()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stuck_due_reminders(interval, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stuck_digests(interval, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_worker_queues(integer, integer)
  TO service_role;

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.process_daily_digests()',
    'public.requeue_failed_digests()',
    'app.call_digest_worker(jsonb)'
  ]
  LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
    END IF;
  END LOOP;
END
$$;

COMMIT;
