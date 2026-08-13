\set ON_ERROR_STOP on

begin;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a1111111-1111-4111-8111-111111111111','authenticated','authenticated','receipt-owner@stockwise.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('a1111111-1111-4111-8111-111111111112','authenticated','authenticated','receipt-viewer@stockwise.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('a1111111-1111-4111-8111-111111111113','authenticated','authenticated','receipt-attacker@stockwise.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.companies(id,name,owner_user_id) values
  ('a2222222-2222-4222-8222-222222222221','Multi receipt local QA','a1111111-1111-4111-8111-111111111111'),
  ('a2222222-2222-4222-8222-222222222222','Multi receipt cross-company QA',null);

insert into public.company_currencies(company_id,currency_code) values
  ('a2222222-2222-4222-8222-222222222221','MZN'),
  ('a2222222-2222-4222-8222-222222222222','MZN')
on conflict do nothing;

insert into public.company_settings(company_id,base_currency_code,data)
values
  ('a2222222-2222-4222-8222-222222222221','MZN','{}'),
  ('a2222222-2222-4222-8222-222222222222','MZN','{}')
on conflict(company_id) do update set base_currency_code=excluded.base_currency_code;

insert into public.company_subscription_state(company_id,plan_code,subscription_status,paid_until)
values
  ('a2222222-2222-4222-8222-222222222221','starter','active_paid',now()+interval '1 day'),
  ('a2222222-2222-4222-8222-222222222222','starter','active_paid',now()+interval '1 day')
on conflict(company_id) do update set subscription_status=excluded.subscription_status,paid_until=excluded.paid_until;

insert into public.company_members(company_id,user_id,email,role,status) values
  ('a2222222-2222-4222-8222-222222222221','a1111111-1111-4111-8111-111111111111','receipt-owner@stockwise.local','OWNER','active'),
  ('a2222222-2222-4222-8222-222222222221','a1111111-1111-4111-8111-111111111112','receipt-viewer@stockwise.local','VIEWER','active')
on conflict(company_id,email) do update set user_id=excluded.user_id,role=excluded.role,status=excluded.status;

insert into public.user_active_company(user_id,company_id) values
  ('a1111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222221'),
  ('a1111111-1111-4111-8111-111111111112','a2222222-2222-4222-8222-222222222221')
on conflict(user_id) do update set company_id=excluded.company_id;

insert into public.customers(id,company_id,code,name,currency_code) values
  ('a3333333-3333-4333-8333-333333333331','a2222222-2222-4222-8222-222222222221','RCT-A','Receipt Customer A','MZN'),
  ('a3333333-3333-4333-8333-333333333332','a2222222-2222-4222-8222-222222222221','RCT-B','Receipt Customer B','MZN'),
  ('a3333333-3333-4333-8333-333333333333','a2222222-2222-4222-8222-222222222222','RCT-X','Cross-company Customer','MZN');

insert into public.bank_accounts(id,company_id,name,bank_name,currency_code) values
  ('a4444444-4444-4444-8444-444444444441','a2222222-2222-4222-8222-222222222221','Receipt QA Bank','QA Bank','MZN'),
  ('a4444444-4444-4444-8444-444444444442','a2222222-2222-4222-8222-222222222222','Cross-company Bank','QA Bank','MZN');

-- This rollback-only fixture exercises receipt posting, not the separate fiscal
-- issue workflow. Replica mode establishes truthful issued-invoice inputs
-- without creating unrelated fiscal/document evidence.
set local session_replication_role = replica;

insert into public.sales_invoices(
  id,company_id,customer_id,internal_reference,invoice_date,due_date,currency_code,fx_to_base,
  subtotal,tax_total,total_amount,document_workflow_status,issued_at,created_by,
  source_origin,approval_status,subtotal_mzn,tax_total_mzn,total_amount_mzn
) values
  ('a5555555-5555-4555-8555-555555555551','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331','INV-RCT-A','2026-08-01','2026-08-08','MZN',1,10000,0,10000,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',10000,0,10000),
  ('a5555555-5555-4555-8555-555555555552','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331','INV-RCT-B','2026-08-02','2026-08-09','MZN',1,8000,0,8000,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',8000,0,8000),
  ('a5555555-5555-4555-8555-555555555553','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331','INV-RCT-C','2026-08-03','2026-08-10','MZN',1,7000,0,7000,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',7000,0,7000),
  ('a5555555-5555-4555-8555-555555555554','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331','INV-RCT-LATER','2026-08-04','2026-08-11','MZN',1,10000,0,10000,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',10000,0,10000),
  ('a5555555-5555-4555-8555-555555555555','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333332','INV-RCT-OTHER-CUSTOMER','2026-08-05','2026-08-12','MZN',1,5000,0,5000,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',5000,0,5000),
  ('a5555555-5555-4555-8555-555555555556','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331','INV-RCT-USD','2026-08-06','2026-08-13','USD',65,100,0,100,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',6500,0,6500),
  ('a5555555-5555-4555-8555-555555555557','a2222222-2222-4222-8222-222222222222','a3333333-3333-4333-8333-333333333333','INV-RCT-CROSS','2026-08-06','2026-08-13','MZN',1,5000,0,5000,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',5000,0,5000),
  ('a5555555-5555-4555-8555-555555555558','a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331','INV-RCT-ONE','2026-08-07','2026-08-14','MZN',1,500,0,500,'issued',now(),'a1111111-1111-4111-8111-111111111111','imported','approved',500,0,500);

set local session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);

do $$
declare
  v_result jsonb; v_receipt_three uuid; v_receipt_one uuid; v_receipt_credit uuid; v_later_allocation uuid;
  v_count integer; v_before integer; v_state record;
begin
  v_result:=public.post_customer_receipt(
    'a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
    '2026-08-11',25000,'MZN','bank','a4444444-4444-4444-8444-444444444441',
    'BANK-RCT-THREE','Three invoice receipt',
    jsonb_build_array(
      jsonb_build_object('sales_invoice_id','a5555555-5555-4555-8555-555555555551','amount_base',10000),
      jsonb_build_object('sales_invoice_id','a5555555-5555-4555-8555-555555555552','amount_base',8000),
      jsonb_build_object('sales_invoice_id','a5555555-5555-4555-8555-555555555553','amount_base',7000)
    ),'receipt-three-invoices'
  );
  v_receipt_three:=(v_result#>>'{receipt,id}')::uuid;
  if (v_result->>'transaction_count')::integer<>1 then raise exception 'receipt transaction count mismatch'; end if;
  select count(*) into v_count from public.bank_transactions where ref_type='CR' and ref_id=v_receipt_three;
  if v_count<>1 then raise exception 'one receipt created % bank transactions',v_count; end if;
  select * into strict v_state from public.v_customer_receipt_state where id=v_receipt_three;
  if v_state.allocated_base<>25000 or v_state.unallocated_base<>0 then raise exception 'three-allocation state mismatch'; end if;
  if exists(select 1 from public.v_sales_invoice_state where id in(
    'a5555555-5555-4555-8555-555555555551','a5555555-5555-4555-8555-555555555552','a5555555-5555-4555-8555-555555555553'
  ) and outstanding_base<>0) then raise exception 'invoice outstanding not cleared'; end if;
  select * into strict v_state from public.v_sales_invoice_state
    where id='a5555555-5555-4555-8555-555555555551';
  if v_state.bank_received_base<>10000 or v_state.cash_received_base<>0
     or v_state.receipt_allocated_base<>10000 or v_state.legacy_direct_settled_base<>0 then
    raise exception 'receipt allocation channel evidence mismatch';
  end if;
  raise notice 'PASS receipt allocation channel evidence is coherent without double-counting';
  raise notice 'PASS one receipt -> three invoices -> one financial transaction';

  v_result:=public.post_customer_receipt(
    'a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
    '2026-08-11',500,'MZN','bank','a4444444-4444-4444-8444-444444444441',
    'BANK-RCT-ONE','One invoice receipt',
    jsonb_build_array(
      jsonb_build_object('sales_invoice_id','a5555555-5555-4555-8555-555555555558','amount_base',500)
    ),'receipt-one-invoice'
  );
  v_receipt_one:=(v_result#>>'{receipt,id}')::uuid;
  if (v_result->>'transaction_count')::integer<>1 then raise exception 'one-invoice receipt transaction count mismatch'; end if;
  if (select count(*) from public.bank_transactions where ref_type='CR' and ref_id=v_receipt_one)<>1 then
    raise exception 'one-invoice receipt did not create exactly one transaction';
  end if;
  if (select outstanding_base from public.v_sales_invoice_state where id='a5555555-5555-4555-8555-555555555558')<>0 then
    raise exception 'one-invoice receipt did not settle invoice';
  end if;
  raise notice 'PASS one receipt -> one invoice -> one financial transaction';

  v_result:=public.post_customer_receipt(
    'a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
    '2026-08-11',25000,'MZN','cash',null,'CASH-RCT-CREDIT','Unapplied credit','[]','receipt-unallocated'
  );
  v_receipt_credit:=(v_result#>>'{receipt,id}')::uuid;
  select * into strict v_state from public.v_customer_receipt_state where id=v_receipt_credit;
  if v_state.allocated_base<>0 or v_state.unallocated_base<>25000 then raise exception 'unallocated receipt state mismatch'; end if;
  select count(*) into v_before from public.cash_transactions where ref_type='CR' and ref_id=v_receipt_credit;
  if v_before<>1 then raise exception 'unallocated receipt financial transaction mismatch'; end if;
  raise notice 'PASS 25000 receipt -> zero allocations -> 25000 unallocated';

  v_result:=public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555554',5000,'later-allocation-one');
  v_later_allocation:=(v_result#>>'{allocation,id}')::uuid;
  perform public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555554',2500,'later-allocation-two');
  select count(*) into v_count from public.cash_transactions where ref_type='CR' and ref_id=v_receipt_credit;
  if v_count<>v_before then raise exception 'later allocations created a financial transaction'; end if;
  select * into strict v_state from public.v_customer_receipt_state where id=v_receipt_credit;
  if v_state.allocated_base<>7500 or v_state.unallocated_base<>17500 then raise exception 'later allocation state mismatch'; end if;
  select * into strict v_state from public.v_sales_invoice_state
    where id='a5555555-5555-4555-8555-555555555554';
  if v_state.cash_received_base<>7500 or v_state.bank_received_base<>0
     or v_state.settled_base<>7500 or v_state.receipt_allocated_base<>7500 then
    raise exception 'later cash allocation channel evidence mismatch';
  end if;
  raise notice 'PASS existing credit -> later allocations -> no new financial transaction';

  v_result:=public.reverse_customer_receipt_allocation(v_later_allocation,'QA correction','reverse-later-allocation-one');
  select * into strict v_state from public.v_customer_receipt_state where id=v_receipt_credit;
  if v_state.allocated_base<>2500 or v_state.unallocated_base<>22500 then raise exception 'allocation reversal state mismatch'; end if;
  if (select outstanding_base from public.v_sales_invoice_state where id='a5555555-5555-4555-8555-555555555554')<>7500 then
    raise exception 'allocation reversal did not restore invoice outstanding';
  end if;
  raise notice 'PASS append-only allocation reversal';

  v_result:=public.post_customer_receipt(
    'a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
    '2026-08-11',25000,'MZN','cash',null,'CASH-RCT-CREDIT','Unapplied credit','[]','receipt-unallocated'
  );
  if not coalesce((v_result->>'replayed')::boolean,false) then raise exception 'receipt idempotent replay not returned'; end if;
  if (select count(*) from public.customer_receipts where company_id='a2222222-2222-4222-8222-222222222221')<>3 then
    raise exception 'receipt replay duplicated receipt';
  end if;
  raise notice 'PASS receipt idempotency';

  v_result:=public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555554',2500,'later-allocation-two');
  if not coalesce((v_result->>'replayed')::boolean,false) then raise exception 'allocation idempotent replay not returned'; end if;
  raise notice 'PASS allocation idempotency';

  begin
    perform public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555555',100,'wrong-customer');
    raise exception 'wrong customer allocation accepted';
  exception when others then if sqlerrm not like '%receipt_customer_mismatch%' then raise; end if; end;
  raise notice 'PASS wrong customer rejected';

  begin
    perform public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555557',100,'wrong-company-invoice');
    raise exception 'cross-company invoice allocation accepted';
  exception when others then if sqlerrm not like '%receipt_invoice_not_found%' then raise; end if; end;
  begin
    perform public.post_customer_receipt('a2222222-2222-4222-8222-222222222222','a3333333-3333-4333-8333-333333333333',
      '2026-08-11',100,'MZN','cash',null,null,null,'[]','wrong-company-receipt');
    raise exception 'cross-company receipt accepted';
  exception when others then if sqlerrm not like '%cross_company_access_denied%' then raise; end if; end;
  raise notice 'PASS wrong company rejected';

  begin
    perform public.post_customer_receipt('a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
      '2026-08-11',100,'USD','cash',null,null,null,'[]','foreign-receipt');
    raise exception 'foreign receipt accepted';
  exception when others then if sqlerrm not like '%receipt_currency_must_equal_company_base%' then raise; end if; end;
  begin
    perform public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555556',100,'foreign-invoice');
    raise exception 'foreign invoice allocation accepted';
  exception when others then if sqlerrm not like '%receipt_invoice_currency_not_supported%' then raise; end if; end;
  raise notice 'PASS foreign currency rejected cleanly';

  begin
    perform public.post_customer_receipt('a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
      '2026-08-11',100,'MZN','cash',null,null,null,
      jsonb_build_array(jsonb_build_object('sales_invoice_id','a5555555-5555-4555-8555-555555555554','amount_base',100.01)),
      'receipt-overallocated');
    raise exception 'receipt over-allocation accepted';
  exception when others then if sqlerrm not like '%receipt_allocations_exceed_received%' then raise; end if; end;
  begin
    perform public.allocate_customer_receipt(v_receipt_credit,'a5555555-5555-4555-8555-555555555554',7500.01,'invoice-overallocated');
    raise exception 'invoice over-allocation accepted';
  exception when others then if sqlerrm not like '%receipt_allocation_exceeds_outstanding%' then raise; end if; end;
  raise notice 'PASS receipt and invoice over-allocation rejected';

  begin
    update public.customer_receipts set note='changed' where id=v_receipt_credit;
    raise exception 'direct receipt update accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.customer_receipt_allocations where customer_receipt_id=v_receipt_credit;
    raise exception 'direct allocation delete accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS direct mutation denied';
end
$$;

select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111112',true);
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111112","role":"authenticated"}',true);
do $$
begin
  begin
    perform public.post_customer_receipt(
      'a2222222-2222-4222-8222-222222222221','a3333333-3333-4333-8333-333333333331',
      '2026-08-11',100,'MZN','cash',null,null,null,'[]','viewer-denied'
    );
    raise exception 'viewer receipt posting accepted';
  exception when others then if sqlerrm not like '%insufficient_company_role%' then raise; end if; end;
  raise notice 'PASS finance authority enforced';
end
$$;

-- A JWT email is not membership authority when the company row is bound to a
-- different user id. This protects receipt/payment evidence from stale or
-- recycled membership email addresses.
select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111113',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1111111-1111-4111-8111-111111111113","role":"authenticated","email":"receipt-owner@stockwise.local"}',
  true
);
do $$
begin
  if exists(select 1 from public.customer_receipts) then
    raise exception 'stale membership email exposed customer receipts';
  end if;
  if exists(select 1 from public.customer_receipt_allocations) then
    raise exception 'stale membership email exposed receipt allocations';
  end if;
  raise notice 'PASS stale membership email denied receipt evidence';
end
$$;

rollback;
