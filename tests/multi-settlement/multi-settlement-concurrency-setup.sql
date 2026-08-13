\set ON_ERROR_STOP on

begin;

insert into auth.users(
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  'b1111111-1111-4111-8111-111111111111','authenticated','authenticated',
  'receipt-concurrency-owner@stockwise.local','',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now()
);

insert into public.companies(id,name,owner_user_id) values (
  'b2222222-2222-4222-8222-222222222221','Multi receipt concurrency QA',
  'b1111111-1111-4111-8111-111111111111'
);
insert into public.company_currencies(company_id,currency_code) values (
  'b2222222-2222-4222-8222-222222222221','MZN'
) on conflict do nothing;
insert into public.company_settings(company_id,base_currency_code,data) values (
  'b2222222-2222-4222-8222-222222222221','MZN','{}'
);
insert into public.company_subscription_state(company_id,plan_code,subscription_status,paid_until) values (
  'b2222222-2222-4222-8222-222222222221','starter','active_paid',now()+interval '1 day'
);
insert into public.company_members(company_id,user_id,email,role,status) values (
  'b2222222-2222-4222-8222-222222222221','b1111111-1111-4111-8111-111111111111',
  'receipt-concurrency-owner@stockwise.local','OWNER','active'
) on conflict(company_id,email) do update
  set user_id=excluded.user_id,role=excluded.role,status=excluded.status;
insert into public.user_active_company(user_id,company_id) values (
  'b1111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222221'
) on conflict(user_id) do update set company_id=excluded.company_id;
insert into public.customers(id,company_id,code,name,currency_code) values (
  'b3333333-3333-4333-8333-333333333331','b2222222-2222-4222-8222-222222222221',
  'RCT-CONC','Receipt Concurrency Customer','MZN'
);
insert into public.bank_accounts(id,company_id,name,bank_name,currency_code) values (
  'b4444444-4444-4444-8444-444444444441','b2222222-2222-4222-8222-222222222221',
  'Receipt Concurrency Bank','QA Bank','MZN'
);

set local session_replication_role=replica;
insert into public.sales_invoices(
  id,company_id,customer_id,internal_reference,invoice_date,due_date,currency_code,fx_to_base,
  subtotal,tax_total,total_amount,document_workflow_status,issued_at,created_by,
  source_origin,approval_status,subtotal_mzn,tax_total_mzn,total_amount_mzn
) values
  ('b5555555-5555-4555-8555-555555555551','b2222222-2222-4222-8222-222222222221','b3333333-3333-4333-8333-333333333331','INV-CONC-R1-A','2026-08-01','2026-08-08','MZN',1,5000,0,5000,'issued',now(),'b1111111-1111-4111-8111-111111111111','imported','approved',5000,0,5000),
  ('b5555555-5555-4555-8555-555555555552','b2222222-2222-4222-8222-222222222221','b3333333-3333-4333-8333-333333333331','INV-CONC-R1-B','2026-08-02','2026-08-09','MZN',1,5000,0,5000,'issued',now(),'b1111111-1111-4111-8111-111111111111','imported','approved',5000,0,5000),
  ('b5555555-5555-4555-8555-555555555553','b2222222-2222-4222-8222-222222222221','b3333333-3333-4333-8333-333333333331','INV-CONC-R2','2026-08-03','2026-08-10','MZN',1,5000,0,5000,'issued',now(),'b1111111-1111-4111-8111-111111111111','imported','approved',5000,0,5000);
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','b1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);

select public.post_customer_receipt(
  'b2222222-2222-4222-8222-222222222221','b3333333-3333-4333-8333-333333333331',
  '2026-08-11',5000,'MZN','bank','b4444444-4444-4444-8444-444444444441',
  'CONC-R1','Receipt-side concurrency fixture','[]','concurrency-receipt-one'
);
select public.post_customer_receipt(
  'b2222222-2222-4222-8222-222222222221','b3333333-3333-4333-8333-333333333331',
  '2026-08-11',5000,'MZN','bank','b4444444-4444-4444-8444-444444444441',
  'CONC-R2-A','Invoice-side concurrency fixture A','[]','concurrency-receipt-two-a'
);
select public.post_customer_receipt(
  'b2222222-2222-4222-8222-222222222221','b3333333-3333-4333-8333-333333333331',
  '2026-08-11',5000,'MZN','bank','b4444444-4444-4444-8444-444444444441',
  'CONC-R2-B','Invoice-side concurrency fixture B','[]','concurrency-receipt-two-b'
);

commit;
