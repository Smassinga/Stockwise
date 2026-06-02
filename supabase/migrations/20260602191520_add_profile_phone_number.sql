alter table public.profiles
  add column if not exists phone_number text;

comment on column public.profiles.phone_number is
  'Optional user contact phone captured during signup/profile edits. Not used for authentication, membership, or tenant access.';

create or replace function public.handle_user_profile_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles as p (
    id,
    user_id,
    name,
    email,
    full_name,
    avatar_url,
    phone_number,
    email_confirmed_at,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name')), ''),
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'avatar_url', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone_number', new.raw_user_meta_data->>'phone')), ''),
    new.email_confirmed_at,
    new.last_sign_in_at,
    now(),
    now()
  )
  on conflict (id) do update
    set user_id = coalesce(p.user_id, excluded.user_id),
        name = coalesce(excluded.name, p.name),
        email = excluded.email,
        full_name = coalesce(excluded.full_name, p.full_name),
        avatar_url = coalesce(excluded.avatar_url, p.avatar_url),
        phone_number = coalesce(excluded.phone_number, p.phone_number),
        email_confirmed_at = excluded.email_confirmed_at,
        last_sign_in_at = excluded.last_sign_in_at,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_auth_users_profile_ins on auth.users;
create trigger trg_auth_users_profile_ins
after insert on auth.users
for each row execute function public.handle_user_profile_sync();

drop trigger if exists trg_auth_users_profile_upd on auth.users;
create trigger trg_auth_users_profile_upd
after update of email, raw_user_meta_data, email_confirmed_at, last_sign_in_at on auth.users
for each row execute function public.handle_user_profile_sync();
