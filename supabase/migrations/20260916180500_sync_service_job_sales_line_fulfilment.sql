-- Service lines are fulfilled through Service Jobs, not warehouse shipments.
-- Mirror Service Job completion onto the existing sales-order fulfilment columns
-- so v_sales_order_state can remain the canonical order read model without
-- creating stock movements for services.

create or replace function public.sync_service_job_sales_line_fulfilment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.execution_status = 'completed'
     and old.execution_status is distinct from 'completed' then
    update public.sales_order_lines sol
       set shipped_qty = sol.qty,
           is_shipped = true,
           shipped_at = coalesce(new.actual_completion, now())
      from public.service_job_lines sjl
     where sjl.service_job_id = new.id
       and sjl.company_id = new.company_id
       and sjl.active_link
       and sol.id = sjl.sales_order_line_id
       and sol.company_id = new.company_id
       and exists (
         select 1
           from public.items i
          where i.id = sol.item_id
            and i.company_id = new.company_id
            and i.primary_role = 'service'
       );
  elsif old.execution_status = 'completed'
        and new.execution_status = 'in_progress' then
    update public.sales_order_lines sol
       set shipped_qty = 0,
           is_shipped = false,
           shipped_at = null
      from public.service_job_lines sjl
     where sjl.service_job_id = new.id
       and sjl.company_id = new.company_id
       and sjl.active_link
       and sol.id = sjl.sales_order_line_id
       and sol.company_id = new.company_id
       and exists (
         select 1
           from public.items i
          where i.id = sol.item_id
            and i.company_id = new.company_id
            and i.primary_role = 'service'
       );
  end if;

  return new;
end;
$$;

revoke all on function public.sync_service_job_sales_line_fulfilment() from public, anon, authenticated;

drop trigger if exists service_job_sync_sales_line_fulfilment on public.service_jobs;
create trigger service_job_sync_sales_line_fulfilment
after update of execution_status on public.service_jobs
for each row
execute function public.sync_service_job_sales_line_fulfilment();

-- Bring service orders completed before this migration into the same state.
update public.sales_order_lines sol
   set shipped_qty = sol.qty,
       is_shipped = true,
       shipped_at = coalesce(sj.actual_completion, sj.updated_at, now())
  from public.service_job_lines sjl
  join public.service_jobs sj
    on sj.id = sjl.service_job_id
   and sj.company_id = sjl.company_id
  join public.items i
    on i.id = sjl.service_item_id
   and i.company_id = sjl.company_id
 where sj.execution_status = 'completed'
   and sjl.active_link
   and i.primary_role = 'service'
   and sol.id = sjl.sales_order_line_id
   and sol.company_id = sj.company_id
   and (
     coalesce(sol.shipped_qty, 0) is distinct from sol.qty
     or not coalesce(sol.is_shipped, false)
   );

comment on function public.sync_service_job_sales_line_fulfilment() is
  'Mirrors completed/reopened Service Jobs to linked service sales-order fulfilment fields. It never posts stock movements or requires warehouse allocation.';
