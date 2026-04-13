alter table public.items
  add column if not exists primary_role text,
  add column if not exists track_inventory boolean,
  add column if not exists can_buy boolean,
  add column if not exists can_sell boolean,
  add column if not exists is_assembled boolean;

with item_usage as (
  select
    i.id,
    exists(
      select 1
      from public.boms b
      where b.product_id = i.id
        and coalesce(b.is_active, false) = true
    ) as has_active_bom,
    exists(
      select 1
      from public.bom_components bc
      where bc.component_item_id = i.id
    ) as used_as_component,
    exists(
      select 1
      from public.purchase_order_lines pol
      where pol.item_id = i.id
    ) or exists(
      select 1
      from public.vendor_bill_lines vbl
      where vbl.item_id = i.id
    ) as purchased,
    exists(
      select 1
      from public.sales_order_lines sol
      where sol.item_id = i.id
    ) or exists(
      select 1
      from public.sales_invoice_lines sil
      where sil.item_id = i.id
    ) as sold
  from public.items i
)
update public.items i
set
  track_inventory = coalesce(i.track_inventory, true),
  is_assembled = coalesce(i.is_assembled, usage.has_active_bom),
  can_buy = coalesce(
    i.can_buy,
    case
      when usage.has_active_bom and not usage.purchased then false
      when usage.used_as_component or usage.purchased then true
      when usage.sold and not usage.purchased then false
      else true
    end
  ),
  can_sell = coalesce(
    i.can_sell,
    case
      when usage.has_active_bom or usage.sold then true
      when usage.used_as_component and not usage.sold then false
      else true
    end
  ),
  primary_role = coalesce(
    i.primary_role,
    case
      when usage.has_active_bom then 'assembled_product'
      when usage.used_as_component and not usage.sold then 'raw_material'
      when usage.sold and usage.purchased then 'resale'
      when usage.sold then 'finished_good'
      else 'general'
    end
  )
from item_usage usage
where usage.id = i.id;

update public.items
set
  track_inventory = coalesce(track_inventory, true),
  can_buy = coalesce(can_buy, true),
  can_sell = coalesce(can_sell, true),
  is_assembled = coalesce(is_assembled, false),
  primary_role = coalesce(primary_role, 'general');

alter table public.items
  alter column primary_role set default 'general',
  alter column primary_role set not null,
  alter column track_inventory set default true,
  alter column track_inventory set not null,
  alter column can_buy set default true,
  alter column can_buy set not null,
  alter column can_sell set default true,
  alter column can_sell set not null,
  alter column is_assembled set default false,
  alter column is_assembled set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.items'::regclass
      and conname = 'items_primary_role_check'
  ) then
    alter table public.items
      add constraint items_primary_role_check
      check (
        primary_role = any (
          array[
            'general'::text,
            'resale'::text,
            'raw_material'::text,
            'finished_good'::text,
            'assembled_product'::text,
            'service'::text
          ]
        )
      );
  end if;
end $$;

create or replace view public.items_view
with (security_invoker = true) as
with stock_totals as (
  select
    sl.company_id,
    sl.item_id,
    coalesce(sum(coalesce(sl.qty, 0)), 0)::numeric as on_hand_qty,
    coalesce(sum(coalesce(sl.qty, 0) - coalesce(sl.allocated_qty, 0)), 0)::numeric as available_qty
  from public.stock_levels sl
  group by sl.company_id, sl.item_id
),
item_usage as (
  select
    i.id,
    exists(
      select 1
      from public.boms b
      where b.product_id = i.id
        and coalesce(b.is_active, false) = true
    ) as has_active_bom,
    exists(
      select 1
      from public.bom_components bc
      where bc.component_item_id = i.id
    ) as used_as_component
  from public.items i
)
select
  i.id,
  i.sku,
  i.name,
  i.base_uom_id as "baseUomId",
  i.unit_price as "unitPrice",
  i.min_stock as "minStock",
  i.created_at as "createdAt",
  i.updated_at as "updatedAt",
  i.primary_role as "primaryRole",
  i.track_inventory as "trackInventory",
  i.can_buy as "canBuy",
  i.can_sell as "canSell",
  i.is_assembled as "isAssembled",
  coalesce(stock.on_hand_qty, 0)::numeric as "onHandQty",
  coalesce(stock.available_qty, 0)::numeric as "availableQty",
  usage.has_active_bom as "hasActiveBom",
  usage.used_as_component as "usedAsComponent"
from public.items i
left join stock_totals stock
  on stock.company_id = i.company_id
 and stock.item_id = i.id
left join item_usage usage
  on usage.id = i.id
where i.company_id = public.current_company_id();

revoke all on public.items_view from public, anon;
grant select on public.items_view to authenticated;

comment on view public.items_view is
  'Operational item profile read model for Phase 3B. Combines stock-facing identity, lightweight classification flags, and live stock totals for safer item setup and assembly planning UX.';
