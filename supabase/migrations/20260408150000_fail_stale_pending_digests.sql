begin;

update public.digest_queue
   set status = 'failed',
       processed_at = coalesce(processed_at, now()),
       next_attempt_at = null,
       processing_started_at = null,
       error = case
         when coalesce(nullif(error, ''), '') = '' then 'Skipped stale digest backlog after worker recovery'
         else error
       end
 where status = 'pending'
   and run_for_local_date < ((now() at time zone coalesce(timezone, 'Africa/Maputo'))::date);

commit;
