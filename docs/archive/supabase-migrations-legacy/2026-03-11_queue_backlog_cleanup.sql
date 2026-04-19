BEGIN;

-- Expire stale reminder jobs that are no longer actionable.
UPDATE public.due_reminder_queue
   SET status = 'failed',
       attempts = GREATEST(COALESCE(attempts, 0), 8),
       next_attempt_at = NULL
 WHERE status = 'pending'
   AND created_at < now() - interval '14 days';

-- Expire stale digest jobs to avoid repeatedly scanning historical backlog.
UPDATE public.digest_queue
   SET status = 'failed',
       attempts = GREATEST(COALESCE(attempts, 0), 5),
       next_attempt_at = NULL,
       error = COALESCE(NULLIF(error, ''), 'Expired pending digest backlog')
 WHERE status = 'pending'
   AND created_at < now() - interval '7 days';

-- Immediately prune old completed/failed rows from both queues.
SELECT public.prune_worker_queues(14, 30);

COMMIT;
