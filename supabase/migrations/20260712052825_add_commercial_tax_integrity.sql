-- Commercial Tax Integrity
-- New sales and purchase orders use canonical line-level tax. Existing rows remain
-- explicitly tagged as legacy header-tax documents and are never recalculated here.

create table public.company_tax_options (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  display_name text not null,
  treatment_type text not null,
  rate numeric(9,4) not null,
  requires_exemption_reason boolean not null default false,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_until date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint company_tax_options_company_id_id_key unique (company_id, id),
  constraint company_tax_options_code_nonblank check (btrim(code) <> ''),
  constraint company_tax_options_name_nonblank check (btrim(display_name) <> ''),
  constraint company_tax_options_treatment_check check (treatment_type in ('standard', 'zero', 'exempt')),
  constraint company_tax_options_rate_finite check (lower(rate::text) not in ('nan', 'infinity', '-infinity')),
  constraint company_tax_options_rate_check check (
    (treatment_type = 'standard' and rate > 0)
    or (treatment_type in ('zero', 'exempt') and rate = 0)
  ),
  constraint company_tax_options_standard_reason_check check (treatment_type <> 'standard' or not requires_exemption_reason),
  constraint company_tax_options_dates_check check (effective_until is null or effective_until >= effective_from)
);

create unique index company_tax_options_company_code_uidx
  on public.company_tax_options (company_id, lower(code));
create index company_tax_options_company_active_idx
  on public.company_tax_options (company_id, is_active, effective_from, effective_until, display_name);

create table public.company_tax_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  default_sales_tax_option_id uuid,
  default_purchase_tax_option_id uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint company_tax_settings_sales_option_fk
    foreign key (company_id, default_sales_tax_option_id)
    references public.company_tax_options(company_id, id),
  constraint company_tax_settings_purchase_option_fk
    foreign key (company_id, default_purchase_tax_option_id)
    references public.company_tax_options(company_id, id)
);

create table public.company_tax_configuration_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  tax_option_id uuid,
  before_state jsonb,
  after_state jsonb,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint company_tax_configuration_events_type_nonblank check (btrim(event_type) <> ''),
  constraint company_tax_configuration_events_option_fk
    foreign key (company_id, tax_option_id)
    references public.company_tax_options(company_id, id)
);

create index company_tax_configuration_events_company_created_idx
  on public.company_tax_configuration_events (company_id, created_at desc, id desc);
create index company_tax_configuration_events_option_idx
  on public.company_tax_configuration_events (company_id, tax_option_id, created_at desc)
  where tax_option_id is not null;

alter table public.company_tax_options enable row level security;
alter table public.company_tax_options force row level security;
alter table public.company_tax_settings enable row level security;
alter table public.company_tax_settings force row level security;
alter table public.company_tax_configuration_events enable row level security;
alter table public.company_tax_configuration_events force row level security;

create policy company_tax_options_select_members
  on public.company_tax_options for select to authenticated
  using (public.finance_documents_can_read(company_id));
create policy company_tax_settings_select_members
  on public.company_tax_settings for select to authenticated
  using (public.finance_documents_can_read(company_id));
create policy company_tax_configuration_events_select_members
  on public.company_tax_configuration_events for select to authenticated
  using (public.finance_documents_can_read(company_id));

revoke all on table public.company_tax_options from public, anon;
revoke all on table public.company_tax_settings from public, anon;
revoke all on table public.company_tax_configuration_events from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.company_tax_options from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.company_tax_settings from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.company_tax_configuration_events from authenticated;
grant select on table public.company_tax_options to authenticated;
grant select on table public.company_tax_settings to authenticated;
grant select on table public.company_tax_configuration_events to authenticated;

create or replace function public.commercial_tax_configuration_event_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'commercial_tax_configuration_events_immutable';
end;
$$;

create trigger bu_10_company_tax_configuration_events_immutable
before update or delete on public.company_tax_configuration_events
for each row execute function public.commercial_tax_configuration_event_immutable();

create or replace function public.commercial_tax_require_admin(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'commercial_tax_authentication_required' using errcode = '42501';
  end if;

  if p_company_id is null
     or not public.has_company_role(
       p_company_id,
       array['OWNER','ADMIN']::public.member_role[]
     ) then
    raise exception 'commercial_tax_admin_required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.commercial_tax_option_is_effective(
  p_company_id uuid,
  p_option_id uuid,
  p_effective_date date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.company_tax_options option_row
    where option_row.company_id = p_company_id
      and option_row.id = p_option_id
      and option_row.is_active
      and option_row.effective_from <= coalesce(p_effective_date, current_date)
      and (option_row.effective_until is null or option_row.effective_until >= coalesce(p_effective_date, current_date))
  );
$$;

create or replace function public.upsert_company_tax_option(
  p_company_id uuid,
  p_code text,
  p_display_name text,
  p_treatment_type text,
  p_rate numeric,
  p_requires_exemption_reason boolean default false,
  p_effective_from date default current_date,
  p_effective_until date default null,
  p_option_id uuid default null
)
returns public.company_tax_options
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_treatment text := lower(btrim(coalesce(p_treatment_type, '')));
  v_rate numeric(9,4);
  v_before public.company_tax_options%rowtype;
  v_after public.company_tax_options%rowtype;
begin
  perform public.commercial_tax_require_admin(p_company_id);

  if v_code = '' or v_name = '' then
    raise exception 'commercial_tax_option_name_required';
  end if;
  if v_treatment not in ('standard', 'zero', 'exempt') then
    raise exception 'commercial_tax_treatment_invalid';
  end if;
  if p_rate is null or lower(p_rate::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'commercial_tax_rate_invalid';
  end if;
  v_rate := round(p_rate, 4);
  if (v_treatment = 'standard' and v_rate <= 0)
     or (v_treatment in ('zero', 'exempt') and v_rate <> 0) then
    raise exception 'commercial_tax_rate_treatment_mismatch';
  end if;
  if v_treatment = 'standard' and coalesce(p_requires_exemption_reason, false) then
    raise exception 'commercial_tax_standard_cannot_require_exemption';
  end if;
  if p_effective_from is null or (p_effective_until is not null and p_effective_until < p_effective_from) then
    raise exception 'commercial_tax_effective_dates_invalid';
  end if;

  if p_option_id is null then
    insert into public.company_tax_options (
      company_id, code, display_name, treatment_type, rate,
      requires_exemption_reason, is_active, effective_from, effective_until,
      created_by, updated_by
    ) values (
      p_company_id, v_code, v_name, v_treatment, v_rate,
      coalesce(p_requires_exemption_reason, false), true, p_effective_from, p_effective_until,
      v_actor, v_actor
    )
    returning * into v_after;

    insert into public.company_tax_configuration_events (
      company_id, event_type, tax_option_id, before_state, after_state, actor_user_id
    ) values (
      p_company_id, 'option.created', v_after.id, null, to_jsonb(v_after), v_actor
    );
  else
    select * into v_before
    from public.company_tax_options
    where company_id = p_company_id and id = p_option_id
    for update;

    if v_before.id is null then
      raise exception 'commercial_tax_option_not_found';
    end if;

    if exists (
      select 1 from public.company_tax_settings settings_row
      where settings_row.company_id = p_company_id
        and p_option_id in (
          settings_row.default_sales_tax_option_id,
          settings_row.default_purchase_tax_option_id
        )
    ) and (
      p_effective_from > current_date
      or (p_effective_until is not null and p_effective_until < current_date)
    ) then
      raise exception 'commercial_tax_default_must_remain_effective';
    end if;

    update public.company_tax_options
       set code = v_code,
           display_name = v_name,
           treatment_type = v_treatment,
           rate = v_rate,
           requires_exemption_reason = coalesce(p_requires_exemption_reason, false),
           effective_from = p_effective_from,
           effective_until = p_effective_until,
           updated_by = v_actor,
           updated_at = now()
     where company_id = p_company_id and id = p_option_id
     returning * into v_after;

    insert into public.company_tax_configuration_events (
      company_id, event_type, tax_option_id, before_state, after_state, actor_user_id
    ) values (
      p_company_id, 'option.updated', v_after.id, to_jsonb(v_before), to_jsonb(v_after), v_actor
    );
  end if;

  return v_after;
end;
$$;

create or replace function public.set_company_tax_option_active(
  p_company_id uuid,
  p_option_id uuid,
  p_is_active boolean
)
returns public.company_tax_options
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.company_tax_options%rowtype;
  v_after public.company_tax_options%rowtype;
begin
  perform public.commercial_tax_require_admin(p_company_id);

  select * into v_before
  from public.company_tax_options
  where company_id = p_company_id and id = p_option_id
  for update;
  if v_before.id is null then
    raise exception 'commercial_tax_option_not_found';
  end if;

  if not coalesce(p_is_active, false) and exists (
    select 1 from public.company_tax_settings settings_row
    where settings_row.company_id = p_company_id
      and p_option_id in (
        settings_row.default_sales_tax_option_id,
        settings_row.default_purchase_tax_option_id
      )
  ) then
    raise exception 'commercial_tax_default_must_be_cleared_first';
  end if;

  update public.company_tax_options
     set is_active = coalesce(p_is_active, false),
         updated_by = v_actor,
         updated_at = now()
   where company_id = p_company_id and id = p_option_id
   returning * into v_after;

  insert into public.company_tax_configuration_events (
    company_id, event_type, tax_option_id, before_state, after_state, actor_user_id
  ) values (
    p_company_id,
    case when v_after.is_active then 'option.activated' else 'option.deactivated' end,
    p_option_id,
    to_jsonb(v_before),
    to_jsonb(v_after),
    v_actor
  );

  return v_after;
end;
$$;

create or replace function public.set_company_tax_defaults(
  p_company_id uuid,
  p_default_sales_tax_option_id uuid default null,
  p_default_purchase_tax_option_id uuid default null
)
returns public.company_tax_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_before public.company_tax_settings%rowtype;
  v_after public.company_tax_settings%rowtype;
begin
  perform public.commercial_tax_require_admin(p_company_id);

  perform option_row.id
  from public.company_tax_options option_row
  where option_row.company_id = p_company_id
    and option_row.id in (p_default_sales_tax_option_id, p_default_purchase_tax_option_id)
  order by option_row.id
  for update;

  if p_default_sales_tax_option_id is not null
     and not public.commercial_tax_option_is_effective(p_company_id, p_default_sales_tax_option_id, current_date) then
    raise exception 'commercial_tax_sales_default_inactive';
  end if;
  if p_default_purchase_tax_option_id is not null
     and not public.commercial_tax_option_is_effective(p_company_id, p_default_purchase_tax_option_id, current_date) then
    raise exception 'commercial_tax_purchase_default_inactive';
  end if;

  select * into v_before
  from public.company_tax_settings
  where company_id = p_company_id
  for update;

  insert into public.company_tax_settings (
    company_id, default_sales_tax_option_id, default_purchase_tax_option_id,
    created_by, updated_by
  ) values (
    p_company_id, p_default_sales_tax_option_id, p_default_purchase_tax_option_id,
    v_actor, v_actor
  )
  on conflict (company_id) do update
    set default_sales_tax_option_id = excluded.default_sales_tax_option_id,
        default_purchase_tax_option_id = excluded.default_purchase_tax_option_id,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_after;

  insert into public.company_tax_configuration_events (
    company_id, event_type, before_state, after_state, actor_user_id
  ) values (
    p_company_id, 'defaults.updated',
    case when v_before.company_id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after), v_actor
  );

  return v_after;
end;
$$;

alter table public.sales_orders add column tax_calculation_mode text;
alter table public.sales_orders add column tax_configuration_version integer;
alter table public.sales_orders add column tax_exemption_reason_text text;
update public.sales_orders
set tax_calculation_mode = 'legacy_header', tax_configuration_version = 0
where tax_calculation_mode is null;
alter table public.sales_orders alter column tax_calculation_mode set default 'line';
alter table public.sales_orders alter column tax_calculation_mode set not null;
alter table public.sales_orders alter column tax_configuration_version set default 1;
alter table public.sales_orders alter column tax_configuration_version set not null;
alter table public.sales_orders add constraint sales_orders_tax_mode_check
  check (tax_calculation_mode in ('legacy_header', 'line'));
alter table public.sales_orders add constraint sales_orders_tax_version_check
  check (tax_configuration_version >= 0);

alter table public.purchase_orders add column tax_calculation_mode text;
alter table public.purchase_orders add column tax_configuration_version integer;
alter table public.purchase_orders add column tax_exemption_reason_text text;
update public.purchase_orders
set tax_calculation_mode = 'legacy_header', tax_configuration_version = 0
where tax_calculation_mode is null;
alter table public.purchase_orders alter column tax_calculation_mode set default 'line';
alter table public.purchase_orders alter column tax_calculation_mode set not null;
alter table public.purchase_orders alter column tax_configuration_version set default 1;
alter table public.purchase_orders alter column tax_configuration_version set not null;
alter table public.purchase_orders add constraint purchase_orders_tax_mode_check
  check (tax_calculation_mode in ('legacy_header', 'line'));
alter table public.purchase_orders add constraint purchase_orders_tax_version_check
  check (tax_configuration_version >= 0);

alter table public.sales_order_lines add column tax_option_id uuid;
alter table public.sales_order_lines add column tax_option_code_snapshot text;
alter table public.sales_order_lines add column tax_treatment_snapshot text;
alter table public.sales_order_lines add column tax_label_snapshot text;
alter table public.sales_order_lines add column tax_rate numeric(9,4);
alter table public.sales_order_lines add column tax_amount numeric(18,4);
alter table public.sales_order_lines add column tax_requires_exemption_reason boolean;
alter table public.sales_order_lines add constraint sales_order_lines_tax_option_fk
  foreign key (company_id, tax_option_id)
  references public.company_tax_options(company_id, id);
alter table public.sales_order_lines add constraint sales_order_lines_tax_treatment_check
  check (tax_treatment_snapshot is null or tax_treatment_snapshot in ('standard', 'zero', 'exempt'));
alter table public.sales_order_lines add constraint sales_order_lines_tax_rate_check
  check (tax_rate is null or (lower(tax_rate::text) not in ('nan', 'infinity', '-infinity') and tax_rate >= 0));
alter table public.sales_order_lines add constraint sales_order_lines_tax_amount_check
  check (tax_amount is null or (lower(tax_amount::text) not in ('nan', 'infinity', '-infinity') and tax_amount >= 0));
create index sales_order_lines_tax_option_idx on public.sales_order_lines (company_id, tax_option_id);

alter table public.purchase_order_lines add column tax_option_id uuid;
alter table public.purchase_order_lines add column tax_option_code_snapshot text;
alter table public.purchase_order_lines add column tax_treatment_snapshot text;
alter table public.purchase_order_lines add column tax_label_snapshot text;
alter table public.purchase_order_lines add column tax_rate numeric(9,4);
alter table public.purchase_order_lines add column tax_amount numeric(18,4);
alter table public.purchase_order_lines add column tax_requires_exemption_reason boolean;
alter table public.purchase_order_lines add constraint purchase_order_lines_tax_option_fk
  foreign key (company_id, tax_option_id)
  references public.company_tax_options(company_id, id);
alter table public.purchase_order_lines add constraint purchase_order_lines_tax_treatment_check
  check (tax_treatment_snapshot is null or tax_treatment_snapshot in ('standard', 'zero', 'exempt'));
alter table public.purchase_order_lines add constraint purchase_order_lines_tax_rate_check
  check (tax_rate is null or (lower(tax_rate::text) not in ('nan', 'infinity', '-infinity') and tax_rate >= 0));
alter table public.purchase_order_lines add constraint purchase_order_lines_tax_amount_check
  check (tax_amount is null or (lower(tax_amount::text) not in ('nan', 'infinity', '-infinity') and tax_amount >= 0));
create index purchase_order_lines_tax_option_idx on public.purchase_order_lines (company_id, tax_option_id);

alter table public.sales_invoices add column tax_calculation_mode text not null default 'legacy_header';
alter table public.sales_invoices add constraint sales_invoices_tax_mode_check
  check (tax_calculation_mode in ('legacy_header', 'line'));
alter table public.sales_invoice_lines add column tax_option_code_snapshot text;
alter table public.sales_invoice_lines add column tax_treatment_snapshot text;
alter table public.sales_invoice_lines add column tax_label_snapshot text;
alter table public.sales_invoice_lines add column tax_requires_exemption_reason boolean;
alter table public.sales_invoice_lines add constraint sales_invoice_lines_tax_treatment_check
  check (tax_treatment_snapshot is null or tax_treatment_snapshot in ('standard', 'zero', 'exempt'));

alter table public.vendor_bills add column tax_calculation_mode text not null default 'legacy_header';
alter table public.vendor_bills add column vat_exemption_reason_text text;
alter table public.vendor_bills add constraint vendor_bills_tax_mode_check
  check (tax_calculation_mode in ('legacy_header', 'line'));
alter table public.vendor_bill_lines add column tax_option_code_snapshot text;
alter table public.vendor_bill_lines add column tax_treatment_snapshot text;
alter table public.vendor_bill_lines add column tax_label_snapshot text;
alter table public.vendor_bill_lines add column tax_requires_exemption_reason boolean;
alter table public.vendor_bill_lines add constraint vendor_bill_lines_tax_treatment_check
  check (tax_treatment_snapshot is null or tax_treatment_snapshot in ('standard', 'zero', 'exempt'));

create or replace function public.trg_sol_calc_total()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_mode text;
begin
  new.discount_pct := coalesce(new.discount_pct, 0);
  select so.tax_calculation_mode into v_mode
  from public.sales_orders so where so.id = new.so_id;
  if v_mode = 'line' then
    new.line_total := round(coalesce(new.qty,0) * coalesce(new.unit_price,0) * (1 - new.discount_pct / 100), 2);
  else
    new.line_total := coalesce(new.qty,0) * coalesce(new.unit_price,0) * (1 - new.discount_pct / 100);
  end if;
  return new;
end;
$$;

create or replace function public.trg_pol_calc_total()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_mode text;
begin
  new.discount_pct := coalesce(new.discount_pct, 0);
  select po.tax_calculation_mode into v_mode
  from public.purchase_orders po where po.id = new.po_id;
  if v_mode = 'line' then
    new.line_total := round(coalesce(new.qty,0) * coalesce(new.unit_price,0) * (1 - new.discount_pct / 100), 2);
  else
    new.line_total := coalesce(new.qty,0) * coalesce(new.unit_price,0) * (1 - new.discount_pct / 100);
  end if;
  return new;
end;
$$;

create or replace function public.commercial_tax_apply_sales_order_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.sales_orders%rowtype;
  v_option public.company_tax_options%rowtype;
  v_commercial_changed boolean := false;
  v_operator_sale boolean :=
    coalesce(current_setting('stockwise.commercial_tax_operator_sale', true), '') = 'on';
begin
  select * into v_order
  from public.sales_orders
  where id = coalesce(new.so_id, old.so_id)
  for update;

  if v_order.id is null then
    raise exception 'commercial_tax_sales_order_not_found';
  end if;
  if v_order.tax_calculation_mode <> 'line' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_order.status::text <> 'draft' then
      raise exception 'commercial_tax_sales_line_locked';
    end if;
    return old;
  end if;

  new.company_id := v_order.company_id;
  if tg_op = 'INSERT' and v_operator_sale and new.tax_option_id is null then
    select cts.default_sales_tax_option_id
      into new.tax_option_id
    from public.company_tax_settings cts
    where cts.company_id = v_order.company_id;
    if new.tax_option_id is null then
      raise exception 'commercial_tax_sales_default_unconfigured';
    end if;
  end if;
  if tg_op = 'INSERT' then
    v_commercial_changed := true;
  else
    v_commercial_changed := row(
      new.item_id, new.uom_id, new.description, new.line_no, new.qty,
      new.unit_price, new.discount_pct, new.line_total, new.tax_option_id,
      new.tax_option_code_snapshot, new.tax_treatment_snapshot, new.tax_label_snapshot,
      new.tax_rate, new.tax_amount, new.tax_requires_exemption_reason
    ) is distinct from row(
      old.item_id, old.uom_id, old.description, old.line_no, old.qty,
      old.unit_price, old.discount_pct, old.line_total, old.tax_option_id,
      old.tax_option_code_snapshot, old.tax_treatment_snapshot, old.tax_label_snapshot,
      old.tax_rate, old.tax_amount, old.tax_requires_exemption_reason
    );
  end if;

  if v_order.status::text <> 'draft'
     and not (v_operator_sale and tg_op = 'INSERT') then
    if v_commercial_changed then
      raise exception 'commercial_tax_sales_line_locked';
    end if;
    return new;
  end if;

  if lower(coalesce(new.qty::text, '')) in ('nan', 'infinity', '-infinity')
     or lower(coalesce(new.unit_price::text, '')) in ('nan', 'infinity', '-infinity')
     or lower(coalesce(new.discount_pct::text, '')) in ('nan', 'infinity', '-infinity')
     or coalesce(new.qty, 0) <= 0
     or coalesce(new.unit_price, 0) < 0
     or coalesce(new.discount_pct, 0) < 0
     or coalesce(new.discount_pct, 0) > 100 then
    raise exception 'commercial_tax_sales_line_amount_invalid';
  end if;

  new.discount_pct := coalesce(new.discount_pct, 0);
  new.line_total := round(new.qty * new.unit_price * (1 - new.discount_pct / 100), 2);

  if new.tax_option_id is null then
    if tg_op = 'INSERT' and (
      new.tax_rate is not null or new.tax_amount is not null
      or new.tax_option_code_snapshot is not null or new.tax_treatment_snapshot is not null
    ) then
      raise exception 'commercial_tax_option_required';
    end if;
    new.tax_option_code_snapshot := null;
    new.tax_treatment_snapshot := null;
    new.tax_label_snapshot := null;
    new.tax_rate := null;
    new.tax_amount := null;
    new.tax_requires_exemption_reason := null;
    return new;
  end if;

  select * into v_option
  from public.company_tax_options
  where company_id = v_order.company_id and id = new.tax_option_id;

  if v_option.id is null then
    raise exception 'commercial_tax_option_cross_company_or_missing';
  end if;
  if not v_option.is_active
     or v_option.effective_from > coalesce(v_order.order_date, current_date)
     or (v_option.effective_until is not null and v_option.effective_until < coalesce(v_order.order_date, current_date)) then
    raise exception 'commercial_tax_option_inactive';
  end if;
  if v_operator_sale and v_option.requires_exemption_reason then
    raise exception 'commercial_tax_exemption_reason_required';
  end if;

  new.tax_option_code_snapshot := v_option.code;
  new.tax_treatment_snapshot := v_option.treatment_type;
  new.tax_label_snapshot := v_option.display_name;
  new.tax_rate := v_option.rate;
  new.tax_amount := round(new.line_total * v_option.rate / 100, 2);
  new.tax_requires_exemption_reason := v_option.requires_exemption_reason;
  return new;
end;
$$;

create or replace function public.commercial_tax_apply_purchase_order_line()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_option public.company_tax_options%rowtype;
  v_commercial_changed boolean := false;
begin
  select * into v_order
  from public.purchase_orders
  where id = coalesce(new.po_id, old.po_id)
  for update;

  if v_order.id is null then
    raise exception 'commercial_tax_purchase_order_not_found';
  end if;
  if v_order.tax_calculation_mode <> 'line' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_order.status::text <> 'draft' then
      raise exception 'commercial_tax_purchase_line_locked';
    end if;
    return old;
  end if;

  new.company_id := v_order.company_id;
  if tg_op = 'INSERT' then
    v_commercial_changed := true;
  else
    v_commercial_changed := row(
      new.item_id, new.uom_id, new.description, new.line_no, new.qty,
      new.unit_price, new.discount_pct, new.line_total, new.tax_option_id,
      new.tax_option_code_snapshot, new.tax_treatment_snapshot, new.tax_label_snapshot,
      new.tax_rate, new.tax_amount, new.tax_requires_exemption_reason
    ) is distinct from row(
      old.item_id, old.uom_id, old.description, old.line_no, old.qty,
      old.unit_price, old.discount_pct, old.line_total, old.tax_option_id,
      old.tax_option_code_snapshot, old.tax_treatment_snapshot, old.tax_label_snapshot,
      old.tax_rate, old.tax_amount, old.tax_requires_exemption_reason
    );
  end if;

  if v_order.status::text <> 'draft' then
    if v_commercial_changed then
      raise exception 'commercial_tax_purchase_line_locked';
    end if;
    return new;
  end if;

  if lower(coalesce(new.qty::text, '')) in ('nan', 'infinity', '-infinity')
     or lower(coalesce(new.unit_price::text, '')) in ('nan', 'infinity', '-infinity')
     or lower(coalesce(new.discount_pct::text, '')) in ('nan', 'infinity', '-infinity')
     or coalesce(new.qty, 0) <= 0
     or coalesce(new.unit_price, 0) < 0
     or coalesce(new.discount_pct, 0) < 0
     or coalesce(new.discount_pct, 0) > 100 then
    raise exception 'commercial_tax_purchase_line_amount_invalid';
  end if;

  new.discount_pct := coalesce(new.discount_pct, 0);
  new.line_total := round(new.qty * new.unit_price * (1 - new.discount_pct / 100), 2);

  if new.tax_option_id is null then
    if tg_op = 'INSERT' and (
      new.tax_rate is not null or new.tax_amount is not null
      or new.tax_option_code_snapshot is not null or new.tax_treatment_snapshot is not null
    ) then
      raise exception 'commercial_tax_option_required';
    end if;
    new.tax_option_code_snapshot := null;
    new.tax_treatment_snapshot := null;
    new.tax_label_snapshot := null;
    new.tax_rate := null;
    new.tax_amount := null;
    new.tax_requires_exemption_reason := null;
    return new;
  end if;

  select * into v_option
  from public.company_tax_options
  where company_id = v_order.company_id and id = new.tax_option_id;

  if v_option.id is null then
    raise exception 'commercial_tax_option_cross_company_or_missing';
  end if;
  if not v_option.is_active
     or v_option.effective_from > coalesce(v_order.order_date, current_date)
     or (v_option.effective_until is not null and v_option.effective_until < coalesce(v_order.order_date, current_date)) then
    raise exception 'commercial_tax_option_inactive';
  end if;

  new.tax_option_code_snapshot := v_option.code;
  new.tax_treatment_snapshot := v_option.treatment_type;
  new.tax_label_snapshot := v_option.display_name;
  new.tax_rate := v_option.rate;
  new.tax_amount := round(new.line_total * v_option.rate / 100, 2);
  new.tax_requires_exemption_reason := v_option.requires_exemption_reason;
  return new;
end;
$$;

create trigger biud_05_sales_order_line_commercial_tax
before insert or update or delete on public.sales_order_lines
for each row execute function public.commercial_tax_apply_sales_order_line();
create trigger biud_05_purchase_order_line_commercial_tax
before insert or update or delete on public.purchase_order_lines
for each row execute function public.commercial_tax_apply_purchase_order_line();

create or replace function public.commercial_tax_refresh_order_totals(
  p_document_type text,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_subtotal numeric(18,4) := 0;
  v_tax_total numeric(18,4) := 0;
begin
  perform set_config('stockwise.commercial_tax_rollup', 'on', true);
  if p_document_type = 'sales_order' then
    select round(coalesce(sum(round(line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(tax_amount, 0)), 0), 2)
      into v_subtotal, v_tax_total
    from public.sales_order_lines where so_id = p_document_id;

    update public.sales_orders
       set subtotal = v_subtotal,
           tax_total = v_tax_total,
           total = round(v_subtotal + v_tax_total, 2),
           total_amount = round(v_subtotal + v_tax_total, 2)
     where id = p_document_id and tax_calculation_mode = 'line';
  elsif p_document_type = 'purchase_order' then
    select round(coalesce(sum(round(line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(tax_amount, 0)), 0), 2)
      into v_subtotal, v_tax_total
    from public.purchase_order_lines where po_id = p_document_id;

    update public.purchase_orders
       set subtotal = v_subtotal,
           tax_total = v_tax_total,
           total = round(v_subtotal + v_tax_total, 2),
           total_amount = round(v_subtotal + v_tax_total, 2)
     where id = p_document_id and tax_calculation_mode = 'line';
  else
    raise exception 'commercial_tax_document_type_invalid';
  end if;
end;
$$;

create or replace function public.commercial_tax_sales_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.commercial_tax_refresh_order_totals('sales_order', coalesce(new.so_id, old.so_id));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.commercial_tax_purchase_line_rollup()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.commercial_tax_refresh_order_totals('purchase_order', coalesce(new.po_id, old.po_id));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger aiud_90_sales_order_line_tax_rollup
after insert or update or delete on public.sales_order_lines
for each row execute function public.commercial_tax_sales_line_rollup();
create trigger aiud_90_purchase_order_line_tax_rollup
after insert or update or delete on public.purchase_order_lines
for each row execute function public.commercial_tax_purchase_line_rollup();

create or replace function public.commercial_tax_order_readiness(
  p_document_type text,
  p_document_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_company_id uuid;
  v_mode text;
  v_reason text;
  v_order_date date;
  v_line_count integer := 0;
  v_unconfigured integer := 0;
  v_inactive integer := 0;
  v_reason_required integer := 0;
  v_subtotal numeric := 0;
  v_tax_total numeric := 0;
  v_header_subtotal numeric := 0;
  v_header_tax numeric := 0;
  v_header_total numeric := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_document_type = 'sales_order' then
    select company_id, tax_calculation_mode, tax_exemption_reason_text, order_date,
           subtotal, tax_total, total
      into v_company_id, v_mode, v_reason, v_order_date,
           v_header_subtotal, v_header_tax, v_header_total
    from public.sales_orders where id = p_document_id;
  elsif p_document_type = 'purchase_order' then
    select company_id, tax_calculation_mode, tax_exemption_reason_text, order_date,
           subtotal, tax_total, total
      into v_company_id, v_mode, v_reason, v_order_date,
           v_header_subtotal, v_header_tax, v_header_total
    from public.purchase_orders where id = p_document_id;
  else
    raise exception 'commercial_tax_document_type_invalid';
  end if;

  if v_company_id is null or not public.finance_documents_can_read(v_company_id) then
    raise exception 'commercial_tax_document_not_found' using errcode = '42501';
  end if;
  if v_mode = 'legacy_header' then
    return jsonb_build_object('ready', true, 'mode', v_mode, 'blockers', v_blockers);
  end if;

  if p_document_type = 'sales_order' then
    select count(*),
           count(*) filter (where line.tax_option_id is null or line.tax_amount is null),
           count(*) filter (
             where line.tax_option_id is not null and (
               option_row.id is null or not option_row.is_active
               or option_row.effective_from > coalesce(v_order_date, current_date)
               or (option_row.effective_until is not null and option_row.effective_until < coalesce(v_order_date, current_date))
             )
           ),
           count(*) filter (where coalesce(line.tax_requires_exemption_reason, false)),
           round(coalesce(sum(round(line.line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(line.tax_amount, 0)), 0), 2)
      into v_line_count, v_unconfigured, v_inactive, v_reason_required, v_subtotal, v_tax_total
    from public.sales_order_lines line
    left join public.company_tax_options option_row
      on option_row.company_id = line.company_id and option_row.id = line.tax_option_id
    where line.so_id = p_document_id;
  else
    select count(*),
           count(*) filter (where line.tax_option_id is null or line.tax_amount is null),
           count(*) filter (
             where line.tax_option_id is not null and (
               option_row.id is null or not option_row.is_active
               or option_row.effective_from > coalesce(v_order_date, current_date)
               or (option_row.effective_until is not null and option_row.effective_until < coalesce(v_order_date, current_date))
             )
           ),
           count(*) filter (where coalesce(line.tax_requires_exemption_reason, false)),
           round(coalesce(sum(round(line.line_total, 2)), 0), 2),
           round(coalesce(sum(coalesce(line.tax_amount, 0)), 0), 2)
      into v_line_count, v_unconfigured, v_inactive, v_reason_required, v_subtotal, v_tax_total
    from public.purchase_order_lines line
    left join public.company_tax_options option_row
      on option_row.company_id = line.company_id and option_row.id = line.tax_option_id
    where line.po_id = p_document_id;
  end if;

  if v_line_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_lines_required');
  end if;
  if v_unconfigured > 0 then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_lines_unconfigured');
  end if;
  if v_inactive > 0 then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_lines_inactive');
  end if;
  if v_reason_required > 0 and nullif(btrim(coalesce(v_reason, '')), '') is null then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_exemption_reason_required');
  end if;
  if round(coalesce(v_header_subtotal, 0), 2) <> round(v_subtotal, 2)
     or round(coalesce(v_header_tax, 0), 2) <> round(v_tax_total, 2)
     or round(coalesce(v_header_total, 0), 2) <> round(v_subtotal + v_tax_total, 2) then
    v_blockers := v_blockers || jsonb_build_array('commercial_tax_totals_out_of_sync');
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'mode', v_mode,
    'blockers', v_blockers,
    'line_count', v_line_count,
    'unconfigured_line_count', v_unconfigured,
    'inactive_line_count', v_inactive,
    'subtotal', round(v_subtotal, 2),
    'tax_total', round(v_tax_total, 2),
    'total', round(v_subtotal + v_tax_total, 2)
  );
end;
$$;

create or replace function public.get_commercial_tax_order_readiness(
  p_document_type text,
  p_document_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.commercial_tax_order_readiness(p_document_type, p_document_id);
$$;

create or replace function public.commercial_tax_assert_order_ready(
  p_document_type text,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
  v_blocker text;
begin
  v_result := public.commercial_tax_order_readiness(p_document_type, p_document_id);
  if not coalesce((v_result ->> 'ready')::boolean, false) then
    select value #>> '{}' into v_blocker
    from jsonb_array_elements(v_result -> 'blockers')
    limit 1;
    raise exception '%', coalesce(v_blocker, 'commercial_tax_not_ready');
  end if;
end;
$$;

create or replace function public.commercial_tax_sales_order_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.tax_exemption_reason_text := nullif(btrim(coalesce(new.tax_exemption_reason_text, '')), '');
  if tg_op = 'INSERT' then
    if new.tax_calculation_mode = 'line' then
      if coalesce(current_setting('stockwise.commercial_tax_operator_sale', true), '') = 'on' then
        new.subtotal := 0;
        new.tax_total := 0;
        new.total := 0;
        new.total_amount := 0;
      elsif round(coalesce(new.subtotal, 0), 2) <> 0
         or round(coalesce(new.tax_total, 0), 2) <> 0
         or round(coalesce(new.total, 0), 2) <> 0
         or round(coalesce(new.total_amount, 0), 2) <> 0 then
        raise exception 'commercial_tax_header_totals_derived';
      end if;
      new.tax_configuration_version := 1;
    end if;
    return new;
  end if;

  if new.tax_calculation_mode is distinct from old.tax_calculation_mode
     or new.tax_configuration_version is distinct from old.tax_configuration_version then
    raise exception 'commercial_tax_mode_immutable';
  end if;
  if old.tax_calculation_mode = 'line' then
    if coalesce(current_setting('stockwise.commercial_tax_rollup', true), '') <> 'on'
       and row(new.subtotal, new.tax_total, new.total, new.total_amount)
           is distinct from row(old.subtotal, old.tax_total, old.total, old.total_amount) then
      raise exception 'commercial_tax_header_totals_derived';
    end if;
    if old.status::text <> 'draft'
       and new.tax_exemption_reason_text is distinct from old.tax_exemption_reason_text then
      raise exception 'commercial_tax_sales_order_locked';
    end if;
    if old.status::text = 'draft'
       and new.status::text <> 'draft'
       and lower(new.status::text) not in ('cancelled', 'canceled') then
      perform public.commercial_tax_assert_order_ready('sales_order', old.id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.commercial_tax_purchase_order_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.tax_exemption_reason_text := nullif(btrim(coalesce(new.tax_exemption_reason_text, '')), '');
  if tg_op = 'INSERT' then
    if new.tax_calculation_mode = 'line' then
      if round(coalesce(new.subtotal, 0), 2) <> 0
         or round(coalesce(new.tax_total, 0), 2) <> 0
         or round(coalesce(new.total, 0), 2) <> 0
         or round(coalesce(new.total_amount, 0), 2) <> 0 then
        raise exception 'commercial_tax_header_totals_derived';
      end if;
      new.tax_configuration_version := 1;
    end if;
    return new;
  end if;

  if new.tax_calculation_mode is distinct from old.tax_calculation_mode
     or new.tax_configuration_version is distinct from old.tax_configuration_version then
    raise exception 'commercial_tax_mode_immutable';
  end if;
  if old.tax_calculation_mode = 'line' then
    if coalesce(current_setting('stockwise.commercial_tax_rollup', true), '') <> 'on'
       and row(new.subtotal, new.tax_total, new.total, new.total_amount)
           is distinct from row(old.subtotal, old.tax_total, old.total, old.total_amount) then
      raise exception 'commercial_tax_header_totals_derived';
    end if;
    if old.status::text <> 'draft'
       and new.tax_exemption_reason_text is distinct from old.tax_exemption_reason_text then
      raise exception 'commercial_tax_purchase_order_locked';
    end if;
    if old.status::text = 'draft'
       and new.status::text <> 'draft'
       and lower(new.status::text) not in ('cancelled', 'canceled') then
      perform public.commercial_tax_assert_order_ready('purchase_order', old.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger biu_05_sales_order_commercial_tax_guard
before insert or update on public.sales_orders
for each row execute function public.commercial_tax_sales_order_guard();
create trigger biu_05_purchase_order_commercial_tax_guard
before insert or update on public.purchase_orders
for each row execute function public.commercial_tax_purchase_order_guard();

create or replace function public.commercial_tax_sales_invoice_header_mode()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.sales_orders%rowtype;
begin
  if new.sales_order_id is null then return new; end if;
  select * into v_order from public.sales_orders
  where id = new.sales_order_id and company_id = new.company_id;
  if v_order.id is null then raise exception 'commercial_tax_sales_order_not_found'; end if;
  if v_order.tax_calculation_mode = 'line' then
    new.tax_calculation_mode := 'line';
    new.vat_exemption_reason_text := v_order.tax_exemption_reason_text;
  end if;
  return new;
end;
$$;

create or replace function public.commercial_tax_vendor_bill_header_mode()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.purchase_orders%rowtype;
begin
  if new.purchase_order_id is null then return new; end if;
  select * into v_order from public.purchase_orders
  where id = new.purchase_order_id and company_id = new.company_id;
  if v_order.id is null then raise exception 'commercial_tax_purchase_order_not_found'; end if;
  if v_order.tax_calculation_mode = 'line' then
    if coalesce(current_setting('stockwise.commercial_tax_canonical_vendor_bill', true), '') <> 'on' then
      raise exception 'commercial_tax_canonical_vendor_bill_rpc_required';
    end if;
    new.tax_calculation_mode := 'line';
    new.vat_exemption_reason_text := v_order.tax_exemption_reason_text;
  end if;
  return new;
end;
$$;

create trigger bi_05_sales_invoice_commercial_tax_mode
before insert on public.sales_invoices
for each row execute function public.commercial_tax_sales_invoice_header_mode();
create trigger bi_05_vendor_bill_commercial_tax_mode
before insert on public.vendor_bills
for each row execute function public.commercial_tax_vendor_bill_header_mode();

create or replace function public.commercial_tax_sales_invoice_line_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_source public.sales_order_lines%rowtype;
begin
  select * into v_invoice from public.sales_invoices where id = new.sales_invoice_id;
  if v_invoice.tax_calculation_mode <> 'line' then return new; end if;
  if new.sales_order_line_id is null then raise exception 'commercial_tax_source_sales_line_required'; end if;
  select line.* into v_source
  from public.sales_order_lines line
  join public.sales_orders so on so.id = line.so_id
  where line.id = new.sales_order_line_id
    and line.company_id = v_invoice.company_id
    and so.id = v_invoice.sales_order_id
    and so.tax_calculation_mode = 'line';
  if v_source.id is null or v_source.tax_option_id is null or v_source.tax_amount is null then
    raise exception 'commercial_tax_source_sales_line_invalid';
  end if;
  new.company_id := v_invoice.company_id;
  new.item_id := v_source.item_id;
  new.qty := v_source.qty;
  new.unit_price := v_source.unit_price;
  new.tax_rate := v_source.tax_rate;
  new.tax_amount := v_source.tax_amount;
  new.line_total := round(v_source.line_total, 2);
  new.tax_option_code_snapshot := v_source.tax_option_code_snapshot;
  new.tax_treatment_snapshot := v_source.tax_treatment_snapshot;
  new.tax_label_snapshot := v_source.tax_label_snapshot;
  new.tax_requires_exemption_reason := v_source.tax_requires_exemption_reason;
  new.tax_category_code := v_source.tax_option_code_snapshot;
  return new;
end;
$$;

create or replace function public.commercial_tax_vendor_bill_line_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bill public.vendor_bills%rowtype;
  v_source public.purchase_order_lines%rowtype;
begin
  select * into v_bill from public.vendor_bills where id = new.vendor_bill_id;
  if v_bill.tax_calculation_mode <> 'line' then return new; end if;
  if new.purchase_order_line_id is null then raise exception 'commercial_tax_source_purchase_line_required'; end if;
  select line.* into v_source
  from public.purchase_order_lines line
  join public.purchase_orders po on po.id = line.po_id
  where line.id = new.purchase_order_line_id
    and line.company_id = v_bill.company_id
    and po.id = v_bill.purchase_order_id
    and po.tax_calculation_mode = 'line';
  if v_source.id is null or v_source.tax_option_id is null or v_source.tax_amount is null then
    raise exception 'commercial_tax_source_purchase_line_invalid';
  end if;
  new.company_id := v_bill.company_id;
  new.item_id := v_source.item_id;
  new.qty := v_source.qty;
  new.unit_cost := v_source.unit_price;
  new.tax_rate := v_source.tax_rate;
  new.tax_amount := v_source.tax_amount;
  new.line_total := round(v_source.line_total, 2);
  new.tax_option_code_snapshot := v_source.tax_option_code_snapshot;
  new.tax_treatment_snapshot := v_source.tax_treatment_snapshot;
  new.tax_label_snapshot := v_source.tax_label_snapshot;
  new.tax_requires_exemption_reason := v_source.tax_requires_exemption_reason;
  return new;
end;
$$;

create trigger biu_15_sales_invoice_line_commercial_tax_snapshot
before insert or update on public.sales_invoice_lines
for each row execute function public.commercial_tax_sales_invoice_line_snapshot();
create trigger biu_15_vendor_bill_line_commercial_tax_snapshot
before insert or update on public.vendor_bill_lines
for each row execute function public.commercial_tax_vendor_bill_line_snapshot();

create or replace function public.commercial_tax_finance_document_reconcile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_line_count integer := 0;
  v_reason_count integer := 0;
begin
  if new.tax_calculation_mode <> 'line' then return new; end if;
  if tg_table_name = 'sales_invoices' then
    if tg_op = 'UPDATE'
       and new.document_workflow_status = 'issued'
       and old.document_workflow_status <> 'issued' then
      select count(*), round(coalesce(sum(line_total), 0), 2),
             round(coalesce(sum(tax_amount), 0), 2),
             count(*) filter (where coalesce(tax_requires_exemption_reason, false))
        into v_line_count, v_subtotal, v_tax, v_reason_count
      from public.sales_invoice_lines where sales_invoice_id = new.id;
      if v_line_count = 0 then raise exception 'commercial_tax_finance_lines_required'; end if;
      if round(new.subtotal, 2) <> v_subtotal
         or round(new.tax_total, 2) <> v_tax
         or round(new.total_amount, 2) <> round(v_subtotal + v_tax, 2) then
        raise exception 'commercial_tax_finance_totals_mismatch';
      end if;
      if v_reason_count > 0 and nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), '') is null then
        raise exception 'commercial_tax_exemption_reason_required';
      end if;
    end if;
  elsif tg_table_name = 'vendor_bills' then
    if tg_op = 'UPDATE'
       and new.document_workflow_status = 'posted'
       and old.document_workflow_status <> 'posted' then
      select count(*), round(coalesce(sum(line_total), 0), 2),
             round(coalesce(sum(tax_amount), 0), 2),
             count(*) filter (where coalesce(tax_requires_exemption_reason, false))
        into v_line_count, v_subtotal, v_tax, v_reason_count
      from public.vendor_bill_lines where vendor_bill_id = new.id;
      if v_line_count = 0 then raise exception 'commercial_tax_finance_lines_required'; end if;
      if round(new.subtotal, 2) <> v_subtotal
         or round(new.tax_total, 2) <> v_tax
         or round(new.total_amount, 2) <> round(v_subtotal + v_tax, 2) then
        raise exception 'commercial_tax_finance_totals_mismatch';
      end if;
      if v_reason_count > 0 and nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), '') is null then
        raise exception 'commercial_tax_exemption_reason_required';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger biu_35_sales_invoice_commercial_tax_reconcile
before insert or update on public.sales_invoices
for each row execute function public.commercial_tax_finance_document_reconcile();
create trigger biu_35_vendor_bill_commercial_tax_reconcile
before insert or update on public.vendor_bills
for each row execute function public.commercial_tax_finance_document_reconcile();

create or replace function public.create_canonical_vendor_bill_draft_from_purchase_order(
  p_company_id uuid,
  p_purchase_order_id uuid,
  p_supplier_invoice_reference text default null,
  p_supplier_invoice_date date default null,
  p_bill_date date default null,
  p_due_date date default null,
  p_currency_code text default null,
  p_fx_to_base numeric default null
)
returns public.vendor_bills
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_bill public.vendor_bills%rowtype;
  v_bill_date date;
  v_due_date date;
  v_subtotal numeric;
  v_tax_total numeric;
  v_line_count integer;
begin
  if p_company_id is null or p_purchase_order_id is null then
    raise exception 'commercial_tax_purchase_order_required';
  end if;
  if not public.finance_documents_can_prepare_draft(p_company_id) then
    raise exception 'commercial_tax_vendor_bill_access_denied' using errcode = '42501';
  end if;

  select * into v_po
  from public.purchase_orders
  where company_id = p_company_id and id = p_purchase_order_id
  for update;
  if v_po.id is null then raise exception 'commercial_tax_purchase_order_not_found'; end if;
  if v_po.tax_calculation_mode <> 'line' then
    raise exception 'commercial_tax_purchase_order_not_canonical';
  end if;
  if lower(coalesce(v_po.status::text, '')) not in (
    'approved', 'open', 'authorised', 'authorized', 'submitted', 'partially_received', 'closed'
  ) then
    raise exception 'commercial_tax_purchase_order_not_billable';
  end if;
  if exists (
    select 1 from public.vendor_bills
    where company_id = p_company_id
      and purchase_order_id = p_purchase_order_id
      and document_workflow_status in ('draft', 'posted')
  ) then
    raise exception 'commercial_tax_vendor_bill_already_exists';
  end if;

  perform public.commercial_tax_assert_order_ready('purchase_order', p_purchase_order_id);

  if exists (
    select 1
    from public.stock_movements sm
    where sm.company_id = p_company_id
      and sm.ref_type = 'PO'
      and sm.type = 'receive'
      and sm.ref_id = p_purchase_order_id::text
      and (
        sm.ref_line_id is null
        or not exists (
          select 1 from public.purchase_order_lines pol
          where pol.company_id = p_company_id
            and pol.po_id = p_purchase_order_id
            and pol.id = sm.ref_line_id
        )
      )
  ) then
    raise exception 'commercial_tax_canonical_purchase_receipt_unmatched';
  end if;

  select count(*), round(coalesce(sum(line_total), 0), 2),
         round(coalesce(sum(tax_amount), 0), 2)
    into v_line_count, v_subtotal, v_tax_total
  from public.purchase_order_lines
  where company_id = p_company_id and po_id = p_purchase_order_id and qty > 0;
  if v_line_count = 0 then raise exception 'commercial_tax_purchase_lines_required'; end if;

  v_bill_date := coalesce(p_bill_date, p_supplier_invoice_date, current_date);
  v_due_date := coalesce(p_due_date, v_po.due_date, v_bill_date);
  if v_due_date < v_bill_date then v_due_date := v_bill_date; end if;

  perform set_config('stockwise.commercial_tax_canonical_vendor_bill', 'on', true);

  insert into public.vendor_bills (
    company_id, purchase_order_id, supplier_id,
    supplier_invoice_reference, supplier_invoice_date,
    bill_date, due_date, currency_code, fx_to_base,
    subtotal, tax_total, total_amount,
    document_workflow_status, approval_status, created_by,
    tax_calculation_mode, vat_exemption_reason_text
  ) values (
    p_company_id, p_purchase_order_id, v_po.supplier_id,
    nullif(btrim(coalesce(p_supplier_invoice_reference, '')), ''), p_supplier_invoice_date,
    v_bill_date, v_due_date,
    coalesce(nullif(btrim(coalesce(p_currency_code, '')), ''), v_po.currency_code::text, 'MZN'),
    case when coalesce(p_fx_to_base, v_po.fx_to_base, 1) > 0
      then coalesce(p_fx_to_base, v_po.fx_to_base, 1) else 1 end,
    v_subtotal, v_tax_total, round(v_subtotal + v_tax_total, 2),
    'draft', 'draft', auth.uid(),
    'line', v_po.tax_exemption_reason_text
  ) returning * into v_bill;

  insert into public.vendor_bill_lines (
    company_id, vendor_bill_id, purchase_order_line_id, item_id,
    description, qty, unit_cost, tax_rate, tax_amount, line_total, sort_order
  )
  select
    p_company_id, v_bill.id, pol.id, pol.item_id,
    coalesce(nullif(btrim(pol.description), ''), nullif(btrim(it.name), ''), nullif(btrim(it.sku), ''), 'Item'),
    pol.qty, pol.unit_price, pol.tax_rate, pol.tax_amount, round(pol.line_total, 2), pol.line_no
  from public.purchase_order_lines pol
  left join public.items it on it.company_id = p_company_id and it.id = pol.item_id
  where pol.company_id = p_company_id and pol.po_id = p_purchase_order_id and pol.qty > 0
  order by pol.line_no, pol.id;

  return v_bill;
end;
$$;

create or replace function public.create_operator_sale_issue_with_settlement(
  p_company_id uuid,
  p_bin_from_id text,
  p_customer_id uuid default null,
  p_order_date date default current_date,
  p_currency_code text default 'MZN',
  p_fx_to_base numeric default 1,
  p_reference_no text default null,
  p_notes text default null,
  p_lines jsonb default '[]'::jsonb,
  p_settlement_method text default 'cash',
  p_bank_account_id uuid default null
)
returns table(
  sales_order_id uuid,
  order_no text,
  customer_id uuid,
  customer_name text,
  line_count integer,
  total_amount numeric,
  settlement_method text,
  settlement_id uuid,
  settled_amount_base numeric,
  bank_account_id uuid
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_sale record;
  v_method text := lower(coalesce(nullif(btrim(p_settlement_method), ''), 'cash'));
  v_order_date date := coalesce(p_order_date, current_date);
  v_fx_to_base numeric := case when coalesce(p_fx_to_base, 0) > 0 then p_fx_to_base else 1 end;
  v_bank_company_id uuid;
  v_settlement_id uuid;
  v_settled_amount_base numeric;
  v_canonical_total numeric;
begin
  if v_method not in ('cash', 'bank') then
    raise exception 'Payment destination must be Cash or Bank.' using errcode = 'P0001';
  end if;

  if v_method = 'bank' and p_bank_account_id is null then
    raise exception 'Choose a bank account before posting a bank POS settlement.' using errcode = 'P0001';
  end if;

  if v_method = 'bank' then
    select ba.company_id into v_bank_company_id
    from public.bank_accounts ba
    where ba.id = p_bank_account_id
    limit 1;
    if v_bank_company_id is null or v_bank_company_id <> p_company_id then
      raise exception 'The selected bank account does not belong to this company.' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('stockwise.commercial_tax_operator_sale', 'on', true);

  select * into v_sale
  from public.create_operator_sale_issue(
    p_company_id,
    p_bin_from_id,
    p_customer_id,
    v_order_date,
    p_currency_code,
    v_fx_to_base,
    p_reference_no,
    p_notes,
    p_lines
  );

  if v_sale.sales_order_id is null then
    raise exception 'Could not create the POS sale before settlement.' using errcode = 'P0001';
  end if;

  select so.total_amount into v_canonical_total
  from public.sales_orders so
  where so.company_id = p_company_id and so.id = v_sale.sales_order_id;

  v_settled_amount_base := round(coalesce(v_canonical_total, 0) * v_fx_to_base, 2);
  if v_settled_amount_base <= 0 then
    raise exception 'POS settlement amount must be greater than zero.' using errcode = 'P0001';
  end if;

  perform set_config('stockwise.pos_settlement_bypass', 'on', true);

  if v_method = 'cash' then
    insert into public.cash_transactions (
      company_id, happened_at, type, ref_type, ref_id, memo, amount_base
    ) values (
      p_company_id, v_order_date, 'sale_receipt', 'SO', v_sale.sales_order_id,
      trim(both ' ' from concat(
        'Point of Sale receipt',
        case when nullif(v_sale.order_no, '') is not null then ' for ' || v_sale.order_no else '' end
      )),
      v_settled_amount_base
    ) returning id into v_settlement_id;
  else
    insert into public.bank_transactions (
      bank_id, happened_at, memo, amount_base, reconciled, ref_type, ref_id
    ) values (
      p_bank_account_id, v_order_date,
      trim(both ' ' from concat(
        'Point of Sale receipt',
        case when nullif(v_sale.order_no, '') is not null then ' for ' || v_sale.order_no else '' end
      )),
      v_settled_amount_base, false, 'SO', v_sale.sales_order_id
    ) returning id into v_settlement_id;
  end if;

  sales_order_id := v_sale.sales_order_id;
  order_no := v_sale.order_no;
  customer_id := v_sale.customer_id;
  customer_name := v_sale.customer_name;
  line_count := v_sale.line_count;
  total_amount := v_canonical_total;
  settlement_method := v_method;
  settlement_id := v_settlement_id;
  settled_amount_base := v_settled_amount_base;
  bank_account_id := case when v_method = 'bank' then p_bank_account_id else null end;
  return next;
end;
$$;

revoke execute on function public.commercial_tax_configuration_event_immutable() from public, anon, authenticated;
revoke execute on function public.commercial_tax_require_admin(uuid) from public, anon, authenticated;
revoke execute on function public.commercial_tax_option_is_effective(uuid,uuid,date) from public, anon, authenticated;
revoke execute on function public.trg_sol_calc_total() from public, anon, authenticated;
revoke execute on function public.trg_pol_calc_total() from public, anon, authenticated;
revoke execute on function public.commercial_tax_apply_sales_order_line() from public, anon, authenticated;
revoke execute on function public.commercial_tax_apply_purchase_order_line() from public, anon, authenticated;
revoke execute on function public.commercial_tax_refresh_order_totals(text,uuid) from public, anon, authenticated;
revoke execute on function public.commercial_tax_sales_line_rollup() from public, anon, authenticated;
revoke execute on function public.commercial_tax_purchase_line_rollup() from public, anon, authenticated;
revoke execute on function public.commercial_tax_order_readiness(text,uuid) from public, anon, authenticated;
revoke execute on function public.commercial_tax_assert_order_ready(text,uuid) from public, anon, authenticated;
revoke execute on function public.commercial_tax_sales_order_guard() from public, anon, authenticated;
revoke execute on function public.commercial_tax_purchase_order_guard() from public, anon, authenticated;
revoke execute on function public.commercial_tax_sales_invoice_header_mode() from public, anon, authenticated;
revoke execute on function public.commercial_tax_vendor_bill_header_mode() from public, anon, authenticated;
revoke execute on function public.commercial_tax_sales_invoice_line_snapshot() from public, anon, authenticated;
revoke execute on function public.commercial_tax_vendor_bill_line_snapshot() from public, anon, authenticated;
revoke execute on function public.commercial_tax_finance_document_reconcile() from public, anon, authenticated;
revoke execute on function public.create_canonical_vendor_bill_draft_from_purchase_order(
  uuid,uuid,text,date,date,date,text,numeric
) from public, anon;
revoke execute on function public.upsert_company_tax_option(uuid,text,text,text,numeric,boolean,date,date,uuid) from public, anon;
revoke execute on function public.set_company_tax_option_active(uuid,uuid,boolean) from public, anon;
revoke execute on function public.set_company_tax_defaults(uuid,uuid,uuid) from public, anon;
revoke execute on function public.get_commercial_tax_order_readiness(text,uuid) from public, anon;
grant execute on function public.upsert_company_tax_option(uuid,text,text,text,numeric,boolean,date,date,uuid) to authenticated;
grant execute on function public.set_company_tax_option_active(uuid,uuid,boolean) to authenticated;
grant execute on function public.set_company_tax_defaults(uuid,uuid,uuid) to authenticated;
grant execute on function public.get_commercial_tax_order_readiness(text,uuid) to authenticated;
grant execute on function public.create_canonical_vendor_bill_draft_from_purchase_order(
  uuid,uuid,text,date,date,date,text,numeric
) to authenticated;

comment on table public.company_tax_options is
  'Company-governed allowed tax treatments. No legal rates are seeded; historical rows remain readable after deactivation.';
comment on column public.sales_orders.tax_calculation_mode is
  'legacy_header preserves historical behavior; line is authoritative for newly created orders.';
comment on column public.purchase_orders.tax_calculation_mode is
  'legacy_header preserves historical behavior; line is authoritative for newly created orders.';
