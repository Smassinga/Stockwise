-- MULTI-SETTLEMENT-1: one customer payment, one cash/bank transaction, and
-- immutable allocations against issued sales invoices. V1 is company-base
-- currency only; existing single-anchor settlements remain unchanged.

create table public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  receipt_reference text not null,
  received_on date not null,
  amount_received_base numeric(18,2) not null check (amount_received_base > 0),
  currency_code text not null,
  payment_channel text not null check (payment_channel in ('cash','bank')),
  bank_account_id uuid references public.bank_accounts(id) on delete restrict,
  financial_transaction_id uuid not null,
  external_reference text,
  note text,
  posting_request_id uuid not null references public.posting_requests(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint customer_receipts_company_reference_unique unique(company_id,receipt_reference),
  constraint customer_receipts_posting_request_unique unique(posting_request_id),
  constraint customer_receipts_transaction_unique unique(payment_channel,financial_transaction_id),
  constraint customer_receipts_bank_channel_check check (
    (payment_channel='cash' and bank_account_id is null)
    or (payment_channel='bank' and bank_account_id is not null)
  ),
  constraint customer_receipts_currency_normalized check (
    currency_code=upper(btrim(currency_code)) and length(currency_code)=3
  )
);

create index customer_receipts_company_customer_date_idx
  on public.customer_receipts(company_id,customer_id,received_on desc,created_at desc);
create index customer_receipts_customer_fk_idx
  on public.customer_receipts(customer_id);

create table public.customer_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_receipt_id uuid not null references public.customer_receipts(id) on delete restrict,
  sales_invoice_id uuid not null references public.sales_invoices(id) on delete restrict,
  allocation_kind text not null check (allocation_kind in ('allocation','reversal')),
  amount_base numeric(18,2) not null check (amount_base > 0),
  reverses_allocation_id uuid references public.customer_receipt_allocations(id) on delete restrict,
  request_key text not null,
  posting_request_id uuid not null references public.posting_requests(id) on delete restrict,
  reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint customer_receipt_allocations_request_unique unique(company_id,request_key),
  constraint customer_receipt_allocations_kind_check check (
    (allocation_kind='allocation' and reverses_allocation_id is null)
    or (allocation_kind='reversal' and reverses_allocation_id is not null)
  )
);

create unique index customer_receipt_allocations_one_reversal_idx
  on public.customer_receipt_allocations(reverses_allocation_id)
  where allocation_kind='reversal';
create index customer_receipt_allocations_receipt_idx
  on public.customer_receipt_allocations(company_id,customer_receipt_id,created_at,id);
create index customer_receipt_allocations_invoice_idx
  on public.customer_receipt_allocations(company_id,sales_invoice_id,created_at,id);
create index customer_receipt_allocations_receipt_fk_idx
  on public.customer_receipt_allocations(customer_receipt_id);
create index customer_receipt_allocations_invoice_fk_idx
  on public.customer_receipt_allocations(sales_invoice_id);
create index customer_receipt_allocations_posting_request_fk_idx
  on public.customer_receipt_allocations(posting_request_id);

-- A customer receipt is itself the cash/bank transaction anchor. Preserve the
-- established SI/PO/SO anchors and explicitly admit CR for the new cash path.
alter table public.cash_transactions
  drop constraint cash_transactions_ref_type_check;
alter table public.cash_transactions
  add constraint cash_transactions_ref_type_check
  check (ref_type=any(array['SO'::text,'PO'::text,'SI'::text,'VB'::text,'ADJ'::text,'CR'::text]));

alter table public.customer_receipts enable row level security;
alter table public.customer_receipts force row level security;
alter table public.customer_receipt_allocations enable row level security;
alter table public.customer_receipt_allocations force row level security;

create policy customer_receipts_company_read
  on public.customer_receipts for select to authenticated
  using (company_id=any(public.current_user_company_ids()));
create policy customer_receipt_allocations_company_read
  on public.customer_receipt_allocations for select to authenticated
  using (company_id=any(public.current_user_company_ids()));

revoke all on table public.customer_receipts from public,anon,authenticated;
revoke all on table public.customer_receipt_allocations from public,anon,authenticated;
grant select on table public.customer_receipts to authenticated;
grant select on table public.customer_receipt_allocations to authenticated;
grant all on table public.customer_receipts to service_role;
grant all on table public.customer_receipt_allocations to service_role;

create or replace function public.stockwise_reject_customer_receipt_mutation()
returns trigger language plpgsql
set search_path=pg_catalog
as $$
begin
  if tg_op='DELETE'
     and coalesce(current_setting('stockwise.finance_transition_bypass',true),'')='on'
     and public.is_platform_admin() then
    return old;
  end if;
  raise exception 'customer_receipt_evidence_is_immutable' using errcode='55000';
end;
$$;

create trigger customer_receipts_immutable
before update or delete on public.customer_receipts
for each row execute function public.stockwise_reject_customer_receipt_mutation();
create trigger customer_receipt_allocations_immutable
before update or delete on public.customer_receipt_allocations
for each row execute function public.stockwise_reject_customer_receipt_mutation();

create or replace view public.v_customer_receipt_allocation_effects
with (security_invoker=true) as
select
  a.id as evidence_id,
  a.company_id,
  a.customer_receipt_id,
  a.sales_invoice_id,
  a.allocation_kind,
  case when a.allocation_kind='allocation' then a.amount_base else -a.amount_base end as signed_amount_base,
  a.reverses_allocation_id,
  a.request_key,
  a.created_by,
  a.created_at
from public.customer_receipt_allocations a;

create or replace view public.v_customer_receipt_allocations
with (security_invoker=true) as
select
  a.id,
  a.company_id,
  a.customer_receipt_id,
  a.sales_invoice_id,
  a.amount_base,
  a.request_key,
  a.created_by,
  a.created_at,
  exists(
    select 1 from public.customer_receipt_allocations reversal
    where reversal.reverses_allocation_id=a.id
      and reversal.allocation_kind='reversal'
  ) as is_reversed,
  case when exists(
    select 1 from public.customer_receipt_allocations reversal
    where reversal.reverses_allocation_id=a.id
      and reversal.allocation_kind='reversal'
  ) then 0::numeric else a.amount_base end as active_amount_base,
  (
    select reversal.id from public.customer_receipt_allocations reversal
    where reversal.reverses_allocation_id=a.id
      and reversal.allocation_kind='reversal'
    limit 1
  ) as reversal_id
from public.customer_receipt_allocations a
where a.allocation_kind='allocation';

create or replace view public.v_customer_receipt_state
with (security_invoker=true) as
with allocation_rollup as (
  select e.company_id,e.customer_receipt_id,
    coalesce(sum(e.signed_amount_base),0::numeric) as allocated_base
  from public.v_customer_receipt_allocation_effects e
  group by e.company_id,e.customer_receipt_id
)
select
  r.id,
  r.company_id,
  r.customer_id,
  r.receipt_reference,
  r.received_on,
  r.amount_received_base,
  r.currency_code,
  r.payment_channel,
  r.bank_account_id,
  r.financial_transaction_id,
  r.external_reference,
  r.note,
  r.posting_request_id,
  r.created_by,
  r.created_at,
  coalesce(ar.allocated_base,0::numeric) as allocated_base,
  greatest(r.amount_received_base-coalesce(ar.allocated_base,0::numeric),0::numeric) as unallocated_base
from public.customer_receipts r
left join allocation_rollup ar
  on ar.company_id=r.company_id and ar.customer_receipt_id=r.id;

create or replace view public.v_customer_unapplied_credit
with (security_invoker=true) as
select company_id,customer_id,currency_code,
  sum(unallocated_base)::numeric(18,2) as unapplied_credit_base,
  count(*) filter(where unallocated_base>0)::integer as receipt_count
from public.v_customer_receipt_state
group by company_id,customer_id,currency_code;

revoke all on public.v_customer_receipt_allocation_effects from public,anon;
revoke all on public.v_customer_receipt_allocations from public,anon;
revoke all on public.v_customer_receipt_state from public,anon;
revoke all on public.v_customer_unapplied_credit from public,anon;
grant select on public.v_customer_receipt_allocation_effects to authenticated;
grant select on public.v_customer_receipt_allocations to authenticated;
grant select on public.v_customer_receipt_state to authenticated;
grant select on public.v_customer_unapplied_credit to authenticated;

-- Preserve the existing invoice-state column contract while adding active
-- receipt allocations exactly once to settled/outstanding state.
create or replace view public.v_sales_invoice_state
with (security_invoker=true) as
with line_rollup as (
  select sil.sales_invoice_id,count(*)::integer line_count
  from public.sales_invoice_lines sil group by sil.sales_invoice_id
), cash_rollup as (
  select ct.company_id,ct.ref_id sales_invoice_id,coalesce(sum(ct.amount_base),0::numeric) settled_base
  from public.cash_transactions ct
  where ct.ref_type='SI' and ct.type='sale_receipt'
  group by ct.company_id,ct.ref_id
), bank_rollup as (
  select bt.ref_id sales_invoice_id,coalesce(sum(bt.amount_base),0::numeric) settled_base
  from public.bank_transactions bt where bt.ref_type='SI' group by bt.ref_id
), receipt_allocation_rollup as (
  select e.company_id,e.sales_invoice_id,
    coalesce(sum(e.signed_amount_base),0::numeric) settled_base,
    coalesce(sum(e.signed_amount_base) filter(where r.payment_channel='cash'),0::numeric) cash_settled_base,
    coalesce(sum(e.signed_amount_base) filter(where r.payment_channel='bank'),0::numeric) bank_settled_base
  from public.v_customer_receipt_allocation_effects e
  join public.customer_receipts r
    on r.company_id=e.company_id and r.id=e.customer_receipt_id
  group by e.company_id,e.sales_invoice_id
), credit_rollup as (
  select scn.company_id,scn.original_sales_invoice_id sales_invoice_id,
    count(*) filter(where scn.document_workflow_status='issued')::integer credit_note_count,
    coalesce(sum(coalesce(scn.total_amount,0)*coalesce(scn.fx_to_base,1))
      filter(where scn.document_workflow_status='issued'),0::numeric) credited_total_base
  from public.sales_credit_notes scn group by scn.company_id,scn.original_sales_invoice_id
), debit_rollup as (
  select sdn.company_id,sdn.original_sales_invoice_id sales_invoice_id,
    count(*) filter(where sdn.document_workflow_status='issued')::integer debit_note_count,
    coalesce(sum(coalesce(sdn.total_amount,0)*coalesce(sdn.fx_to_base,1))
      filter(where sdn.document_workflow_status='issued'),0::numeric) debited_total_base
  from public.sales_debit_notes sdn group by sdn.company_id,sdn.original_sales_invoice_id
), calculated as (
  select si.*,coalesce(c.name,so.bill_to_name,so.customer) counterparty_name,so.order_no,
    coalesce(lr.line_count,0) line_count,
    coalesce(cr.settled_base,0::numeric)+coalesce(rar.cash_settled_base,0::numeric) cash_received_base,
    coalesce(br.settled_base,0::numeric)+coalesce(rar.bank_settled_base,0::numeric) bank_received_base,
    coalesce(rar.settled_base,0::numeric) receipt_allocated_base,
    coalesce(cnr.credit_note_count,0) credit_note_count,
    coalesce(cnr.credited_total_base,0::numeric) credited_total_base,
    coalesce(dnr.debit_note_count,0) debit_note_count,
    coalesce(dnr.debited_total_base,0::numeric) debited_total_base,
    greatest(coalesce(si.total_amount,0)*coalesce(si.fx_to_base,1)
      +coalesce(dnr.debited_total_base,0)-coalesce(cnr.credited_total_base,0),0::numeric) current_legal,
    coalesce(cr.settled_base,0)+coalesce(br.settled_base,0) legacy_settled,
    coalesce(cr.settled_base,0)+coalesce(br.settled_base,0)+coalesce(rar.settled_base,0) total_settled
  from public.sales_invoices si
  left join public.customers c on c.id=si.customer_id
  left join public.sales_orders so on so.id=si.sales_order_id
  left join line_rollup lr on lr.sales_invoice_id=si.id
  left join cash_rollup cr on cr.company_id=si.company_id and cr.sales_invoice_id=si.id
  left join bank_rollup br on br.sales_invoice_id=si.id
  left join receipt_allocation_rollup rar on rar.company_id=si.company_id and rar.sales_invoice_id=si.id
  left join credit_rollup cnr on cnr.company_id=si.company_id and cnr.sales_invoice_id=si.id
  left join debit_rollup dnr on dnr.company_id=si.company_id and dnr.sales_invoice_id=si.id
)
select
  x.id,x.company_id,x.sales_order_id,x.customer_id,x.internal_reference,x.invoice_date,x.due_date,
  x.counterparty_name,x.order_no,coalesce(x.currency_code,'MZN') currency_code,
  coalesce(x.fx_to_base,1) fx_to_base,coalesce(x.subtotal,0) subtotal,
  coalesce(x.tax_total,0) tax_total,coalesce(x.total_amount,0) total_amount,
  coalesce(x.total_amount,0)*coalesce(x.fx_to_base,1) total_amount_base,
  x.document_workflow_status,x.line_count,false state_warning,'sales_invoice'::text financial_anchor,
  x.cash_received_base,x.bank_received_base,x.total_settled settled_base,
  x.credit_note_count,x.credited_total_base,x.debit_note_count,x.debited_total_base,
  x.current_legal current_legal_total_base,
  greatest(x.current_legal-x.total_settled,0::numeric) outstanding_base,
  case when x.credited_total_base >= coalesce(x.total_amount,0)*coalesce(x.fx_to_base,1)+x.debited_total_base-0.005 then 'fully_credited'
    when x.credited_total_base>0.005 then 'partially_credited' else 'not_credited' end credit_status,
  case when x.credited_total_base>0.005 and x.debited_total_base>0.005 then 'credited_and_debited'
    when x.credited_total_base>0.005 then 'credited' when x.debited_total_base>0.005 then 'debited' else 'none' end adjustment_status,
  case when greatest(x.current_legal-x.total_settled,0)<=0.005 then 'settled'
    when x.due_date is not null and x.due_date<current_date and greatest(x.current_legal-x.total_settled,0)>0.005 then 'overdue'
    when x.total_settled>0.005 then 'partially_settled' else 'unsettled' end settlement_status,
  case when x.document_workflow_status='draft' then 'draft'
    when x.document_workflow_status='voided' then 'voided'
    when x.credited_total_base >= coalesce(x.total_amount,0)*coalesce(x.fx_to_base,1)+x.debited_total_base-0.005 then 'issued_fully_credited'
    when x.credited_total_base>0.005 then 'issued_partially_credited'
    when greatest(x.current_legal-x.total_settled,0)<=0.005 then 'issued_settled'
    when x.total_settled>0.005 then 'issued_partially_settled'
    when x.due_date is not null and x.due_date<current_date then 'issued_overdue'
    else 'issued_open' end resolution_status,
  x.approval_status,x.approval_requested_at,x.approved_at,
  x.legacy_settled legacy_direct_settled_base,
  x.receipt_allocated_base
from calculated x;

-- Final company-scoped AR contract for customer receipt selection and
-- server-side receivables alerts. Amounts used for aggregation are base
-- currency amounts; document currency is retained as evidence.
create or replace view public.v_customer_receivable_exposures
with (security_invoker=true) as
with anchors as (
  select
    si.company_id,si.customer_id,coalesce(si.sales_order_id,si.id) exposure_chain_id,
    'sales_invoice'::text anchor_kind,'SI'::text anchor_type,si.id anchor_id,
    si.sales_order_id source_sales_order_id,si.internal_reference document_reference,
    si.invoice_date document_date,si.due_date,si.counterparty_name customer_name,
    si.currency_code::text document_currency_code,coalesce(cs.base_currency_code,'MZN') base_currency_code,
    si.fx_to_base,si.total_amount original_amount_document,si.total_amount_base original_amount_base,
    si.current_legal_total_base current_legal_amount_base,
    si.legacy_direct_settled_base,si.receipt_allocated_base,
    si.settled_base settled_amount_base,si.outstanding_base outstanding_amount_base,
    si.document_workflow_status document_status,si.settlement_status,si.resolution_status
  from public.v_sales_invoice_state si
  left join public.company_settings cs on cs.company_id=si.company_id
  where si.document_workflow_status='issued'
  union all
  select
    so.company_id,raw.customer_id,so.id exposure_chain_id,
    'sales_order'::text anchor_kind,'SO'::text anchor_type,so.id anchor_id,
    so.id source_sales_order_id,so.order_no document_reference,
    so.order_date document_date,so.due_date,so.counterparty_name customer_name,
    so.currency_code::text document_currency_code,coalesce(cs.base_currency_code,'MZN') base_currency_code,
    so.fx_to_base,so.total_amount_ccy original_amount_document,so.total_amount_base original_amount_base,
    so.total_amount_base current_legal_amount_base,
    so.legacy_settled_base legacy_direct_settled_base,0::numeric receipt_allocated_base,
    so.legacy_settled_base settled_amount_base,so.legacy_outstanding_base outstanding_amount_base,
    so.workflow_status document_status,so.settlement_status,
    case when so.legacy_outstanding_base<=0.005 then 'settled' else so.settlement_status end resolution_status
  from public.v_sales_order_state so
  join public.sales_orders raw on raw.id=so.id and raw.company_id=so.company_id
  left join public.company_settings cs on cs.company_id=so.company_id
  where so.financial_anchor='legacy_order_link'
    and so.workflow_status='approved'
    and raw.customer_id is not null
), annotated as (
  select a.*,ctrl.id collection_control_id,coalesce(ctrl.status,'active') collection_status,
    ctrl.owner_user_id collection_owner_user_id,ctrl.next_action_at collection_next_action_at,
    ctrl.pause_until collection_pause_until,ctrl.dispute_category,
    ctrl.current_promise_id,
    coalesce(ctrl.status,'active')<>'active' collections_suppressed,
    case coalesce(ctrl.status,'active')
      when 'paused' then 'collection_paused'
      when 'disputed' then 'collection_disputed'
      when 'promise_to_pay' then 'promise_open'
      when 'manual_follow_up' then 'manual_follow_up_required'
      when 'closed' then 'collection_closed'
      else null end collection_suppression_reason
  from anchors a
  left join public.ar_collection_controls ctrl
    on ctrl.company_id=a.company_id and ctrl.exposure_chain_id=a.exposure_chain_id
)
select a.*,
  case when a.outstanding_amount_base<=0.005 then 'resolved'
    when a.due_date is null then 'undated'
    when a.due_date<current_date then 'overdue'
    when a.due_date=current_date then 'due_today'
    when a.due_date<=current_date+7 then 'due_soon'
    else 'current' end due_position,
  case when a.outstanding_amount_base>0.005 and a.due_date<current_date then current_date-a.due_date else 0 end days_past_due,
  case when a.outstanding_amount_base<=0.005 then 'resolved'
    when a.due_date is null then 'undated'
    when a.due_date>=current_date then 'current'
    when current_date-a.due_date<=30 then '1_30'
    when current_date-a.due_date<=60 then '31_60'
    when current_date-a.due_date<=90 then '61_90'
    else '91_plus' end aging_bucket
from annotated a;

revoke all on public.v_customer_receivable_exposures from public,anon;
grant select on public.v_customer_receivable_exposures to authenticated;

create or replace function public.stockwise_lock_receivable_invoice(
  p_company_id uuid,p_customer_id uuid,p_sales_invoice_id uuid,
  p_amount_base numeric,p_base_currency text
) returns numeric language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare v_invoice public.sales_invoices; v_state record; v_amount numeric;
begin
  v_amount:=public.stockwise_normalize_settlement_amount(p_amount_base);
  if v_amount is null or v_amount<=0 then
    raise exception 'receipt_allocation_amount_must_be_positive' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stockwise:customer-receivable:SI:'||p_sales_invoice_id::text,0));
  select * into v_invoice from public.sales_invoices
  where id=p_sales_invoice_id for update;
  if v_invoice.id is null or v_invoice.company_id is distinct from p_company_id then
    raise exception 'receipt_invoice_not_found' using errcode='P0002';
  end if;
  if v_invoice.customer_id is distinct from p_customer_id then
    raise exception 'receipt_customer_mismatch' using errcode='22023';
  end if;
  if v_invoice.document_workflow_status<>'issued' then
    raise exception 'receipt_invoice_not_issued' using errcode='22023';
  end if;
  if upper(coalesce(v_invoice.currency_code,'')) is distinct from upper(p_base_currency)
     or coalesce(v_invoice.fx_to_base,1)<>1::numeric then
    raise exception 'receipt_invoice_currency_not_supported' using errcode='22023';
  end if;
  select outstanding_base into v_state from public.v_sales_invoice_state where id=p_sales_invoice_id;
  if public.stockwise_normalize_settlement_amount(coalesce(v_state.outstanding_base,0))<=0 then
    raise exception 'receipt_invoice_already_resolved' using errcode='P0001';
  end if;
  if v_amount>public.stockwise_normalize_settlement_amount(v_state.outstanding_base) then
    raise exception 'receipt_allocation_exceeds_outstanding' using errcode='P0001';
  end if;
  return public.stockwise_normalize_settlement_amount(v_state.outstanding_base);
end;
$$;

create or replace function public.post_customer_receipt(
  p_company_id uuid,p_customer_id uuid,p_received_on date,
  p_amount_received numeric,p_currency_code text,p_payment_channel text,
  p_bank_account_id uuid default null,p_external_reference text default null,
  p_note text default null,p_initial_allocations jsonb default '[]'::jsonb,
  p_request_key text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions,pg_temp
as $$
declare
  v_actor uuid; v_amount numeric; v_currency text; v_base_currency text;
  v_channel text; v_request_key text; v_payload jsonb; v_hash text;
  v_request public.posting_requests; v_claimed_new boolean:=false;
  v_input jsonb; v_normalized jsonb:='[]'::jsonb; v_invoice_id uuid;
  v_allocation_amount numeric; v_allocated numeric:=0; v_bank record;
  v_receipt_id uuid:=gen_random_uuid(); v_reference text; v_transaction_id uuid;
  v_result jsonb;
begin
  v_actor:=public.stockwise_require_settlement_company(p_company_id);
  v_amount:=public.stockwise_normalize_settlement_amount(p_amount_received);
  v_currency:=upper(nullif(btrim(coalesce(p_currency_code,'')),''));
  v_channel:=lower(nullif(btrim(coalesce(p_payment_channel,'')),''));
  v_request_key:=nullif(btrim(coalesce(p_request_key,'')),'');
  if v_request_key is null then raise exception 'request_key_required' using errcode='22023'; end if;
  if p_received_on is null then raise exception 'receipt_date_required' using errcode='22023'; end if;
  if v_amount is null or v_amount<=0 then raise exception 'receipt_amount_must_be_positive' using errcode='22023'; end if;
  if v_channel not in ('cash','bank') then raise exception 'receipt_channel_invalid' using errcode='22023'; end if;
  if p_initial_allocations is null or jsonb_typeof(p_initial_allocations)<>'array' then
    raise exception 'receipt_allocations_must_be_array' using errcode='22023';
  end if;
  if jsonb_array_length(p_initial_allocations)>100 then
    raise exception 'receipt_allocation_limit_exceeded' using errcode='22023';
  end if;

  select upper(coalesce(nullif(cs.base_currency_code,''),'MZN')) into v_base_currency
  from public.company_settings cs where cs.company_id=p_company_id;
  v_base_currency:=coalesce(v_base_currency,'MZN');
  if v_currency is distinct from v_base_currency then
    raise exception 'receipt_currency_must_equal_company_base' using errcode='22023';
  end if;
  perform 1 from public.customers c where c.id=p_customer_id and c.company_id=p_company_id for update;
  if not found then raise exception 'receipt_customer_not_found' using errcode='P0002'; end if;

  if v_channel='bank' then
    select ba.company_id,upper(coalesce(nullif(ba.currency_code,''),v_base_currency)) currency_code
    into v_bank from public.bank_accounts ba where ba.id=p_bank_account_id for update;
    if not found then raise exception 'bank_account_not_found' using errcode='P0002'; end if;
    if v_bank.company_id is distinct from p_company_id then raise exception 'cross_company_bank_account_denied' using errcode='42501'; end if;
    if v_bank.currency_code is distinct from v_base_currency then raise exception 'receipt_bank_currency_mismatch' using errcode='22023'; end if;
  elsif p_bank_account_id is not null then
    raise exception 'cash_receipt_cannot_have_bank_account' using errcode='22023';
  end if;

  for v_input in select value from jsonb_array_elements(p_initial_allocations) loop
    begin
      if jsonb_typeof(v_input)<>'object' then raise exception 'invalid'; end if;
      v_invoice_id:=(v_input->>'sales_invoice_id')::uuid;
      v_allocation_amount:=public.stockwise_normalize_settlement_amount((v_input->>'amount_base')::numeric);
    exception when others then
      raise exception 'receipt_allocation_invalid' using errcode='22023';
    end;
    if v_invoice_id is null or v_allocation_amount is null or v_allocation_amount<=0 then
      raise exception 'receipt_allocation_invalid' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(v_normalized) n where (n->>'sales_invoice_id')::uuid=v_invoice_id) then
      raise exception 'receipt_duplicate_invoice_allocation' using errcode='22023';
    end if;
    v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object(
      'sales_invoice_id',v_invoice_id,'amount_base',v_allocation_amount::text));
    v_allocated:=v_allocated+v_allocation_amount;
  end loop;
  if v_allocated>v_amount then raise exception 'receipt_allocations_exceed_received' using errcode='22023'; end if;
  select coalesce(jsonb_agg(value order by value->>'sales_invoice_id'),'[]'::jsonb)
    into v_normalized from jsonb_array_elements(v_normalized);

  v_payload:=jsonb_build_object('company_id',p_company_id,'customer_id',p_customer_id,
    'received_on',p_received_on,'amount_received_base',v_amount::text,'currency_code',v_currency,
    'payment_channel',v_channel,'bank_account_id',coalesce(p_bank_account_id::text,''),
    'external_reference',coalesce(nullif(btrim(p_external_reference),''),''),
    'note',coalesce(nullif(btrim(p_note),''),'') ,'allocations',v_normalized);
  v_hash:=encode(extensions.digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  loop
    begin
      insert into public.posting_requests(company_id,operation_type,request_key,payload_hash,status,created_by,expires_at)
      values(p_company_id,'customer.receipt.post',v_request_key,v_hash,'in_progress',v_actor,now()+interval '180 days')
      returning * into v_request;
      v_claimed_new:=true; exit;
    exception when unique_violation then
      select * into v_request from public.posting_requests
      where company_id=p_company_id and operation_type='customer.receipt.post' and request_key=v_request_key for update;
      exit when found;
    end;
  end loop;
  if v_request.payload_hash is distinct from v_hash then raise exception 'idempotency_key_payload_mismatch' using errcode='22023'; end if;
  if v_request.status='succeeded' then return v_request.result_payload||jsonb_build_object('replayed',true); end if;
  if v_request.status='in_progress' and not v_claimed_new then raise exception 'request_in_progress' using errcode='55P03'; end if;
  if v_request.status='failed' then raise exception 'idempotency_request_failed_use_new_key' using errcode='P0001'; end if;

  for v_input in select value from jsonb_array_elements(v_normalized) order by value->>'sales_invoice_id' loop
    perform public.stockwise_lock_receivable_invoice(p_company_id,p_customer_id,
      (v_input->>'sales_invoice_id')::uuid,(v_input->>'amount_base')::numeric,v_base_currency);
  end loop;

  v_reference:=public.stockwise_next_receipt_reference(p_company_id);
  if v_channel='cash' then
    insert into public.cash_transactions(company_id,happened_at,type,ref_type,ref_id,memo,amount_base,user_ref)
    values(p_company_id,p_received_on,'sale_receipt','CR',v_receipt_id,
      nullif(concat_ws(' | ',nullif(btrim(p_note),''),nullif(btrim(p_external_reference),'')),''),v_amount,v_actor::text)
    returning id into v_transaction_id;
  else
    insert into public.bank_transactions(bank_id,happened_at,memo,amount_base,reconciled,ref_type,ref_id)
    values(p_bank_account_id,p_received_on,
      nullif(concat_ws(' | ',nullif(btrim(p_note),''),nullif(btrim(p_external_reference),'')),''),v_amount,false,'CR',v_receipt_id)
    returning id into v_transaction_id;
  end if;
  insert into public.customer_receipts(id,company_id,customer_id,receipt_reference,received_on,
    amount_received_base,currency_code,payment_channel,bank_account_id,financial_transaction_id,
    external_reference,note,posting_request_id,created_by)
  values(v_receipt_id,p_company_id,p_customer_id,v_reference,p_received_on,v_amount,v_currency,v_channel,
    p_bank_account_id,v_transaction_id,nullif(btrim(p_external_reference),''),nullif(btrim(p_note),''),v_request.id,v_actor);

  for v_input in select value from jsonb_array_elements(v_normalized) loop
    insert into public.customer_receipt_allocations(company_id,customer_receipt_id,sales_invoice_id,
      allocation_kind,amount_base,request_key,posting_request_id,created_by)
    values(p_company_id,v_receipt_id,(v_input->>'sales_invoice_id')::uuid,'allocation',
      (v_input->>'amount_base')::numeric,v_request_key||':initial:'||(v_input->>'sales_invoice_id'),v_request.id,v_actor);
  end loop;
  select jsonb_build_object('receipt',to_jsonb(s),'allocations',coalesce((
    select jsonb_agg(to_jsonb(a) order by a.created_at,a.id)
    from public.v_customer_receipt_allocations a where a.customer_receipt_id=v_receipt_id
  ),'[]'::jsonb),'transaction_count',1,'replayed',false)
  into v_result from public.v_customer_receipt_state s where s.id=v_receipt_id;
  update public.posting_requests set status='succeeded',result_ref_type='CUSTOMER_RECEIPT',
    result_ref_id=v_receipt_id::text,result_payload=v_result,error_code=null,error_message=null,updated_at=now()
  where id=v_request.id;
  return v_result;
end;
$$;

create or replace function public.allocate_customer_receipt(
  p_customer_receipt_id uuid,p_sales_invoice_id uuid,p_amount_base numeric,
  p_request_key text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions,pg_temp
as $$
declare
  v_receipt public.customer_receipts; v_actor uuid; v_amount numeric;
  v_key text; v_payload jsonb; v_hash text; v_request public.posting_requests;
  v_claimed_new boolean:=false; v_unallocated numeric; v_allocation_id uuid; v_result jsonb;
begin
  v_amount:=public.stockwise_normalize_settlement_amount(p_amount_base);
  v_key:=nullif(btrim(coalesce(p_request_key,'')),'');
  if v_key is null then raise exception 'request_key_required' using errcode='22023'; end if;
  if v_amount is null or v_amount<=0 then raise exception 'receipt_allocation_amount_must_be_positive' using errcode='22023'; end if;
  select * into v_receipt from public.customer_receipts where id=p_customer_receipt_id;
  if v_receipt.id is null then raise exception 'customer_receipt_not_found' using errcode='P0002'; end if;
  v_actor:=public.stockwise_require_settlement_company(v_receipt.company_id);
  select * into v_receipt from public.customer_receipts where id=p_customer_receipt_id for update;
  v_payload:=jsonb_build_object('customer_receipt_id',p_customer_receipt_id,
    'sales_invoice_id',p_sales_invoice_id,'amount_base',v_amount::text);
  v_hash:=encode(extensions.digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  loop begin
    insert into public.posting_requests(company_id,operation_type,request_key,payload_hash,status,created_by,expires_at)
    values(v_receipt.company_id,'customer.receipt.allocate',v_key,v_hash,'in_progress',v_actor,now()+interval '180 days')
    returning * into v_request; v_claimed_new:=true; exit;
  exception when unique_violation then
    select * into v_request from public.posting_requests where company_id=v_receipt.company_id
      and operation_type='customer.receipt.allocate' and request_key=v_key for update;
    exit when found;
  end; end loop;
  if v_request.payload_hash is distinct from v_hash then raise exception 'idempotency_key_payload_mismatch' using errcode='22023'; end if;
  if v_request.status='succeeded' then return v_request.result_payload||jsonb_build_object('replayed',true); end if;
  if v_request.status='in_progress' and not v_claimed_new then raise exception 'request_in_progress' using errcode='55P03'; end if;
  if v_request.status='failed' then raise exception 'idempotency_request_failed_use_new_key' using errcode='P0001'; end if;
  select unallocated_base into v_unallocated from public.v_customer_receipt_state where id=v_receipt.id;
  if v_amount>public.stockwise_normalize_settlement_amount(v_unallocated) then
    raise exception 'receipt_allocation_exceeds_unallocated' using errcode='P0001';
  end if;
  perform public.stockwise_lock_receivable_invoice(v_receipt.company_id,v_receipt.customer_id,
    p_sales_invoice_id,v_amount,v_receipt.currency_code);
  insert into public.customer_receipt_allocations(company_id,customer_receipt_id,sales_invoice_id,
    allocation_kind,amount_base,request_key,posting_request_id,created_by)
  values(v_receipt.company_id,v_receipt.id,p_sales_invoice_id,'allocation',v_amount,v_key,v_request.id,v_actor)
  returning id into v_allocation_id;
  select jsonb_build_object('allocation',to_jsonb(a),'receipt',to_jsonb(s),
    'financial_transaction_created',false,'replayed',false)
  into v_result from public.v_customer_receipt_allocations a
  join public.v_customer_receipt_state s on s.id=a.customer_receipt_id where a.id=v_allocation_id;
  update public.posting_requests set status='succeeded',result_ref_type='CUSTOMER_RECEIPT_ALLOCATION',
    result_ref_id=v_allocation_id::text,result_payload=v_result,updated_at=now() where id=v_request.id;
  return v_result;
end;
$$;

create or replace function public.reverse_customer_receipt_allocation(
  p_allocation_id uuid,p_reason text,p_request_key text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions,pg_temp
as $$
declare
  v_allocation public.customer_receipt_allocations; v_receipt public.customer_receipts;
  v_actor uuid; v_reason text; v_key text; v_payload jsonb; v_hash text;
  v_request public.posting_requests; v_claimed_new boolean:=false;
  v_reversal_id uuid; v_result jsonb;
begin
  v_reason:=nullif(btrim(coalesce(p_reason,'')),''); v_key:=nullif(btrim(coalesce(p_request_key,'')),'');
  if v_reason is null then raise exception 'allocation_reversal_reason_required' using errcode='22023'; end if;
  if v_key is null then raise exception 'request_key_required' using errcode='22023'; end if;
  select * into v_allocation from public.customer_receipt_allocations
  where id=p_allocation_id and allocation_kind='allocation';
  if v_allocation.id is null then raise exception 'receipt_allocation_not_found' using errcode='P0002'; end if;
  select * into v_receipt from public.customer_receipts where id=v_allocation.customer_receipt_id;
  v_actor:=public.stockwise_require_settlement_company(v_receipt.company_id);
  select * into v_receipt from public.customer_receipts where id=v_allocation.customer_receipt_id for update;
  select * into v_allocation from public.customer_receipt_allocations
  where id=p_allocation_id and allocation_kind='allocation' for update;
  v_payload:=jsonb_build_object('allocation_id',p_allocation_id,'reason',v_reason);
  v_hash:=encode(extensions.digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  loop begin
    insert into public.posting_requests(company_id,operation_type,request_key,payload_hash,status,created_by,expires_at)
    values(v_receipt.company_id,'customer.receipt.allocation.reverse',v_key,v_hash,'in_progress',v_actor,now()+interval '180 days')
    returning * into v_request; v_claimed_new:=true; exit;
  exception when unique_violation then
    select * into v_request from public.posting_requests where company_id=v_receipt.company_id
      and operation_type='customer.receipt.allocation.reverse' and request_key=v_key for update;
    exit when found;
  end; end loop;
  if v_request.payload_hash is distinct from v_hash then raise exception 'idempotency_key_payload_mismatch' using errcode='22023'; end if;
  if v_request.status='succeeded' then return v_request.result_payload||jsonb_build_object('replayed',true); end if;
  if v_request.status='in_progress' and not v_claimed_new then raise exception 'request_in_progress' using errcode='55P03'; end if;
  if exists(select 1 from public.customer_receipt_allocations where reverses_allocation_id=v_allocation.id) then
    raise exception 'receipt_allocation_already_reversed' using errcode='P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stockwise:customer-receivable:SI:'||v_allocation.sales_invoice_id::text,0));
  perform 1 from public.sales_invoices where id=v_allocation.sales_invoice_id for update;
  insert into public.customer_receipt_allocations(company_id,customer_receipt_id,sales_invoice_id,
    allocation_kind,amount_base,reverses_allocation_id,request_key,posting_request_id,reason,created_by)
  values(v_allocation.company_id,v_allocation.customer_receipt_id,v_allocation.sales_invoice_id,
    'reversal',v_allocation.amount_base,v_allocation.id,v_key,v_request.id,v_reason,v_actor)
  returning id into v_reversal_id;
  select jsonb_build_object('reversal',to_jsonb(r),'receipt',to_jsonb(s),
    'financial_transaction_created',false,'replayed',false)
  into v_result from public.customer_receipt_allocations r
  join public.v_customer_receipt_state s on s.id=r.customer_receipt_id where r.id=v_reversal_id;
  update public.posting_requests set status='succeeded',result_ref_type='CUSTOMER_RECEIPT_ALLOCATION_REVERSAL',
    result_ref_id=v_reversal_id::text,result_payload=v_result,updated_at=now() where id=v_request.id;
  return v_result;
end;
$$;

create or replace function public.stockwise_protect_customer_receipt_transaction()
returns trigger language plpgsql
set search_path=pg_catalog,public
as $$
declare v_channel text;
begin
  v_channel:=case when tg_table_name='cash_transactions' then 'cash' else 'bank' end;
  if old.ref_type='CR' and exists(
    select 1 from public.customer_receipts r
    where r.payment_channel=v_channel and r.financial_transaction_id=old.id
  ) then
    if tg_op='DELETE'
       and coalesce(current_setting('stockwise.finance_transition_bypass',true),'')='on'
       and public.is_platform_admin() then
      -- The established operational reset deletes finance transactions before
      -- invoices/customers. Remove receipt children first under that existing,
      -- transaction-local reset authority so normal immutability stays intact.
      delete from public.customer_receipt_allocations a
      using public.customer_receipts r
      where r.payment_channel=v_channel
        and r.financial_transaction_id=old.id
        and a.customer_receipt_id=r.id;
      delete from public.customer_receipts r
      where r.payment_channel=v_channel and r.financial_transaction_id=old.id;
      return old;
    end if;
    raise exception 'customer_receipt_financial_transaction_is_immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create trigger customer_receipt_cash_transaction_immutable
before update or delete on public.cash_transactions
for each row execute function public.stockwise_protect_customer_receipt_transaction();
create trigger customer_receipt_bank_transaction_immutable
before update or delete on public.bank_transactions
for each row execute function public.stockwise_protect_customer_receipt_transaction();

alter function public.stockwise_reject_customer_receipt_mutation() owner to postgres;
alter function public.stockwise_lock_receivable_invoice(uuid,uuid,uuid,numeric,text) owner to postgres;
alter function public.post_customer_receipt(uuid,uuid,date,numeric,text,text,uuid,text,text,jsonb,text) owner to postgres;
alter function public.allocate_customer_receipt(uuid,uuid,numeric,text) owner to postgres;
alter function public.reverse_customer_receipt_allocation(uuid,text,text) owner to postgres;
alter function public.stockwise_protect_customer_receipt_transaction() owner to postgres;

revoke all on function public.stockwise_reject_customer_receipt_mutation() from public,anon,authenticated;
revoke all on function public.stockwise_lock_receivable_invoice(uuid,uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.post_customer_receipt(uuid,uuid,date,numeric,text,text,uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.allocate_customer_receipt(uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.reverse_customer_receipt_allocation(uuid,text,text) from public,anon,authenticated;
revoke all on function public.stockwise_protect_customer_receipt_transaction() from public,anon,authenticated;
grant execute on function public.post_customer_receipt(uuid,uuid,date,numeric,text,text,uuid,text,text,jsonb,text) to authenticated;
grant execute on function public.allocate_customer_receipt(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.reverse_customer_receipt_allocation(uuid,text,text) to authenticated;

comment on table public.customer_receipts is
  'Immutable company-base-currency customer receipts. Each receipt owns exactly one governed cash or bank transaction.';
comment on table public.customer_receipt_allocations is
  'Append-only invoice allocation and reversal evidence. Active amounts derive from signed evidence; no client update/delete is allowed.';
comment on view public.v_customer_receivable_exposures is
  'Canonical AR exposure contract for issued invoices and temporary approved sales-order anchors. Base amounts include legacy direct settlements plus active receipt allocations exactly once.';
comment on function public.post_customer_receipt(uuid,uuid,date,numeric,text,text,uuid,text,text,jsonb,text) is
  'Posts one base-currency customer receipt, one cash/bank transaction, and optional atomic issued-invoice allocations.';
comment on function public.allocate_customer_receipt(uuid,uuid,numeric,text) is
  'Allocates existing unapplied customer credit without creating another cash/bank transaction.';
comment on function public.reverse_customer_receipt_allocation(uuid,text,text) is
  'Appends a full allocation reversal, restoring receipt credit and invoice outstanding without deleting history.';
