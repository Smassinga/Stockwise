-- PLATFORM-ADMIN assisted customer provisioning.
--
-- This migration deliberately keeps the assisted workspace separate from
-- company membership. A platform administrator receives a short-lived,
-- explicit administrative context for one provisioned company; the customer
-- OWNER remains unassigned until the intended email explicitly accepts the
-- invitation.

-- Platform-administrator authority is identity-bound. A stored email remains
-- useful audit context, but a recycled or changed email must never confer the
-- privileges of the active platform-admin user.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.platform_admins pa
      where pa.is_active
        and pa.user_id = auth.uid()
    );
$$;

alter function public.is_platform_admin() owner to postgres;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

alter table public.platform_admins
  drop constraint if exists platform_admins_active_user_required;
alter table public.platform_admins
  add constraint platform_admins_active_user_required
  check (not is_active or user_id is not null);

create table public.assisted_company_provisioning (
  company_id uuid primary key references public.companies(id) on delete cascade,
  provisioned_by uuid not null references auth.users(id) on delete restrict,
  provisioned_at timestamptz not null default timezone('utc', now()),
  request_key text not null,
  request_payload_hash text not null,
  intended_owner_email text,
  owner_invited_at timestamptz,
  owner_activated_at timestamptz,
  owner_activated_user_id uuid references auth.users(id) on delete set null,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assisted_company_provisioning_request_key_present
    check (nullif(btrim(request_key), '') is not null),
  constraint assisted_company_provisioning_hash_present
    check (nullif(btrim(request_payload_hash), '') is not null),
  constraint assisted_company_provisioning_owner_email_normalized
    check (
      intended_owner_email is null
      or intended_owner_email = lower(btrim(intended_owner_email))
    ),
  constraint assisted_company_provisioning_trial_window
    check (
      (trial_started_at is null and trial_expires_at is null)
      or (
        trial_started_at is not null
        and trial_expires_at = trial_started_at + interval '7 days'
      )
    ),
  unique (provisioned_by, request_key)
);

create index assisted_company_provisioning_owner_email_idx
  on public.assisted_company_provisioning (lower(intended_owner_email))
  where intended_owner_email is not null;

alter table public.assisted_company_provisioning enable row level security;
alter table public.assisted_company_provisioning force row level security;
revoke all on table public.assisted_company_provisioning from public, anon, authenticated;
grant select, insert, update, delete on table public.assisted_company_provisioning to service_role;

create table public.platform_admin_workspace_contexts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.assisted_company_provisioning(company_id) on delete cascade,
  opened_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint platform_admin_workspace_context_window
    check (expires_at > opened_at and expires_at <= opened_at + interval '2 hours')
);

create index platform_admin_workspace_contexts_company_idx
  on public.platform_admin_workspace_contexts (company_id, expires_at);

alter table public.platform_admin_workspace_contexts enable row level security;
alter table public.platform_admin_workspace_contexts force row level security;
revoke all on table public.platform_admin_workspace_contexts from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_admin_workspace_contexts to service_role;

alter table public.company_control_action_log
  drop constraint if exists company_control_action_log_action_type_check;
alter table public.company_control_action_log
  add constraint company_control_action_log_action_type_check check (action_type in (
    'operational_reset',
    'access_email_expiry_warning_sent',
    'access_email_purge_warning_sent',
    'access_email_activation_confirmation_sent',
    'payment_channel_created',
    'payment_channel_updated',
    'payment_channel_activated',
    'payment_channel_deactivated',
    'payment_request_submitted',
    'payment_request_review_started',
    'payment_request_correction_requested',
    'payment_request_rejected',
    'payment_request_approved',
    'payment_request_cancelled',
    'assisted_company_provisioned',
    'assisted_workspace_opened',
    'assisted_trial_started',
    'assisted_owner_invited',
    'assisted_member_invited',
    'assisted_owner_activated'
  ));

-- An ownerless insert is intentional only for the governed assisted primitive.
-- Self-service inserts still pass owner_user_id explicitly and keep their
-- existing membership bootstrap.
create or replace function public.tg_companies_autolink()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  owner_email text;
begin
  if new.owner_user_id is null then
    return new;
  end if;

  select lower(u.email)
    into owner_email
  from auth.users u
  where u.id = new.owner_user_id;

  if owner_email is null then
    raise exception 'company_owner_user_not_found' using errcode = '23503';
  end if;

  insert into public.company_members (
    company_id,
    user_id,
    email,
    role,
    status,
    invited_by
  ) values (
    new.id,
    new.owner_user_id,
    owner_email,
    'OWNER'::public.member_role,
    'active'::public.member_status,
    new.owner_user_id
  )
  on conflict (company_id, email) do update
    set user_id = excluded.user_id,
        role = 'OWNER'::public.member_role,
        status = 'active'::public.member_status;

  return new;
end;
$$;

alter function public.tg_companies_autolink() owner to postgres;

create or replace function public.platform_admin_workspace_company_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select pawc.company_id
  from public.platform_admin_workspace_contexts pawc
  join public.assisted_company_provisioning acp
    on acp.company_id = pawc.company_id
  where pawc.user_id = auth.uid()
    and pawc.expires_at > timezone('utc', now())
    and acp.owner_activated_at is null
    and public.is_platform_admin()
  limit 1;
$$;

alter function public.platform_admin_workspace_company_id() owner to postgres;
revoke all on function public.platform_admin_workspace_company_id()
  from public, anon, authenticated;

create or replace function public.platform_admin_has_workspace_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select p_company_id is not null
    and coalesce(
      p_company_id = public.platform_admin_workspace_company_id(),
      false
    );
$$;

alter function public.platform_admin_has_workspace_company(uuid) owner to postgres;
revoke all on function public.platform_admin_has_workspace_company(uuid)
  from public, anon;
grant execute on function public.platform_admin_has_workspace_company(uuid)
  to authenticated;

-- The platform workspace is deliberately NOT wired into current_company_id,
-- current_user_company_ids, has_company_role, actor_role_for, or membership
-- helpers. Doing so would implicitly grant finance and posting authority. The
-- following additive policies expose only the B9 setup tables while a live,
-- explicit workspace context exists.
create policy companies_select_platform_workspace
  on public.companies for select to authenticated
  using (public.platform_admin_has_workspace_company(id));

-- OWNER assignment is never a generic company-profile edit. Assisted shells
-- may assign their first OWNER only from the exact-email invitation finalizer.
create or replace function public.tg_guard_assisted_company_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.assisted_company_provisioning acp
    where acp.company_id = new.id
  ) and (
    coalesce(current_setting('stockwise.assisted_owner_handover', true), '') <> 'on'
    or new.owner_user_id is null
    or new.owner_user_id is distinct from auth.uid()
  ) then
    raise exception 'assisted_owner_change_requires_invitation_acceptance'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function public.tg_guard_assisted_company_owner() owner to postgres;
revoke all on function public.tg_guard_assisted_company_owner() from public, anon, authenticated;
grant execute on function public.tg_guard_assisted_company_owner() to service_role;

drop trigger if exists bu_guard_assisted_company_owner on public.companies;
create trigger bu_guard_assisted_company_owner
before update of owner_user_id on public.companies
for each row
when (old.owner_user_id is distinct from new.owner_user_id)
execute function public.tg_guard_assisted_company_owner();

-- Assisted setup authority must never be converted into persistent tenant
-- authority. Match both the maintained platform-admin email and the current
-- Auth email for an active platform-admin user id so an email change cannot
-- bypass this separation.
create or replace function public.stockwise_email_is_active_platform_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.platform_admins pa
    left join auth.users u on u.id = pa.user_id
    where pa.is_active
      and (
        lower(btrim(pa.email)) = lower(btrim(coalesce(p_email, '')))
        or lower(coalesce(u.email, '')) = lower(btrim(coalesce(p_email, '')))
      )
  );
$$;

alter function public.stockwise_email_is_active_platform_admin(text) owner to postgres;
revoke all on function public.stockwise_email_is_active_platform_admin(text)
  from public, anon, authenticated;

create policy company_settings_select_platform_workspace
  on public.company_settings for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

create policy company_communication_profiles_select_platform_workspace
  on public.company_communication_profiles for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy company_communication_profiles_insert_platform_workspace
  on public.company_communication_profiles for insert to authenticated
  with check (public.platform_admin_has_workspace_company(company_id));
create policy company_communication_profiles_update_platform_workspace
  on public.company_communication_profiles for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (public.platform_admin_has_workspace_company(company_id));

create policy warehouses_select_platform_workspace
  on public.warehouses for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy warehouses_insert_platform_workspace
  on public.warehouses for insert to authenticated
  with check (public.platform_admin_has_workspace_company(company_id));
create policy warehouses_update_platform_workspace
  on public.warehouses for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (public.platform_admin_has_workspace_company(company_id));
create policy warehouses_delete_platform_workspace
  on public.warehouses for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

-- Warehouse/bin location evidence is operational history, not disposable
-- presentation state. Enforce the existing UI rule authoritatively so an
-- assisted workspace (which intentionally cannot read stock ledgers) cannot
-- mistake an RLS-hidden count for an empty warehouse and sever those links.
create or replace function public.tg_guard_warehouse_delete_inventory_evidence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if exists (
    select 1
    from public.stock_levels sl
    where sl.warehouse_id = old.id
       or sl.bin_id in (
         select b.id
         from public.bins b
         where b."warehouseId" = old.id
       )
  ) or exists (
    select 1
    from public.stock_movements sm
    where sm.warehouse_from_id = old.id
       or sm.warehouse_to_id = old.id
       or sm.bin_from_id in (
         select b.id
         from public.bins b
         where b."warehouseId" = old.id
       )
       or sm.bin_to_id in (
         select b.id
         from public.bins b
         where b."warehouseId" = old.id
       )
  ) then
    raise exception 'warehouse_has_inventory_evidence'
      using errcode = '23503';
  end if;

  return old;
end
$$;

alter function public.tg_guard_warehouse_delete_inventory_evidence() owner to postgres;
revoke all on function public.tg_guard_warehouse_delete_inventory_evidence()
  from public, anon, authenticated;

drop trigger if exists tg_guard_warehouse_delete_inventory_evidence
  on public.warehouses;
create trigger tg_guard_warehouse_delete_inventory_evidence
before delete on public.warehouses
for each row execute function public.tg_guard_warehouse_delete_inventory_evidence();

create policy bins_select_platform_workspace
  on public.bins for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy bins_insert_platform_workspace
  on public.bins for insert to authenticated
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and exists (
      select 1 from public.warehouses w
      where w.id = bins."warehouseId" and w.company_id = bins.company_id
    )
  );
create policy bins_update_platform_workspace
  on public.bins for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and exists (
      select 1 from public.warehouses w
      where w.id = bins."warehouseId" and w.company_id = bins.company_id
    )
  );
create policy bins_delete_platform_workspace
  on public.bins for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

create or replace function public.tg_guard_bin_delete_inventory_evidence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if exists (
    select 1
    from public.stock_levels sl
    where sl.bin_id = old.id
  ) or exists (
    select 1
    from public.stock_movements sm
    where sm.bin_from_id = old.id
       or sm.bin_to_id = old.id
  ) then
    raise exception 'bin_has_inventory_evidence'
      using errcode = '23503';
  end if;

  return old;
end
$$;

alter function public.tg_guard_bin_delete_inventory_evidence() owner to postgres;
revoke all on function public.tg_guard_bin_delete_inventory_evidence()
  from public, anon, authenticated;

drop trigger if exists tg_guard_bin_delete_inventory_evidence
  on public.bins;
create trigger tg_guard_bin_delete_inventory_evidence
before delete on public.bins
for each row execute function public.tg_guard_bin_delete_inventory_evidence();

create policy items_select_platform_workspace
  on public.items for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy items_delete_platform_workspace
  on public.items for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

-- Keep one authoritative item-profile creation contract. Assisted workspace
-- access is admitted only for the exact live company; all existing profile,
-- UOM, finite-number, and SKU checks remain unchanged.
create or replace function public.create_item_with_profile(
  p_company_id uuid,
  p_sku text,
  p_name text,
  p_base_uom_id text,
  p_min_stock numeric default 0,
  p_unit_price numeric default null,
  p_primary_role text default 'general',
  p_track_inventory boolean default true,
  p_can_buy boolean default true,
  p_can_sell boolean default true,
  p_is_assembled boolean default false
)
returns public.items
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item public.items%rowtype;
  v_sku text := btrim(coalesce(p_sku, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_role text := lower(btrim(coalesce(p_primary_role, '')));
  v_min_stock numeric;
  v_unit_price numeric;
begin
  if auth.uid() is null then
    raise exception 'item_profile_authentication_required' using errcode = '42501';
  end if;
  if p_company_id is null
     or not (
       public.has_company_role(
         p_company_id,
         array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
       )
       or public.platform_admin_has_workspace_company(p_company_id)
     ) then
    raise exception 'item_profile_create_permission_denied' using errcode = '42501';
  end if;
  if v_sku = '' or v_name = '' or nullif(btrim(coalesce(p_base_uom_id, '')), '') is null then
    raise exception 'item_profile_required_fields';
  end if;
  if not exists (select 1 from public.uoms where id = p_base_uom_id) then
    raise exception 'item_profile_base_uom_invalid';
  end if;
  if v_role not in ('general', 'resale', 'raw_material', 'finished_good', 'assembled_product', 'service') then
    raise exception 'item_profile_role_invalid';
  end if;
  if p_min_stock is null or lower(p_min_stock::text) in ('nan', 'infinity', '-infinity') or p_min_stock < 0 then
    raise exception 'item_profile_min_stock_invalid';
  end if;
  v_min_stock := p_min_stock;
  if p_unit_price is not null and (
    lower(p_unit_price::text) in ('nan', 'infinity', '-infinity') or p_unit_price < 0
  ) then
    raise exception 'item_profile_unit_price_invalid';
  end if;
  if coalesce(p_can_sell, false) and p_unit_price is null then
    raise exception 'item_profile_unit_price_required';
  end if;
  if coalesce(p_is_assembled, false) and not coalesce(p_track_inventory, false) then
    raise exception 'item_profile_assembled_requires_tracking';
  end if;
  if exists (
    select 1 from public.items
    where company_id = p_company_id and lower(sku) = lower(v_sku)
  ) then
    raise exception 'item_profile_sku_not_unique';
  end if;

  v_unit_price := case when coalesce(p_can_sell, false) then p_unit_price else null end;

  insert into public.items (
    company_id, sku, name, base_uom_id, min_stock, unit_price,
    primary_role, track_inventory, can_buy, can_sell, is_assembled
  ) values (
    p_company_id, v_sku, v_name, p_base_uom_id, v_min_stock, v_unit_price,
    v_role, coalesce(p_track_inventory, false), coalesce(p_can_buy, false),
    coalesce(p_can_sell, false), coalesce(p_is_assembled, false)
  ) returning * into v_item;

  return v_item;
end;
$$;

alter function public.create_item_with_profile(
  uuid,text,text,text,numeric,numeric,text,boolean,boolean,boolean,boolean
) owner to postgres;
revoke all on function public.create_item_with_profile(
  uuid,text,text,text,numeric,numeric,text,boolean,boolean,boolean,boolean
) from public, anon;
grant execute on function public.create_item_with_profile(
  uuid,text,text,text,numeric,numeric,text,boolean,boolean,boolean,boolean
) to authenticated;

create or replace function public.platform_admin_update_assisted_item_min_stock(
  p_company_id uuid,
  p_item_id uuid,
  p_min_stock numeric
)
returns public.items
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_item public.items%rowtype;
begin
  if auth.uid() is null or not public.platform_admin_has_workspace_company(p_company_id) then
    raise exception 'platform_workspace_required' using errcode = '42501';
  end if;
  if p_min_stock is null
     or lower(p_min_stock::text) in ('nan', 'infinity', '-infinity')
     or p_min_stock < 0 then
    raise exception 'item_profile_min_stock_invalid' using errcode = '22023';
  end if;

  update public.items i
     set min_stock = p_min_stock
   where i.id = p_item_id
     and i.company_id = p_company_id
  returning i.* into v_item;
  if not found then
    raise exception 'item_not_found' using errcode = '22023';
  end if;
  return v_item;
end;
$$;

alter function public.platform_admin_update_assisted_item_min_stock(uuid,uuid,numeric) owner to postgres;
revoke all on function public.platform_admin_update_assisted_item_min_stock(uuid,uuid,numeric)
  from public, anon;
grant execute on function public.platform_admin_update_assisted_item_min_stock(uuid,uuid,numeric)
  to authenticated;

create policy customers_select_platform_workspace
  on public.customers for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy customers_insert_platform_workspace
  on public.customers for insert to authenticated
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and (
      payment_terms_id is null
      or exists (
        select 1 from public.payment_terms pt
        where pt.id = customers.payment_terms_id
          and pt.company_id = customers.company_id
      )
    )
  );
create policy customers_update_platform_workspace
  on public.customers for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and (
      payment_terms_id is null
      or exists (
        select 1 from public.payment_terms pt
        where pt.id = customers.payment_terms_id
          and pt.company_id = customers.company_id
      )
    )
  );
create policy customers_delete_platform_workspace
  on public.customers for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

create policy suppliers_select_platform_workspace
  on public.suppliers for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy suppliers_insert_platform_workspace
  on public.suppliers for insert to authenticated
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and (
      payment_terms_id is null
      or exists (
        select 1 from public.payment_terms pt
        where pt.id = suppliers.payment_terms_id
          and pt.company_id = suppliers.company_id
      )
    )
  );
create policy suppliers_update_platform_workspace
  on public.suppliers for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and (
      payment_terms_id is null
      or exists (
        select 1 from public.payment_terms pt
        where pt.id = suppliers.payment_terms_id
          and pt.company_id = suppliers.company_id
      )
    )
  );
create policy suppliers_delete_platform_workspace
  on public.suppliers for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

create policy company_currencies_select_platform_workspace
  on public.company_currencies for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy company_currencies_insert_platform_workspace
  on public.company_currencies for insert to authenticated
  with check (public.platform_admin_has_workspace_company(company_id));

-- A base currency is meaningful only while it is enabled for the same company.
-- The composite FK closes the concurrent set-base/delete write-skew for both
-- assisted and ordinary company administration.
alter table public.company_settings
  add constraint company_settings_enabled_base_currency_fkey
  foreign key (company_id, base_currency_code)
  references public.company_currencies (company_id, currency_code)
  on update cascade
  on delete restrict;

create policy company_currencies_delete_platform_workspace
  on public.company_currencies for delete to authenticated
  using (
    public.platform_admin_has_workspace_company(company_id)
    and not exists (
      select 1 from public.company_settings cs
      where cs.company_id = company_currencies.company_id
        and cs.base_currency_code = company_currencies.currency_code
    )
  );

create policy fx_rates_select_platform_workspace
  on public.fx_rates for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy fx_rates_insert_platform_workspace
  on public.fx_rates for insert to authenticated
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and lower(rate::text) not in ('nan', 'infinity', '-infinity')
    and exists (
      select 1 from public.company_currencies cc
      where cc.company_id = fx_rates.company_id and cc.currency_code = fx_rates.from_code
    )
    and exists (
      select 1 from public.company_currencies cc
      where cc.company_id = fx_rates.company_id and cc.currency_code = fx_rates.to_code
    )
  );
create policy fx_rates_update_platform_workspace
  on public.fx_rates for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (
    public.platform_admin_has_workspace_company(company_id)
    and lower(rate::text) not in ('nan', 'infinity', '-infinity')
    and exists (
      select 1 from public.company_currencies cc
      where cc.company_id = fx_rates.company_id and cc.currency_code = fx_rates.from_code
    )
    and exists (
      select 1 from public.company_currencies cc
      where cc.company_id = fx_rates.company_id and cc.currency_code = fx_rates.to_code
    )
  );
create policy fx_rates_delete_platform_workspace
  on public.fx_rates for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

create policy payment_terms_select_platform_workspace
  on public.payment_terms for select to authenticated
  using (public.platform_admin_has_workspace_company(company_id));
create policy payment_terms_insert_platform_workspace
  on public.payment_terms for insert to authenticated
  with check (public.platform_admin_has_workspace_company(company_id));
create policy payment_terms_update_platform_workspace
  on public.payment_terms for update to authenticated
  using (public.platform_admin_has_workspace_company(company_id))
  with check (public.platform_admin_has_workspace_company(company_id));
create policy payment_terms_delete_platform_workspace
  on public.payment_terms for delete to authenticated
  using (public.platform_admin_has_workspace_company(company_id));

create policy uom_conversions_select_platform_workspace
  on public.uom_conversions for select to authenticated
  using (
    company_id is null
    or public.platform_admin_has_workspace_company(company_id)
  );

-- These setup operations deliberately expose only the editable profile and
-- settings fields used by the existing setup screens. Protected ownership,
-- access, subscription, and finance state are not accepted as parameters.
create or replace function public.platform_admin_update_assisted_company_profile(
  p_company_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_unknown text[];
  v_result jsonb;
begin
  if auth.uid() is null or not public.platform_admin_has_workspace_company(p_company_id) then
    raise exception 'platform_workspace_required' using errcode = '42501';
  end if;

  select array_agg(key order by key) into v_unknown
  from jsonb_object_keys(v_patch) key
  where key <> all (array[
    'legal_name', 'trade_name', 'email_subject_prefix', 'tax_id',
    'registration_no', 'phone', 'email', 'website', 'address_line1',
    'address_line2', 'city', 'state', 'postal_code', 'country_code',
    'print_footer_note', 'logo_path', 'preferred_lang'
  ]::text[]);
  if v_unknown is not null then
    raise exception 'assisted_company_profile_field_not_allowed:%', array_to_string(v_unknown, ',')
      using errcode = '22023';
  end if;
  if v_patch ? 'preferred_lang'
     and lower(coalesce(v_patch ->> 'preferred_lang', '')) not in ('en', 'pt') then
    raise exception 'invalid_preferred_language' using errcode = '22023';
  end if;
  if v_patch ? 'country_code'
     and char_length(upper(coalesce(v_patch ->> 'country_code', ''))) <> 2 then
    raise exception 'invalid_country_code' using errcode = '22023';
  end if;

  update public.companies c
     set legal_name = case when v_patch ? 'legal_name' then nullif(btrim(v_patch ->> 'legal_name'), '') else c.legal_name end,
         trade_name = case when v_patch ? 'trade_name' then nullif(btrim(v_patch ->> 'trade_name'), '') else c.trade_name end,
         email_subject_prefix = case when v_patch ? 'email_subject_prefix' then nullif(btrim(v_patch ->> 'email_subject_prefix'), '') else c.email_subject_prefix end,
         tax_id = case when v_patch ? 'tax_id' then nullif(btrim(v_patch ->> 'tax_id'), '') else c.tax_id end,
         registration_no = case when v_patch ? 'registration_no' then nullif(btrim(v_patch ->> 'registration_no'), '') else c.registration_no end,
         phone = case when v_patch ? 'phone' then nullif(btrim(v_patch ->> 'phone'), '') else c.phone end,
         email = case when v_patch ? 'email' then lower(nullif(btrim(v_patch ->> 'email'), '')) else c.email end,
         website = case when v_patch ? 'website' then nullif(btrim(v_patch ->> 'website'), '') else c.website end,
         address_line1 = case when v_patch ? 'address_line1' then nullif(btrim(v_patch ->> 'address_line1'), '') else c.address_line1 end,
         address_line2 = case when v_patch ? 'address_line2' then nullif(btrim(v_patch ->> 'address_line2'), '') else c.address_line2 end,
         city = case when v_patch ? 'city' then nullif(btrim(v_patch ->> 'city'), '') else c.city end,
         state = case when v_patch ? 'state' then nullif(btrim(v_patch ->> 'state'), '') else c.state end,
         postal_code = case when v_patch ? 'postal_code' then nullif(btrim(v_patch ->> 'postal_code'), '') else c.postal_code end,
         country_code = case when v_patch ? 'country_code' then upper(v_patch ->> 'country_code') else c.country_code end,
         print_footer_note = case when v_patch ? 'print_footer_note' then nullif(btrim(v_patch ->> 'print_footer_note'), '') else c.print_footer_note end,
         logo_path = case when v_patch ? 'logo_path' then nullif(btrim(v_patch ->> 'logo_path'), '') else c.logo_path end,
         preferred_lang = case when v_patch ? 'preferred_lang' then lower(v_patch ->> 'preferred_lang') else c.preferred_lang end
   where c.id = p_company_id
   returning to_jsonb(c.*) into v_result;
  if v_result is null then
    raise exception 'company_not_found' using errcode = '22023';
  end if;
  return v_result - 'owner_user_id';
end;
$$;

alter function public.platform_admin_update_assisted_company_profile(uuid, jsonb) owner to postgres;
revoke all on function public.platform_admin_update_assisted_company_profile(uuid, jsonb)
  from public, anon;
grant execute on function public.platform_admin_update_assisted_company_profile(uuid, jsonb)
  to authenticated;

create or replace function public.platform_admin_update_assisted_company_settings(
  p_company_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_current jsonb;
  v_merged jsonb;
begin
  if auth.uid() is null or not public.platform_admin_has_workspace_company(p_company_id) then
    raise exception 'platform_workspace_required' using errcode = '42501';
  end if;

  select cs.data into v_current
  from public.company_settings cs
  where cs.company_id = p_company_id
  for update;

  v_merged := public.jsonb_deep_merge(
    public.company_settings_defaults(),
    public.jsonb_deep_merge(coalesce(v_current, '{}'::jsonb), coalesce(p_patch, '{}'::jsonb))
  );
  v_merged := jsonb_set(v_merged, '{notifications,recipients,emails}', coalesce(v_merged #> '{notifications,recipients,emails}', '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,phones}', coalesce(v_merged #> '{notifications,recipients,phones}', '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,whatsapp}', coalesce(v_merged #> '{notifications,recipients,whatsapp}', '[]'::jsonb), true);
  if v_merged #>> '{notifications,dailyDigestTime}' is null then
    v_merged := jsonb_set(v_merged, '{notifications,dailyDigestTime}', to_jsonb('08:00'::text), true);
  end if;
  if v_merged #>> '{notifications,timezone}' is null then
    v_merged := jsonb_set(v_merged, '{notifications,timezone}', to_jsonb('Africa/Maputo'::text), true);
  end if;

  insert into public.company_settings (company_id, data, updated_at, updated_by)
  values (p_company_id, v_merged, timezone('utc', now()), auth.uid())
  on conflict (company_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
  returning data into v_merged;
  return v_merged;
end;
$$;

alter function public.platform_admin_update_assisted_company_settings(uuid, jsonb) owner to postgres;
revoke all on function public.platform_admin_update_assisted_company_settings(uuid, jsonb)
  from public, anon;
grant execute on function public.platform_admin_update_assisted_company_settings(uuid, jsonb)
  to authenticated;

create or replace function public.platform_admin_set_assisted_base_currency(
  p_company_id uuid,
  p_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if auth.uid() is null or not public.platform_admin_has_workspace_company(p_company_id) then
    raise exception 'platform_workspace_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.currencies c where c.code = upper(btrim(p_code))) then
    raise exception 'unknown_currency_code' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.company_currencies cc
    where cc.company_id = p_company_id and cc.currency_code = upper(btrim(p_code))
  ) then
    raise exception 'base_currency_must_be_enabled' using errcode = '22023';
  end if;
  insert into public.company_settings (company_id, base_currency_code, updated_at, updated_by)
  values (p_company_id, upper(btrim(p_code)), timezone('utc', now()), auth.uid())
  on conflict (company_id) do update
    set base_currency_code = excluded.base_currency_code,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
end;
$$;

alter function public.platform_admin_set_assisted_base_currency(uuid, text) owner to postgres;
revoke all on function public.platform_admin_set_assisted_base_currency(uuid, text)
  from public, anon;
grant execute on function public.platform_admin_set_assisted_base_currency(uuid, text)
  to authenticated;

create or replace function public.get_payment_terms(p_company_id uuid)
returns table (id uuid, code text, name text, net_days integer)
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select pt.id, pt.code, pt.name, pt.net_days
  from public.payment_terms pt
  where pt.company_id = p_company_id
    and (
      public.is_member(p_company_id)
      or p_company_id = public.current_company_id()
      or public.platform_admin_has_workspace_company(p_company_id)
    )
  order by pt.net_days asc, pt.code asc;
$$;

alter function public.get_payment_terms(uuid) owner to postgres;
revoke all on function public.get_payment_terms(uuid) from public, anon;
grant execute on function public.get_payment_terms(uuid) to authenticated, service_role;

-- The generic guard remains membership/subscription based. It recognizes the
-- platform context only while the wrapper below sets a transaction-local,
-- operation-specific capability for Opening Import.
create or replace function public.stockwise_require_operator_company(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_active_company uuid := public.current_company_id();
  v_role public.member_role;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_company_id is null then
    raise exception 'company_required' using errcode = '22023';
  end if;
  if coalesce(current_setting('stockwise.assisted_setup_operation', true), '') = 'opening_stock_import'
     and public.platform_admin_has_workspace_company(p_company_id) then
    return v_user;
  end if;

  if v_active_company is null or v_active_company <> p_company_id then
    raise exception 'cross_company_access_denied' using errcode = '42501';
  end if;

  select cm.role
    into v_role
  from public.company_members cm
  where cm.company_id = p_company_id
    and cm.user_id = v_user
    and cm.status = 'active'::public.member_status
  limit 1;

  if v_role is null then
    raise exception 'cross_company_access_denied' using errcode = '42501';
  end if;
  if v_role not in (
    'OWNER'::public.member_role,
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role
  ) then
    raise exception 'operator_role_required' using errcode = '42501';
  end if;
  if not public.company_access_is_enabled(p_company_id) then
    raise exception 'company_access_disabled' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

alter function public.stockwise_require_operator_company(uuid) owner to postgres;
revoke all on function public.stockwise_require_operator_company(uuid)
  from public, anon, authenticated;

-- Reuse the existing opening-import implementation while delegating its
-- authority check to the narrow guard above. Normal direct callers still need
-- active OPERATOR+ membership and enabled access; only the governed platform
-- wrapper can supply the transaction-local opening_stock_import capability.
CREATE OR REPLACE FUNCTION public.import_opening_stock_batch(p_company_id uuid, p_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(imported_rows integer, bucket_count integer, total_qty_base numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_user uuid;
  v_invalid record;
  v_row record;
  v_updated_bucket_count integer := 0;
  v_inserted_bucket_count integer := 0;
BEGIN
  v_user := public.stockwise_require_operator_company(p_company_id);

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Add at least one opening-stock row before importing.' USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMPORARY TABLE tmp_opening_stock_rows_raw (
    row_no integer NOT NULL,
    item_id_text text,
    uom_id_text text,
    qty numeric,
    qty_base numeric,
    unit_cost numeric,
    total_value numeric,
    warehouse_to_id_text text,
    bin_to_id text,
    notes text
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_rows_raw (
    row_no,
    item_id_text,
    uom_id_text,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id_text,
    bin_to_id,
    notes
  )
  SELECT
    ordinality::integer,
    NULLIF(trim(row_data ->> 'item_id'), ''),
    NULLIF(trim(row_data ->> 'uom_id'), ''),
    COALESCE(NULLIF(trim(row_data ->> 'qty'), '')::numeric, 0),
    COALESCE(NULLIF(trim(row_data ->> 'qty_base'), '')::numeric, 0),
    greatest(COALESCE(NULLIF(trim(row_data ->> 'unit_cost'), '')::numeric, 0), 0),
    greatest(COALESCE(NULLIF(trim(row_data ->> 'total_value'), '')::numeric, 0), 0),
    NULLIF(trim(row_data ->> 'warehouse_to_id'), ''),
    NULLIF(trim(row_data ->> 'bin_to_id'), ''),
    NULLIF(trim(row_data ->> 'notes'), '')
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) WITH ORDINALITY AS rows(row_data, ordinality);

  SELECT *
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  WHERE r.item_id_text IS NULL
     OR r.uom_id_text IS NULL
     OR r.warehouse_to_id_text IS NULL
     OR r.bin_to_id IS NULL
     OR lower(coalesce(r.qty::text, '')) in ('nan', 'infinity', '-infinity')
     OR lower(coalesce(r.qty_base::text, '')) in ('nan', 'infinity', '-infinity')
     OR lower(coalesce(r.unit_cost::text, '')) in ('nan', 'infinity', '-infinity')
     OR lower(coalesce(r.total_value::text, '')) in ('nan', 'infinity', '-infinity')
     OR COALESCE(r.qty, 0) <= 0
     OR COALESCE(r.qty_base, 0) <= 0
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % is incomplete. Recheck the imported item, UOM, location, and quantity.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.item_id_text
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.items i
    ON i.id::text = r.item_id_text
   AND i.company_id = p_company_id
  WHERE i.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references an item that does not belong to this company.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.uom_id_text
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.uoms u
    ON u.id::text = r.uom_id_text
  WHERE u.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references a unit of measure that does not exist.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.warehouse_to_id_text
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.warehouses w
    ON w.id::text = r.warehouse_to_id_text
   AND w.company_id = p_company_id
  WHERE w.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references a warehouse that does not belong to this company.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.row_no, r.bin_to_id
    INTO v_invalid
  FROM tmp_opening_stock_rows_raw r
  LEFT JOIN public.bins b
    ON b.id::text = r.bin_to_id
   AND b.company_id = p_company_id
   AND b."warehouseId"::text = r.warehouse_to_id_text
  WHERE b.id IS NULL
  ORDER BY r.row_no
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Opening-stock row % references a bin that does not belong to the selected warehouse.', v_invalid.row_no
      USING ERRCODE = 'P0001';
  END IF;

  CREATE TEMPORARY TABLE tmp_opening_stock_rows (
    row_no integer NOT NULL,
    item_id uuid NOT NULL,
    uom_id text NOT NULL,
    qty numeric NOT NULL,
    qty_base numeric NOT NULL,
    unit_cost numeric NOT NULL,
    total_value numeric NOT NULL,
    warehouse_to_id uuid NOT NULL,
    bin_to_id text NOT NULL,
    notes text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_rows (
    row_no,
    item_id,
    uom_id,
    qty,
    qty_base,
    unit_cost,
    total_value,
    warehouse_to_id,
    bin_to_id,
    notes
  )
  SELECT
    r.row_no,
    r.item_id_text::uuid,
    r.uom_id_text,
    r.qty,
    r.qty_base,
    r.unit_cost,
    CASE
      WHEN r.total_value > 0 THEN r.total_value
      ELSE round(r.qty_base * r.unit_cost, 2)
    END,
    r.warehouse_to_id_text::uuid,
    r.bin_to_id,
    COALESCE(r.notes, 'Stock inicial')
  FROM tmp_opening_stock_rows_raw r;

  CREATE TEMPORARY TABLE tmp_opening_stock_baseline (
    item_id uuid NOT NULL,
    warehouse_key text NOT NULL,
    bin_key text NOT NULL,
    qty numeric NOT NULL,
    avg_cost numeric NOT NULL,
    allocated_qty numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_baseline (
    item_id,
    warehouse_key,
    bin_key,
    qty,
    avg_cost,
    allocated_qty
  )
  SELECT
    buckets.item_id,
    buckets.warehouse_to_id::text,
    buckets.bin_to_id,
    COALESCE(sl.qty, 0),
    COALESCE(sl.avg_cost, 0),
    COALESCE(sl.allocated_qty, 0)
  FROM (
    SELECT DISTINCT
      r.item_id,
      r.warehouse_to_id,
      r.bin_to_id
    FROM tmp_opening_stock_rows r
  ) buckets
  LEFT JOIN public.stock_levels sl
    ON sl.company_id = p_company_id
   AND sl.item_id = buckets.item_id
   AND sl.warehouse_id::text = buckets.warehouse_to_id::text
   AND sl.bin_id::text = buckets.bin_to_id;

  imported_rows := 0;

  FOR v_row IN
    SELECT *
    FROM tmp_opening_stock_rows
    ORDER BY row_no
  LOOP
    INSERT INTO public.stock_movements (
      company_id,
      type,
      item_id,
      uom_id,
      qty,
      qty_base,
      unit_cost,
      total_value,
      warehouse_to_id,
      bin_to_id,
      notes,
      created_by,
      ref_type,
      ref_id,
      ref_line_id
    )
    VALUES (
      p_company_id,
      'receive',
      v_row.item_id,
      v_row.uom_id,
      v_row.qty,
      v_row.qty_base,
      v_row.unit_cost,
      v_row.total_value,
      v_row.warehouse_to_id,
      v_row.bin_to_id,
      v_row.notes,
      v_user,
      'ADJUST',
      NULL,
      NULL
    );

    imported_rows := imported_rows + 1;
  END LOOP;

  CREATE TEMPORARY TABLE tmp_opening_stock_final_levels (
    item_id uuid NOT NULL,
    warehouse_to_id uuid NOT NULL,
    bin_to_id text NOT NULL,
    final_qty numeric NOT NULL,
    final_avg_cost numeric NOT NULL,
    allocated_qty numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_opening_stock_final_levels (
    item_id,
    warehouse_to_id,
    bin_to_id,
    final_qty,
    final_avg_cost,
    allocated_qty
  )
  SELECT
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    round(COALESCE(b.qty, 0) + sum(r.qty_base), 6),
    CASE
      WHEN COALESCE(b.qty, 0) + sum(r.qty_base) > 0 THEN
        round(
          ((COALESCE(b.qty, 0) * COALESCE(b.avg_cost, 0)) + sum(r.total_value))
          / (COALESCE(b.qty, 0) + sum(r.qty_base)),
          6
        )
      ELSE 0
    END,
    COALESCE(b.allocated_qty, 0)
  FROM tmp_opening_stock_rows r
  LEFT JOIN tmp_opening_stock_baseline b
    ON b.item_id = r.item_id
   AND b.warehouse_key = r.warehouse_to_id::text
   AND b.bin_key = r.bin_to_id
  GROUP BY
    r.item_id,
    r.warehouse_to_id,
    r.bin_to_id,
    b.qty,
    b.avg_cost,
    b.allocated_qty;

  UPDATE public.stock_levels sl
     SET qty = f.final_qty,
         avg_cost = f.final_avg_cost,
         allocated_qty = f.allocated_qty,
         updated_at = now()
  FROM tmp_opening_stock_final_levels f
  WHERE sl.company_id = p_company_id
    AND sl.item_id = f.item_id
    AND sl.warehouse_id::text = f.warehouse_to_id::text
    AND sl.bin_id::text = f.bin_to_id;

  GET DIAGNOSTICS v_updated_bucket_count = ROW_COUNT;

  INSERT INTO public.stock_levels (
    company_id,
    item_id,
    warehouse_id,
    bin_id,
    qty,
    avg_cost,
    allocated_qty
  )
  SELECT
    p_company_id,
    f.item_id,
    f.warehouse_to_id,
    f.bin_to_id,
    f.final_qty,
    f.final_avg_cost,
    f.allocated_qty
  FROM tmp_opening_stock_final_levels f
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.stock_levels sl
    WHERE sl.company_id = p_company_id
      AND sl.item_id = f.item_id
      AND sl.warehouse_id::text = f.warehouse_to_id::text
      AND sl.bin_id::text = f.bin_to_id
  );

  GET DIAGNOSTICS v_inserted_bucket_count = ROW_COUNT;
  bucket_count := v_updated_bucket_count + v_inserted_bucket_count;

  SELECT round(COALESCE(sum(r.qty_base), 0), 6)
    INTO total_qty_base
  FROM tmp_opening_stock_rows r;

  RETURN NEXT;
END;
$function$;

alter function public.import_opening_stock_batch(uuid, jsonb) owner to postgres;

create or replace function public.platform_admin_post_opening_stock_import(
  p_company_id uuid,
  p_rows jsonb,
  p_request_key text
)
returns table (
  imported_rows integer,
  bucket_count integer,
  total_qty_base numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.platform_admin_has_workspace_company(p_company_id) then
    raise exception 'platform_workspace_required' using errcode = '42501';
  end if;
  perform set_config('stockwise.assisted_setup_operation', 'opening_stock_import', true);
  return query
  select *
  from public.post_opening_stock_import(p_company_id, p_rows, p_request_key);
end;
$$;

alter function public.platform_admin_post_opening_stock_import(uuid, jsonb, text) owner to postgres;
revoke all on function public.platform_admin_post_opening_stock_import(uuid, jsonb, text)
  from public, anon;
grant execute on function public.platform_admin_post_opening_stock_import(uuid, jsonb, text)
  to authenticated;

-- Only the explicit trial RPC may establish the first and only assisted trial
-- window. Paid activation and later suspension remain under existing controls.
create or replace function public.tg_guard_assisted_company_trial()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_assisted boolean;
  v_authorized boolean := coalesce(
    current_setting('stockwise.assisted_trial_start', true),
    ''
  ) = 'on';
begin
  select exists (
    select 1
    from public.assisted_company_provisioning acp
    where acp.company_id = new.company_id
  ) into v_assisted;

  if not v_assisted then
    return new;
  end if;

  if old.trial_started_at is null and new.trial_started_at is not null and not v_authorized then
    raise exception 'assisted_trial_requires_explicit_start' using errcode = '42501';
  end if;

  if old.trial_started_at is not null then
    if new.subscription_status = 'trial'::public.subscription_status
       and (
         old.subscription_status <> 'trial'::public.subscription_status
         or new.trial_started_at is distinct from old.trial_started_at
         or new.trial_expires_at is distinct from old.trial_expires_at
       ) then
      raise exception 'assisted_trial_cannot_be_restarted' using errcode = '22023';
    end if;

    -- Preserve the original trial evidence when normal paid/suspended/disabled
    -- transitions clear those columns as part of their generic update shape.
    new.trial_started_at := old.trial_started_at;
    new.trial_expires_at := old.trial_expires_at;
  end if;

  return new;
end;
$$;

alter function public.tg_guard_assisted_company_trial() owner to postgres;

drop trigger if exists bu_guard_assisted_company_trial
  on public.company_subscription_state;
create trigger bu_guard_assisted_company_trial
before update on public.company_subscription_state
for each row execute function public.tg_guard_assisted_company_trial();

create or replace function public.platform_admin_provision_customer_company(
  p_name text,
  p_intended_owner_email text default null,
  p_company_email text default null,
  p_phone text default null,
  p_preferred_lang text default 'pt',
  p_country_code text default 'MZ',
  p_request_key text default null
)
returns table (
  company_id uuid,
  company_name text,
  owner_state text,
  subscription_status public.subscription_status,
  trial_started_at timestamptz,
  provisioned_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_owner_email text := lower(nullif(btrim(coalesce(p_intended_owner_email, '')), ''));
  v_company_email text := lower(nullif(btrim(coalesce(p_company_email, '')), ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_lang text := lower(nullif(btrim(coalesce(p_preferred_lang, '')), ''));
  v_country text := upper(nullif(btrim(coalesce(p_country_code, '')), ''));
  v_key text := nullif(btrim(coalesce(p_request_key, '')), '');
  v_hash text;
  v_existing record;
  v_company_id uuid;
  v_provisioned_at timestamptz := timezone('utc', now());
  v_rate_allowed boolean;
  v_rate_retry integer;
begin
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'company_name_required' using errcode = '22023';
  end if;
  if v_key is null then
    raise exception 'request_key_required' using errcode = '22023';
  end if;
  if v_lang not in ('en', 'pt') then
    raise exception 'invalid_preferred_language' using errcode = '22023';
  end if;
  if v_country is null or char_length(v_country) <> 2 then
    raise exception 'invalid_country_code' using errcode = '22023';
  end if;
  if v_owner_email is not null and v_owner_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'invalid_owner_email' using errcode = '22023';
  end if;
  if v_owner_email is not null
     and public.stockwise_email_is_active_platform_admin(v_owner_email) then
    raise exception 'assisted_invitee_must_not_be_platform_admin' using errcode = '42501';
  end if;
  if v_company_email is not null and v_company_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'invalid_company_email' using errcode = '22023';
  end if;

  select allowed, retry_after_seconds
    into v_rate_allowed, v_rate_retry
  from public.consume_security_rate_limit(
    'platform_admin_provision_customer_company',
    v_actor::text,
    3600,
    20
  );
  if not coalesce(v_rate_allowed, false) then
    raise exception 'platform_admin_provision_rate_limited_retry_after_%s', coalesce(v_rate_retry, 3600)
      using errcode = 'P0001';
  end if;

  v_hash := md5(jsonb_build_object(
    'name', v_name,
    'intended_owner_email', v_owner_email,
    'company_email', v_company_email,
    'phone', v_phone,
    'preferred_lang', v_lang,
    'country_code', v_country
  )::text);

  select acp.company_id, acp.request_payload_hash, acp.provisioned_at
    into v_existing
  from public.assisted_company_provisioning acp
  where acp.provisioned_by = v_actor
    and acp.request_key = v_key;

  if found then
    if v_existing.request_payload_hash <> v_hash then
      raise exception 'idempotency_key_payload_mismatch' using errcode = '22023';
    end if;
    return query
    select c.id,
           c.name,
           case
             when c.owner_user_id is not null then 'active'
             when exists (
               select 1 from public.company_invites i
               where i.company_id = c.id
                 and i.role = 'OWNER'::public.member_role
                 and lower(i.email::text) = acp.intended_owner_email
                 and i.accepted_at is null
                 and i.expires_at > timezone('utc', now())
             ) then 'pending'
             else 'unassigned'
           end,
           css.subscription_status,
           css.trial_started_at,
           acp.provisioned_at
    from public.companies c
    join public.assisted_company_provisioning acp on acp.company_id = c.id
    join public.company_subscription_state css on css.company_id = c.id
    where c.id = v_existing.company_id;
    return;
  end if;

  insert into public.companies (
    name,
    trade_name,
    owner_user_id,
    email,
    phone,
    preferred_lang,
    country_code
  ) values (
    v_name,
    v_name,
    null,
    v_company_email,
    v_phone,
    v_lang,
    v_country
  ) returning id into v_company_id;

  insert into public.company_settings (company_id, data, updated_by)
  values (v_company_id, '{}'::jsonb, v_actor)
  on conflict on constraint company_settings_pkey do nothing;

  perform public.seed_default_payment_terms(v_company_id);

  insert into public.company_subscription_state (
    company_id,
    plan_code,
    subscription_status,
    grant_reason,
    updated_by
  ) values (
    v_company_id,
    'trial_7d',
    'disabled'::public.subscription_status,
    'Assisted customer company provisioned; trial not started',
    v_actor
  );

  insert into public.assisted_company_provisioning (
    company_id,
    provisioned_by,
    provisioned_at,
    request_key,
    request_payload_hash,
    intended_owner_email
  ) values (
    v_company_id,
    v_actor,
    v_provisioned_at,
    v_key,
    v_hash,
    v_owner_email
  );

  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  ) values (
    v_company_id,
    'assisted_company_provisioned',
    v_actor,
    lower(coalesce((auth.jwt() ->> 'email')::text, '')),
    'Platform administrator provisioned a customer company shell',
    jsonb_build_object(
      'intended_owner_email', v_owner_email,
      'trial_started', false,
      'owner_assigned', false,
      'request_key', v_key
    )
  );

  return query
  select c.id,
         c.name,
         'unassigned'::text,
         css.subscription_status,
         css.trial_started_at,
         v_provisioned_at
  from public.companies c
  join public.company_subscription_state css on css.company_id = c.id
  where c.id = v_company_id;
end;
$$;

alter function public.platform_admin_provision_customer_company(text, text, text, text, text, text, text)
  owner to postgres;
revoke all on function public.platform_admin_provision_customer_company(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.platform_admin_provision_customer_company(text, text, text, text, text, text, text)
  to authenticated;

create or replace function public.platform_admin_open_customer_workspace(p_company_id uuid)
returns table (
  company_id uuid,
  company_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_expires timestamptz := v_now + interval '2 hours';
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.assisted_company_provisioning acp
    join public.companies c on c.id = acp.company_id
    where acp.company_id = p_company_id
      and acp.owner_activated_at is null
      and c.owner_user_id is null
  ) then
    raise exception 'assisted_company_handed_over_or_not_found' using errcode = '22023';
  end if;

  insert into public.platform_admin_workspace_contexts (
    user_id,
    company_id,
    opened_at,
    expires_at,
    updated_at
  ) values (
    v_actor,
    p_company_id,
    v_now,
    v_expires,
    v_now
  )
  on conflict (user_id) do update
    set company_id = excluded.company_id,
        opened_at = excluded.opened_at,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at;

  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  ) values (
    p_company_id,
    'assisted_workspace_opened',
    v_actor,
    lower(coalesce((auth.jwt() ->> 'email')::text, '')),
    'Platform administrator opened assisted customer workspace',
    jsonb_build_object('expires_at', v_expires)
  );

  return query
  select c.id, c.name, v_expires
  from public.companies c
  where c.id = p_company_id;
end;
$$;

alter function public.platform_admin_open_customer_workspace(uuid) owner to postgres;
revoke all on function public.platform_admin_open_customer_workspace(uuid)
  from public, anon;
grant execute on function public.platform_admin_open_customer_workspace(uuid)
  to authenticated;

create or replace function public.platform_admin_close_customer_workspace()
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  delete from public.platform_admin_workspace_contexts
  where user_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

alter function public.platform_admin_close_customer_workspace() owner to postgres;
revoke all on function public.platform_admin_close_customer_workspace()
  from public, anon;
grant execute on function public.platform_admin_close_customer_workspace()
  to authenticated;

create or replace function public.platform_admin_get_assisted_company_state(p_company_id uuid)
returns table (
  company_id uuid,
  company_name text,
  provisioned_by uuid,
  provisioned_at timestamptz,
  intended_owner_email text,
  owner_state text,
  owner_user_id uuid,
  owner_invited_at timestamptz,
  owner_activated_at timestamptz,
  subscription_status public.subscription_status,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  workspace_open boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  return query
  select c.id,
         c.name,
         acp.provisioned_by,
         acp.provisioned_at,
         acp.intended_owner_email,
         case
           when c.owner_user_id is not null then 'active'
           when exists (
             select 1 from public.company_invites i
             where i.company_id = c.id
               and i.role = 'OWNER'::public.member_role
               and lower(i.email::text) = acp.intended_owner_email
               and i.accepted_at is null
               and i.expires_at > timezone('utc', now())
           ) then 'pending'
           else 'unassigned'
         end,
         c.owner_user_id,
         acp.owner_invited_at,
         acp.owner_activated_at,
         css.subscription_status,
         acp.trial_started_at,
         acp.trial_expires_at,
         public.platform_admin_has_workspace_company(c.id)
  from public.assisted_company_provisioning acp
  join public.companies c on c.id = acp.company_id
  join public.company_subscription_state css on css.company_id = acp.company_id
  where acp.company_id = p_company_id;
end;
$$;

alter function public.platform_admin_get_assisted_company_state(uuid) owner to postgres;
revoke all on function public.platform_admin_get_assisted_company_state(uuid)
  from public, anon;
grant execute on function public.platform_admin_get_assisted_company_state(uuid)
  to authenticated;

create or replace function public.platform_admin_start_assisted_trial(p_company_id uuid)
returns table (
  company_id uuid,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  purge_scheduled_at timestamptz,
  started_now boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_expires timestamptz;
  v_purge timestamptz;
  v_assisted public.assisted_company_provisioning%rowtype;
  v_state public.company_subscription_state%rowtype;
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;

  select * into v_assisted
  from public.assisted_company_provisioning acp
  where acp.company_id = p_company_id
  for update;
  if not found then
    raise exception 'assisted_company_not_found' using errcode = '22023';
  end if;

  select * into v_state
  from public.company_subscription_state css
  where css.company_id = p_company_id
  for update;
  if not found then
    raise exception 'company_subscription_state_missing' using errcode = 'P0001';
  end if;

  if v_assisted.owner_activated_at is null
     or v_assisted.owner_activated_user_id is null
     or not exists (
       select 1
       from public.companies c
       join public.company_members cm
         on cm.company_id = c.id
        and cm.user_id = c.owner_user_id
        and cm.role = 'OWNER'::public.member_role
        and cm.status = 'active'::public.member_status
       where c.id = p_company_id
         and c.owner_user_id = v_assisted.owner_activated_user_id
     ) then
    raise exception 'assisted_owner_activation_required_before_trial' using errcode = '22023';
  end if;

  if v_assisted.trial_started_at is not null or v_state.trial_started_at is not null then
    return query
    select p_company_id,
           coalesce(v_assisted.trial_started_at, v_state.trial_started_at),
           coalesce(v_assisted.trial_expires_at, v_state.trial_expires_at),
           v_state.purge_scheduled_at,
           false;
    return;
  end if;

  if v_state.subscription_status <> 'disabled'::public.subscription_status then
    raise exception 'assisted_trial_requires_disabled_access_state' using errcode = '22023';
  end if;

  v_expires := v_now + interval '7 days';
  v_purge := v_expires + interval '14 days';
  perform set_config('stockwise.assisted_trial_start', 'on', true);

  update public.company_subscription_state css
     set plan_code = 'trial_7d',
         subscription_status = 'trial'::public.subscription_status,
         trial_started_at = v_now,
         trial_expires_at = v_expires,
         paid_until = null,
         access_granted_by = v_actor,
         access_granted_at = v_now,
         grant_reason = 'Explicit assisted customer 7-day trial start',
         access_revoked_by = null,
         access_revoked_at = null,
         revoke_reason = null,
         purge_scheduled_at = v_purge,
         updated_by = v_actor
   where css.company_id = p_company_id;

  update public.assisted_company_provisioning acp
     set trial_started_at = v_now,
         trial_expires_at = v_expires,
         updated_at = v_now
   where acp.company_id = p_company_id;

  perform public.sync_company_purge_queue(
    p_company_id,
    v_purge,
    'Scheduled operational-data purge after assisted 7-day trial expiry',
    v_actor
  );

  perform public.record_company_access_audit(
    p_company_id,
    v_state.plan_code,
    'trial_7d',
    v_state.subscription_status,
    'trial'::public.subscription_status,
    'Explicit assisted customer 7-day trial start',
    jsonb_build_object(
      'trial_started_at', v_now,
      'trial_expires_at', v_expires,
      'purge_scheduled_at', v_purge,
      'assisted_provisioning', true
    )
  );

  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  ) values (
    p_company_id,
    'assisted_trial_started',
    v_actor,
    lower(coalesce((auth.jwt() ->> 'email')::text, '')),
    'Platform administrator explicitly started the assisted customer trial',
    jsonb_build_object(
      'trial_started_at', v_now,
      'trial_expires_at', v_expires,
      'purge_scheduled_at', v_purge
    )
  );

  return query select p_company_id, v_now, v_expires, v_purge, true;
end;
$$;

alter function public.platform_admin_start_assisted_trial(uuid) owner to postgres;
revoke all on function public.platform_admin_start_assisted_trial(uuid)
  from public, anon;
grant execute on function public.platform_admin_start_assisted_trial(uuid)
  to authenticated;

-- OWNER invitations for assisted companies are governed separately so direct
-- table writes cannot bypass intended-email or audit requirements.
create or replace function public.tg_guard_assisted_owner_invite()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.role = 'OWNER'::public.member_role
     and exists (
       select 1
       from public.assisted_company_provisioning acp
       where acp.company_id = new.company_id
     )
     and coalesce(current_setting('stockwise.assisted_owner_invite', true), '') <> 'on' then
    raise exception 'assisted_owner_invite_requires_platform_control' using errcode = '42501';
  end if;
  return new;
end;
$$;

alter function public.tg_guard_assisted_owner_invite() owner to postgres;

drop trigger if exists biu_guard_assisted_owner_invite on public.company_invites;
create trigger biu_guard_assisted_owner_invite
before insert or update of role, email on public.company_invites
for each row execute function public.tg_guard_assisted_owner_invite();

create or replace function public.platform_admin_invite_assisted_owner(
  p_company_id uuid,
  p_email text,
  p_expires_at timestamptz default null
)
returns table (
  invite_id uuid,
  invite_token uuid,
  company_id uuid,
  owner_email text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_now timestamptz := timezone('utc', now());
  v_expires timestamptz := coalesce(p_expires_at, timezone('utc', now()) + interval '14 days');
  v_invite_id uuid;
  v_token uuid;
  v_company public.companies%rowtype;
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'invalid_owner_email' using errcode = '22023';
  end if;
  if public.stockwise_email_is_active_platform_admin(v_email) then
    raise exception 'assisted_invitee_must_not_be_platform_admin' using errcode = '42501';
  end if;
  if v_expires <= v_now then
    raise exception 'invite_expiry_must_be_future' using errcode = '22023';
  end if;

  select * into v_company
  from public.companies c
  where c.id = p_company_id
  for update;
  if not found then
    raise exception 'company_not_found' using errcode = '22023';
  end if;

  perform 1
  from public.assisted_company_provisioning acp
  where acp.company_id = p_company_id
  for update;
  if not found then
    raise exception 'assisted_company_not_found' using errcode = '22023';
  end if;
  if v_company.owner_user_id is not null then
    raise exception 'assisted_company_owner_already_active' using errcode = '22023';
  end if;

  update public.company_invites i
     set expires_at = v_now
   where i.company_id = p_company_id
     and i.role = 'OWNER'::public.member_role
     and i.accepted_at is null;

  update public.company_members cm
     set status = 'disabled'::public.member_status
   where cm.company_id = p_company_id
     and cm.role = 'OWNER'::public.member_role
     and cm.status = 'invited'::public.member_status
     and lower(cm.email) <> v_email;

  perform set_config('stockwise.assisted_owner_invite', 'on', true);

  insert into public.company_invites (
    company_id,
    email,
    role,
    created_by,
    expires_at
  ) values (
    p_company_id,
    v_email,
    'OWNER'::public.member_role,
    v_actor,
    v_expires
  ) returning id, token into v_invite_id, v_token;

  insert into public.company_members (
    company_id,
    user_id,
    email,
    role,
    status,
    invited_by
  ) values (
    p_company_id,
    null,
    v_email,
    'OWNER'::public.member_role,
    'invited'::public.member_status,
    v_actor
  )
  on conflict on constraint company_members_pkey do update
    set user_id = null,
        role = 'OWNER'::public.member_role,
        status = 'invited'::public.member_status,
        invited_by = v_actor;

  update public.assisted_company_provisioning acp
     set intended_owner_email = v_email,
         owner_invited_at = v_now,
         updated_at = v_now
   where acp.company_id = p_company_id;

  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  ) values (
    p_company_id,
    'assisted_owner_invited',
    v_actor,
    lower(coalesce((auth.jwt() ->> 'email')::text, '')),
    'Platform administrator created the intended customer OWNER invitation',
    jsonb_build_object(
      'owner_email', v_email,
      'invite_id', v_invite_id,
      'expires_at', v_expires
    )
  );

  return query select v_invite_id, v_token, p_company_id, v_email, v_expires;
end;
$$;

alter function public.platform_admin_invite_assisted_owner(uuid, text, timestamptz)
  owner to postgres;
revoke all on function public.platform_admin_invite_assisted_owner(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.platform_admin_invite_assisted_owner(uuid, text, timestamptz)
  to authenticated;

-- Non-OWNER setup invitations reuse the ordinary pending-member model but
-- never manufacture membership for the platform administrator. OWNER is
-- intentionally excluded and remains governed by the handover RPC above.
create or replace function public.platform_admin_invite_assisted_member(
  p_company_id uuid,
  p_email text,
  p_role public.member_role
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_token uuid;
  v_status public.member_status;
  v_limit record;
begin
  if v_actor is null or not public.platform_admin_has_workspace_company(p_company_id) then
    raise exception 'platform_workspace_required' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if public.stockwise_email_is_active_platform_admin(v_email) then
    raise exception 'assisted_invitee_must_not_be_platform_admin' using errcode = '42501';
  end if;
  if p_role is null or p_role not in (
    'ADMIN'::public.member_role,
    'MANAGER'::public.member_role,
    'OPERATOR'::public.member_role,
    'VIEWER'::public.member_role
  ) then
    raise exception 'role_not_allowed' using errcode = '42501';
  end if;

  select * into v_limit
  from public.consume_security_rate_limit(
    'platform_admin_invite_assisted_member_actor',
    v_actor::text || ':' || p_company_id::text,
    900,
    20
  );
  if not coalesce(v_limit.allowed, false) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  select cm.status into v_status
  from public.company_members cm
  where cm.company_id = p_company_id
    and lower(cm.email) = v_email
  for update;
  if v_status = 'active'::public.member_status then
    raise exception 'already_active' using errcode = '23505';
  end if;

  update public.company_invites i
     set expires_at = timezone('utc', now())
   where i.company_id = p_company_id
     and lower(i.email::text) = v_email
     and i.accepted_at is null;

  insert into public.company_members (
    company_id,
    email,
    user_id,
    role,
    status,
    invited_by
  ) values (
    p_company_id,
    v_email,
    null,
    p_role,
    'invited'::public.member_status,
    v_actor
  )
  on conflict (company_id, email) do update
    set user_id = null,
        role = excluded.role,
        status = 'invited'::public.member_status,
        invited_by = excluded.invited_by;

  insert into public.company_invites (
    company_id,
    email,
    role,
    created_by
  ) values (
    p_company_id,
    v_email,
    p_role,
    v_actor
  ) returning token into v_token;

  insert into public.company_control_action_log (
    company_id,
    action_type,
    actor_user_id,
    actor_email,
    reason,
    context
  ) values (
    p_company_id,
    'assisted_member_invited',
    v_actor,
    lower(coalesce((auth.jwt() ->> 'email')::text, '')),
    'Platform administrator created a setup-workspace member invitation',
    jsonb_build_object('member_email', v_email, 'role', p_role, 'token_created', true)
  );

  return v_token;
end;
$$;

alter function public.platform_admin_invite_assisted_member(uuid, text, public.member_role) owner to postgres;
revoke all on function public.platform_admin_invite_assisted_member(uuid, text, public.member_role)
  from public, anon;
grant execute on function public.platform_admin_invite_assisted_member(uuid, text, public.member_role)
  to authenticated;

create or replace function public.stockwise_accept_company_invitation(
  p_company_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.member_role,
  p_invited_by uuid,
  p_invite_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_now timestamptz := timezone('utc', now());
  v_company_owner uuid;
  v_assisted public.assisted_company_provisioning%rowtype;
begin
  if p_user_id is null or p_user_id <> auth.uid() then
    raise exception 'invite_user_mismatch' using errcode = '42501';
  end if;
  if v_email is null or v_email <> lower(coalesce((select u.email from auth.users u where u.id = p_user_id), '')) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  -- Re-check principal separation at acceptance time. An active platform
  -- administrator must not obtain persistent tenant authority by changing the
  -- Auth email after an otherwise valid assisted-company invite was created.
  if exists (
    select 1
    from public.assisted_company_provisioning acp
    where acp.company_id = p_company_id
  ) and public.stockwise_email_is_active_platform_admin(v_email) then
    raise exception 'assisted_invitee_must_not_be_platform_admin' using errcode = '42501';
  end if;

  if p_role = 'OWNER'::public.member_role then
    select * into v_assisted
    from public.assisted_company_provisioning acp
    where acp.company_id = p_company_id
    for update;

    if found then
      if v_assisted.intended_owner_email is null
         or lower(v_assisted.intended_owner_email) <> v_email then
        raise exception 'invite_email_mismatch' using errcode = '42501';
      end if;

      select c.owner_user_id into v_company_owner
      from public.companies c
      where c.id = p_company_id
      for update;
      if v_company_owner is not null and v_company_owner <> p_user_id then
        raise exception 'assisted_company_owner_already_active' using errcode = '22023';
      end if;
    end if;
  end if;

  insert into public.company_members (
    company_id,
    email,
    user_id,
    role,
    status,
    invited_by,
    created_at
  ) values (
    p_company_id,
    v_email,
    p_user_id,
    p_role,
    'active'::public.member_status,
    p_invited_by,
    v_now
  )
  on conflict (company_id, email) do update
    set user_id = excluded.user_id,
        role = excluded.role,
        status = 'active'::public.member_status,
        invited_by = coalesce(excluded.invited_by, public.company_members.invited_by);

  update public.company_invites i
     set accepted_at = coalesce(i.accepted_at, v_now)
   where i.company_id = p_company_id
     and lower(i.email::text) = v_email
     and i.accepted_at is null
     and (p_invite_id is null or i.id = p_invite_id)
     and (i.expires_at is null or i.expires_at > v_now);

  if p_role = 'OWNER'::public.member_role and v_assisted.company_id is not null then
    perform set_config('stockwise.assisted_owner_handover', 'on', true);
    update public.companies c
       set owner_user_id = p_user_id
     where c.id = p_company_id;

    update public.assisted_company_provisioning acp
       set owner_activated_at = v_now,
           owner_activated_user_id = p_user_id,
           updated_at = v_now
     where acp.company_id = p_company_id;

    delete from public.platform_admin_workspace_contexts pawc
    where pawc.company_id = p_company_id;

    insert into public.company_control_action_log (
      company_id,
      action_type,
      actor_user_id,
      actor_email,
      reason,
      context
    ) values (
      p_company_id,
      'assisted_owner_activated',
      p_user_id,
      v_email,
      'Intended customer OWNER explicitly accepted the invitation',
      jsonb_build_object('invite_id', p_invite_id, 'owner_email', v_email)
    );
  end if;
end;
$$;

alter function public.stockwise_accept_company_invitation(uuid, uuid, text, public.member_role, uuid, uuid)
  owner to postgres;
revoke all on function public.stockwise_accept_company_invitation(uuid, uuid, text, public.member_role, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.accept_my_invite(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_role public.member_role;
  v_invited_by uuid;
  v_invite_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_has_any_invites boolean := false;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user_id;
  if v_user_id is null or v_email is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select i.id, i.role, i.created_by
    into v_invite_id, v_role, v_invited_by
  from public.company_invites i
  where i.company_id = p_company_id
    and lower(i.email::text) = v_email
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > v_now)
  order by i.created_at desc, i.id desc
  limit 1;

  if v_role is null then
    select exists (
      select 1
      from public.company_invites i
      where i.company_id = p_company_id
        and lower(i.email::text) = v_email
    ) into v_has_any_invites;
    if v_has_any_invites then
      raise exception 'invite_invalid_or_expired' using errcode = '22023';
    end if;

    select cm.role, cm.invited_by
      into v_role, v_invited_by
    from public.company_members cm
    where cm.company_id = p_company_id
      and cm.status = 'invited'::public.member_status
      and lower(cm.email) = v_email
      and (cm.user_id is null or cm.user_id = v_user_id)
    order by cm.created_at desc
    limit 1;
    if v_role is null then
      raise exception 'invite_not_found' using errcode = '22023';
    end if;
  end if;

  perform public.stockwise_accept_company_invitation(
    p_company_id,
    v_user_id,
    v_email,
    v_role,
    v_invited_by,
    v_invite_id
  );
  return true;
end;
$$;

alter function public.accept_my_invite(uuid) owner to postgres;
revoke all on function public.accept_my_invite(uuid) from public, anon;
grant execute on function public.accept_my_invite(uuid) to authenticated;

create or replace function public.accept_invite_with_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_company uuid;
  v_role public.member_role;
  v_inv_id uuid;
  v_invited_by uuid;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user_id;
  if v_user_id is null or v_email is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select i.id, i.company_id, i.role, i.created_by
    into v_inv_id, v_company, v_role, v_invited_by
  from public.company_invites i
  where i.token = p_token
    and lower(i.email::text) = v_email
    and (i.expires_at is null or i.expires_at > timezone('utc', now()))
    and i.accepted_at is null
  limit 1;

  if v_inv_id is null then
    if exists (
      select 1
      from public.company_invites i
      where i.token = p_token
        and lower(i.email::text) <> v_email
    ) then
      raise exception 'invite_email_mismatch' using errcode = '42501';
    end if;
    raise exception 'invalid_or_expired_token' using errcode = '22023';
  end if;

  perform public.stockwise_accept_company_invitation(
    v_company,
    v_user_id,
    v_email,
    v_role,
    v_invited_by,
    v_inv_id
  );
  return jsonb_build_object('ok', true, 'company_id', v_company, 'role', v_role);
end;
$$;

alter function public.accept_invite_with_token(uuid) owner to postgres;
revoke all on function public.accept_invite_with_token(uuid) from public, anon;
grant execute on function public.accept_invite_with_token(uuid) to authenticated;

-- Linking discovers pending invitations for the authenticated identity only.
-- It never activates membership or marks an invitation accepted.
create or replace function public.link_invites_to_user(p_user_id uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_actual_email text;
  v_count integer := 0;
begin
  select lower(u.email) into v_actual_email
  from auth.users u
  where u.id = p_user_id;

  if v_actual_email is null or v_actual_email <> lower(btrim(coalesce(p_email, ''))) then
    raise exception 'invite_identity_mismatch' using errcode = '42501';
  end if;
  if coalesce((auth.jwt() ->> 'role')::text, '') <> 'service_role'
     and p_user_id is distinct from auth.uid() then
    raise exception 'invite_identity_mismatch' using errcode = '42501';
  end if;

  update public.company_members cm
     set user_id = p_user_id
   where cm.user_id is null
     and cm.status = 'invited'::public.member_status
     and lower(cm.email) = v_actual_email;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.link_invites_to_user(uuid, text) owner to postgres;
revoke all on function public.link_invites_to_user(uuid, text) from public, anon;
grant execute on function public.link_invites_to_user(uuid, text)
  to authenticated, service_role;

create or replace function public.sync_invites_for_me()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_count integer := 0;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid;
  if v_uid is null or v_email is null then
    return 0;
  end if;

  update public.company_members cm
     set user_id = v_uid
   where cm.user_id is null
     and cm.status = 'invited'::public.member_status
     and lower(cm.email) = v_email;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter function public.sync_invites_for_me() owner to postgres;
revoke all on function public.sync_invites_for_me() from public, anon;
grant execute on function public.sync_invites_for_me() to authenticated;

create or replace function public.link_membership_for_me(p_company uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid;
  if v_uid is null or v_email is null then
    return false;
  end if;

  update public.company_members cm
     set user_id = v_uid
   where cm.company_id = p_company
     and cm.status = 'invited'::public.member_status
     and cm.user_id is null
     and lower(cm.email) = v_email;
  return found;
end;
$$;

alter function public.link_membership_for_me(uuid) owner to postgres;
revoke all on function public.link_membership_for_me(uuid) from public, anon;
grant execute on function public.link_membership_for_me(uuid) to authenticated, service_role;

comment on table public.assisted_company_provisioning is
  'Platform-admin provisioned customer shells. This table records provisioning, intended OWNER handover, and the one-time assisted trial window without granting the platform administrator membership.';

comment on table public.platform_admin_workspace_contexts is
  'Short-lived, one-company-at-a-time platform administration context. It is not company membership and expires automatically.';
