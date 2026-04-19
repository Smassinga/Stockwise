alter table public.boms
  add column if not exists assembly_time_per_unit_minutes numeric,
  add column if not exists setup_time_per_batch_minutes numeric;

alter table public.boms
  drop constraint if exists boms_assembly_time_per_unit_minutes_check,
  add constraint boms_assembly_time_per_unit_minutes_check
    check (
      assembly_time_per_unit_minutes is null
      or assembly_time_per_unit_minutes > 0
    ),
  drop constraint if exists boms_setup_time_per_batch_minutes_check,
  add constraint boms_setup_time_per_batch_minutes_check
    check (
      setup_time_per_batch_minutes is null
      or setup_time_per_batch_minutes >= 0
    );

comment on column public.boms.assembly_time_per_unit_minutes is
  'Normalized planning time per finished unit, stored in minutes for lightweight assembly planning.';

comment on column public.boms.setup_time_per_batch_minutes is
  'Optional setup/planning time per build batch, stored in minutes for lightweight assembly planning.';
