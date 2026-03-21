begin;

create unique index if not exists uq_due_reminder_unique
  on public.due_reminder_queue (company_id, run_for_local_date, timezone);

alter table public.due_reminder_queue enable row level security;

-- allow authenticated role to interact (for RPC button + testing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'due_reminder_queue'
      AND policyname = 'allow_auth_all'
  ) THEN
    CREATE POLICY "allow_auth_all" ON public.due_reminder_queue
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END$$;

create or replace function public.enqueue_due_reminders_for_all_companies(
  p_local_day date,
  p_force boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
with cfg as (
  select cs.company_id,
         coalesce(cs.data->'dueReminders'->>'timezone', cs.data->'notifications'->>'timezone','Africa/Maputo') as tz,
         coalesce(cs.data->'dueReminders'->'leadDays','[3,1,0,-3]'::jsonb) as lead_days,
         coalesce(cs.data->'dueReminders'->'recipients','[]'::jsonb) as recipients,
         coalesce(cs.data->'dueReminders'->'bcc','[]'::jsonb) as bcc,
         coalesce(cs.data->'dueReminders'->>'invoiceBaseUrl','https://app.stockwise.app/invoices') as invoice_base_url,
         coalesce(cs.data->'dueReminders'->'hours','[9]'::jsonb) as hours
    from public.company_settings cs
   where coalesce( (cs.data->'dueReminders'->>'enabled')::boolean, true) = true
), want_now as (
  select c.*,
         (date_part('hour', timezone(c.tz, now()))::int) as local_hour,
         exists (
           select 1
           from jsonb_array_elements_text(c.hours) h
           where (h::int) = date_part('hour', timezone(c.tz, now()))::int
         ) as hour_match
  from cfg c
), to_enqueue as (
  select w.company_id,
         p_local_day::date as run_for_local_date,
         w.tz::text as timezone,
         jsonb_build_object(
            'channels', jsonb_build_object('email', true),
            'recipients', jsonb_build_object('emails', w.recipients),
            'lead_days', w.lead_days,
            'bcc', w.bcc,
            'invoice_base_url', w.invoice_base_url
         ) as payload
    from want_now w
    left join public.due_reminder_queue q
      on q.company_id = w.company_id
     and q.run_for_local_date = p_local_day
     and q.timezone = w.tz
   where (p_force or w.hour_match)
     and (p_force or q.id is null)
)
insert into public.due_reminder_queue(company_id, run_for_local_date, timezone, payload, status, attempts, created_at)
select company_id, run_for_local_date, timezone, payload, 'pending', 0, now()
from to_enqueue
on conflict on constraint uq_due_reminder_unique
do update set
  payload = excluded.payload,
  status = 'pending',
  attempts = 0,
  next_attempt_at = null,
  processed_at = null
where p_force;

GET DIAGNOSTICS v_count = ROW_COUNT;
return v_count;
end $$;

grant execute on function public.enqueue_due_reminders_for_all_companies(date, boolean) to authenticated;

commit;;
