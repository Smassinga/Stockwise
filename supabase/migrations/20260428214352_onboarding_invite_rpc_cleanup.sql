set check_function_bodies = off;

drop function if exists public.accept_invite_with_token(text);

create or replace function public.list_my_pending_company_invitations()
returns table(
  company_id uuid,
  company_name text,
  role public.member_role,
  invitation_status text,
  invited_at timestamptz,
  expires_at timestamptz,
  inviter_user_id uuid,
  inviter_name text,
  inviter_email text,
  source text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = v_user_id;
  if v_user_id is null or v_email is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return query
  with active_companies as (
    select distinct cm.company_id
    from public.company_members cm
    where (cm.user_id = v_user_id or lower(cm.email) = v_email)
      and cm.status = 'active'::public.member_status
  ),
  any_invite_rows as (
    select distinct i.company_id
    from public.company_invites i
    where lower(i.email::text) = v_email
  ),
  latest_invites as (
    select distinct on (i.company_id)
      i.company_id,
      coalesce(nullif(c.trade_name, ''), nullif(c.legal_name, ''), c.name) as company_name,
      i.role,
      i.created_at as invited_at,
      i.expires_at,
      i.created_by as inviter_user_id,
      coalesce(nullif(p.full_name, ''), nullif(p.name, ''), nullif(split_part(coalesce(p.email::text, ''), '@', 1), '')) as inviter_name,
      p.email::text as inviter_email,
      'invite'::text as source
    from public.company_invites i
    join public.companies c on c.id = i.company_id
    left join public.profiles p on p.id = i.created_by
    where lower(i.email::text) = v_email
      and i.accepted_at is null
      and (i.expires_at is null or i.expires_at > now())
      and not exists (
        select 1
        from active_companies ac
        where ac.company_id = i.company_id
      )
    order by i.company_id, i.created_at desc, i.id desc
  ),
  legacy_memberships as (
    select
      cm.company_id,
      coalesce(nullif(c.trade_name, ''), nullif(c.legal_name, ''), c.name) as company_name,
      cm.role,
      cm.created_at as invited_at,
      null::timestamptz as expires_at,
      cm.invited_by as inviter_user_id,
      coalesce(nullif(p.full_name, ''), nullif(p.name, ''), nullif(split_part(coalesce(p.email::text, ''), '@', 1), '')) as inviter_name,
      p.email::text as inviter_email,
      'membership'::text as source
    from public.company_members cm
    join public.companies c on c.id = cm.company_id
    left join public.profiles p on p.id = cm.invited_by
    where cm.status = 'invited'::public.member_status
      and (cm.user_id = v_user_id or lower(cm.email) = v_email)
      and not exists (
        select 1
        from latest_invites li
        where li.company_id = cm.company_id
      )
      and not exists (
        select 1
        from any_invite_rows air
        where air.company_id = cm.company_id
      )
      and not exists (
        select 1
        from active_companies ac
        where ac.company_id = cm.company_id
      )
  )
  select
    li.company_id,
    li.company_name,
    li.role,
    'pending'::text as invitation_status,
    li.invited_at,
    li.expires_at,
    li.inviter_user_id,
    li.inviter_name,
    li.inviter_email,
    li.source
  from latest_invites li
  union all
  select
    lm.company_id,
    lm.company_name,
    lm.role,
    'pending'::text as invitation_status,
    lm.invited_at,
    lm.expires_at,
    lm.inviter_user_id,
    lm.inviter_name,
    lm.inviter_email,
    lm.source
  from legacy_memberships lm
  order by invited_at desc nulls last, company_name asc;
end;
$$;
