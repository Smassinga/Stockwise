create or replace function public.tg_companies_autolink()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  owner_email text;
begin
  if new.owner_user_id is null then
    new.owner_user_id := auth.uid();
  end if;

  select u.email into owner_email
  from auth.users u
  where u.id = new.owner_user_id;

  insert into public.company_members (
    company_id,
    user_id,
    email,
    role,
    status,
    invited_by
  )
  values (
    new.id,
    new.owner_user_id,
    owner_email,
    'OWNER'::member_role,
    'active'::member_status,
    new.owner_user_id
  )
  on conflict (company_id, email) do nothing;

  return new;
end;
$function$;
