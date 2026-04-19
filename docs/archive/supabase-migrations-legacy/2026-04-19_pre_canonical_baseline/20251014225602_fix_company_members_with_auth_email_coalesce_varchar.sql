create or replace view public.company_members_with_auth
with (security_invoker = true)
as
select
  cm.company_id,
  cm.user_id,
  cm.role,
  cm.status,
  cm.invited_by,
  cm.created_at,
  coalesce(p.email::varchar(255), cm.email::varchar(255)) as email,
  p.email_confirmed_at,
  p.last_sign_in_at
from public.company_members cm
left join public.profiles p
  on p.id = cm.user_id;
revoke all on public.company_members_with_auth from anon;
grant select on public.company_members_with_auth to authenticated;;
