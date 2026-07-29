import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAdminClient,
  createTempUser,
  deleteAuthUser,
  setActiveCompany,
  signIn,
  unwrapRpcSingle,
} from '../finance-regression/helpers.mjs'

const hasLocalEnvironment = Boolean(
  process.env.VITE_SUPABASE_URL
  && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY)
  && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY),
)

test('service execution, open costing, finalisation and dashboard truth integrate locally', {
  skip: !hasLocalEnvironment ? 'Local Supabase environment not supplied' : false,
}, async () => {
  const admin = createAdminClient()
  const user = await createTempUser(admin, 'svc1', 'owner')
  let companyId = null
  try {
    const client = await signIn(user.email, user.password)
    const company = await client.rpc('create_company_and_bootstrap', { p_name: `SVC-1 ${user.userId.slice(0, 8)}` })
    assert.ifError(company.error)
    companyId = unwrapRpcSingle(company.data)?.out_company_id
    assert.ok(companyId)
    await setActiveCompany(client, companyId)

    const uomRead = await admin.from('uoms').select('id').limit(1).single()
    assert.ifError(uomRead.error)
    const customerRead = await client.from('customers').insert({
      company_id: companyId, code: `SVC-${user.userId.slice(0, 6)}`, name: 'SVC-1 Customer', currency_code: 'MZN',
    }).select('id').single()
    assert.ifError(customerRead.error)
    const itemRead = await client.rpc('create_item_with_profile', {
      p_company_id: companyId, p_sku: `SVC-${user.userId.slice(0, 6)}`, p_name: 'SVC-1 Service',
      p_base_uom_id: uomRead.data.id, p_min_stock: 0, p_unit_price: 100,
      p_primary_role: 'service', p_track_inventory: false, p_can_buy: false,
      p_can_sell: true, p_is_assembled: false,
    })
    assert.ifError(itemRead.error)
    const orderRead = await client.from('sales_orders').insert({
      company_id: companyId, customer_id: customerRead.data.id, currency_code: 'MZN',
      status: 'draft', subtotal: 0, total: 0, total_amount: 0, fx_to_base: 1,
    }).select('id').single()
    assert.ifError(orderRead.error)
    const taxRead = await client.rpc('upsert_company_tax_option', {
      p_company_id: companyId, p_code: 'SVCZERO', p_display_name: 'SVC zero',
      p_treatment_type: 'zero', p_rate: 0, p_requires_exemption_reason: false,
      p_effective_from: new Date().toISOString().slice(0, 10), p_effective_until: null, p_option_id: null,
    })
    assert.ifError(taxRead.error)
    const lineRead = await client.from('sales_order_lines').insert({
      company_id: companyId, so_id: orderRead.data.id, line_no: 1, item_id: itemRead.data.id,
      uom_id: uomRead.data.id, qty: 1, unit_price: 100, line_total: 100,
      description: 'Service scope', tax_option_id: taxRead.data.id,
    }).select('id').single()
    assert.ifError(lineRead.error)
    assert.ifError((await client.from('sales_orders').update({ status: 'confirmed' }).eq('id', orderRead.data.id)).error)

    const createRead = await client.rpc('create_service_job', {
      p_company_id: companyId, p_sales_order_id: orderRead.data.id, p_line_ids: [lineRead.data.id],
      p_title: 'SVC-1 controlled test', p_description: null, p_scheduled_start: null,
      p_scheduled_end: null, p_billing_basis: {},
    })
    assert.ifError(createRead.error)
    const jobId = createRead.data
    assert.ok(jobId)

    const duplicateRead = await client.rpc('create_service_job', {
      p_company_id: companyId, p_sales_order_id: orderRead.data.id, p_line_ids: [lineRead.data.id],
      p_title: 'Duplicate', p_description: null, p_scheduled_start: null,
      p_scheduled_end: null, p_billing_basis: {},
    })
    assert.match(duplicateRead.error?.message || '', /already_linked/)

    assert.ifError((await client.rpc('transition_service_job', {
      p_company_id: companyId, p_service_job_id: jobId, p_action: 'start', p_reason: null,
    })).error)
    assert.ifError((await client.rpc('add_service_job_manual_time', {
      p_company_id: companyId, p_service_job_id: jobId, p_worker_user_id: user.userId,
      p_worker_display_name: 'SVC Owner', p_work_date: new Date().toISOString().slice(0, 10),
      p_duration_minutes: 60, p_notes: null,
    })).error)
    assert.ifError((await client.rpc('transition_service_job', {
      p_company_id: companyId, p_service_job_id: jobId, p_action: 'complete', p_reason: null,
    })).error)

    const dates = {
      p_company_id: companyId,
      p_start_date: new Date().toISOString().slice(0, 10),
      p_end_date: new Date().toISOString().slice(0, 10),
      p_compare_start_date: '2026-01-01',
      p_compare_end_date: '2026-01-01',
      p_warehouse_id: null,
    }
    const openDashboard = await client.rpc('get_owner_dashboard', dates)
    assert.ifError(openDashboard.error)
    assert.equal(Number(openDashboard.data.summary.serviceSales), 100)
    assert.equal(Number(openDashboard.data.summary.serviceOpenCostingCount), 1)
    assert.equal(openDashboard.data.summary.grossProfit, null)

    assert.ifError((await client.rpc('add_service_job_direct_cost', {
      p_company_id: companyId, p_service_job_id: jobId, p_category: 'labour',
      p_description: 'Actual labour', p_source_currency: 'MZN', p_source_amount: 30,
      p_fx_to_base: 1, p_cost_date: new Date().toISOString().slice(0, 10),
      p_external_reference: null, p_supplier_id: null, p_time_entry_id: null,
    })).error)
    const finaliseRead = await client.rpc('finalise_service_job_costing', {
      p_company_id: companyId, p_service_job_id: jobId,
      p_posting_request_key: `svc-cost-${user.userId}`, p_confirm_zero: false, p_zero_cost_reason: null,
    })
    assert.ifError(finaliseRead.error)
    assert.equal(Number(finaliseRead.data.total_actual_cost), 30)
    const fingerprint = finaliseRead.data.cost_fingerprint
    assert.ok(fingerprint)

    const finalDashboard = await client.rpc('get_owner_dashboard', dates)
    assert.ifError(finalDashboard.error)
    assert.equal(Number(finalDashboard.data.summary.serviceActualCogs), 30)
    assert.equal(Number(finalDashboard.data.summary.grossProfit), 70)

    assert.ifError((await client.rpc('reopen_service_job_costing', {
      p_company_id: companyId, p_service_job_id: jobId,
      p_current_fingerprint: fingerprint, p_reason: 'Controlled correction',
    })).error)
    const reopenedDashboard = await client.rpc('get_owner_dashboard', dates)
    assert.ifError(reopenedDashboard.error)
    assert.equal(reopenedDashboard.data.summary.grossProfit, null)
  } finally {
    if (companyId) await admin.from('companies').delete().eq('id', companyId)
    await deleteAuthUser(admin, user.userId)
  }
})
