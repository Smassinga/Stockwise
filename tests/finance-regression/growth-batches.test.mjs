import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const PREVIEW_STOCK_INPUT_SIGNATURE = 'public.preview_growth_batch_stock_input(uuid,date,jsonb,text)'
const POST_STOCK_INPUT_SIGNATURE = 'public.post_growth_batch_stock_input(uuid,date,jsonb,text,text)'
const REVERSE_STOCK_INPUT_SIGNATURE = 'public.reverse_growth_batch_stock_input(uuid,date,text,text)'
const PREVIEW_LOSS_SIGNATURE = 'public.preview_growth_batch_loss(uuid,text,date,numeric,numeric,text,text)'
const RECORD_LOSS_SIGNATURE = 'public.record_growth_batch_loss(uuid,text,date,numeric,numeric,text,text,text)'
const REVERSE_LOSS_SIGNATURE = 'public.reverse_growth_batch_loss(uuid,text,text)'

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

function extractJsonPayloads(output) {
  const payloads = []
  const extraOutput = []
  let payload = ''
  let extra = ''
  let depth = 0
  let inString = false
  let escaped = false

  for (const char of output) {
    if (depth === 0) {
      if (char !== '{' && char !== '[') {
        extra += char
        continue
      }
      if (extra.trim()) extraOutput.push(extra.trim())
      extra = ''
      payload = char
      depth = 1
      inString = false
      escaped = false
      continue
    }

    payload += char

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{' || char === '[') {
      depth += 1
    } else if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) {
        payloads.push(payload)
        payload = ''
      }
    }
  }

  if (depth !== 0) {
    throw new Error(`Incomplete JSON SQL output: ${payload.slice(0, 240)}`)
  }

  if (extra.trim()) extraOutput.push(extra.trim())

  return { payloads, extraOutput }
}

function sqlOutputSample(stdout, stderr) {
  const sample = (value) => value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n')

  return [
    `stdout:\n${sample(stdout) || '<empty>'}`,
    `stderr:\n${sample(stderr) || '<empty>'}`,
  ].join('\n')
}

async function runLocalSql(sql) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => key && !key.startsWith('=') && value != null),
  )
  const supabaseHome = join(tmpdir(), 'stockwise-supabase-home')
  const npmCache = join(tmpdir(), 'stockwise-npm-cache')
  mkdirSync(supabaseHome, { recursive: true })
  mkdirSync(npmCache, { recursive: true })

  const isWindows = process.platform === 'win32'
  const command = isWindows ? process.env.ComSpec || 'cmd.exe' : 'npx'
  const args = isWindows
    ? ['/d', '/s', '/c', 'npx.cmd supabase db query --local -o json']
    : ['supabase', 'db', 'query', '--local', '-o', 'json']
  const timeoutMs = 60_000
  const result = await new Promise((resolve, reject) => {
    let child
    const startError = (error) => new Error([
      'runLocalSql failed to start local SQL process:',
      `platform=${process.platform}`,
      `executable=${command}`,
      `code=${error.code || 'unknown'}`,
      `message=${error.message}`,
    ].join('\n'))

    try {
      child = spawn(command, args, {
        cwd: process.cwd(),
        env: {
          ...env,
          HOME: supabaseHome,
          USERPROFILE: supabaseHome,
          npm_config_cache: npmCache,
          SUPABASE_TELEMETRY_DISABLED: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      reject(startError(error))
      return
    }

    let output = ''
    let stderr = ''
    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error(`supabase db query timed out after ${timeoutMs}ms`)))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => finish(() => reject(startError(error))))
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve({ stdout: output, stderr })
        else reject(new Error(`supabase db query failed with code ${code}:\n${sqlOutputSample(output, stderr)}`))
      })
    })
    child.stdin.end(sql)
  })
  const { payloads, extraOutput } = extractJsonPayloads(result.stdout)
  assert.equal(
    extraOutput.length,
    0,
    `Unexpected non-JSON SQL stdout.\n${sqlOutputSample(result.stdout, result.stderr)}`,
  )
  assert.equal(
    payloads.length,
    1,
    `Expected exactly one JSON SQL payload, got ${payloads.length}.\n${sqlOutputSample(result.stdout, result.stderr)}`,
  )

  let parsed
  try {
    parsed = JSON.parse(payloads[0])
  } catch (error) {
    throw new Error(`Failed to parse JSON SQL payload: ${error.message}\n${sqlOutputSample(result.stdout, result.stderr)}`)
  }

  const rows = Array.isArray(parsed) ? parsed : parsed?.rows
  assert.ok(Array.isArray(rows), `Expected JSON SQL output to contain a rows array.\n${sqlOutputSample(result.stdout, result.stderr)}`)
  return rows
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

test('Growth Batches G1-G3 authority, lifecycle, idempotency, stock inputs, and read models', async (t) => {
  const admin = createAdminClient()
  const created = {
    companyIds: new Set(),
    userIds: new Set(),
    uomIds: new Set(),
  }

  async function cleanupCompany(companyId) {
    if (!companyId) return
    await admin.from('growth_batch_loss_reversal_lines').delete().eq('company_id', companyId)
    await admin.from('growth_batch_losses').delete().eq('company_id', companyId)
    await admin.from('growth_batch_stock_input_reversal_lines').delete().eq('company_id', companyId)
    await admin.from('growth_batch_stock_inputs').delete().eq('company_id', companyId)
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

  const feedItem = await ownerClient
    .from('items')
    .insert({
      company_id: companyId,
      sku: `${PREFIX.toUpperCase()}-FEED`,
      name: `${PREFIX} Feed Input`,
      base_uom_id: kgUomId,
      min_stock: 0,
      unit_price: 45,
      primary_role: 'raw_material',
      track_inventory: true,
      can_buy: true,
      can_sell: false,
      is_assembled: false,
    })
    .select('id, unit_price')
    .single()
  throwSupabaseError(feedItem.error, 'Growth Batch feed item setup failed')
  const feedItemId = feedItem.data.id

  const supplementItem = await ownerClient
    .from('items')
    .insert({
      company_id: companyId,
      sku: `${PREFIX.toUpperCase()}-SUP`,
      name: `${PREFIX} Supplement Input`,
      base_uom_id: kgUomId,
      min_stock: 0,
      unit_price: 55,
      primary_role: 'raw_material',
      track_inventory: true,
      can_buy: true,
      can_sell: false,
      is_assembled: false,
    })
    .select('id, unit_price')
    .single()
  throwSupabaseError(supplementItem.error, 'Growth Batch supplement item setup failed')
  const supplementItemId = supplementItem.data.id

  expectNoSupabaseError(
    await ownerClient.rpc('post_stock_receipt', {
      p_company_id: companyId,
      p_item_id: feedItemId,
      p_uom_id: kgUomId,
      p_qty: 100,
      p_qty_base: 100,
      p_unit_cost: 2.5,
      p_warehouse_to_id: warehouseId,
      p_bin_to_id: binId,
      p_ref_type: 'ADJUST',
      p_notes: `${PREFIX} feed opening stock`,
      p_request_key: `${PREFIX}-feed-opening-stock`,
    }),
    'Expected feed input stock receipt to succeed',
  )
  expectNoSupabaseError(
    await ownerClient.rpc('post_stock_receipt', {
      p_company_id: companyId,
      p_item_id: supplementItemId,
      p_uom_id: kgUomId,
      p_qty: 50,
      p_qty_base: 50,
      p_unit_cost: 4,
      p_warehouse_to_id: warehouseId,
      p_bin_to_id: binId,
      p_ref_type: 'ADJUST',
      p_notes: `${PREFIX} supplement opening stock`,
      p_request_key: `${PREFIX}-supplement-opening-stock`,
    }),
    'Expected supplement input stock receipt to succeed',
  )

  await t.test('schema authority metadata and direct mutation protections', async () => {
    const schemaRows = await runLocalSql(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in (
        'growth_batch_counters',
        'growth_batches',
        'growth_batch_events',
        'growth_batch_measurements',
        'growth_batch_direct_costs',
        'growth_batch_stock_inputs',
        'growth_batch_stock_input_reversal_lines',
        'growth_batch_losses',
        'growth_batch_loss_reversal_lines'
      )
      order by relname;
    `)
    assert.equal(schemaRows.length, 9, 'Expected all Growth Batch tables to exist')
    assert.equal(schemaRows.every((row) => row.relrowsecurity === true), true, 'Expected Growth Batch RLS enabled')
    assert.equal(schemaRows.every((row) => row.relforcerowsecurity === true), true, 'Expected Growth Batch FORCE RLS enabled')

    const grantRows = await runLocalSql(`
      select
        has_function_privilege('anon', '${CREATE_GROWTH_BATCH_SIGNATURE}', 'EXECUTE') as anon_create,
        has_function_privilege('authenticated', '${CREATE_GROWTH_BATCH_SIGNATURE}', 'EXECUTE') as auth_create,
        has_function_privilege('anon', 'public.activate_growth_batch(uuid,uuid,text)', 'EXECUTE') as anon_activate,
        has_function_privilege('authenticated', 'public.activate_growth_batch(uuid,uuid,text)', 'EXECUTE') as auth_activate,
        has_function_privilege('anon', '${MEASUREMENT_SIGNATURE}', 'EXECUTE') as anon_measurement,
        has_function_privilege('authenticated', '${MEASUREMENT_SIGNATURE}', 'EXECUTE') as auth_measurement,
        has_function_privilege('anon', '${PREVIEW_STOCK_INPUT_SIGNATURE}', 'EXECUTE') as anon_stock_preview,
        has_function_privilege('authenticated', '${PREVIEW_STOCK_INPUT_SIGNATURE}', 'EXECUTE') as auth_stock_preview,
        has_function_privilege('anon', '${POST_STOCK_INPUT_SIGNATURE}', 'EXECUTE') as anon_stock_post,
        has_function_privilege('authenticated', '${POST_STOCK_INPUT_SIGNATURE}', 'EXECUTE') as auth_stock_post,
        has_function_privilege('anon', '${REVERSE_STOCK_INPUT_SIGNATURE}', 'EXECUTE') as anon_stock_reverse,
        has_function_privilege('authenticated', '${REVERSE_STOCK_INPUT_SIGNATURE}', 'EXECUTE') as auth_stock_reverse,
        has_function_privilege('anon', '${PREVIEW_LOSS_SIGNATURE}', 'EXECUTE') as anon_loss_preview,
        has_function_privilege('authenticated', '${PREVIEW_LOSS_SIGNATURE}', 'EXECUTE') as auth_loss_preview,
        has_function_privilege('anon', '${RECORD_LOSS_SIGNATURE}', 'EXECUTE') as anon_loss_record,
        has_function_privilege('authenticated', '${RECORD_LOSS_SIGNATURE}', 'EXECUTE') as auth_loss_record,
        has_function_privilege('anon', '${REVERSE_LOSS_SIGNATURE}', 'EXECUTE') as anon_loss_reverse,
        has_function_privilege('authenticated', '${REVERSE_LOSS_SIGNATURE}', 'EXECUTE') as auth_loss_reverse;
    `)
    assert.equal(grantRows[0].anon_create, false, 'anon must not execute create_growth_batch_draft')
    assert.equal(grantRows[0].anon_activate, false, 'anon must not execute activate_growth_batch')
    assert.equal(grantRows[0].anon_measurement, false, 'anon must not execute record_growth_batch_measurement')
    assert.equal(grantRows[0].anon_stock_preview, false, 'anon must not execute preview_growth_batch_stock_input')
    assert.equal(grantRows[0].anon_stock_post, false, 'anon must not execute post_growth_batch_stock_input')
    assert.equal(grantRows[0].anon_stock_reverse, false, 'anon must not execute reverse_growth_batch_stock_input')
    assert.equal(grantRows[0].anon_loss_preview, false, 'anon must not execute preview_growth_batch_loss')
    assert.equal(grantRows[0].anon_loss_record, false, 'anon must not execute record_growth_batch_loss')
    assert.equal(grantRows[0].anon_loss_reverse, false, 'anon must not execute reverse_growth_batch_loss')
    assert.equal(grantRows[0].auth_create, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_activate, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_measurement, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_stock_preview, true, 'authenticated users execute governed Growth Batch stock preview')
    assert.equal(grantRows[0].auth_stock_post, true, 'authenticated users execute governed Growth Batch stock posting')
    assert.equal(grantRows[0].auth_stock_reverse, true, 'authenticated users execute governed Growth Batch stock reversal')
    assert.equal(grantRows[0].auth_loss_preview, true, 'authenticated users execute governed Growth Batch loss preview')
    assert.equal(grantRows[0].auth_loss_record, true, 'authenticated users execute governed Growth Batch loss recording')
    assert.equal(grantRows[0].auth_loss_reverse, true, 'authenticated users execute governed Growth Batch loss reversal')

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

    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_stock_inputs').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        growth_batch_event_id: '00000000-0000-0000-0000-000000000000',
        line_no: 1,
        item_id: feedItemId,
        uom_id: kgUomId,
        quantity: 1,
        source_warehouse_id: warehouseId,
        source_bin_id: binId,
        frozen_unit_cost: 1,
        frozen_total_cost: 1,
        issue_movement_id: '00000000-0000-0000-0000-000000000000',
      }),
      'direct growth_batch_stock_inputs insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_stock_input_reversal_lines').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        reversal_event_id: '00000000-0000-0000-0000-000000000000',
        original_event_id: '00000000-0000-0000-0000-000000000000',
        original_stock_input_id: '00000000-0000-0000-0000-000000000000',
        line_no: 1,
        item_id: feedItemId,
        uom_id: kgUomId,
        quantity: 1,
        frozen_unit_cost: 1,
        frozen_total_cost: 1,
        destination_warehouse_id: warehouseId,
        destination_bin_id: binId,
        receipt_movement_id: '00000000-0000-0000-0000-000000000000',
      }),
      'direct growth_batch_stock_input_reversal_lines insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_losses').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        event_id: '00000000-0000-0000-0000-000000000000',
        loss_type: 'mortality',
        quantity_lost: 1,
        quantity_uom_id: eachUomId,
        reason_code: 'disease',
        quantity_before: 10,
        quantity_after: 9,
      }),
      'direct growth_batch_losses insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_loss_reversal_lines').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        reversal_event_id: '00000000-0000-0000-0000-000000000000',
        original_event_id: '00000000-0000-0000-0000-000000000000',
        original_loss_id: '00000000-0000-0000-0000-000000000000',
        restored_quantity: 1,
        restored_quantity_uom_id: eachUomId,
        quantity_before: 9,
        quantity_after: 10,
        reason: 'Direct mutation blocked',
      }),
      'direct growth_batch_loss_reversal_lines insert',
    )
  })

  let countBatch = null
  let weightBatch = null
  let areaBatch = null

  async function createActiveGrowthBatch(label, options = {}) {
    const {
      family = 'poultry',
      basis = 'count',
      openingQty = 10,
      primaryUomId = basis === 'weight' ? kgUomId : basis === 'area' ? areaUomId : eachUomId,
      openingWeight = null,
      weightUomId = openingWeight == null && basis !== 'weight' ? null : kgUomId,
      warehouse = warehouseId,
      bin = binId,
    } = options
    const draft = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('create_growth_batch_draft', {
      p_company_id: companyId,
      p_name: `${PREFIX} ${label}`,
      p_batch_family: family,
      p_primary_quantity_basis: basis,
      p_opening_primary_qty: openingQty,
      p_primary_uom_id: primaryUomId,
      p_start_date: todayIso(),
      p_opening_total_weight: openingWeight,
      p_weight_uom_id: weightUomId,
      p_warehouse_id: warehouse,
      p_bin_id: bin,
      p_request_key: `${PREFIX}-${label}-create`,
      p_opening_total_weight_present: openingWeight != null,
    }), `Expected ${label} draft to be created`))
    unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('activate_growth_batch', {
      p_company_id: companyId,
      p_growth_batch_id: draft.batch_id,
      p_request_key: `${PREFIX}-${label}-activate`,
    }), `Expected ${label} activation to succeed`))
    return draft
  }

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
    assert.ok(Array.isArray(hashRows), 'Expected activation in-progress fixture hash query to return a rows array')
    assert.equal(hashRows.length, 1, 'Expected exactly one activation in-progress fixture hash row')
    assert.ok(hashRows[0].payload_hash, 'Expected activation in-progress fixture payload hash')
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

  await t.test('G4.1 mortality, shrinkage, loss reversals, and isolation', async () => {
    const lossBatch = await createActiveGrowthBatch('Loss Batch', { openingQty: 20, openingWeight: 40 })
    const financeBeforeLoss = await financeIsolationCounts(admin, companyId)
    const stockBeforeLoss = await stockMovementCount(admin, companyId)
    const stockLevelCountBeforeLoss = await countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]])
    const priceBeforeLoss = await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]])
    const costBeforeLoss = await querySingle(ownerClient, 'growth_batches', 'accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,harvested_cost,remaining_cost,current_primary_qty,current_total_weight', [
      ['eq', 'id', lossBatch.batch_id],
    ])
    const lossBatchPreviewSnapshotSelect = 'status,current_primary_qty,current_total_weight,latest_event_sequence,warehouse_id,bin_id,location_description,accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,harvested_cost,remaining_cost'

    async function lossPreviewMutationSnapshot(batchId) {
      const [
        growthBatchCount,
        eventCount,
        lossCount,
        reversalCount,
        postingRequestCount,
        movementCount,
        stockLevelCount,
        financeCounts,
        batch,
        itemPrice,
      ] = await Promise.all([
        countRows(ownerClient, 'growth_batches', [['eq', 'company_id', companyId]]),
        countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', batchId]]),
        countRows(ownerClient, 'growth_batch_losses', [['eq', 'growth_batch_id', batchId]]),
        countRows(ownerClient, 'growth_batch_loss_reversal_lines', [['eq', 'growth_batch_id', batchId]]),
        countRows(admin, 'posting_requests', [['eq', 'company_id', companyId]]),
        stockMovementCount(admin, companyId),
        countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]]),
        financeIsolationCounts(admin, companyId),
        querySingle(ownerClient, 'growth_batches', lossBatchPreviewSnapshotSelect, [['eq', 'id', batchId]]),
        querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]]),
      ])

      return {
        growthBatchCount,
        eventCount,
        lossCount,
        reversalCount,
        postingRequestCount,
        movementCount,
        stockLevelCount,
        financeCounts,
        batch,
        itemPrice,
      }
    }

    async function assertLossPreviewNonMutation(batchId, before, label) {
      assert.deepEqual(await lossPreviewMutationSnapshot(batchId), before, `${label} must not mutate database state`)
    }

    function previewBlockerCodes(preview) {
      return (preview.blocking_reasons ?? []).map((reason) => reason.code)
    }

    async function expectPreviewBlocker(payload, expectedCode, label) {
      const before = await lossPreviewMutationSnapshot(payload.p_growth_batch_id)
      const preview = unwrapRpcSingle(expectNoSupabaseError(
        await operatorClient.rpc('preview_growth_batch_loss', payload),
        `Expected ${label} preview to return blockers`,
      ))
      assert.equal(preview.ready, false, `${label} preview must not be ready`)
      assert.equal(previewBlockerCodes(preview).includes(expectedCode), true, `${label} preview must include ${expectedCode}`)
      await assertLossPreviewNonMutation(payload.p_growth_batch_id, before, `${label} preview`)
      return preview
    }

    async function expectPreviewError(payload, expectedMessage, label) {
      const before = await lossPreviewMutationSnapshot(payload.p_growth_batch_id)
      await expectPostgrestError(operatorClient.rpc('preview_growth_batch_loss', payload), expectedMessage)
      await assertLossPreviewNonMutation(payload.p_growth_batch_id, before, `${label} preview`)
    }

    await expectPostgrestError(
      viewerClient.rpc('preview_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 1,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
      }),
      'operator_role_required',
    )
    await expectPostgrestError(
      crossOwnerClient.rpc('preview_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 1,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
      }),
      'growth_batch_not_found',
    )

    const mortalityLossPayload = {
      p_growth_batch_id: lossBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 2,
      p_weight_lost: null,
      p_reason_code: 'disease',
      p_notes: 'Controlled mortality test',
    }
    const mortalityPreviewBefore = await lossPreviewMutationSnapshot(lossBatch.batch_id)
    const mortalityPreview = unwrapRpcSingle(expectNoSupabaseError(
      await operatorClient.rpc('preview_growth_batch_loss', mortalityLossPayload),
      'Expected mortality preview to succeed',
    ))
    assert.equal(mortalityPreview.ready, true)
    assert.deepEqual(previewBlockerCodes(mortalityPreview), [])
    assert.equal(mortalityPreview.loss_type, 'mortality')
    assert.equal(mortalityPreview.reason_code, 'disease')
    assert.equal(Number(mortalityPreview.current_quantity), 20)
    assert.equal(Number(mortalityPreview.quantity_lost), 2)
    assert.equal(Number(mortalityPreview.resulting_quantity), 18)
    assert.equal(mortalityPreview.quantity_uom_id, eachUomId)
    assert.equal(mortalityPreview.quantity_uom_code, 'EA')
    assert.equal(Number(mortalityPreview.current_total_weight), 40)
    assert.equal(mortalityPreview.weight_lost, null)
    assert.equal(Number(mortalityPreview.resulting_total_weight), 40)
    await assertLossPreviewNonMutation(lossBatch.batch_id, mortalityPreviewBefore, 'Mortality preview')

    await expectPreviewBlocker({
      ...mortalityLossPayload,
      p_quantity_lost: null,
      p_weight_lost: null,
      p_notes: null,
    }, 'loss_value_required', 'empty loss')
    await expectPreviewBlocker({
      ...mortalityLossPayload,
      p_quantity_lost: 100,
      p_notes: null,
    }, 'loss_quantity_exceeds_current_quantity', 'excessive quantity')
    await expectPreviewBlocker({
      ...mortalityLossPayload,
      p_loss_type: 'shrinkage',
      p_quantity_lost: null,
      p_weight_lost: 100,
      p_reason_code: 'drying',
      p_notes: null,
    }, 'loss_weight_exceeds_current_weight', 'excessive weight')
    await expectPreviewError({
      ...mortalityLossPayload,
      p_effective_date: addDaysIso(-1),
      p_quantity_lost: 1,
      p_notes: null,
    }, 'growth_batch_event_before_start', 'before-start-date')
    await expectPreviewError({
      ...mortalityLossPayload,
      p_effective_date: addDaysIso(7),
      p_quantity_lost: 1,
      p_notes: null,
    }, 'growth_batch_event_future', 'future-date')
    await expectPreviewBlocker({
      ...mortalityLossPayload,
      p_quantity_lost: 0.5,
      p_notes: null,
    }, 'fractional_count_not_allowed', 'fractional count quantity')
    await expectPreviewError({
      ...mortalityLossPayload,
      p_quantity_lost: 1,
      p_reason_code: 'drying',
      p_notes: null,
    }, 'loss_reason_invalid', 'invalid reason')
    await expectPreviewError({
      ...mortalityLossPayload,
      p_loss_type: 'shrinkage',
      p_quantity_lost: null,
      p_weight_lost: 1,
      p_reason_code: 'other',
      p_notes: '',
    }, 'loss_notes_required', 'other without notes')

    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 1.5,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
        p_request_key: `${PREFIX}-fractional-mortality`,
      }),
      'fractional_count_not_allowed',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: addDaysIso(1),
        p_quantity_lost: 1,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
        p_request_key: `${PREFIX}-future-mortality`,
      }),
      'growth_batch_event_future',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: addDaysIso(-1),
        p_quantity_lost: 1,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
        p_request_key: `${PREFIX}-before-start-mortality`,
      }),
      'growth_batch_event_before_start',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 1,
        p_weight_lost: null,
        p_reason_code: 'drying',
        p_notes: null,
        p_request_key: `${PREFIX}-invalid-mortality-reason`,
      }),
      'loss_reason_invalid',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'shrinkage',
        p_effective_date: todayIso(),
        p_quantity_lost: null,
        p_weight_lost: 1,
        p_reason_code: 'other',
        p_notes: '',
        p_request_key: `${PREFIX}-other-no-notes`,
      }),
      'loss_notes_required',
    )
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 100,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
        p_request_key: `${PREFIX}-excessive-mortality`,
      }),
      'loss_quantity_exceeds_current_quantity',
    )

    const postedMortality = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      ...mortalityLossPayload,
      p_request_key: `${PREFIX}-mortality-post`,
    }), 'Expected mortality posting to succeed'))
    assert.equal(postedMortality.event_type, 'mortality')
    assert.equal(Number(postedMortality.quantity_before), Number(mortalityPreview.current_quantity))
    assert.equal(Number(postedMortality.quantity_lost), Number(mortalityPreview.quantity_lost))
    assert.equal(Number(postedMortality.quantity_after), 18)
    assert.equal(Number(postedMortality.quantity_after), Number(mortalityPreview.resulting_quantity))
    assert.equal(Number(postedMortality.weight_before), Number(mortalityPreview.current_total_weight))
    assert.equal(postedMortality.weight_lost, mortalityPreview.weight_lost)
    assert.equal(Number(postedMortality.weight_after), Number(mortalityPreview.resulting_total_weight))
    const mortalityReplay = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: lossBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: '2.00',
      p_weight_lost: null,
      p_reason_code: 'disease',
      p_notes: 'Controlled mortality test',
      p_request_key: `${PREFIX}-mortality-post`,
    }), 'Expected mortality replay to succeed'))
    assert.equal(mortalityReplay.event_id, postedMortality.event_id)
    await expectPostgrestError(
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: lossBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 3,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: 'Controlled mortality test',
        p_request_key: `${PREFIX}-mortality-post`,
      }),
      'idempotency_key_payload_mismatch',
    )

    const shrinkageLossPayload = {
      p_growth_batch_id: lossBatch.batch_id,
      p_loss_type: 'shrinkage',
      p_effective_date: todayIso(),
      p_quantity_lost: null,
      p_weight_lost: 5,
      p_reason_code: 'drying',
      p_notes: 'Controlled drying shrinkage',
    }
    const shrinkagePreviewBefore = await lossPreviewMutationSnapshot(lossBatch.batch_id)
    const shrinkagePreview = unwrapRpcSingle(expectNoSupabaseError(
      await operatorClient.rpc('preview_growth_batch_loss', shrinkageLossPayload),
      'Expected shrinkage preview to succeed',
    ))
    assert.equal(shrinkagePreview.ready, true)
    assert.deepEqual(previewBlockerCodes(shrinkagePreview), [])
    assert.equal(shrinkagePreview.loss_type, 'shrinkage')
    assert.equal(shrinkagePreview.reason_code, 'drying')
    assert.equal(Number(shrinkagePreview.current_quantity), 18)
    assert.equal(shrinkagePreview.quantity_lost, null)
    assert.equal(Number(shrinkagePreview.resulting_quantity), 18)
    assert.equal(Number(shrinkagePreview.current_total_weight), 40)
    assert.equal(Number(shrinkagePreview.weight_lost), 5)
    assert.equal(Number(shrinkagePreview.resulting_total_weight), 35)
    assert.equal(shrinkagePreview.weight_uom_id, kgUomId)
    assert.equal(shrinkagePreview.weight_uom_code, 'KG')
    await assertLossPreviewNonMutation(lossBatch.batch_id, shrinkagePreviewBefore, 'Shrinkage preview')

    const postedShrinkage = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      ...shrinkageLossPayload,
      p_request_key: `${PREFIX}-shrinkage-post`,
    }), 'Expected shrinkage posting to succeed'))
    assert.equal(postedShrinkage.event_type, 'shrinkage')
    assert.equal(Number(postedShrinkage.quantity_before), Number(shrinkagePreview.current_quantity))
    assert.equal(postedShrinkage.quantity_lost, shrinkagePreview.quantity_lost)
    assert.equal(Number(postedShrinkage.quantity_after), Number(shrinkagePreview.resulting_quantity))
    assert.equal(Number(postedShrinkage.weight_before), Number(shrinkagePreview.current_total_weight))
    assert.equal(Number(postedShrinkage.weight_lost), Number(shrinkagePreview.weight_lost))
    assert.equal(Number(postedShrinkage.weight_after), 35)
    assert.equal(Number(postedShrinkage.weight_after), Number(shrinkagePreview.resulting_total_weight))

    const afterLoss = await querySingle(ownerClient, 'growth_batches', 'current_primary_qty,current_total_weight,accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,harvested_cost,remaining_cost', [
      ['eq', 'id', lossBatch.batch_id],
    ])
    assert.equal(Number(afterLoss.current_primary_qty), 18)
    assert.equal(Number(afterLoss.current_total_weight), 35)
    assert.equal(Number(afterLoss.accumulated_material_cost), Number(costBeforeLoss.accumulated_material_cost))
    assert.equal(Number(afterLoss.accumulated_direct_cost), Number(costBeforeLoss.accumulated_direct_cost))
    assert.equal(Number(afterLoss.accumulated_total_cost), Number(costBeforeLoss.accumulated_total_cost))
    assert.equal(Number(afterLoss.harvested_cost), Number(costBeforeLoss.harvested_cost))
    assert.equal(Number(afterLoss.remaining_cost), Number(costBeforeLoss.remaining_cost))
    assert.equal(await stockMovementCount(admin, companyId), stockBeforeLoss, 'Losses must not create stock movements')
    assert.equal(await countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]]), stockLevelCountBeforeLoss, 'Losses must not create stock levels')
    assert.deepEqual(await financeIsolationCounts(admin, companyId), financeBeforeLoss)
    assert.deepEqual(await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]]), priceBeforeLoss)

    const lossHistory = expectNoSupabaseError(
      await ownerClient.from('growth_batch_loss_history').select('*').eq('growth_batch_id', lossBatch.batch_id).order('event_sequence', { ascending: true }),
      'Expected loss history to load',
    )
    assert.equal(lossHistory.length, 2)
    assert.equal(lossHistory[0].loss_type, 'mortality')
    assert.equal(lossHistory[1].loss_type, 'shrinkage')
    const timelineLosses = expectNoSupabaseError(
      await ownerClient.from('growth_batch_event_timeline').select('event_type,typed_detail_summary').eq('growth_batch_id', lossBatch.batch_id).in('event_type', ['mortality', 'shrinkage']),
      'Expected loss timeline rows to load',
    )
    assert.equal(timelineLosses.length, 2)
    assert.equal(timelineLosses.every((row) => row.typed_detail_summary?.loss_type), true)

    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_losses').update({ quantity_lost: 99 }).eq('id', lossHistory[0].id),
      'direct growth_batch_losses update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_losses').delete().eq('id', lossHistory[0].id),
      'direct growth_batch_losses delete',
    )
    await expectPostgrestError(
      operatorClient.rpc('reverse_growth_batch_loss', {
        p_event_id: postedMortality.event_id,
        p_reason: 'Operator cannot reverse',
        p_request_key: `${PREFIX}-operator-loss-reverse`,
      }),
      'manager_role_required',
    )
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_loss', {
        p_event_id: postedMortality.event_id,
        p_reason: '',
        p_request_key: `${PREFIX}-missing-loss-reverse-reason`,
      }),
      'reversal_reason_required',
    )

    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_direct_cost', {
      p_company_id: companyId,
      p_growth_batch_id: lossBatch.batch_id,
      p_category: 'labour',
      p_description: 'Loss reversal dependency direct cost control',
      p_amount: 1,
      p_event_date: todayIso(),
      p_notes: null,
      p_request_key: `${PREFIX}-loss-direct-cost-does-not-block`,
    }))
    expectNoSupabaseError(await operatorClient.rpc('post_growth_batch_stock_input', {
      p_batch_id: lossBatch.batch_id,
      p_effective_date: todayIso(),
      p_lines: [{
        item_id: feedItemId,
        uom_id: kgUomId,
        quantity: 1,
        source_warehouse_id: warehouseId,
        source_bin_id: binId,
        line_notes: null,
      }],
      p_notes: 'Loss reversal stock input control',
      p_request_key: `${PREFIX}-loss-stock-input-does-not-block`,
    }))

    const originalLossBeforeReverse = await querySingle(ownerClient, 'growth_batch_losses', 'id,event_id,quantity_lost,weight_lost,quantity_before,quantity_after,total_weight_before,total_weight_after', [
      ['eq', 'event_id', postedMortality.event_id],
    ])
    const reversedMortality = unwrapRpcSingle(expectNoSupabaseError(await ownerClient.rpc('reverse_growth_batch_loss', {
      p_event_id: postedMortality.event_id,
      p_reason: 'Controlled mortality reversal',
      p_request_key: `${PREFIX}-mortality-reverse`,
    }), 'Expected mortality reversal to succeed despite later direct cost and stock input'))
    assert.equal(reversedMortality.event_type, 'mortality_reversal')
    assert.equal(Number(reversedMortality.quantity_after), 20)
    const reversedMortalityReplay = unwrapRpcSingle(expectNoSupabaseError(await ownerClient.rpc('reverse_growth_batch_loss', {
      p_event_id: postedMortality.event_id,
      p_reason: 'Controlled mortality reversal',
      p_request_key: `${PREFIX}-mortality-reverse`,
    }), 'Expected mortality reversal replay to succeed'))
    assert.equal(reversedMortalityReplay.event_id, reversedMortality.event_id)
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_loss', {
        p_event_id: postedMortality.event_id,
        p_reason: 'Changed reason',
        p_request_key: `${PREFIX}-mortality-reverse`,
      }),
      'idempotency_key_payload_mismatch',
    )
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_loss', {
        p_event_id: postedMortality.event_id,
        p_reason: 'Second reversal',
        p_request_key: `${PREFIX}-mortality-reverse-second`,
      }),
      'growth_batch_loss_already_reversed',
    )
    assert.deepEqual(await querySingle(ownerClient, 'growth_batch_losses', 'id,event_id,quantity_lost,weight_lost,quantity_before,quantity_after,total_weight_before,total_weight_after', [
      ['eq', 'event_id', postedMortality.event_id],
    ]), originalLossBeforeReverse)
    const reversalRows = expectNoSupabaseError(
      await ownerClient.from('growth_batch_loss_reversal_lines').select('*').eq('original_event_id', postedMortality.event_id),
      'Expected loss reversal detail to load',
    )
    assert.equal(reversalRows.length, 1)
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_loss_reversal_lines').update({ restored_quantity: 99 }).eq('id', reversalRows[0].id),
      'direct growth_batch_loss_reversal_lines update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_loss_reversal_lines').delete().eq('id', reversalRows[0].id),
      'direct growth_batch_loss_reversal_lines delete',
    )

    const weightDependencyBatch = await createActiveGrowthBatch('Weight Dependency Loss Batch', { openingQty: 10, openingWeight: 50 })
    const weightLoss = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: weightDependencyBatch.batch_id,
      p_loss_type: 'shrinkage',
      p_effective_date: todayIso(),
      p_quantity_lost: null,
      p_weight_lost: 4,
      p_reason_code: 'drying',
      p_notes: 'Dependency setup',
      p_request_key: `${PREFIX}-weight-dependency-loss`,
    })))
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_measurement', {
      p_company_id: companyId,
      p_growth_batch_id: weightDependencyBatch.batch_id,
      p_measurement_type: 'total_weight',
      p_value: 45,
      p_uom_id: kgUomId,
      p_observed_at: new Date().toISOString(),
      p_sample_size: null,
      p_minimum: null,
      p_maximum: null,
      p_average: null,
      p_description: null,
      p_notes: null,
      p_request_key: `${PREFIX}-weight-dependency-measurement`,
      p_sample_size_present: false,
      p_minimum_present: false,
      p_maximum_present: false,
      p_average_present: false,
    }))
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_loss', {
        p_event_id: weightLoss.event_id,
        p_reason: 'Blocked by later total weight',
        p_request_key: `${PREFIX}-weight-dependency-reverse`,
      }),
      'growth_batch_loss_reversal_dependency_exists',
    )

    const quantityDependencyBatch = await createActiveGrowthBatch('Quantity Dependency Loss Batch', { openingQty: 5, openingWeight: 10 })
    const firstQuantityLoss = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: quantityDependencyBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 1,
      p_weight_lost: null,
      p_reason_code: 'disease',
      p_notes: null,
      p_request_key: `${PREFIX}-quantity-dependency-first`,
    })))
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: quantityDependencyBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 1,
      p_weight_lost: null,
      p_reason_code: 'injury',
      p_notes: null,
      p_request_key: `${PREFIX}-quantity-dependency-second`,
    }))
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_loss', {
        p_event_id: firstQuantityLoss.event_id,
        p_reason: 'Blocked by later mortality',
        p_request_key: `${PREFIX}-quantity-dependency-reverse`,
      }),
      'growth_batch_loss_reversal_dependency_exists',
    )

    const concurrentBatch = await createActiveGrowthBatch('Concurrent Loss Batch', { openingQty: 2, openingWeight: 10 })
    const concurrentResults = await Promise.all([
      operatorClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: concurrentBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 2,
        p_weight_lost: null,
        p_reason_code: 'disease',
        p_notes: null,
        p_request_key: `${PREFIX}-concurrent-loss-a`,
      }),
      ownerClient.rpc('record_growth_batch_loss', {
        p_growth_batch_id: concurrentBatch.batch_id,
        p_loss_type: 'mortality',
        p_effective_date: todayIso(),
        p_quantity_lost: 2,
        p_weight_lost: null,
        p_reason_code: 'injury',
        p_notes: null,
        p_request_key: `${PREFIX}-concurrent-loss-b`,
      }),
    ])
    assert.equal(concurrentResults.filter((result) => !result.error).length, 1, 'Only one competing loss should succeed')
    assert.equal(concurrentResults.filter((result) => result.error).length, 1, 'One competing loss should fail safely')
    const concurrentState = await querySingle(ownerClient, 'growth_batches', 'current_primary_qty', [['eq', 'id', concurrentBatch.batch_id]])
    assert.equal(Number(concurrentState.current_primary_qty) >= 0, true, 'Concurrent losses must not make quantity negative')

    const duplicateBatch = await createActiveGrowthBatch('Duplicate Request Loss Batch', { openingQty: 4, openingWeight: 8 })
    const duplicatePayload = {
      p_growth_batch_id: duplicateBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 1,
      p_weight_lost: null,
      p_reason_code: 'disease',
      p_notes: null,
      p_request_key: `${PREFIX}-duplicate-loss-request`,
    }
    const duplicateResults = await Promise.all([
      operatorClient.rpc('record_growth_batch_loss', duplicatePayload),
      ownerClient.rpc('record_growth_batch_loss', duplicatePayload),
    ])
    assert.equal(duplicateResults.every((result) => !result.error), true, `Expected duplicate request replay to succeed: ${duplicateResults.map((result) => result.error?.message).filter(Boolean).join('; ')}`)
    assert.equal(unwrapRpcSingle(duplicateResults[0].data).event_id, unwrapRpcSingle(duplicateResults[1].data).event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_losses', [['eq', 'growth_batch_id', duplicateBatch.batch_id]]), 1)
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
      assert.ok(Array.isArray(rows), 'Expected activation hash query to return a rows array')
      assert.equal(rows.length, 1, `Expected exactly one activation hash row for batch ${batchId}`)
      assert.ok(rows[0].payload_hash, `Expected activation payload hash for batch ${batchId}`)
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

    const stockBatch = await createDraftBatch('stock-input', { p_weight_uom_id: kgUomId })
    await activateDraftBatch(stockBatch, 'stock-input')
    const stockInputLines = [
      {
        item_id: feedItemId,
        uom_id: kgUomId,
        quantity: 5,
        source_warehouse_id: warehouseId,
        source_bin_id: binId,
        line_notes: 'Feed issued to batch',
      },
      {
        item_id: supplementItemId,
        uom_id: kgUomId,
        quantity: 2,
        source_warehouse_id: warehouseId,
        source_bin_id: binId,
        line_notes: 'Supplement issued to batch',
      },
    ]
    const stockBeforePreview = await stockMovementCount(ownerClient, companyId)
    const inputBeforePreview = await countRows(ownerClient, 'growth_batch_stock_inputs', [['eq', 'growth_batch_id', stockBatch.batch_id]])
    const preview = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('preview_growth_batch_stock_input', {
          p_batch_id: stockBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: stockInputLines,
          p_notes: 'Preview only',
        }),
        'Expected stock input preview to succeed',
      ),
    )
    assert.equal(preview.ready, true)
    assert.equal(preview.lines.length, 2)
    assert.equal(Number(preview.estimated_total_material_cost), 20.5)
    assert.equal(await stockMovementCount(ownerClient, companyId), stockBeforePreview, 'Preview must not create stock movements')
    assert.equal(await countRows(ownerClient, 'growth_batch_stock_inputs', [['eq', 'growth_batch_id', stockBatch.batch_id]]), inputBeforePreview, 'Preview must not create stock input details')

    const duplicatePreview = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('preview_growth_batch_stock_input', {
          p_batch_id: stockBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: [stockInputLines[0], { ...stockInputLines[0], quantity: 1 }],
          p_notes: 'Duplicate preview',
        }),
        'Expected duplicate preview to return blockers rather than mutate',
      ),
    )
    assert.equal(duplicatePreview.ready, false)
    assert.match(JSON.stringify(duplicatePreview.blocking_reasons), /growth_batch_input_duplicate_bucket/)

    const insufficientPreview = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('preview_growth_batch_stock_input', {
          p_batch_id: stockBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: [{ ...stockInputLines[0], quantity: 999 }],
          p_notes: 'Insufficient preview',
        }),
        'Expected insufficient stock preview to return blockers rather than mutate',
      ),
    )
    assert.equal(insufficientPreview.ready, false)
    assert.match(JSON.stringify(insufficientPreview.blocking_reasons), /insufficient_stock/)
    assert.equal(await stockMovementCount(ownerClient, companyId), stockBeforePreview, 'Insufficient preview must not create stock movements')

    await expectPostgrestError(
      viewerClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: stockBatch.batch_id,
        p_effective_date: todayIso(),
        p_lines: stockInputLines,
        p_notes: 'Viewer blocked',
        p_request_key: `${PREFIX}-viewer-stock-input`,
      }),
      'operator_role_required',
    )
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: stockBatch.batch_id,
        p_effective_date: todayIso(),
        p_lines: stockInputLines,
        p_notes: 'Missing request key',
        p_request_key: null,
      }),
      'request_key_required',
    )
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: stockBatch.batch_id,
        p_effective_date: addDaysIso(-1),
        p_lines: stockInputLines,
        p_notes: 'Before start blocked',
        p_request_key: `${PREFIX}-stock-input-before-start`,
      }),
      'growth_batch_input_date_before_start',
    )
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: stockBatch.batch_id,
        p_effective_date: addDaysIso(1),
        p_lines: stockInputLines,
        p_notes: 'Future date blocked',
        p_request_key: `${PREFIX}-stock-input-future`,
      }),
      'growth_batch_input_date_in_future',
    )
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: stockBatch.batch_id,
        p_effective_date: todayIso(),
        p_lines: [{ ...stockInputLines[0], uom_id: eachUomId }],
        p_notes: 'Wrong UOM',
        p_request_key: `${PREFIX}-stock-input-wrong-uom`,
      }),
      'growth_batch_input_uom_mismatch',
    )

    const financeBeforeStockInput = await financeIsolationCounts(admin, companyId)
    const movementBeforeStockInput = await stockMovementCount(ownerClient, companyId)
    const priceBeforeStockInput = await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]])
    const feedBefore = await querySingle(ownerClient, 'stock_levels', 'qty,avg_cost', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', feedItemId],
      ['eq', 'warehouse_id', warehouseId],
      ['eq', 'bin_id', binId],
    ])
    const postedInput = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('post_growth_batch_stock_input', {
          p_batch_id: stockBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: stockInputLines,
          p_notes: 'Post governed stock input',
          p_request_key: `${PREFIX}-stock-input-post`,
        }),
        'Expected stock input posting to succeed',
      ),
    )
    assert.ok(postedInput.event_id)
    assert.equal(postedInput.event_type, 'stock_input')
    assert.equal(Number(postedInput.material_cost_delta), 20.5)
    assert.equal(postedInput.movements.length, 2)
    assert.equal(await stockMovementCount(ownerClient, companyId), movementBeforeStockInput + 2)
    const feedAfter = await querySingle(ownerClient, 'stock_levels', 'qty,avg_cost', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', feedItemId],
      ['eq', 'warehouse_id', warehouseId],
      ['eq', 'bin_id', binId],
    ])
    assert.equal(Number(feedAfter.qty), Number(feedBefore.qty) - 5)

    const stockInputDetails = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_stock_inputs')
        .select('id,line_no,item_id,uom_id,quantity,frozen_unit_cost,frozen_total_cost,issue_movement_id')
        .eq('growth_batch_event_id', postedInput.event_id)
        .order('line_no', { ascending: true }),
      'Expected stock input details to load',
    )
    assert.equal(stockInputDetails.length, 2)
    assert.deepEqual(stockInputDetails.map((line) => Number(line.frozen_total_cost)), [12.5, 8])
    const movementRows = expectNoSupabaseError(
      await ownerClient
        .from('stock_movements')
        .select('id,type,item_id,uom_id,qty_base,unit_cost,total_value,warehouse_from_id,bin_from_id,ref_type,ref_id,ref_line_id')
        .in('id', stockInputDetails.map((line) => line.issue_movement_id)),
      'Expected stock input movements to load',
    )
    assert.equal(movementRows.length, 2)
    assert.equal(movementRows.every((movement) => movement.type === 'issue' && movement.ref_type === 'GROWTH_BATCH_INPUT' && movement.ref_id === postedInput.event_id), true)
    assert.equal(new Set(movementRows.map((movement) => movement.ref_line_id)).size, 2)

    const stockRollup = await querySingle(ownerClient, 'growth_batches', 'accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,remaining_cost', [
      ['eq', 'id', stockBatch.batch_id],
    ])
    assert.equal(Number(stockRollup.accumulated_material_cost), 20.5)
    assert.equal(Number(stockRollup.accumulated_direct_cost), 0)
    assert.equal(Number(stockRollup.accumulated_total_cost), 20.5)
    assert.equal(Number(stockRollup.remaining_cost), 20.5)
    assert.deepEqual(await financeIsolationCounts(admin, companyId), financeBeforeStockInput)
    assert.deepEqual(await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]]), priceBeforeStockInput)

    const replayInput = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('post_growth_batch_stock_input', {
          p_batch_id: stockBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: stockInputLines,
          p_notes: 'Post governed stock input',
          p_request_key: `${PREFIX}-stock-input-post`,
        }),
        'Expected stock input replay to return original result',
      ),
    )
    assert.equal(replayInput.event_id, postedInput.event_id)
    assert.equal(await countRows(ownerClient, 'growth_batch_stock_inputs', [['eq', 'growth_batch_event_id', postedInput.event_id]]), 2)
    assert.equal(await stockMovementCount(ownerClient, companyId), movementBeforeStockInput + 2)
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: stockBatch.batch_id,
        p_effective_date: todayIso(),
        p_lines: [{ ...stockInputLines[0], quantity: 6 }, stockInputLines[1]],
        p_notes: 'Post governed stock input',
        p_request_key: `${PREFIX}-stock-input-post`,
      }),
      'idempotency_key_payload_mismatch',
    )

    const stockHistory = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_stock_input_history')
        .select('event_id,event_sequence,line_no,item_id,quantity,uom_id,uom_code,frozen_total_cost,reversal_status')
        .eq('growth_batch_id', stockBatch.batch_id)
        .order('event_sequence', { ascending: false })
        .order('line_no', { ascending: true }),
      'Expected stock input history to load',
    )
    assert.equal(stockHistory.length, 2)
    assert.equal(stockHistory.every((line) => line.event_id === postedInput.event_id && line.uom_id === kgUomId && line.uom_code === 'KG'), true)
    assert.equal(stockHistory.every((line) => line.reversal_status === 'not_reversed'), true)
    const stockTimeline = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_event_timeline')
        .select('id,event_sequence,event_type,material_cost_delta,total_cost_delta,typed_detail_summary')
        .eq('growth_batch_id', stockBatch.batch_id)
        .order('event_sequence', { ascending: true }),
      'Expected stock input timeline to load',
    )
    assert.equal(stockTimeline.some((event) => event.event_type === 'stock_input' && Number(event.material_cost_delta) === 20.5), true)

    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_stock_inputs').update({ quantity: 99 }).eq('id', stockInputDetails[0].id),
      'direct growth_batch_stock_inputs update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_stock_inputs').delete().eq('id', stockInputDetails[0].id),
      'direct growth_batch_stock_inputs delete',
    )

    await expectPostgrestError(
      operatorClient.rpc('reverse_growth_batch_stock_input', {
        p_original_event_id: postedInput.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Operator cannot reverse',
        p_request_key: `${PREFIX}-stock-input-reverse-operator`,
      }),
      'manager_role_required',
    )
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_stock_input', {
        p_original_event_id: postedInput.event_id,
        p_effective_date: addDaysIso(-1),
        p_reason: 'Reversal before original blocked',
        p_request_key: `${PREFIX}-stock-input-reverse-before`,
      }),
      'growth_batch_input_reversal_date_before_original',
    )
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_stock_input', {
        p_original_event_id: postedInput.event_id,
        p_effective_date: addDaysIso(1),
        p_reason: 'Future reversal blocked',
        p_request_key: `${PREFIX}-stock-input-reverse-future`,
      }),
      'growth_batch_input_date_in_future',
    )
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_stock_input', {
        p_original_event_id: postedInput.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Missing request key',
        p_request_key: null,
      }),
      'request_key_required',
    )
    const reversedInput = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('reverse_growth_batch_stock_input', {
          p_original_event_id: postedInput.event_id,
          p_effective_date: todayIso(),
          p_reason: 'Regression reversal',
          p_request_key: `${PREFIX}-stock-input-reverse`,
        }),
        'Expected stock input reversal to succeed',
      ),
    )
    assert.ok(reversedInput.event_id)
    assert.equal(reversedInput.event_type, 'stock_input_reversal')
    assert.equal(Number(reversedInput.material_cost_delta), -20.5)
    assert.equal(reversedInput.receipt_movements.length, 2)
    assert.equal(await stockMovementCount(ownerClient, companyId), movementBeforeStockInput + 4)
    const reversedRollup = await querySingle(ownerClient, 'growth_batches', 'accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,remaining_cost', [
      ['eq', 'id', stockBatch.batch_id],
    ])
    assert.equal(Number(reversedRollup.accumulated_material_cost), 0)
    assert.equal(Number(reversedRollup.accumulated_direct_cost), 0)
    assert.equal(Number(reversedRollup.accumulated_total_cost), 0)
    assert.equal(Number(reversedRollup.remaining_cost), 0)
    const reversalRows = expectNoSupabaseError(
      await ownerClient
        .from('growth_batch_stock_input_reversal_lines')
        .select('id,original_stock_input_id,receipt_movement_id,quantity,frozen_total_cost')
        .eq('reversal_event_id', reversedInput.event_id),
      'Expected reversal lines to load',
    )
    assert.equal(reversalRows.length, 2)
    assert.equal(new Set(reversalRows.map((row) => row.original_stock_input_id)).size, 2)
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_stock_input_reversal_lines').update({ quantity: 99 }).eq('id', reversalRows[0].id),
      'direct growth_batch_stock_input_reversal_lines update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_stock_input_reversal_lines').delete().eq('id', reversalRows[0].id),
      'direct growth_batch_stock_input_reversal_lines delete',
    )
    const reversalReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await ownerClient.rpc('reverse_growth_batch_stock_input', {
          p_original_event_id: postedInput.event_id,
          p_effective_date: todayIso(),
          p_reason: 'Regression reversal',
          p_request_key: `${PREFIX}-stock-input-reverse`,
        }),
        'Expected stock input reversal replay to return original result',
      ),
    )
    assert.equal(reversalReplay.event_id, reversedInput.event_id)
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_stock_input', {
        p_original_event_id: postedInput.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Second reversal blocked',
        p_request_key: `${PREFIX}-stock-input-reverse-again`,
      }),
      'growth_batch_stock_input_already_reversed',
    )

    const numericBatch = await createDraftBatch('stock-input-numeric')
    await activateDraftBatch(numericBatch, 'stock-input-numeric')
    const numericPost = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('post_growth_batch_stock_input', {
          p_batch_id: numericBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: [{ ...stockInputLines[0], quantity: 1 }],
          p_notes: null,
          p_request_key: `${PREFIX}-stock-input-numeric`,
        }),
        'Expected numeric stock input post to succeed',
      ),
    )
    const numericReplay = unwrapRpcSingle(
      expectNoSupabaseError(
        await operatorClient.rpc('post_growth_batch_stock_input', {
          p_batch_id: numericBatch.batch_id,
          p_effective_date: todayIso(),
          p_lines: [{ ...stockInputLines[0], quantity: '1.00' }],
          p_notes: null,
          p_request_key: `${PREFIX}-stock-input-numeric`,
        }),
        'Expected equivalent numeric stock input replay to succeed',
      ),
    )
    assert.equal(numericReplay.event_id, numericPost.event_id)

    const concurrentStockBatch = await createDraftBatch('stock-input-concurrent')
    await activateDraftBatch(concurrentStockBatch, 'stock-input-concurrent')
    const concurrentResults = await Promise.all([
      operatorClient.rpc('post_growth_batch_stock_input', {
        p_batch_id: concurrentStockBatch.batch_id,
        p_effective_date: todayIso(),
        p_lines: [{ ...stockInputLines[0], quantity: 1 }],
        p_notes: 'Concurrent stock input',
        p_request_key: `${PREFIX}-concurrent-stock-input`,
      }),
      operatorClient.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: concurrentStockBatch.batch_id,
        p_category: 'water',
        p_description: 'Concurrent direct cost with stock input',
        p_amount: 1.5,
        p_event_date: todayIso(),
        p_request_key: `${PREFIX}-concurrent-stock-direct-cost`,
      }),
    ])
    assert.equal(concurrentResults.every((result) => !result.error), true, 'Expected concurrent stock input/direct cost to succeed')
    const concurrentState = await querySingle(ownerClient, 'growth_batches', 'accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,remaining_cost,latest_event_sequence', [
      ['eq', 'id', concurrentStockBatch.batch_id],
    ])
    assert.equal(Number(concurrentState.accumulated_material_cost), 2.5)
    assert.equal(Number(concurrentState.accumulated_direct_cost), 1.5)
    assert.equal(Number(concurrentState.accumulated_total_cost), 4)
    assert.equal(Number(concurrentState.remaining_cost), 4)
    assert.equal(Number(concurrentState.latest_event_sequence), 3)

    const g3RequestRows = expectNoSupabaseError(
      await admin
        .from('posting_requests')
        .select('operation_type,request_key,status,result_ref_id')
        .eq('company_id', companyId)
        .in('operation_type', ['growth.batch.input', 'growth.batch.input.reverse']),
      'Expected Growth Batch stock input posting request rows to load',
    )
    assert.equal(g3RequestRows.every((row) => row.status === 'succeeded' && row.result_ref_id), true)
    assert.equal(new Set(g3RequestRows.map((row) => `${row.operation_type}:${row.request_key}`)).size, g3RequestRows.length)
  })
})
