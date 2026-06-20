import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

import {
  createAdminClient,
  createAnonClient,
  createTempUser,
  deleteAuthUser,
  expectPostgrestError,
  setActiveCompany,
  signIn,
  todayIso,
  unwrapRpcSingle,
} from './helpers.mjs'

const PREFIX = `gb-${Date.now().toString(36)}`
const CREATE_GROWTH_BATCH_SIGNATURE = 'public.create_growth_batch_draft(uuid,text,text,text,numeric,text,date,date,text,text,numeric,text,numeric,text,uuid,text,text,text,text,boolean,boolean)'
const MEASUREMENT_SIGNATURE = 'public.record_growth_batch_measurement(uuid,uuid,text,numeric,text,timestamp with time zone,numeric,numeric,numeric,numeric,text,text,text,boolean,boolean,boolean,boolean)'

function addDaysIso(days) {
  const date = new Date(`${todayIso()}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function expectNoSupabaseError(result, message) {
  assert.equal(result.error, null, message || result.error?.message || 'Unexpected Supabase error')
  return result.data
}

function throwSupabaseError(error, label) {
  if (!error) return
  throw new Error(`${label}: ${error.message || JSON.stringify(error)}`)
}

async function countRows(client, table, filters = []) {
  let query = client.from(table).select('id', { count: 'exact', head: true })
  for (const [method, ...args] of filters) query = query[method](...args)
  const { count, error } = await query
  if (error) throw new Error(`Expected ${table} count to succeed: ${error.message || JSON.stringify(error)}`)
  return count ?? 0
}

async function querySingle(client, table, select, filters = []) {
  let query = client.from(table).select(select)
  for (const [method, ...args] of filters) query = query[method](...args)
  const { data, error } = await query.single()
  if (error) throw new Error(`Expected one ${table} row: ${error.message || JSON.stringify(error)}`)
  return data
}

async function expectDirectMutationBlocked(operationPromise, label) {
  await expectPostgrestError(operationPromise, 'permission denied|row-level security|growth_batch_rpc_required')
    .catch((error) => {
      error.message = `${label}: ${error.message}`
      throw error
    })
}

async function runLocalSql(sql) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => key && !key.startsWith('=') && value != null),
  )
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npx supabase db query --local -o json']
    : ['supabase', 'db', 'query', '--local', '-o', 'json']
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...env, SUPABASE_TELEMETRY_DISABLED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`supabase db query failed with code ${code}: ${stderr || output}`))
    })
    child.stdin.end(sql)
  })
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  assert.ok(start >= 0 && end > start, `Expected JSON SQL output, got: ${stdout}`)
  return JSON.parse(stdout.slice(start, end + 1)).rows
}

async function financeIsolationCounts(client, companyId) {
  const filters = [['eq', 'company_id', companyId]]
  const bankAccounts = expectNoSupabaseError(
    await client.from('bank_accounts').select('id').eq('company_id', companyId),
    'Expected bank-account lookup for Growth Batch finance isolation to succeed',
  )
  const bankIds = (bankAccounts || []).map((row) => row.id)
  return {
    cash_transactions: await countRows(client, 'cash_transactions', filters),
    bank_transactions: bankIds.length ? await countRows(client, 'bank_transactions', [['in', 'bank_id', bankIds]]) : 0,
    vendor_bills: await countRows(client, 'vendor_bills', filters),
    vendor_bill_lines: await countRows(client, 'vendor_bill_lines', filters),
    sales_invoices: await countRows(client, 'sales_invoices', filters),
    sales_invoice_lines: await countRows(client, 'sales_invoice_lines', filters),
    finance_document_events: await countRows(client, 'finance_document_events', filters),
  }
}

async function stockMovementCount(client, companyId) {
  return countRows(client, 'stock_movements', [['eq', 'company_id', companyId]])
}

test('Growth Batches G1-G2 authority, lifecycle, idempotency, and read models', async (t) => {
  const admin = createAdminClient()
  const created = {
    companyIds: new Set(),
    userIds: new Set(),
    uomIds: new Set(),
  }

  async function cleanupCompany(companyId) {
    if (!companyId) return
    await admin.from('growth_batch_direct_costs').delete().eq('company_id', companyId)
    await admin.from('growth_batch_measurements').delete().eq('company_id', companyId)
    await admin.from('growth_batch_events').delete().eq('company_id', companyId)
    await admin.from('growth_batches').delete().eq('company_id', companyId)
    await admin.from('growth_batch_counters').delete().eq('company_id', companyId)
    await admin.from('posting_requests').delete().eq('company_id', companyId)
    await admin.from('stock_movements').delete().eq('company_id', companyId)
    await admin.from('stock_levels').delete().eq('company_id', companyId)
    await admin.from('items').delete().eq('company_id', companyId)
    await admin.from('bins').delete().eq('company_id', companyId)
    await admin.from('warehouses').delete().eq('company_id', companyId)
    await admin.from('company_subscription_state').delete().eq('company_id', companyId)
    await admin.from('user_active_company').delete().eq('company_id', companyId)
    await admin.from('company_settings').delete().eq('company_id', companyId)
    await admin.from('company_members').delete().eq('company_id', companyId)
    await admin.from('companies').delete().eq('id', companyId)
  }

  t.after(async () => {
    for (const companyId of created.companyIds) await cleanupCompany(companyId)
    for (const uomId of created.uomIds) await admin.from('uoms').delete().eq('id', uomId)
    for (const userId of created.userIds) await deleteAuthUser(admin, userId)
  })

  const ownerUser = await createTempUser(admin, PREFIX, 'owner')
  const operatorUser = await createTempUser(admin, PREFIX, 'operator')
  const viewerUser = await createTempUser(admin, PREFIX, 'viewer')
  const crossOwnerUser = await createTempUser(admin, PREFIX, 'cross-owner')
  for (const user of [ownerUser, operatorUser, viewerUser, crossOwnerUser]) created.userIds.add(user.userId)

  const ownerClient = await signIn(ownerUser.email, ownerUser.password)
  const operatorClient = await signIn(operatorUser.email, operatorUser.password)
  const viewerClient = await signIn(viewerUser.email, viewerUser.password)
  const crossOwnerClient = await signIn(crossOwnerUser.email, crossOwnerUser.password)
  const anonClient = createAnonClient()

  const company = unwrapRpcSingle(
    expectNoSupabaseError(
      await ownerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Growth Company` }),
      'Expected Growth Batch owner company bootstrap to succeed',
    ),
  )
  const companyId = company.out_company_id
  created.companyIds.add(companyId)
  await setActiveCompany(ownerClient, companyId)

  for (const [user, role] of [[operatorUser, 'OPERATOR'], [viewerUser, 'VIEWER']]) {
    const membership = await admin.from('company_members').insert({
      company_id: companyId,
      user_id: user.userId,
      email: user.email.toLowerCase(),
      role,
      status: 'active',
      invited_by: ownerUser.userId,
    })
    throwSupabaseError(membership.error, `Growth Batch ${role} membership setup failed`)
  }
  await setActiveCompany(operatorClient, companyId)
  await setActiveCompany(viewerClient, companyId)

  const existingUoms = expectNoSupabaseError(
    await ownerClient.from('uoms').select('id, code, family').in('code', ['EA', 'KG', 'M2', 'C']),
    'Expected UOM lookup to succeed',
  )
  async function ensureUom(code, family, name) {
    const existing = existingUoms.find((row) => row.code === code)
    if (existing) return existing.id
    const id = `${PREFIX}_${code.toLowerCase()}`
    created.uomIds.add(id)
    const inserted = await ownerClient.from('uoms').insert({ id, code, name, family }).select('id').single()
    throwSupabaseError(inserted.error, `UOM ${code} setup failed`)
    return inserted.data.id
  }
  const eachUomId = await ensureUom('EA', 'count', 'Each')
  const kgUomId = await ensureUom('KG', 'mass', 'Kilogram')
  const areaUomId = await ensureUom('M2', 'area', 'Square metre')
  const tempUomId = await ensureUom('C', 'other', 'Celsius')

  const warehouse = await ownerClient
    .from('warehouses')
    .insert({ company_id: companyId, code: `${PREFIX.toUpperCase()}-WH`, name: `${PREFIX} Warehouse`, status: 'active' })
    .select('id')
    .single()
  throwSupabaseError(warehouse.error, 'Growth Batch warehouse setup failed')
  const warehouseId = warehouse.data.id
  const bin = await ownerClient
    .from('bins')
    .insert({
      id: `${PREFIX.toUpperCase()}-BIN`,
      company_id: companyId,
      warehouseId,
      code: 'GBIN',
      name: 'Growth bin',
      status: 'active',
    })
    .select('id')
    .single()
  throwSupabaseError(bin.error, 'Growth Batch bin setup failed')
  const binId = bin.data.id

  const priceItem = await ownerClient
    .from('items')
    .insert({
      company_id: companyId,
      sku: `${PREFIX.toUpperCase()}-PRICE`,
      name: `${PREFIX} Price Sentinel`,
      base_uom_id: eachUomId,
      min_stock: 0,
      unit_price: 123,
      primary_role: 'general',
      track_inventory: false,
      can_buy: false,
      can_sell: true,
      is_assembled: false,
    })
    .select('id, unit_price')
    .single()
  throwSupabaseError(priceItem.error, 'Growth Batch item sentinel setup failed')

  await t.test('schema authority metadata and direct mutation protections', async () => {
    const schemaRows = await runLocalSql(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in (
        'growth_batch_counters',
        'growth_batches',
        'growth_batch_events',
        'growth_batch_measurements',
        'growth_batch_direct_costs'
      )
      order by relname;
    `)
    assert.equal(schemaRows.length, 5, 'Expected all Growth Batch tables to exist')
    assert.equal(schemaRows.every((row) => row.relrowsecurity === true), true, 'Expected Growth Batch RLS enabled')
    assert.equal(schemaRows.every((row) => row.relforcerowsecurity === true), true, 'Expected Growth Batch FORCE RLS enabled')

    const grantRows = await runLocalSql(`
      select
        has_function_privilege('anon', '${CREATE_GROWTH_BATCH_SIGNATURE}', 'EXECUTE') as anon_create,
        has_function_privilege('authenticated', '${CREATE_GROWTH_BATCH_SIGNATURE}', 'EXECUTE') as auth_create,
        has_function_privilege('anon', 'public.activate_growth_batch(uuid,uuid,text)', 'EXECUTE') as anon_activate,
        has_function_privilege('authenticated', 'public.activate_growth_batch(uuid,uuid,text)', 'EXECUTE') as auth_activate,
        has_function_privilege('anon', '${MEASUREMENT_SIGNATURE}', 'EXECUTE') as anon_measurement,
        has_function_privilege('authenticated', '${MEASUREMENT_SIGNATURE}', 'EXECUTE') as auth_measurement;
    `)
    assert.equal(grantRows[0].anon_create, false, 'anon must not execute create_growth_batch_draft')
    assert.equal(grantRows[0].anon_activate, false, 'anon must not execute activate_growth_batch')
    assert.equal(grantRows[0].anon_measurement, false, 'anon must not execute record_growth_batch_measurement')
    assert.equal(grantRows[0].auth_create, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_activate, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_measurement, true, 'authenticated users execute governed Growth Batch RPCs')

    await expectPostgrestError(
      anonClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} anon batch`,
        p_batch_family: 'poultry',
        p_primary_quantity_basis: 'count',
        p_opening_primary_qty: 10,
        p_primary_uom_id: eachUomId,
        p_request_key: `${PREFIX}-anon-create`,
      }),
      'permission denied|not_authenticated',
    )

    await expectPostgrestError(
      viewerClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} viewer batch`,
        p_batch_family: 'poultry',
        p_primary_quantity_basis: 'count',
        p_opening_primary_qty: 10,
        p_primary_uom_id: eachUomId,
        p_request_key: `${PREFIX}-viewer-create`,
      }),
      'operator_role_required',
    )

    await expectDirectMutationBlocked(
      operatorClient.from('growth_batches').insert({
        company_id: companyId,
        reference_no: `${PREFIX.toUpperCase()}-DIRECT`,
        name: 'Direct batch',
        batch_family: 'poultry',
        primary_quantity_basis: 'count',
        primary_uom_id: eachUomId,
        opening_primary_qty: 1,
      }),
      'direct growth_batches insert',
    )
  })

  let countBatch = null
  let weightBatch = null
  let areaBatch = null

  await t.test('draft lifecycle, references, quantity basis rules, and cross-company checks', async () => {
    const draft = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', {
          p_company_id: companyId,
          p_name: `${PREFIX} Poultry Batch`,
          p_batch_family: 'poultry',
          p_primary_quantity_basis: 'count',
          p_opening_primary_qty: 100,
          p_primary_uom_id: eachUomId,
          p_start_date: todayIso(),
          p_species_text: 'Broiler',
          p_purpose: 'Grow-out',
          p_opening_total_weight: 35,
          p_weight_uom_id: kgUomId,
          p_warehouse_id: warehouseId,
          p_bin_id: binId,
          p_location_description: 'House A',
          p_notes: 'Initial draft',
          p_request_key: `${PREFIX}-create-count`,
          p_opening_total_weight_present: true,
        }),
        'Expected operator to create Growth Batch draft',
      ),
    )
    countBatch = draft
    assert.ok(draft.batch_id)
    assert.match(draft.reference_no, /-GB\d{9}$/)

    const createReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', {
          p_company_id: companyId,
          p_name: `${PREFIX} Poultry Batch`,
          p_batch_family: 'poultry',
          p_primary_quantity_basis: 'count',
          p_opening_primary_qty: 100,
          p_primary_uom_id: eachUomId,
          p_start_date: todayIso(),
          p_species_text: 'Broiler',
          p_purpose: 'Grow-out',
          p_opening_total_weight: 35,
          p_weight_uom_id: kgUomId,
          p_warehouse_id: warehouseId,
          p_bin_id: binId,
          p_location_description: 'House A',
          p_notes: 'Initial draft',
          p_request_key: `${PREFIX}-create-count`,
          p_opening_total_weight_present: true,
        }),
        'Expected create replay to return original result',
      ),
    )
    assert.equal(createReplay.batch_id, draft.batch_id)
    assert.equal(await countRows(ownerClient, 'growth_batches', [['eq', 'company_id', companyId], ['eq', 'reference_no', draft.reference_no]]), 1)

    await expectPostgrestError(
      operatorClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} changed create payload`,
        p_batch_family: 'poultry',
        p_primary_quantity_basis: 'count',
        p_opening_primary_qty: 100,
        p_primary_uom_id: eachUomId,
        p_start_date: todayIso(),
        p_request_key: `${PREFIX}-create-count`,
      }),
      'idempotency_key_payload_mismatch',
    )

    const concurrent = await Promise.all([
      operatorClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} Concurrent A`,
        p_batch_family: 'fish',
        p_primary_quantity_basis: 'weight',
        p_opening_primary_qty: 12.5,
        p_primary_uom_id: kgUomId,
        p_start_date: todayIso(),
        p_request_key: `${PREFIX}-concurrent-a`,
      }),
      operatorClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} Concurrent B`,
        p_batch_family: 'livestock',
        p_primary_quantity_basis: 'count',
        p_opening_primary_qty: 3,
        p_primary_uom_id: eachUomId,
        p_start_date: todayIso(),
        p_request_key: `${PREFIX}-concurrent-b`,
      }),
    ])
    assert.equal(concurrent.every((result) => !result.error), true, 'Expected concurrent creates to succeed')
    const refs = concurrent.map((result) => unwrapRpcSingle(result.data).reference_no)
    assert.equal(new Set(refs).size, 2, 'Concurrent draft creation must not duplicate references')

    await expectPostgrestError(
      operatorClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} fractional count`,
        p_batch_family: 'poultry',
        p_primary_quantity_basis: 'count',
        p_opening_primary_qty: 1.5,
        p_primary_uom_id: eachUomId,
        p_request_key: `${PREFIX}-fractional-count`,
      }),
      'fractional_count_not_allowed',
    )
    await expectPostgrestError(
      operatorClient.rpc('create_growth_batch_draft', {
        p_company_id: companyId,
        p_name: `${PREFIX} zero qty`,
        p_batch_family: 'fish',
        p_primary_quantity_basis: 'weight',
        p_opening_primary_qty: 0,
        p_primary_uom_id: kgUomId,
        p_request_key: `${PREFIX}-zero-qty`,
      }),
      'invalid_growth_batch_quantity',
    )

    weightBatch = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', {
          p_company_id: companyId,
          p_name: `${PREFIX} Fish Batch`,
          p_batch_family: 'fish',
          p_primary_quantity_basis: 'weight',
          p_opening_primary_qty: 12.75,
          p_primary_uom_id: kgUomId,
          p_start_date: todayIso(),
          p_request_key: `${PREFIX}-create-weight`,
        }),
        'Expected decimal weight basis to be accepted',
      ),
    )
    areaBatch = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', {
          p_company_id: companyId,
          p_name: `${PREFIX} Nursery Plot`,
          p_batch_family: 'nursery',
          p_primary_quantity_basis: 'area',
          p_opening_primary_qty: 3.5,
          p_primary_uom_id: areaUomId,
          p_start_date: todayIso(),
          p_area: 3.5,
          p_area_uom_id: areaUomId,
          p_request_key: `${PREFIX}-create-area`,
        }),
        'Expected decimal area basis to be accepted',
      ),
    )

    expectNoSupabaseError(
      await operatorClient.rpc('update_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: draft.batch_id,
        p_patch: {
          purpose: null,
          expected_end_date: null,
          location_description: null,
          notes: 'Updated draft',
          opening_total_weight: null,
          warehouse_id: null,
        },
      }),
      'Expected draft update and optional clearing to succeed',
    )
    const updated = await querySingle(ownerClient, 'growth_batches', 'purpose, expected_end_date, location_description, opening_total_weight, weight_uom_id, warehouse_id, bin_id, notes', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', draft.batch_id],
    ])
    assert.equal(updated.purpose, null)
    assert.equal(updated.expected_end_date, null)
    assert.equal(updated.location_description, null)
    assert.equal(updated.opening_total_weight, null)
    assert.equal(updated.weight_uom_id, kgUomId)
    assert.equal(updated.warehouse_id, null)
    assert.equal(updated.bin_id, null)
    assert.equal(updated.notes, 'Updated draft')

    const crossCompany = unwrapRpcSingle(
      expectNoSupabaseError(
        await crossOwnerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Growth Cross Company` }),
        'Expected cross company bootstrap to succeed',
      ),
    )
    const crossCompanyId = crossCompany.out_company_id
    created.companyIds.add(crossCompanyId)
    await setActiveCompany(crossOwnerClient, crossCompanyId)
    const crossWarehouse = await crossOwnerClient
      .from('warehouses')
      .insert({ company_id: crossCompanyId, code: `${PREFIX.toUpperCase()}-XWH`, name: 'Cross warehouse', status: 'active' })
      .select('id')
      .single()
    throwSupabaseError(crossWarehouse.error, 'cross warehouse setup failed')
    await setActiveCompany(ownerClient, companyId)
    await expectPostgrestError(
      ownerClient.rpc('update_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: draft.batch_id,
        p_patch: { warehouse_id: crossWarehouse.data.id },
      }),
      'warehouse_not_found',
    )

    const cancelDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', {
          p_company_id: companyId,
          p_name: `${PREFIX} Cancel Draft`,
          p_batch_family: 'other',
          p_primary_quantity_basis: 'other',
          p_opening_primary_qty: 2.25,
          p_primary_uom_id: kgUomId,
          p_request_key: `${PREFIX}-create-cancel`,
        }),
        'Expected cancellable draft setup',
      ),
    )
    const movementBeforeCancel = await stockMovementCount(ownerClient, companyId)
    const financeBeforeCancel = await financeIsolationCounts(admin, companyId)
    const cancelled = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('cancel_growth_batch_draft', {
          p_company_id: companyId,
          p_growth_batch_id: cancelDraft.batch_id,
          p_reason: `${PREFIX} no longer needed`,
          p_request_key: `${PREFIX}-cancel-draft`,
        }),
        'Expected draft cancellation to succeed',
      ),
    )
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(await stockMovementCount(ownerClient, companyId), movementBeforeCancel)
    assert.deepEqual(await financeIsolationCounts(admin, companyId), financeBeforeCancel)
    assert.equal(await countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', cancelDraft.batch_id], ['eq', 'event_type', 'cancellation']]), 1)
    const cancelReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('cancel_growth_batch_draft', {
          p_company_id: companyId,
          p_growth_batch_id: cancelDraft.batch_id,
          p_reason: `${PREFIX} no longer needed`,
          p_request_key: `${PREFIX}-cancel-draft`,
        }),
        'Expected cancellation replay to return original result',
      ),
    )
    assert.equal(cancelReplay.event_id, cancelled.event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', cancelDraft.batch_id], ['eq', 'event_type', 'cancellation']]), 1)
    await expectPostgrestError(
      operatorClient.rpc('update_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: cancelDraft.batch_id,
        p_patch: { notes: 'blocked' },
      }),
      'growth_batch_cancelled',
    )
    await expectPostgrestError(
      operatorClient.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: cancelDraft.batch_id,
        p_request_key: `${PREFIX}-cancelled-activation`,
      }),
      'growth_batch_cancelled',
    )
  })

  await t.test('activation, measurements, direct costs, rollups, and read integrity', async () => {
    await expectPostgrestError(
      operatorClient.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_request_key: '',
      }),
      'request_key_required',
    )

    const inProgressDraft = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', {
          p_company_id: companyId,
          p_name: `${PREFIX} In Progress`,
          p_batch_family: 'poultry',
          p_primary_quantity_basis: 'count',
          p_opening_primary_qty: 5,
          p_primary_uom_id: eachUomId,
          p_start_date: todayIso(),
          p_request_key: `${PREFIX}-create-in-progress`,
        }),
        'Expected in-progress fixture draft',
      ),
    )
    const hashRows = await runLocalSql(`
      select md5(jsonb_build_object(
        'company_id', company_id,
        'batch_id', id,
        'reference_no', reference_no,
        'name', name,
        'batch_family', batch_family,
        'primary_quantity_basis', primary_quantity_basis,
        'primary_uom_id', primary_uom_id,
        'opening_primary_qty', round(opening_primary_qty::numeric, 12),
        'opening_total_weight_present', opening_total_weight is not null,
        'opening_total_weight', case
          when opening_total_weight is null then null
          else round(opening_total_weight::numeric, 12)
        end,
        'weight_uom_id', weight_uom_id,
        'area_present', area is not null,
        'area', case
          when area is null then null
          else round(area::numeric, 12)
        end,
        'area_uom_id', area_uom_id,
        'start_date', start_date,
        'expected_end_date', expected_end_date,
        'warehouse_id', warehouse_id,
        'bin_id', bin_id,
        'location_description', location_description,
        'species_text', species_text,
        'purpose', purpose,
        'notes', notes
      )::text) as payload_hash
      from public.growth_batches
      where id = '${inProgressDraft.batch_id}'::uuid;
    `)
    const inProgressInsert = await admin.from('posting_requests').insert({
      company_id: companyId,
      operation_type: 'growth.batch.activate',
      request_key: `${PREFIX}-activation-in-progress`,
      payload_hash: hashRows[0].payload_hash,
      status: 'in_progress',
      created_by: operatorUser.userId,
    })
    throwSupabaseError(inProgressInsert.error, 'in-progress posting request setup failed')
    await expectPostgrestError(
      operatorClient.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: inProgressDraft.batch_id,
        p_request_key: `${PREFIX}-activation-in-progress`,
      }),
      'request_in_progress',
    )

    const movementBeforeActivation = await stockMovementCount(ownerClient, companyId)
    const financeBeforeActivation = await financeIsolationCounts(admin, companyId)
    const activated = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('activate_growth_batch', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_request_key: `${PREFIX}-activate-count`,
        }),
        'Expected Growth Batch activation to succeed',
      ),
    )
    assert.equal(activated.status, 'active')
    assert.ok(activated.event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', countBatch.batch_id], ['eq', 'event_type', 'activation']]), 1)
    const activeRow = await querySingle(ownerClient, 'growth_batches', 'status, opening_primary_qty, current_primary_qty, accumulated_material_cost, accumulated_direct_cost, accumulated_total_cost, harvested_cost, remaining_cost, primary_uom_id, weight_uom_id', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(activeRow.status, 'active')
    assert.equal(activeRow.weight_uom_id, kgUomId)
    assert.equal(Number(activeRow.current_primary_qty), Number(activeRow.opening_primary_qty))
    assert.equal(Number(activeRow.accumulated_material_cost), 0)
    assert.equal(Number(activeRow.accumulated_direct_cost), 0)
    assert.equal(Number(activeRow.accumulated_total_cost), 0)
    assert.equal(Number(activeRow.harvested_cost), 0)
    assert.equal(Number(activeRow.remaining_cost), 0)

    await expectPostgrestError(
      operatorClient.rpc('update_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_patch: { name: 'blocked after activation' },
      }),
      'growth_batch_not_draft',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batches').update({ notes: 'direct update' }).eq('id', countBatch.batch_id),
      'direct growth_batches update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batches').delete().eq('id', countBatch.batch_id),
      'direct growth_batches delete',
    )

    const activationReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('activate_growth_batch', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_request_key: `${PREFIX}-activate-count`,
        }),
        'Expected activation replay to return original result',
      ),
    )
    assert.equal(activationReplay.event_id, activated.event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', countBatch.batch_id], ['eq', 'event_type', 'activation']]), 1)
    await expectPostgrestError(
      operatorClient.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_request_key: `${PREFIX}-activate-count-changed`,
      }),
      'growth_batch_not_draft',
    )
    await expectPostgrestError(
      operatorClient.rpc('cancel_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_reason: 'active cancellation blocked',
        p_request_key: `${PREFIX}-active-cancel`,
      }),
      'growth_batch_not_draft',
    )

    const measureAt = `${todayIso()}T10:00:00.000Z`
    const measurement = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_measurement_type: 'total_weight',
          p_value: 72.5,
          p_uom_id: kgUomId,
          p_observed_at: measureAt,
          p_sample_size: 10,
          p_minimum: 6.5,
          p_maximum: 7.8,
          p_average: 7.25,
          p_notes: `${PREFIX} total weight`,
          p_request_key: `${PREFIX}-measure-total`,
        }),
        'Expected total-weight measurement to succeed',
      ),
    )
    assert.ok(measurement.event_id)
    assert.ok(measurement.measurement_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_measurements', [['eq', 'growth_batch_id', countBatch.batch_id]]), 1)
    const afterTotalWeight = await querySingle(ownerClient, 'growth_batches', 'current_total_weight, current_primary_qty', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(Number(afterTotalWeight.current_total_weight), 72.5)
    assert.equal(Number(afterTotalWeight.current_primary_qty), 100)
    const measurementReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_measurement_type: 'total_weight',
          p_value: 72.5,
          p_uom_id: kgUomId,
          p_observed_at: measureAt,
          p_sample_size: 10,
          p_minimum: 6.5,
          p_maximum: 7.8,
          p_average: 7.25,
          p_notes: `${PREFIX} total weight`,
          p_request_key: `${PREFIX}-measure-total`,
        }),
        'Expected measurement replay to return original result',
      ),
    )
    assert.equal(measurementReplay.event_id, measurement.event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_measurements', [['eq', 'growth_batch_id', countBatch.batch_id]]), 1)
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_measurement_type: 'total_weight',
        p_value: 73,
        p_uom_id: kgUomId,
        p_observed_at: measureAt,
        p_request_key: `${PREFIX}-measure-total`,
      }),
      'idempotency_key_payload_mismatch',
    )

    const invalidMeasurementEventsBefore = await countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', countBatch.batch_id]])
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_measurement_type: 'other',
        p_value: 1,
        p_uom_id: kgUomId,
        p_observed_at: measureAt,
        p_request_key: `${PREFIX}-invalid-measurement`,
      }),
      'invalid_measurement',
    )
    assert.equal(await countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', countBatch.batch_id]]), invalidMeasurementEventsBefore)

    const average = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_measurement_type: 'average_weight',
          p_value: 0.73,
          p_uom_id: kgUomId,
          p_observed_at: `${todayIso()}T11:00:00.000Z`,
          p_request_key: `${PREFIX}-measure-average`,
        }),
        'Expected average-weight measurement to succeed',
      ),
    )
    assert.ok(average.event_id)
    const afterAverage = await querySingle(ownerClient, 'growth_batches', 'current_total_weight, current_primary_qty', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(Number(afterAverage.current_total_weight), 72.5)
    assert.equal(Number(afterAverage.current_primary_qty), 100)

    const financeBeforeCost = await financeIsolationCounts(admin, companyId)
    const stockBeforeCost = await stockMovementCount(ownerClient, companyId)
    const unitPriceBefore = await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]])
    const directCost = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_direct_cost', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_category: 'labour',
          p_description: `${PREFIX} labour cost`,
          p_amount: 25.5,
          p_event_date: todayIso(),
          p_notes: `${PREFIX} memo only`,
          p_request_key: `${PREFIX}-direct-cost`,
        }),
        'Expected direct cost to succeed',
      ),
    )
    assert.ok(directCost.event_id)
    assert.ok(directCost.direct_cost_id)
    const costRow = await querySingle(ownerClient, 'growth_batches', 'accumulated_material_cost, accumulated_direct_cost, accumulated_total_cost, harvested_cost, remaining_cost', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(Number(costRow.accumulated_material_cost), 0)
    assert.equal(Number(costRow.accumulated_direct_cost), 25.5)
    assert.equal(Number(costRow.accumulated_total_cost), 25.5)
    assert.equal(Number(costRow.harvested_cost), 0)
    assert.equal(Number(costRow.remaining_cost), 25.5)
    assert.deepEqual(await financeIsolationCounts(admin, companyId), financeBeforeCost)
    assert.equal(await stockMovementCount(ownerClient, companyId), stockBeforeCost)
    const unitPriceAfter = await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]])
    assert.equal(Number(unitPriceAfter.unit_price), Number(unitPriceBefore.unit_price), 'items.unit_price must remain commercial and unchanged')

    const directCostReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_direct_cost', {
          p_company_id: companyId,
          p_growth_batch_id: countBatch.batch_id,
          p_category: 'labour',
          p_description: `${PREFIX} labour cost`,
          p_amount: 25.5,
          p_event_date: todayIso(),
          p_notes: `${PREFIX} memo only`,
          p_request_key: `${PREFIX}-direct-cost`,
        }),
        'Expected direct-cost replay to return original result',
      ),
    )
    assert.equal(directCostReplay.event_id, directCost.event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_direct_costs', [['eq', 'growth_batch_id', countBatch.batch_id]]), 1)
    const replayRollup = await querySingle(ownerClient, 'growth_batches', 'accumulated_direct_cost, remaining_cost', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(Number(replayRollup.accumulated_direct_cost), 25.5)
    assert.equal(Number(replayRollup.remaining_cost), 25.5)

    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_category: 'labour',
        p_description: `${PREFIX} changed labour cost`,
        p_amount: 25.5,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-direct-cost`,
      }),
      'idempotency_key_payload_mismatch',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_category: 'water',
        p_description: `${PREFIX} zero amount`,
        p_amount: 0,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-zero-cost`,
      }),
      'invalid_direct_cost',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: countBatch.batch_id,
        p_category: 'other',
        p_description: '',
        p_amount: 1,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-other-no-desc`,
      }),
      'invalid_direct_cost',
    )

    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_events').update({ notes: 'direct event update' }).eq('id', directCost.event_id),
      'direct growth_batch_events update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_events').insert({
        company_id: companyId,
        growth_batch_id: countBatch.batch_id,
        event_sequence: 99,
        event_reference: `${PREFIX.toUpperCase()}-DIRECT-EVENT`,
        event_type: 'measurement',
        event_date: todayIso(),
      }),
      'direct growth_batch_events insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_events').delete().eq('id', directCost.event_id),
      'direct growth_batch_events delete',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_measurements').insert({
        company_id: companyId,
        growth_batch_id: countBatch.batch_id,
        growth_batch_event_id: measurement.event_id,
        measurement_type: 'height',
        value: 1,
        uom_id: kgUomId,
      }),
      'direct growth_batch_measurements insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_measurements').update({ value: 99 }).eq('id', measurement.measurement_id),
      'direct growth_batch_measurements update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_measurements').delete().eq('id', measurement.measurement_id),
      'direct growth_batch_measurements delete',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_direct_costs').insert({
        company_id: companyId,
        growth_batch_id: countBatch.batch_id,
        growth_batch_event_id: directCost.event_id,
        category: 'labour',
        description: 'Direct cost insert blocked',
        amount: 1,
        currency_code: 'MZN',
      }),
      'direct growth_batch_direct_costs insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_direct_costs').update({ amount: 99 }).eq('id', directCost.direct_cost_id),
      'direct growth_batch_direct_costs update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_direct_costs').delete().eq('id', directCost.direct_cost_id),
      'direct growth_batch_direct_costs delete',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_counters').insert({ company_id: companyId, next_number: 999 }),
      'direct growth_batch_counters insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_counters').update({ next_number: 999 }).eq('company_id', companyId),
      'direct growth_batch_counters update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_counters').delete().eq('company_id', companyId),
      'direct growth_batch_counters delete',
    )

    const registerRows = expectNoSupabaseError(
      await ownerClient.from('growth_batches_register').select('*').eq('id', countBatch.batch_id),
      'Expected Growth Batch register read model to load',
    )
    assert.equal(registerRows.length, 1)
    assert.equal(Number(registerRows[0].accumulated_direct_cost), 25.5)
    assert.equal(Number(registerRows[0].remaining_cost), 25.5)
    assert.equal(registerRows[0].latest_event_type, 'direct_cost')
    assert.equal(registerRows[0].weight_uom_id, kgUomId)
    assert.equal(registerRows[0].weight_uom_code, 'KG')
    assert.equal(Number(registerRows[0].latest_total_weight), 72.5)

    const currentState = await querySingle(ownerClient, 'growth_batch_current_state', 'event_count, measurement_count, direct_cost_count, direct_cost_total, latest_measurement_type, latest_measurement_uom_id, latest_measurement_uom_code', [
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(Number(currentState.event_count), 4)
    assert.equal(Number(currentState.measurement_count), 2)
    assert.equal(Number(currentState.direct_cost_count), 1)
    assert.equal(Number(currentState.direct_cost_total), 25.5)
    assert.equal(currentState.latest_measurement_type, 'average_weight')
    assert.equal(currentState.latest_measurement_uom_id, kgUomId)
    assert.equal(currentState.latest_measurement_uom_code, 'KG')

    const timeline = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_event_timeline')
        .select('event_sequence,event_type,event_reference,weight_value,weight_uom_id,weight_uom_code,typed_detail_summary')
        .eq('growth_batch_id', countBatch.batch_id)
        .order('event_sequence'),
      'Expected Growth Batch event timeline to load',
    )
    assert.deepEqual(timeline.map((row) => row.event_sequence), [1, 2, 3, 4])
    assert.deepEqual(timeline.map((row) => row.event_type), ['activation', 'measurement', 'measurement', 'direct_cost'])
    assert.equal(Number(timeline[1].weight_value), 72.5)
    assert.equal(timeline[1].weight_uom_id, kgUomId)
    assert.equal(timeline[1].weight_uom_code, 'KG')
    assert.equal(timeline[3].typed_detail_summary.category, 'labour')

    const measurementHistory = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_measurement_history')
        .select('event_id,event_sequence,event_effective_date,event_created_at,measurement_type,value,uom_id,uom_code,event_reference')
        .eq('growth_batch_id', countBatch.batch_id)
        .order('event_sequence', { ascending: false }),
      'Expected measurement history to load',
    )
    assert.equal(measurementHistory.length, 2)
    assert.deepEqual(measurementHistory.map((row) => row.event_sequence), [3, 2])
    assert.equal(measurementHistory.some((row) => row.measurement_type === 'total_weight' && Number(row.value) === 72.5), true)
    assert.equal(measurementHistory.every((row) => row.uom_id === kgUomId && row.uom_code === 'KG'), true)

    const directCostHistory = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_direct_cost_history')
        .select('event_id,event_sequence,event_effective_date,event_created_at,category,amount,currency_code,event_reference')
        .eq('growth_batch_id', countBatch.batch_id)
        .order('event_sequence', { ascending: false }),
      'Expected direct cost history to load',
    )
    assert.equal(directCostHistory.length, 1)
    assert.equal(Number(directCostHistory[0].amount), 25.5)

    assert.deepEqual(await financeIsolationCounts(admin, companyId), financeBeforeActivation)
    assert.equal(await stockMovementCount(ownerClient, companyId), movementBeforeActivation)
  })

  await t.test('correction coverage for hashing, UOM boundaries, chronology, and concurrency', async () => {
    async function createDraftBatch(suffix, overrides = {}) {
      return unwrapRpcSingle(
        expectNoSupabaseError(
          await operatorClient.rpc('create_growth_batch_draft', {
            p_company_id: companyId,
            p_name: `${PREFIX} ${suffix}`,
            p_batch_family: 'poultry',
            p_primary_quantity_basis: 'count',
            p_opening_primary_qty: 10,
            p_primary_uom_id: eachUomId,
            p_start_date: todayIso(),
            p_request_key: `${PREFIX}-${suffix}-create`,
            ...overrides,
          }),
          `Expected ${suffix} draft creation to succeed`,
        ),
      )
    }

    async function activateDraftBatch(batch, suffix) {
      return unwrapRpcSingle(
        expectNoSupabaseError(
          await operatorClient.rpc('activate_growth_batch', {
            p_company_id: companyId,
            p_growth_batch_id: batch.batch_id,
            p_request_key: `${PREFIX}-${suffix}-activate`,
          }),
          `Expected ${suffix} activation to succeed`,
        ),
      )
    }

    async function activationHashFor(batchId) {
      const rows = await runLocalSql(`
        select md5(jsonb_build_object(
          'company_id', company_id,
          'batch_id', id,
          'reference_no', reference_no,
          'name', name,
          'batch_family', batch_family,
          'primary_quantity_basis', primary_quantity_basis,
          'primary_uom_id', primary_uom_id,
          'opening_primary_qty', round(opening_primary_qty::numeric, 12),
          'opening_total_weight_present', opening_total_weight is not null,
          'opening_total_weight', case
            when opening_total_weight is null then null
            else round(opening_total_weight::numeric, 12)
          end,
          'weight_uom_id', weight_uom_id,
          'area_present', area is not null,
          'area', case
            when area is null then null
            else round(area::numeric, 12)
          end,
          'area_uom_id', area_uom_id,
          'start_date', start_date,
          'expected_end_date', expected_end_date,
          'warehouse_id', warehouse_id,
          'bin_id', bin_id,
          'location_description', location_description,
          'species_text', species_text,
          'purpose', purpose,
          'notes', notes
        )::text) as payload_hash
        from public.growth_batches
        where id = '${batchId}'::uuid;
      `)
      return rows[0].payload_hash
    }

    const omittedCreateParams = {
      p_company_id: companyId,
      p_name: `${PREFIX} Hash Omitted`,
      p_batch_family: 'poultry',
      p_primary_quantity_basis: 'count',
      p_opening_primary_qty: 10,
      p_primary_uom_id: eachUomId,
      p_start_date: todayIso(),
      p_request_key: `${PREFIX}-hash-create-omitted`,
    }
    const omittedCreate = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('create_growth_batch_draft', omittedCreateParams)))
    await expectPostgrestError(
      operatorClient.rpc('create_growth_batch_draft', {
        ...omittedCreateParams,
        p_opening_total_weight: null,
        p_opening_total_weight_present: true,
      }),
      'idempotency_key_payload_mismatch',
    )
    assert.equal(await countRows(ownerClient, 'growth_batches', [['eq', 'id', omittedCreate.batch_id]]), 1)

    const nullCreateParams = {
      p_company_id: companyId,
      p_name: `${PREFIX} Hash Null`,
      p_batch_family: 'poultry',
      p_primary_quantity_basis: 'count',
      p_opening_primary_qty: 10,
      p_primary_uom_id: eachUomId,
      p_start_date: todayIso(),
      p_opening_total_weight: null,
      p_weight_uom_id: kgUomId,
      p_request_key: `${PREFIX}-hash-create-null`,
      p_opening_total_weight_present: true,
    }
    const nullCreate = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('create_growth_batch_draft', nullCreateParams)))
    await expectPostgrestError(
      operatorClient.rpc('create_growth_batch_draft', { ...nullCreateParams, p_opening_total_weight: 0 }),
      'idempotency_key_payload_mismatch',
    )
    assert.equal(await countRows(ownerClient, 'growth_batches', [['eq', 'id', nullCreate.batch_id]]), 1)

    const numericCreateParams = {
      p_company_id: companyId,
      p_name: `${PREFIX} Hash Numeric`,
      p_batch_family: 'poultry',
      p_primary_quantity_basis: 'count',
      p_opening_primary_qty: 1,
      p_primary_uom_id: eachUomId,
      p_start_date: todayIso(),
      p_request_key: `${PREFIX}-hash-create-numeric`,
    }
    const numericCreate = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('create_growth_batch_draft', numericCreateParams)))
    const numericCreateReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('create_growth_batch_draft', { ...numericCreateParams, p_opening_primary_qty: '1.00' }),
        'Expected equivalent numeric create replay to succeed',
      ),
    )
    assert.equal(numericCreateReplay.batch_id, numericCreate.batch_id)

    const activateHashDraft = await createDraftBatch('hash-activate-null')
    const activationHash = await activationHashFor(activateHashDraft.batch_id)
    const activationRequestInsert = await admin.from('posting_requests').insert({
      company_id: companyId,
      operation_type: 'growth.batch.activate',
      request_key: `${PREFIX}-hash-activate-null-zero`,
      payload_hash: activationHash,
      status: 'in_progress',
      created_by: operatorUser.userId,
    })
    throwSupabaseError(activationRequestInsert.error, 'activation null-vs-zero posting request setup failed')
    expectNoSupabaseError(
      await operatorClient.rpc('update_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: activateHashDraft.batch_id,
        p_patch: { opening_total_weight: 0, weight_uom_id: kgUomId },
      }),
      'Expected activation hash fixture update to succeed',
    )
    await expectPostgrestError(
      operatorClient.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: activateHashDraft.batch_id,
        p_request_key: `${PREFIX}-hash-activate-null-zero`,
      }),
      'idempotency_key_payload_mismatch',
    )

    const measurementHashBatch = await createDraftBatch('hash-measure', { p_weight_uom_id: kgUomId })
    await activateDraftBatch(measurementHashBatch, 'hash-measure')
    const observedAt = `${todayIso()}T12:00:00.000Z`
    const nullMeasurementParams = {
      p_company_id: companyId,
      p_growth_batch_id: measurementHashBatch.batch_id,
      p_measurement_type: 'other',
      p_value: 5,
      p_uom_id: kgUomId,
      p_observed_at: observedAt,
      p_description: 'Hash fixture',
      p_request_key: `${PREFIX}-hash-measure-null`,
      p_minimum: null,
      p_minimum_present: true,
    }
    const nullMeasurement = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_measurement', nullMeasurementParams)))
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', { ...nullMeasurementParams, p_minimum: 0 }),
      'idempotency_key_payload_mismatch',
    )
    assert.equal(await countRows(ownerClient, 'growth_batch_measurements', [['eq', 'growth_batch_id', measurementHashBatch.batch_id], ['eq', 'id', nullMeasurement.measurement_id]]), 1)

    const numericMeasurementParams = {
      p_company_id: companyId,
      p_growth_batch_id: measurementHashBatch.batch_id,
      p_measurement_type: 'other',
      p_value: 1,
      p_uom_id: kgUomId,
      p_observed_at: `${todayIso()}T12:10:00.000Z`,
      p_description: 'Numeric fixture',
      p_request_key: `${PREFIX}-hash-measure-numeric`,
    }
    const numericMeasurement = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_measurement', numericMeasurementParams)))
    const numericMeasurementReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', { ...numericMeasurementParams, p_value: '1.00' }),
        'Expected equivalent numeric measurement replay to succeed',
      ),
    )
    assert.equal(numericMeasurementReplay.event_id, numericMeasurement.event_id)
    assert.equal(numericMeasurementReplay.measurement_id, numericMeasurement.measurement_id)

    const noWeightBatch = await createDraftBatch('no-weight-uom')
    await activateDraftBatch(noWeightBatch, 'no-weight-uom')
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: noWeightBatch.batch_id,
        p_measurement_type: 'total_weight',
        p_value: 20,
        p_uom_id: kgUomId,
        p_observed_at: `${todayIso()}T13:00:00.000Z`,
        p_request_key: `${PREFIX}-no-weight-uom-total`,
      }),
      'growth_batch_weight_uom_required',
    )

    const configuredWeightBatch = await createDraftBatch('configured-weight', { p_weight_uom_id: kgUomId })
    await activateDraftBatch(configuredWeightBatch, 'configured-weight')
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: configuredWeightBatch.batch_id,
        p_measurement_type: 'total_weight',
        p_value: 21,
        p_uom_id: areaUomId,
        p_observed_at: `${todayIso()}T13:10:00.000Z`,
        p_request_key: `${PREFIX}-invalid-weight-uom`,
      }),
      'growth_batch_weight_uom_mismatch',
    )
    const configuredTotal = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', {
          p_company_id: companyId,
          p_growth_batch_id: configuredWeightBatch.batch_id,
          p_measurement_type: 'total_weight',
          p_value: 21,
          p_uom_id: kgUomId,
          p_observed_at: `${todayIso()}T13:20:00.000Z`,
          p_request_key: `${PREFIX}-configured-total`,
        }),
        'Expected total weight with configured UOM to succeed',
      ),
    )
    const configuredAverage = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', {
          p_company_id: companyId,
          p_growth_batch_id: configuredWeightBatch.batch_id,
          p_measurement_type: 'average_weight',
          p_value: 2.1,
          p_uom_id: kgUomId,
          p_observed_at: `${todayIso()}T13:30:00.000Z`,
          p_request_key: `${PREFIX}-configured-average`,
        }),
        'Expected average weight with configured UOM to succeed',
      ),
    )
    assert.notEqual(configuredTotal.event_id, configuredAverage.event_id)
    assert.equal(configuredAverage.event_sequence, configuredTotal.event_sequence + 1)
    const configuredRegister = await querySingle(ownerClient, 'growth_batches_register', 'latest_total_weight,weight_uom_id,weight_uom_code', [
      ['eq', 'id', configuredWeightBatch.batch_id],
    ])
    assert.equal(Number(configuredRegister.latest_total_weight), 21)
    assert.equal(configuredRegister.weight_uom_id, kgUomId)
    assert.equal(configuredRegister.weight_uom_code, 'KG')
    const configuredState = await querySingle(ownerClient, 'growth_batch_current_state', 'latest_measurement_type,latest_measurement_uom_id,latest_measurement_uom_code', [
      ['eq', 'id', configuredWeightBatch.batch_id],
    ])
    assert.equal(configuredState.latest_measurement_type, 'average_weight')
    assert.equal(configuredState.latest_measurement_uom_id, kgUomId)
    assert.equal(configuredState.latest_measurement_uom_code, 'KG')

    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: configuredWeightBatch.batch_id,
        p_measurement_type: 'other',
        p_value: 1,
        p_uom_id: kgUomId,
        p_observed_at: `${addDaysIso(-1)}T10:00:00.000Z`,
        p_description: 'Before start',
        p_request_key: `${PREFIX}-measure-before-start`,
      }),
      'growth_batch_event_before_start',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: configuredWeightBatch.batch_id,
        p_measurement_type: 'other',
        p_value: 1,
        p_uom_id: kgUomId,
        p_observed_at: `${addDaysIso(1)}T10:00:00.000Z`,
        p_description: 'Future',
        p_request_key: `${PREFIX}-measure-future`,
      }),
      'growth_batch_event_future',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: configuredWeightBatch.batch_id,
        p_category: 'water',
        p_description: 'Before start cost',
        p_amount: 1,
        p_event_date: addDaysIso(-1),
        p_request_key: `${PREFIX}-cost-before-start`,
      }),
      'growth_batch_event_before_start',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: configuredWeightBatch.batch_id,
        p_category: 'water',
        p_description: 'Future cost',
        p_amount: 1,
        p_event_date: addDaysIso(1),
        p_request_key: `${PREFIX}-cost-future`,
      }),
      'growth_batch_event_future',
    )

    const futureStartBatch = await createDraftBatch('future-start', { p_start_date: addDaysIso(1) })
    await expectPostgrestError(
      operatorClient.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: futureStartBatch.batch_id,
        p_request_key: `${PREFIX}-future-start-activate`,
      }),
      'growth_batch_start_date_future',
    )

    const negativeTemp = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('record_growth_batch_measurement', {
          p_company_id: companyId,
          p_growth_batch_id: configuredWeightBatch.batch_id,
          p_measurement_type: 'temperature',
          p_value: -2,
          p_uom_id: tempUomId,
          p_observed_at: `${todayIso()}T13:40:00.000Z`,
          p_request_key: `${PREFIX}-negative-temperature`,
        }),
        'Expected negative temperature to be accepted as a first-release exception',
      ),
    )
    assert.ok(negativeTemp.measurement_id)
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: configuredWeightBatch.batch_id,
        p_measurement_type: 'other',
        p_value: -1,
        p_uom_id: kgUomId,
        p_observed_at: `${todayIso()}T13:50:00.000Z`,
        p_description: 'Negative other',
        p_request_key: `${PREFIX}-negative-other`,
      }),
      'invalid_measurement',
    )

    const concurrentBatch = await createDraftBatch('concurrent-events', { p_weight_uom_id: kgUomId })
    await activateDraftBatch(concurrentBatch, 'concurrent-events')
    const concurrentMeasurements = await Promise.all([
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentBatch.batch_id,
        p_measurement_type: 'other',
        p_value: 1,
        p_uom_id: kgUomId,
        p_observed_at: `${todayIso()}T14:00:00.000Z`,
        p_description: 'Concurrent A',
        p_request_key: `${PREFIX}-concurrent-measure-a`,
      }),
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentBatch.batch_id,
        p_measurement_type: 'other',
        p_value: 2,
        p_uom_id: kgUomId,
        p_observed_at: `${todayIso()}T14:01:00.000Z`,
        p_description: 'Concurrent B',
        p_request_key: `${PREFIX}-concurrent-measure-b`,
      }),
    ])
    assert.equal(concurrentMeasurements.every((result) => !result.error), true, 'Expected concurrent measurements to succeed')
    const measurementEvents = concurrentMeasurements.map((result) => unwrapRpcSingle(result.data))
    assert.equal(new Set(measurementEvents.map((row) => row.event_id)).size, 2)
    assert.deepEqual(measurementEvents.map((row) => row.event_sequence).sort((a, b) => a - b), [2, 3])

    const mixedEvents = await Promise.all([
      operatorClient.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentBatch.batch_id,
        p_measurement_type: 'other',
        p_value: 3,
        p_uom_id: kgUomId,
        p_observed_at: `${todayIso()}T14:02:00.000Z`,
        p_description: 'Concurrent mixed measurement',
        p_request_key: `${PREFIX}-concurrent-mixed-measure`,
      }),
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentBatch.batch_id,
        p_category: 'water',
        p_description: 'Concurrent mixed cost',
        p_amount: 1.25,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-concurrent-mixed-cost`,
      }),
    ])
    assert.equal(mixedEvents.every((result) => !result.error), true, 'Expected concurrent measurement/cost to succeed')
    const mixedResults = mixedEvents.map((result) => unwrapRpcSingle(result.data))
    assert.equal(new Set(mixedResults.map((row) => row.event_sequence)).size, 2)
    assert.deepEqual(mixedResults.map((row) => row.event_sequence).sort((a, b) => a - b), [4, 5])
    const mixedMeasurementSequence = mixedResults.find((row) => row.measurement_id)?.event_sequence
    const mixedCostSequence = mixedResults.find((row) => row.direct_cost_id)?.event_sequence
    assert.ok(mixedMeasurementSequence)
    assert.ok(mixedCostSequence)

    const financeBeforeConcurrentCosts = await financeIsolationCounts(admin, companyId)
    const stockBeforeConcurrentCosts = await stockMovementCount(ownerClient, companyId)
    const beforeConcurrentRollup = await querySingle(ownerClient, 'growth_batches', 'accumulated_direct_cost, remaining_cost', [
      ['eq', 'id', concurrentBatch.batch_id],
    ])
    const concurrentCosts = await Promise.all([
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentBatch.batch_id,
        p_category: 'labour',
        p_description: 'Concurrent cost A',
        p_amount: 3.25,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-concurrent-cost-a`,
      }),
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentBatch.batch_id,
        p_category: 'utilities',
        p_description: 'Concurrent cost B',
        p_amount: 4.75,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-concurrent-cost-b`,
      }),
    ])
    assert.equal(concurrentCosts.every((result) => !result.error), true, 'Expected concurrent direct costs to succeed')
    const costResults = concurrentCosts.map((result) => unwrapRpcSingle(result.data))
    assert.deepEqual(costResults.map((row) => row.event_sequence).sort((a, b) => a - b), [6, 7])
    const afterConcurrentRollup = await querySingle(ownerClient, 'growth_batches', 'accumulated_direct_cost, accumulated_total_cost, remaining_cost', [
      ['eq', 'id', concurrentBatch.batch_id],
    ])
    assert.equal(Number(afterConcurrentRollup.accumulated_direct_cost) - Number(beforeConcurrentRollup.accumulated_direct_cost), 8)
    assert.equal(Number(afterConcurrentRollup.accumulated_total_cost), Number(afterConcurrentRollup.accumulated_direct_cost))
    assert.equal(Number(afterConcurrentRollup.remaining_cost) - Number(beforeConcurrentRollup.remaining_cost), 8)
    assert.deepEqual(await financeIsolationCounts(admin, companyId), financeBeforeConcurrentCosts)
    assert.equal(await stockMovementCount(ownerClient, companyId), stockBeforeConcurrentCosts)

    const concurrentTimeline = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_event_timeline')
        .select('id,event_sequence,event_type')
        .eq('growth_batch_id', concurrentBatch.batch_id)
        .order('event_sequence', { ascending: true }),
      'Expected concurrent event timeline to load',
    )
    assert.deepEqual(concurrentTimeline.map((row) => row.event_sequence), [1, 2, 3, 4, 5, 6, 7])
    assert.equal(new Set(concurrentTimeline.map((row) => row.id)).size, 7)
    const concurrentMeasurementHistory = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_measurement_history')
        .select('event_sequence,event_id,id')
        .eq('growth_batch_id', concurrentBatch.batch_id)
        .order('event_sequence', { ascending: false }),
      'Expected concurrent measurement history to load',
    )
    assert.deepEqual(
      concurrentMeasurementHistory.map((row) => row.event_sequence),
      [mixedMeasurementSequence, 3, 2].sort((a, b) => b - a),
    )
    assert.equal(new Set(concurrentMeasurementHistory.map((row) => row.event_id)).size, 3)
    const concurrentDirectCostHistory = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_direct_cost_history')
        .select('event_sequence,event_id,id,amount')
        .eq('growth_batch_id', concurrentBatch.batch_id)
        .order('event_sequence', { ascending: false }),
      'Expected concurrent direct-cost history to load',
    )
    assert.deepEqual(
      concurrentDirectCostHistory.map((row) => row.event_sequence),
      [mixedCostSequence, ...costResults.map((row) => row.event_sequence)].sort((a, b) => b - a),
    )
    assert.equal(Number(concurrentDirectCostHistory.reduce((sum, row) => sum + Number(row.amount), 0)), 9.25)

    const requestRows = expectNoSupabaseError(
      await admin
        .from('posting_requests')
        .select('request_key,status,result_ref_id')
        .eq('company_id', companyId)
        .in('request_key', [
          `${PREFIX}-concurrent-measure-a`,
          `${PREFIX}-concurrent-measure-b`,
          `${PREFIX}-concurrent-mixed-measure`,
          `${PREFIX}-concurrent-mixed-cost`,
          `${PREFIX}-concurrent-cost-a`,
          `${PREFIX}-concurrent-cost-b`,
        ]),
      'Expected concurrent posting request rows to load',
    )
    assert.equal(requestRows.length, 6)
    assert.equal(requestRows.every((row) => row.status === 'succeeded' && row.result_ref_id), true)
    assert.equal(new Set(requestRows.map((row) => row.request_key)).size, 6)
  })
})
