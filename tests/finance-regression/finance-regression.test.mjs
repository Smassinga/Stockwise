import test from 'node:test'
import assert from 'node:assert/strict'

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
  if (error) throw error
  return data
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
    await safeDelete(() => admin.from('finance_document_events').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('vendor_bill_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_invoice_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('vendor_bills').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_invoices').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('purchase_order_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('sales_order_lines').delete().eq('company_id', companyId))
    await safeDelete(() => admin.from('builds').delete().eq('company_id', companyId))
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

    const { data: uoms, error: uomsError } = await ownerClient
      .from('uoms')
      .insert([
        { code: `${PREFIX.toUpperCase()}-EA`, name: 'Each', family: 'count' },
        { code: `${PREFIX.toUpperCase()}-BOX`, name: 'Box', family: 'count' },
      ])
      .select('id, code')
    if (uomsError) throw uomsError
    assert.equal(uoms.length, 2)
    eachUomId = uoms.find((row) => row.code.endsWith('-EA'))?.id ?? null
    boxUomId = uoms.find((row) => row.code.endsWith('-BOX'))?.id ?? null
    assert.ok(eachUomId, 'Expected the base Each UOM to exist')
    assert.ok(boxUomId, 'Expected the Box UOM to exist')
    created.uomIds.add(eachUomId)
    created.uomIds.add(boxUomId)

    const { error: conversionError } = await ownerClient.from('uom_conversions').insert({
      from_uom_id: boxUomId,
      to_uom_id: eachUomId,
      factor: 12,
      company_id: companyId,
    })
    if (conversionError) throw conversionError

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
  })

  await t.test('Operator sale batches walk-in lines, creates a shipped order, and reduces stock', async () => {
    const operatorSale = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('create_operator_sale_issue', {
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
        }),
        'Expected operator sale issue RPC to succeed',
      ),
    )

    assert.ok(operatorSale?.sales_order_id, 'Expected operator sale RPC to return a sales order id')
    assert.equal(operatorSale.line_count, 2)
    assert.equal(round2(operatorSale.total_amount), 328)

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
      .select('id, item_id, qty, shipped_qty, is_shipped')
      .eq('company_id', companyId)
      .eq('so_id', operatorSale.sales_order_id)
      .order('line_no', { ascending: true })
    if (operatorLinesError) throw operatorLinesError
    assert.equal(operatorLines.length, 2)
    assert.equal(round2(operatorLines[0].shipped_qty), round2(operatorLines[0].qty))
    assert.equal(operatorLines[0].is_shipped, true)
    assert.equal(round2(operatorLines[1].shipped_qty), round2(operatorLines[1].qty))
    assert.equal(operatorLines[1].is_shipped, true)

    const { data: saleMoves, error: saleMovesError } = await ownerClient
      .from('stock_movements')
      .select('id, item_id, qty_base, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'SO')
      .eq('ref_id', operatorSale.sales_order_id)
      .order('created_at', { ascending: true })
    if (saleMovesError) throw saleMovesError
    assert.equal(saleMoves.length, 2)

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
    assert.equal(round2(productStockAfter.qty), 2)
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
        p_lines: [{ item_id: productItemId, qty: 5, unit_price: 116 }],
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

    const openingImport = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('import_opening_stock_batch', {
          p_company_id: companyId,
          p_rows: [
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
          ],
        }),
        'Expected opening stock import RPC to succeed',
      ),
    )

    assert.equal(openingImport.imported_rows, 2)
    assert.equal(openingImport.bucket_count, 2)
    assert.equal(round2(openingImport.total_qty_base), 16)

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
    assert.equal(round2(updatedResaleLevel.qty), 7)
    assert.equal(round2(updatedResaleLevel.avg_cost), 16.57)
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
      ownerClient.rpc('import_opening_stock_batch', {
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
      }),
      'quantity|incomplete',
    )
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
        code: `${PREFIX.toUpperCase()}-REA`,
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
