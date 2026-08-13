import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  allocateCustomerReceiptOldestFirst,
  buildCustomerReceiptPostingPayload,
  classifyCustomerReceiptError,
  summarizeCustomerReceipt,
} from '../../src/lib/customerReceipts.ts'

const migrationUrl = new URL(
  '../../supabase/migrations/20260813065918_multi_invoice_customer_receipts.sql',
  import.meta.url,
)
const migration = await readFile(migrationUrl, 'utf8')

test('one real payment maps to one governed transaction regardless of allocation count', () => {
  assert.match(migration, /transaction_count',\s*1/i)
  assert.match(migration, /values\(p_company_id,p_received_on,'sale_receipt','CR',v_receipt_id/i)
  assert.match(migration, /values\(p_bank_account_id,p_received_on,[\s\S]*false,'CR',v_receipt_id/i)
})

test('25,000 receipt can remain completely unapplied without changing invoice truth', () => {
  const payload = buildCustomerReceiptPostingPayload({
    companyId: 'company',
    customerId: 'customer',
    receivedOn: '2026-08-11',
    amountReceived: 25_000,
    currencyCode: 'mzn',
    paymentChannel: 'cash',
    allocations: [],
    requestKey: 'receipt-unallocated',
  })

  assert.deepEqual(payload.p_initial_allocations, [])
  assert.deepEqual(summarizeCustomerReceipt(25_000, []), {
    received: 25_000,
    allocated: 0,
    unallocated: 25_000,
  })
  assert.match(migration, /unallocated_base/i)
  assert.match(migration, /v_customer_unapplied_credit/i)
})

test('one receipt allocates atomically across three issued invoices', () => {
  const allocations = [
    { salesInvoiceId: 'invoice-a', amountBase: 10_000 },
    { salesInvoiceId: 'invoice-b', amountBase: 8_000 },
    { salesInvoiceId: 'invoice-c', amountBase: 7_000 },
  ]
  const payload = buildCustomerReceiptPostingPayload({
    companyId: 'company', customerId: 'customer', receivedOn: '2026-08-11',
    amountReceived: 25_000, currencyCode: 'MZN', paymentChannel: 'bank',
    bankAccountId: 'bank', allocations, requestKey: 'receipt-three',
  })

  assert.equal(payload.p_initial_allocations.length, 3)
  assert.equal(summarizeCustomerReceipt(25_000, allocations).unallocated, 0)
  assert.match(migration, /for v_input in select value from jsonb_array_elements\(v_normalized\)[\s\S]*stockwise_lock_receivable_invoice/i)
})

test('oldest-first is a reviewable frontend suggestion and preserves remainder', () => {
  const allocations = allocateCustomerReceiptOldestFirst(25_000, [
    { anchorId: 'invoice-c', dueDate: '2026-08-20', outstandingAmountBase: 9_000 },
    { anchorId: 'invoice-a', dueDate: '2026-08-01', outstandingAmountBase: 10_000 },
    { anchorId: 'invoice-b', dueDate: '2026-08-10', outstandingAmountBase: 8_000 },
  ])
  assert.deepEqual(allocations, [
    { salesInvoiceId: 'invoice-a', amountBase: 10_000 },
    { salesInvoiceId: 'invoice-b', amountBase: 8_000 },
    { salesInvoiceId: 'invoice-c', amountBase: 7_000 },
  ])
})

test('posting payload rejects over-allocation and duplicate invoice rows', () => {
  const base = {
    companyId: 'company', customerId: 'customer', receivedOn: '2026-08-11',
    amountReceived: 100, currencyCode: 'MZN', paymentChannel: 'cash', requestKey: 'key',
  }
  assert.throws(() => buildCustomerReceiptPostingPayload({
    ...base, allocations: [{ salesInvoiceId: 'invoice', amountBase: 100.01 }],
  }), /receipt_allocations_exceed_received/)
  assert.throws(() => buildCustomerReceiptPostingPayload({
    ...base,
    allocations: [
      { salesInvoiceId: 'invoice', amountBase: 40 },
      { salesInvoiceId: 'invoice', amountBase: 60 },
    ],
  }), /receipt_duplicate_invoice_allocation/)
})

test('later allocation and reversal are append-only and never create another financial transaction', () => {
  assert.match(migration, /create or replace function public\.allocate_customer_receipt/i)
  assert.match(migration, /financial_transaction_created',\s*false/i)
  assert.match(migration, /create or replace function public\.reverse_customer_receipt_allocation/i)
  assert.match(migration, /'reversal',v_allocation\.amount_base,v_allocation\.id/i)
  assert.match(migration, /customer_receipt_allocations_immutable/i)
  assert.doesNotMatch(
    migration.match(/create or replace function public\.allocate_customer_receipt[\s\S]*?\$\$;/i)?.[0] || '',
    /insert into public\.(cash_transactions|bank_transactions)/i,
  )
})

test('legacy direct settlements and receipt allocations contribute exactly once', () => {
  assert.match(migration, /legacy_settled[\s\S]*receipt_allocated_base/i)
  assert.match(migration, /x\.total_settled settled_base/i)
  assert.match(migration, /greatest\(x\.current_legal-x\.total_settled,0::numeric\) outstanding_base/i)
  assert.match(migration, /ct\.ref_type='SI'/i)
  assert.match(migration, /bt\.ref_type='SI'/i)
  assert.match(migration, /filter\(where r\.payment_channel='cash'\)/i)
  assert.match(migration, /filter\(where r\.payment_channel='bank'\)/i)
  assert.match(migration, /legacy_direct_settled_base/i)
})

test('expected governed failures map to safe receipt UI states', () => {
  assert.equal(classifyCustomerReceiptError({ message: 'receipt_allocation_exceeds_unallocated' }), 'creditChanged')
  assert.equal(classifyCustomerReceiptError({ message: 'receipt_allocation_already_reversed' }), 'alreadyReversed')
  assert.equal(classifyCustomerReceiptError({ message: 'allocation_reversal_reason_required' }), 'reasonRequired')
  assert.equal(classifyCustomerReceiptError({ message: 'receipt_invoice_not_found' }), 'stale')
  assert.equal(classifyCustomerReceiptError({ message: 'insufficient_company_role' }), 'permissionDenied')
  assert.equal(classifyCustomerReceiptError({ message: 'request_in_progress' }), 'requestConflict')
  assert.equal(classifyCustomerReceiptError({ message: 'technical database detail' }), 'unknown')
})

test('currency, customer, company, authority, idempotency and concurrency are database-enforced', () => {
  for (const contract of [
    'receipt_currency_must_equal_company_base',
    'receipt_invoice_currency_not_supported',
    'receipt_customer_mismatch',
    'cross_company_bank_account_denied',
    'stockwise_require_settlement_company',
    'idempotency_key_payload_mismatch',
    'pg_advisory_xact_lock',
    'receipt_allocation_exceeds_unallocated',
    'receipt_allocation_exceeds_outstanding',
  ]) assert.match(migration, new RegExp(contract, 'i'))
})

test('normal receipt evidence is immutable while platform reset uses the existing narrow bypass', () => {
  assert.match(migration, /customer_receipt_evidence_is_immutable/i)
  assert.match(migration, /stockwise\.finance_transition_bypass/i)
  assert.match(migration, /delete from public\.customer_receipt_allocations[\s\S]*delete from public\.customer_receipts/i)
  assert.match(migration, /and public\.is_platform_admin\(\)/i)
})

test('the canonical AR view exposes customer, base currency, due and collections suppression evidence', () => {
  assert.match(migration, /create or replace view public\.v_customer_receivable_exposures/i)
  for (const column of [
    'customer_id', 'exposure_chain_id', 'anchor_kind', 'anchor_id', 'due_date',
    'base_currency_code', 'legacy_direct_settled_base', 'receipt_allocated_base',
    'outstanding_amount_base', 'collections_suppressed', 'collection_suppression_reason',
  ]) assert.match(migration, new RegExp(column, 'i'))
})

test('governed customer receipts pass the rollback-only local SQL behavior matrix', async (context) => {
  const sql = await readFile(new URL('./multi-settlement.sql', import.meta.url), 'utf8')
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_Stockwise', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )
  if (result.error?.code === 'ENOENT') {
    context.skip('Docker is unavailable; run when the local Supabase stack is active.')
    return
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const output = `${result.stdout}\n${result.stderr}`
  for (const proof of [
    'PASS one receipt -> three invoices -> one financial transaction',
    'PASS one receipt -> one invoice -> one financial transaction',
    'PASS receipt allocation channel evidence is coherent without double-counting',
    'PASS 25000 receipt -> zero allocations -> 25000 unallocated',
    'PASS existing credit -> later allocations -> no new financial transaction',
    'PASS append-only allocation reversal',
    'PASS receipt idempotency',
    'PASS allocation idempotency',
    'PASS wrong customer rejected',
    'PASS wrong company rejected',
    'PASS foreign currency rejected cleanly',
    'PASS receipt and invoice over-allocation rejected',
    'PASS direct mutation denied',
    'PASS finance authority enforced',
    'PASS stale membership email denied receipt evidence',
  ]) assert.match(output, new RegExp(proof.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
