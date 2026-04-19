begin;

create schema if not exists app;

create table if not exists app.security_rate_limits (
  scope text not null,
  subject text not null,
  bucket_start timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  hit_count integer not null default 0 check (hit_count >= 0),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  primary key (scope, subject, bucket_start)
);

alter table app.security_rate_limits enable row level security;

drop policy if exists security_rate_limits_service_only on app.security_rate_limits;
create policy security_rate_limits_service_only
  on app.security_rate_limits
  for all
  to service_role
  using (true)
  with check (true);

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to service_role;

revoke all on table app.security_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table app.security_rate_limits to service_role;

commit;
