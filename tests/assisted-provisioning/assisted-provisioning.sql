\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'platform-b@stockwise.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-b@stockwise.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'wrong-b@stockwise.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'self-service-b@stockwise.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'stale-platform-b@stockwise.local', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.platform_admins (user_id, email, is_active, note)
values (
  'b0000000-0000-4000-8000-000000000001',
  'platform-b@stockwise.local',
  true,
  'Rollback-only assisted provisioning regression'
);

do $$
begin
  begin
    insert into public.platform_admins (email, is_active, note)
    values (
      'email-only-platform-b@stockwise.local',
      true,
      'Must be rejected without an Auth user identity'
    );
    raise exception 'active email-only platform administrator was accepted';
  exception
    when check_violation then
      if sqlerrm not like '%platform_admins_active_user_required%' then raise; end if;
  end;
  raise notice 'PASS active platform administrator requires an Auth user identity';
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated","email":"self-service-b@stockwise.local"}',
  true
);

select set_config('test.self_service_company_id', out_company_id::text, false)
from public.create_company_and_bootstrap('B Self Service Regression');

do $$
declare
  v_company uuid := current_setting('test.self_service_company_id')::uuid;
begin
  if not exists (
    select 1
    from public.companies c
    join public.company_members cm
      on cm.company_id = c.id
     and cm.user_id = c.owner_user_id
     and cm.role = 'OWNER'::public.member_role
     and cm.status = 'active'::public.member_status
    where c.id = v_company
      and c.owner_user_id = auth.uid()
  ) then
    raise exception 'self-service owner bootstrap regressed';
  end if;
  raise notice 'PASS self-service onboarding preserved';
end
$$;

do $$
declare
  v_company uuid := current_setting('test.self_service_company_id')::uuid;
begin
  if public.platform_admin_has_workspace_company(v_company) is distinct from false then
    raise exception 'missing platform workspace was not a strict denial';
  end if;
  begin
    perform * from public.platform_admin_provision_customer_company(
      'Denied company', null, null, null, 'pt', 'MZ', 'denied-normal-user'
    );
    raise exception 'normal user provisioned a company';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'platform_admin_required' then raise; end if;
  end;
  raise notice 'PASS normal user and missing workspace denied';
end
$$;

reset role;
update public.platform_admins
   set email = 'stale-platform-b@stockwise.local',
       updated_at = now()
 where user_id = 'b0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000005","role":"authenticated","email":"stale-platform-b@stockwise.local"}',
  true
);

do $$
begin
  if public.is_platform_admin() then
    raise exception 'stale platform administrator email inherited platform authority';
  end if;

  begin
    perform * from public.platform_admin_reset_company_operational_data(
      current_setting('test.self_service_company_id')::uuid,
      'invalid confirmation',
      'Stale platform email authority regression'
    );
    raise exception 'stale platform administrator email reached operational reset';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'platform_admin_required' then raise; end if;
  end;

  raise notice 'PASS stale platform administrator email has no platform or reset authority';
end
$$;

reset role;
update public.platform_admins
   set email = 'platform-b@stockwise.local',
       updated_at = now()
 where user_id = 'b0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","email":"platform-b@stockwise.local"}',
  true
);

select set_config('test.assisted_company_id', company_id::text, false)
from public.platform_admin_provision_customer_company(
  'OPS-QA Assisted Customer',
  'owner-b@stockwise.local',
  'ops-assisted@stockwise.local',
  null,
  'pt',
  'MZ',
  'assisted-rollback-key'
);

do $$
declare
  v_company uuid := current_setting('test.assisted_company_id')::uuid;
  v_repeat uuid;
  v_state record;
begin
  select company_id into strict v_repeat
  from public.platform_admin_provision_customer_company(
    'OPS-QA Assisted Customer',
    'owner-b@stockwise.local',
    'ops-assisted@stockwise.local',
    null,
    'pt',
    'MZ',
    'assisted-rollback-key'
  );
  if v_repeat <> v_company then raise exception 'provisioning idempotency failed'; end if;
  if v_company = any(coalesce(public.current_user_company_ids(), '{}'::uuid[])) then
    raise exception 'platform administrator received fake membership';
  end if;
  select * into strict v_state
  from public.platform_admin_get_assisted_company_state(v_company);
  if v_state.owner_user_id is not null
     or v_state.owner_state <> 'unassigned'
     or v_state.subscription_status <> 'disabled'::public.subscription_status
     or v_state.trial_started_at is not null
     or v_state.trial_expires_at is not null then
    raise exception 'ownerless shell or disabled no-trial state missing';
  end if;
  raise notice 'PASS ownerless shell and trial not started';

  begin
    perform * from public.platform_admin_provision_customer_company(
      'Denied platform-owned company',
      'platform-b@stockwise.local',
      null,
      null,
      'pt',
      'MZ',
      'assisted-platform-owner-denied'
    );
    raise exception 'platform administrator accepted as intended owner';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'assisted_invitee_must_not_be_platform_admin' then raise; end if;
  end;

  begin
    perform * from public.platform_admin_invite_assisted_owner(
      v_company,
      'platform-b@stockwise.local',
      null
    );
    raise exception 'platform administrator invited as assisted owner';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'assisted_invitee_must_not_be_platform_admin' then raise; end if;
  end;

  begin
    perform * from public.platform_admin_start_assisted_trial(v_company);
    raise exception 'trial started before customer owner activation';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'assisted_owner_activation_required_before_trial' then raise; end if;
  end;
end
$$;

select * from public.platform_admin_open_customer_workspace(
  current_setting('test.assisted_company_id')::uuid
);

do $$
begin
  begin
    perform public.platform_admin_invite_assisted_member(
      current_setting('test.assisted_company_id')::uuid,
      'platform-b@stockwise.local',
      'ADMIN'::public.member_role
    );
    raise exception 'platform administrator invited as assisted tenant member';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'assisted_invitee_must_not_be_platform_admin' then raise; end if;
  end;
  raise notice 'PASS platform administrator identity cannot become assisted tenant member or owner';
end
$$;

select set_config(
  'test.assisted_member_invite_token',
  public.platform_admin_invite_assisted_member(
    current_setting('test.assisted_company_id')::uuid,
    'platform-alias-b@stockwise.local',
    'ADMIN'::public.member_role
  )::text,
  false
);

reset role;
update auth.users
   set email = 'platform-alias-b@stockwise.local',
       updated_at = now()
 where id = 'b0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","email":"platform-alias-b@stockwise.local"}',
  true
);

do $$
begin
  begin
    perform public.accept_invite_with_token(
      current_setting('test.assisted_member_invite_token')::uuid
    );
    raise exception 'platform administrator accepted assisted invite after changing email';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'assisted_invitee_must_not_be_platform_admin' then raise; end if;
  end;
  raise notice 'PASS platform administrator cannot accept an assisted invite after changing email';
end
$$;

reset role;
update auth.users
   set email = 'platform-b@stockwise.local',
       updated_at = now()
 where id = 'b0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","email":"platform-b@stockwise.local"}',
  true
);

insert into public.warehouses (id, company_id, code, name, status)
values (
  'b1000000-0000-4000-8000-000000000001',
  current_setting('test.assisted_company_id')::uuid,
  'B-QA-WH',
  'B QA Warehouse',
  'active'
);

insert into public.bins (id, company_id, "warehouseId", code, name, status)
values (
  'b-qa-bin',
  current_setting('test.assisted_company_id')::uuid,
  'b1000000-0000-4000-8000-000000000001',
  'B-QA-BIN',
  'B QA Bin',
  'active'
);

insert into public.bins (id, company_id, "warehouseId", code, name, status)
values (
  'b-qa-empty-bin',
  current_setting('test.assisted_company_id')::uuid,
  'b1000000-0000-4000-8000-000000000001',
  'B-QA-EMPTY-BIN',
  'B QA Empty Bin',
  'active'
);

delete from public.bins
where id = 'b-qa-empty-bin';

do $$
begin
  if exists (select 1 from public.bins where id = 'b-qa-empty-bin') then
    raise exception 'empty assisted bin was not deleted';
  end if;
  raise notice 'PASS empty assisted bin remains deletable';
end
$$;

insert into public.warehouses (id, company_id, code, name, status)
values (
  'b1000000-0000-4000-8000-000000000002',
  current_setting('test.assisted_company_id')::uuid,
  'B-QA-EMPTY',
  'B QA Empty Warehouse',
  'active'
);

delete from public.warehouses
where id = 'b1000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1 from public.warehouses
    where id = 'b1000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'empty assisted warehouse was not deleted';
  end if;
  raise notice 'PASS empty assisted warehouse remains deletable';
end
$$;

reset role;
insert into public.warehouses (id, company_id, code, name, status)
values (
  'b1000000-0000-4000-8000-000000000099',
  current_setting('test.self_service_company_id')::uuid,
  'B-OTHER-WH',
  'B Other Company Warehouse',
  'active'
);
select set_config(
  'test.other_payment_term_id',
  (
    select pt.id::text
    from public.payment_terms pt
    where pt.company_id = current_setting('test.self_service_company_id')::uuid
    order by pt.created_at
    limit 1
  ),
  false
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","email":"platform-b@stockwise.local"}',
  true
);

do $$
declare
  v_updated integer := 0;
begin
  begin
    update public.bins
       set "warehouseId" = 'b1000000-0000-4000-8000-000000000099'
     where id = 'b-qa-bin';
    get diagnostics v_updated = row_count;
    if v_updated <> 0 then raise exception 'cross-company bin reassignment succeeded'; end if;
  exception when insufficient_privilege or check_violation then null;
  end;
  raise notice 'PASS assisted bin remains in its company warehouse';
end
$$;

do $$
declare
  v_other_term uuid;
begin
  v_other_term := current_setting('test.other_payment_term_id')::uuid;

  begin
    insert into public.customers (company_id, code, name, payment_terms_id)
    values (
      current_setting('test.assisted_company_id')::uuid,
      'B-CROSS-TERM-CUSTOMER',
      'B Cross-term Customer',
      v_other_term
    );
    raise exception 'cross-company customer payment term accepted';
  exception when insufficient_privilege or check_violation then null;
  end;

  begin
    insert into public.suppliers (company_id, code, name, payment_terms_id)
    values (
      current_setting('test.assisted_company_id')::uuid,
      'B-CROSS-TERM-SUPPLIER',
      'B Cross-term Supplier',
      v_other_term
    );
    raise exception 'cross-company supplier payment term accepted';
  exception when insufficient_privilege or check_violation then null;
  end;

  raise notice 'PASS assisted customer and supplier terms remain company scoped';
end
$$;

do $$
begin
  begin
    insert into public.items (
      id, company_id, sku, name, base_uom_id, unit_price, min_stock,
      primary_role, track_inventory, can_buy, can_sell, is_assembled
    ) values (
      'b2000000-0000-4000-8000-000000000099',
      current_setting('test.assisted_company_id')::uuid,
      'B-DIRECT-ITEM',
      'B Direct Item',
      (select id from public.uoms where code = 'EA' limit 1),
      10, 1, 'resale', true, true, true, false
    );
    raise exception 'direct assisted item insert succeeded';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('test.assisted_item_id', id::text, false)
from public.create_item_with_profile(
  current_setting('test.assisted_company_id')::uuid,
  'B-QA-ITEM',
  'B QA Item',
  (select id from public.uoms where code = 'EA' limit 1),
  1,
  10,
  'resale',
  true,
  true,
  true,
  false
);

do $$
declare
  v_updated integer := 0;
  v_saved public.items%rowtype;
begin
  begin
    update public.items
       set name = 'B Tampered Item'
     where id = current_setting('test.assisted_item_id')::uuid;
    get diagnostics v_updated = row_count;
    if v_updated <> 0 then raise exception 'direct assisted item profile update succeeded'; end if;
  exception when insufficient_privilege then null;
  end;

  select * into strict v_saved
  from public.platform_admin_update_assisted_item_min_stock(
    current_setting('test.assisted_company_id')::uuid,
    current_setting('test.assisted_item_id')::uuid,
    1.25
  );
  if v_saved.min_stock <> 1.25 or v_saved.name <> 'B QA Item' then
    raise exception 'governed assisted minimum-stock update failed';
  end if;
  raise notice 'PASS assisted item profile uses governed creation and minimum-stock update';
end
$$;

do $$
declare
  v_updated integer := 0;
  v_deleted integer := 0;
begin
  insert into public.company_currencies (company_id, currency_code)
  values
    (current_setting('test.assisted_company_id')::uuid, 'MZN'),
    (current_setting('test.assisted_company_id')::uuid, 'USD')
  on conflict do nothing;

  perform public.platform_admin_set_assisted_base_currency(
    current_setting('test.assisted_company_id')::uuid,
    'MZN'
  );
  begin
    update public.company_settings
       set base_currency_code = 'USD'
     where company_id = current_setting('test.assisted_company_id')::uuid;
    get diagnostics v_updated = row_count;
    if v_updated <> 0 then raise exception 'direct assisted base-currency update succeeded'; end if;
  exception when insufficient_privilege then null;
  end;
  delete from public.company_currencies
   where company_id = current_setting('test.assisted_company_id')::uuid
     and currency_code = 'MZN';
  get diagnostics v_deleted = row_count;
  if v_deleted <> 0 then raise exception 'current assisted base currency was deleted'; end if;

  begin
    insert into public.fx_rates (id, company_id, date, from_code, to_code, rate)
    values (
      'b-assisted-nan-fx',
      current_setting('test.assisted_company_id')::uuid,
      current_date,
      'MZN',
      'USD',
      'NaN'::numeric
    );
    raise exception 'non-finite assisted FX rate accepted';
  exception when insufficient_privilege or check_violation then null;
  end;

  raise notice 'PASS assisted base currency remains governed and enabled';
end
$$;

reset role;
do $$
begin
  begin
    delete from public.company_currencies
     where company_id = current_setting('test.assisted_company_id')::uuid
       and currency_code = 'MZN';
    raise exception 'base currency deleted despite enabled-base foreign key';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS base currency enabled invariant survives privileged concurrent writes';
end
$$;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","email":"platform-b@stockwise.local"}',
  true
);

do $$
begin
  begin
    perform *
    from public.platform_admin_post_opening_stock_import(
      current_setting('test.assisted_company_id')::uuid,
      jsonb_build_array(jsonb_build_object(
        'item_id', current_setting('test.assisted_item_id'),
        'uom_id', (select id from public.uoms where code = 'EA' limit 1),
        'qty', 'NaN',
        'qty_base', 'NaN',
        'unit_cost', 5,
        'total_value', 5,
        'warehouse_to_id', 'b1000000-0000-4000-8000-000000000001',
        'bin_to_id', 'b-qa-bin'
      )),
      'b-assisted-opening-stock-nonfinite'
    );
    raise exception 'non-finite opening quantity accepted';
  exception when raise_exception then
    if sqlerrm not like '%Opening-stock row % is incomplete.%' then raise; end if;
  end;
  raise notice 'PASS non-finite assisted opening quantities rejected';
end
$$;

select *
from public.platform_admin_post_opening_stock_import(
  current_setting('test.assisted_company_id')::uuid,
  jsonb_build_array(jsonb_build_object(
    'item_id', current_setting('test.assisted_item_id'),
    'uom_id', (select id from public.uoms where code = 'EA' limit 1),
    'qty', 1.375,
    'qty_base', 1.375,
    'unit_cost', 5,
    'total_value', 6.88,
    'warehouse_to_id', 'b1000000-0000-4000-8000-000000000001',
    'bin_to_id', 'b-qa-bin',
    'notes', 'B rollback-only opening stock'
  )),
  'b-assisted-opening-stock'
);

do $$
begin
  begin
    delete from public.bins
    where id = 'b-qa-bin';
    raise exception 'bin with inventory evidence was deleted';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'bin_has_inventory_evidence' then raise; end if;
  end;

  if not exists (select 1 from public.bins where id = 'b-qa-bin') then
    raise exception 'bin disappeared after guarded delete';
  end if;
  raise notice 'PASS bin inventory evidence blocks deletion';

  begin
    delete from public.warehouses
    where id = 'b1000000-0000-4000-8000-000000000001';
    raise exception 'warehouse with inventory evidence was deleted';
  exception
    when foreign_key_violation then
      if sqlerrm <> 'warehouse_has_inventory_evidence' then raise; end if;
  end;

  if not exists (
    select 1
    from public.warehouses w
    where w.id = 'b1000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'warehouse disappeared after guarded delete';
  end if;
  raise notice 'PASS warehouse inventory evidence blocks deletion';
end
$$;

do $$
declare
  v_company uuid := current_setting('test.assisted_company_id')::uuid;
  v_updated integer := 0;
begin
  if public.current_company_id() is not null
     or public.has_company_role(v_company, array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]) then
    raise exception 'workspace leaked into normal membership authority';
  end if;
  if not exists (select 1 from public.items i where i.company_id = v_company and i.sku = 'B-QA-ITEM') then
    raise exception 'setup-table policy failed';
  end if;
  if exists (select 1 from public.stock_levels sl where sl.company_id = v_company) then
    raise exception 'platform context leaked stock-level read authority';
  end if;
  raise notice 'PASS narrow workspace setup and no membership authority';

  begin
    update public.companies set owner_user_id = auth.uid() where id = v_company;
    get diagnostics v_updated = row_count;
    if v_updated <> 0 then
      raise exception 'direct owner assignment succeeded';
    end if;
  exception
    when insufficient_privilege then null;
  end;
  raise notice 'PASS direct owner assignment denied';
end
$$;

select set_config('test.assisted_invite_token', invite_token::text, false)
from public.platform_admin_invite_assisted_owner(
  current_setting('test.assisted_company_id')::uuid,
  'owner-b@stockwise.local',
  timezone('utc', now()) + interval '2 days'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000003","role":"authenticated","email":"wrong-b@stockwise.local"}',
  true
);

do $$
begin
  begin
    perform public.accept_invite_with_token(current_setting('test.assisted_invite_token')::uuid);
    raise exception 'wrong email accepted owner invitation';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'invite_email_mismatch' then raise; end if;
  end;
  raise notice 'PASS wrong-email acceptance denied';
end
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated","email":"owner-b@stockwise.local"}',
  true
);
select public.accept_invite_with_token(current_setting('test.assisted_invite_token')::uuid);

do $$
declare
  v_company uuid := current_setting('test.assisted_company_id')::uuid;
begin
  if not exists (
    select 1
    from public.companies c
    join public.company_members cm
      on cm.company_id = c.id
     and cm.user_id = c.owner_user_id
     and cm.role = 'OWNER'::public.member_role
     and cm.status = 'active'::public.member_status
    where c.id = v_company
      and c.owner_user_id = auth.uid()
  ) then raise exception 'owner handover did not activate exact identity'; end if;

  -- After handover the OWNER can update ordinary company profile fields, but
  -- still cannot bypass the invitation finalizer to transfer ownership.
  begin
    update public.companies
    set owner_user_id = 'b0000000-0000-4000-8000-000000000003'
    where id = v_company;
    raise exception 'active owner bypassed governed handover';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'assisted_owner_change_requires_invitation_acceptance' then raise; end if;
  end;
  raise notice 'PASS exact owner handover closes context';
end
$$;

reset role;
do $$
declare
  v_company uuid := current_setting('test.assisted_company_id')::uuid;
begin
  if exists (select 1 from public.platform_admin_workspace_contexts where company_id = v_company) then
    raise exception 'workspace context survived owner handover';
  end if;
  if not exists (
    select 1 from public.stock_levels sl
    where sl.company_id = v_company
      and sl.item_id = current_setting('test.assisted_item_id')::uuid
      and sl.qty = 1.375
  ) then raise exception 'governed opening stock did not persist exact quantity'; end if;
end
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated","email":"platform-b@stockwise.local"}',
  true
);
select set_config('test.assisted_trial_started_at', trial_started_at::text, false)
from public.platform_admin_start_assisted_trial(
  current_setting('test.assisted_company_id')::uuid
);

do $$
declare
  v_company uuid := current_setting('test.assisted_company_id')::uuid;
  v_first_started timestamptz;
  v_repeat record;
begin
  v_first_started := current_setting('test.assisted_trial_started_at')::timestamptz;

  select * into strict v_repeat
  from public.platform_admin_start_assisted_trial(v_company);
  if v_repeat.started_now
     or v_repeat.trial_started_at <> v_first_started
     or v_repeat.trial_expires_at <> v_first_started + interval '7 days' then
    raise exception 'one-time seven-day trial contract failed';
  end if;
  raise notice 'PASS exact one-time seven-day trial';
end
$$;

rollback;
