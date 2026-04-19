set check_function_bodies = off;

create or replace function public.accept_invite_with_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
  v_company uuid;
  v_role public.member_role;
  v_inv_id uuid;
begin
  select auth.uid(), (select email from auth.users where id = auth.uid())
    into v_user_id, v_email;
  if v_user_id is null then
    raise exception 'unauthenticated';
  end if;

  select i.id, i.company_id, i.role
    into v_inv_id, v_company, v_role
  from public.company_invites i
  where i.token = p_token
    and (i.expires_at is null or i.expires_at > now())
    and i.accepted_at is null
  limit 1;

  if v_inv_id is null then
    raise exception 'invalid_or_expired_token';
  end if;

  if not exists (
    select 1
    from public.company_invites i
    where i.id = v_inv_id
      and lower(i.email) = lower(v_email)
  ) then
    raise exception 'invite_email_mismatch';
  end if;

  insert into public.company_members (company_id, user_id, email, role, status, invited_by)
  values (
    v_company,
    v_user_id,
    v_email,
    v_role,
    'active',
    (select created_by from public.company_invites where id = v_inv_id)
  )
  on conflict (company_id, email) do update
  set user_id = excluded.user_id,
      role = excluded.role,
      status = 'active';

  update public.company_invites
    set accepted_at = now()
  where id = v_inv_id;

  return jsonb_build_object('ok', true, 'company_id', v_company, 'role', v_role);
end;
$$;

drop table if exists public.user_profiles cascade;

drop table if exists public.movements cascade;
drop function if exists public.tg_movements_company_fill() cascade;

drop type if exists public.company_role;
