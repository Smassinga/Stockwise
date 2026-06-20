import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  createAdminClient,
  createTempUser,
  deleteAuthUser,
  expectPostgrestError,
  plusDaysIso,
  round2,
  setActiveCompany,
  signIn,
  todayIso,
  unwrapRpcSingle,
} from './helpers.mjs'

const PREFIX = `p45-${Date.now().toString(36)}`

function isoDateAtNoon(dateIso) {
  return `${dateIso}T12:00:00.000Z`
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat('en-MZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Maputo',
  }).format(new Date(value))
}

async function safeDelete(operation) {
  try {
    await operation()
  } catch (error) {
    console.warn('[finance-regression] cleanup warning', error?.message || error)
  }
}

function expectNoSupabaseError(result, message) {
  assert.equal(result.error, null, message || result.error?.message || 'Unexpected Supabase error')
  return result.data
}

async function querySingle(client, table, select, filters = []) {
  let query = client.from(table).select(select)
  for (const [method, ...args] of filters) query = query[method](...args)
  const { data, error } = await query.single()
  if (error) {
    throw new Error(`Expected one ${table} row (${select}) for ${JSON.stringify(filters)}: ${error.message || JSON.stringify(error)}`)
  }
  return data
}

async function countRows(client, table, filters = []) {
  let query = client.from(table).select('id', { count: 'exact', head: true })
  for (const [method, ...args] of filters) query = query[method](...args)
  const { count, error } = await query
  if (error) {
    throw new Error(`Expected ${table} count for ${JSON.stringify(filters)} to succeed: ${error.message || JSON.stringify(error)}`)
  }
  return count ?? 0
}

async function expectDirectMutationBlocked(operationPromise, label = 'direct Production Run mutation') {
  await expectPostgrestError(operationPromise, 'permission denied|row-level security')
    .catch((error) => {
      error.message = `${label}: ${error.message}`
      throw error
    })
}

async function financeIsolationCounts(client, companyId) {
  const filters = [['eq', 'company_id', companyId]]
  const bankAccounts = expectNoSupabaseError(
    await client.from('bank_accounts').select('id').eq('company_id', companyId),
    'Expected bank-account lookup for finance isolation to succeed',
  )
  const bankIds = (bankAccounts || []).map((row) => row.id)
  return {
    cash_transactions: await countRows(client, 'cash_transactions', filters),
    bank_transactions: bankIds.length
      ? await countRows(client, 'bank_transactions', [['in', 'bank_id', bankIds]])
      : 0,
    vendor_bills: await countRows(client, 'vendor_bills', filters),
    vendor_bill_lines: await countRows(client, 'vendor_bill_lines', filters),
    sales_invoices: await countRows(client, 'sales_invoices', filters),
    sales_invoice_lines: await countRows(client, 'sales_invoice_lines', filters),
    finance_document_events: await countRows(client, 'finance_document_events', filters),
  }
}

function assertCountsEqual(actual, expected, label) {
  assert.deepEqual(actual, expected, label)
}

function throwSupabaseError(error, label) {
  if (!error) return
  throw new Error(`${label}: ${error.message || JSON.stringify(error)}`)
}

function normalizeMovementSnapshot(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    item_id: row.item_id,
    type: row.type,
    qty: Number(row.qty),
    qty_base: Number(row.qty_base),
    uom_id: row.uom_id,
    warehouse_from_id: row.warehouse_from_id,
    bin_from_id: row.bin_from_id,
    warehouse_to_id: row.warehouse_to_id,
    bin_to_id: row.bin_to_id,
    unit_cost: Number(row.unit_cost || 0),
    total_value: Number(row.total_value || 0),
    ref_type: row.ref_type,
    ref_id: row.ref_id,
    ref_line_id: row.ref_line_id,
    created_at: row.created_at,
  }
}

function bucketDelta(movements, itemId, warehouseId, binId) {
  return movements.reduce((sum, movement) => {
    const qtyBase = Number(movement.qty_base || 0)
    const fromMatches =
      movement.item_id === itemId &&
      movement.warehouse_from_id === warehouseId &&
      (movement.bin_from_id ?? null) === (binId ?? null)
    const toMatches =
      movement.item_id === itemId &&
      movement.warehouse_to_id === warehouseId &&
      (movement.bin_to_id ?? null) === (binId ?? null)
    return sum + (toMatches ? qtyBase : 0) - (fromMatches ? qtyBase : 0)
  }, 0)
}

async function stockQtyOrZero(client, companyId, itemId, warehouseId, binId) {
  let query = client
    .from('stock_levels')
    .select('qty, avg_cost')
    .eq('company_id', companyId)
    .eq('item_id', itemId)
    .eq('warehouse_id', warehouseId)
  query = binId === null ? query.is('bin_id', null) : query.eq('bin_id', binId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return { qty: Number(data?.qty || 0), avg_cost: Number(data?.avg_cost || 0) }
}

async function assertPurchaseReceivingUsesStockMovementLedgerOnly() {
  const source = await readFile('src/pages/Orders/PurchaseOrders.tsx', 'utf8')
  const start = source.indexOf('async function postReceiptForLine')
  const end = source.indexOf('// Receive a single line', start)
  assert.notEqual(start, -1, 'Expected PurchaseOrders.tsx to expose the PO receipt posting block')
  assert.notEqual(end, -1, 'Expected PurchaseOrders.tsx to expose the PO receipt posting block end marker')
  const postReceiptSource = source.slice(start, end)

  assert.match(
    postReceiptSource,
    /\.rpc\(\s*['"]post_purchase_receipt['"]/,
    'Expected PO receipt posting to use the governed purchase receipt RPC',
  )
  assert.doesNotMatch(
    postReceiptSource,
    /\.from\(\s*['"]stock_movements['"]\s*\)\.insert\(/,
    'PO receipt UI must not insert stock movements directly',
  )
  assert.doesNotMatch(
    postReceiptSource,
    /\.from\(\s*['"]stock_levels['"]\s*\)[\s\S]{0,300}\.(?:insert|upsert|update|delete)\s*\(/,
    'PO receipt posting must not mutate stock_levels directly; stock_movements triggers own the rollup',
  )
}

async function openOrCreateSalesInvoiceDraftFromOrder(client, companyId, salesOrderId) {
  const { data: existing, error: existingError } = await client
    .from('sales_invoices')
    .select('id, internal_reference, document_workflow_status')
    .eq('company_id', companyId)
    .eq('sales_order_id', salesOrderId)
    .in('document_workflow_status', ['draft', 'issued'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return { invoiceId: existing.id, existed: true }

  const order = await querySingle(
    client,
    'sales_orders',
    'id, company_id, customer_id, order_date, due_date, currency_code, fx_to_base, tax_total',
    [
      ['eq', 'company_id', companyId],
      ['eq', 'id', salesOrderId],
    ],
  )

  const { data: lines, error: linesError } = await client
    .from('sales_order_lines')
    .select('id, line_no, item_id, description, qty, unit_price, line_total')
    .eq('so_id', salesOrderId)
    .order('line_no', { ascending: true })

  if (linesError) throw linesError
  assert.ok(lines?.length, 'Expected at least one sales-order line')

  const subtotal = round2(lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0))
  const taxTotal = round2(Number(order.tax_total || 0))
  const totalAmount = round2(subtotal + taxTotal)
  const taxRate = subtotal > 0 && taxTotal > 0 ? round2((taxTotal / subtotal) * 100) : 0

  const { data: invoice, error: invoiceError } = await client
    .from('sales_invoices')
    .insert({
      company_id: companyId,
      sales_order_id: salesOrderId,
      customer_id: order.customer_id,
      invoice_date: order.order_date,
      due_date: order.due_date || order.order_date,
      currency_code: order.currency_code || 'MZN',
      fx_to_base: Number(order.fx_to_base || 1) > 0 ? Number(order.fx_to_base || 1) : 1,
      subtotal,
      tax_total: taxTotal,
      total_amount: totalAmount,
      source_origin: 'native',
      document_workflow_status: 'draft',
    })
    .select('id, internal_reference')
    .single()

  if (invoiceError) throw invoiceError

  const linePayload = lines.map((line, index) => ({
    company_id: companyId,
    sales_invoice_id: invoice.id,
    sales_order_line_id: line.id,
    item_id: line.item_id,
    description: line.description || `Invoice line ${index + 1}`,
    qty: Number(line.qty || 0),
    unit_price: Number(line.unit_price || 0),
    tax_rate: taxRate,
    tax_amount: index === 0 ? taxTotal : 0,
    line_total: Number(line.line_total || 0),
    sort_order: Number(line.line_no || index + 1),
  }))

  const { error: lineInsertError } = await client.from('sales_invoice_lines').insert(linePayload)
  if (lineInsertError) throw lineInsertError

  return { invoiceId: invoice.id, existed: false }
}

async function openOrCreateVendorBillDraftFromPurchaseOrder(client, companyId, purchaseOrderId) {
  const { data: existing, error: existingError } = await client
    .from('vendor_bills')
    .select('id, internal_reference, document_workflow_status')
    .eq('company_id', companyId)
    .eq('purchase_order_id', purchaseOrderId)
    .in('document_workflow_status', ['draft', 'posted'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return { billId: existing.id, existed: true }

  const { data, error } = await client.rpc('create_vendor_bill_draft_from_purchase_order', {
    p_company_id: companyId,
    p_purchase_order_id: purchaseOrderId,
    p_supplier_invoice_reference: `${PREFIX.toUpperCase()}-SUP-INV`,
    p_supplier_invoice_date: todayIso(),
    p_bill_date: todayIso(),
    p_due_date: plusDaysIso(14),
    p_currency_code: 'MZN',
    p_fx_to_base: 1,
    p_lines: [],
  })

  if (error) throw error
  const bill = unwrapRpcSingle(data)
  assert.ok(bill?.id, 'Expected vendor-bill draft creation to return a bill id')
  return { billId: bill.id, existed: false }
}

test('Phase 4/5 finance hardening suite', async (t) => {
  const admin = createAdminClient()
  const created = {
    companyIds: new Set(),
    userIds: new Set(),
    adminEmails: new Set(),
    uomIds: new Set(),
  }

  async function cleanupCompany(companyId) {
    if (!companyId) return

    const { data: bankAccounts } = await admin
      .from('bank_accounts')
      .select('id')
      .eq('company_id', companyId)
    const bankIds = (bankAccounts || []).map((row) => row.id)

    const { data: boms } = await admin.from('boms').select('id').eq('company_id', companyId)
    const bomIds = (boms || []).map((row) => row.id)

    if (bankIds.length) {
      await safeDelete(() => admin.from('bank_transactions').delete().in('bank_id', bankIds))
    }
    if (bomIds.length) {
      await safeDelete(() => admin.from('bom_components').delete().in('bom_id', bomIds))
    }

    await safeDelete(() => admin.from('cash_transactions').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('notifications').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('finance_document_events').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('vendor_bill_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_invoice_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('vendor_bills').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_invoices').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('landed_cost_run_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('landed_cost_runs').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('purchase_order_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_order_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('purchase_orders').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_orders').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('builds').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('production_run_extra_costs').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('production_run_outputs').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('production_run_inputs').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('production_runs').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('production_run_counters').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('growth_batch_direct_costs').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('growth_batch_measurements').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('growth_batch_events').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('growth_batches').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('growth_batch_counters').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('posting_requests').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('stock_movements').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('stock_levels').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('boms').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('bank_accounts').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('cash_books').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('bins').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('warehouses').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('customers').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('suppliers').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('payment_terms').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_currencies').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('items').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('uom_conversions').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('finance_document_fiscal_series').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_fiscal_settings').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_access_audit_log').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_purge_queue').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_subscription_state').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('user_active_company').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_settings').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('company_members').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('companies').delete().eq('id', companyId))
  }

  t.after(async () => {
    for (const companyId of created.companyIds) {
      await cleanupCompany(companyId)
    }
    for (const uomId of created.uomIds) {
      await safeDelete(() => admin.from('uoms').delete().eq('id', uomId))
    }
    for (const email of created.adminEmails) {
      await safeDelete(() => admin.from('platform_admins').delete().eq('email', email))
    }
    for (const userId of created.userIds) {
      await deleteAuthUser(admin, userId)
    }
  })

  const ownerUser = await createTempUser(admin, PREFIX, 'owner')
  const managerUser = await createTempUser(admin, PREFIX, 'manager')
  const platformAdminUser = await createTempUser(admin, PREFIX, 'platform-admin')
  const rateLimitUser = await createTempUser(admin, PREFIX, 'rate-limit')
  for (const user of [ownerUser, managerUser, platformAdminUser, rateLimitUser]) {
    created.userIds.add(user.userId)
  }

  const ownerClient = await signIn(ownerUser.email, ownerUser.password)
  const managerClient = await signIn(managerUser.email, managerUser.password)
  const platformAdminClient = await signIn(platformAdminUser.email, platformAdminUser.password)
  const rateLimitClient = await signIn(rateLimitUser.email, rateLimitUser.password)

  const normalizedAdminEmail = platformAdminUser.email.toLowerCase()
  created.adminEmails.add(normalizedAdminEmail)
  {
    const { error } = await admin.from('platform_admins').upsert(
      {
        email: normalizedAdminEmail,
        user_id: platformAdminUser.userId,
        is_active: true,
        note: 'Phase 5 regression bootstrap',
      },
      { onConflict: 'email' },
    )
    if (error) throw error
  }

  let companyId = null
  let salesOrderId = null
  let purchaseOrderId = null
  let salesInvoiceId = null
  let vendorBillId = null
  let warehouseId = null
  let sourceBinId = null
  let destinationBinId = null
  let bankAccountId = null
  let customerId = null
  let supplierId = null
  let componentItemId = null
  let productItemId = null
  let resaleItemId = null
  let bomId = null
  let eachUomId = null
  let boxUomId = null

  await t.test('Trial bootstrap, access foundation, and shared finance setup', async () => {
    const bootstrap = expectNoSupabaseError(
      await ownerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Company` }),
      'Expected owner bootstrap to succeed',
    )
    const company = unwrapRpcSingle(bootstrap)
    assert.ok(company?.out_company_id, 'Expected bootstrap to return a company id')
    assert.equal(company.out_role, 'OWNER')

    companyId = company.out_company_id
    created.companyIds.add(companyId)

    await setActiveCompany(ownerClient, companyId)

    const accessState = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('get_my_company_access_state', { p_company_id: companyId }),
        'Expected owner access state to load',
      ),
    )
    assert.equal(accessState.subscription_status, 'trial')
    assert.equal(accessState.effective_status, 'trial')
    assert.equal(accessState.access_enabled, true)

    await expectPostgrestError(
      ownerClient.rpc('platform_admin_set_company_access', {
        p_company_id: companyId,
        p_plan_code: 'starter',
        p_status: 'active_paid',
        p_paid_until: isoDateAtNoon(plusDaysIso(30)),
        p_reason: 'Unauthorized regression attempt',
      }),
      'platform_admin_required',
    )

    const managerMembership = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: managerUser.userId,
      email: managerUser.email.toLowerCase(),
      role: 'MANAGER',
      status: 'active',
      invited_by: ownerUser.userId,
    })
    if (managerMembership.error) throw managerMembership.error
    await setActiveCompany(managerClient, companyId)

    const { data: existingDefaultUoms, error: existingDefaultUomsError } = await ownerClient
      .from('uoms')
      .select('id, code')
      .in('code', ['EA', 'BOX'])
    if (existingDefaultUomsError) throw existingDefaultUomsError

    const existingDefaultCodes = new Set((existingDefaultUoms || []).map((row) => row.code))
    const missingDefaultUoms = [
      { id: 'uom_ea', code: 'EA', name: 'Each', family: 'count' },
      { id: 'uom_box', code: 'BOX', name: 'Box', family: 'count' },
    ].filter((row) => !existingDefaultCodes.has(row.code))
    if (missingDefaultUoms.length) {
      const missingInsert = await ownerClient.from('uoms').insert(missingDefaultUoms)
      if (missingInsert.error) throw missingInsert.error
    }

    const { data: uoms, error: uomsError } = await ownerClient
      .from('uoms')
      .select('id, code')
      .in('code', ['EA', 'BOX'])
    if (uomsError) throw uomsError
    assert.equal(uoms.length, 2)
    eachUomId = uoms.find((row) => row.code === 'EA')?.id ?? null
    boxUomId = uoms.find((row) => row.code === 'BOX')?.id ?? null
    assert.ok(eachUomId, 'Expected the canonical Each UOM to exist')
    assert.ok(boxUomId, 'Expected the canonical Box UOM to exist')

    const companyUpdate = await ownerClient
      .from('companies')
      .update({
        legal_name: `${PREFIX} Legal, Lda`,
        trade_name: `${PREFIX} Trading`,
        tax_id: '123456789',
        address_line1: 'Avenida Patrice Lumumba 100',
        city: 'Maputo',
        country_code: 'MZ',
        preferred_lang: 'en',
        email: ownerUser.email.toLowerCase(),
      })
      .eq('id', companyId)
    if (companyUpdate.error) throw companyUpdate.error

    const customer = await ownerClient
      .from('customers')
      .insert({
        company_id: companyId,
        code: `${PREFIX.toUpperCase()}-CUS`,
        name: `${PREFIX} Customer`,
        tax_id: '900123456',
        billing_address: 'Rua da Beira 10',
        currency_code: 'MZN',
        is_cash: false,
      })
      .select('id')
      .single()
    if (customer.error) throw customer.error
    customerId = customer.data.id

    const supplier = await ownerClient
      .from('suppliers')
      .insert({
        company_id: companyId,
        code: `${PREFIX.toUpperCase()}-SUP`,
        name: `${PREFIX} Supplier`,
        tax_id: '800123456',
        currency_code: 'MZN',
        is_active: true,
      })
      .select('id')
      .single()
    if (supplier.error) throw supplier.error
    supplierId = supplier.data.id

    const warehouse = await ownerClient
      .from('warehouses')
      .insert({
        company_id: companyId,
        code: `${PREFIX.toUpperCase()}-WH`,
        name: `${PREFIX} Warehouse`,
        status: 'active',
      })
      .select('id')
      .single()
    if (warehouse.error) throw warehouse.error
    warehouseId = warehouse.data.id

    const sourceBin = await ownerClient
      .from('bins')
      .insert({
        id: `${PREFIX.toUpperCase()}-RM`,
        company_id: companyId,
        warehouseId: warehouseId,
        code: 'RM',
        name: 'Raw materials',
        status: 'active',
      })
      .select('id')
      .single()
    if (sourceBin.error) throw sourceBin.error
    sourceBinId = sourceBin.data.id

    const destinationBin = await ownerClient
      .from('bins')
      .insert({
        id: `${PREFIX.toUpperCase()}-FG`,
        company_id: companyId,
        warehouseId: warehouseId,
        code: 'FG',
        name: 'Finished goods',
        status: 'active',
      })
      .select('id')
      .single()
    if (destinationBin.error) throw destinationBin.error
    destinationBinId = destinationBin.data.id

    const componentItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-COMP`,
        name: `${PREFIX} Flour`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 58,
        primary_role: 'raw_material',
        track_inventory: true,
        can_buy: true,
        can_sell: false,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (componentItem.error) throw componentItem.error
    componentItemId = componentItem.data.id

    const productItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-FG`,
        name: `${PREFIX} Bread`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 116,
        primary_role: 'assembled_product',
        track_inventory: true,
        can_buy: false,
        can_sell: true,
        is_assembled: true,
      })
      .select('id')
      .single()
    if (productItem.error) throw productItem.error
    productItemId = productItem.data.id

    const resaleItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-RET`,
        name: `${PREFIX} Milk`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 32,
        primary_role: 'resale',
        track_inventory: true,
        can_buy: true,
        can_sell: true,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (resaleItem.error) throw resaleItem.error
    resaleItemId = resaleItem.data.id

    const stockLevel = await ownerClient.from('stock_levels').insert({
      company_id: companyId,
      item_id: componentItemId,
      warehouse_id: warehouseId,
      bin_id: sourceBinId,
      qty: 10,
      avg_cost: 5,
      allocated_qty: 0,
    })
    if (stockLevel.error) throw stockLevel.error

    const resaleStockLevel = await ownerClient.from('stock_levels').insert({
      company_id: companyId,
      item_id: resaleItemId,
      warehouse_id: warehouseId,
      bin_id: destinationBinId,
      qty: 6,
      avg_cost: 12,
      allocated_qty: 0,
    })
    if (resaleStockLevel.error) throw resaleStockLevel.error

    const bom = await ownerClient
      .from('boms')
      .insert({
        company_id: companyId,
        product_id: productItemId,
        name: `${PREFIX} Bread BOM`,
        version: 'v1',
        is_active: true,
        assembly_time_per_unit_minutes: 15,
        setup_time_per_batch_minutes: 10,
      })
      .select('id')
      .single()
    if (bom.error) throw bom.error
    bomId = bom.data.id

    const bomComponent = await ownerClient.from('bom_components').insert({
      bom_id: bomId,
      component_item_id: componentItemId,
      qty_per: 2,
      scrap_pct: 0,
    })
    if (bomComponent.error) throw bomComponent.error

    const bankAccount = await ownerClient
      .from('bank_accounts')
      .insert({
        company_id: companyId,
        name: `${PREFIX} Main Bank`,
        bank_name: 'BCI',
        account_number: `${Date.now()}`,
        currency_code: 'MZN',
      })
      .select('id')
      .single()
    if (bankAccount.error) throw bankAccount.error
    bankAccountId = bankAccount.data.id

    const cashBook = await ownerClient.from('cash_books').insert({
      company_id: companyId,
      beginning_balance_base: 0,
      beginning_as_of: todayIso(),
    })
    if (cashBook.error) throw cashBook.error

    const salesOrder = await ownerClient
      .from('sales_orders')
      .insert({
        company_id: companyId,
        customer_id: customerId,
        order_date: todayIso(),
        due_date: plusDaysIso(7),
        currency_code: 'MZN',
        status: 'shipped',
        subtotal: 100,
        tax_total: 16,
        total: 116,
        total_amount: 116,
        fx_to_base: 1,
        customer: `${PREFIX} Customer`,
        bill_to_name: `${PREFIX} Customer`,
        bill_to_tax_id: '900123456',
        bill_to_billing_address: 'Rua da Beira 10',
        created_by: ownerUser.userId,
      })
      .select('id')
      .single()
    if (salesOrder.error) throw salesOrder.error
    salesOrderId = salesOrder.data.id

    const salesOrderLine = await ownerClient.from('sales_order_lines').insert({
      so_id: salesOrderId,
      company_id: companyId,
      line_no: 1,
      item_id: productItemId,
      uom_id: eachUomId,
      qty: 1,
      unit_price: 100,
      line_total: 100,
      description: `${PREFIX} Bread`,
      shipped_qty: 1,
      is_shipped: true,
      shipped_at: isoDateAtNoon(todayIso()),
    })
    if (salesOrderLine.error) throw salesOrderLine.error

    const purchaseOrder = await ownerClient
      .from('purchase_orders')
      .insert({
        company_id: companyId,
        supplier_id: supplierId,
        order_date: todayIso(),
        due_date: plusDaysIso(14),
        currency_code: 'MZN',
        status: 'approved',
        subtotal: 232,
        tax_total: 0,
        total: 232,
        fx_to_base: 1,
        created_by: ownerUser.userId,
      })
      .select('id')
      .single()
    if (purchaseOrder.error) throw purchaseOrder.error
    purchaseOrderId = purchaseOrder.data.id

    const purchaseOrderLine = await ownerClient.from('purchase_order_lines').insert({
      po_id: purchaseOrderId,
      company_id: companyId,
      line_no: 1,
      item_id: componentItemId,
      uom_id: eachUomId,
      qty: 2,
      unit_price: 116,
      line_total: 232,
      description: `${PREFIX} Flour purchase`,
    })
    if (purchaseOrderLine.error) throw purchaseOrderLine.error
  })

  await t.test('Purchase receiving posts one receipt movement without double-counting stock levels', async () => {
    await assertPurchaseReceivingUsesStockMovementLedgerOnly()

    const receiptItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-PO-RECEIPT`,
        name: `${PREFIX} PO receipt guard`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 0,
        primary_role: 'raw_material',
        track_inventory: true,
        can_buy: true,
        can_sell: false,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (receiptItem.error) throw receiptItem.error
    const receiptItemId = receiptItem.data.id

    const purchaseOrder = await ownerClient
      .from('purchase_orders')
      .insert({
        company_id: companyId,
        supplier_id: supplierId,
        order_date: todayIso(),
        due_date: plusDaysIso(14),
        currency_code: 'MZN',
        status: 'approved',
        subtotal: 1350,
        tax_total: 0,
        total: 1350,
        fx_to_base: 1,
        created_by: ownerUser.userId,
      })
      .select('id')
      .single()
    if (purchaseOrder.error) throw purchaseOrder.error
    const receiptPoId = purchaseOrder.data.id

    const purchaseOrderLine = await ownerClient
      .from('purchase_order_lines')
      .insert({
        po_id: receiptPoId,
        company_id: companyId,
        line_no: 1,
        item_id: receiptItemId,
        uom_id: eachUomId,
        qty: 10,
        unit_price: 135,
        line_total: 1350,
        description: `${PREFIX} PO receipt guard line`,
      })
      .select('id, qty, unit_price, line_total')
      .single()
    if (purchaseOrderLine.error) throw purchaseOrderLine.error
    const receiptLine = purchaseOrderLine.data

    const movementBefore = await ownerClient
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('ref_type', 'PO')
      .eq('ref_id', receiptPoId)
      .eq('ref_line_id', receiptLine.id)
    if (movementBefore.error) throw movementBefore.error
    assert.equal(movementBefore.count, 0, 'Expected no receipt movement before receiving the PO line')

    const firstReceiptPayload = {
        p_company_id: companyId,
        p_purchase_order_id: receiptPoId,
        p_purchase_order_line_id: receiptLine.id,
        p_item_id: receiptItemId,
        p_qty: 4,
        p_qty_base: 4,
        p_uom_id: eachUomId,
        p_warehouse_to_id: warehouseId,
        p_bin_to_id: sourceBinId,
        p_unit_cost: 135,
        p_notes: `${PREFIX} PO receipt double-count regression`,
        p_received_by: ownerUser.email,
        p_request_key: `${PREFIX}-po-receipt-first`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_purchase_receipt', { ...firstReceiptPayload, p_request_key: null }),
      'request_key_required',
    )

    const firstReceipt = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_purchase_receipt', firstReceiptPayload),
        'Expected idempotent partial PO receipt to succeed',
      ),
    )
    assert.ok(firstReceipt.movement_id, 'Expected first purchase receipt to return a movement id')
    assert.equal(round2(firstReceipt.received_qty), 4)
    assert.equal(round2(firstReceipt.remaining_qty), 6)
    assert.equal(firstReceipt.closed, false)

    const firstReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_purchase_receipt', firstReceiptPayload),
        'Expected same-key purchase receipt replay to succeed',
      ),
    )
    assert.equal(firstReplay.movement_id, firstReceipt.movement_id)

    await expectPostgrestError(
      ownerClient.rpc('post_purchase_receipt', { ...firstReceiptPayload, p_qty: 5, p_qty_base: 5 }),
      'idempotency_key_payload_mismatch',
    )

    const finalReceipt = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_purchase_receipt', {
          ...firstReceiptPayload,
          p_qty: 6,
          p_qty_base: 6,
          p_request_key: `${PREFIX}-po-receipt-final`,
        }),
        'Expected final PO receipt to close the purchase order',
      ),
    )
    assert.ok(finalReceipt.movement_id)
    assert.notEqual(finalReceipt.movement_id, firstReceipt.movement_id)
    assert.equal(round2(finalReceipt.received_qty), 10)
    assert.equal(round2(finalReceipt.remaining_qty), 0)
    assert.equal(finalReceipt.closed, true)

    await expectPostgrestError(
      ownerClient.rpc('post_purchase_receipt', {
        ...firstReceiptPayload,
        p_qty: 1,
        p_qty_base: 1,
        p_request_key: `${PREFIX}-po-receipt-over`,
      }),
      'quantity_exceeds_remaining|invalid_receipt_state',
    )

    const { data: movements, error: movementsError } = await ownerClient
      .from('stock_movements')
      .select('id, type, qty, qty_base, unit_cost, total_value, ref_type, ref_id, ref_line_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'PO')
      .eq('ref_id', receiptPoId)
      .eq('ref_line_id', receiptLine.id)
      .order('created_at', { ascending: true })
    if (movementsError) throw movementsError

    assert.equal(movements.length, 2, 'Expected exactly two PO receipt movements after partial and final receipts')
    assert.equal(movements[0].type, 'receive')
    assert.equal(round2(movements[0].qty_base), 4)
    assert.equal(round2(movements[0].qty), 4)
    assert.equal(round2(movements[0].unit_cost), 135)
    assert.equal(round2(movements[0].total_value), 540)
    assert.equal(round2(movements[1].qty_base), 6)
    assert.equal(round2(movements[1].qty), 6)
    assert.equal(round2(movements[1].unit_cost), 135)
    assert.equal(round2(movements[1].total_value), 810)

    const stockLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', receiptItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(stockLevel.qty), 10, 'Expected derived stock level to increase by 10, not 20')
    assert.equal(round2(stockLevel.allocated_qty), 0)
    assert.equal(round2(stockLevel.avg_cost), 135)
    assert.equal(round2(Number(stockLevel.qty) * Number(stockLevel.avg_cost)), 1350)

    const stockLevelAgain = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', receiptItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(stockLevelAgain.qty), 10, 'Expected stock-level re-read to stay at the receipt quantity')
    assert.equal(round2(Number(stockLevelAgain.qty) * Number(stockLevelAgain.avg_cost)), 1350)

    const receivedQty = movements.reduce((sum, movement) => sum + Number(movement.qty_base || 0), 0)
    const remainingQty = Number(receiptLine.qty || 0) - receivedQty
    assert.equal(round2(remainingQty), 0, 'Expected the PO line remaining quantity to be zero')

    const purchaseOrderAfterReceipt = await querySingle(
      ownerClient,
      'purchase_orders',
      'status, received_at',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', receiptPoId],
      ],
    )
    assert.equal(purchaseOrderAfterReceipt.status, 'closed')
    assert.ok(purchaseOrderAfterReceipt.received_at, 'Expected fully received PO to capture received_at')

    const purchaseOrderState = await querySingle(
      ownerClient,
      'v_purchase_order_state',
      'legacy_status, receipt_status',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', receiptPoId],
      ],
    )
    assert.equal(purchaseOrderState.legacy_status, 'closed')
    assert.equal(purchaseOrderState.receipt_status, 'complete')

    const movementAfterStateRead = await ownerClient
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('ref_type', 'PO')
      .eq('ref_id', receiptPoId)
      .eq('ref_line_id', receiptLine.id)
    if (movementAfterStateRead.error) throw movementAfterStateRead.error
    assert.equal(movementAfterStateRead.count, 2, 'Expected replay and state reads not to create duplicate PO movements')
  })

  await t.test('Sales shipment posts issues idempotently and updates shipped state once', async () => {
    const shipItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-SHIP`,
        name: `${PREFIX} Shipment Item`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 44,
        primary_role: 'resale',
        track_inventory: true,
        can_buy: true,
        can_sell: true,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (shipItem.error) throw shipItem.error

    const seedStock = await ownerClient.from('stock_levels').insert({
      company_id: companyId,
      item_id: shipItem.data.id,
      warehouse_id: warehouseId,
      bin_id: sourceBinId,
      qty: 3,
      avg_cost: 9,
      allocated_qty: 0,
    })
    if (seedStock.error) throw seedStock.error

    const shipOrder = await ownerClient
      .from('sales_orders')
      .insert({
        company_id: companyId,
        customer_id: customerId,
        order_date: todayIso(),
        due_date: plusDaysIso(7),
        currency_code: 'MZN',
        status: 'confirmed',
        subtotal: 88,
        tax_total: 0,
        total: 88,
        total_amount: 88,
        fx_to_base: 1,
        customer: `${PREFIX} Customer`,
        bill_to_name: `${PREFIX} Customer`,
        created_by: ownerUser.userId,
      })
      .select('id')
      .single()
    if (shipOrder.error) throw shipOrder.error

    const shipLine = await ownerClient
      .from('sales_order_lines')
      .insert({
        so_id: shipOrder.data.id,
        company_id: companyId,
        line_no: 1,
        item_id: shipItem.data.id,
        uom_id: eachUomId,
        qty: 2,
        unit_price: 44,
        line_total: 88,
        description: `${PREFIX} shipment line`,
        shipped_qty: 0,
        is_shipped: false,
      })
      .select('id')
      .single()
    if (shipLine.error) throw shipLine.error

    const shipmentPayload = {
      p_company_id: companyId,
      p_sales_order_id: shipOrder.data.id,
      p_sales_order_line_id: shipLine.data.id,
      p_allocations: [{ warehouse_id: warehouseId, bin_id: sourceBinId, qty: 2, qty_base: 2 }],
      p_request_key: `${PREFIX}-sales-shipment`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_sales_shipment', { ...shipmentPayload, p_request_key: null }),
      'request_key_required',
    )

    const shipment = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_sales_shipment', shipmentPayload),
        'Expected idempotent sales shipment to succeed',
      ),
    )
    assert.equal(shipment.sales_order_id, shipOrder.data.id)
    assert.equal(shipment.sales_order_line_id, shipLine.data.id)
    assert.equal(shipment.movement_ids.length, 1)
    assert.equal(round2(shipment.shipped_qty), 2)
    assert.equal(round2(shipment.remaining_qty), 0)

    const replay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_sales_shipment', shipmentPayload),
        'Expected same-key sales shipment replay to return original movement ids',
      ),
    )
    assert.deepEqual(replay.movement_ids, shipment.movement_ids)

    await expectPostgrestError(
      ownerClient.rpc('post_sales_shipment', {
        ...shipmentPayload,
        p_allocations: [{ warehouse_id: warehouseId, bin_id: sourceBinId, qty: 1, qty_base: 1 }],
      }),
      'idempotency_key_payload_mismatch',
    )

    const movements = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, type, item_id, qty_base, ref_type, ref_id, ref_line_id')
        .eq('company_id', companyId)
        .eq('ref_type', 'SO')
        .eq('ref_id', shipOrder.data.id)
        .eq('ref_line_id', shipLine.data.id),
      'Expected sales shipment movement lookup to succeed',
    )
    assert.equal(movements.length, 1)
    assert.equal(movements[0].id, shipment.movement_ids[0])
    assert.equal(round2(movements[0].qty_base), 2)

    const shippedLine = await querySingle(
      ownerClient,
      'sales_order_lines',
      'shipped_qty, is_shipped',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', shipLine.data.id],
      ],
    )
    assert.equal(round2(shippedLine.shipped_qty), 2)
    assert.equal(shippedLine.is_shipped, true)

    const shipLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', shipItem.data.id],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(shipLevel.qty), 1)

    await expectPostgrestError(
      ownerClient.rpc('post_sales_shipment', {
        ...shipmentPayload,
        p_sales_order_line_id: shipLine.data.id,
        p_request_key: `${PREFIX}-sales-shipment-over`,
        p_allocations: [{ warehouse_id: warehouseId, bin_id: sourceBinId, qty: 1, qty_base: 1 }],
      }),
      'invalid_shipment_state|quantity_exceeds_remaining',
    )
  })

  await t.test('Sales Order -> Sales Invoice draft -> approval -> issue readiness -> issue', async () => {
    const firstDraft = await openOrCreateSalesInvoiceDraftFromOrder(ownerClient, companyId, salesOrderId)
    const secondDraft = await openOrCreateSalesInvoiceDraftFromOrder(ownerClient, companyId, salesOrderId)
    assert.ok(firstDraft.invoiceId)
    assert.equal(firstDraft.invoiceId, secondDraft.invoiceId)
    assert.equal(secondDraft.existed, true)
    salesInvoiceId = firstDraft.invoiceId

    const readinessBeforeApproval = expectNoSupabaseError(
      await ownerClient.rpc('sales_invoice_issue_readiness_mz', { p_invoice_id: salesInvoiceId }),
      'Expected issue readiness lookup to succeed before approval',
    )
    assert.equal(readinessBeforeApproval.can_issue, false)
    assert.ok(
      readinessBeforeApproval.blockers.includes('sales_invoice_issue_requires_approved_status'),
      'Expected readiness to block issue before approval',
    )

    const approvalRequest = await managerClient.rpc('request_sales_invoice_approval_mz', {
      p_invoice_id: salesInvoiceId,
    })
    if (approvalRequest.error) throw approvalRequest.error

    await expectPostgrestError(
      managerClient.rpc('issue_sales_invoice_mz', { p_invoice_id: salesInvoiceId }),
      'access denied|sales_invoice_issue_access_denied',
    )

    const approval = await ownerClient.rpc('approve_sales_invoice_mz', { p_invoice_id: salesInvoiceId })
    if (approval.error) throw approval.error

    const preparation = await ownerClient.rpc('prepare_sales_invoice_for_issue_mz', {
      p_invoice_id: salesInvoiceId,
      p_vat_exemption_reason_text: null,
    })
    if (preparation.error) throw preparation.error

    const readinessAfterApproval = expectNoSupabaseError(
      await ownerClient.rpc('sales_invoice_issue_readiness_mz', { p_invoice_id: salesInvoiceId }),
      'Expected issue readiness lookup to succeed after approval',
    )
    assert.equal(readinessAfterApproval.can_issue, true)
    assert.deepEqual(readinessAfterApproval.blockers, [])

    const issue = await ownerClient.rpc('issue_sales_invoice_mz', { p_invoice_id: salesInvoiceId })
    if (issue.error) throw issue.error

    const issuedInvoice = await querySingle(
      ownerClient,
      'sales_invoices',
      'id, sales_order_id, document_workflow_status, approval_status, internal_reference',
      [['eq', 'id', salesInvoiceId]],
    )
    assert.equal(issuedInvoice.sales_order_id, salesOrderId)
    assert.equal(issuedInvoice.document_workflow_status, 'issued')
    assert.equal(issuedInvoice.approval_status, 'approved')
    assert.match(issuedInvoice.internal_reference, /INV/i)

    const { data: invoiceNotifications, error: invoiceNotificationsError } = await ownerClient
      .from('notifications')
      .select('title, body, url, level, meta')
      .eq('company_id', companyId)
      .eq('url', `/sales-invoices/${salesInvoiceId}`)
      .order('created_at', { ascending: false })
    if (invoiceNotificationsError) throw invoiceNotificationsError

    const invoiceApprovalNotification = invoiceNotifications.find(
      (row) => row.meta?.event_type === 'approval_requested' && row.meta?.source === 'finance_document_event',
    )
    const invoiceIssuedNotification = invoiceNotifications.find(
      (row) => row.meta?.event_type === 'issued' && row.meta?.source === 'finance_document_event',
    )

    assert.ok(invoiceApprovalNotification, 'Expected a sales-invoice approval-request notification')
    assert.equal(invoiceApprovalNotification.level, 'warning')
    assert.match(invoiceApprovalNotification.title, /approval requested: sales invoice/i)
    assert.match(invoiceApprovalNotification.body, /waiting for approval/i)

    assert.ok(invoiceIssuedNotification, 'Expected a sales-invoice issued notification')
    assert.equal(invoiceIssuedNotification.level, 'info')
    assert.match(invoiceIssuedNotification.title, /sales invoice issued/i)
    assert.match(invoiceIssuedNotification.body, /was issued/i)
  })

  await t.test('Purchase Order -> Vendor Bill draft -> approval -> post', async () => {
    const firstDraft = await openOrCreateVendorBillDraftFromPurchaseOrder(ownerClient, companyId, purchaseOrderId)
    const secondDraft = await openOrCreateVendorBillDraftFromPurchaseOrder(ownerClient, companyId, purchaseOrderId)
    assert.ok(firstDraft.billId)
    assert.equal(firstDraft.billId, secondDraft.billId)
    assert.equal(secondDraft.existed, true)
    vendorBillId = firstDraft.billId

    const approvalRequest = await managerClient.rpc('request_vendor_bill_approval_mz', {
      p_bill_id: vendorBillId,
    })
    if (approvalRequest.error) throw approvalRequest.error

    await expectPostgrestError(
      managerClient.rpc('post_vendor_bill_mz', { p_bill_id: vendorBillId }),
      'access denied',
    )

    const approval = await ownerClient.rpc('approve_vendor_bill_mz', { p_bill_id: vendorBillId })
    if (approval.error) throw approval.error

    const posting = await ownerClient.rpc('post_vendor_bill_mz', { p_bill_id: vendorBillId })
    if (posting.error) throw posting.error

    const postedBill = await querySingle(
      ownerClient,
      'vendor_bills',
      'id, purchase_order_id, document_workflow_status, approval_status, internal_reference',
      [['eq', 'id', vendorBillId]],
    )
    assert.equal(postedBill.purchase_order_id, purchaseOrderId)
    assert.equal(postedBill.document_workflow_status, 'posted')
    assert.equal(postedBill.approval_status, 'approved')
    assert.ok(postedBill.internal_reference)

    const { data: vendorBillNotifications, error: vendorBillNotificationsError } = await ownerClient
      .from('notifications')
      .select('title, body, url, level, meta')
      .eq('company_id', companyId)
      .eq('url', `/vendor-bills/${vendorBillId}`)
      .order('created_at', { ascending: false })
    if (vendorBillNotificationsError) throw vendorBillNotificationsError

    const vendorBillApprovalNotification = vendorBillNotifications.find(
      (row) => row.meta?.event_type === 'approval_requested' && row.meta?.source === 'finance_document_event',
    )
    const vendorBillPostedNotification = vendorBillNotifications.find(
      (row) => row.meta?.event_type === 'posted' && row.meta?.source === 'finance_document_event',
    )

    assert.ok(vendorBillApprovalNotification, 'Expected a vendor-bill approval-request notification')
    assert.equal(vendorBillApprovalNotification.level, 'warning')
    assert.match(vendorBillApprovalNotification.title, /approval requested: vendor bill/i)
    assert.match(vendorBillApprovalNotification.body, /waiting for approval/i)

    assert.ok(vendorBillPostedNotification, 'Expected a vendor-bill posted notification')
    assert.equal(vendorBillPostedNotification.level, 'info')
    assert.match(vendorBillPostedNotification.title, /vendor bill posted/i)
    assert.match(vendorBillPostedNotification.body, /accounts payable/i)
  })

  await t.test('Settlements, bank/cash continuity, and reconciliation bridges', async () => {
    const bankReceipt = await ownerClient
      .from('bank_transactions')
      .insert({
        bank_id: bankAccountId,
        happened_at: todayIso(),
        memo: `${PREFIX} AR bank receipt`,
        amount_base: 40,
        reconciled: false,
        ref_type: 'SI',
        ref_id: salesInvoiceId,
      })
      .select('id')
      .single()
    if (bankReceipt.error) throw bankReceipt.error

    const cashReceipt = await ownerClient
      .from('cash_transactions')
      .insert({
        company_id: companyId,
        happened_at: todayIso(),
        type: 'sale_receipt',
        ref_type: 'SI',
        ref_id: salesInvoiceId,
        memo: `${PREFIX} AR cash receipt`,
        amount_base: 30,
      })
      .select('id')
      .single()
    if (cashReceipt.error) throw cashReceipt.error

    const bankPayment = await ownerClient
      .from('bank_transactions')
      .insert({
        bank_id: bankAccountId,
        happened_at: todayIso(),
        memo: `${PREFIX} AP bank payment`,
        amount_base: -50,
        reconciled: false,
        ref_type: 'VB',
        ref_id: vendorBillId,
      })
      .select('id')
      .single()
    if (bankPayment.error) throw bankPayment.error

    const cashPayment = await ownerClient
      .from('cash_transactions')
      .insert({
        company_id: companyId,
        happened_at: todayIso(),
        type: 'purchase_payment',
        ref_type: 'VB',
        ref_id: vendorBillId,
        memo: `${PREFIX} AP cash payment`,
        amount_base: -20,
      })
      .select('id')
      .single()
    if (cashPayment.error) throw cashPayment.error

    const cashAdjustment = await ownerClient
      .from('cash_transactions')
      .insert({
        company_id: companyId,
        happened_at: todayIso(),
        type: 'adjustment',
        memo: `${PREFIX} cash adjustment`,
        amount_base: 12,
      })
      .select('id')
      .single()
    if (cashAdjustment.error) throw cashAdjustment.error

    const arBridge = await querySingle(
      ownerClient,
      'v_sales_invoice_state',
      'id, financial_anchor, current_legal_total_base, settled_base, outstanding_base, settlement_status, resolution_status',
      [['eq', 'id', salesInvoiceId]],
    )
    assert.equal(arBridge.financial_anchor, 'sales_invoice')
    assert.equal(round2(arBridge.current_legal_total_base), 116)
    assert.equal(round2(arBridge.settled_base), 70)
    assert.equal(round2(arBridge.outstanding_base), 46)

    const apBridge = await querySingle(
      ownerClient,
      'v_vendor_bill_state',
      'id, financial_anchor, current_legal_total_base, settled_base, outstanding_base, settlement_status, resolution_status',
      [['eq', 'id', vendorBillId]],
    )
    assert.equal(apBridge.financial_anchor, 'vendor_bill')
    assert.equal(round2(apBridge.current_legal_total_base), 232)
    assert.equal(round2(apBridge.settled_base), 70)
    assert.equal(round2(apBridge.outstanding_base), 162)

    const { data: cashRows, error: cashRowsError } = await ownerClient
      .from('cash_transactions')
      .select('id, type, amount_base')
      .eq('company_id', companyId)
      .ilike('memo', `${PREFIX}%`)
    if (cashRowsError) throw cashRowsError
    assert.equal(cashRows.length, 3)
  })

  await t.test('BOM assembly build succeeds when ready and blocks when stock is insufficient', async () => {
    const originalProduct = await querySingle(
      ownerClient,
      'items',
      'id, unit_price',
      [['eq', 'id', productItemId]],
    )

    const buildCall = await ownerClient.rpc('build_from_bom', {
      p_bom_id: bomId,
      p_qty: 4,
      p_warehouse_from: warehouseId,
      p_bin_from: sourceBinId,
      p_warehouse_to: warehouseId,
      p_bin_to: destinationBinId,
    })
    if (buildCall.error) throw buildCall.error
    const buildId = buildCall.data
    assert.ok(buildId, 'Expected build_from_bom to return a build id')

    const build = await querySingle(
      ownerClient,
      'builds',
      'id, qty, cost_total, bom_id, product_id',
      [['eq', 'id', buildId]],
    )
    assert.equal(round2(build.qty), 4)
    assert.equal(build.bom_id, bomId)
    assert.ok(Number(build.cost_total) > 0, 'Expected build cost to be positive')
    assert.equal(round2(build.cost_total), 40)

    const { data: buildMovements, error: buildMovementsError } = await ownerClient
      .from('stock_movements')
      .select('id, type, item_id, qty_base, unit_cost, total_value, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'BUILD')
      .eq('ref_id', buildId)
      .order('type', { ascending: true })
    if (buildMovementsError) throw buildMovementsError
    assert.equal(buildMovements.length, 2, 'Expected one component issue and one finished receipt movement')

    const componentIssue = buildMovements.find((movement) => movement.type === 'issue')
    const finishedReceipt = buildMovements.find((movement) => movement.type === 'receive')
    assert.ok(componentIssue, 'Expected component issue movement linked to the build')
    assert.ok(finishedReceipt, 'Expected finished receipt movement linked to the build')
    assert.equal(componentIssue.item_id, componentItemId)
    assert.equal(componentIssue.warehouse_from_id, warehouseId)
    assert.equal(componentIssue.bin_from_id, sourceBinId)
    assert.equal(round2(componentIssue.qty_base), 8)
    assert.equal(round2(componentIssue.unit_cost), 5)
    assert.equal(finishedReceipt.item_id, productItemId)
    assert.equal(finishedReceipt.warehouse_to_id, warehouseId)
    assert.equal(finishedReceipt.bin_to_id, destinationBinId)
    assert.equal(round2(finishedReceipt.qty_base), 4)
    assert.equal(round2(finishedReceipt.unit_cost), 10)

    const sourceLevelAfterBuild = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', componentItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(sourceLevelAfterBuild.qty), 2)
    assert.equal(round2(sourceLevelAfterBuild.avg_cost), 5)

    const finishedLevelAfterBuild = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(finishedLevelAfterBuild.qty), 4)
    assert.equal(round2(finishedLevelAfterBuild.avg_cost), 10)

    const productAfterBuild = await querySingle(
      ownerClient,
      'items',
      'id, unit_price',
      [['eq', 'id', productItemId]],
    )
    assert.equal(round2(productAfterBuild.unit_price), round2(originalProduct.unit_price))

    await expectPostgrestError(
      ownerClient.rpc('build_from_bom', {
        p_bom_id: bomId,
        p_qty: 20,
        p_warehouse_from: warehouseId,
        p_bin_from: sourceBinId,
        p_warehouse_to: warehouseId,
        p_bin_to: destinationBinId,
      }),
      'stock|insufficient|negative|forbidden',
    )

    const sourceSplitCall = await ownerClient.rpc('build_from_bom_sources', {
      p_bom_id: bomId,
      p_qty: 1,
      p_component_sources: [
        {
          component_item_id: componentItemId,
          sources: [{ warehouse_id: warehouseId, bin_id: sourceBinId, share_pct: 100 }],
        },
      ],
      p_output_splits: [{ warehouse_id: warehouseId, bin_id: destinationBinId, qty: 1 }],
    })
    if (sourceSplitCall.error) throw sourceSplitCall.error

    const { data: sourceSplitBuilds, error: sourceSplitBuildsError } = await ownerClient
      .from('builds')
      .select('id, qty, cost_total')
      .eq('company_id', companyId)
      .eq('bom_id', bomId)
      .eq('qty', 1)
      .order('created_at', { ascending: false })
      .limit(1)
    if (sourceSplitBuildsError) throw sourceSplitBuildsError
    assert.equal(sourceSplitBuilds.length, 1, 'Expected source-split build to create a build row')
    const sourceSplitBuildId = sourceSplitBuilds[0].id

    const { data: sourceSplitMovements, error: sourceSplitMovementsError } = await ownerClient
      .from('stock_movements')
      .select('id, type, item_id, qty_base, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'BUILD')
      .eq('ref_id', sourceSplitBuildId)
    if (sourceSplitMovementsError) throw sourceSplitMovementsError
    assert.equal(sourceSplitMovements.length, 2, 'Expected source-split build movements to link to the build')
    assert.ok(sourceSplitMovements.some((movement) => movement.type === 'issue' && movement.item_id === componentItemId))
    assert.ok(sourceSplitMovements.some((movement) => movement.type === 'receive' && movement.item_id === productItemId))

    const operatorUser = await createTempUser(admin, PREFIX, 'assembly-operator')
    const viewerUser = await createTempUser(admin, PREFIX, 'assembly-viewer')
    created.userIds.add(operatorUser.userId)
    created.userIds.add(viewerUser.userId)
    const roleUserIds = [operatorUser.userId, viewerUser.userId]

    try {
      const operatorClient = await signIn(operatorUser.email, operatorUser.password)
      const viewerClient = await signIn(viewerUser.email, viewerUser.password)
      const memberships = await admin.from('company_members').insert([
        {
          company_id: companyId,
          user_id: operatorUser.userId,
          email: operatorUser.email.toLowerCase(),
          role: 'OPERATOR',
          status: 'active',
          invited_by: ownerUser.userId,
        },
        {
          company_id: companyId,
          user_id: viewerUser.userId,
          email: viewerUser.email.toLowerCase(),
          role: 'VIEWER',
          status: 'active',
          invited_by: ownerUser.userId,
        },
      ])
      if (memberships.error) throw memberships.error
      await setActiveCompany(operatorClient, companyId)
      await setActiveCompany(viewerClient, companyId)

      const replenishment = await ownerClient.from('stock_movements').insert({
        company_id: companyId,
        type: 'receive',
        item_id: componentItemId,
        uom_id: eachUomId,
        qty: 6,
        qty_base: 6,
        unit_cost: 5,
        total_value: 30,
        warehouse_to_id: warehouseId,
        bin_to_id: sourceBinId,
        notes: `${PREFIX} assembly role-test replenishment`,
        created_by: ownerUser.userId,
        ref_type: 'ADJUST',
      })
      if (replenishment.error) throw replenishment.error

      const operatorBuild = await operatorClient.rpc('build_from_bom', {
        p_bom_id: bomId,
        p_qty: 1,
        p_warehouse_from: warehouseId,
        p_bin_from: sourceBinId,
        p_warehouse_to: warehouseId,
        p_bin_to: destinationBinId,
      })
      if (operatorBuild.error) throw operatorBuild.error
      assert.ok(operatorBuild.data, 'Expected OPERATOR role to post assembly build')

      await expectPostgrestError(
        viewerClient.rpc('build_from_bom', {
          p_bom_id: bomId,
          p_qty: 1,
          p_warehouse_from: warehouseId,
          p_bin_from: sourceBinId,
          p_warehouse_to: warehouseId,
          p_bin_to: destinationBinId,
        }),
        'forbidden|permission|not allowed',
      )
    } finally {
      await safeDelete(() => admin.from('company_members').delete().eq('company_id', companyId).in('user_id', roleUserIds))
    }

    await expectPostgrestError(
      ownerClient.rpc('inv_issue_component', {
        p_item_id: componentItemId,
        p_qty_base: 1,
        p_warehouse_id: warehouseId,
        p_bin_id: sourceBinId,
        p_note: `${PREFIX} direct helper misuse`,
      }),
      'permission|denied|execute|forbidden',
    )
  })

  await t.test('Idempotent assembly posting replays successful requests without duplicate movements', async () => {
    const originalProduct = await querySingle(
      ownerClient,
      'items',
      'id, unit_price',
      [['eq', 'id', productItemId]],
    )

    const simpleRequestKey = `${PREFIX}-assembly-simple-idempotent`
    const simplePayload = {
      p_bom_id: bomId,
      p_qty: 1,
      p_warehouse_from: warehouseId,
      p_bin_from: sourceBinId,
      p_warehouse_to: warehouseId,
      p_bin_to: destinationBinId,
      p_request_key: simpleRequestKey,
    }

    const simpleFirst = await ownerClient.rpc('post_build_from_bom', simplePayload)
    if (simpleFirst.error) throw simpleFirst.error
    const simpleBuildId = simpleFirst.data
    assert.ok(simpleBuildId, 'Expected idempotent simple assembly to return a build id')

    const simpleReplay = await ownerClient.rpc('post_build_from_bom', simplePayload)
    if (simpleReplay.error) throw simpleReplay.error
    assert.equal(simpleReplay.data, simpleBuildId, 'Expected idempotent replay to return the original build id')

    await expectPostgrestError(
      ownerClient.rpc('post_build_from_bom', {
        ...simplePayload,
        p_qty: 2,
      }),
      'idempotency_key_payload_mismatch',
    )

    const simpleRequest = await querySingle(
      ownerClient,
      'posting_requests',
      'operation_type, request_key, payload_hash, status, result_ref_type, result_ref_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'operation_type', 'assembly.build'],
        ['eq', 'request_key', simpleRequestKey],
      ],
    )
    assert.equal(simpleRequest.status, 'succeeded')
    assert.equal(simpleRequest.result_ref_type, 'BUILD')
    assert.equal(simpleRequest.result_ref_id, simpleBuildId)
    assert.ok(simpleRequest.payload_hash, 'Expected payload hash to be stored')

    const { data: simpleBuildRows, error: simpleBuildRowsError } = await ownerClient
      .from('builds')
      .select('id')
      .eq('company_id', companyId)
      .eq('id', simpleBuildId)
    if (simpleBuildRowsError) throw simpleBuildRowsError
    assert.equal(simpleBuildRows.length, 1, 'Expected replay not to create an extra simple build')

    const { data: simpleMovements, error: simpleMovementsError } = await ownerClient
      .from('stock_movements')
      .select('id, type, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'BUILD')
      .eq('ref_id', simpleBuildId)
    if (simpleMovementsError) throw simpleMovementsError
    assert.equal(simpleMovements.length, 2, 'Expected replay not to create extra simple build movements')
    assert.ok(simpleMovements.some((movement) => movement.type === 'issue'))
    assert.ok(simpleMovements.some((movement) => movement.type === 'receive'))

    const sourceRequestKey = `${PREFIX}-assembly-source-idempotent`
    const sourcePayload = {
      p_bom_id: bomId,
      p_qty: 1,
      p_component_sources: [
        {
          component_item_id: componentItemId,
          sources: [{ warehouse_id: warehouseId, bin_id: sourceBinId, share_pct: 100 }],
        },
      ],
      p_output_splits: [{ warehouse_id: warehouseId, bin_id: destinationBinId, qty: 1 }],
      p_request_key: sourceRequestKey,
    }

    const sourceFirst = await ownerClient.rpc('post_build_from_bom_sources', sourcePayload)
    if (sourceFirst.error) throw sourceFirst.error
    const sourceBuildId = sourceFirst.data
    assert.ok(sourceBuildId, 'Expected idempotent source-split assembly to return a build id')

    const sourceReplay = await ownerClient.rpc('post_build_from_bom_sources', sourcePayload)
    if (sourceReplay.error) throw sourceReplay.error
    assert.equal(sourceReplay.data, sourceBuildId, 'Expected source-split replay to return the original build id')

    await expectPostgrestError(
      ownerClient.rpc('post_build_from_bom_sources', {
        ...sourcePayload,
        p_qty: 2,
        p_output_splits: [{ warehouse_id: warehouseId, bin_id: destinationBinId, qty: 2 }],
      }),
      'idempotency_key_payload_mismatch',
    )

    const sourceRequest = await querySingle(
      ownerClient,
      'posting_requests',
      'operation_type, request_key, status, result_ref_type, result_ref_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'operation_type', 'assembly.build_sources'],
        ['eq', 'request_key', sourceRequestKey],
      ],
    )
    assert.equal(sourceRequest.status, 'succeeded')
    assert.equal(sourceRequest.result_ref_type, 'BUILD')
    assert.equal(sourceRequest.result_ref_id, sourceBuildId)

    const { data: sourceBuildRows, error: sourceBuildRowsError } = await ownerClient
      .from('builds')
      .select('id')
      .eq('company_id', companyId)
      .eq('id', sourceBuildId)
    if (sourceBuildRowsError) throw sourceBuildRowsError
    assert.equal(sourceBuildRows.length, 1, 'Expected replay not to create an extra source-split build')

    const { data: sourceMovements, error: sourceMovementsError } = await ownerClient
      .from('stock_movements')
      .select('id, type, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'BUILD')
      .eq('ref_id', sourceBuildId)
    if (sourceMovementsError) throw sourceMovementsError
    assert.equal(sourceMovements.length, 2, 'Expected replay not to create extra source-split movements')
    assert.ok(sourceMovements.some((movement) => movement.type === 'issue'))
    assert.ok(sourceMovements.some((movement) => movement.type === 'receive'))

    const productAfterIdempotentBuilds = await querySingle(
      ownerClient,
      'items',
      'id, unit_price',
      [['eq', 'id', productItemId]],
    )
    assert.equal(round2(productAfterIdempotentBuilds.unit_price), round2(originalProduct.unit_price))
  })

  await t.test('Stock rollup is safe for concurrent issues and receipts', async () => {
    async function createTrackedItem(suffix, overrides = {}) {
      const item = await ownerClient
        .from('items')
        .insert({
          company_id: companyId,
          sku: `${PREFIX.toUpperCase()}-${suffix}`,
          name: `${PREFIX} ${suffix}`,
          base_uom_id: eachUomId,
          min_stock: 0,
          unit_price: overrides.unit_price ?? 25,
          primary_role: overrides.primary_role ?? 'general',
          track_inventory: true,
          can_buy: overrides.can_buy ?? true,
          can_sell: overrides.can_sell ?? false,
          is_assembled: overrides.is_assembled ?? false,
        })
        .select('id')
        .single()
      if (item.error) throw item.error
      return item.data.id
    }

    async function createSimpleBom({ suffix, componentId, productId, qtyPer }) {
      const bom = await ownerClient
        .from('boms')
        .insert({
          company_id: companyId,
          product_id: productId,
          name: `${PREFIX} ${suffix} BOM`,
          version: 'v1',
          is_active: true,
        })
        .select('id')
        .single()
      if (bom.error) throw bom.error

      const component = await ownerClient.from('bom_components').insert({
        bom_id: bom.data.id,
        component_item_id: componentId,
        qty_per: qtyPer,
        scrap_pct: 0,
      })
      if (component.error) throw component.error
      return bom.data.id
    }

    async function seedReceipt({ itemId, qty, unitCost, binId, note }) {
      const receipt = await ownerClient
        .from('stock_movements')
        .insert({
          company_id: companyId,
          type: 'receive',
          item_id: itemId,
          uom_id: eachUomId,
          qty,
          qty_base: qty,
          unit_cost: unitCost,
          total_value: qty * unitCost,
          warehouse_to_id: warehouseId,
          bin_to_id: binId,
          notes: note,
          created_by: ownerUser.userId,
          ref_type: 'ADJUST',
        })
      if (receipt.error) throw receipt.error
    }

    function summarizeBucketMovements(rows, itemId, binId) {
      return rows.reduce((sum, row) => {
        const qty = Number(row.qty_base || 0)
        if (row.item_id !== itemId) return sum
        if (row.type === 'receive' || row.type === 'adjust') {
          return row.warehouse_to_id === warehouseId && row.bin_to_id === binId ? sum + qty : sum
        }
        if (row.type === 'issue') {
          return row.warehouse_from_id === warehouseId && row.bin_from_id === binId ? sum - qty : sum
        }
        if (row.type === 'transfer') {
          let next = sum
          if (row.warehouse_from_id === warehouseId && row.bin_from_id === binId) next -= qty
          if (row.warehouse_to_id === warehouseId && row.bin_to_id === binId) next += qty
          return next
        }
        return sum
      }, 0)
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const raceComponentId = await createTrackedItem(`RACE-COMP-${attempt}`, {
        primary_role: 'raw_material',
        can_sell: false,
      })
      const raceProductId = await createTrackedItem(`RACE-FG-${attempt}`, {
        primary_role: 'assembled_product',
        can_buy: false,
        can_sell: true,
        is_assembled: true,
        unit_price: 75,
      })
      const raceBomId = await createSimpleBom({
        suffix: `Race ${attempt}`,
        componentId: raceComponentId,
        productId: raceProductId,
        qtyPer: 2,
      })

      await seedReceipt({
        itemId: raceComponentId,
        qty: 10,
        unitCost: 4,
        binId: sourceBinId,
        note: `${PREFIX} race seed ${attempt}`,
      })

      const firstPayload = {
        p_bom_id: raceBomId,
        p_qty: 3,
        p_warehouse_from: warehouseId,
        p_bin_from: sourceBinId,
        p_warehouse_to: warehouseId,
        p_bin_to: destinationBinId,
        p_request_key: `${PREFIX}-race-${attempt}-a`,
      }
      const secondPayload = {
        ...firstPayload,
        p_request_key: `${PREFIX}-race-${attempt}-b`,
      }

      const results = await Promise.all([
        ownerClient.rpc('post_build_from_bom', firstPayload),
        managerClient.rpc('post_build_from_bom', secondPayload),
      ])
      const successes = results.filter((result) => !result.error)
      const failures = results.filter((result) => result.error)

      assert.equal(
        successes.length,
        1,
        `Expected exactly one concurrent assembly build to succeed on attempt ${attempt}: ${results
          .map((result) => result.error?.message || result.data)
          .join(' | ')}`,
      )
      assert.equal(failures.length, 1, `Expected exactly one concurrent assembly build to fail on attempt ${attempt}`)
      assert.match(failures[0].error.message, /stock|insufficient|negative|not enough/i)

      const successfulBuildId = successes[0].data
      const sourceLevel = await querySingle(
        ownerClient,
        'stock_levels',
        'qty, avg_cost',
        [
          ['eq', 'company_id', companyId],
          ['eq', 'item_id', raceComponentId],
          ['eq', 'warehouse_id', warehouseId],
          ['eq', 'bin_id', sourceBinId],
        ],
      )
      assert.equal(round2(sourceLevel.qty), 4)
      assert.ok(Number(sourceLevel.qty) >= 0, 'Concurrent assembly issue must not drive stock negative')
      assert.equal(round2(sourceLevel.avg_cost), 4)

      const { data: raceBuildRows, error: raceBuildRowsError } = await ownerClient
        .from('builds')
        .select('id')
        .eq('company_id', companyId)
        .eq('bom_id', raceBomId)
      if (raceBuildRowsError) throw raceBuildRowsError
      assert.deepEqual(
        raceBuildRows.map((row) => row.id),
        [successfulBuildId],
        'Failed concurrent assembly request must not leave an extra build row',
      )

      const { data: raceMovements, error: raceMovementsError } = await ownerClient
        .from('stock_movements')
        .select('id, type, item_id, qty_base, warehouse_from_id, warehouse_to_id, bin_from_id, bin_to_id, ref_type, ref_id')
        .eq('company_id', companyId)
        .eq('item_id', raceComponentId)
      if (raceMovementsError) throw raceMovementsError
      assert.equal(
        round2(summarizeBucketMovements(raceMovements, raceComponentId, sourceBinId)),
        round2(sourceLevel.qty),
        'Component movement ledger should reconcile to the source bucket rollup',
      )

      const { data: buildMovements, error: buildMovementsError } = await ownerClient
        .from('stock_movements')
        .select('id, type')
        .eq('company_id', companyId)
        .eq('ref_type', 'BUILD')
        .eq('ref_id', successfulBuildId)
      if (buildMovementsError) throw buildMovementsError
      assert.equal(buildMovements.length, 2, 'Only the successful concurrent build should create movements')
    }

    const receiptItemId = await createTrackedItem('RACE-RECEIPT', {
      primary_role: 'raw_material',
      can_sell: false,
    })

    const receiptResults = await Promise.all([
      ownerClient.rpc('post_stock_receipt', {
        p_company_id: companyId,
        p_item_id: receiptItemId,
        p_uom_id: eachUomId,
        p_qty: 3,
        p_qty_base: 3,
        p_unit_cost: 5,
        p_warehouse_to_id: warehouseId,
        p_bin_to_id: sourceBinId,
        p_ref_type: 'ADJUST',
        p_notes: `${PREFIX} concurrent receipt A`,
        p_request_key: `${PREFIX}-concurrent-receipt-a`,
      }),
      managerClient.rpc('post_stock_receipt', {
        p_company_id: companyId,
        p_item_id: receiptItemId,
        p_uom_id: eachUomId,
        p_qty: 7,
        p_qty_base: 7,
        p_unit_cost: 11,
        p_warehouse_to_id: warehouseId,
        p_bin_to_id: sourceBinId,
        p_ref_type: 'ADJUST',
        p_notes: `${PREFIX} concurrent receipt B`,
        p_request_key: `${PREFIX}-concurrent-receipt-b`,
      }),
    ])
    for (const result of receiptResults) {
      if (result.error) throw result.error
    }

    const receiptLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', receiptItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(receiptLevel.qty), 10)
    assert.equal(round2(receiptLevel.avg_cost), 9.2)

    const { data: receiptMovements, error: receiptMovementsError } = await ownerClient
      .from('stock_movements')
      .select('type, item_id, qty_base, total_value, warehouse_from_id, warehouse_to_id, bin_from_id, bin_to_id')
      .eq('company_id', companyId)
      .eq('item_id', receiptItemId)
    if (receiptMovementsError) throw receiptMovementsError

    const receiptLedgerQty = summarizeBucketMovements(receiptMovements, receiptItemId, sourceBinId)
    const receiptLedgerValue = receiptMovements.reduce(
      (sum, row) => sum + Number(row.total_value || 0),
      0,
    )
    assert.equal(round2(receiptLedgerQty), round2(receiptLevel.qty))
    assert.equal(round2(receiptLedgerValue / receiptLedgerQty), round2(receiptLevel.avg_cost))

    const sharedIssueItemId = await createTrackedItem('RACE-SHARED', {
      primary_role: 'raw_material',
      can_sell: true,
      unit_price: 19,
    })
    const sharedProductId = await createTrackedItem('RACE-SHARED-FG', {
      primary_role: 'assembled_product',
      can_buy: false,
      can_sell: true,
      is_assembled: true,
      unit_price: 80,
    })
    const sharedBomId = await createSimpleBom({
      suffix: 'Shared competition',
      componentId: sharedIssueItemId,
      productId: sharedProductId,
      qtyPer: 2,
    })
    await seedReceipt({
      itemId: sharedIssueItemId,
      qty: 10,
      unitCost: 6,
      binId: sourceBinId,
      note: `${PREFIX} shared race seed`,
    })

    const crossWorkflowResults = await Promise.all([
      ownerClient.rpc('post_build_from_bom', {
        p_bom_id: sharedBomId,
        p_qty: 3,
        p_warehouse_from: warehouseId,
        p_bin_from: sourceBinId,
        p_warehouse_to: warehouseId,
        p_bin_to: destinationBinId,
        p_request_key: `${PREFIX}-shared-assembly`,
      }),
      managerClient.rpc('post_operator_sale', {
        p_company_id: companyId,
        p_bin_from_id: sourceBinId,
        p_customer_id: null,
        p_order_date: todayIso(),
        p_currency_code: 'MZN',
        p_fx_to_base: 1,
        p_reference_no: `${PREFIX.toUpperCase()}-SHARED-RACE`,
        p_notes: 'Concurrent POS versus assembly stock guard',
        p_lines: [{ item_id: sharedIssueItemId, qty: 6, unit_price: 19 }],
        p_settlement_method: 'cash',
        p_bank_account_id: null,
        p_request_key: `${PREFIX}-shared-pos`,
      }),
    ])
    const crossWorkflowSuccesses = crossWorkflowResults.filter((result) => !result.error)
    const crossWorkflowFailures = crossWorkflowResults.filter((result) => result.error)
    assert.equal(
      crossWorkflowSuccesses.length,
      1,
      `Expected one POS-versus-assembly issue to succeed: ${crossWorkflowResults
        .map((result) => result.error?.message || JSON.stringify(result.data))
        .join(' | ')}`,
    )
    assert.equal(crossWorkflowFailures.length, 1)
    assert.match(crossWorkflowFailures[0].error.message, /stock|insufficient|negative|not enough/i)

    const sharedLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', sharedIssueItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(sharedLevel.qty), 4)
    assert.ok(Number(sharedLevel.qty) >= 0, 'POS-versus-assembly competition must not drive stock negative')

    const competingItemId = await createTrackedItem('RACE-SHIP-MANUAL', {
      primary_role: 'resale',
      can_sell: true,
      unit_price: 23,
    })
    await seedReceipt({
      itemId: competingItemId,
      qty: 5,
      unitCost: 4,
      binId: sourceBinId,
      note: `${PREFIX} sales/manual competition seed`,
    })
    const competingOrder = await ownerClient
      .from('sales_orders')
      .insert({
        company_id: companyId,
        customer_id: customerId,
        order_date: todayIso(),
        due_date: plusDaysIso(7),
        currency_code: 'MZN',
        status: 'confirmed',
        subtotal: 69,
        tax_total: 0,
        total: 69,
        total_amount: 69,
        fx_to_base: 1,
        customer: `${PREFIX} Customer`,
        bill_to_name: `${PREFIX} Customer`,
        created_by: ownerUser.userId,
      })
      .select('id')
      .single()
    if (competingOrder.error) throw competingOrder.error
    const competingLine = await ownerClient
      .from('sales_order_lines')
      .insert({
        so_id: competingOrder.data.id,
        company_id: companyId,
        line_no: 1,
        item_id: competingItemId,
        uom_id: eachUomId,
        qty: 3,
        unit_price: 23,
        line_total: 69,
        description: `${PREFIX} sales/manual race`,
      })
      .select('id')
      .single()
    if (competingLine.error) throw competingLine.error

    const salesManualResults = await Promise.allSettled([
      ownerClient.rpc('post_sales_shipment', {
        p_company_id: companyId,
        p_sales_order_id: competingOrder.data.id,
        p_sales_order_line_id: competingLine.data.id,
        p_allocations: [{ warehouse_id: warehouseId, bin_id: sourceBinId, qty: 3, qty_base: 3 }],
        p_request_key: `${PREFIX}-race-sales-ship`,
      }),
      managerClient.rpc('post_stock_issue', {
        p_company_id: companyId,
        p_item_id: competingItemId,
        p_uom_id: eachUomId,
        p_qty: 3,
        p_qty_base: 3,
        p_warehouse_from_id: warehouseId,
        p_bin_from_id: sourceBinId,
        p_unit_cost: 4,
        p_ref_type: 'INTERNAL_USE',
        p_notes: `${PREFIX} sales/manual issue race`,
        p_request_key: `${PREFIX}-race-manual-issue`,
      }),
    ])
    const salesManualSucceeded = salesManualResults.filter((result) => result.status === 'fulfilled' && !result.value.error)
    const salesManualFailed = salesManualResults.filter((result) => result.status === 'rejected' || result.value.error)
    assert.equal(salesManualSucceeded.length, 1, 'Only one sales-shipment/manual-issue contender may consume stock')
    assert.equal(salesManualFailed.length, 1)
    const competingLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', competingItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(competingLevel.qty), 2)
    assert.ok(Number(competingLevel.qty) >= 0, 'Sales shipment/manual issue competition must not drive stock negative')
  })

  await t.test('Landed cost uses receipt value fallback and blocks zero-value value allocation', async () => {
    const zeroValuePo = await ownerClient
      .from('purchase_orders')
      .insert({
        company_id: companyId,
        supplier_id: supplierId,
        order_date: todayIso(),
        due_date: plusDaysIso(14),
        currency_code: 'MZN',
        status: 'approved',
        subtotal: 0,
        tax_total: 0,
        total: 0,
        fx_to_base: 1,
        created_by: ownerUser.userId,
      })
      .select('id')
      .single()
    if (zeroValuePo.error) throw zeroValuePo.error

    const zeroValueReceipt = await ownerClient.from('stock_movements').insert({
      company_id: companyId,
      type: 'receive',
      item_id: componentItemId,
      uom_id: eachUomId,
      qty: 1,
      qty_base: 1,
      unit_cost: null,
      total_value: null,
      warehouse_to_id: warehouseId,
      bin_to_id: sourceBinId,
      notes: `${PREFIX} zero-value landed cost guard`,
      created_by: ownerUser.userId,
      ref_type: 'PO',
      ref_id: zeroValuePo.data.id,
    })
    if (zeroValueReceipt.error) throw zeroValueReceipt.error

    await expectPostgrestError(
      ownerClient.rpc('apply_landed_cost_run', {
        p_company_id: companyId,
        p_purchase_order_id: zeroValuePo.data.id,
        p_supplier_id: supplierId,
        p_applied_by: ownerUser.userId,
        p_currency_code: 'MZN',
        p_fx_to_base: 1,
        p_allocation_method: 'value',
        p_total_extra_cost: 5,
        p_notes: 'Zero-value receipt guard',
        p_charges: [{ label: 'Freight', amount: 5 }],
        p_lines: [],
      }),
      'value_allocation_requires_receipt_value',
    )

    const receipt = await ownerClient.from('stock_movements').insert({
      company_id: companyId,
      type: 'receive',
      item_id: componentItemId,
      uom_id: eachUomId,
      qty: 2,
      qty_base: 2,
      unit_cost: 5,
      total_value: null,
      warehouse_to_id: warehouseId,
      bin_to_id: sourceBinId,
      notes: `${PREFIX} landed cost receipt fallback`,
      created_by: ownerUser.userId,
      ref_type: 'PO',
      ref_id: purchaseOrderId,
    })
    if (receipt.error) throw receipt.error

    const componentLevelBeforeLandedCost = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', componentItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    const expectedLandedCostNewAvg = round2(
      Number(componentLevelBeforeLandedCost.avg_cost || 0)
        + (20 / Number(componentLevelBeforeLandedCost.qty || 1)),
    )

    const landedCostRun = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('apply_landed_cost_run', {
          p_company_id: companyId,
          p_purchase_order_id: purchaseOrderId,
          p_supplier_id: supplierId,
          p_applied_by: ownerUser.userId,
          p_currency_code: 'MZN',
          p_fx_to_base: 1,
          p_allocation_method: 'value',
          p_total_extra_cost: 20,
          p_notes: 'Receipt value fallback regression',
          p_charges: [{ label: 'Freight', amount: 20 }],
          p_lines: [],
        }),
        'Expected landed cost value allocation to use unit_cost * qty fallback',
      ),
    )
    assert.ok(landedCostRun?.run_id, 'Expected landed cost run id')
    assert.equal(landedCostRun.line_count, 1)
    assert.equal(round2(landedCostRun.total_applied_value), 20)
    assert.equal(round2(landedCostRun.total_unapplied_value), 0)

    const landedCostLine = await querySingle(
      ownerClient,
      'landed_cost_run_lines',
      'received_qty_base, allocated_extra, applied_revaluation, previous_avg_cost, new_avg_cost',
      [['eq', 'run_id', landedCostRun.run_id]],
    )
    assert.equal(round2(landedCostLine.received_qty_base), 2)
    assert.equal(round2(landedCostLine.allocated_extra), 20)
    assert.equal(round2(landedCostLine.applied_revaluation), 20)
    assert.equal(round2(landedCostLine.previous_avg_cost), round2(componentLevelBeforeLandedCost.avg_cost))
    assert.equal(round2(landedCostLine.new_avg_cost), expectedLandedCostNewAvg)
  })

  await t.test('Operator sale batches walk-in lines, creates a shipped order, and reduces stock', async () => {
    const productItemBeforeSale = await querySingle(
      ownerClient,
      'items',
      'id, unit_price',
      [['eq', 'id', productItemId]],
    )
    const productStockBefore = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.notEqual(
      round2(productStockBefore.avg_cost),
      round2(productItemBeforeSale.unit_price),
      'Regression fixture should keep inventory cost distinct from commercial sell price',
    )

    const orderCountBefore = await countRows(ownerClient, 'sales_orders', [['eq', 'company_id', companyId]])
    const movementCountBefore = await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'ref_type', 'SO'],
    ])
    const lineCountBefore = await countRows(ownerClient, 'sales_order_lines', [['eq', 'company_id', companyId]])
    const cashSettlementCountBefore = await countRows(ownerClient, 'cash_transactions', [
      ['eq', 'company_id', companyId],
    ])
    const bankSettlementCountBefore = await countRows(ownerClient, 'bank_transactions', [
      ['eq', 'bank_id', bankAccountId],
    ])
    const operatorRequestCountBefore = await countRows(ownerClient, 'posting_requests', [
      ['eq', 'company_id', companyId],
      ['eq', 'operation_type', 'operator.sale'],
    ])

    const operatorSaleRequestKey = `${PREFIX}-operator-sale-idempotent`
    const operatorSalePayload = {
      p_company_id: companyId,
      p_bin_from_id: destinationBinId,
      p_customer_id: null,
      p_order_date: todayIso(),
      p_currency_code: 'MZN',
      p_fx_to_base: 1,
      p_reference_no: `${PREFIX.toUpperCase()}-OP`,
      p_notes: 'Operator sale regression',
      p_lines: [
        { item_id: productItemId, qty: 2, unit_price: 116 },
        { item_id: resaleItemId, qty: 3, unit_price: 32 },
      ],
      p_settlement_method: 'cash',
      p_bank_account_id: null,
      p_request_key: operatorSaleRequestKey,
    }

    async function assertMissingRequestKeyRejected(payload, label) {
      await expectPostgrestError(ownerClient.rpc('post_operator_sale', payload), 'request_key_required')
      assert.equal(
        await countRows(ownerClient, 'sales_orders', [['eq', 'company_id', companyId]]),
        orderCountBefore,
        `${label}: missing request key must not create a sales order`,
      )
      assert.equal(
        await countRows(ownerClient, 'sales_order_lines', [['eq', 'company_id', companyId]]),
        lineCountBefore,
        `${label}: missing request key must not create sales-order lines`,
      )
      assert.equal(
        await countRows(ownerClient, 'stock_movements', [
          ['eq', 'company_id', companyId],
          ['eq', 'ref_type', 'SO'],
        ]),
        movementCountBefore,
        `${label}: missing request key must not create stock movements`,
      )
      assert.equal(
        await countRows(ownerClient, 'cash_transactions', [['eq', 'company_id', companyId]]),
        cashSettlementCountBefore,
        `${label}: missing request key must not create cash settlements`,
      )
      assert.equal(
        await countRows(ownerClient, 'bank_transactions', [['eq', 'bank_id', bankAccountId]]),
        bankSettlementCountBefore,
        `${label}: missing request key must not create bank settlements`,
      )
      assert.equal(
        await countRows(ownerClient, 'posting_requests', [
          ['eq', 'company_id', companyId],
          ['eq', 'operation_type', 'operator.sale'],
        ]),
        operatorRequestCountBefore,
        `${label}: missing request key must not create a posting request`,
      )
      const productStockAfterRejectedKey = await querySingle(
        ownerClient,
        'stock_levels',
        'qty, allocated_qty',
        [
          ['eq', 'company_id', companyId],
          ['eq', 'item_id', productItemId],
          ['eq', 'warehouse_id', warehouseId],
          ['eq', 'bin_id', destinationBinId],
        ],
      )
      assert.equal(round2(productStockAfterRejectedKey.qty), round2(productStockBefore.qty))
      assert.equal(round2(productStockAfterRejectedKey.allocated_qty || 0), 0)
    }

    const { p_request_key: _omittedRequestKey, ...operatorSalePayloadWithoutRequestKey } = operatorSalePayload
    assert.ok(_omittedRequestKey)
    await assertMissingRequestKeyRejected(operatorSalePayloadWithoutRequestKey, 'omitted request key')
    await assertMissingRequestKeyRejected({ ...operatorSalePayload, p_request_key: null }, 'null request key')
    await assertMissingRequestKeyRejected({ ...operatorSalePayload, p_request_key: '' }, 'empty request key')
    await assertMissingRequestKeyRejected({ ...operatorSalePayload, p_request_key: '   ' }, 'blank request key')

    const operatorSale = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_operator_sale', operatorSalePayload),
        'Expected operator sale issue and settlement RPC to succeed',
      ),
    )

    assert.ok(operatorSale?.sales_order_id, 'Expected operator sale RPC to return a sales order id')
    assert.equal(operatorSale.line_count, 2)
    assert.equal(round2(operatorSale.total_amount), 328)
    assert.equal(operatorSale.settlement_method, 'cash')
    assert.ok(operatorSale.settlement_id, 'Expected POS cash settlement id')
    assert.equal(round2(operatorSale.settled_amount_base), 328)
    assert.equal(await countRows(ownerClient, 'sales_orders', [['eq', 'company_id', companyId]]), orderCountBefore + 1)
    assert.equal(await countRows(ownerClient, 'sales_order_lines', [['eq', 'company_id', companyId]]), lineCountBefore + 2)

    const operatorOrder = await querySingle(
      ownerClient,
      'sales_orders',
      'id, status, customer_id, total_amount',
      [['eq', 'id', operatorSale.sales_order_id]],
    )
    assert.equal(operatorOrder.status, 'shipped')
    assert.equal(round2(operatorOrder.total_amount), 328)

    const cashCustomer = await querySingle(
      ownerClient,
      'customers',
      'id, code, name, is_cash',
      [['eq', 'id', operatorOrder.customer_id]],
    )
    assert.equal(cashCustomer.code, 'CASH')
    assert.equal(cashCustomer.is_cash, true)

    const { data: operatorLines, error: operatorLinesError } = await ownerClient
      .from('sales_order_lines')
      .select('id, item_id, qty, shipped_qty, is_shipped, unit_price, line_total')
      .eq('company_id', companyId)
      .eq('so_id', operatorSale.sales_order_id)
      .order('line_no', { ascending: true })
    if (operatorLinesError) throw operatorLinesError
    assert.equal(operatorLines.length, 2)
    assert.equal(round2(operatorLines[0].shipped_qty), round2(operatorLines[0].qty))
    assert.equal(operatorLines[0].is_shipped, true)
    assert.equal(round2(operatorLines[0].unit_price), round2(productItemBeforeSale.unit_price))
    assert.equal(round2(operatorLines[0].line_total), 232)
    assert.equal(round2(operatorLines[1].shipped_qty), round2(operatorLines[1].qty))
    assert.equal(operatorLines[1].is_shipped, true)
    assert.equal(round2(operatorLines[1].unit_price), 32)
    assert.equal(round2(operatorLines[1].line_total), 96)

    const { data: saleMoves, error: saleMovesError } = await ownerClient
      .from('stock_movements')
      .select('id, item_id, qty_base, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'SO')
      .eq('ref_id', operatorSale.sales_order_id)
      .order('created_at', { ascending: true })
    if (saleMovesError) throw saleMovesError
    assert.equal(saleMoves.length, 2)
    assert.equal(await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'ref_type', 'SO'],
    ]), movementCountBefore + 2)

    const { data: posCashSettlements, error: posCashSettlementsError } = await ownerClient
      .from('cash_transactions')
      .select('id, type, ref_type, ref_id, amount_base')
      .eq('company_id', companyId)
      .eq('ref_type', 'SO')
      .eq('ref_id', operatorSale.sales_order_id)
    if (posCashSettlementsError) throw posCashSettlementsError
    assert.equal(posCashSettlements.length, 1)
    assert.equal(posCashSettlements[0].type, 'sale_receipt')
    assert.equal(round2(posCashSettlements[0].amount_base), 328)
    assert.equal(
      await countRows(ownerClient, 'cash_transactions', [['eq', 'company_id', companyId]]),
      cashSettlementCountBefore + 1,
    )

    const productStockAfter = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(productStockAfter.qty), round2(productStockBefore.qty - 2))
    assert.equal(round2(productStockAfter.allocated_qty || 0), 0)

    const resaleStockAfter = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', resaleItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(resaleStockAfter.qty), 3)
    assert.equal(round2(resaleStockAfter.allocated_qty || 0), 0)

    const operatorSaleReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_operator_sale', operatorSalePayload),
        'Expected idempotent POS replay to return the original sale',
      ),
    )
    assert.equal(operatorSaleReplay.sales_order_id, operatorSale.sales_order_id)
    assert.equal(operatorSaleReplay.order_no, operatorSale.order_no)
    assert.equal(operatorSaleReplay.settlement_id, operatorSale.settlement_id)
    assert.equal(await countRows(ownerClient, 'sales_orders', [['eq', 'company_id', companyId]]), orderCountBefore + 1)
    assert.equal(await countRows(ownerClient, 'sales_order_lines', [['eq', 'company_id', companyId]]), lineCountBefore + 2)
    assert.equal(await countRows(ownerClient, 'sales_order_lines', [
      ['eq', 'company_id', companyId],
      ['eq', 'so_id', operatorSale.sales_order_id],
    ]), 2)
    assert.equal(await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'ref_type', 'SO'],
    ]), movementCountBefore + 2)
    assert.equal(
      await countRows(ownerClient, 'cash_transactions', [['eq', 'company_id', companyId]]),
      cashSettlementCountBefore + 1,
    )

    const productStockAfterReplay = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(productStockAfterReplay.qty), round2(productStockAfter.qty))
    assert.equal(round2(productStockAfterReplay.allocated_qty || 0), 0)

    const operatorSaleReplayEquivalentNumerics = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_operator_sale', {
          ...operatorSalePayload,
          p_lines: [
            { item_id: productItemId, qty: '2.00', unit_price: '116.00' },
            { item_id: resaleItemId, qty: '3.0', unit_price: '32.000' },
          ],
        }),
        'Expected numeric-equivalent POS replay payload to return the original sale',
      ),
    )
    assert.equal(operatorSaleReplayEquivalentNumerics.sales_order_id, operatorSale.sales_order_id)
    assert.equal(await countRows(ownerClient, 'sales_orders', [['eq', 'company_id', companyId]]), orderCountBefore + 1)
    assert.equal(await countRows(ownerClient, 'sales_order_lines', [['eq', 'company_id', companyId]]), lineCountBefore + 2)
    assert.equal(await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'ref_type', 'SO'],
    ]), movementCountBefore + 2)
    assert.equal(
      await countRows(ownerClient, 'cash_transactions', [['eq', 'company_id', companyId]]),
      cashSettlementCountBefore + 1,
    )

    const productStockAfterEquivalentReplay = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(productStockAfterEquivalentReplay.qty), round2(productStockAfter.qty))
    assert.equal(round2(productStockAfterEquivalentReplay.allocated_qty || 0), 0)

    await expectPostgrestError(
      ownerClient.rpc('post_operator_sale', {
        ...operatorSalePayload,
        p_lines: [
          { item_id: productItemId, qty: 1, unit_price: 116 },
          { item_id: resaleItemId, qty: 3, unit_price: 32 },
        ],
      }),
      'idempotency_key_payload_mismatch',
    )
    assert.equal(await countRows(ownerClient, 'sales_orders', [['eq', 'company_id', companyId]]), orderCountBefore + 1)
    assert.equal(await countRows(ownerClient, 'sales_order_lines', [['eq', 'company_id', companyId]]), lineCountBefore + 2)
    assert.equal(await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'ref_type', 'SO'],
    ]), movementCountBefore + 2)
    assert.equal(
      await countRows(ownerClient, 'cash_transactions', [['eq', 'company_id', companyId]]),
      cashSettlementCountBefore + 1,
    )
    const productStockAfterMismatch = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(productStockAfterMismatch.qty), round2(productStockAfter.qty))
    assert.equal(round2(productStockAfterMismatch.allocated_qty || 0), 0)

    const operatorRequest = await querySingle(
      ownerClient,
      'posting_requests',
      'operation_type, request_key, payload_hash, status, result_ref_type, result_ref_id, result_payload',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'operation_type', 'operator.sale'],
        ['eq', 'request_key', operatorSaleRequestKey],
      ],
    )
    assert.equal(operatorRequest.status, 'succeeded')
    assert.equal(operatorRequest.result_ref_type, 'SO')
    assert.equal(operatorRequest.result_ref_id, operatorSale.sales_order_id)
    assert.equal(operatorRequest.result_payload.sales_order_id, operatorSale.sales_order_id)
    assert.ok(operatorRequest.payload_hash, 'Expected POS payload hash to be stored')

    const productItemAfterSale = await querySingle(
      ownerClient,
      'items',
      'id, unit_price',
      [['eq', 'id', productItemId]],
    )
    assert.equal(round2(productItemAfterSale.unit_price), round2(productItemBeforeSale.unit_price))

    await expectPostgrestError(
      ownerClient.rpc('post_operator_sale', {
        p_company_id: companyId,
        p_bin_from_id: destinationBinId,
        p_customer_id: null,
        p_order_date: todayIso(),
        p_currency_code: 'MZN',
        p_fx_to_base: 1,
        p_reference_no: `${PREFIX.toUpperCase()}-BANK-MISSING`,
        p_notes: 'Missing bank account regression guard',
        p_lines: [{ item_id: productItemId, qty: 1, unit_price: 116 }],
        p_settlement_method: 'bank',
        p_bank_account_id: null,
        p_request_key: `${PREFIX}-operator-bank-missing`,
      }),
      'Choose a bank account',
    )

    const bankPaidSale = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_operator_sale', {
          p_company_id: companyId,
          p_bin_from_id: destinationBinId,
          p_customer_id: null,
          p_order_date: todayIso(),
          p_currency_code: 'MZN',
          p_fx_to_base: 1,
          p_reference_no: `${PREFIX.toUpperCase()}-BANK`,
          p_notes: 'Operator sale bank settlement regression',
          p_lines: [{ item_id: productItemId, qty: 1, unit_price: 117 }],
          p_settlement_method: 'bank',
          p_bank_account_id: bankAccountId,
          p_request_key: `${PREFIX}-operator-bank`,
        }),
        'Expected bank-paid POS sale to create a bank settlement',
      ),
    )
    assert.equal(bankPaidSale.settlement_method, 'bank')
    assert.equal(bankPaidSale.bank_account_id, bankAccountId)
    assert.equal(round2(bankPaidSale.settled_amount_base), 117)

    const bankPaidLine = await querySingle(
      ownerClient,
      'sales_order_lines',
      'unit_price, line_total',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'so_id', bankPaidSale.sales_order_id],
      ],
    )
    assert.equal(round2(bankPaidLine.unit_price), 117)
    assert.equal(round2(bankPaidLine.line_total), 117)

    const { data: posBankSettlements, error: posBankSettlementsError } = await ownerClient
      .from('bank_transactions')
      .select('id, bank_id, ref_type, ref_id, amount_base')
      .eq('bank_id', bankAccountId)
      .eq('ref_type', 'SO')
      .eq('ref_id', bankPaidSale.sales_order_id)
    if (posBankSettlementsError) throw posBankSettlementsError
    assert.equal(posBankSettlements.length, 1)
    assert.equal(round2(posBankSettlements[0].amount_base), 117)

    const productStockAfterBankSettlement = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', productItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(productStockAfterBankSettlement.qty), round2(productStockAfter.qty - 1))
    assert.equal(round2(productStockAfterBankSettlement.allocated_qty || 0), 0)

    const posOperatorUser = await createTempUser(admin, PREFIX, 'pos-operator')
    created.userIds.add(posOperatorUser.userId)
    const posOperatorClient = await signIn(posOperatorUser.email, posOperatorUser.password)
    const posOperatorMembership = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: posOperatorUser.userId,
      email: posOperatorUser.email.toLowerCase(),
      role: 'OPERATOR',
      status: 'active',
      invited_by: ownerUser.userId,
    })
    if (posOperatorMembership.error) throw posOperatorMembership.error
    try {
      await setActiveCompany(posOperatorClient, companyId)
      const operatorRoleSale = unwrapRpcSingle(
        expectNoSupabaseError(
          await posOperatorClient.rpc('post_operator_sale', {
            p_company_id: companyId,
            p_bin_from_id: destinationBinId,
            p_customer_id: null,
            p_order_date: todayIso(),
            p_currency_code: 'MZN',
            p_fx_to_base: 1,
            p_reference_no: `${PREFIX.toUpperCase()}-OPERATOR-POS`,
            p_notes: 'Operator role POS authority regression',
            p_lines: [{ item_id: resaleItemId, qty: 1, unit_price: 32 }],
            p_settlement_method: 'cash',
            p_bank_account_id: null,
            p_request_key: `${PREFIX}-operator-role-sale`,
          }),
          'Expected OPERATOR role to post a POS sale through the idempotent wrapper',
        ),
      )
      assert.ok(operatorRoleSale?.sales_order_id, 'Expected OPERATOR POS sale to return a sales order id')
    } finally {
      await safeDelete(() =>
        admin
          .from('company_members')
          .delete()
          .eq('company_id', companyId)
          .eq('user_id', posOperatorUser.userId),
      )
    }

    const posViewerUser = await createTempUser(admin, PREFIX, 'pos-viewer')
    created.userIds.add(posViewerUser.userId)
    const posViewerClient = await signIn(posViewerUser.email, posViewerUser.password)
    const posViewerMembership = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: posViewerUser.userId,
      email: posViewerUser.email.toLowerCase(),
      role: 'VIEWER',
      status: 'active',
      invited_by: ownerUser.userId,
    })
    if (posViewerMembership.error) throw posViewerMembership.error
    try {
      await setActiveCompany(posViewerClient, companyId)
      await expectPostgrestError(
        posViewerClient.rpc('post_operator_sale', {
          p_company_id: companyId,
          p_bin_from_id: destinationBinId,
          p_customer_id: null,
          p_order_date: todayIso(),
          p_currency_code: 'MZN',
          p_fx_to_base: 1,
          p_reference_no: `${PREFIX.toUpperCase()}-VIEWER-POS`,
          p_notes: 'Viewer POS authority regression',
          p_lines: [{ item_id: productItemId, qty: 1, unit_price: 116 }],
          p_settlement_method: 'cash',
          p_bank_account_id: null,
          p_request_key: `${PREFIX}-operator-viewer-blocked`,
        }),
        'operators and above|permission|access|forbidden',
      )
    } finally {
      await safeDelete(() =>
        admin
          .from('company_members')
          .delete()
          .eq('company_id', companyId)
          .eq('user_id', posViewerUser.userId),
      )
    }

    await expectPostgrestError(
      ownerClient.rpc('post_operator_sale', {
        p_company_id: '00000000-0000-0000-0000-000000000001',
        p_bin_from_id: destinationBinId,
        p_customer_id: null,
        p_order_date: todayIso(),
        p_currency_code: 'MZN',
        p_fx_to_base: 1,
        p_reference_no: `${PREFIX.toUpperCase()}-CROSS-POS`,
        p_notes: 'Cross-company POS authority regression',
        p_lines: [{ item_id: productItemId, qty: 1, unit_price: 116 }],
        p_settlement_method: 'cash',
        p_bank_account_id: null,
        p_request_key: `${PREFIX}-operator-cross-company`,
      }),
      'Switch into the target company',
    )

    await expectPostgrestError(
      ownerClient.rpc('create_operator_sale_issue', {
        p_company_id: companyId,
        p_bin_from_id: destinationBinId,
        p_customer_id: null,
        p_order_date: todayIso(),
        p_currency_code: 'MZN',
        p_fx_to_base: 1,
        p_reference_no: `${PREFIX.toUpperCase()}-OVER`,
        p_notes: 'Over-issue regression guard',
        p_lines: [{ item_id: productItemId, qty: round2(productStockAfterBankSettlement.qty + 1), unit_price: 116 }],
      }),
      'does not have enough stock',
    )
  })

  await t.test('Opening stock import creates new buckets and updates existing stock deterministically', async () => {
    const importedItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-OPEN`,
        name: `${PREFIX} Opening Sugar`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 27,
        primary_role: 'resale',
        track_inventory: true,
        can_buy: true,
        can_sell: true,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (importedItem.error) throw importedItem.error
    const importedItemId = importedItem.data.id

    const resaleLevelBeforeOpeningImport = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', resaleItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )

    const openingRows = [
      {
        item_id: importedItemId,
        uom_id: eachUomId,
        qty: 12,
        qty_base: 12,
        unit_cost: 14.5,
        total_value: 174,
        warehouse_to_id: warehouseId,
        bin_to_id: destinationBinId,
        notes: 'Opening stock import regression',
      },
      {
        item_id: resaleItemId,
        uom_id: eachUomId,
        qty: 4,
        qty_base: 4,
        unit_cost: 20,
        total_value: 80,
        warehouse_to_id: warehouseId,
        bin_to_id: destinationBinId,
        notes: 'Opening stock top-up regression',
      },
    ]

    const openingImportPayload = {
      p_company_id: companyId,
      p_rows: openingRows,
      p_request_key: `${PREFIX}-opening-import`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_opening_stock_import', { ...openingImportPayload, p_request_key: null }),
      'request_key_required',
    )

    const openingImport = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_opening_stock_import', openingImportPayload),
        'Expected opening stock import RPC to succeed',
      ),
    )

    assert.equal(openingImport.imported_rows, 2)
    assert.equal(openingImport.bucket_count, 2)
    assert.equal(round2(openingImport.total_qty_base), 16)

    const openingReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_opening_stock_import', openingImportPayload),
        'Expected same-key opening import replay to return the original summary',
      ),
    )
    assert.deepEqual(openingReplay, openingImport)

    await expectPostgrestError(
      ownerClient.rpc('post_opening_stock_import', {
        ...openingImportPayload,
        p_rows: [{ ...openingRows[0], qty: 13, qty_base: 13, total_value: 188.5 }, openingRows[1]],
      }),
      'idempotency_key_payload_mismatch',
    )

    const importedLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', importedItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(importedLevel.qty), 12)
    assert.equal(round2(importedLevel.avg_cost), 14.5)
    assert.equal(round2(importedLevel.allocated_qty || 0), 0)

    const updatedResaleLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost, allocated_qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', resaleItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    const expectedUpdatedResaleQty = round2(Number(resaleLevelBeforeOpeningImport.qty || 0) + 4)
    const expectedUpdatedResaleAvgCost = round2(
      ((Number(resaleLevelBeforeOpeningImport.qty || 0) * Number(resaleLevelBeforeOpeningImport.avg_cost || 0)) + 80)
        / expectedUpdatedResaleQty,
    )
    assert.equal(round2(updatedResaleLevel.qty), expectedUpdatedResaleQty)
    assert.equal(round2(updatedResaleLevel.avg_cost), expectedUpdatedResaleAvgCost)
    assert.equal(round2(updatedResaleLevel.allocated_qty || 0), 0)

    const { data: openingMoves, error: openingMovesError } = await ownerClient
      .from('stock_movements')
      .select('id, item_id, type, qty_base, total_value, notes')
      .eq('company_id', companyId)
      .eq('type', 'receive')
      .in('item_id', [importedItemId, resaleItemId])
      .order('created_at', { ascending: true })
    if (openingMovesError) throw openingMovesError

    const importedMove = openingMoves.find((move) => move.item_id === importedItemId)
    const resaleMove = openingMoves.find((move) => move.item_id === resaleItemId && Number(move.qty_base) === 4)
    assert.ok(importedMove, 'Expected a receive movement for the newly imported opening item')
    assert.equal(round2(importedMove.qty_base), 12)
    assert.equal(round2(importedMove.total_value), 174)
    assert.ok(resaleMove, 'Expected a receive movement for the topped-up existing item')

    await expectPostgrestError(
      ownerClient.rpc('post_opening_stock_import', {
        p_company_id: companyId,
        p_rows: [
          {
            item_id: importedItemId,
            uom_id: eachUomId,
            qty: 0,
            qty_base: 0,
            unit_cost: 14.5,
            total_value: 0,
            warehouse_to_id: warehouseId,
            bin_to_id: destinationBinId,
            notes: 'Invalid opening stock regression',
          },
        ],
        p_request_key: `${PREFIX}-opening-invalid`,
      }),
      'quantity|incomplete',
    )
  })

  await t.test('Manual receipt, issue, transfer, and adjustment use governed idempotent RPCs', async () => {
    const manualItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-MANUAL`,
        name: `${PREFIX} Manual Stock`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 21,
        primary_role: 'resale',
        track_inventory: true,
        can_buy: true,
        can_sell: true,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (manualItem.error) throw manualItem.error
    const manualItemId = manualItem.data.id

    const receiptPayload = {
      p_company_id: companyId,
      p_item_id: manualItemId,
      p_uom_id: eachUomId,
      p_qty: 5,
      p_qty_base: 5,
      p_unit_cost: 7,
      p_warehouse_to_id: warehouseId,
      p_bin_to_id: sourceBinId,
      p_ref_type: 'ADJUST',
      p_ref_id: null,
      p_ref_line_id: null,
      p_notes: `${PREFIX} manual receipt`,
      p_request_key: `${PREFIX}-manual-receipt`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_stock_receipt', { ...receiptPayload, p_request_key: null }),
      'request_key_required',
    )

    const manualReceipt = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_receipt', receiptPayload),
        'Expected governed manual receipt to succeed',
      ),
    )
    assert.ok(manualReceipt.movement_id)

    const manualReceiptReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_receipt', receiptPayload),
        'Expected governed manual receipt replay to return the original movement',
      ),
    )
    assert.equal(manualReceiptReplay.movement_id, manualReceipt.movement_id)

    await expectPostgrestError(
      ownerClient.rpc('post_stock_receipt', { ...receiptPayload, p_qty: 6, p_qty_base: 6 }),
      'idempotency_key_payload_mismatch',
    )

    const basePurchaseOrderLine = await querySingle(
      ownerClient,
      'purchase_order_lines',
      'id',
      [['eq', 'po_id', purchaseOrderId]],
    )
    const movementCountBeforeReceiptRefErrors = await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', manualItemId],
    ])
    await expectPostgrestError(
      ownerClient.rpc('post_stock_receipt', {
        ...receiptPayload,
        p_ref_type: 'PO',
        p_ref_id: purchaseOrderId,
        p_ref_line_id: basePurchaseOrderLine.id,
        p_request_key: `${PREFIX}-manual-receipt-po-reference-mismatch`,
      }),
      'purchase_order_reference_not_found',
    )
    await expectPostgrestError(
      ownerClient.rpc('post_stock_receipt', {
        ...receiptPayload,
        p_ref_type: 'PO',
        p_ref_id: 'not-a-purchase-order-id',
        p_ref_line_id: basePurchaseOrderLine.id,
        p_request_key: `${PREFIX}-manual-receipt-po-reference-invalid`,
      }),
      'purchase_order_reference_not_found',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', manualItemId],
    ]), movementCountBeforeReceiptRefErrors)

    const issuePayload = {
      p_company_id: companyId,
      p_item_id: manualItemId,
      p_uom_id: eachUomId,
      p_qty: 2,
      p_qty_base: 2,
      p_warehouse_from_id: warehouseId,
      p_bin_from_id: sourceBinId,
      p_unit_cost: 7,
      p_ref_type: 'INTERNAL_USE',
      p_ref_id: null,
      p_ref_line_id: null,
      p_notes: `${PREFIX} manual issue`,
      p_request_key: `${PREFIX}-manual-issue`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_stock_issue', { ...issuePayload, p_request_key: null }),
      'request_key_required',
    )

    const manualIssue = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_issue', issuePayload),
        'Expected governed manual issue to succeed',
      ),
    )
    assert.ok(manualIssue.movement_id)
    const manualIssueReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_issue', issuePayload),
        'Expected governed manual issue replay to return the original movement',
      ),
    )
    assert.equal(manualIssueReplay.movement_id, manualIssue.movement_id)

    await expectPostgrestError(
      ownerClient.rpc('post_stock_issue', {
        ...issuePayload,
        p_qty: 99,
        p_qty_base: 99,
        p_request_key: `${PREFIX}-manual-issue-too-much`,
      }),
      'insufficient|stock|negative',
    )

    const baseSalesOrderLine = await querySingle(
      ownerClient,
      'sales_order_lines',
      'id',
      [['eq', 'so_id', salesOrderId]],
    )
    const movementCountBeforeIssueRefErrors = await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', manualItemId],
    ])
    await expectPostgrestError(
      ownerClient.rpc('post_stock_issue', {
        ...issuePayload,
        p_ref_type: 'SO',
        p_ref_id: salesOrderId,
        p_ref_line_id: baseSalesOrderLine.id,
        p_request_key: `${PREFIX}-manual-issue-so-reference-mismatch`,
      }),
      'sales_order_reference_not_found',
    )
    await expectPostgrestError(
      ownerClient.rpc('post_stock_issue', {
        ...issuePayload,
        p_ref_type: 'SO',
        p_ref_id: 'not-a-sales-order-id',
        p_ref_line_id: baseSalesOrderLine.id,
        p_request_key: `${PREFIX}-manual-issue-so-reference-invalid`,
      }),
      'sales_order_reference_not_found',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', manualItemId],
    ]), movementCountBeforeIssueRefErrors)

    const transferPayload = {
      p_company_id: companyId,
      p_item_id: manualItemId,
      p_uom_id: eachUomId,
      p_qty: 1,
      p_qty_base: 1,
      p_warehouse_from_id: warehouseId,
      p_bin_from_id: sourceBinId,
      p_warehouse_to_id: warehouseId,
      p_bin_to_id: destinationBinId,
      p_notes: `${PREFIX} manual transfer`,
      p_request_key: `${PREFIX}-manual-transfer`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_stock_transfer', { ...transferPayload, p_request_key: null }),
      'request_key_required',
    )

    const transfer = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_transfer', transferPayload),
        'Expected governed manual transfer to succeed',
      ),
    )
    assert.ok(transfer.transfer_ref)
    assert.ok(transfer.issue_movement_id)
    assert.ok(transfer.receipt_movement_id)

    const transferReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_transfer', transferPayload),
        'Expected governed transfer replay to return both original movement ids',
      ),
    )
    assert.equal(transferReplay.issue_movement_id, transfer.issue_movement_id)
    assert.equal(transferReplay.receipt_movement_id, transfer.receipt_movement_id)

    await expectPostgrestError(
      ownerClient.rpc('post_stock_transfer', {
        ...transferPayload,
        p_bin_to_id: sourceBinId,
        p_request_key: `${PREFIX}-manual-transfer-same-bucket`,
      }),
      'same_source_destination',
    )

    const adjustmentPayload = {
      p_company_id: companyId,
      p_item_id: manualItemId,
      p_uom_id: eachUomId,
      p_target_qty: 4,
      p_target_qty_base: 4,
      p_warehouse_id: warehouseId,
      p_bin_id: destinationBinId,
      p_unit_cost: 8,
      p_reason: `${PREFIX} positive adjustment`,
      p_request_key: `${PREFIX}-manual-adjust-positive`,
    }
    await expectPostgrestError(
      ownerClient.rpc('post_stock_adjustment', { ...adjustmentPayload, p_request_key: null }),
      'request_key_required',
    )

    const adjustment = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_adjustment', adjustmentPayload),
        'Expected governed positive adjustment to succeed',
      ),
    )
    assert.ok(adjustment.movement_id)
    const adjustmentReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_adjustment', adjustmentPayload),
        'Expected governed adjustment replay to return the original movement',
      ),
    )
    assert.equal(adjustmentReplay.movement_id, adjustment.movement_id)

    await expectPostgrestError(
      ownerClient.rpc('post_stock_adjustment', { ...adjustmentPayload, p_target_qty: 5, p_target_qty_base: 5 }),
      'idempotency_key_payload_mismatch',
    )

    const negativeAdjustment = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_stock_adjustment', {
          p_company_id: companyId,
          p_item_id: manualItemId,
          p_uom_id: eachUomId,
          p_target_qty: 1,
          p_target_qty_base: 1,
          p_warehouse_id: warehouseId,
          p_bin_id: sourceBinId,
          p_unit_cost: null,
          p_reason: `${PREFIX} negative adjustment`,
          p_request_key: `${PREFIX}-manual-adjust-negative`,
        }),
        'Expected governed negative adjustment to succeed',
      ),
    )
    assert.ok(negativeAdjustment.movement_id)

    const sourceLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', manualItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    const destinationLevel = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', manualItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(sourceLevel.qty), 1)
    assert.equal(round2(destinationLevel.qty), 4)
    assert.ok(Number(destinationLevel.avg_cost) > 0)

    const manualMovements = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, type, ref_type, ref_id')
        .eq('company_id', companyId)
        .eq('item_id', manualItemId),
      'Expected manual movement lookup to succeed',
    )
    assert.equal(manualMovements.length, 6)
    assert.equal(manualMovements.filter((row) => row.ref_type === 'TRANSFER' && row.ref_id === transfer.transfer_ref).length, 2)
  })

  await t.test('Production runs cover draft preview, idempotent posting, frozen costs, and reversal', async () => {
    const operatorUser = await createTempUser(admin, PREFIX, 'production-operator')
    created.userIds.add(operatorUser.userId)
    const operatorClient = await signIn(operatorUser.email, operatorUser.password)
    const operatorMembership = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: operatorUser.userId,
      email: operatorUser.email.toLowerCase(),
      role: 'OPERATOR',
      status: 'active',
      invited_by: ownerUser.userId,
    })
    throwSupabaseError(operatorMembership.error, 'production operator membership setup failed')
    await setActiveCompany(operatorClient, companyId)

    const viewerUser = await createTempUser(admin, PREFIX, 'production-viewer')
    created.userIds.add(viewerUser.userId)
    const viewerClient = await signIn(viewerUser.email, viewerUser.password)
    const viewerMembership = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: viewerUser.userId,
      email: viewerUser.email.toLowerCase(),
      role: 'VIEWER',
      status: 'active',
      invited_by: ownerUser.userId,
    })
    throwSupabaseError(viewerMembership.error, 'production viewer membership setup failed')
    await setActiveCompany(viewerClient, companyId)

    const rawItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-PR-RM`,
        name: `${PREFIX} Production Run Flour`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 0,
        primary_role: 'raw_material',
        track_inventory: true,
        can_buy: true,
        can_sell: false,
        is_assembled: false,
      })
      .select('id')
      .single()
    throwSupabaseError(rawItem.error, 'production raw item setup failed')
    const prRawItemId = rawItem.data.id

    const outputItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-PR-FG`,
        name: `${PREFIX} Production Run Cake`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 400,
        primary_role: 'assembled_product',
        track_inventory: true,
        can_buy: false,
        can_sell: true,
        is_assembled: true,
      })
      .select('id, unit_price')
      .single()
    throwSupabaseError(outputItem.error, 'production output item setup failed')
    const prOutputItemId = outputItem.data.id

    const seedRawLevel = await ownerClient.from('stock_levels').insert({
      company_id: companyId,
      item_id: prRawItemId,
      warehouse_id: warehouseId,
      bin_id: sourceBinId,
      qty: 20,
      avg_cost: 7,
      allocated_qty: 0,
    })
    throwSupabaseError(seedRawLevel.error, 'production raw stock setup failed')

    const runBom = await ownerClient
      .from('boms')
      .insert({
        company_id: companyId,
        product_id: prOutputItemId,
        name: `${PREFIX} Production Run BOM`,
        version: 'pr-v1',
        is_active: true,
      })
      .select('id')
      .single()
    throwSupabaseError(runBom.error, 'production BOM setup failed')
    const prBomId = runBom.data.id

    const runBomComponent = await ownerClient.from('bom_components').insert({
      bom_id: prBomId,
      component_item_id: prRawItemId,
      qty_per: 3,
      scrap_pct: 0,
    })
    throwSupabaseError(runBomComponent.error, 'production BOM component setup failed')

    await expectPostgrestError(
      viewerClient.rpc('create_production_run_draft', {
        p_company_id: companyId,
        p_bom_id: prBomId,
        p_planned_output_qty: 1,
      }),
      'operator_role_required',
    )

    const draft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: prBomId,
          p_planned_output_qty: 2,
          p_run_date: todayIso(),
          p_notes: `${PREFIX} production run draft`,
        }),
        'Expected production run draft creation to succeed',
      ),
    )
    assert.ok(draft.run_id)
    assert.match(draft.reference_no, /-PR\d{9}$/)

    const seededInputs = expectNoSupabaseError(
      await ownerClient
        .from('production_run_inputs')
        .select('id, line_no, item_id, planned_qty, actual_qty')
        .eq('company_id', companyId)
        .eq('production_run_id', draft.run_id)
        .order('line_no'),
      'Expected production-run input seed lookup to succeed',
    )
    assert.equal(seededInputs.length, 1)
    assert.equal(seededInputs[0].item_id, prRawItemId)
    assert.equal(round2(seededInputs[0].planned_qty), 6)
    assert.equal(round2(seededInputs[0].actual_qty), 6)
    const seededOutput = await querySingle(
      ownerClient,
      'production_run_outputs',
      'id, item_id, uom_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'production_run_id', draft.run_id],
      ],
    )
    assert.equal(seededOutput.item_id, prOutputItemId)
    assert.equal(seededOutput.uom_id, eachUomId)

    await expectPostgrestError(
      admin.from('production_run_inputs').update({ uom_id: boxUomId }).eq('id', seededInputs[0].id),
      'base_uom',
    )
    await expectPostgrestError(
      admin.from('production_run_outputs').update({ uom_id: boxUomId }).eq('id', seededOutput.id),
      'base_uom',
    )

    const movementCountBeforeCancel = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    const cancelDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: prBomId,
          p_planned_output_qty: 1,
          p_run_date: todayIso(),
        }),
        'Expected cancellable production run draft creation to succeed',
      ),
    )
    expectNoSupabaseError(
      await ownerClient.rpc('cancel_production_run_draft', {
        p_company_id: companyId,
        p_run_id: cancelDraft.run_id,
      }),
      'Expected draft cancellation to succeed',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), movementCountBeforeCancel)
    await expectPostgrestError(
      ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: cancelDraft.run_id,
        p_actual_output_qty: 1,
      }),
      'production_run_not_draft',
    )

    expectNoSupabaseError(
      await ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_planned_output_qty: 2,
        p_actual_output_qty: 2,
        p_run_date: todayIso(),
        p_destination_warehouse_id: warehouseId,
        p_destination_bin_id: destinationBinId,
        p_notes: `${PREFIX} production run ready`,
        p_inputs: [
          {
            line_no: 1,
            actual_qty: 6,
            source_warehouse_id: warehouseId,
            source_bin_id: sourceBinId,
          },
        ],
        p_extra_costs: [
          {
            category: 'labour',
            description: `${PREFIX} direct labour`,
            amount_base: 10,
          },
        ],
      }),
      'Expected draft update to succeed',
    )

    const draftExtraCost = await querySingle(
      ownerClient,
      'production_run_extra_costs',
      'id, line_no',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'production_run_id', draft.run_id],
      ],
    )
    const reparentTargetDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: prBomId,
          p_planned_output_qty: 1,
          p_run_date: todayIso(),
        }),
        'Expected reparent target draft creation to succeed',
      ),
    )

    await expectDirectMutationBlocked(
      operatorClient.from('production_runs').insert({
        company_id: companyId,
        reference_no: `${PREFIX.toUpperCase()}-DIRECT-RUN`,
        bom_id: prBomId,
        finished_item_id: prOutputItemId,
        output_uom_id: eachUomId,
        planned_output_qty: 1,
      }),
      'OPERATOR direct production_runs insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_runs').update({ notes: `${PREFIX} direct update` }).eq('id', draft.run_id),
      'OPERATOR direct production_runs update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_inputs').insert({
        company_id: companyId,
        production_run_id: draft.run_id,
        line_no: 99,
        item_id: prRawItemId,
        uom_id: eachUomId,
        planned_qty: 1,
        actual_qty: 1,
      }),
      'OPERATOR direct production_run_inputs insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_inputs').update({ actual_qty: 7 }).eq('id', seededInputs[0].id),
      'OPERATOR direct production_run_inputs update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_inputs').delete().eq('id', seededInputs[0].id),
      'OPERATOR direct production_run_inputs delete',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_inputs').update({ production_run_id: reparentTargetDraft.run_id }).eq('id', seededInputs[0].id),
      'OPERATOR direct production_run_inputs reparent',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_outputs').insert({
        company_id: companyId,
        production_run_id: draft.run_id,
        line_no: 99,
        is_primary: false,
        item_id: prOutputItemId,
        uom_id: eachUomId,
        actual_qty: 1,
      }),
      'OPERATOR direct production_run_outputs insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_outputs').update({ actual_qty: 9 }).eq('id', seededOutput.id),
      'OPERATOR direct production_run_outputs update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_outputs').delete().eq('id', seededOutput.id),
      'OPERATOR direct production_run_outputs delete',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_extra_costs').insert({
        company_id: companyId,
        production_run_id: draft.run_id,
        line_no: 99,
        category: 'labour',
        amount_base: 1,
      }),
      'OPERATOR direct production_run_extra_costs insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_extra_costs').update({ amount_base: 99 }).eq('id', draftExtraCost.id),
      'OPERATOR direct production_run_extra_costs update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_extra_costs').delete().eq('id', draftExtraCost.id),
      'OPERATOR direct production_run_extra_costs delete',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_counters').update({ next_number: 999 }).eq('company_id', companyId),
      'OPERATOR direct production_run_counters update',
    )
    await expectDirectMutationBlocked(
      viewerClient.from('production_runs').update({ notes: `${PREFIX} viewer direct update` }).eq('id', draft.run_id),
      'VIEWER direct production_runs update',
    )
    await expectDirectMutationBlocked(
      viewerClient.from('production_run_inputs').delete().eq('id', seededInputs[0].id),
      'VIEWER direct production_run_inputs delete',
    )

    const crossOwnerUser = await createTempUser(admin, PREFIX, 'production-cross-owner')
    created.userIds.add(crossOwnerUser.userId)
    const crossOwnerClient = await signIn(crossOwnerUser.email, crossOwnerUser.password)

    const crossCompanyBootstrap = unwrapRpcSingle(
      expectNoSupabaseError(
        await crossOwnerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Production Run Cross Company` }),
        'Expected cross-company bootstrap to succeed',
      ),
    )
    const crossCompanyId = crossCompanyBootstrap.out_company_id
    assert.notEqual(crossCompanyId, companyId, 'Cross-company fixture must use a distinct company')
    created.companyIds.add(crossCompanyId)
    await setActiveCompany(crossOwnerClient, crossCompanyId)

    const crossWarehouse = await crossOwnerClient
      .from('warehouses')
      .insert({
        company_id: crossCompanyId,
        code: `${PREFIX.toUpperCase()}-XWH`,
        name: `${PREFIX} Cross Warehouse`,
        status: 'active',
      })
      .select('id')
      .single()
    throwSupabaseError(crossWarehouse.error, 'cross-company warehouse setup failed')
    const crossBin = await crossOwnerClient
      .from('bins')
      .insert({
        id: `${PREFIX.toUpperCase()}-XBIN`,
        company_id: crossCompanyId,
        warehouseId: crossWarehouse.data.id,
        code: 'XBIN',
        name: 'Cross bin',
        status: 'active',
      })
      .select('id')
      .single()
    throwSupabaseError(crossBin.error, 'cross-company bin setup failed')
    const crossRaw = await crossOwnerClient
      .from('items')
      .insert({
        company_id: crossCompanyId,
        sku: `${PREFIX.toUpperCase()}-XRM`,
        name: `${PREFIX} Cross Raw`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 0,
        primary_role: 'raw_material',
        track_inventory: true,
        can_buy: true,
        can_sell: false,
        is_assembled: false,
      })
      .select('id')
      .single()
    throwSupabaseError(crossRaw.error, 'cross-company raw item setup failed')
    const crossOutput = await crossOwnerClient
      .from('items')
      .insert({
        company_id: crossCompanyId,
        sku: `${PREFIX.toUpperCase()}-XFG`,
        name: `${PREFIX} Cross Finished`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 0,
        primary_role: 'assembled_product',
        track_inventory: true,
        can_buy: false,
        can_sell: true,
        is_assembled: true,
      })
      .select('id')
      .single()
    throwSupabaseError(crossOutput.error, 'cross-company output item setup failed')
    const crossBom = await crossOwnerClient
      .from('boms')
      .insert({
        company_id: crossCompanyId,
        product_id: crossOutput.data.id,
        name: `${PREFIX} Cross BOM`,
        version: 'cross-v1',
        is_active: true,
      })
      .select('id')
      .single()
    throwSupabaseError(crossBom.error, 'cross-company BOM setup failed')
    const crossBomComponent = await crossOwnerClient.from('bom_components').insert({
      bom_id: crossBom.data.id,
      component_item_id: crossRaw.data.id,
      qty_per: 1,
      scrap_pct: 0,
    })
    throwSupabaseError(crossBomComponent.error, 'cross-company BOM component setup failed')
    const crossDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await crossOwnerClient.rpc('create_production_run_draft', {
          p_company_id: crossCompanyId,
          p_bom_id: crossBom.data.id,
          p_planned_output_qty: 1,
          p_run_date: todayIso(),
        }),
        'Expected cross-company draft setup to succeed',
      ),
    )

    await setActiveCompany(ownerClient, companyId)
    await setActiveCompany(managerClient, companyId)
    await setActiveCompany(operatorClient, companyId)
    await setActiveCompany(viewerClient, companyId)

    const crossFinishedBom = await ownerClient
      .from('boms')
      .insert({
        company_id: companyId,
        product_id: crossOutput.data.id,
        name: `${PREFIX} Cross Finished Item BOM`,
        version: 'cross-finished',
        is_active: true,
      })
      .select('id')
      .single()
    throwSupabaseError(crossFinishedBom.error, 'cross-finished BOM setup failed')
    const crossInputBom = await ownerClient
      .from('boms')
      .insert({
        company_id: companyId,
        product_id: prOutputItemId,
        name: `${PREFIX} Cross Input Item BOM`,
        version: 'cross-input',
        is_active: true,
      })
      .select('id')
      .single()
    throwSupabaseError(crossInputBom.error, 'cross-input BOM setup failed')
    const crossInputComponent = await ownerClient.from('bom_components').insert({
      bom_id: crossInputBom.data.id,
      component_item_id: crossRaw.data.id,
      qty_per: 1,
      scrap_pct: 0,
    })
    throwSupabaseError(crossInputComponent.error, 'cross-input BOM component setup failed')

    const movementCountBeforeCrossCompany = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    const postingCountBeforeCrossCompany = await countRows(ownerClient, 'posting_requests', [['eq', 'company_id', companyId]])
    const runCountBeforeCrossCompany = await countRows(ownerClient, 'production_runs', [['eq', 'company_id', companyId]])

    await expectPostgrestError(
      ownerClient.rpc('create_production_run_draft', {
        p_company_id: companyId,
        p_bom_id: crossBom.data.id,
        p_planned_output_qty: 1,
      }),
      'bom_not_found',
    )
    await expectPostgrestError(
      ownerClient.rpc('create_production_run_draft', {
        p_company_id: companyId,
        p_bom_id: crossFinishedBom.data.id,
        p_planned_output_qty: 1,
      }),
      'bom_not_found',
    )
    await expectPostgrestError(
      ownerClient.rpc('create_production_run_draft', {
        p_company_id: companyId,
        p_bom_id: crossInputBom.data.id,
        p_planned_output_qty: 1,
      }),
      'bom_has_no_components',
    )
    await expectPostgrestError(
      ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_destination_warehouse_id: crossWarehouse.data.id,
        p_destination_bin_id: crossBin.data.id,
      }),
      'warehouse_not_found',
    )
    await expectPostgrestError(
      ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_inputs: [
          {
            line_no: 1,
            actual_qty: 1,
            source_warehouse_id: crossWarehouse.data.id,
            source_bin_id: crossBin.data.id,
          },
        ],
      }),
      'warehouse_not_found',
    )
    await expectPostgrestError(
      ownerClient.rpc('preview_production_run', {
        p_company_id: crossCompanyId,
        p_run_id: crossDraft.run_id,
      }),
      'cross_company_access_denied',
    )
    await expectPostgrestError(
      ownerClient.rpc('post_production_run', {
        p_company_id: crossCompanyId,
        p_run_id: crossDraft.run_id,
        p_request_key: `${PREFIX}-cross-post`,
      }),
      'cross_company_access_denied',
    )
    await expectPostgrestError(
      ownerClient.rpc('cancel_production_run_draft', {
        p_company_id: crossCompanyId,
        p_run_id: crossDraft.run_id,
      }),
      'cross_company_access_denied',
    )
    await expectPostgrestError(
      managerClient.rpc('reverse_production_run', {
        p_company_id: crossCompanyId,
        p_run_id: crossDraft.run_id,
        p_reason: `${PREFIX} cross reversal`,
        p_request_key: `${PREFIX}-cross-reverse`,
      }),
      'cross_company_access_denied',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), movementCountBeforeCrossCompany)
    assert.equal(await countRows(ownerClient, 'posting_requests', [['eq', 'company_id', companyId]]), postingCountBeforeCrossCompany)
    assert.equal(await countRows(ownerClient, 'production_runs', [['eq', 'company_id', companyId]]), runCountBeforeCrossCompany)

    const movementCountBeforePreview = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    const preview = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('preview_production_run', {
          p_company_id: companyId,
          p_run_id: draft.run_id,
        }),
        'Expected production run preview to succeed',
      ),
    )
    assert.equal(preview.ready, true)
    assert.equal(preview.advisory_minutes, null)
    assert.equal(round2(preview.estimated_material_cost), 42)
    assert.equal(round2(preview.extra_cost_total), 10)
    assert.equal(round2(preview.estimated_total_cost), 52)
    assert.equal(round2(preview.estimated_unit_cost), 26)
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), movementCountBeforePreview)

    await expectPostgrestError(
      ownerClient.rpc('post_production_run', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_request_key: '   ',
      }),
      'request_key_required',
    )
    await expectPostgrestError(
      viewerClient.rpc('post_production_run', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_request_key: `${PREFIX}-pr-viewer-post`,
      }),
      'operator_role_required',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), movementCountBeforePreview)

    const unitPriceBeforePost = await querySingle(
      ownerClient,
      'items',
      'unit_price',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', prOutputItemId],
      ],
    )
    const financeCountsBeforeProductionPost = await financeIsolationCounts(admin, companyId)
    const postRequestKey = `${PREFIX}-production-run-post`
    const posted = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_production_run', {
          p_company_id: companyId,
          p_run_id: draft.run_id,
          p_request_key: postRequestKey,
        }),
        'Expected production run posting to succeed',
      ),
    )
    assert.equal(posted.run_id, draft.run_id)
    assert.equal(posted.status, 'posted')
    assert.equal(posted.input_movements.length, 1)
    assert.ok(posted.output_movement_id)
    assert.equal(round2(posted.material_cost_total), 42)
    assert.equal(round2(posted.extra_cost_total), 10)
    assert.equal(round2(posted.total_cost), 52)
    assert.equal(round2(posted.output_unit_cost), 26)
    assertCountsEqual(
      await financeIsolationCounts(admin, companyId),
      financeCountsBeforeProductionPost,
      'Additional production costs must not create finance postings or settlement rows',
    )

    const postMovementCount = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    assert.equal(postMovementCount, movementCountBeforePreview + 2)

    const postedRun = await querySingle(
      ownerClient,
      'production_runs',
      'status, material_cost_total, extra_cost_total, total_cost, output_unit_cost, output_receipt_movement_id, posted_by, posted_at',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', draft.run_id],
      ],
    )
    assert.equal(postedRun.status, 'posted')
    assert.ok(postedRun.posted_by)
    assert.ok(postedRun.posted_at)
    assert.equal(round2(postedRun.total_cost), 52)
    assert.equal(round2(postedRun.output_unit_cost), 26)
    await expectDirectMutationBlocked(
      operatorClient.from('production_runs').update({ notes: `${PREFIX} direct posted update` }).eq('id', draft.run_id),
      'OPERATOR direct posted production_runs update',
    )

    const postedInput = await querySingle(
      ownerClient,
      'production_run_inputs',
      'actual_qty, frozen_unit_cost, frozen_total_cost, issue_movement_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'production_run_id', draft.run_id],
      ],
    )
    assert.equal(round2(postedInput.actual_qty), 6)
    assert.equal(round2(postedInput.frozen_unit_cost), 7)
    assert.equal(round2(postedInput.frozen_total_cost), 42)
    assert.ok(postedInput.issue_movement_id)
    await expectDirectMutationBlocked(
      operatorClient.from('production_run_inputs').update({ actual_qty: 1 }).eq('issue_movement_id', postedInput.issue_movement_id),
      'OPERATOR direct posted production_run_inputs update',
    )

    const postedOutput = await querySingle(
      ownerClient,
      'production_run_outputs',
      'actual_qty, frozen_unit_cost, frozen_total_cost, receipt_movement_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'production_run_id', draft.run_id],
      ],
    )
    assert.equal(round2(postedOutput.actual_qty), 2)
    assert.equal(round2(postedOutput.frozen_unit_cost), 26)
    assert.equal(round2(postedOutput.frozen_total_cost), 52)
    assert.ok(postedOutput.receipt_movement_id)

    const productionMovements = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, type, ref_type, ref_id, qty_base, unit_cost')
        .eq('company_id', companyId)
        .eq('ref_type', 'PRODUCTION_RUN')
        .eq('ref_id', draft.run_id)
        .order('created_at'),
      'Expected production run movement lookup to succeed',
    )
    assert.equal(productionMovements.length, 2)
    assert.equal(productionMovements.filter((movement) => movement.type === 'issue').length, 1)
    assert.equal(productionMovements.filter((movement) => movement.type === 'receive').length, 1)
    const originalMovementRows = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, company_id, item_id, type, qty, qty_base, uom_id, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id, unit_cost, total_value, ref_type, ref_id, ref_line_id, created_at')
        .in('id', [postedInput.issue_movement_id, postedOutput.receipt_movement_id])
        .order('id'),
      'Expected original production movement snapshot lookup to succeed',
    ).map(normalizeMovementSnapshot)

    const rawStockAfterPost = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', prRawItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(rawStockAfterPost.qty), 14)
    const outputStockAfterPost = await querySingle(
      ownerClient,
      'stock_levels',
      'qty, avg_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', prOutputItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', destinationBinId],
      ],
    )
    assert.equal(round2(outputStockAfterPost.qty), 2)
    assert.equal(round2(outputStockAfterPost.avg_cost), 26)

    const unitPriceAfterPost = await querySingle(
      ownerClient,
      'items',
      'unit_price',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', prOutputItemId],
      ],
    )
    assert.equal(round2(unitPriceAfterPost.unit_price), round2(unitPriceBeforePost.unit_price))

    const postReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_production_run', {
          p_company_id: companyId,
          p_run_id: draft.run_id,
          p_request_key: postRequestKey,
        }),
        'Expected production run post replay to return original result',
      ),
    )
    assert.equal(postReplay.output_movement_id, posted.output_movement_id)
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), postMovementCount)

    const mismatchDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: prBomId,
          p_planned_output_qty: 1,
          p_run_date: todayIso(),
        }),
        'Expected mismatch draft creation to succeed',
      ),
    )
    await expectPostgrestError(
      ownerClient.rpc('post_production_run', {
        p_company_id: companyId,
        p_run_id: mismatchDraft.run_id,
        p_request_key: postRequestKey,
      }),
      'idempotency_key_payload_mismatch',
    )

    await expectPostgrestError(
      ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_actual_output_qty: 3,
      }),
      'production_run_not_draft',
    )

    const insufficientDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: prBomId,
          p_planned_output_qty: 100,
          p_run_date: todayIso(),
        }),
        'Expected insufficient-stock draft creation to succeed',
      ),
    )
    expectNoSupabaseError(
      await ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: insufficientDraft.run_id,
        p_planned_output_qty: 100,
        p_actual_output_qty: 100,
        p_destination_warehouse_id: warehouseId,
        p_destination_bin_id: destinationBinId,
        p_inputs: [
          {
            line_no: 1,
            actual_qty: 300,
            source_warehouse_id: warehouseId,
            source_bin_id: sourceBinId,
          },
        ],
        p_extra_costs: [],
      }),
      'Expected insufficient-stock draft update to succeed',
    )
    await expectPostgrestError(
      ownerClient.rpc('post_production_run', {
        p_company_id: companyId,
        p_run_id: insufficientDraft.run_id,
        p_request_key: `${PREFIX}-production-run-insufficient`,
      }),
      'insufficient_stock',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), postMovementCount)
    const stillDraft = await querySingle(
      ownerClient,
      'production_runs',
      'status',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', insufficientDraft.run_id],
      ],
    )
    assert.equal(stillDraft.status, 'draft')

    const rawReplenishment = await ownerClient.from('stock_movements').insert({
      company_id: companyId,
      type: 'receive',
      item_id: prRawItemId,
      uom_id: eachUomId,
      qty: 1,
      qty_base: 1,
      unit_cost: 99,
      total_value: 99,
      warehouse_to_id: warehouseId,
      bin_to_id: sourceBinId,
      notes: `${PREFIX} production frozen-cost check`,
      created_by: ownerUser.userId,
      ref_type: 'ADJUST',
      ref_id: `${PREFIX}-pr-frozen`,
    })
    throwSupabaseError(rawReplenishment.error, 'production raw replenishment setup failed')
    const bomUpdate = await ownerClient.from('bom_components').update({ qty_per: 4 }).eq('bom_id', prBomId)
    throwSupabaseError(bomUpdate.error, 'production BOM mutation fixture setup failed')

    const frozenRunAfterMasterChange = await querySingle(
      ownerClient,
      'production_runs',
      'material_cost_total, total_cost, output_unit_cost',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', draft.run_id],
      ],
    )
    assert.equal(round2(frozenRunAfterMasterChange.material_cost_total), 42)
    assert.equal(round2(frozenRunAfterMasterChange.total_cost), 52)
    assert.equal(round2(frozenRunAfterMasterChange.output_unit_cost), 26)

    await expectPostgrestError(
      operatorClient.rpc('reverse_production_run', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_reason: `${PREFIX} operator reversal`,
        p_request_key: `${PREFIX}-operator-reverse`,
      }),
      'manager_role_required',
    )
    await expectPostgrestError(
      viewerClient.rpc('reverse_production_run', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_reason: `${PREFIX} viewer reversal`,
        p_request_key: `${PREFIX}-viewer-reverse`,
      }),
      'manager_role_required',
    )

    const reversalMovementCountBefore = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    const reverseRequestKey = `${PREFIX}-production-run-reverse`
    const reversed = unwrapRpcSingle(
      expectNoSupabaseError(
        await managerClient.rpc('reverse_production_run', {
          p_company_id: companyId,
          p_run_id: draft.run_id,
          p_reason: `${PREFIX} controlled reversal`,
          p_request_key: reverseRequestKey,
        }),
        'Expected manager production run reversal to succeed',
      ),
    )
    assert.equal(reversed.run_id, draft.run_id)
    assert.equal(reversed.status, 'reversed')
    assert.ok(reversed.output_reversal_movement_id)
    assert.equal(reversed.input_reversal_movements.length, 1)
    const reversalMovementCountAfter = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    assert.equal(reversalMovementCountAfter, reversalMovementCountBefore + 2)

    const reversedRun = await querySingle(
      ownerClient,
      'production_runs',
      'status, reversal_reason, reversed_by, reversed_at, output_receipt_movement_id, reversal_output_issue_movement_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', draft.run_id],
      ],
    )
    assert.equal(reversedRun.status, 'reversed')
    assert.match(reversedRun.reversal_reason, /controlled reversal/)
    assert.ok(reversedRun.output_receipt_movement_id)
    assert.ok(reversedRun.reversal_output_issue_movement_id)

    const reversalMovements = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, type, ref_type, ref_id, ref_line_id, item_id, uom_id, qty, qty_base, unit_cost, total_value, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id')
        .eq('company_id', companyId)
        .eq('ref_type', 'PRODUCTION_RUN_REVERSAL')
        .eq('ref_id', draft.run_id),
      'Expected reversal movement lookup to succeed',
    )
    assert.equal(reversalMovements.length, 2)
    assert.equal(reversalMovements.filter((movement) => movement.type === 'issue').length, 1)
    assert.equal(reversalMovements.filter((movement) => movement.type === 'receive').length, 1)
    const outputReversalMovement = reversalMovements.find((movement) => movement.type === 'issue')
    const inputReversalMovement = reversalMovements.find((movement) => movement.type === 'receive')
    assert.equal(outputReversalMovement.id, reversed.output_reversal_movement_id)
    assert.equal(outputReversalMovement.ref_line_id, seededOutput.id)
    assert.equal(outputReversalMovement.item_id, prOutputItemId)
    assert.equal(round2(outputReversalMovement.qty_base), 2)
    assert.equal(round2(outputReversalMovement.unit_cost), 26)
    assert.equal(round2(outputReversalMovement.total_value), 52)
    assert.equal(outputReversalMovement.warehouse_from_id, warehouseId)
    assert.equal(outputReversalMovement.bin_from_id, destinationBinId)
    assert.equal(inputReversalMovement.item_id, prRawItemId)
    assert.equal(round2(inputReversalMovement.qty_base), 6)
    assert.equal(round2(inputReversalMovement.unit_cost), 7)
    assert.equal(round2(inputReversalMovement.total_value), 42)
    assert.equal(inputReversalMovement.warehouse_to_id, warehouseId)
    assert.equal(inputReversalMovement.bin_to_id, sourceBinId)
    assert.equal(inputReversalMovement.ref_line_id, seededInputs[0].id)
    assert.equal(round2(bucketDelta(reversalMovements, prRawItemId, warehouseId, sourceBinId)), 6)
    assert.equal(round2(bucketDelta(reversalMovements, prOutputItemId, warehouseId, destinationBinId)), -2)
    const reversedInputLine = await querySingle(
      ownerClient,
      'production_run_inputs',
      'reversal_receipt_movement_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', seededInputs[0].id],
      ],
    )
    const reversedOutputLine = await querySingle(
      ownerClient,
      'production_run_outputs',
      'reversal_issue_movement_id',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', seededOutput.id],
      ],
    )
    assert.equal(reversedInputLine.reversal_receipt_movement_id, inputReversalMovement.id)
    assert.equal(reversedOutputLine.reversal_issue_movement_id, outputReversalMovement.id)
    const originalMovementRowsAfterReversal = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, company_id, item_id, type, qty, qty_base, uom_id, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id, unit_cost, total_value, ref_type, ref_id, ref_line_id, created_at')
        .in('id', [postedInput.issue_movement_id, postedOutput.receipt_movement_id])
        .order('id'),
      'Expected original production movement lookup after reversal to succeed',
    ).map(normalizeMovementSnapshot)
    assert.deepEqual(originalMovementRowsAfterReversal, originalMovementRows, 'Reversal must not edit original production movements')

    const reverseReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await managerClient.rpc('reverse_production_run', {
          p_company_id: companyId,
          p_run_id: draft.run_id,
          p_reason: `${PREFIX} controlled reversal`,
          p_request_key: reverseRequestKey,
        }),
        'Expected production run reversal replay to return original result',
      ),
    )
    assert.equal(reverseReplay.output_reversal_movement_id, reversed.output_reversal_movement_id)
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), reversalMovementCountAfter)

    await expectPostgrestError(
      managerClient.rpc('reverse_production_run', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_reason: `${PREFIX} changed reason`,
        p_request_key: reverseRequestKey,
      }),
      'idempotency_key_payload_mismatch',
    )
    await expectPostgrestError(
      managerClient.rpc('reverse_production_run', {
        p_company_id: companyId,
        p_run_id: draft.run_id,
        p_reason: `${PREFIX} second reversal`,
        p_request_key: `${PREFIX}-production-run-second-reverse`,
      }),
      'production_run_not_posted',
    )

    const failureDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: prBomId,
          p_planned_output_qty: 1,
          p_run_date: todayIso(),
        }),
        'Expected reversal-failure production draft creation to succeed',
      ),
    )
    expectNoSupabaseError(
      await ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: failureDraft.run_id,
        p_planned_output_qty: 1,
        p_actual_output_qty: 1,
        p_destination_warehouse_id: warehouseId,
        p_destination_bin_id: destinationBinId,
        p_inputs: [
          {
            line_no: 1,
            actual_qty: 4,
            source_warehouse_id: warehouseId,
            source_bin_id: sourceBinId,
          },
        ],
        p_extra_costs: [],
      }),
      'Expected reversal-failure draft update to succeed',
    )
    const failurePosted = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('post_production_run', {
          p_company_id: companyId,
          p_run_id: failureDraft.run_id,
          p_request_key: `${PREFIX}-production-run-reversal-failure-post`,
        }),
        'Expected reversal-failure production run post to succeed',
      ),
    )
    const failureLines = await Promise.all([
      querySingle(ownerClient, 'production_run_inputs', 'id, issue_movement_id', [
        ['eq', 'company_id', companyId],
        ['eq', 'production_run_id', failureDraft.run_id],
      ]),
      querySingle(ownerClient, 'production_run_outputs', 'id, receipt_movement_id', [
        ['eq', 'company_id', companyId],
        ['eq', 'production_run_id', failureDraft.run_id],
      ]),
    ])
    const failureOriginalMovements = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id, company_id, item_id, type, qty, qty_base, uom_id, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id, unit_cost, total_value, ref_type, ref_id, ref_line_id, created_at')
        .in('id', [failureLines[0].issue_movement_id, failureLines[1].receipt_movement_id])
        .order('id'),
      'Expected reversal-failure original movement snapshot lookup to succeed',
    ).map(normalizeMovementSnapshot)
    const rawStockBeforeFailedReverse = await stockQtyOrZero(ownerClient, companyId, prRawItemId, warehouseId, sourceBinId)
    const outputStockBeforeConsumption = await stockQtyOrZero(ownerClient, companyId, prOutputItemId, warehouseId, destinationBinId)
    assert.equal(round2(outputStockBeforeConsumption.qty), 1)
    const consumeFailureOutput = unwrapRpcSingle(
      expectNoSupabaseError(
        await managerClient.rpc('post_stock_issue', {
          p_company_id: companyId,
          p_item_id: prOutputItemId,
          p_uom_id: eachUomId,
          p_qty: 1,
          p_qty_base: 1,
          p_warehouse_from_id: warehouseId,
          p_bin_from_id: destinationBinId,
          p_unit_cost: failurePosted.output_unit_cost,
          p_ref_type: 'ADJUST',
          p_ref_id: `${PREFIX}-consume-production-output`,
          p_ref_line_id: null,
          p_notes: `${PREFIX} consume production output before reversal`,
          p_request_key: `${PREFIX}-consume-production-output`,
        }),
        'Expected governed issue to consume finished output before failed reversal',
      ),
    )
    assert.ok(consumeFailureOutput.movement_id)
    const failedReverseKey = `${PREFIX}-production-run-insufficient-output-reverse`
    const failedReverseMovementCountBefore = await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]])
    await expectPostgrestError(
      managerClient.rpc('reverse_production_run', {
        p_company_id: companyId,
        p_run_id: failureDraft.run_id,
        p_reason: `${PREFIX} insufficient output reversal`,
        p_request_key: failedReverseKey,
      }),
      'insufficient_stock',
    )
    assert.equal(await countRows(ownerClient, 'stock_movements', [['eq', 'company_id', companyId]]), failedReverseMovementCountBefore)
    const failureRunAfterRejectedReverse = await querySingle(
      ownerClient,
      'production_runs',
      'status, reversed_at, reversed_by, reversal_reason',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'id', failureDraft.run_id],
      ],
    )
    assert.equal(failureRunAfterRejectedReverse.status, 'posted')
    assert.equal(failureRunAfterRejectedReverse.reversed_at, null)
    assert.equal(failureRunAfterRejectedReverse.reversed_by, null)
    assert.equal(failureRunAfterRejectedReverse.reversal_reason, null)
    const failedReverseRequests = expectNoSupabaseError(
      await ownerClient
        .from('posting_requests')
        .select('id, status')
        .eq('company_id', companyId)
        .eq('operation_type', 'production.run.reverse')
        .eq('request_key', failedReverseKey),
      'Expected failed reversal posting request lookup to succeed',
    )
    assert.equal(failedReverseRequests.filter((row) => row.status === 'succeeded').length, 0)
    assert.equal(
      await countRows(ownerClient, 'stock_movements', [
        ['eq', 'company_id', companyId],
        ['eq', 'ref_type', 'PRODUCTION_RUN_REVERSAL'],
        ['eq', 'ref_id', failureDraft.run_id],
      ]),
      0,
    )
    assert.deepEqual(
      expectNoSupabaseError(
        await ownerClient
          .from('stock_movements')
          .select('id, company_id, item_id, type, qty, qty_base, uom_id, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id, unit_cost, total_value, ref_type, ref_id, ref_line_id, created_at')
          .in('id', [failureLines[0].issue_movement_id, failureLines[1].receipt_movement_id])
          .order('id'),
        'Expected failed-reversal original movement rows to remain readable',
      ).map(normalizeMovementSnapshot),
      failureOriginalMovements,
      'Failed reversal must leave original movement rows unchanged',
    )
    assert.deepEqual(await stockQtyOrZero(ownerClient, companyId, prRawItemId, warehouseId, sourceBinId), rawStockBeforeFailedReverse)
    assert.equal(round2((await stockQtyOrZero(ownerClient, companyId, prOutputItemId, warehouseId, destinationBinId)).qty), 0)

    const productionChainMovements = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('item_id, qty_base, warehouse_from_id, bin_from_id, warehouse_to_id, bin_to_id')
        .eq('company_id', companyId)
        .in('item_id', [prRawItemId, prOutputItemId]),
      'Expected production-chain movement lookup for reconciliation to succeed',
    )
    const rawReconciled = await stockQtyOrZero(ownerClient, companyId, prRawItemId, warehouseId, sourceBinId)
    const outputReconciled = await stockQtyOrZero(ownerClient, companyId, prOutputItemId, warehouseId, destinationBinId)
    assert.equal(round2(rawReconciled.qty), round2(20 + bucketDelta(productionChainMovements, prRawItemId, warehouseId, sourceBinId)))
    assert.equal(round2(outputReconciled.qty), round2(bucketDelta(productionChainMovements, prOutputItemId, warehouseId, destinationBinId)))

    const stockLevels = expectNoSupabaseError(
      await ownerClient
        .from('stock_levels')
        .select('company_id,item_id,warehouse_id,bin_id,qty')
        .eq('company_id', companyId),
      'Expected stock-level lookup to succeed',
    )
    const bucketKeys = stockLevels.map((row) => `${row.company_id}:${row.item_id}:${row.warehouse_id}:${row.bin_id}`)
    assert.equal(bucketKeys.length, new Set(bucketKeys).size, 'Expected no duplicate stock buckets after production run reversal')
    assert.equal(stockLevels.some((row) => Number(row.qty || 0) < 0), false, 'Expected no negative stock bucket after production run reversal')
    const operatorMembershipCleanup = await admin
      .from('company_members')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', operatorUser.userId)
    if (operatorMembershipCleanup.error) throw operatorMembershipCleanup.error
    const viewerMembershipCleanup = await admin
      .from('company_members')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', viewerUser.userId)
    if (viewerMembershipCleanup.error) throw viewerMembershipCleanup.error
  })

  await t.test('Production run posting competes safely with another stock issue', async () => {
    const raceRawItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-PR-RACE-RM`,
        name: `${PREFIX} Production Race Input`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 0,
        primary_role: 'raw_material',
        track_inventory: true,
        can_buy: true,
        can_sell: false,
        is_assembled: false,
      })
      .select('id')
      .single()
    if (raceRawItem.error) throw raceRawItem.error
    const raceRawItemId = raceRawItem.data.id

    const raceOutputItem = await ownerClient
      .from('items')
      .insert({
        company_id: companyId,
        sku: `${PREFIX.toUpperCase()}-PR-RACE-FG`,
        name: `${PREFIX} Production Race Output`,
        base_uom_id: eachUomId,
        min_stock: 0,
        unit_price: 200,
        primary_role: 'assembled_product',
        track_inventory: true,
        can_buy: false,
        can_sell: true,
        is_assembled: true,
      })
      .select('id')
      .single()
    if (raceOutputItem.error) throw raceOutputItem.error
    const raceOutputItemId = raceOutputItem.data.id

    const seedRaceStock = await ownerClient.from('stock_levels').insert({
      company_id: companyId,
      item_id: raceRawItemId,
      warehouse_id: warehouseId,
      bin_id: sourceBinId,
      qty: 2,
      avg_cost: 11,
      allocated_qty: 0,
    })
    if (seedRaceStock.error) throw seedRaceStock.error

    const raceBom = await ownerClient
      .from('boms')
      .insert({
        company_id: companyId,
        product_id: raceOutputItemId,
        name: `${PREFIX} Production Race BOM`,
        version: 'race-v1',
        is_active: true,
      })
      .select('id')
      .single()
    if (raceBom.error) throw raceBom.error

    const raceBomComponent = await ownerClient.from('bom_components').insert({
      bom_id: raceBom.data.id,
      component_item_id: raceRawItemId,
      qty_per: 2,
      scrap_pct: 0,
    })
    if (raceBomComponent.error) throw raceBomComponent.error

    const raceDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_production_run_draft', {
          p_company_id: companyId,
          p_bom_id: raceBom.data.id,
          p_planned_output_qty: 1,
          p_run_date: todayIso(),
        }),
        'Expected race production draft creation to succeed',
      ),
    )
    expectNoSupabaseError(
      await ownerClient.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: raceDraft.run_id,
        p_planned_output_qty: 1,
        p_actual_output_qty: 1,
        p_destination_warehouse_id: warehouseId,
        p_destination_bin_id: destinationBinId,
        p_inputs: [
          {
            line_no: 1,
            actual_qty: 2,
            source_warehouse_id: warehouseId,
            source_bin_id: sourceBinId,
          },
        ],
        p_extra_costs: [],
      }),
      'Expected race draft update to succeed',
    )

    const [productionAttempt, issueAttempt] = await Promise.allSettled([
      ownerClient.rpc('post_production_run', {
        p_company_id: companyId,
        p_run_id: raceDraft.run_id,
        p_request_key: `${PREFIX}-production-run-race-post`,
      }),
      managerClient.rpc('post_stock_issue', {
        p_company_id: companyId,
        p_item_id: raceRawItemId,
        p_uom_id: eachUomId,
        p_qty: 2,
        p_qty_base: 2,
        p_warehouse_from_id: warehouseId,
        p_bin_from_id: sourceBinId,
        p_unit_cost: 11,
        p_ref_type: 'ADJUST',
        p_ref_id: `${PREFIX}-race-issue`,
        p_ref_line_id: null,
        p_notes: `${PREFIX} race issue`,
        p_request_key: `${PREFIX}-production-run-race-manual-issue`,
      }),
    ])

    const attempts = [productionAttempt, issueAttempt].map((entry) => {
      assert.equal(entry.status, 'fulfilled')
      return entry.value
    })
    const successes = attempts.filter((result) => !result.error)
    const failures = attempts.filter((result) => result.error)
    assert.equal(successes.length, 1, 'Expected exactly one competing issue path to win')
    assert.equal(failures.length, 1, 'Expected exactly one competing issue path to fail')
    assert.match(String(failures[0].error.message || failures[0].error), /insufficient_stock|insufficient stock|negative_stock/i)

    const raceStock = await querySingle(
      ownerClient,
      'stock_levels',
      'qty',
      [
        ['eq', 'company_id', companyId],
        ['eq', 'item_id', raceRawItemId],
        ['eq', 'warehouse_id', warehouseId],
        ['eq', 'bin_id', sourceBinId],
      ],
    )
    assert.equal(round2(raceStock.qty), 0)
  })

  await t.test('Manual access control persists across statuses and exposes company detail metadata', async () => {
    const activateResult = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'starter',
      p_status: 'active_paid',
      p_paid_until: isoDateAtNoon(plusDaysIso(30)),
      p_reason: 'Regression activation baseline',
    })
    if (activateResult.error) throw activateResult.error

    await expectPostgrestError(
      ownerClient.rpc('platform_admin_get_company_detail', { p_company_id: companyId }),
      'platform_admin_required',
    )

    const activeDetail = unwrapRpcSingle(
      expectNoSupabaseError(
        await platformAdminClient.rpc('platform_admin_get_company_detail', { p_company_id: companyId }),
        'Expected platform admin company detail lookup to succeed',
      ),
    )
    assert.equal(activeDetail.company_id, companyId)
    assert.equal(activeDetail.owner_user_id, ownerUser.userId)
    assert.equal(activeDetail.owner_email, ownerUser.email.toLowerCase())
    assert.equal(activeDetail.member_count, 2)
    assert.equal(activeDetail.active_member_count, 2)
    assert.ok(activeDetail.company_created_at, 'Expected company created timestamp')
    assert.equal(activeDetail.reset_allowed, false)
    assert.ok(activeDetail.latest_member_last_sign_in_at, 'Expected a latest recorded sign-in timestamp')

    const expiredAt = isoDateAtNoon(todayIso())
    const expireResult = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'trial_7d',
      p_status: 'expired',
      p_trial_expires_at: expiredAt,
      p_reason: 'Regression expiry check',
    })
    if (expireResult.error) throw expireResult.error

    const expiredState = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('get_my_company_access_state', { p_company_id: companyId }),
        'Expected owner access state lookup after expiry to succeed',
      ),
    )
    assert.equal(expiredState.effective_status, 'expired')
    assert.equal(expiredState.access_enabled, false)
    assert.ok(expiredState.purge_scheduled_at, 'Expected expiry to schedule an operational-data purge')

    const expiredDetail = unwrapRpcSingle(
      expectNoSupabaseError(
        await platformAdminClient.rpc('platform_admin_get_company_detail', { p_company_id: companyId }),
        'Expected company detail to reflect expiry',
      ),
    )
    assert.equal(expiredDetail.subscription_status, 'expired')
    assert.equal(expiredDetail.effective_status, 'expired')
    assert.equal(expiredDetail.reset_allowed, true)

    await expectPostgrestError(
      ownerClient.from('uoms').insert({
        code: `${PREFIX.toUpperCase()}-BLK`,
        name: 'Blocked unit',
        family: 'count',
      }),
      'row-level|permission|policy',
    )

    const purgeQueueRow = await querySingle(
      admin,
      'company_purge_queue',
      'company_id, scheduled_for, status, target_scope',
      [['eq', 'company_id', companyId]],
    )
    assert.equal(purgeQueueRow.status, 'scheduled')
    assert.equal(purgeQueueRow.target_scope.identity_credentials, false)
    assert.equal(purgeQueueRow.target_scope.operational_data, true)

    const suspendResult = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'starter',
      p_status: 'suspended',
      p_reason: 'Regression suspension check',
    })
    if (suspendResult.error) throw suspendResult.error

    const suspendedState = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('get_my_company_access_state', { p_company_id: companyId }),
        'Expected access state lookup after suspension to succeed',
      ),
    )
    assert.equal(suspendedState.effective_status, 'suspended')
    assert.equal(suspendedState.access_enabled, false)

    const trialUntil = isoDateAtNoon(plusDaysIso(7))
    const trialResult = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'trial_7d',
      p_status: 'trial',
      p_trial_expires_at: trialUntil,
      p_reason: 'Regression trial restore',
    })
    if (trialResult.error) throw trialResult.error

    const trialState = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('get_my_company_access_state', { p_company_id: companyId }),
        'Expected access state lookup after trial restore to succeed',
      ),
    )
    assert.equal(trialState.effective_status, 'trial')
    assert.equal(trialState.access_enabled, true)
    assert.equal(trialState.trial_expires_at.slice(0, 10), plusDaysIso(7))

    const reactivateResult = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'starter',
      p_status: 'active_paid',
      p_paid_until: isoDateAtNoon(plusDaysIso(30)),
      p_purge_scheduled_at: null,
      p_reason: 'Regression reactivation',
    })
    if (reactivateResult.error) throw reactivateResult.error

    await setActiveCompany(ownerClient, companyId)

    const reactivatedState = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('get_my_company_access_state', { p_company_id: companyId }),
        'Expected access state lookup after reactivation to succeed',
      ),
    )
    assert.equal(reactivatedState.effective_status, 'active_paid')
    assert.equal(reactivatedState.access_enabled, true)
    assert.equal(reactivatedState.purge_scheduled_at, null)

    const reactivatedDetail = unwrapRpcSingle(
      expectNoSupabaseError(
        await platformAdminClient.rpc('platform_admin_get_company_detail', { p_company_id: companyId }),
        'Expected company detail to reflect reactivation',
      ),
    )
    assert.equal(reactivatedDetail.subscription_status, 'active_paid')
    assert.equal(reactivatedDetail.effective_status, 'active_paid')
    assert.equal(reactivatedDetail.reset_allowed, false)

    const { data: reactivatedUom, error: reactivatedUomError } = await ownerClient
      .from('uoms')
      .insert({
        code: `${PREFIX.toUpperCase()}REA`,
        name: 'Reactivated unit',
        family: 'count',
      })
      .select('id')
      .single()
    if (reactivatedUomError) throw reactivatedUomError
    created.uomIds.add(reactivatedUom.id)

    const auditRows = expectNoSupabaseError(
      await platformAdminClient.rpc('platform_admin_list_company_access_events', { p_company_id: companyId }),
      'Expected platform admin audit lookup to succeed',
    )
    const statuses = auditRows.map((row) => row.next_status)
    assert.ok(statuses.includes('trial'))
    assert.ok(statuses.includes('expired'))
    assert.ok(statuses.includes('suspended'))
    assert.ok(statuses.includes('active_paid'))
  })

  await t.test('Platform subscription dashboard list is admin-only and returns real plan analytics fields', async () => {
    await expectPostgrestError(
      ownerClient.rpc('platform_admin_list_company_subscription_dashboard', { p_search: null }),
      'platform_admin_required',
    )

    const dashboardRows = expectNoSupabaseError(
      await platformAdminClient.rpc('platform_admin_list_company_subscription_dashboard', { p_search: null }),
      'Expected platform admin subscription dashboard lookup to succeed',
    )

    const dashboardRow = dashboardRows.find((row) => row.company_id === companyId)
    assert.ok(dashboardRow, 'Expected the selected company to appear in the platform subscription dashboard list')
    assert.equal(dashboardRow.plan_code, 'starter')
    assert.equal(dashboardRow.plan_name, 'Starter')
    assert.equal(dashboardRow.effective_status, 'active_paid')
    assert.equal(Number(dashboardRow.monthly_price_mzn), 2001)
    assert.equal(Number(dashboardRow.annual_price_mzn), 20010)
    assert.equal(dashboardRow.notification_recipient_email, ownerUser.email.toLowerCase())
    assert.ok(dashboardRow.company_created_at, 'Expected company_created_at in the subscription dashboard row')
    assert.ok(dashboardRow.latest_member_last_sign_in_at, 'Expected latest member sign-in in the subscription dashboard row')
    assert.ok(dashboardRow.access_expires_at, 'Expected access_expires_at in the subscription dashboard row')
  })

  await t.test('Platform control email previews resolve the company recipient and real access dates', async () => {
    const purgeAt = isoDateAtNoon(plusDaysIso(45))
    const refreshAccess = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'starter',
      p_status: 'active_paid',
      p_paid_until: isoDateAtNoon(plusDaysIso(30)),
      p_purge_scheduled_at: purgeAt,
      p_reason: 'Regression company email preview baseline',
    })
    if (refreshAccess.error) throw refreshAccess.error

    const detail = unwrapRpcSingle(
      expectNoSupabaseError(
        await platformAdminClient.rpc('platform_admin_get_company_detail', { p_company_id: companyId }),
        'Expected platform admin company detail lookup for email preview to succeed',
      ),
    )
    assert.equal(detail.notification_recipient_email, ownerUser.email.toLowerCase())
    assert.equal(detail.notification_recipient_source, 'company_email')
    assert.equal(detail.company_email, ownerUser.email.toLowerCase())
    assert.ok(detail.access_granted_at, 'Expected access_granted_at to be available for activation confirmation')

    const expiryPreview = await platformAdminClient.functions.invoke('mailer-company-access', {
      body: {
        company_id: companyId,
        template_key: 'expiry_warning',
        mode: 'preview',
      },
    })
    assert.equal(expiryPreview.error, null, expiryPreview.error?.message || 'Expected expiry preview to succeed')
    assert.equal(expiryPreview.data.preview.recipient_email, ownerUser.email.toLowerCase())
    assert.match(expiryPreview.data.preview.subject, /access expires/i)
    assert.ok(expiryPreview.data.preview.text.includes('support@stockwiseapp.com'))
    assert.ok(expiryPreview.data.preview.text.includes(formatLongDate(detail.paid_until)))

    const activationPreview = await platformAdminClient.functions.invoke('mailer-company-access', {
      body: {
        company_id: companyId,
        template_key: 'activation_confirmation',
        mode: 'preview',
      },
    })
    assert.equal(activationPreview.error, null, activationPreview.error?.message || 'Expected activation preview to succeed')
    assert.equal(activationPreview.data.preview.recipient_email, ownerUser.email.toLowerCase())
    assert.ok(activationPreview.data.preview.text.includes('Starter'))
    assert.ok(activationPreview.data.preview.text.includes(formatLongDate(detail.access_granted_at)))
    assert.ok(activationPreview.data.preview.text.includes(formatLongDate(detail.paid_until)))

    const expireForPurgePreview = await platformAdminClient.rpc('platform_admin_set_company_access', {
      p_company_id: companyId,
      p_plan_code: 'trial_7d',
      p_status: 'expired',
      p_trial_expires_at: isoDateAtNoon(todayIso()),
      p_purge_scheduled_at: purgeAt,
      p_reason: 'Regression purge warning preview baseline',
    })
    if (expireForPurgePreview.error) throw expireForPurgePreview.error

    const purgePreview = await platformAdminClient.functions.invoke('mailer-company-access', {
      body: {
        company_id: companyId,
        template_key: 'purge_warning',
        mode: 'preview',
      },
    })
    assert.equal(purgePreview.error, null, purgePreview.error?.message || 'Expected purge preview to succeed')
    assert.equal(purgePreview.data.preview.recipient_email, ownerUser.email.toLowerCase())
    assert.ok(purgePreview.data.preview.text.includes(formatLongDate(purgeAt)))
    assert.ok(purgePreview.data.preview.text.includes('support@stockwiseapp.com'))
  })

  await t.test('Public-facing abuse protection blocks repeated company bootstrap', async () => {
    const bootstrapIds = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bootstrap = expectNoSupabaseError(
        await rateLimitClient.rpc('create_company_and_bootstrap', {
          p_name: `${PREFIX} Rate Limited ${attempt + 1}`,
        }),
        'Expected early bootstrap attempts to succeed',
      )
      const company = unwrapRpcSingle(bootstrap)
      assert.ok(company?.out_company_id)
      bootstrapIds.push(company.out_company_id)
    }

    assert.equal(new Set(bootstrapIds).size, 1, 'Expected repeated bootstrap calls to return the same company before rate limit')
    created.companyIds.add(bootstrapIds[0])

    await expectPostgrestError(
      rateLimitClient.rpc('create_company_and_bootstrap', {
        p_name: `${PREFIX} Rate Limited 4`,
      }),
      'company_bootstrap_rate_limited',
    )
  })
})
