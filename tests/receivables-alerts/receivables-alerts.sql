\set ON_ERROR_STOP on

begin;

-- The fixture exercises alert presentation contracts, not fiscal issuance.
-- Replica mode prevents unrelated document-posting triggers from fabricating
-- operational evidence while the rollback-only fixture establishes the final
-- Package A receivables view inputs.
set local session_replication_role = replica;

insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('c1000000-0000-4000-8000-000000000001','authenticated','authenticated','alerts-owner@stockwise.local','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000002','authenticated','authenticated','alerts-manager@stockwise.local','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000003','authenticated','authenticated','alerts-operator@stockwise.local','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000004','authenticated','authenticated','alerts-off@stockwise.local','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000005','authenticated','authenticated','alerts-other@stockwise.local','',now(),'{}','{}',now(),now());

insert into public.companies(id,name,owner_user_id) values
  ('c2000000-0000-4000-8000-000000000001','Receivables Alerts Local QA','c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002','Receivables Alerts Isolation QA','c1000000-0000-4000-8000-000000000005');

insert into public.company_currencies(company_id,currency_code) values
  ('c2000000-0000-4000-8000-000000000001','MZN'),
  ('c2000000-0000-4000-8000-000000000002','USD')
on conflict do nothing;

insert into public.company_settings(company_id,base_currency_code,data) values
  ('c2000000-0000-4000-8000-000000000001','MZN',
   '{"dueReminders":{"internalAlertsEnabled":true,"timezone":"Africa/Maputo","sendAt":"09:00","leadDays":[-3]}}'),
  ('c2000000-0000-4000-8000-000000000002','USD',
   '{"dueReminders":{"internalAlertsEnabled":false,"timezone":"Africa/Maputo","sendAt":"09:00","leadDays":[-3]}}');

insert into public.company_subscription_state(
  company_id,plan_code,subscription_status,paid_until
) values
  ('c2000000-0000-4000-8000-000000000001','starter','active_paid',now() + interval '1 day'),
  ('c2000000-0000-4000-8000-000000000002','starter','active_paid',now() + interval '1 day');

insert into public.company_members(company_id,user_id,email,role,status) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','alerts-owner@stockwise.local','OWNER','active'),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','alerts-manager@stockwise.local','MANAGER','active'),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','alerts-operator@stockwise.local','OPERATOR','active'),
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','alerts-off@stockwise.local','ADMIN','active'),
  ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000005','alerts-other@stockwise.local','OWNER','active');

insert into public.user_active_company(user_id,company_id) values
  ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000002');

insert into public.notification_preferences(company_id,user_id,category,in_app_mode,email_mode) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000004','receivables','off','off');

insert into public.customers(id,company_id,code,name,currency_code) values
  ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','ALERT-CUSTOMER','Alert Customer','MZN'),
  ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','OTHER-CUSTOMER','Other Company Customer','USD');

insert into public.suppliers(id,company_id,code,name,currency_code) values
  ('c3500000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','ALERT-SUPPLIER','Alert Supplier','MZN');

insert into public.sales_orders(
  id,customer_id,order_date,currency_code,status,subtotal,tax_total,total,
  fx_to_base,total_amount,company_id
) values (
  'c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
  '2026-08-01','MZN','draft',100,0,100,1,100,'c2000000-0000-4000-8000-000000000001'
);

insert into public.purchase_orders(
  id,supplier_id,order_date,currency_code,status,subtotal,tax_total,total,
  fx_to_base,total_amount,company_id
) values (
  'c4100000-0000-4000-8000-000000000001','c3500000-0000-4000-8000-000000000001',
  '2026-08-01','MZN','draft',100,0,100,1,100,'c2000000-0000-4000-8000-000000000001'
);

insert into public.sales_invoices(
  id,company_id,customer_id,internal_reference,invoice_date,due_date,
  currency_code,fx_to_base,subtotal,tax_total,total_amount,
  document_workflow_status,issued_at,source_origin,approval_status,
  subtotal_mzn,tax_total_mzn,total_amount_mzn
) values
  ('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','ALERT-SI-001','2026-07-01','2026-08-08','MZN',1,1000,0,1000,'issued',now(),'imported','approved',1000,0,1000),
  ('c5000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','ALERT-SI-002','2026-07-01','2026-08-08','MZN',1,500,0,500,'issued',now(),'imported','approved',500,0,500),
  ('c5000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002','ALERT-SI-USD','2026-07-01','2026-08-08','USD',1,700,0,700,'issued',now(),'imported','approved',700,0,700);

-- One MZN receipt allocates 200 and keeps 250 as separate unapplied context.
insert into public.customer_receipts(
  id,company_id,customer_id,receipt_reference,received_on,
  amount_received_base,currency_code,payment_channel,
  financial_transaction_id,posting_request_id,created_by
) values (
  'c6000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001','CR-ALERT-001','2026-08-01',
  450,'MZN','cash','c6100000-0000-4000-8000-000000000001',
  'c6200000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001'
);
insert into public.customer_receipt_allocations(
  id,company_id,customer_receipt_id,sales_invoice_id,allocation_kind,
  amount_base,request_key,posting_request_id,created_by
) values (
  'c6300000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',
  'allocation',200,'alerts-initial-allocation','c6200000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001'
);

set local session_replication_role = origin;

do $$
declare v_result jsonb;
begin
  v_result:=public.evaluate_receivable_internal_alerts(
    'c2000000-0000-4000-8000-000000000001','2026-08-11','Africa/Maputo',array[-3]
  );
  if (v_result->>'groups')::integer<>1 then raise exception 'expected one customer/currency/bucket group: %',v_result; end if;

  if (select count(*) from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and event_type='receivables.overdue' and resolved_at is null)<>2 then
    raise exception 'owner and manager targeted alert count mismatch';
  end if;
  if exists(select 1 from public.notifications where user_id in (
    'c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000004'
  ) and event_type like 'receivables.%') then
    raise exception 'operator or opted-out recipient received alert';
  end if;
  if exists(select 1 from public.notifications where company_id='c2000000-0000-4000-8000-000000000002') then
    raise exception 'cross-company notification leakage';
  end if;
  if not exists(
    select 1 from public.notifications
    where company_id='c2000000-0000-4000-8000-000000000001'
      and event_type='receivables.overdue'
      and (payload->>'documentCount')::integer=2
      and (payload->>'outstandingAmount')::numeric=1300
      and (payload->>'unallocatedCustomerCredit')::numeric=250
      and payload->>'currencyCode'='MZN'
  ) then raise exception 'aggregate outstanding or unapplied-credit context mismatch'; end if;
end $$;

-- Normal users retain read/dismiss updates, but cannot rewrite alert content.
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

update public.notifications
set read_at=now(),dismissed_at=now()
where company_id='c2000000-0000-4000-8000-000000000001'
  and user_id='c1000000-0000-4000-8000-000000000001'
  and event_type='receivables.overdue';

do $$
begin
  begin
    update public.notifications set title='Forged' where company_id='c2000000-0000-4000-8000-000000000001'
      and user_id='c1000000-0000-4000-8000-000000000001' and event_type='receivables.overdue';
    raise exception 'notification content rewrite was accepted';
  exception when others then
    if sqlerrm not like 'Only read_at and dismissed_at%' then raise; end if;
  end;
  begin
    insert into public.notifications(company_id,user_id,title)
    values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Forged');
    raise exception 'direct notification INSERT was accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.notifications where company_id='c2000000-0000-4000-8000-000000000001';
    raise exception 'direct notification DELETE was accepted';
  exception when insufficient_privilege then null; end;
  begin
    execute 'truncate table public.notifications';
    raise exception 'direct notification TRUNCATE was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.emit_cash_approval_notif(
      'c2000000-0000-4000-8000-000000000001','Forged','Forged','/notifications','warning'
    );
    raise exception 'direct internal emitter call was accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.notification_preferences(company_id,user_id,category,in_app_mode,email_mode)
    values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','payables','off','off');
    raise exception 'another user preference INSERT was accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS notification forgery and emitter calls denied';
end $$;

reset role;

-- A retry must preserve per-user read/dismiss state rather than resurfacing it.
do $$
begin
  perform public.evaluate_receivable_internal_alerts(
    'c2000000-0000-4000-8000-000000000001','2026-08-11','Africa/Maputo',array[-3]
  );
  if (select count(*) from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and event_type='receivables.overdue' and resolved_at is null)<>2 then
    raise exception 'repeated evaluation duplicated alerts';
  end if;
  if not exists(select 1 from public.notifications where user_id='c1000000-0000-4000-8000-000000000001'
      and event_type='receivables.overdue' and read_at is not null and dismissed_at is not null) then
    raise exception 'repeated evaluation reset read/dismiss state';
  end if;

  perform public.evaluate_receivable_internal_alerts(
    'c2000000-0000-4000-8000-000000000002','2026-08-11','Africa/Maputo',array[-3]
  );
  if not exists(select 1 from public.notifications where company_id='c2000000-0000-4000-8000-000000000002'
      and user_id='c1000000-0000-4000-8000-000000000005'
      and payload->>'currencyCode'='USD' and (payload->>'outstandingAmount')::numeric=700) then
    raise exception 'separate company/currency alert missing';
  end if;

end $$;

-- A malformed company offset value falls back independently and cannot abort
-- evaluation of the other enabled company.
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000005',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated"}',
  true
);
update public.company_settings
set data=jsonb_set(
  jsonb_set(data,'{dueReminders,internalAlertsEnabled}','true'::jsonb,true),
  '{dueReminders,leadDays}','{"malformed":true}'::jsonb,true
)
where company_id='c2000000-0000-4000-8000-000000000002';
reset role;

do $$
declare v_result jsonb;
begin
  v_result:=public.run_receivable_internal_alert_scheduler('2026-08-11 07:00:00+00');
  if (v_result->>'evaluatedCompanies')::integer<>2
     or (v_result->>'skippedCompanies')::integer<>0 then
    raise exception 'one malformed company blocked scheduler peers: %',v_result;
  end if;
  if not exists(
    select 1 from jsonb_array_elements(v_result->'results') entry
    where entry->>'companyId'='c2000000-0000-4000-8000-000000000002'
      and (entry->>'scheduleOffsetsDefaulted')::boolean
  ) then raise exception 'malformed offsets were not reported as defaulted: %',v_result; end if;
end $$;

-- A partial allocation on a non-stage day refreshes the active alert in place.
set local session_replication_role = replica;
insert into public.customer_receipt_allocations(
  id,company_id,customer_receipt_id,sales_invoice_id,allocation_kind,
  amount_base,request_key,posting_request_id,created_by
) values (
  'c6300000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',
  'allocation',100,'alerts-partial-allocation','c6200000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001'
);
set local session_replication_role = origin;

do $$
declare v_result jsonb;
begin
  v_result:=public.evaluate_receivable_internal_alerts(
    'c2000000-0000-4000-8000-000000000001','2026-08-12','Africa/Maputo',array[-3]
  );
  if (v_result->>'groups')::integer<>0 or (v_result->>'notificationsRefreshed')::integer<>2 then
    raise exception 'non-stage refresh contract failed: %',v_result;
  end if;
  if (select count(*) from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and deduplication_key like 'receivables-due:%' and resolved_at is null)<>2 then
    raise exception 'partial allocation created a daily duplicate';
  end if;
  if not exists(select 1 from public.notifications
    where company_id='c2000000-0000-4000-8000-000000000001'
      and user_id='c1000000-0000-4000-8000-000000000001'
      and (payload->>'outstandingAmount')::numeric=1200
      and (payload->>'unallocatedCustomerCredit')::numeric=150
      and (payload->>'bucketOffsetDays')::integer=-4
      and read_at is not null and dismissed_at is not null
  ) then raise exception 'partial allocation payload refresh or lifecycle preservation failed'; end if;
end $$;

-- Leave only the approval notification triggers active for continuity checks.
alter table public.purchase_orders disable trigger user;
alter table public.purchase_orders enable trigger po_awaiting_notify_trg;
alter table public.sales_orders disable trigger user;
alter table public.sales_orders enable trigger so_awaiting_notify_trg;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
update public.purchase_orders set status='closed'
where id='c4100000-0000-4000-8000-000000000001';
update public.sales_orders set status='shipped'
where id='c4000000-0000-4000-8000-000000000001';
reset role;

do $$
begin
  if not exists(select 1 from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and title='Awaiting approval: Purchase Order' and user_id is null) then
    raise exception 'purchase approval notification trigger broke';
  end if;
  if not exists(select 1 from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and title='Awaiting approval: Sales Order' and user_id is null) then
    raise exception 'sales approval notification trigger broke';
  end if;
  raise notice 'PASS PO and SO approval notification continuity';
end $$;

-- Authoritative settlement evidence clears the alert without deleting history.
set local session_replication_role = replica;
insert into public.customer_receipts(
  id,company_id,customer_id,receipt_reference,received_on,
  amount_received_base,currency_code,payment_channel,
  financial_transaction_id,posting_request_id,created_by
) values (
  'c6000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001','CR-ALERT-002','2026-08-11',
  1200,'MZN','cash','c6100000-0000-4000-8000-000000000002',
  'c6200000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001'
);
insert into public.customer_receipt_allocations(
  id,company_id,customer_receipt_id,sales_invoice_id,allocation_kind,
  amount_base,request_key,posting_request_id,created_by
) values
  ('c6300000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000001','allocation',700,'alerts-final-allocation-1','c6200000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001'),
  ('c6300000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002','allocation',500,'alerts-final-allocation-2','c6200000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001');
set local session_replication_role = origin;

do $$
begin
  perform public.evaluate_receivable_internal_alerts(
    'c2000000-0000-4000-8000-000000000001','2026-08-11','Africa/Maputo',array[-3]
  );
  if exists(select 1 from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and event_type='receivables.overdue' and resolved_at is null) then
    raise exception 'settled receivable alert remained active';
  end if;
  if (select count(*) from public.notifications where company_id='c2000000-0000-4000-8000-000000000001'
      and event_type='receivables.overdue' and resolved_at is not null)<>2 then
    raise exception 'resolved alert history was not preserved';
  end if;
  raise notice 'PASS aggregate, currency, preference, dedupe and resolution';
end $$;

rollback;
