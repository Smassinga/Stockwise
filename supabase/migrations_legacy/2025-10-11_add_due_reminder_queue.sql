BEGIN;

CREATE TYPE public.reminder_status AS ENUM ('pending','processing','done','failed');

CREATE TABLE IF NOT EXISTS public.due_reminder_queue (
  id                bigserial PRIMARY KEY,
  company_id        uuid        NOT NULL,
  run_for_local_date date       NOT NULL,      -- YYYY-MM-DD (company-local "today" basis)
  timezone          text        NOT NULL,      -- e.g. "Africa/Maputo"
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb, -- channel + recipients + knobs
  status            reminder_status NOT NULL DEFAULT 'pending',
  attempts          int         NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz NULL,
  processed_at      timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- convenience index if you want
CREATE INDEX IF NOT EXISTS idx_due_reminder_queue_status_next
  ON public.due_reminder_queue (status, next_attempt_at NULLS FIRST, created_at);

COMMIT;