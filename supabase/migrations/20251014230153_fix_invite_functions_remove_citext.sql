create or replace function public.invite_company_member(p_company uuid, p_email text, p_role member_role)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_token uuid;
begin
  if not public.has_company_role_any_status(p_company, array['OWNER','ADMIN']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.company_members(company_id, email, role, status, invited_by)
  values (p_company, v_email, p_role, 'invited', auth.uid())
  on conflict (company_id, email)
  do update set role = excluded.role, status = 'invited';

  insert into public.company_invites(company_id, email, role)
  values (p_company, v_email, p_role)
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.reinvite_company_member(p_company uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_token uuid;
begin
  if not public.has_company_role_any_status(p_company, array['OWNER','ADMIN']::public.member_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.company_members(company_id, email, role, status, invited_by)
  values (p_company, v_email, 'VIEWER', 'invited', auth.uid())
  on conflict (company_id, email)
  do update set status = 'invited';

  insert into public.company_invites(company_id, email, role)
  values (p_company, v_email, (select role from public.company_members where company_id=p_company and email=v_email))
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.sync_invites_for_me()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_email text := lower(nullif(current_setting('request.jwt.claim.email', true), ''));
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null or v_claim_email is null then
    return 0;
  end if;

  update public.company_members m
     set user_id = v_uid,
         status  = case when m.status = 'disabled' then 'disabled' else 'active' end
   where m.user_id is distinct from v_uid
     and lower(m.email) = lower(v_claim_email);

  get diagnostics v_count = row_count;

  update public.company_invites i
     set accepted_at = coalesce(accepted_at, now())
   where lower(i.email) = lower(v_claim_email)
     and i.accepted_at is null
     and now() < i.expires_at;

  return v_count;
end;
$$;;
