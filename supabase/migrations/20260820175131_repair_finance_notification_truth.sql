-- POST-QA REPAIR: finance references and notification truth
--
-- This forward-only repair keeps the existing posting authorities intact. It:
--   * removes the redundant, unguarded purchase-order status trigger;
--   * suppresses the transient sales-order notification inside the governed
--     atomic POS operation;
--   * synchronizes genuine shipped/unpaid sales-order alerts from the
--     canonical sales-order state, resolving rather than deleting history;
--   * aligns receivables alert navigation with the canonical AR exposure view.

drop trigger if exists trg_po_status_notify on public.purchase_orders;

create or replace function public.stockwise_sync_sales_order_awaiting_notification(
  p_company_id uuid,
  p_sales_order_id uuid
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_order record;
  v_is_awaiting boolean:=false;
  v_dedup_prefix text;
  v_action_url text;
  v_title text:='Awaiting approval: Sales Order';
  v_body text;
begin
  if p_company_id is null or p_sales_order_id is null then
    return;
  end if;

  select
    so.order_no,
    state.legacy_status,
    state.financial_anchor,
    coalesce(state.legacy_outstanding_base,0::numeric) outstanding_base
  into v_order
  from public.sales_orders so
  join public.v_sales_order_state state
    on state.id=so.id
   and state.company_id=so.company_id
  where so.company_id=p_company_id
    and so.id=p_sales_order_id;

  if not found then
    return;
  end if;

  v_is_awaiting:=
    v_order.legacy_status='shipped'
    and v_order.financial_anchor='legacy_order_link'
    and v_order.outstanding_base>0.005;
  v_dedup_prefix:='sales-order-awaiting:'||p_sales_order_id::text;
  v_action_url:=format(
    '/orders?tab=sales&orderId=%s',
    p_sales_order_id
  );
  v_body:=format(
    'SO %s • Due %s',
    coalesce(v_order.order_no,left(p_sales_order_id::text,8)),
    v_order.outstanding_base
  );

  if v_is_awaiting then
    perform public.stockwise_notify_company_roles(
      p_company_id,
      array['OWNER','ADMIN','MANAGER']::public.member_role[],
      'orders.sales.awaiting_approval',
      'approvals',
      jsonb_build_object(
        'salesOrderId',p_sales_order_id,
        'orderReference',coalesce(v_order.order_no,left(p_sales_order_id::text,8)),
        'outstandingAmountBase',v_order.outstanding_base
      ),
      v_dedup_prefix,
      'warning',
      v_action_url,
      v_title,
      v_body,
      null
    );
  else
    update public.notifications n
       set resolved_at=coalesce(n.resolved_at,now())
     where n.company_id=p_company_id
       and n.event_type='orders.sales.awaiting_approval'
       and n.deduplication_key like v_dedup_prefix||':%'
       and n.resolved_at is null;

    -- Preserve but resolve matching legacy company-wide evidence produced
    -- before the structured event contract existed.
    update public.notifications n
       set resolved_at=coalesce(n.resolved_at,now())
     where n.company_id=p_company_id
       and n.user_id is null
       and n.title=v_title
       and n.body=v_body
       and n.resolved_at is null;
  end if;
end
$$;

alter function public.stockwise_sync_sales_order_awaiting_notification(uuid,uuid) owner to postgres;
revoke all on function public.stockwise_sync_sales_order_awaiting_notification(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.stockwise_sync_sales_order_awaiting_notification(uuid,uuid)
  to service_role;

create or replace function public.tg_so_awaiting_notify()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  -- The governed POS RPC sets this transaction-local context before it creates
  -- the shipped order and posts the matching cash/bank settlement. The order
  -- is never independently awaiting payment, so no transient alert is emitted.
  if coalesce(current_setting('stockwise.commercial_tax_operator_sale',true),'')='on' then
    return new;
  end if;

  perform public.stockwise_sync_sales_order_awaiting_notification(
    new.company_id,
    new.id
  );
  return new;
end
$$;

alter function public.tg_so_awaiting_notify() owner to postgres;
revoke all on function public.tg_so_awaiting_notify() from public,anon,authenticated;

create or replace function public.tg_sync_sales_order_awaiting_from_settlement()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_company_id uuid;
  v_ref_type text;
  v_ref_id uuid;
  v_bank_id uuid;
begin
  if tg_op='DELETE' then
    v_ref_type:=old.ref_type;
    v_ref_id:=old.ref_id;
    if tg_table_name='bank_transactions' then
      v_bank_id:=old.bank_id;
    else
      v_company_id:=old.company_id;
    end if;
  else
    v_ref_type:=new.ref_type;
    v_ref_id:=new.ref_id;
    if tg_table_name='bank_transactions' then
      v_bank_id:=new.bank_id;
    else
      v_company_id:=new.company_id;
    end if;
  end if;

  if v_ref_type is distinct from 'SO' or v_ref_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name='bank_transactions' then
    select b.company_id into v_company_id
    from public.bank_accounts b
    where b.id=v_bank_id;
  end if;

  perform public.stockwise_sync_sales_order_awaiting_notification(
    v_company_id,
    v_ref_id
  );
  if tg_op='DELETE' then return old; else return new; end if;
end
$$;

alter function public.tg_sync_sales_order_awaiting_from_settlement() owner to postgres;
revoke all on function public.tg_sync_sales_order_awaiting_from_settlement()
  from public,anon,authenticated;

drop trigger if exists stockwise_so_settlement_notification_sync_cash
  on public.cash_transactions;
create trigger stockwise_so_settlement_notification_sync_cash
after insert or update or delete on public.cash_transactions
for each row
execute function public.tg_sync_sales_order_awaiting_from_settlement();

drop trigger if exists stockwise_so_settlement_notification_sync_bank
  on public.bank_transactions;
create trigger stockwise_so_settlement_notification_sync_bank
after insert or update or delete on public.bank_transactions
for each row
execute function public.tg_sync_sales_order_awaiting_from_settlement();

create or replace function public.tg_align_receivables_alert_destination()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
declare
  v_customer_id uuid;
  v_destination text;
begin
  if new.event_type not like 'receivables.%' then
    return new;
  end if;

  begin
    v_customer_id:=(new.payload->>'customerId')::uuid;
  exception when invalid_text_representation then
    return new;
  end;
  if v_customer_id is null then
    return new;
  end if;

  v_destination:=format(
    '/settlements?view=exposure&side=ar&customerId=%s&companyId=%s',
    v_customer_id,
    new.company_id
  );
  new.action_url:=v_destination;
  new.url:=v_destination;
  new.payload:=coalesce(new.payload,'{}'::jsonb)
    || jsonb_build_object('arContext','customer-exposure');
  new.meta:=coalesce(new.meta,'{}'::jsonb)
    || jsonb_build_object('arContext','customer-exposure');
  return new;
end
$$;

alter function public.tg_align_receivables_alert_destination() owner to postgres;
revoke all on function public.tg_align_receivables_alert_destination()
  from public,anon,authenticated;

drop trigger if exists align_receivables_alert_destination on public.notifications;
create trigger align_receivables_alert_destination
before insert or update of event_type,payload,action_url,url
on public.notifications
for each row
execute function public.tg_align_receivables_alert_destination();

update public.notifications n
set
  action_url=format(
    '/settlements?view=exposure&side=ar&customerId=%s&companyId=%s',
    n.payload->>'customerId',n.company_id
  ),
  url=format(
    '/settlements?view=exposure&side=ar&customerId=%s&companyId=%s',
    n.payload->>'customerId',n.company_id
  ),
  payload=coalesce(n.payload,'{}'::jsonb)
    || jsonb_build_object('arContext','customer-exposure'),
  meta=coalesce(n.meta,'{}'::jsonb)
    || jsonb_build_object('arContext','customer-exposure')
where n.event_type like 'receivables.%'
  and nullif(n.payload->>'customerId','') is not null;

-- Resolve only legacy SO alerts whose canonical order state is no longer
-- genuinely shipped and outstanding. Historical rows remain queryable.
update public.notifications n
set resolved_at=coalesce(n.resolved_at,now())
from public.sales_orders so
join public.v_sales_order_state state
  on state.id=so.id
 and state.company_id=so.company_id
where n.company_id=so.company_id
  and n.user_id is null
  and n.title='Awaiting approval: Sales Order'
  and n.body like format(
    'SO %s •%%',
    coalesce(so.order_no,left(so.id::text,8))
  )
  and n.resolved_at is null
  and not (
    state.legacy_status='shipped'
    and state.financial_anchor='legacy_order_link'
    and state.legacy_outstanding_base>0.005
  );
