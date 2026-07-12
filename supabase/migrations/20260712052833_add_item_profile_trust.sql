-- Item Profile Trust
-- Maintained item creation is atomic, typed, and returns the authoritative saved
-- profile so the client can round-trip verify it before showing success.

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
     or not public.has_company_role(
       p_company_id,
       array['OWNER','ADMIN','MANAGER','OPERATOR']::public.member_role[]
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

revoke execute on function public.create_item_with_profile(
  uuid,text,text,text,numeric,numeric,text,boolean,boolean,boolean,boolean
) from public, anon;
grant execute on function public.create_item_with_profile(
  uuid,text,text,text,numeric,numeric,text,boolean,boolean,boolean,boolean
) to authenticated;

comment on function public.create_item_with_profile(
  uuid,text,text,text,numeric,numeric,text,boolean,boolean,boolean,boolean
) is 'Creates one item with all protected profile fields in one authoritative operation; callers must round-trip verify the returned row.';
