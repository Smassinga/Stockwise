import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  companyBusinessDateYmd,
  validVendorBillDateSequence,
  vendorBillDraftDateDefaults,
} from '../../src/lib/vendorBillDraftDates.ts'
import {
  fetchFinanceReferenceMap,
  formatFinanceReference,
} from '../../src/lib/financeReferenceResolver.ts'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const purchaseOrders = await read('src/pages/Orders/PurchaseOrders.tsx')
const mzFinance = await read('src/lib/mzFinance.ts')
const cash = await read('src/pages/Cash.tsx')
const bank = await read('src/pages/BankDetail.tsx')
const settlements = await read('src/pages/Settlements.tsx')
const migration = await read('supabase/migrations/20260820175131_repair_finance_notification_truth.sql')

test('an old PO opens a documentary date form based on the company-local business day', () => {
  const now = new Date('2026-08-20T22:30:00.000Z')
  assert.equal(companyBusinessDateYmd('Africa/Maputo', now), '2026-08-21')

  const defaults = vendorBillDraftDateDefaults({
    timeZone: 'Africa/Maputo',
    paymentTermsId: 'net-30',
    paymentTermsText: 'Net 30',
    paymentTerms: [{ id: 'net-30', net_days: 30 }],
    now,
  })
  assert.deepEqual(defaults, {
    supplierInvoiceDate: '',
    billDate: '2026-08-21',
    dueDate: '2026-09-20',
  })
  assert.equal(validVendorBillDateSequence('2026-08-21', '2026-08-20'), false)
  assert.equal(validVendorBillDateSequence('2026-08-21', '2026-09-20'), true)
})

test('vendor bill documentary dates are deliberate state, not rerendered PO dates', () => {
  assert.match(purchaseOrders, /setVendorBillSupplierInvoiceDate\(defaults\.supplierInvoiceDate\)/)
  assert.match(purchaseOrders, /setVendorBillBillDate\(defaults\.billDate\)/)
  assert.match(purchaseOrders, /setVendorBillDueDate\(defaults\.dueDate\)/)
  assert.doesNotMatch(purchaseOrders, /supplierInvoiceDate\s*=\s*selectedPO\.order_date/)
  assert.doesNotMatch(purchaseOrders, /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,600}setVendorBillSupplierInvoiceDate[\s\S]{0,200}\},\s*\[selectedPO\]\)/)
  assert.match(purchaseOrders, /onChange=\{\(event\) => setVendorBillSupplierInvoiceDate\(event\.target\.value\)\}/)
  assert.match(purchaseOrders, /min=\{vendorBillBillDate \|\| undefined\}/)
  assert.match(mzFinance, /p_supplier_invoice_date:\s*supplierInvoiceDate/)
  assert.match(mzFinance, /p_bill_date:\s*billDate/)
  assert.match(mzFinance, /p_due_date:\s*dueDate/)
  assert.doesNotMatch(mzFinance, /normalizeText\(order\.due_date\)\s*\|\|\s*billDate/)
})

function referenceClient(rowsByTable) {
  return {
    from(table) {
      const state = { companyId: null, ids: [] }
      return {
        select() { return this },
        eq(column, value) {
          if (column === 'company_id') state.companyId = value
          return this
        },
        async in(column, ids) {
          if (column === 'id') state.ids = ids
          const data = (rowsByTable[table] || []).filter((row) => (
            row.company_id === state.companyId && state.ids.includes(row.id)
          ))
          return { data, error: null }
        },
      }
    },
  }
}

test('CR reference resolution is same-company and degrades safely', async () => {
  const client = referenceClient({
    customer_receipts: [
      { id: 'receipt-a', company_id: 'company-a', receipt_reference: 'RCT-2026-00000008' },
      { id: 'receipt-b', company_id: 'company-b', receipt_reference: 'RCT-OTHER' },
    ],
  })
  const map = await fetchFinanceReferenceMap(client, 'company-a', [
    { ref_type: 'CR', ref_id: 'receipt-a' },
    { ref_type: 'CR', ref_id: 'receipt-b' },
    { ref_type: 'CR', ref_id: 'missing-receipt' },
  ])

  assert.equal(formatFinanceReference('CR', 'receipt-a', map), 'CR RCT-2026-00000008')
  assert.equal(map['CR:receipt-b'], undefined)
  assert.equal(formatFinanceReference('CR', 'missing-receipt', map), 'CR missing-')
})

test('Cash and Bank share CR navigation and receipt detail survives refresh', () => {
  for (const source of [cash, bank]) {
    assert.match(source, /type === 'CR'/)
    assert.match(source, /view=receipts&side=ar&receiptId=/)
    assert.match(source, /companyId=/)
  }
  assert.match(settlements, /searchParams\.get\('receiptId'\)/)
  assert.match(settlements, /receipts\.find\(\(receipt\) => receipt\.id === requestedReceiptId\)/)
  assert.match(settlements, /params\.set\('receiptId', receipt\.id\)/)
  assert.match(settlements, /params\.delete\('receiptId'\)/)
})

test('receivables links expose the same SO/SI anchors and keep credit separate', () => {
  assert.match(migration, /view=exposure&side=ar&customerId=/)
  assert.match(settlements, /anchor_kind === 'sales_invoice' \? 'SI' : 'SO'/)
  assert.match(settlements, /Total open receivables/)
  assert.match(settlements, /Allocatable issued-invoice outstanding/)
  assert.match(settlements, /Unapplied credit \(separate\)/)
  assert.match(settlements, /Only issued Sales Invoices can receive allocations/)
})

test('notification migration is forward-only, deduplicated and least privilege', () => {
  assert.match(migration, /drop trigger if exists trg_po_status_notify on public\.purchase_orders/i)
  assert.doesNotMatch(migration, /drop trigger if exists tr_po_status_notify/i)
  assert.match(migration, /current_setting\('stockwise\.commercial_tax_operator_sale',true\)/i)
  assert.match(migration, /stockwise_sync_sales_order_awaiting_notification/)
  assert.match(migration, /stockwise_notify_company_roles/)
  assert.match(migration, /orders\.sales\.awaiting_approval/)
  assert.match(migration, /set resolved_at=coalesce\(n\.resolved_at,now\(\)\)/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.notifications/i)
  assert.match(migration, /set search_path=pg_catalog,public/g)
  assert.match(migration, /revoke all on function public\.stockwise_sync_sales_order_awaiting_notification[\s\S]*from public,anon,authenticated/i)
})
