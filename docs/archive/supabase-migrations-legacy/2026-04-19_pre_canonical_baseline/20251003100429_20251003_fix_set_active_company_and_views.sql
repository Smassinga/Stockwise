-- Fix set_active_company RPC (match client payload key) and add supporting objects
-- 0) Bump PostgREST schema cache at the end of the migration

-- 1) Profile table to hold active company context
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_company_id uuid references public.companies(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname='user_profiles_set_updated_at') then
    create trigger user_profiles_set_updated_at before update on public.user_profiles
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- 2) Helper: current active company (falls back to first membership if unset)
create or replace function public.active_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with prof as (
    select active_company_id from public.user_profiles where user_id = auth.uid()
  ), fallback as (
    select cm.company_id from public.company_members cm
    where cm.user_id = auth.uid()
    order by cm.role asc, cm.created_at asc
    limit 1
  )
  select coalesce((select active_company_id from prof), (select company_id from fallback));
$$;
revoke all on function public.active_company_id() from public;
grant execute on function public.active_company_id() to authenticated, anon;

-- 3) DROP old set_active_company (any return type) then recreate with param name p_company
-- (Postgres signatures ignore param names, so this covers prior definitions)
drop function if exists public.set_active_company(uuid);
create or replace function public.set_active_company(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid()
  ) then
    raise exception 'user % is not a member of company %', auth.uid(), p_company;
  end if;
  insert into public.user_profiles (user_id, active_company_id)
  values (auth.uid(), p_company)
  on conflict (user_id) do update set active_company_id = excluded.active_company_id, updated_at = now();
end;
$$;
revoke all on function public.set_active_company(uuid) from public;
grant execute on function public.set_active_company(uuid) to authenticated;

-- 4) Members view with auth columns expected by client
create or replace view public.company_members_with_auth as
select
  cm.company_id,
  cm.user_id,
  cm.role,
  cm.status,
  cm.invited_by,
  cm.created_at,
  u.email,
  u.email_confirmed_at,
  u.last_sign_in_at
from public.company_members cm
join auth.users u on u.id = cm.user_id
where exists (
  select 1 from public.company_members me
  where me.company_id = cm.company_id and me.user_id = auth.uid()
);

grant select on public.company_members_with_auth to authenticated, anon;

-- 5) RLS: restrict customers to the caller's ACTIVE company only
alter table if exists public.customers enable row level security;

-- Drop any broader policy (optional, safe if absent) and create precise one
do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='customers' and policyname='customers_select_company_members') then
    drop policy customers_select_company_members on public.customers;
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='customers' and policyname='customers_select_active_company') then
    create policy customers_select_active_company on public.customers
      for select using (
        company_id = public.active_company_id()
        and exists (select 1 from public.company_members m where m.company_id = customers.company_id and m.user_id = auth.uid())
      );
  end if;
end $$;

-- 6) (Optional hardening) company_members RLS so the view is safe if queried directly
alter table if exists public.company_members enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_members' and policyname='company_members_select_self_companies') then
    create policy company_members_select_self_companies on public.company_members
      for select using (exists (
        select 1 from public.company_members me
        where me.company_id = company_members.company_id and me.user_id = auth.uid()
      ));
  end if;
end $$;

-- 7) OPTIONAL: If your existing customer_movements_view already joins customers, RLS above will filter it.
-- If not, wrap it here to enforce active company (uncomment and adapt if needed).
-- create or replace view public.customer_movements_view as
--   select v.* from existing_customer_movements v
--   where exists (select 1 from public.customers c where c.id = v.customer_id and c.company_id = public.active_company_id());

-- 8) Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
;
