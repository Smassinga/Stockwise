\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'uom-integrity-owner@stockwise.local',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.companies (id, name, owner_user_id)
values (
  '22222222-2222-4222-8222-222222222222',
  'UOM Integrity Local QA',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.company_subscription_state (
  company_id,
  plan_code,
  subscription_status,
  paid_until
) values (
  '22222222-2222-4222-8222-222222222222',
  'starter',
  'active_paid',
  now() + interval '1 day'
)
on conflict (company_id) do update
set plan_code = excluded.plan_code,
    subscription_status = excluded.subscription_status,
    paid_until = excluded.paid_until;

insert into public.company_members (company_id, user_id, email, role, status)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'uom-integrity-owner@stockwise.local',
  'OWNER',
  'active'
)
on conflict (company_id, email) do update
set user_id = excluded.user_id,
    role = excluded.role,
    status = excluded.status;

insert into public.user_active_company (user_id, company_id)
values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

do $$
declare
  v_canonical_id text;
  v_result record;
  v_mass record;
  v_volume record;
  v_custom record;
begin
  select id into strict v_canonical_id
  from public.uoms
  where code = 'EA';

  select * into strict v_result
  from public.create_uom('EA', 'Each', 'count');
  if v_result.id <> v_canonical_id or v_result.was_created then
    raise exception 'canonical reuse failed';
  end if;
  raise notice 'PASS canonical reuse';

  select * into strict v_result
  from public.create_uom('each', 'EACH', 'count');
  if v_result.id <> v_canonical_id or v_result.was_created then
    raise exception 'case normalization failed';
  end if;
  raise notice 'PASS case normalization';

  select * into strict v_result
  from public.create_uom(' EACH ', ' Each ', 'count');
  if v_result.id <> v_canonical_id or v_result.was_created then
    raise exception 'whitespace normalization failed';
  end if;
  raise notice 'PASS whitespace normalization';

  begin
    perform * from public.create_uom('EA-DEADBEEF', 'Each', 'count');
    raise exception 'generated code was accepted';
  exception
    when check_violation then
      if sqlerrm <> 'uom_code_looks_item_specific' then
        raise;
      end if;
  end;
  raise notice 'PASS generated-code rejection';

  begin
    perform * from public.create_uom('EA', 'Counter unit', 'other');
    raise exception 'conflicting canonical code was accepted';
  exception
    when unique_violation then
      if sqlerrm not like 'uom_code_exists:%' then
        raise;
      end if;
  end;
  raise notice 'PASS exact-code conflict rejection';

  select * into strict v_mass
  from public.create_uom('QA-MASS', 'QA Shared Name', 'mass');
  select * into strict v_volume
  from public.create_uom('QA-VOLUME', 'QA Shared Name', 'volume');
  if not v_mass.was_created or not v_volume.was_created or v_mass.id = v_volume.id then
    raise exception 'legitimate cross-family units were not kept distinct';
  end if;
  raise notice 'PASS same normalized name in distinct families';

  select * into strict v_custom
  from public.create_uom('QA-DISP', 'QA Disposable Unit', 'other');
  if not v_custom.was_created then
    raise exception 'legitimate custom UOM was not created';
  end if;

  if not exists (
    select 1
    from public.uoms u
    where u.id = v_custom.id
      and u.created_by_user_id = '11111111-1111-4111-8111-111111111111'
      and u.created_for_company_id = '22222222-2222-4222-8222-222222222222'
      and public.uom_equivalence_key(u.code, u.name, u.family) =
          'custom:other:qadisposableunit'
  ) then
    raise exception 'custom UOM provenance or equivalence key is incorrect';
  end if;
  raise notice 'PASS legitimate custom creation and provenance';

  begin
    insert into public.uoms (code, name, family)
    values ('QA-DIRECT-I', 'QA Direct Insert', 'other');
    raise exception 'direct authenticated INSERT was accepted';
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'PASS direct INSERT denied';

  begin
    update public.uoms set name = 'Changed' where id = v_canonical_id;
    raise exception 'direct authenticated UPDATE was accepted';
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'PASS direct UPDATE denied';

  begin
    delete from public.uoms where id = v_canonical_id;
    raise exception 'direct authenticated DELETE was accepted';
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'PASS direct DELETE denied';

  begin
    execute 'truncate table public.uoms';
    raise exception 'direct authenticated TRUNCATE was accepted';
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'PASS direct TRUNCATE denied';
end
$$;

rollback;
