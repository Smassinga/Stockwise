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

const day = (offset = 0) => {
  const value = new Date(Date.now() + offset * 86_400_000)
  return value.toISOString().slice(0, 10)
}

test('COMMS-3C controls suppress reminders and evaluate promises against authoritative exposure evidence', {
  skip: !hasLocalEnvironment ? 'Local Supabase environment not supplied' : false,
}, async () => {
  const admin = createAdminClient()
  const user = await createTempUser(admin, 'collections', 'owner')
  let companyId

  try {
    const client = await signIn(user.email, user.password)
    const companyRead = await client.rpc('create_company_and_bootstrap', { p_name: `OPS-COMMS-3C ${user.userId.slice(0, 8)}` })
    assert.ifError(companyRead.error)
    companyId = unwrapRpcSingle(companyRead.data)?.out_company_id
    assert.ok(companyId)
    await setActiveCompany(client, companyId)

    const customerRead = await client.from('customers').insert({
      company_id: companyId,
      code: `COL-${user.userId.slice(0, 6)}`,
      name: 'OPS-QA-COLLECTIONS-Customer',
      email: user.email,
      currency_code: 'MZN',
    }).select('id').single()
    assert.ifError(customerRead.error)

    const uomRead = await admin.from('uoms').select('id').limit(1).single()
    assert.ifError(uomRead.error)
    const itemRead = await client.rpc('create_item_with_profile', {
      p_company_id: companyId, p_sku: `COL-${user.userId.slice(0, 6)}`, p_name: 'OPS-QA-COLLECTIONS-Service',
      p_base_uom_id: uomRead.data.id, p_min_stock: 0, p_unit_price: 1000,
      p_primary_role: 'service', p_track_inventory: false, p_can_buy: false,
      p_can_sell: true, p_is_assembled: false,
    })
    assert.ifError(itemRead.error)
    const taxRead = await client.rpc('upsert_company_tax_option', {
      p_company_id: companyId, p_code: 'COLZERO', p_display_name: 'Collections zero',
      p_treatment_type: 'zero', p_rate: 0, p_requires_exemption_reason: false,
      p_effective_from: day(), p_effective_until: null, p_option_id: null,
    })
    assert.ifError(taxRead.error)

    const orderRead = await client.from('sales_orders').insert({
      company_id: companyId,
      customer_id: customerRead.data.id,
      customer: 'OPS-QA-COLLECTIONS-Customer',
      bill_to_name: 'OPS-QA-COLLECTIONS-Customer',
      currency_code: 'MZN',
      fx_to_base: 1,
      status: 'draft',
      order_date: day(),
      due_date: day(3),
      subtotal: 0,
      tax_total: 0,
      total: 0,
      total_amount: 0,
    }).select('id,order_no').single()
    assert.ifError(orderRead.error)
    const orderId = orderRead.data.id

    const lineRead = await client.from('sales_order_lines').insert({
      company_id: companyId, so_id: orderId, line_no: 1, item_id: itemRead.data.id,
      uom_id: uomRead.data.id, qty: 1, unit_price: 1000, line_total: 1000,
      description: 'OPS-QA-COLLECTIONS receivable', tax_option_id: taxRead.data.id,
    }).select('id').single()
    assert.ifError(lineRead.error)
    const confirmRead = await client.from('sales_orders').update({ status: 'confirmed' }).eq('id', orderId)
    assert.ifError(confirmRead.error)

    const initialWorkspace = await client.rpc('get_ar_collection_workspace', {
      p_anchor_kind: 'sales_order', p_anchor_id: orderId,
    })
    assert.ifError(initialWorkspace.error)
    assert.equal(initialWorkspace.data.control.status, 'active')
    assert.equal(initialWorkspace.data.control.isDefault, true)
    assert.equal(Number(initialWorkspace.data.anchor.outstanding_amount), 1000)

    const pauseCommand = {
      company_id: companyId,
      anchor_kind: 'sales_order',
      anchor_id: orderId,
      expected_version: 0,
      request_key: `pause-${user.userId}`,
      reason_code: 'customer_requested_time',
      note: 'Controlled local reminder suppression test',
      owner_user_id: user.userId,
      pause_until: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      next_action_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const pauseRead = await client.rpc('pause_collection_reminders', { p_command: pauseCommand })
    assert.ifError(pauseRead.error)
    assert.equal(pauseRead.data.control.status, 'paused')
    const pauseReplay = await client.rpc('pause_collection_reminders', { p_command: pauseCommand })
    assert.ifError(pauseReplay.error)
    assert.equal(pauseReplay.data.idempotentReplay, true)

    const pausedWorkspace = await client.rpc('get_ar_collection_workspace', {
      p_anchor_kind: 'sales_order', p_anchor_id: orderId,
    })
    assert.ifError(pausedWorkspace.error)
    assert.equal(pausedWorkspace.data.control.status, 'paused')
    assert.equal(pausedWorkspace.data.events.filter(event => event.event_type === 'reminder_paused').length, 1)

    const activateRead = await client.rpc('set_collection_active', { p_command: {
      company_id: companyId, anchor_kind: 'sales_order', anchor_id: orderId,
      expected_version: pauseRead.data.control.version, request_key: `activate-${user.userId}`,
      reason_code: 'customer_requested_time', note: 'Controlled local reactivation',
    } })
    assert.ifError(activateRead.error)
    assert.equal(activateRead.data.control.status, 'active')

    const disputeRead = await client.rpc('open_collection_dispute', { p_command: {
      company_id: companyId, anchor_kind: 'sales_order', anchor_id: orderId,
      expected_version: activateRead.data.control.version, request_key: `dispute-${user.userId}`,
      reason_code: 'customer_query', note: 'Synthetic pricing query', owner_user_id: user.userId,
      dispute_category: 'pricing', dispute_summary: 'Controlled local dispute', disputed_amount: 250,
      undisputed_amount: 750, follow_up_at: new Date(Date.now() + 86_400_000).toISOString(),
    } })
    assert.ifError(disputeRead.error)
    assert.equal(disputeRead.data.control.status, 'disputed')
    const disputedWorkspace = await client.rpc('get_ar_collection_workspace', {
      p_anchor_kind: 'sales_order', p_anchor_id: orderId,
    })
    assert.ifError(disputedWorkspace.error)
    assert.equal(Number(disputedWorkspace.data.anchor.outstanding_amount), 1000)

    const resolveRead = await client.rpc('resolve_collection_dispute', { p_command: {
      company_id: companyId, anchor_kind: 'sales_order', anchor_id: orderId,
      expected_version: disputeRead.data.control.version, request_key: `resolve-${user.userId}`,
      resolution_outcome: 'no_change', resulting_status: 'active',
      note: 'Synthetic query resolved without financial change',
    } })
    assert.ifError(resolveRead.error)
    assert.equal(resolveRead.data.control.status, 'active')

    const beforeCash = await admin.from('cash_transactions').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('ref_id', orderId)
    assert.ifError(beforeCash.error)
    const beforeBank = await admin.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('ref_id', orderId)
    assert.ifError(beforeBank.error)

    const promiseRead = await client.rpc('record_payment_promise', { p_command: {
      company_id: companyId, anchor_kind: 'sales_order', anchor_id: orderId,
      expected_version: resolveRead.data.control.version, request_key: `promise-${user.userId}`,
      promised_amount: 400, promised_date: day(1), source: 'customer_call',
      note: 'Controlled local promise', owner_user_id: user.userId,
      next_follow_up_at: new Date(Date.now() + 86_400_000).toISOString(), timezone: 'Africa/Maputo',
    } })
    assert.ifError(promiseRead.error)
    assert.equal(promiseRead.data.control.status, 'promise_to_pay')
    assert.equal(Number(promiseRead.data.promise.promised_amount), 400)

    const evaluationRead = await admin.rpc('evaluate_payment_promises', {
      p_company_id: companyId, p_local_day: day(2), p_timezone: 'Africa/Maputo',
      p_promise_id: promiseRead.data.promise.id,
    })
    assert.ifError(evaluationRead.error)
    assert.equal(Number(evaluationRead.data.evaluated), 1)

    const promiseEvidence = await admin.from('ar_payment_promises').select('status,settled_amount_during_promise').eq('id', promiseRead.data.promise.id).single()
    assert.ifError(promiseEvidence.error)
    assert.equal(promiseEvidence.data.status, 'broken')
    assert.equal(Number(promiseEvidence.data.settled_amount_during_promise), 0)

    const finalWorkspace = await client.rpc('get_ar_collection_workspace', {
      p_anchor_kind: 'sales_order', p_anchor_id: orderId,
    })
    assert.ifError(finalWorkspace.error)
    assert.equal(finalWorkspace.data.control.status, 'manual_follow_up')
    assert.equal(Number(finalWorkspace.data.anchor.outstanding_amount), 1000)
    assert.ok(finalWorkspace.data.events.some(event => event.event_type === 'promise_broken'))

    const afterCash = await admin.from('cash_transactions').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('ref_id', orderId)
    assert.ifError(afterCash.error)
    const afterBank = await admin.from('bank_transactions').select('id', { count: 'exact', head: true }).eq('ref_id', orderId)
    assert.ifError(afterBank.error)
    assert.equal(afterCash.count, beforeCash.count)
    assert.equal(afterBank.count, beforeBank.count)
  } finally {
    await deleteAuthUser(admin, user.userId)
  }
})
