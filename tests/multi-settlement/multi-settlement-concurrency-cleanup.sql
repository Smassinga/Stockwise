\set ON_ERROR_STOP on

begin;
set local session_replication_role=replica;
delete from public.customer_receipt_allocations where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.customer_receipts where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.bank_transactions where bank_id='b4444444-4444-4444-8444-444444444441';
delete from public.cash_transactions where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.payment_receipts where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.payment_receipt_sequences where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.posting_requests where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.sales_invoices where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.bank_accounts where id='b4444444-4444-4444-8444-444444444441';
delete from public.customers where id='b3333333-3333-4333-8333-333333333331';
delete from public.user_active_company where user_id='b1111111-1111-4111-8111-111111111111';
delete from public.company_members where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.company_subscription_state where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.company_settings where company_id='b2222222-2222-4222-8222-222222222221';
delete from public.companies where id='b2222222-2222-4222-8222-222222222221';
delete from auth.users where id='b1111111-1111-4111-8111-111111111111';
set local session_replication_role=origin;
commit;
