import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('finance registers do not present draft documents as settlement anchors', async () => {
  const [sales, bills] = await Promise.all([
    read('src/pages/SalesInvoices.tsx'),
    read('src/pages/VendorBills.tsx'),
  ])

  assert.match(sales, /document_workflow_status === 'issued'/)
  assert.match(sales, /Settlement begins after issue/)
  assert.match(bills, /document_workflow_status === 'posted'/)
  assert.match(bills, /Settlement begins after posting/)
})

test('finance details gate settlement presentation until issue or posting', async () => {
  const [invoice, bill] = await Promise.all([
    read('src/pages/SalesInvoiceDetail.tsx'),
    read('src/pages/VendorBillDetail.tsx'),
  ])

  assert.match(invoice, /isIssued && invoiceState/)
  assert.match(invoice, /Settlement begins after this draft is issued/)
  assert.match(invoice, /Once issued, it becomes immutable legal evidence and the active receivable settlement anchor/)
  assert.match(bill, /document_workflow_status === 'posted'/)
  assert.match(bill, /Settlement begins after this draft is posted/)
  assert.match(bill, /This ends the draft workflow without posting it/)
})

test('finance summaries use restrained purposeful metric cards', async () => {
  const [component, sales, bills, settlements, cash, banks] = await Promise.all([
    read('src/components/finance/FinanceSummaryBand.tsx'),
    read('src/pages/SalesInvoices.tsx'),
    read('src/pages/VendorBills.tsx'),
    read('src/pages/Settlements.tsx'),
    read('src/pages/Cash.tsx'),
    read('src/pages/Banks.tsx'),
  ])

  assert.match(component, /<PremiumMetricCard/)
  assert.match(component, /className=\{cn\(\s*'grid gap-3'/)
  assert.doesNotMatch(component, /border-y border-border/)
  for (const source of [sales, bills, settlements, cash, banks]) {
    assert.match(source, /<FinanceSummaryBand/)
  }
})

test('transactions has explicit product states and a dedicated mobile register', async () => {
  const source = await read('src/pages/Transactions.tsx')

  assert.match(source, /<PremiumRegisterHeader/)
  assert.match(source, /<PremiumStatePanel/)
  assert.match(source, /md:hidden/)
  assert.match(source, /hidden overflow-x-auto border-y border-border md:block/)
  assert.match(source, /<PremiumStatusBadge/)
  assert.doesNotMatch(source, /(?:bg|text|border)-(?:red|rose|amber|yellow|green|emerald|blue|purple)-\d/)
})

test('substantially modified finance surfaces do not add decorative gradients or hover lift', async () => {
  const sources = await Promise.all([
    'src/pages/SalesInvoices.tsx',
    'src/pages/VendorBills.tsx',
    'src/pages/Settlements.tsx',
    'src/pages/Cash.tsx',
    'src/pages/Banks.tsx',
    'src/pages/Transactions.tsx',
  ].map(read))

  for (const source of sources) {
    assert.doesNotMatch(source, /bg-gradient|hover:-translate/)
  }
})
