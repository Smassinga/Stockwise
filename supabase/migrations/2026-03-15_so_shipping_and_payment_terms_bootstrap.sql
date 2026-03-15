begin;

create or replace function public.seed_default_payment_terms(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if p_company_id is null then
    raise exception 'company_id_required';
  end if;

  insert into public.payment_terms (company_id, code, name, net_days, description)
  values
    (p_company_id, 'DUE_ON_RECEIPT', 'Due on Receipt', 0, 'Payment is due immediately on receipt.'),
    (p_company_id, 'NET7', 'Net 7', 7, 'Payment due seven days from the order or invoice date.'),
    (p_company_id, 'NET15', 'Net 15', 15, 'Payment due fifteen days from the order or invoice date.'),
    (p_company_id, 'NET30', 'Net 30', 30, 'Payment due thirty days from the order or invoice date.'),
    (p_company_id, 'NET60', 'Net 60', 60, 'Payment due sixty days from the order or invoice date.'),
    (p_company_id, 'COD', 'Cash on Delivery', 0, 'Payment due when goods or services are delivered.')
  on conflict (company_id, code) do nothing;
end;
$function$;

create or replace function public.create_company_and_bootstrap(p_name text)
returns table(out_company_id uuid, company_name text, out_role member_role)
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_user        uuid := auth.uid();
  v_email       text;
  v_company_id  uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user;

  select cm.company_id
    into v_company_id
  from public.company_members cm
  where cm.user_id = v_user
    and cm.status  = 'active'::member_status
  order by cm.created_at asc
  limit 1;

  if v_company_id is not null then
    return query
      select c.id          as out_company_id,
             c.name        as company_name,
             cm.role       as out_role
      from public.companies c
      join public.company_members cm
        on cm.company_id = c.id
       and cm.user_id    = v_user
       and cm.status     = 'active'::member_status
      where c.id = v_company_id
      limit 1;
    return;
  end if;

  update public.company_members m
     set user_id = v_user,
         status  = 'active'::member_status
   where m.email   = v_email
     and m.user_id is null
     and m.status  = 'invited'::member_status
   returning m.company_id
     into v_company_id;

  if v_company_id is not null then
    return query
      select c.id                                        as out_company_id,
             c.name                                      as company_name,
             (select cm2.role
                from public.company_members cm2
               where cm2.company_id = c.id
                 and cm2.user_id    = v_user
               limit 1)::member_role                     as out_role
      from public.companies c
      where c.id = v_company_id
      limit 1;
    return;
  end if;

  insert into public.companies (name, owner_user_id)
  values (coalesce(nullif(trim(p_name), ''), 'My Company'), v_user)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, email, role, status, invited_by)
  values (v_company_id, v_user, v_email, 'OWNER'::member_role, 'active'::member_status, v_user)
  on conflict on constraint company_members_pkey do update
    set user_id    = excluded.user_id,
        role       = 'OWNER'::member_role,
        status     = 'active'::member_status,
        invited_by = excluded.invited_by;

  insert into public.company_settings (company_id, data)
  values (v_company_id, '{}'::jsonb)
  on conflict (company_id) do nothing;

  perform public.seed_default_payment_terms(v_company_id);

  return query
    select c.id                 as out_company_id,
           c.name               as company_name,
           'OWNER'::member_role as out_role
    from public.companies c
    where c.id = v_company_id
    limit 1;

exception
  when others then
    raise exception 'bootstrap_error: % (SQLSTATE=%)', sqlerrm, sqlstate;
end;
$function$;

do $$
declare
  v_company_id uuid;
begin
  for v_company_id in
    select c.id
    from public.companies c
    where not exists (
      select 1
      from public.payment_terms pt
      where pt.company_id = c.id
    )
  loop
    perform public.seed_default_payment_terms(v_company_id);
  end loop;
end;
$$;

create or replace function public.sol_recalc_shipped(p_so_line_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_so_id uuid;
  v_qty numeric;
  v_shipped numeric;
  v_now timestamp with time zone := now();
begin
  select so_id, qty
    into v_so_id, v_qty
  from public.sales_order_lines
  where id = p_so_line_id;

  if v_so_id is null then
    return;
  end if;

  select coalesce(sum(s.qty), 0)
    into v_shipped
  from public.sales_shipments s
  where s.so_line_id = p_so_line_id;

  update public.sales_order_lines l
     set shipped_qty = v_shipped,
         is_shipped = (v_shipped >= coalesce(v_qty, 0)),
         shipped_at = case
           when v_shipped >= coalesce(v_qty, 0) then coalesce(l.shipped_at, v_now)
           else l.shipped_at
         end
   where l.id = p_so_line_id;

  perform public.so_maybe_mark_shipped(v_so_id);
end;
$function$;

commit;
