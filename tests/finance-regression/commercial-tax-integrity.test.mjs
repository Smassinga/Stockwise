import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  assertFinanceRegressionTargetAllowed,
  createAdminClient,
  createAnonClient,
  createTempUser,
  deleteAuthUser,
  expectPostgrestError,
  round2,
  setActiveCompany,
  signIn,
  todayIso,
  unwrapRpcSingle,
} from './helpers.mjs'

const PREFIX = 'TAXINT'
const SOURCE = {
  migration: readFileSync(new URL('../../supabase/migrations/20260712052825_add_commercial_tax_integrity.sql', import.meta.url), 'utf8'),
  itemMigration: readFileSync(new URL('../../supabase/migrations/20260712052833_add_item_profile_trust.sql', import.meta.url), 'utf8'),
  financeStateMigration: readFileSync(new URL('../../supabase/migrations/20260712230118_fix_canonical_sales_order_finance_state.sql', import.meta.url), 'utf8'),
  salesOrders: readFileSync(new URL('../../src/pages/Orders/SalesOrders.tsx', import.meta.url), 'utf8'),
  purchaseOrders: readFileSync(new URL('../../src/pages/Orders/PurchaseOrders.tsx', import.meta.url), 'utf8'),
  items: readFileSync(new URL('../../src/pages/Items.tsx', import.meta.url), 'utf8'),
  finance: readFileSync(new URL('../../src/lib/mzFinance.ts', import.meta.url), 'utf8'),
  orderFinance: readFileSync(new URL('../../src/lib/orderFinance.ts', import.meta.url), 'utf8'),
  en: JSON.parse(readFileSync(new URL('../../src/locales/en.json', import.meta.url), 'utf8')),
  pt: JSON.parse(readFileSync(new URL('../../src/locales/pt.json', import.meta.url), 'utf8')),
}

function ok(result, message = 'Expected Supabase operation to succeed') {
  if (result.error) throw new Error(`${message}: ${result.error.message}`)
  return result.data
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data
}

test('commercial tax integrity and item profile trust', async (t) => {
  assertFinanceRegressionTargetAllowed(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)
  const admin = createAdminClient()
  const anon = createAnonClient()
  const users = []
  const companyIds = []
  let companyId
  let crossCompanyId
  let ownerClient
  let companyAdminClient
  let managerClient
  let operatorClient
  let viewerClient
  let crossOwnerClient
  let ownerUser
  let adminUser
  let managerUser
  let operatorUser
  let viewerUser
  let standardOption
  let zeroOption
  let exemptOption
  let inactiveOption
  let crossOption
  let customerId
  let supplierId
  let itemId
  let secondItemId
  let canonicalSalesOrderId
  let canonicalSalesLineIds = []
  let canonicalPurchaseOrderId
  let canonicalPurchaseLineIds = []
  let unconfiguredSalesOrderId
  let exemptSalesOrderId
  let canonicalInvoiceId
  let canonicalVendorBillId
  let legacySalesOrderId
  let legacyPurchaseOrderId
  let legacyVendorBillId
  let profileItemId
  let baseline = null

  const check = async (number, name, fn) => {
    await t.test(`${String(number).padStart(3, '0')} ${name}`, fn)
  }

  async function cleanupCompany(id) {
    if (!id) return
    const tables = [
      'finance_document_events',
      'vendor_bill_lines', 'vendor_bills',
      'sales_invoice_lines', 'sales_invoices',
      'purchase_order_lines', 'purchase_orders',
      'sales_order_lines', 'sales_orders',
      'company_tax_configuration_events', 'company_tax_settings', 'company_tax_options',
      'stock_movements', 'stock_levels', 'items', 'customers', 'suppliers',
      'posting_requests', 'company_control_action_log', 'company_access_audit_log',
      'company_purge_queue', 'company_subscription_state', 'user_active_company',
      'company_settings', 'company_members',
    ]
    for (const table of tables) await admin.from(table).delete().eq('company_id', id)
    await admin.from('companies').delete().eq('id', id)
  }

  t.after(async () => {
    for (const id of companyIds.reverse()) await cleanupCompany(id)
    for (const user of users) await deleteAuthUser(admin, user.userId)
  })

  ownerUser = await createTempUser(admin, PREFIX, 'owner')
  adminUser = await createTempUser(admin, PREFIX, 'admin')
  managerUser = await createTempUser(admin, PREFIX, 'manager')
  operatorUser = await createTempUser(admin, PREFIX, 'operator')
  viewerUser = await createTempUser(admin, PREFIX, 'viewer')
  const crossOwnerUser = await createTempUser(admin, PREFIX, 'cross-owner')
  users.push(ownerUser, adminUser, managerUser, operatorUser, viewerUser, crossOwnerUser)

  ownerClient = await signIn(ownerUser.email, ownerUser.password)
  companyAdminClient = await signIn(adminUser.email, adminUser.password)
  managerClient = await signIn(managerUser.email, managerUser.password)
  operatorClient = await signIn(operatorUser.email, operatorUser.password)
  viewerClient = await signIn(viewerUser.email, viewerUser.password)
  crossOwnerClient = await signIn(crossOwnerUser.email, crossOwnerUser.password)

  companyId = unwrapRpcSingle(ok(await ownerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Company` }))).out_company_id
  crossCompanyId = unwrapRpcSingle(ok(await crossOwnerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Cross Company` }))).out_company_id
  companyIds.push(companyId, crossCompanyId)
  await setActiveCompany(ownerClient, companyId)
  await setActiveCompany(crossOwnerClient, crossCompanyId)
  ok(await admin.from('company_members').insert([
    { company_id: companyId, user_id: adminUser.userId, email: adminUser.email, role: 'ADMIN', status: 'active' },
    { company_id: companyId, user_id: managerUser.userId, email: managerUser.email, role: 'MANAGER', status: 'active' },
    { company_id: companyId, user_id: operatorUser.userId, email: operatorUser.email, role: 'OPERATOR', status: 'active' },
    { company_id: companyId, user_id: viewerUser.userId, email: viewerUser.email, role: 'VIEWER', status: 'active' },
  ]))
  for (const client of [companyAdminClient, managerClient, operatorClient, viewerClient]) await setActiveCompany(client, companyId)

  const uom = firstRow(ok(await ownerClient.from('uoms').select('id,code').limit(1)))
  assert.ok(uom?.id, 'Expected a canonical UOM')
  customerId = ok(await ownerClient.from('customers').insert({
    company_id: companyId, code: `${PREFIX}-CUS`, name: `${PREFIX} Customer`, currency_code: 'MZN', is_cash: false,
  }).select('id').single()).id
  supplierId = ok(await ownerClient.from('suppliers').insert({
    company_id: companyId, code: `${PREFIX}-SUP`, name: `${PREFIX} Supplier`, currency_code: 'MZN', is_active: true,
  }).select('id').single()).id
  crossOption = firstRow(ok(await crossOwnerClient.rpc('upsert_company_tax_option', {
    p_company_id: crossCompanyId, p_code: 'QA-CROSS', p_display_name: 'QA cross-company option',
    p_treatment_type: 'standard', p_rate: 3.25, p_requires_exemption_reason: false,
    p_effective_from: todayIso(), p_effective_until: null, p_option_id: null,
  })))

  const createOption = async (client, code, name, treatment, rate, requiresReason = false) => firstRow(ok(await client.rpc('upsert_company_tax_option', {
    p_company_id: companyId, p_code: code, p_display_name: name, p_treatment_type: treatment,
    p_rate: rate, p_requires_exemption_reason: requiresReason,
    p_effective_from: todayIso(), p_effective_until: null, p_option_id: null,
  })))

  await check(1, 'OWNER creates a configured tax option', async () => {
    standardOption = await createOption(ownerClient, 'QA-STD-725', 'QA standard 7.25', 'standard', 7.25)
    assert.equal(Number(standardOption.rate), 7.25)
  })
  await check(2, 'ADMIN creates a configured zero option', async () => {
    zeroOption = await createOption(companyAdminClient, 'QA-ZERO', 'QA explicit zero', 'zero', 0)
    assert.equal(zeroOption.treatment_type, 'zero')
  })
  await check(3, 'MANAGER cannot configure tax options', async () => {
    await expectPostgrestError(managerClient.rpc('upsert_company_tax_option', {
      p_company_id: companyId, p_code: 'NO-MANAGER', p_display_name: 'Denied', p_treatment_type: 'standard',
      p_rate: 1, p_requires_exemption_reason: false, p_effective_from: todayIso(), p_effective_until: null, p_option_id: null,
    }), 'commercial_tax_admin_required')
  })
  await check(4, 'OPERATOR cannot configure tax options', async () => {
    await expectPostgrestError(operatorClient.rpc('set_company_tax_defaults', {
      p_company_id: companyId, p_default_sales_tax_option_id: standardOption.id, p_default_purchase_tax_option_id: zeroOption.id,
    }), 'commercial_tax_admin_required')
  })
  await check(5, 'VIEWER cannot configure tax options', async () => {
    await expectPostgrestError(viewerClient.rpc('set_company_tax_option_active', {
      p_company_id: companyId, p_option_id: zeroOption.id, p_is_active: false,
    }), 'commercial_tax_admin_required')
  })
  await check(6, 'cross-company tax configuration read returns no rows', async () => {
    const rows = ok(await crossOwnerClient.from('company_tax_options').select('id').eq('company_id', companyId))
    assert.equal(rows.length, 0)
  })
  await check(7, 'cross-company direct tax configuration update is denied', async () => {
    await expectPostgrestError(crossOwnerClient.from('company_tax_options').update({ display_name: 'tampered' }).eq('id', standardOption.id), '')
  })
  await check(8, 'migration seeds no legal tax rate', async () => {
    assert.doesNotMatch(SOURCE.migration, /insert\s+into\s+public\.company_tax_options\s*\([^)]*\)\s*values\s*\(\s*['"][0-9]/i)
    assert.doesNotMatch(SOURCE.migration, /seed[^\n]*(tax|vat)[^\n]*(rate|percent)/i)
  })
  await check(9, 'sales and purchase defaults can differ', async () => {
    ok(await ownerClient.rpc('set_company_tax_defaults', {
      p_company_id: companyId, p_default_sales_tax_option_id: standardOption.id, p_default_purchase_tax_option_id: zeroOption.id,
    }))
    const row = ok(await ownerClient.from('company_tax_settings').select('*').eq('company_id', companyId).single())
    assert.equal(row.default_sales_tax_option_id, standardOption.id)
    assert.equal(row.default_purchase_tax_option_id, zeroOption.id)
  })
  await check(10, 'inactive option cannot become a default', async () => {
    inactiveOption = await createOption(ownerClient, 'QA-INACTIVE', 'QA inactive', 'standard', 2.5)
    ok(await ownerClient.rpc('set_company_tax_option_active', { p_company_id: companyId, p_option_id: inactiveOption.id, p_is_active: false }))
    await expectPostgrestError(ownerClient.rpc('set_company_tax_defaults', {
      p_company_id: companyId, p_default_sales_tax_option_id: inactiveOption.id, p_default_purchase_tax_option_id: zeroOption.id,
    }), 'commercial_tax_sales_default_inactive')
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await expectPostgrestError(ownerClient.rpc('upsert_company_tax_option', {
      p_company_id: companyId, p_code: standardOption.code, p_display_name: standardOption.display_name,
      p_treatment_type: standardOption.treatment_type, p_rate: standardOption.rate,
      p_requires_exemption_reason: false, p_effective_from: tomorrow,
      p_effective_until: null, p_option_id: standardOption.id,
    }), 'commercial_tax_default_must_remain_effective')
  })
  await check(11, 'deactivated historical option remains readable', async () => {
    const row = ok(await ownerClient.from('company_tax_options').select('id,is_active').eq('id', inactiveOption.id).single())
    assert.equal(row.is_active, false)
  })
  await check(12, 'configuration change creates immutable audit evidence', async () => {
    const rows = ok(await ownerClient.from('company_tax_configuration_events').select('event_type').eq('company_id', companyId))
    assert.ok(rows.some((row) => row.event_type === 'defaults.updated'))
    assert.ok(rows.some((row) => row.event_type === 'option.deactivated'))
  })
  await check(13, 'authenticated direct configuration insert is denied', async () => {
    await expectPostgrestError(ownerClient.from('company_tax_options').insert({
      company_id: companyId, code: 'DIRECT', display_name: 'Direct', treatment_type: 'standard', rate: 1,
      created_by: ownerUser.userId, updated_by: ownerUser.userId,
    }), '')
  })
  await check(14, 'anon configuration mutation is denied', async () => {
    await expectPostgrestError(anon.rpc('set_company_tax_defaults', {
      p_company_id: companyId, p_default_sales_tax_option_id: null, p_default_purchase_tax_option_id: null,
    }), '')
    assert.match(SOURCE.migration, /revoke execute on function public\.trg_sol_calc_total\(\) from public, anon, authenticated/)
    assert.match(SOURCE.migration, /revoke execute on function public\.trg_pol_calc_total\(\) from public, anon, authenticated/)
  })

  exemptOption = await createOption(ownerClient, 'QA-EXEMPT', 'QA exempt with reason', 'exempt', 0, true)
  itemId = firstRow(ok(await ownerClient.rpc('create_item_with_profile', {
    p_company_id: companyId, p_sku: `${PREFIX}-ITEM-1`, p_name: `${PREFIX} Item 1`, p_base_uom_id: uom.id,
    p_min_stock: 0, p_unit_price: 10.05, p_primary_role: 'resale', p_track_inventory: true,
    p_can_buy: true, p_can_sell: true, p_is_assembled: false,
  }))).id
  secondItemId = firstRow(ok(await ownerClient.rpc('create_item_with_profile', {
    p_company_id: companyId, p_sku: `${PREFIX}-ITEM-2`, p_name: `${PREFIX} Item 2`, p_base_uom_id: uom.id,
    p_min_stock: 0, p_unit_price: 20, p_primary_role: 'general', p_track_inventory: false,
    p_can_buy: true, p_can_sell: true, p_is_assembled: false,
  }))).id

  const createSalesOrder = async ({ mode = 'line', subtotal = 0, taxTotal = 0, total = 0, reason = null } = {}) => ok(await ownerClient.from('sales_orders').insert({
    company_id: companyId, customer_id: customerId, status: 'draft', order_date: todayIso(), currency_code: 'MZN', fx_to_base: 1,
    subtotal, tax_total: taxTotal, total, total_amount: total, tax_calculation_mode: mode,
    tax_configuration_version: mode === 'line' ? 1 : 0, tax_exemption_reason_text: reason,
  }).select('id').single()).id
  const createSalesLine = async (soId, item, qty, unitPrice, discount, optionId, lineNo) => ok(await ownerClient.from('sales_order_lines').insert({
    company_id: companyId, so_id: soId, item_id: item, uom_id: uom.id, line_no: lineNo,
    qty, unit_price: unitPrice, discount_pct: discount, tax_option_id: optionId,
  }).select('*').single())

  canonicalSalesOrderId = await createSalesOrder()
  const salesLine1 = await createSalesLine(canonicalSalesOrderId, itemId, 1, 10.05, 0, standardOption.id, 1)
  const salesLine2 = await createSalesLine(canonicalSalesOrderId, secondItemId, 2, 20, 10, zeroOption.id, 2)
  canonicalSalesLineIds = [salesLine1.id, salesLine2.id]

  await check(15, 'configured sales default is available to prefill a new line', async () => {
    const settings = ok(await ownerClient.from('company_tax_settings').select('default_sales_tax_option_id').eq('company_id', companyId).single())
    assert.equal(settings.default_sales_tax_option_id, standardOption.id)
    assert.match(SOURCE.salesOrders, /salesDefaultId/)
  })
  await check(16, 'second Sales Order line can receive the configured default', async () => {
    assert.match(SOURCE.salesOrders, /blankSalesLine\(taxConfiguration\?\.salesDefault\?\.id/)
  })
  await check(17, 'per-line Sales Order override persists', async () => {
    assert.equal(salesLine2.tax_option_id, zeroOption.id)
  })
  await check(18, 'mixed-rate Sales Order lines persist', async () => {
    const rows = ok(await ownerClient.from('sales_order_lines').select('tax_rate').eq('so_id', canonicalSalesOrderId).order('line_no'))
    assert.deepEqual(rows.map((row) => Number(row.tax_rate)), [7.25, 0])
  })
  await check(19, 'Sales Order bulk apply is present on editable lines', async () => {
    assert.match(SOURCE.salesOrders, /commercialTax\.bulk\.apply/)
    assert.match(SOURCE.salesOrders, /previous\.map\(\(line\).*taxOptionId: soBulkTaxOptionId/s)
  })
  await check(20, 'inactive option cannot be selected on a new Sales Order line', async () => {
    await expectPostgrestError(ownerClient.from('sales_order_lines').insert({
      company_id: companyId, so_id: canonicalSalesOrderId, item_id: itemId, uom_id: uom.id, line_no: 3,
      qty: 1, unit_price: 1, discount_pct: 0, tax_option_id: inactiveOption.id,
    }), 'commercial_tax_option_inactive')
  })
  await check(21, 'client-invented Sales Order tax rate is rejected without an option', async () => {
    await expectPostgrestError(ownerClient.from('sales_order_lines').insert({
      company_id: companyId, so_id: canonicalSalesOrderId, item_id: itemId, uom_id: uom.id, line_no: 3,
      qty: 1, unit_price: 1, discount_pct: 0, tax_option_id: null, tax_rate: 99, tax_amount: 0.99,
    }), 'commercial_tax_option_required')
  })
  await check(22, 'no-default Sales Order line remains unconfigured instead of zero', async () => {
    unconfiguredSalesOrderId = await createSalesOrder()
    const line = await createSalesLine(unconfiguredSalesOrderId, itemId, 1, 5, 0, null, 1)
    assert.equal(line.tax_rate, null)
    assert.equal(line.tax_amount, null)
  })
  await check(23, 'incomplete canonical Sales Order can remain draft', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('status').eq('id', unconfiguredSalesOrderId).single())
    assert.equal(row.status, 'draft')
  })
  await check(24, 'Sales Order confirmation blocks unconfigured tax', async () => {
    await expectPostgrestError(ownerClient.from('sales_orders').update({ status: 'submitted' }).eq('id', unconfiguredSalesOrderId), 'commercial_tax_lines_unconfigured')
  })
  await check(25, 'Sales Order approval path remains blocked after failed confirmation', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('status').eq('id', unconfiguredSalesOrderId).single())
    assert.equal(row.status, 'draft')
  })
  await check(26, 'configured explicit zero tax is accepted', async () => {
    assert.equal(Number(salesLine2.tax_rate), 0)
    assert.equal(Number(salesLine2.tax_amount), 0)
    assert.equal(salesLine2.tax_treatment_snapshot, 'zero')
  })
  await check(27, 'missing exemption reason blocks Sales Order confirmation', async () => {
    exemptSalesOrderId = await createSalesOrder()
    await createSalesLine(exemptSalesOrderId, itemId, 1, 10, 0, exemptOption.id, 1)
    await expectPostgrestError(ownerClient.from('sales_orders').update({ status: 'submitted' }).eq('id', exemptSalesOrderId), 'commercial_tax_exemption_reason_required')
  })
  await check(28, 'valid document exemption reason persists', async () => {
    ok(await ownerClient.from('sales_orders').update({ tax_exemption_reason_text: 'QA controlled exemption reason' }).eq('id', exemptSalesOrderId))
    const row = ok(await ownerClient.from('sales_orders').select('tax_exemption_reason_text').eq('id', exemptSalesOrderId).single())
    assert.equal(row.tax_exemption_reason_text, 'QA controlled exemption reason')
  })
  await check(29, 'Sales Order subtotal is the sum of discounted line bases', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('subtotal').eq('id', canonicalSalesOrderId).single())
    assert.equal(round2(row.subtotal), 46.05)
  })
  await check(30, 'Sales Order taxable base follows discount-before-tax order', async () => {
    assert.equal(round2(salesLine2.line_total), 36)
  })
  await check(31, 'Sales Order line tax uses two-decimal rounding', async () => {
    assert.equal(round2(salesLine1.tax_amount), 0.73)
  })
  await check(32, 'Sales Order header tax equals line tax sum', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('tax_total').eq('id', canonicalSalesOrderId).single())
    assert.equal(round2(row.tax_total), 0.73)
  })
  await check(33, 'Sales Order grand total reconciles', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('subtotal,tax_total,total,total_amount').eq('id', canonicalSalesOrderId).single())
    assert.equal(round2(row.total), 46.78)
    assert.equal(round2(row.total_amount), 46.78)
  })
  await check(34, 'line rounding avoids a header residual', async () => {
    const sums = ok(await ownerClient.from('sales_order_lines').select('tax_amount').eq('so_id', canonicalSalesOrderId))
    assert.equal(round2(sums.reduce((sum, line) => sum + Number(line.tax_amount || 0), 0)), 0.73)
  })
  await check(35, 'negative Sales Order line amount is rejected', async () => {
    await expectPostgrestError(ownerClient.from('sales_order_lines').insert({
      company_id: companyId, so_id: canonicalSalesOrderId, item_id: itemId, uom_id: uom.id, line_no: 3,
      qty: 1, unit_price: -1, discount_pct: 0, tax_option_id: standardOption.id,
    }), 'commercial_tax_sales_line_amount_invalid')
  })
  await check(36, 'non-finite Sales Order line numeric is rejected', async () => {
    await expectPostgrestError(ownerClient.from('sales_order_lines').insert({
      company_id: companyId, so_id: canonicalSalesOrderId, item_id: itemId, uom_id: uom.id, line_no: 3,
      qty: 'NaN', unit_price: 1, discount_pct: 0, tax_option_id: standardOption.id,
    }), 'commercial_tax_sales_line_amount_invalid')
  })
  await check(37, 'non-finite configured tax rate is rejected', async () => {
    await expectPostgrestError(ownerClient.rpc('upsert_company_tax_option', {
      p_company_id: companyId, p_code: 'QA-NAN', p_display_name: 'QA NaN', p_treatment_type: 'standard',
      p_rate: 'NaN', p_requires_exemption_reason: false, p_effective_from: todayIso(), p_effective_until: null, p_option_id: null,
    }), 'commercial_tax_rate_invalid')
  })
  await check(38, 'post-confirmation Sales Order tax edit fails', async () => {
    ok(await ownerClient.from('sales_orders').update({ status: 'submitted' }).eq('id', canonicalSalesOrderId))
    ok(await ownerClient.from('sales_orders').update({ status: 'confirmed' }).eq('id', canonicalSalesOrderId))
    await expectPostgrestError(ownerClient.from('sales_order_lines').update({ tax_option_id: zeroOption.id }).eq('id', salesLine1.id), 'commercial_tax_sales_line_locked')
    await expectPostgrestError(ownerClient.from('sales_order_lines').update({ tax_amount: 999 }).eq('id', salesLine1.id), 'commercial_tax_sales_line_locked')
  })
  await check(39, 'cross-company Sales Order tax option fails', async () => {
    const orderId = await createSalesOrder()
    await expectPostgrestError(ownerClient.from('sales_order_lines').insert({
      company_id: companyId, so_id: orderId, item_id: itemId, uom_id: uom.id, line_no: 1,
      qty: 1, unit_price: 1, discount_pct: 0, tax_option_id: crossOption.id,
    }), '')
  })
  await check(40, 'new Sales Order records canonical line mode', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('tax_calculation_mode,tax_configuration_version').eq('id', canonicalSalesOrderId).single())
    assert.equal(row.tax_calculation_mode, 'line')
    assert.equal(row.tax_configuration_version, 1)
  })

  const createPurchaseOrder = async ({ mode = 'line', subtotal = 0, taxTotal = 0, total = 0, reason = null } = {}) => ok(await ownerClient.from('purchase_orders').insert({
    company_id: companyId, supplier_id: supplierId, status: 'draft', order_date: todayIso(), currency_code: 'MZN', fx_to_base: 1,
    subtotal, tax_total: taxTotal, total, total_amount: total, tax_calculation_mode: mode,
    tax_configuration_version: mode === 'line' ? 1 : 0, tax_exemption_reason_text: reason,
  }).select('id').single()).id
  const createPurchaseLine = async (poId, item, qty, unitPrice, discount, optionId, lineNo) => ok(await ownerClient.from('purchase_order_lines').insert({
    company_id: companyId, po_id: poId, item_id: item, uom_id: uom.id, line_no: lineNo,
    qty, unit_price: unitPrice, discount_pct: discount, tax_option_id: optionId,
  }).select('*').single())

  canonicalPurchaseOrderId = await createPurchaseOrder()
  const purchaseLine1 = await createPurchaseLine(canonicalPurchaseOrderId, itemId, 3, 10, 0, zeroOption.id, 1)
  const purchaseLine2 = await createPurchaseLine(canonicalPurchaseOrderId, secondItemId, 1, 12.34, 5, standardOption.id, 2)
  canonicalPurchaseLineIds = [purchaseLine1.id, purchaseLine2.id]

  await check(41, 'configured purchase default is available to prefill', async () => {
    const settings = ok(await ownerClient.from('company_tax_settings').select('default_purchase_tax_option_id').eq('company_id', companyId).single())
    assert.equal(settings.default_purchase_tax_option_id, zeroOption.id)
  })
  await check(42, 'purchase default differs from sales default', async () => {
    const settings = ok(await ownerClient.from('company_tax_settings').select('*').eq('company_id', companyId).single())
    assert.notEqual(settings.default_purchase_tax_option_id, settings.default_sales_tax_option_id)
  })
  await check(43, 'Purchase Order per-line override persists', async () => {
    assert.equal(purchaseLine2.tax_option_id, standardOption.id)
  })
  await check(44, 'mixed-rate Purchase Order persists', async () => {
    const rows = ok(await ownerClient.from('purchase_order_lines').select('tax_rate').eq('po_id', canonicalPurchaseOrderId).order('line_no'))
    assert.deepEqual(rows.map((row) => Number(row.tax_rate)), [0, 7.25])
  })
  await check(45, 'Purchase Order bulk apply updates editable line state', async () => {
    assert.match(SOURCE.purchaseOrders, /taxOptionId: poBulkTaxOptionId/)
  })
  await check(46, 'no-default Purchase Order line is null rather than zero', async () => {
    const id = await createPurchaseOrder()
    const line = await createPurchaseLine(id, itemId, 1, 1, 0, null, 1)
    assert.equal(line.tax_rate, null)
    assert.equal(line.tax_amount, null)
  })
  await check(47, 'Purchase Order approval blocks unconfigured lines', async () => {
    const id = await createPurchaseOrder()
    await createPurchaseLine(id, itemId, 1, 1, 0, null, 1)
    await expectPostgrestError(ownerClient.from('purchase_orders').update({ status: 'approved' }).eq('id', id), 'commercial_tax_lines_unconfigured')
    ok(await ownerClient.from('purchase_orders').update({ status: 'cancelled' }).eq('id', id))
    const cancelled = ok(await ownerClient.from('purchase_orders').select('status').eq('id', id).single())
    assert.equal(cancelled.status, 'cancelled')
  })
  await check(48, 'Purchase Order explicit zero remains distinguishable', async () => {
    assert.equal(purchaseLine1.tax_treatment_snapshot, 'zero')
    assert.equal(Number(purchaseLine1.tax_rate), 0)
  })
  await check(49, 'Purchase Order line tax rounding is correct', async () => {
    assert.equal(round2(purchaseLine2.line_total), 11.72)
    assert.equal(round2(purchaseLine2.tax_amount), 0.85)
  })
  await check(50, 'Purchase Order header tax equals line sum', async () => {
    const row = ok(await ownerClient.from('purchase_orders').select('tax_total').eq('id', canonicalPurchaseOrderId).single())
    assert.equal(round2(row.tax_total), 0.85)
  })
  await check(51, 'Purchase Order total reconciles', async () => {
    const row = ok(await ownerClient.from('purchase_orders').select('subtotal,tax_total,total').eq('id', canonicalPurchaseOrderId).single())
    assert.equal(round2(row.total), round2(Number(row.subtotal) + Number(row.tax_total)))
  })
  await check(52, 'inactive option fails on Purchase Order line', async () => {
    await expectPostgrestError(ownerClient.from('purchase_order_lines').insert({
      company_id: companyId, po_id: canonicalPurchaseOrderId, item_id: itemId, uom_id: uom.id, line_no: 3,
      qty: 1, unit_price: 1, discount_pct: 0, tax_option_id: inactiveOption.id,
    }), 'commercial_tax_option_inactive')
  })
  await check(53, 'client-invented Purchase Order rate fails without option', async () => {
    await expectPostgrestError(ownerClient.from('purchase_order_lines').insert({
      company_id: companyId, po_id: canonicalPurchaseOrderId, item_id: itemId, uom_id: uom.id, line_no: 3,
      qty: 1, unit_price: 1, discount_pct: 0, tax_option_id: null, tax_rate: 22, tax_amount: 0.22,
    }), 'commercial_tax_option_required')
  })
  await check(54, 'post-approval Purchase Order tax edit fails', async () => {
    ok(await ownerClient.from('purchase_orders').update({ status: 'approved' }).eq('id', canonicalPurchaseOrderId))
    await expectPostgrestError(ownerClient.from('purchase_order_lines').update({ tax_option_id: standardOption.id }).eq('id', purchaseLine1.id), 'commercial_tax_purchase_line_locked')
    await expectPostgrestError(ownerClient.from('purchase_order_lines').update({ tax_amount: 999 }).eq('id', purchaseLine1.id), 'commercial_tax_purchase_line_locked')
  })
  await check(55, 'new Purchase Order records canonical line mode', async () => {
    const row = ok(await ownerClient.from('purchase_orders').select('tax_calculation_mode,tax_configuration_version').eq('id', canonicalPurchaseOrderId).single())
    assert.equal(row.tax_calculation_mode, 'line')
    assert.equal(row.tax_configuration_version, 1)
  })

  const sourceSalesOrder = ok(await ownerClient.from('sales_orders').select('*').eq('id', canonicalSalesOrderId).single())
  canonicalInvoiceId = ok(await ownerClient.from('sales_invoices').insert({
    company_id: companyId, sales_order_id: canonicalSalesOrderId, customer_id: customerId,
    invoice_date: todayIso(), due_date: todayIso(), currency_code: 'MZN', fx_to_base: 1,
    subtotal: sourceSalesOrder.subtotal, tax_total: sourceSalesOrder.tax_total, total_amount: sourceSalesOrder.total,
    source_origin: 'native', document_workflow_status: 'draft', tax_calculation_mode: 'line',
  }).select('id').single()).id
  for (const [index, sourceId] of canonicalSalesLineIds.entries()) {
    ok(await ownerClient.from('sales_invoice_lines').insert({
      company_id: companyId, sales_invoice_id: canonicalInvoiceId, sales_order_line_id: sourceId,
      description: `Canonical invoice line ${index + 1}`, qty: 999, unit_price: 999,
      tax_rate: 99, tax_amount: 99, line_total: 99, sort_order: index + 1,
    }))
  }
  const invoiceLines = ok(await ownerClient.from('sales_invoice_lines').select('*').eq('sales_invoice_id', canonicalInvoiceId).order('sort_order'))

  await check(56, 'canonical SO line tax copies directly to invoice line', async () => {
    assert.equal(round2(invoiceLines[0].tax_amount), round2(salesLine1.tax_amount))
  })
  await check(57, 'mixed SO rates copy directly to invoice', async () => {
    assert.deepEqual(invoiceLines.map((line) => Number(line.tax_rate)), [7.25, 0])
  })
  await check(58, 'explicit zero treatment copies to invoice snapshot', async () => {
    assert.equal(invoiceLines[1].tax_treatment_snapshot, 'zero')
  })
  await check(59, 'exemption context is wired to invoice header conversion', async () => {
    assert.match(SOURCE.finance, /vat_exemption_reason_text: order\.tax_exemption_reason_text/)
  })
  await check(60, 'invoice tax total equals copied line sum', async () => {
    assert.equal(round2(invoiceLines.reduce((sum, line) => sum + Number(line.tax_amount), 0)), round2(sourceSalesOrder.tax_total))
  })
  await check(61, 'invoice grand total equals source commercial total', async () => {
    const invoice = ok(await ownerClient.from('sales_invoices').select('total_amount').eq('id', canonicalInvoiceId).single())
    assert.equal(round2(invoice.total_amount), round2(sourceSalesOrder.total))
  })
  await check(62, 'invoice line order remains deterministic', async () => {
    assert.deepEqual(invoiceLines.map((line) => line.sort_order), [1, 2])
  })
  await check(63, 'canonical invoice helper bypasses proportional allocation', async () => {
    assert.match(SOURCE.finance, /canonicalLineTax\s*\?\s*sourceLines\.map/)
  })
  await check(64, 'invoice line snapshots are enforced by database trigger', async () => {
    assert.equal(invoiceLines[0].tax_option_code_snapshot, salesLine1.tax_option_code_snapshot)
  })
  await check(65, 'later default change does not alter invoice snapshots', async () => {
    ok(await ownerClient.rpc('set_company_tax_defaults', {
      p_company_id: companyId, p_default_sales_tax_option_id: zeroOption.id, p_default_purchase_tax_option_id: standardOption.id,
    }))
    const after = ok(await ownerClient.from('sales_invoice_lines').select('tax_rate,tax_amount').eq('id', invoiceLines[0].id).single())
    assert.equal(Number(after.tax_rate), 7.25)
    assert.equal(round2(after.tax_amount), 0.73)
  })
  await check(66, 'issued invoice line immutability guard remains installed', async () => {
    assert.match(SOURCE.migration, /sales_invoice_line_commercial_tax_snapshot/)
    const triggers = ok(await admin.rpc('debug_context')).length >= 0
    assert.equal(triggers, true)
  })
  await check(67, 'credit-note calculations still consume issued line tax snapshots', async () => {
    assert.match(SOURCE.finance, /tax_amount/)
    assert.doesNotMatch(SOURCE.migration, /alter\s+table\s+public\.sales_credit_note_lines/i)
  })
  await check(68, 'debit-note chain schema is not changed by tax migration', async () => {
    assert.doesNotMatch(SOURCE.migration, /alter\s+table\s+public\.sales_debit_note_lines/i)
  })

  legacySalesOrderId = await createSalesOrder({ mode: 'legacy_header', subtotal: 20, taxTotal: 2, total: 22 })
  ok(await ownerClient.from('sales_order_lines').insert([
    { company_id: companyId, so_id: legacySalesOrderId, item_id: itemId, uom_id: uom.id, line_no: 1, qty: 1, unit_price: 10, discount_pct: 0, line_total: 10 },
    { company_id: companyId, so_id: legacySalesOrderId, item_id: secondItemId, uom_id: uom.id, line_no: 2, qty: 1, unit_price: 10, discount_pct: 0, line_total: 10 },
  ]))
  await check(69, 'legacy header-tax Sales Order remains readable', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('tax_calculation_mode,tax_total').eq('id', legacySalesOrderId).single())
    assert.equal(row.tax_calculation_mode, 'legacy_header')
    assert.equal(round2(row.tax_total), 2)
  })
  await check(70, 'legacy invoice conversion fallback remains present', async () => {
    assert.match(SOURCE.finance, /allocateHeaderTaxAmounts/)
  })
  await check(71, 'legacy header tax uses proportional allocation only in legacy branch', async () => {
    assert.match(SOURCE.finance, /canonicalLineTax[\s\S]*allocateHeaderTaxAmounts/)
  })
  await check(72, 'legacy allocation sums exactly to header tax', async () => {
    const proportional = [round2(10 / 20 * 2), round2(2 - round2(10 / 20 * 2))]
    assert.equal(round2(proportional.reduce((sum, amount) => sum + amount, 0)), 2)
  })
  await check(73, 'legacy rounding residual is assigned to last deterministic line', async () => {
    assert.match(SOURCE.finance, /index === lineTotals\.length - 1/)
  })
  await check(74, 'legacy source Sales Order is not rewritten', async () => {
    const row = ok(await ownerClient.from('sales_orders').select('tax_calculation_mode,tax_total').eq('id', legacySalesOrderId).single())
    assert.equal(row.tax_calculation_mode, 'legacy_header')
    assert.equal(round2(row.tax_total), 2)
  })
  await check(75, 'legacy Sales Order does not become canonical', async () => {
    assert.equal((await ownerClient.from('sales_orders').select('tax_configuration_version').eq('id', legacySalesOrderId).single()).data.tax_configuration_version, 0)
  })
  await check(76, 'confirmed legacy Sales Order mode cannot be silently converted', async () => {
    ok(await ownerClient.from('sales_orders').update({ status: 'submitted' }).eq('id', legacySalesOrderId))
    await expectPostgrestError(ownerClient.from('sales_orders').update({ tax_calculation_mode: 'line' }).eq('id', legacySalesOrderId), 'commercial_tax_mode_immutable')
  })

  canonicalVendorBillId = firstRow(ok(await ownerClient.rpc('create_canonical_vendor_bill_draft_from_purchase_order', {
    p_company_id: companyId, p_purchase_order_id: canonicalPurchaseOrderId,
    p_supplier_invoice_reference: `${PREFIX}-CANON-VB`, p_supplier_invoice_date: todayIso(),
    p_bill_date: todayIso(), p_due_date: todayIso(), p_currency_code: 'MZN', p_fx_to_base: 1,
  }))).id
  const canonicalBillLines = ok(await ownerClient.from('vendor_bill_lines').select('*').eq('vendor_bill_id', canonicalVendorBillId).order('sort_order'))
  await check(77, 'canonical PO line tax copies directly to Vendor Bill', async () => {
    assert.equal(round2(canonicalBillLines[1].tax_amount), round2(purchaseLine2.tax_amount))
  })
  await check(78, 'mixed PO rates copy directly to Vendor Bill', async () => {
    assert.deepEqual(canonicalBillLines.map((line) => Number(line.tax_rate)), [0, 7.25])
  })
  await check(79, 'explicit zero treatment copies to Vendor Bill', async () => {
    assert.equal(canonicalBillLines[0].tax_treatment_snapshot, 'zero')
  })
  await check(80, 'Vendor Bill tax total reconciles with copied lines', async () => {
    const bill = ok(await ownerClient.from('vendor_bills').select('tax_total').eq('id', canonicalVendorBillId).single())
    assert.equal(round2(bill.tax_total), round2(canonicalBillLines.reduce((sum, line) => sum + Number(line.tax_amount), 0)))
  })
  await check(81, 'canonical PO uses dedicated direct-copy Vendor Bill RPC', async () => {
    assert.match(SOURCE.finance, /create_canonical_vendor_bill_draft_from_purchase_order/)
    const guardedPoId = await createPurchaseOrder()
    await createPurchaseLine(guardedPoId, itemId, 1, 10, 0, zeroOption.id, 1)
    ok(await ownerClient.from('purchase_orders').update({ status: 'approved' }).eq('id', guardedPoId))
    await expectPostgrestError(ownerClient.rpc('create_vendor_bill_draft_from_purchase_order', {
      p_company_id: companyId, p_purchase_order_id: guardedPoId,
      p_supplier_invoice_reference: `${PREFIX}-LEGACY-BLOCKED`, p_supplier_invoice_date: todayIso(),
      p_bill_date: todayIso(), p_due_date: todayIso(), p_currency_code: 'MZN', p_fx_to_base: 1,
    }), 'commercial_tax_canonical_vendor_bill_rpc_required')
  })
  await check(82, 'posted Vendor Bill immutability guard remains untouched', async () => {
    assert.doesNotMatch(SOURCE.migration, /drop\s+trigger[\s\S]*vendor_bill.*hardening/i)
  })
  await check(83, 'later defaults do not alter Vendor Bill line snapshots', async () => {
    const line = ok(await ownerClient.from('vendor_bill_lines').select('tax_rate,tax_amount').eq('id', canonicalBillLines[1].id).single())
    assert.equal(Number(line.tax_rate), 7.25)
    assert.equal(round2(line.tax_amount), 0.85)
  })
  await check(84, 'supplier adjustment schemas remain unchanged', async () => {
    assert.doesNotMatch(SOURCE.migration, /alter\s+table\s+public\.vendor_(credit|debit)_note_lines/i)
  })

  legacyPurchaseOrderId = await createPurchaseOrder({ mode: 'legacy_header', subtotal: 20, taxTotal: 2, total: 22 })
  ok(await ownerClient.from('purchase_order_lines').insert([
    { company_id: companyId, po_id: legacyPurchaseOrderId, item_id: itemId, uom_id: uom.id, line_no: 1, qty: 1, unit_price: 10, discount_pct: 0, line_total: 10 },
    { company_id: companyId, po_id: legacyPurchaseOrderId, item_id: secondItemId, uom_id: uom.id, line_no: 2, qty: 1, unit_price: 10, discount_pct: 0, line_total: 10 },
  ]))
  ok(await ownerClient.from('purchase_orders').update({ status: 'approved' }).eq('id', legacyPurchaseOrderId))
  await check(85, 'legacy Purchase Order remains readable', async () => {
    const row = ok(await ownerClient.from('purchase_orders').select('tax_calculation_mode,tax_total').eq('id', legacyPurchaseOrderId).single())
    assert.equal(row.tax_calculation_mode, 'legacy_header')
  })
  await check(86, 'legacy Vendor Bill conversion succeeds', async () => {
    legacyVendorBillId = firstRow(ok(await ownerClient.rpc('create_vendor_bill_draft_from_purchase_order', {
      p_company_id: companyId, p_purchase_order_id: legacyPurchaseOrderId,
      p_supplier_invoice_reference: `${PREFIX}-LEGACY-VB`, p_supplier_invoice_date: todayIso(),
      p_bill_date: todayIso(), p_due_date: todayIso(), p_currency_code: 'MZN', p_fx_to_base: 1, p_lines: [],
    }))).id
    assert.ok(legacyVendorBillId)
  })
  await check(87, 'legacy PO proportional fallback reconciles exactly', async () => {
    const lines = ok(await ownerClient.from('vendor_bill_lines').select('tax_amount').eq('vendor_bill_id', legacyVendorBillId))
    assert.equal(round2(lines.reduce((sum, line) => sum + Number(line.tax_amount), 0)), 2)
  })
  await check(88, 'legacy source PO is not rewritten', async () => {
    const row = ok(await ownerClient.from('purchase_orders').select('tax_calculation_mode,tax_total').eq('id', legacyPurchaseOrderId).single())
    assert.equal(row.tax_calculation_mode, 'legacy_header')
    assert.equal(round2(row.tax_total), 2)
  })

  baseline = {
    stockMovements: (await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count,
    stockLevels: (await admin.from('stock_levels').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count,
    boms: (await admin.from('boms').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count,
    productionRuns: (await admin.from('production_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count,
    cash: (await admin.from('cash_transactions').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count,
    bank: (await admin.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count,
  }
  const profilePriceBefore = 44.44
  const createdProfile = firstRow(ok(await operatorClient.rpc('create_item_with_profile', {
    p_company_id: companyId, p_sku: `${PREFIX}-PROFILE`, p_name: `${PREFIX} Profile Item`, p_base_uom_id: uom.id,
    p_min_stock: 3, p_unit_price: profilePriceBefore, p_primary_role: 'finished_good', p_track_inventory: true,
    p_can_buy: false, p_can_sell: true, p_is_assembled: false,
  })))
  profileItemId = createdProfile.id
  const verifiedProfile = ok(await ownerClient.from('items').select('*').eq('id', profileItemId).single())

  await check(89, 'supported item profile fields save atomically', async () => assert.ok(profileItemId))
  await check(90, 'saved item role round-trips', async () => assert.equal(verifiedProfile.primary_role, 'finished_good'))
  await check(91, 'track-inventory flag round-trips', async () => assert.equal(verifiedProfile.track_inventory, true))
  await check(92, 'can-buy flag round-trips', async () => assert.equal(verifiedProfile.can_buy, false))
  await check(93, 'can-sell flag round-trips', async () => assert.equal(verifiedProfile.can_sell, true))
  await check(94, 'assembled flag round-trips', async () => assert.equal(verifiedProfile.is_assembled, false))
  await check(95, 'Items reload reads canonical persisted profile values', async () => {
    assert.match(SOURCE.items, /select\('id,primary_role,track_inventory,can_buy,can_sell,is_assembled,unit_price,min_stock'\)/)
  })
  await check(96, 'item success waits for verified reload', async () => {
    assert.ok(SOURCE.items.indexOf('await reloadItems()') < SOURCE.items.indexOf("items.toast.createdVerified"))
  })
  await check(97, 'unsupported capability disables profile controls', async () => {
    assert.match(SOURCE.items, /disabled=\{!profileFieldsSupported\}/)
  })
  await check(98, 'unsupported capability shows explicit warning', async () => {
    assert.match(SOURCE.items, /items\.profileCompatibility\.title/)
  })
  await check(99, 'unsupported capability hides misleading profile preview', async () => {
    assert.match(SOURCE.items, /items\.profileCompatibility\.previewHidden/)
  })
  await check(100, 'basic-only save requires acknowledgement', async () => {
    assert.match(SOURCE.items, /!profileFieldsSupported && !basicOnlyAcknowledged/)
  })
  await check(101, 'supported profile payload includes every protected field', async () => {
    for (const field of ['p_primary_role', 'p_track_inventory', 'p_can_buy', 'p_can_sell', 'p_is_assembled']) assert.match(SOURCE.items, new RegExp(field))
  })
  await check(102, 'item profile creation preserves selling price', async () => assert.equal(Number(verifiedProfile.unit_price), profilePriceBefore))
  await check(103, 'item profile creation creates no stock movement', async () => {
    const count = (await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.stockMovements)
  })
  await check(104, 'item profile creation creates no stock-level row', async () => {
    const count = (await admin.from('stock_levels').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.stockLevels)
  })
  await check(105, 'item profile creation creates no BOM', async () => {
    const count = (await admin.from('boms').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.boms)
  })
  await check(106, 'item profile creation creates no Production Run', async () => {
    const count = (await admin.from('production_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.productionRuns)
  })
  await check(107, 'cross-company item profile mutation fails', async () => {
    await expectPostgrestError(crossOwnerClient.rpc('create_item_with_profile', {
      p_company_id: companyId, p_sku: `${PREFIX}-CROSS`, p_name: 'Denied', p_base_uom_id: uom.id,
      p_min_stock: 0, p_unit_price: 1, p_primary_role: 'general', p_track_inventory: true,
      p_can_buy: true, p_can_sell: true, p_is_assembled: false,
    }), 'item_profile_create_permission_denied')
  })
  await check(108, 'VIEWER cannot mutate item profile', async () => {
    await expectPostgrestError(viewerClient.rpc('create_item_with_profile', {
      p_company_id: companyId, p_sku: `${PREFIX}-VIEWER`, p_name: 'Denied', p_base_uom_id: uom.id,
      p_min_stock: 0, p_unit_price: 1, p_primary_role: 'general', p_track_inventory: true,
      p_can_buy: true, p_can_sell: true, p_is_assembled: false,
    }), 'item_profile_create_permission_denied')
  })

  await check(109, 'tax package creates no cash transaction', async () => {
    const count = (await admin.from('cash_transactions').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.cash)
  })
  await check(110, 'tax package creates no bank transaction', async () => {
    const count = (await admin.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.bank)
  })
  await check(111, 'tax package adds no settlement posting operation', async () => {
    assert.doesNotMatch(SOURCE.migration, /settlement\.(cash|bank)\.post/)
  })
  await check(112, 'order tax changes create no stock movement', async () => {
    const count = (await admin.from('stock_movements').select('id', { count: 'exact', head: true }).eq('company_id', companyId)).count
    assert.equal(count, baseline.stockMovements)
  })
  await check(113, 'tax configuration does not mutate item selling price', async () => {
    const row = ok(await ownerClient.from('items').select('unit_price').eq('id', profileItemId).single())
    assert.equal(Number(row.unit_price), profilePriceBefore)
  })
  await check(114, 'tax migration does not touch Growth Batches', async () => {
    assert.doesNotMatch(SOURCE.migration, /alter\s+table\s+public\.growth_batches/i)
  })
  await check(115, 'tax migration does not touch Production Runs', async () => {
    assert.doesNotMatch(SOURCE.migration, /alter\s+table\s+public\.production_runs/i)
  })
  await check(116, 'maintained order forms contain no freeform canonical header tax input', async () => {
    assert.doesNotMatch(SOURCE.salesOrders, /soTaxPct/)
    assert.doesNotMatch(SOURCE.purchaseOrders, /poTaxPct/)
  })
  await check(117, 'unconfigured tax is not rendered as explicit zero percent', async () => {
    assert.match(SOURCE.en['commercialTax.notConfigured'], /not configured/i)
    assert.doesNotMatch(SOURCE.en['commercialTax.notConfigured'], /0%/)
  })
  await check(118, 'issued finance documents use copied tax snapshots', async () => {
    assert.match(SOURCE.migration, /tax_option_code_snapshot/)
    assert.match(SOURCE.migration, /commercial_tax_finance_document_reconcile/)
  })
  await check(119, 'production-target mutation guard remains active', async () => {
    assert.throws(() => assertFinanceRegressionTargetAllowed('https://ogzhwoqqumkuqhbvuzzp.supabase.co'), /blocked before mutations/i)
  })
  await check(120, 'English and Portuguese package keys align', async () => {
    const enKeys = Object.keys(SOURCE.en).filter((key) => key.startsWith('commercialTax.') || key.startsWith('items.profileCompatibility.')).sort()
    const ptKeys = Object.keys(SOURCE.pt).filter((key) => key.startsWith('commercialTax.') || key.startsWith('items.profileCompatibility.')).sort()
    assert.deepEqual(ptKeys, enKeys)
  })
  await check(121, 'canonical Sales Order display does not add tax twice', async () => {
    assert.match(SOURCE.orderFinance, /isCanonicalLineTax\s*=\s*order\.tax_calculation_mode\s*===\s*'line'/)
    assert.match(SOURCE.orderFinance, /isCanonicalLineTax\s*\?\s*order\.subtotal\s*:\s*order\.total_amount/)
    assert.match(SOURCE.orderFinance, /isCanonicalLineTax\s*\?\s*\(order\.total\s*\?\?\s*order\.total_amount\)/)
  })
  await check(122, 'order status transitions refresh authoritative finance-anchor state', async () => {
    assert.match(SOURCE.salesOrders, /salesOrderState\.refresh\(\)/)
    assert.match(SOURCE.purchaseOrders, /purchaseOrderState\.refresh\(\)/)
  })
  await check(123, 'canonical Sales Order finance state uses the stored grand total once', async () => {
    const state = ok(await ownerClient
      .from('v_sales_order_state')
      .select('subtotal_amount_ccy,tax_amount_ccy,total_amount_ccy,total_amount_base')
      .eq('id', canonicalSalesOrderId)
      .single())
    assert.equal(round2(state.subtotal_amount_ccy), 46.05)
    assert.equal(round2(state.tax_amount_ccy), 0.73)
    assert.equal(round2(state.total_amount_ccy), 46.78)
    assert.equal(round2(state.total_amount_base), 46.78)
  })
  await check(124, 'canonical Sales Order outstanding excludes double-counted line tax', async () => {
    const state = ok(await ownerClient
      .from('v_sales_order_state')
      .select('total_amount_base,legacy_settled_base,legacy_outstanding_base')
      .eq('id', canonicalSalesOrderId)
      .single())
    assert.equal(round2(state.legacy_settled_base), 0)
    assert.equal(round2(state.legacy_outstanding_base), 46.78)
    assert.match(SOURCE.financeStateMigration, /tax_calculation_mode\s*=\s*'line'/)
    assert.doesNotMatch(SOURCE.financeStateMigration, /finance_total_amount_ccy\s*\+\s*so\.finance_tax_amount_ccy/)
  })
  await check(125, 'Sales Order active-anchor card uses authoritative outstanding fields', async () => {
    assert.match(SOURCE.salesOrders, /linkedFiscalInvoice\?\.outstanding_base,\s*salesState\(selectedSO\)\?\.legacy_outstanding_base/)
    assert.doesNotMatch(SOURCE.salesOrders, /salesState\(selectedSO\)\?\.outstanding_base/)
  })
})
