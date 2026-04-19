DO $$
DECLARE exists bool;
BEGIN
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname='prune_cron_logs') INTO exists;
  IF NOT exists THEN
    PERFORM cron.schedule('prune_cron_logs','0 2 * * *', 'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''30 days'';');
  ELSE
    PERFORM cron.alter('prune_cron_logs','0 2 * * *', 'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''30 days'';');
  END IF;
END$$;;
