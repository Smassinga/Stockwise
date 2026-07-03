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
const PREVIEW_TRANSFER_SIGNATURE = 'public.preview_growth_batch_transfer(uuid,uuid,text,text,date,text,text)'
const POST_TRANSFER_SIGNATURE = 'public.transfer_growth_batch(uuid,uuid,text,text,date,text,text,text,text)'
const REVERSE_TRANSFER_SIGNATURE = 'public.reverse_growth_batch_transfer(uuid,uuid,date,text,text,text)'
const NORMALIZE_LOCATION_SIGNATURE = 'public.growth_batch_normalize_location_description(text)'
const LOCATION_FINGERPRINT_SIGNATURE = 'public.growth_batch_location_fingerprint(uuid,uuid,uuid,text,text)'
const PREVIEW_HARVEST_SIGNATURE = 'public.preview_growth_batch_harvest(uuid,date,numeric,numeric,uuid,numeric,uuid,text,text)'
const POST_HARVEST_SIGNATURE = 'public.post_growth_batch_harvest(uuid,date,numeric,numeric,uuid,numeric,uuid,text,text,text,text)'
const REVERSE_HARVEST_SIGNATURE = 'public.reverse_growth_batch_harvest(uuid,date,text,text,text)'
const HARVEST_FINGERPRINT_SIGNATURE = 'public.growth_batch_harvest_state_fingerprint(uuid,uuid,text,uuid,text,text,numeric,numeric,numeric,numeric,numeric)'
const APPLY_HARVEST_UPDATE_SIGNATURE = 'public.apply_growth_batch_harvest_update(uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,uuid,integer)'
const VALIDATE_HARVEST_ROW_SIGNATURE = 'public.validate_growth_batch_harvest_row()'
const VALIDATE_HARVEST_REVERSAL_ROW_SIGNATURE = 'public.validate_growth_batch_harvest_reversal_row()'

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

test('Growth Batches G1-G5.1 authority, lifecycle, idempotency, stock inputs, losses, transfers, harvests, and read models', async (t) => {
  const admin = createAdminClient()
  const created = {
    companyIds: new Set(),
    userIds: new Set(),
    uomIds: new Set(),
  }

  async function cleanupCompany(companyId) {
    if (!companyId) return
    await admin.from('growth_batch_harvest_reversal_lines').delete().eq('company_id', companyId)
    await admin.from('growth_batch_harvests').delete().eq('company_id', companyId)
    await admin.from('growth_batch_transfer_reversal_lines').delete().eq('company_id', companyId)
    await admin.from('growth_batch_transfers').delete().eq('company_id', companyId)
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
  const managerUser = await createTempUser(admin, PREFIX, 'manager')
  const viewerUser = await createTempUser(admin, PREFIX, 'viewer')
  const crossOwnerUser = await createTempUser(admin, PREFIX, 'cross-owner')
  for (const user of [ownerUser, operatorUser, managerUser, viewerUser, crossOwnerUser]) created.userIds.add(user.userId)

  const ownerClient = await signIn(ownerUser.email, ownerUser.password)
  const operatorClient = await signIn(operatorUser.email, operatorUser.password)
  const managerClient = await signIn(managerUser.email, managerUser.password)
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

  for (const [user, role] of [[operatorUser, 'OPERATOR'], [managerUser, 'MANAGER'], [viewerUser, 'VIEWER']]) {
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
  await setActiveCompany(managerClient, companyId)
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

  const transferWarehouse = await ownerClient
    .from('warehouses')
    .insert({ company_id: companyId, code: `${PREFIX.toUpperCase()}-WH2`, name: `${PREFIX} Transfer House`, status: 'active' })
    .select('id')
    .single()
  throwSupabaseError(transferWarehouse.error, 'Growth Batch transfer warehouse setup failed')
  const transferWarehouseId = transferWarehouse.data.id
  const transferBin = await ownerClient
    .from('bins')
    .insert({
      id: `${PREFIX.toUpperCase()}-TBIN`,
      company_id: companyId,
      warehouseId: transferWarehouseId,
      code: 'TGBIN',
      name: 'Transfer bin',
      status: 'active',
    })
    .select('id')
    .single()
  throwSupabaseError(transferBin.error, 'Growth Batch transfer bin setup failed')
  const transferBinId = transferBin.data.id

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

  const harvestOutputItem = await ownerClient
    .from('items')
    .insert({
      company_id: companyId,
      sku: `${PREFIX.toUpperCase()}-HARVEST`,
      name: `${PREFIX} Harvest Output`,
      base_uom_id: kgUomId,
      min_stock: 0,
      unit_price: 88,
      primary_role: 'finished_good',
      track_inventory: true,
      can_buy: false,
      can_sell: true,
      is_assembled: false,
    })
    .select('id, unit_price')
    .single()
  throwSupabaseError(harvestOutputItem.error, 'Growth Batch harvest output item setup failed')
  const harvestOutputItemId = harvestOutputItem.data.id

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
        'growth_batch_loss_reversal_lines',
        'growth_batch_transfers',
        'growth_batch_transfer_reversal_lines',
        'growth_batch_harvests',
        'growth_batch_harvest_reversal_lines'
      )
      order by relname;
    `)
    assert.equal(schemaRows.length, 13, 'Expected all Growth Batch tables to exist')
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
        has_function_privilege('authenticated', '${REVERSE_LOSS_SIGNATURE}', 'EXECUTE') as auth_loss_reverse,
        has_function_privilege('public', '${NORMALIZE_LOCATION_SIGNATURE}', 'EXECUTE') as public_normalize_location,
        has_function_privilege('anon', '${NORMALIZE_LOCATION_SIGNATURE}', 'EXECUTE') as anon_normalize_location,
        has_function_privilege('authenticated', '${NORMALIZE_LOCATION_SIGNATURE}', 'EXECUTE') as auth_normalize_location,
        has_function_privilege('postgres', '${NORMALIZE_LOCATION_SIGNATURE}', 'EXECUTE') as owner_normalize_location,
        has_function_privilege('public', '${LOCATION_FINGERPRINT_SIGNATURE}', 'EXECUTE') as public_location_fingerprint,
        has_function_privilege('anon', '${LOCATION_FINGERPRINT_SIGNATURE}', 'EXECUTE') as anon_location_fingerprint,
        has_function_privilege('authenticated', '${LOCATION_FINGERPRINT_SIGNATURE}', 'EXECUTE') as auth_location_fingerprint,
        has_function_privilege('postgres', '${LOCATION_FINGERPRINT_SIGNATURE}', 'EXECUTE') as owner_location_fingerprint,
        has_function_privilege('public', '${PREVIEW_TRANSFER_SIGNATURE}', 'EXECUTE') as public_transfer_preview,
        has_function_privilege('anon', '${PREVIEW_TRANSFER_SIGNATURE}', 'EXECUTE') as anon_transfer_preview,
        has_function_privilege('authenticated', '${PREVIEW_TRANSFER_SIGNATURE}', 'EXECUTE') as auth_transfer_preview,
        has_function_privilege('public', '${POST_TRANSFER_SIGNATURE}', 'EXECUTE') as public_transfer_post,
        has_function_privilege('anon', '${POST_TRANSFER_SIGNATURE}', 'EXECUTE') as anon_transfer_post,
        has_function_privilege('authenticated', '${POST_TRANSFER_SIGNATURE}', 'EXECUTE') as auth_transfer_post,
        has_function_privilege('public', '${REVERSE_TRANSFER_SIGNATURE}', 'EXECUTE') as public_transfer_reverse,
        has_function_privilege('anon', '${REVERSE_TRANSFER_SIGNATURE}', 'EXECUTE') as anon_transfer_reverse,
        has_function_privilege('authenticated', '${REVERSE_TRANSFER_SIGNATURE}', 'EXECUTE') as auth_transfer_reverse,
        has_function_privilege('public', '${HARVEST_FINGERPRINT_SIGNATURE}', 'EXECUTE') as public_harvest_fingerprint,
        has_function_privilege('anon', '${HARVEST_FINGERPRINT_SIGNATURE}', 'EXECUTE') as anon_harvest_fingerprint,
        has_function_privilege('authenticated', '${HARVEST_FINGERPRINT_SIGNATURE}', 'EXECUTE') as auth_harvest_fingerprint,
        has_function_privilege('postgres', '${HARVEST_FINGERPRINT_SIGNATURE}', 'EXECUTE') as owner_harvest_fingerprint,
        has_function_privilege('public', '${APPLY_HARVEST_UPDATE_SIGNATURE}', 'EXECUTE') as public_apply_harvest_update,
        has_function_privilege('anon', '${APPLY_HARVEST_UPDATE_SIGNATURE}', 'EXECUTE') as anon_apply_harvest_update,
        has_function_privilege('authenticated', '${APPLY_HARVEST_UPDATE_SIGNATURE}', 'EXECUTE') as auth_apply_harvest_update,
        has_function_privilege('postgres', '${APPLY_HARVEST_UPDATE_SIGNATURE}', 'EXECUTE') as owner_apply_harvest_update,
        has_function_privilege('public', '${VALIDATE_HARVEST_ROW_SIGNATURE}', 'EXECUTE') as public_validate_harvest_row,
        has_function_privilege('anon', '${VALIDATE_HARVEST_ROW_SIGNATURE}', 'EXECUTE') as anon_validate_harvest_row,
        has_function_privilege('authenticated', '${VALIDATE_HARVEST_ROW_SIGNATURE}', 'EXECUTE') as auth_validate_harvest_row,
        has_function_privilege('postgres', '${VALIDATE_HARVEST_ROW_SIGNATURE}', 'EXECUTE') as owner_validate_harvest_row,
        has_function_privilege('public', '${VALIDATE_HARVEST_REVERSAL_ROW_SIGNATURE}', 'EXECUTE') as public_validate_harvest_reversal_row,
        has_function_privilege('anon', '${VALIDATE_HARVEST_REVERSAL_ROW_SIGNATURE}', 'EXECUTE') as anon_validate_harvest_reversal_row,
        has_function_privilege('authenticated', '${VALIDATE_HARVEST_REVERSAL_ROW_SIGNATURE}', 'EXECUTE') as auth_validate_harvest_reversal_row,
        has_function_privilege('postgres', '${VALIDATE_HARVEST_REVERSAL_ROW_SIGNATURE}', 'EXECUTE') as owner_validate_harvest_reversal_row,
        has_function_privilege('public', '${PREVIEW_HARVEST_SIGNATURE}', 'EXECUTE') as public_harvest_preview,
        has_function_privilege('anon', '${PREVIEW_HARVEST_SIGNATURE}', 'EXECUTE') as anon_harvest_preview,
        has_function_privilege('authenticated', '${PREVIEW_HARVEST_SIGNATURE}', 'EXECUTE') as auth_harvest_preview,
        has_function_privilege('public', '${POST_HARVEST_SIGNATURE}', 'EXECUTE') as public_harvest_post,
        has_function_privilege('anon', '${POST_HARVEST_SIGNATURE}', 'EXECUTE') as anon_harvest_post,
        has_function_privilege('authenticated', '${POST_HARVEST_SIGNATURE}', 'EXECUTE') as auth_harvest_post,
        has_function_privilege('public', '${REVERSE_HARVEST_SIGNATURE}', 'EXECUTE') as public_harvest_reverse,
        has_function_privilege('anon', '${REVERSE_HARVEST_SIGNATURE}', 'EXECUTE') as anon_harvest_reverse,
        has_function_privilege('authenticated', '${REVERSE_HARVEST_SIGNATURE}', 'EXECUTE') as auth_harvest_reverse;
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
    assert.equal(grantRows[0].public_normalize_location, false, 'PUBLIC must not execute growth_batch_normalize_location_description')
    assert.equal(grantRows[0].anon_normalize_location, false, 'anon must not execute growth_batch_normalize_location_description')
    assert.equal(grantRows[0].auth_normalize_location, false, 'authenticated must not execute growth_batch_normalize_location_description')
    assert.equal(grantRows[0].owner_normalize_location, true, 'function owner must retain growth_batch_normalize_location_description execution')
    assert.equal(grantRows[0].public_location_fingerprint, false, 'PUBLIC must not execute growth_batch_location_fingerprint')
    assert.equal(grantRows[0].anon_location_fingerprint, false, 'anon must not execute growth_batch_location_fingerprint')
    assert.equal(grantRows[0].auth_location_fingerprint, false, 'authenticated must not execute growth_batch_location_fingerprint')
    assert.equal(grantRows[0].owner_location_fingerprint, true, 'function owner must retain growth_batch_location_fingerprint execution')
    assert.equal(grantRows[0].public_transfer_preview, false, 'PUBLIC must not execute preview_growth_batch_transfer')
    assert.equal(grantRows[0].anon_transfer_preview, false, 'anon must not execute preview_growth_batch_transfer')
    assert.equal(grantRows[0].public_transfer_post, false, 'PUBLIC must not execute transfer_growth_batch')
    assert.equal(grantRows[0].anon_transfer_post, false, 'anon must not execute transfer_growth_batch')
    assert.equal(grantRows[0].public_transfer_reverse, false, 'PUBLIC must not execute reverse_growth_batch_transfer')
    assert.equal(grantRows[0].anon_transfer_reverse, false, 'anon must not execute reverse_growth_batch_transfer')
    assert.equal(grantRows[0].public_harvest_fingerprint, false, 'PUBLIC must not execute growth_batch_harvest_state_fingerprint')
    assert.equal(grantRows[0].anon_harvest_fingerprint, false, 'anon must not execute growth_batch_harvest_state_fingerprint')
    assert.equal(grantRows[0].auth_harvest_fingerprint, false, 'authenticated must not execute growth_batch_harvest_state_fingerprint')
    assert.equal(grantRows[0].owner_harvest_fingerprint, true, 'function owner must retain growth_batch_harvest_state_fingerprint execution')
    assert.equal(grantRows[0].public_apply_harvest_update, false, 'PUBLIC must not execute apply_growth_batch_harvest_update')
    assert.equal(grantRows[0].anon_apply_harvest_update, false, 'anon must not execute apply_growth_batch_harvest_update')
    assert.equal(grantRows[0].auth_apply_harvest_update, false, 'authenticated must not execute apply_growth_batch_harvest_update')
    assert.equal(grantRows[0].owner_apply_harvest_update, true, 'function owner must retain apply_growth_batch_harvest_update execution')
    assert.equal(grantRows[0].public_validate_harvest_row, false, 'PUBLIC must not execute validate_growth_batch_harvest_row')
    assert.equal(grantRows[0].anon_validate_harvest_row, false, 'anon must not execute validate_growth_batch_harvest_row')
    assert.equal(grantRows[0].auth_validate_harvest_row, false, 'authenticated must not execute validate_growth_batch_harvest_row')
    assert.equal(grantRows[0].owner_validate_harvest_row, true, 'function owner must retain validate_growth_batch_harvest_row execution')
    assert.equal(grantRows[0].public_validate_harvest_reversal_row, false, 'PUBLIC must not execute validate_growth_batch_harvest_reversal_row')
    assert.equal(grantRows[0].anon_validate_harvest_reversal_row, false, 'anon must not execute validate_growth_batch_harvest_reversal_row')
    assert.equal(grantRows[0].auth_validate_harvest_reversal_row, false, 'authenticated must not execute validate_growth_batch_harvest_reversal_row')
    assert.equal(grantRows[0].owner_validate_harvest_reversal_row, true, 'function owner must retain validate_growth_batch_harvest_reversal_row execution')
    assert.equal(grantRows[0].public_harvest_preview, false, 'PUBLIC must not execute preview_growth_batch_harvest')
    assert.equal(grantRows[0].anon_harvest_preview, false, 'anon must not execute preview_growth_batch_harvest')
    assert.equal(grantRows[0].public_harvest_post, false, 'PUBLIC must not execute post_growth_batch_harvest')
    assert.equal(grantRows[0].anon_harvest_post, false, 'anon must not execute post_growth_batch_harvest')
    assert.equal(grantRows[0].public_harvest_reverse, false, 'PUBLIC must not execute reverse_growth_batch_harvest')
    assert.equal(grantRows[0].anon_harvest_reverse, false, 'anon must not execute reverse_growth_batch_harvest')
    assert.equal(grantRows[0].auth_create, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_activate, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_measurement, true, 'authenticated users execute governed Growth Batch RPCs')
    assert.equal(grantRows[0].auth_stock_preview, true, 'authenticated users execute governed Growth Batch stock preview')
    assert.equal(grantRows[0].auth_stock_post, true, 'authenticated users execute governed Growth Batch stock posting')
    assert.equal(grantRows[0].auth_stock_reverse, true, 'authenticated users execute governed Growth Batch stock reversal')
    assert.equal(grantRows[0].auth_loss_preview, true, 'authenticated users execute governed Growth Batch loss preview')
    assert.equal(grantRows[0].auth_loss_record, true, 'authenticated users execute governed Growth Batch loss recording')
    assert.equal(grantRows[0].auth_loss_reverse, true, 'authenticated users execute governed Growth Batch loss reversal')
    assert.equal(grantRows[0].auth_transfer_preview, true, 'authenticated users execute governed Growth Batch transfer preview')
    assert.equal(grantRows[0].auth_transfer_post, true, 'authenticated users execute governed Growth Batch transfer posting')
    assert.equal(grantRows[0].auth_transfer_reverse, true, 'authenticated users execute governed Growth Batch transfer reversal')
    assert.equal(grantRows[0].auth_harvest_preview, true, 'authenticated users execute governed Growth Batch harvest preview')
    assert.equal(grantRows[0].auth_harvest_post, true, 'authenticated users execute governed Growth Batch harvest posting')
    assert.equal(grantRows[0].auth_harvest_reverse, true, 'authenticated users execute governed Growth Batch harvest reversal')

    const helperExecutionDenied = 'permission denied|could not find|not found|schema cache'
    await expectPostgrestError(
      operatorClient.rpc('growth_batch_normalize_location_description', { p_description: ' Direct helper call ' }),
      helperExecutionDenied,
    )
    await expectPostgrestError(
      anonClient.rpc('growth_batch_normalize_location_description', { p_description: ' Direct helper call ' }),
      helperExecutionDenied,
    )
    await expectPostgrestError(
      operatorClient.rpc('growth_batch_location_fingerprint', {
        p_company_id: companyId,
        p_growth_batch_id: companyId,
        p_warehouse_id: null,
        p_bin_id: null,
        p_location_description: ' Direct helper call ',
      }),
      helperExecutionDenied,
    )
    await expectPostgrestError(
      anonClient.rpc('growth_batch_location_fingerprint', {
        p_company_id: companyId,
        p_growth_batch_id: companyId,
        p_warehouse_id: null,
        p_bin_id: null,
        p_location_description: ' Direct helper call ',
      }),
      helperExecutionDenied,
    )
    await expectPostgrestError(
      operatorClient.rpc('growth_batch_harvest_state_fingerprint', {
        p_company_id: companyId,
        p_growth_batch_id: companyId,
        p_status: 'active',
        p_warehouse_id: null,
        p_bin_id: null,
        p_location_description: ' Direct helper call ',
        p_current_primary_qty: 1,
        p_current_total_weight: null,
        p_accumulated_total_cost: 0,
        p_harvested_cost: 0,
        p_remaining_cost: 0,
      }),
      helperExecutionDenied,
    )
    await expectPostgrestError(
      anonClient.rpc('growth_batch_harvest_state_fingerprint', {
        p_company_id: companyId,
        p_growth_batch_id: companyId,
        p_status: 'active',
        p_warehouse_id: null,
        p_bin_id: null,
        p_location_description: ' Direct helper call ',
        p_current_primary_qty: 1,
        p_current_total_weight: null,
        p_accumulated_total_cost: 0,
        p_harvested_cost: 0,
        p_remaining_cost: 0,
      }),
      helperExecutionDenied,
    )

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
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_transfers').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        event_id: '00000000-0000-0000-0000-000000000000',
        source_warehouse_id: warehouseId,
        destination_warehouse_id: transferWarehouseId,
        primary_quantity_basis: 'count',
        current_primary_qty: 1,
        primary_uom_id: eachUomId,
        accumulated_material_cost: 0,
        accumulated_direct_cost: 0,
        accumulated_total_cost: 0,
        harvested_cost: 0,
        remaining_cost: 0,
        transfer_reason: 'operational_move',
      }),
      'direct growth_batch_transfers insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_transfer_reversal_lines').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        reversal_event_id: '00000000-0000-0000-0000-000000000000',
        original_event_id: '00000000-0000-0000-0000-000000000000',
        original_transfer_id: '00000000-0000-0000-0000-000000000000',
        reversal_source_warehouse_id: transferWarehouseId,
        reversal_destination_warehouse_id: warehouseId,
        current_primary_qty: 1,
        primary_uom_id: eachUomId,
        accumulated_material_cost: 0,
        accumulated_direct_cost: 0,
        accumulated_total_cost: 0,
        harvested_cost: 0,
        remaining_cost: 0,
        reason: 'Direct mutation blocked',
      }),
      'direct growth_batch_transfer_reversal_lines insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_harvests').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        event_id: '00000000-0000-0000-0000-000000000000',
        harvest_kind: 'partial',
        harvested_primary_qty: 1,
        primary_uom_id: eachUomId,
        quantity_before: 2,
        quantity_after: 1,
        output_item_id: feedItemId,
        output_uom_id: kgUomId,
        output_quantity: 1,
        destination_warehouse_id: warehouseId,
        allocated_cost: 0,
        output_unit_cost: 0,
        accumulated_total_cost: 0,
        harvested_cost_before: 0,
        harvested_cost_after: 0,
        remaining_cost_before: 0,
        remaining_cost_after: 0,
        stock_receipt_movement_id: '00000000-0000-0000-0000-000000000000',
        source_state_fingerprint: 'blocked',
      }),
      'direct growth_batch_harvests insert',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_harvest_reversal_lines').insert({
        company_id: companyId,
        growth_batch_id: '00000000-0000-0000-0000-000000000000',
        reversal_event_id: '00000000-0000-0000-0000-000000000000',
        original_event_id: '00000000-0000-0000-0000-000000000000',
        original_harvest_id: '00000000-0000-0000-0000-000000000000',
        restored_primary_qty: 1,
        primary_uom_id: eachUomId,
        quantity_before: 1,
        quantity_after: 2,
        allocated_cost_restored: 0,
        harvested_cost_before: 0,
        harvested_cost_after: 0,
        remaining_cost_before: 0,
        remaining_cost_after: 0,
        output_item_id: feedItemId,
        output_uom_id: kgUomId,
        output_quantity: 1,
        destination_warehouse_id: warehouseId,
        stock_issue_movement_id: '00000000-0000-0000-0000-000000000000',
        reason: 'Direct mutation blocked',
      }),
      'direct growth_batch_harvest_reversal_lines insert',
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
    let harvestGuardError = null
    try {
      await runLocalSql(`
        with guard_context as (
          select set_config('stockwise.growth_batch_rpc', 'on', true) as enabled
        )
        update public.growth_batches
           set harvested_cost = harvested_cost + 1,
               remaining_cost = remaining_cost - 1
          from guard_context
         where id = '${countBatch.batch_id}'::uuid
           and company_id = '${companyId}'::uuid
           and guard_context.enabled = 'on'
        returning public.growth_batches.id;
      `)
    } catch (error) {
      harvestGuardError = error
    }
    assert.match(
      harvestGuardError?.message || '',
      /growth_batch_immutable/,
      'general Growth Batch RPC context alone must not authorize harvest cost allocation changes',
    )
    const guardCostRow = await querySingle(ownerClient, 'growth_batches', 'accumulated_total_cost, harvested_cost, remaining_cost', [
      ['eq', 'company_id', companyId],
      ['eq', 'id', countBatch.batch_id],
    ])
    assert.equal(Number(guardCostRow.accumulated_total_cost), 25.5)
    assert.equal(Number(guardCostRow.harvested_cost), 0)
    assert.equal(Number(guardCostRow.remaining_cost), 25.5)
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

  await t.test('G4.2 full-batch transfers, transfer reversals, and isolation', async () => {
    const transferBatch = await createActiveGrowthBatch('Transfer Batch', { openingQty: 20, openingWeight: 40 })
    const transferSnapshotSelect = 'status,warehouse_id,bin_id,location_description,current_primary_qty,current_total_weight,accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,harvested_cost,remaining_cost,latest_event_sequence'

    async function transferMutationSnapshot(batchId) {
      const [
        growthBatchCount,
        eventCount,
        transferCount,
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
        countRows(ownerClient, 'growth_batch_transfers', [['eq', 'growth_batch_id', batchId]]),
        countRows(ownerClient, 'growth_batch_transfer_reversal_lines', [['eq', 'growth_batch_id', batchId]]),
        countRows(admin, 'posting_requests', [['eq', 'company_id', companyId]]),
        stockMovementCount(admin, companyId),
        countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]]),
        financeIsolationCounts(admin, companyId),
        querySingle(ownerClient, 'growth_batches', transferSnapshotSelect, [['eq', 'id', batchId]]),
        querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]]),
      ])
      return {
        growthBatchCount,
        eventCount,
        transferCount,
        reversalCount,
        postingRequestCount,
        movementCount,
        stockLevelCount,
        financeCounts,
        batch,
        itemPrice,
      }
    }

    function previewBlockerCodes(preview) {
      return (preview.blocking_reasons ?? []).map((reason) => reason.code)
    }

    async function assertTransferPreviewNonMutation(batchId, before, label) {
      assert.deepEqual(await transferMutationSnapshot(batchId), before, `${label} preview must not mutate database state`)
    }

    async function expectTransferPreviewBlocker(payload, expectedCode, label) {
      const before = await transferMutationSnapshot(payload.p_growth_batch_id)
      const preview = unwrapRpcSingle(expectNoSupabaseError(
        await operatorClient.rpc('preview_growth_batch_transfer', payload),
        `Expected ${label} transfer preview to return blockers`,
      ))
      assert.equal(preview.ready, false, `${label} preview must not be ready`)
      assert.equal(previewBlockerCodes(preview).includes(expectedCode), true, `${label} preview must include ${expectedCode}`)
      await assertTransferPreviewNonMutation(payload.p_growth_batch_id, before, `${label} transfer`)
      return preview
    }

    const transferPayload = {
      p_growth_batch_id: transferBatch.batch_id,
      p_destination_warehouse_id: transferWarehouseId,
      p_destination_bin_id: transferBinId,
      p_location_description: 'Transfer pen B',
      p_effective_date: todayIso(),
      p_transfer_reason: 'operational_move',
      p_notes: 'Controlled transfer test',
    }

    await expectPostgrestError(
      viewerClient.rpc('preview_growth_batch_transfer', transferPayload),
      'operator_role_required',
    )
    await expectPostgrestError(
      crossOwnerClient.rpc('preview_growth_batch_transfer', transferPayload),
      'growth_batch_not_found',
    )

    const previewBefore = await transferMutationSnapshot(transferBatch.batch_id)
    const preview = unwrapRpcSingle(expectNoSupabaseError(
      await operatorClient.rpc('preview_growth_batch_transfer', transferPayload),
      'Expected transfer preview to succeed',
    ))
    assert.equal(preview.ready, true)
    assert.deepEqual(previewBlockerCodes(preview), [])
    assert.equal(preview.full_batch_transfer, true)
    assert.equal(preview.source_location_fingerprint.length, 32)
    assert.equal(preview.source_location.warehouse_id, warehouseId)
    assert.equal(preview.source_location.bin_id, binId)
    assert.equal(preview.destination_location.warehouse_id, transferWarehouseId)
    assert.equal(preview.destination_location.bin_id, transferBinId)
    assert.equal(Number(preview.current_quantity), 20)
    assert.equal(Number(preview.current_total_weight), 40)
    assert.equal(Number(preview.current_material_cost), 0)
    assert.equal(Number(preview.current_direct_cost), 0)
    assert.equal(Number(preview.projected_material_cost), 0)
    assert.equal(Number(preview.projected_direct_cost), 0)
    assert.equal(preview.stock_ledger_effect, 'not_affected')
    assert.equal(preview.finance_effect, 'not_affected')
    assert.equal(preview.cost_effect, 'unchanged')
    await assertTransferPreviewNonMutation(transferBatch.batch_id, previewBefore, 'Valid transfer')

    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_destination_warehouse_id: warehouseId,
      p_destination_bin_id: binId,
      p_location_description: null,
    }, 'growth_batch_transfer_same_location', 'same destination')

    const noSourceBatch = await createActiveGrowthBatch('Transfer No Source Batch', { openingQty: 5, openingWeight: 10, warehouse: null, bin: null })
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_growth_batch_id: noSourceBatch.batch_id,
    }, 'source_location_not_canonical', 'missing source location')

    const zeroQuantityBatch = await createActiveGrowthBatch('Transfer Zero Quantity Batch', { openingQty: 1, openingWeight: 2 })
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: zeroQuantityBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 1,
      p_weight_lost: null,
      p_reason_code: 'disease',
      p_notes: null,
      p_request_key: `${PREFIX}-transfer-zero-loss`,
    }))
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_growth_batch_id: zeroQuantityBatch.batch_id,
    }, 'growth_batch_transfer_empty_batch', 'zero current quantity')

    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_effective_date: addDaysIso(-1),
    }, 'growth_batch_transfer_date_before_start', 'before-start transfer date')
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_effective_date: addDaysIso(7),
    }, 'growth_batch_transfer_date_in_future', 'future transfer date')
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_transfer_reason: 'unsupported_reason',
    }, 'growth_batch_transfer_reason_invalid', 'invalid transfer purpose')
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_transfer_reason: 'other',
      p_notes: '',
    }, 'growth_batch_transfer_notes_required', 'other transfer without notes')

    const inactiveWarehouse = await ownerClient
      .from('warehouses')
      .insert({ company_id: companyId, code: `${PREFIX.toUpperCase()}-INWH`, name: `${PREFIX} Inactive WH`, status: 'inactive' })
      .select('id')
      .single()
    throwSupabaseError(inactiveWarehouse.error, 'inactive transfer warehouse setup failed')
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_destination_warehouse_id: inactiveWarehouse.data.id,
      p_destination_bin_id: null,
    }, 'destination_warehouse_inactive', 'inactive destination warehouse')

    const inactiveBin = await ownerClient
      .from('bins')
      .insert({
        id: `${PREFIX.toUpperCase()}-INBIN`,
        company_id: companyId,
        warehouseId: transferWarehouseId,
        code: 'INBIN',
        name: 'Inactive transfer bin',
        status: 'inactive',
      })
      .select('id')
      .single()
    throwSupabaseError(inactiveBin.error, 'inactive transfer bin setup failed')
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_destination_bin_id: inactiveBin.data.id,
    }, 'destination_bin_inactive', 'inactive destination bin')

    const transferCrossCompany = unwrapRpcSingle(expectNoSupabaseError(
      await crossOwnerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Transfer Cross Company` }),
      'Expected transfer cross company bootstrap to succeed',
    ))
    created.companyIds.add(transferCrossCompany.out_company_id)
    await setActiveCompany(crossOwnerClient, transferCrossCompany.out_company_id)
    const crossWarehouse = await crossOwnerClient
      .from('warehouses')
      .insert({ company_id: transferCrossCompany.out_company_id, code: `${PREFIX.toUpperCase()}-TCWH`, name: 'Transfer cross warehouse', status: 'active' })
      .select('id')
      .single()
    throwSupabaseError(crossWarehouse.error, 'transfer cross warehouse setup failed')
    await setActiveCompany(crossOwnerClient, transferCrossCompany.out_company_id)
    await expectTransferPreviewBlocker({
      ...transferPayload,
      p_destination_warehouse_id: crossWarehouse.data.id,
      p_destination_bin_id: null,
    }, 'destination_warehouse_invalid', 'cross-company destination warehouse')
    await setActiveCompany(ownerClient, companyId)

    await expectPostgrestError(
      operatorClient.rpc('transfer_growth_batch', {
        ...transferPayload,
        p_expected_source_fingerprint: null,
        p_request_key: `${PREFIX}-transfer-missing-fingerprint`,
      }),
      'growth_batch_transfer_source_fingerprint_required',
    )

    const transferBefore = await transferMutationSnapshot(transferBatch.batch_id)
    const postedTransfer = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('transfer_growth_batch', {
      ...transferPayload,
      p_expected_source_fingerprint: preview.source_location_fingerprint,
      p_request_key: `${PREFIX}-transfer-post`,
    }), 'Expected transfer posting to succeed'))
    assert.equal(postedTransfer.event_type, 'transfer')
    assert.equal(postedTransfer.event_sequence, Number(transferBefore.batch.latest_event_sequence) + 1)
    assert.equal(postedTransfer.transfer_detail_id.length, 36)
    assert.equal(postedTransfer.request_status, 'succeeded')
    assert.equal(Number(postedTransfer.current_quantity), 20)
    assert.equal(Number(postedTransfer.current_total_weight), 40)

    const afterTransfer = await querySingle(ownerClient, 'growth_batches', transferSnapshotSelect, [['eq', 'id', transferBatch.batch_id]])
    assert.equal(afterTransfer.warehouse_id, transferWarehouseId)
    assert.equal(afterTransfer.bin_id, transferBinId)
    assert.equal(afterTransfer.location_description, 'Transfer pen B')
    assert.equal(Number(afterTransfer.current_primary_qty), Number(transferBefore.batch.current_primary_qty))
    assert.equal(Number(afterTransfer.current_total_weight), Number(transferBefore.batch.current_total_weight))
    assert.equal(Number(afterTransfer.accumulated_material_cost), Number(transferBefore.batch.accumulated_material_cost))
    assert.equal(Number(afterTransfer.accumulated_direct_cost), Number(transferBefore.batch.accumulated_direct_cost))
    assert.equal(Number(afterTransfer.accumulated_total_cost), Number(transferBefore.batch.accumulated_total_cost))
    assert.equal(Number(afterTransfer.harvested_cost), Number(transferBefore.batch.harvested_cost))
    assert.equal(Number(afterTransfer.remaining_cost), Number(transferBefore.batch.remaining_cost))
    assert.equal(await stockMovementCount(admin, companyId), transferBefore.movementCount, 'Transfer must not create stock movements')
    assert.equal(await countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]]), transferBefore.stockLevelCount, 'Transfer must not change stock levels')
    assert.deepEqual(await financeIsolationCounts(admin, companyId), transferBefore.financeCounts)
    assert.deepEqual(await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]]), transferBefore.itemPrice)

    const transferReplay = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('transfer_growth_batch', {
      ...transferPayload,
      p_expected_source_fingerprint: preview.source_location_fingerprint,
      p_request_key: `${PREFIX}-transfer-post`,
    }), 'Expected transfer replay to return original result'))
    assert.equal(transferReplay.event_id, postedTransfer.event_id)
    await expectPostgrestError(
      operatorClient.rpc('transfer_growth_batch', {
        ...transferPayload,
        p_location_description: 'Changed location note',
        p_expected_source_fingerprint: preview.source_location_fingerprint,
        p_request_key: `${PREFIX}-transfer-post`,
      }),
      'idempotency_key_payload_mismatch',
    )
    await expectPostgrestError(
      operatorClient.rpc('transfer_growth_batch', {
        p_growth_batch_id: transferBatch.batch_id,
        p_destination_warehouse_id: warehouseId,
        p_destination_bin_id: binId,
        p_location_description: null,
        p_effective_date: todayIso(),
        p_transfer_reason: 'operational_move',
        p_notes: null,
        p_expected_source_fingerprint: preview.source_location_fingerprint,
        p_request_key: `${PREFIX}-transfer-stale-source`,
      }),
      'growth_batch_transfer_source_changed',
    )

    const transferRows = expectNoSupabaseError(
      await ownerClient.from('growth_batch_transfer_history').select('*').eq('growth_batch_id', transferBatch.batch_id).order('event_sequence', { ascending: true }),
      'Expected transfer history to load',
    )
    assert.equal(transferRows.length, 1)
    assert.equal(transferRows[0].event_id, postedTransfer.event_id)
    assert.equal(transferRows[0].source_warehouse_id, warehouseId)
    assert.equal(transferRows[0].destination_warehouse_id, transferWarehouseId)
    assert.equal(transferRows[0].reversal_eligible, true)
    const timelineTransfer = expectNoSupabaseError(
      await ownerClient.from('growth_batch_event_timeline').select('event_type,typed_detail_summary').eq('id', postedTransfer.event_id),
      'Expected transfer timeline row to load',
    )
    assert.equal(timelineTransfer.length, 1)
    assert.equal(timelineTransfer[0].event_type, 'transfer')
    assert.equal(timelineTransfer[0].typed_detail_summary?.destination_warehouse_id, transferWarehouseId)

    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_transfers').update({ transfer_reason: 'maintenance' }).eq('id', postedTransfer.transfer_detail_id),
      'direct growth_batch_transfers update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_transfers').delete().eq('id', postedTransfer.transfer_detail_id),
      'direct growth_batch_transfers delete',
    )

    await expectPostgrestError(
      operatorClient.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: transferBatch.batch_id,
        p_original_event_id: postedTransfer.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Operator cannot reverse transfer',
        p_expected_current_location_fingerprint: transferRows[0].current_location_fingerprint,
        p_request_key: `${PREFIX}-transfer-operator-reverse`,
      }),
      'manager_role_required',
    )
    await expectPostgrestError(
      managerClient.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: transferBatch.batch_id,
        p_original_event_id: postedTransfer.event_id,
        p_effective_date: todayIso(),
        p_reason: '',
        p_expected_current_location_fingerprint: transferRows[0].current_location_fingerprint,
        p_request_key: `${PREFIX}-transfer-reverse-missing-reason`,
      }),
      'reversal_reason_required',
    )

    const originalTransferBeforeReverse = await querySingle(ownerClient, 'growth_batch_transfers', '*', [['eq', 'event_id', postedTransfer.event_id]])
    const reverseBefore = await transferMutationSnapshot(transferBatch.batch_id)
    const reversedTransfer = unwrapRpcSingle(expectNoSupabaseError(await managerClient.rpc('reverse_growth_batch_transfer', {
      p_growth_batch_id: transferBatch.batch_id,
      p_original_event_id: postedTransfer.event_id,
      p_effective_date: todayIso(),
      p_reason: 'Controlled transfer reversal',
      p_expected_current_location_fingerprint: transferRows[0].current_location_fingerprint,
      p_request_key: `${PREFIX}-transfer-reverse`,
    }), 'Expected transfer reversal to succeed'))
    assert.equal(reversedTransfer.event_type, 'transfer_reversal')
    assert.equal(reversedTransfer.original_event_id, postedTransfer.event_id)
    assert.equal(reversedTransfer.request_status, 'succeeded')
    const afterReverse = await querySingle(ownerClient, 'growth_batches', transferSnapshotSelect, [['eq', 'id', transferBatch.batch_id]])
    assert.equal(afterReverse.warehouse_id, warehouseId)
    assert.equal(afterReverse.bin_id, binId)
    assert.equal(afterReverse.location_description, null)
    assert.equal(Number(afterReverse.current_primary_qty), Number(reverseBefore.batch.current_primary_qty))
    assert.equal(Number(afterReverse.current_total_weight), Number(reverseBefore.batch.current_total_weight))
    assert.equal(Number(afterReverse.accumulated_material_cost), Number(reverseBefore.batch.accumulated_material_cost))
    assert.equal(Number(afterReverse.accumulated_direct_cost), Number(reverseBefore.batch.accumulated_direct_cost))
    assert.equal(Number(afterReverse.accumulated_total_cost), Number(reverseBefore.batch.accumulated_total_cost))
    assert.equal(Number(afterReverse.harvested_cost), Number(reverseBefore.batch.harvested_cost))
    assert.equal(Number(afterReverse.remaining_cost), Number(reverseBefore.batch.remaining_cost))
    assert.equal(await stockMovementCount(admin, companyId), reverseBefore.movementCount, 'Transfer reversal must not create stock movements')
    assert.equal(await countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]]), reverseBefore.stockLevelCount, 'Transfer reversal must not change stock levels')
    assert.deepEqual(await financeIsolationCounts(admin, companyId), reverseBefore.financeCounts)
    assert.deepEqual(await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', priceItem.data.id]]), reverseBefore.itemPrice)
    assert.deepEqual(await querySingle(ownerClient, 'growth_batch_transfers', '*', [['eq', 'event_id', postedTransfer.event_id]]), originalTransferBeforeReverse)

    const reversedTransferReplay = unwrapRpcSingle(expectNoSupabaseError(await managerClient.rpc('reverse_growth_batch_transfer', {
      p_growth_batch_id: transferBatch.batch_id,
      p_original_event_id: postedTransfer.event_id,
      p_effective_date: todayIso(),
      p_reason: 'Controlled transfer reversal',
      p_expected_current_location_fingerprint: transferRows[0].current_location_fingerprint,
      p_request_key: `${PREFIX}-transfer-reverse`,
    }), 'Expected transfer reversal replay to return original result'))
    assert.equal(reversedTransferReplay.event_id, reversedTransfer.event_id)
    await expectPostgrestError(
      managerClient.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: transferBatch.batch_id,
        p_original_event_id: postedTransfer.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Changed transfer reversal reason',
        p_expected_current_location_fingerprint: transferRows[0].current_location_fingerprint,
        p_request_key: `${PREFIX}-transfer-reverse`,
      }),
      'idempotency_key_payload_mismatch',
    )
    await expectPostgrestError(
      managerClient.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: transferBatch.batch_id,
        p_original_event_id: postedTransfer.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Second transfer reversal',
        p_expected_current_location_fingerprint: transferRows[0].current_location_fingerprint,
        p_request_key: `${PREFIX}-transfer-reverse-second`,
      }),
      'growth_batch_transfer_already_reversed',
    )
    const transferReversalRows = expectNoSupabaseError(
      await ownerClient.from('growth_batch_transfer_reversal_lines').select('*').eq('original_event_id', postedTransfer.event_id),
      'Expected transfer reversal detail to load',
    )
    assert.equal(transferReversalRows.length, 1)
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_transfer_reversal_lines').update({ reason: 'mutate' }).eq('id', transferReversalRows[0].id),
      'direct growth_batch_transfer_reversal_lines update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_transfer_reversal_lines').delete().eq('id', transferReversalRows[0].id),
      'direct growth_batch_transfer_reversal_lines delete',
    )

    const nonLocationDependencyBatch = await createActiveGrowthBatch('Transfer Non Location Dependency Batch', { openingQty: 10, openingWeight: 20 })
    const nonLocationPreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_transfer', {
      ...transferPayload,
      p_growth_batch_id: nonLocationDependencyBatch.batch_id,
      p_notes: 'Non-location dependency transfer',
    })))
    const nonLocationTransfer = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('transfer_growth_batch', {
      ...transferPayload,
      p_growth_batch_id: nonLocationDependencyBatch.batch_id,
      p_notes: 'Non-location dependency transfer',
      p_expected_source_fingerprint: nonLocationPreview.source_location_fingerprint,
      p_request_key: `${PREFIX}-transfer-non-location-post`,
    })))
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_measurement', {
      p_company_id: companyId,
      p_growth_batch_id: nonLocationDependencyBatch.batch_id,
      p_measurement_type: 'total_weight',
      p_value: 18,
      p_uom_id: kgUomId,
      p_observed_at: new Date().toISOString(),
      p_sample_size: null,
      p_minimum: null,
      p_maximum: null,
      p_average: null,
      p_description: null,
      p_notes: null,
      p_request_key: `${PREFIX}-transfer-later-measurement`,
      p_sample_size_present: false,
      p_minimum_present: false,
      p_maximum_present: false,
      p_average_present: false,
    }))
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_direct_cost', {
      p_company_id: companyId,
      p_growth_batch_id: nonLocationDependencyBatch.batch_id,
      p_category: 'transport',
      p_description: 'Transport expense remains direct cost',
      p_amount: 2,
      p_event_date: todayIso(),
      p_notes: null,
      p_request_key: `${PREFIX}-transfer-later-direct-cost`,
    }))
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: nonLocationDependencyBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 1,
      p_weight_lost: null,
      p_reason_code: 'handling',
      p_notes: null,
      p_request_key: `${PREFIX}-transfer-later-loss`,
    }))
    expectNoSupabaseError(await operatorClient.rpc('post_growth_batch_stock_input', {
      p_batch_id: nonLocationDependencyBatch.batch_id,
      p_effective_date: todayIso(),
      p_lines: [{
        item_id: feedItemId,
        uom_id: kgUomId,
        quantity: 1,
        source_warehouse_id: warehouseId,
        source_bin_id: binId,
        line_notes: null,
      }],
      p_notes: 'Transfer reversal stock input dependency control',
      p_request_key: `${PREFIX}-transfer-later-stock-input`,
    }))
    const nonLocationHistory = expectNoSupabaseError(
      await ownerClient.from('growth_batch_transfer_history').select('*').eq('event_id', nonLocationTransfer.event_id),
      'Expected non-location transfer history to load',
    )
    assert.equal(nonLocationHistory.length, 1)
    const nonLocationReverse = unwrapRpcSingle(expectNoSupabaseError(await ownerClient.rpc('reverse_growth_batch_transfer', {
      p_growth_batch_id: nonLocationDependencyBatch.batch_id,
      p_original_event_id: nonLocationTransfer.event_id,
      p_effective_date: todayIso(),
      p_reason: 'Later non-location events do not block',
      p_expected_current_location_fingerprint: nonLocationHistory[0].current_location_fingerprint,
      p_request_key: `${PREFIX}-transfer-non-location-reverse`,
    }), 'Expected later non-location events not to block transfer reversal'))
    assert.equal(nonLocationReverse.event_type, 'transfer_reversal')
    const nonLocationState = await querySingle(ownerClient, 'growth_batches', 'warehouse_id,bin_id,current_primary_qty,current_total_weight', [['eq', 'id', nonLocationDependencyBatch.batch_id]])
    assert.equal(nonLocationState.warehouse_id, warehouseId)
    assert.equal(nonLocationState.bin_id, binId)
    assert.equal(Number(nonLocationState.current_primary_qty), 9)
    assert.equal(Number(nonLocationState.current_total_weight), 18)

    const olderTransferBatch = await createActiveGrowthBatch('Transfer Older Dependency Batch', { openingQty: 10, openingWeight: 12 })
    const olderPreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_transfer', {
      ...transferPayload,
      p_growth_batch_id: olderTransferBatch.batch_id,
      p_notes: 'Older transfer dependency',
    })))
    const olderTransfer = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('transfer_growth_batch', {
      ...transferPayload,
      p_growth_batch_id: olderTransferBatch.batch_id,
      p_notes: 'Older transfer dependency',
      p_expected_source_fingerprint: olderPreview.source_location_fingerprint,
      p_request_key: `${PREFIX}-older-transfer-first`,
    })))
    const secondPreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_transfer', {
      p_growth_batch_id: olderTransferBatch.batch_id,
      p_destination_warehouse_id: warehouseId,
      p_destination_bin_id: binId,
      p_location_description: null,
      p_effective_date: todayIso(),
      p_transfer_reason: 'space_management',
      p_notes: 'Later location transfer',
    })))
    expectNoSupabaseError(await operatorClient.rpc('transfer_growth_batch', {
      p_growth_batch_id: olderTransferBatch.batch_id,
      p_destination_warehouse_id: warehouseId,
      p_destination_bin_id: binId,
      p_location_description: null,
      p_effective_date: todayIso(),
      p_transfer_reason: 'space_management',
      p_notes: 'Later location transfer',
      p_expected_source_fingerprint: secondPreview.source_location_fingerprint,
      p_request_key: `${PREFIX}-older-transfer-second`,
    }))
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: olderTransferBatch.batch_id,
        p_original_event_id: olderTransfer.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Older transfer blocked',
        p_expected_current_location_fingerprint: secondPreview.source_location_fingerprint,
        p_request_key: `${PREFIX}-older-transfer-reverse`,
      }),
      'growth_batch_transfer_reversal_dependency_exists',
    )

    const sourceInactiveWarehouse = await ownerClient
      .from('warehouses')
      .insert({ company_id: companyId, code: `${PREFIX.toUpperCase()}-SRCIN`, name: `${PREFIX} Source Inactive`, status: 'active' })
      .select('id')
      .single()
    throwSupabaseError(sourceInactiveWarehouse.error, 'source inactive warehouse setup failed')
    const sourceInactiveBin = await ownerClient
      .from('bins')
      .insert({
        id: `${PREFIX.toUpperCase()}-SRCBIN`,
        company_id: companyId,
        warehouseId: sourceInactiveWarehouse.data.id,
        code: 'SRCBIN',
        name: 'Source inactive bin',
        status: 'active',
      })
      .select('id')
      .single()
    throwSupabaseError(sourceInactiveBin.error, 'source inactive bin setup failed')
    const inactiveSourceBatch = await createActiveGrowthBatch('Transfer Inactive Source Batch', {
      openingQty: 6,
      openingWeight: 9,
      warehouse: sourceInactiveWarehouse.data.id,
      bin: sourceInactiveBin.data.id,
    })
    const inactiveSourcePreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_transfer', {
      ...transferPayload,
      p_growth_batch_id: inactiveSourceBatch.batch_id,
      p_notes: 'Inactive original source setup',
    })))
    const inactiveSourceTransfer = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('transfer_growth_batch', {
      ...transferPayload,
      p_growth_batch_id: inactiveSourceBatch.batch_id,
      p_notes: 'Inactive original source setup',
      p_expected_source_fingerprint: inactiveSourcePreview.source_location_fingerprint,
      p_request_key: `${PREFIX}-inactive-source-transfer`,
    })))
    const inactiveSourceHistory = expectNoSupabaseError(
      await ownerClient.from('growth_batch_transfer_history').select('*').eq('event_id', inactiveSourceTransfer.event_id),
      'Expected inactive-source transfer history to load',
    )
    expectNoSupabaseError(await ownerClient.from('warehouses').update({ status: 'inactive' }).eq('id', sourceInactiveWarehouse.data.id))
    await expectPostgrestError(
      ownerClient.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: inactiveSourceBatch.batch_id,
        p_original_event_id: inactiveSourceTransfer.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Original source inactive',
        p_expected_current_location_fingerprint: inactiveSourceHistory[0].current_location_fingerprint,
        p_request_key: `${PREFIX}-inactive-source-reverse`,
      }),
      'growth_batch_transfer_original_source_inactive',
    )

    const concurrentDestinationWarehouse = await ownerClient
      .from('warehouses')
      .insert({ company_id: companyId, code: `${PREFIX.toUpperCase()}-CWH`, name: `${PREFIX} Concurrent Transfer`, status: 'active' })
      .select('id')
      .single()
    throwSupabaseError(concurrentDestinationWarehouse.error, 'concurrent transfer destination setup failed')
    const concurrentTransferBatch = await createActiveGrowthBatch('Concurrent Transfer Batch', { openingQty: 5, openingWeight: 8 })
    const concurrentPreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_transfer', {
      ...transferPayload,
      p_growth_batch_id: concurrentTransferBatch.batch_id,
      p_location_description: 'Concurrent A',
    })))
    const concurrentResults = await Promise.all([
      operatorClient.rpc('transfer_growth_batch', {
        ...transferPayload,
        p_growth_batch_id: concurrentTransferBatch.batch_id,
        p_location_description: 'Concurrent A',
        p_expected_source_fingerprint: concurrentPreview.source_location_fingerprint,
        p_request_key: `${PREFIX}-concurrent-transfer-a`,
      }),
      ownerClient.rpc('transfer_growth_batch', {
        p_growth_batch_id: concurrentTransferBatch.batch_id,
        p_destination_warehouse_id: concurrentDestinationWarehouse.data.id,
        p_destination_bin_id: null,
        p_location_description: 'Concurrent B',
        p_effective_date: todayIso(),
        p_transfer_reason: 'operational_move',
        p_notes: 'Concurrent transfer B',
        p_expected_source_fingerprint: concurrentPreview.source_location_fingerprint,
        p_request_key: `${PREFIX}-concurrent-transfer-b`,
      }),
    ])
    assert.equal(concurrentResults.filter((result) => !result.error).length, 1, 'Only one competing transfer should succeed')
    assert.equal(concurrentResults.filter((result) => result.error).length, 1, 'One competing transfer should fail stale-source validation')
    const concurrentEvents = expectNoSupabaseError(
      await ownerClient.from('growth_batch_events').select('event_sequence,event_type').eq('growth_batch_id', concurrentTransferBatch.batch_id),
      'Expected concurrent transfer events to load',
    )
    assert.equal(new Set(concurrentEvents.map((event) => event.event_sequence)).size, concurrentEvents.length, 'Concurrent transfer events must not duplicate sequence numbers')
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

  await t.test('G5.1 depleting harvests, event-specific reversals, and isolation', async () => {
    const harvestBatch = await createActiveGrowthBatch('Harvest Batch', { openingQty: 10, openingWeight: 20 })
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_direct_cost', {
      p_company_id: companyId,
      p_growth_batch_id: harvestBatch.batch_id,
      p_category: 'labour',
      p_description: 'Harvest cost pool',
      p_amount: 100,
      p_event_date: todayIso(),
      p_notes: null,
      p_request_key: `${PREFIX}-harvest-cost-pool`,
    }), 'Expected harvest cost-pool setup to succeed')

    const harvestSnapshotSelect = 'status,warehouse_id,bin_id,location_description,current_primary_qty,current_total_weight,accumulated_material_cost,accumulated_direct_cost,accumulated_total_cost,harvested_cost,remaining_cost,latest_event_sequence'
    async function harvestMutationSnapshot(batchId) {
      const [
        eventCount,
        harvestCount,
        reversalCount,
        postingRequestCount,
        movementCount,
        stockLevelCount,
        financeCounts,
        batch,
        outputPrice,
      ] = await Promise.all([
        countRows(ownerClient, 'growth_batch_events', [['eq', 'growth_batch_id', batchId]]),
        countRows(ownerClient, 'growth_batch_harvests', [['eq', 'growth_batch_id', batchId]]),
        countRows(ownerClient, 'growth_batch_harvest_reversal_lines', [['eq', 'growth_batch_id', batchId]]),
        countRows(admin, 'posting_requests', [['eq', 'company_id', companyId]]),
        stockMovementCount(admin, companyId),
        countRows(ownerClient, 'stock_levels', [['eq', 'company_id', companyId]]),
        financeIsolationCounts(admin, companyId),
        querySingle(ownerClient, 'growth_batches', harvestSnapshotSelect, [['eq', 'id', batchId]]),
        querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', harvestOutputItemId]]),
      ])
      return { eventCount, harvestCount, reversalCount, postingRequestCount, movementCount, stockLevelCount, financeCounts, batch, outputPrice }
    }

    async function assertHarvestPreviewNonMutation(batchId, before, label) {
      assert.deepEqual(await harvestMutationSnapshot(batchId), before, `${label} preview must not mutate database state`)
    }

    const harvestPayload = {
      p_growth_batch_id: harvestBatch.batch_id,
      p_effective_date: todayIso(),
      p_harvested_primary_qty: 4,
      p_harvested_total_weight: 8,
      p_output_item_id: harvestOutputItemId,
      p_output_quantity: 6,
      p_destination_warehouse_id: transferWarehouseId,
      p_destination_bin_id: transferBinId,
      p_notes: 'Controlled partial harvest',
    }

    await expectPostgrestError(
      viewerClient.rpc('preview_growth_batch_harvest', harvestPayload),
      'operator_role_required',
    )

    const previewBefore = await harvestMutationSnapshot(harvestBatch.batch_id)
    const harvestPreview = unwrapRpcSingle(expectNoSupabaseError(
      await operatorClient.rpc('preview_growth_batch_harvest', harvestPayload),
      'Expected harvest preview to succeed',
    ))
    assert.equal(harvestPreview.ready, true)
    assert.deepEqual(harvestPreview.blocking_reasons, [])
    assert.equal(harvestPreview.harvest_kind, 'partial')
    assert.equal(Number(harvestPreview.current_quantity), 10)
    assert.equal(Number(harvestPreview.harvested_primary_qty), 4)
    assert.equal(Number(harvestPreview.resulting_quantity), 6)
    assert.equal(Number(harvestPreview.current_total_weight), 20)
    assert.equal(Number(harvestPreview.harvested_total_weight), 8)
    assert.equal(Number(harvestPreview.resulting_total_weight), 12)
    assert.equal(Number(harvestPreview.allocated_cost), 40)
    assert.equal(Number(harvestPreview.harvested_cost_before), 0)
    assert.equal(Number(harvestPreview.harvested_cost_after), 40)
    assert.equal(Number(harvestPreview.remaining_cost_before), 100)
    assert.equal(Number(harvestPreview.remaining_cost_after), 60)
    assert.equal(Number(harvestPreview.output_unit_cost), 6.666667)
    assert.equal(harvestPreview.output_item_id, harvestOutputItemId)
    assert.equal(harvestPreview.output_uom_id, kgUomId)
    assert.equal(harvestPreview.destination_location.warehouse_id, transferWarehouseId)
    assert.equal(harvestPreview.destination_location.bin_id, transferBinId)
    assert.equal(harvestPreview.finance_effect, 'not_affected')
    assert.equal(harvestPreview.items_unit_price_effect, 'unchanged')
    assert.ok(harvestPreview.source_fingerprint)
    await assertHarvestPreviewNonMutation(harvestBatch.batch_id, previewBefore, 'Harvest')

    const invalidHarvestPreview = unwrapRpcSingle(expectNoSupabaseError(
      await operatorClient.rpc('preview_growth_batch_harvest', {
        ...harvestPayload,
        p_harvested_primary_qty: 11,
      }),
      'Expected excessive harvest preview to return blockers',
    ))
    assert.equal(invalidHarvestPreview.ready, false)
    assert.equal(invalidHarvestPreview.blocking_reasons.some((reason) => reason.code === 'growth_batch_harvest_quantity_exceeds_current'), true)

    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_harvest', {
        ...harvestPayload,
        p_expected_source_fingerprint: null,
        p_request_key: `${PREFIX}-harvest-missing-fingerprint`,
      }),
      'growth_batch_harvest_source_fingerprint_required',
    )

    const staleBatch = await createActiveGrowthBatch('Harvest Stale Batch', { openingQty: 5, openingWeight: 10 })
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_direct_cost', {
      p_company_id: companyId,
      p_growth_batch_id: staleBatch.batch_id,
      p_category: 'labour',
      p_description: 'Stale harvest cost pool',
      p_amount: 50,
      p_event_date: todayIso(),
      p_request_key: `${PREFIX}-harvest-stale-cost`,
    }))
    const stalePreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_harvest', {
      ...harvestPayload,
      p_growth_batch_id: staleBatch.batch_id,
      p_harvested_primary_qty: 2,
      p_harvested_total_weight: 4,
      p_output_quantity: 3,
      p_notes: 'Stale harvest preview',
    })))
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_loss', {
      p_growth_batch_id: staleBatch.batch_id,
      p_loss_type: 'mortality',
      p_effective_date: todayIso(),
      p_quantity_lost: 1,
      p_weight_lost: null,
      p_reason_code: 'disease',
      p_notes: null,
      p_request_key: `${PREFIX}-harvest-stale-loss`,
    }))
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_harvest', {
        ...harvestPayload,
        p_growth_batch_id: staleBatch.batch_id,
        p_harvested_primary_qty: 2,
        p_harvested_total_weight: 4,
        p_output_quantity: 3,
        p_notes: 'Stale harvest preview',
        p_expected_source_fingerprint: stalePreview.source_fingerprint,
        p_request_key: `${PREFIX}-harvest-stale-post`,
      }),
      'growth_batch_harvest_source_changed',
    )

    const harvestBefore = await harvestMutationSnapshot(harvestBatch.batch_id)
    const postedHarvest = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('post_growth_batch_harvest', {
      ...harvestPayload,
      p_expected_source_fingerprint: harvestPreview.source_fingerprint,
      p_request_key: `${PREFIX}-harvest-post`,
    }), 'Expected harvest posting to succeed'))
    assert.equal(postedHarvest.event_type, 'harvest')
    assert.equal(postedHarvest.event_sequence, Number(harvestBefore.batch.latest_event_sequence) + 1)
    assert.equal(postedHarvest.harvest_detail_id.length, 36)
    assert.equal(postedHarvest.stock_receipt_movement_id.length, 36)
    assert.equal(postedHarvest.request_status, 'succeeded')
    const afterHarvest = await querySingle(ownerClient, 'growth_batches', harvestSnapshotSelect, [['eq', 'id', harvestBatch.batch_id]])
    assert.equal(afterHarvest.status, 'active')
    assert.equal(Number(afterHarvest.current_primary_qty), 6)
    assert.equal(Number(afterHarvest.current_total_weight), 12)
    assert.equal(Number(afterHarvest.accumulated_material_cost), Number(harvestBefore.batch.accumulated_material_cost))
    assert.equal(Number(afterHarvest.accumulated_direct_cost), 100)
    assert.equal(Number(afterHarvest.accumulated_total_cost), 100)
    assert.equal(Number(afterHarvest.harvested_cost), 40)
    assert.equal(Number(afterHarvest.remaining_cost), 60)
    assert.equal(await stockMovementCount(admin, companyId), harvestBefore.movementCount + 1, 'Harvest must create one stock receipt')
    assert.deepEqual(await financeIsolationCounts(admin, companyId), harvestBefore.financeCounts)
    assert.deepEqual(await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', harvestOutputItemId]]), harvestBefore.outputPrice)
    const outputBucket = await querySingle(ownerClient, 'stock_levels', 'qty,avg_cost', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', harvestOutputItemId],
      ['eq', 'warehouse_id', transferWarehouseId],
      ['eq', 'bin_id', transferBinId],
    ])
    assert.equal(Number(outputBucket.qty), 6)
    assert.equal(Number(outputBucket.avg_cost).toFixed(6), '6.666667')

    const harvestDetails = expectNoSupabaseError(
      await ownerClient.from('growth_batch_harvests').select('*').eq('event_id', postedHarvest.event_id),
      'Expected harvest detail to load',
    )
    assert.equal(harvestDetails.length, 1)
    assert.equal(Number(harvestDetails[0].allocated_cost), 40)
    assert.equal(harvestDetails[0].stock_receipt_movement_id, postedHarvest.stock_receipt_movement_id)
    const harvestReceipt = await querySingle(ownerClient, 'stock_movements', 'type,item_id,uom_id,qty_base,unit_cost,total_value,warehouse_to_id,bin_to_id,ref_type,ref_id,ref_line_id', [
      ['eq', 'id', postedHarvest.stock_receipt_movement_id],
    ])
    assert.equal(harvestReceipt.type, 'receive')
    assert.equal(harvestReceipt.ref_type, 'GROWTH_BATCH_HARVEST')
    assert.equal(harvestReceipt.ref_id, postedHarvest.event_id)
    assert.equal(harvestReceipt.ref_line_id, postedHarvest.harvest_detail_id)
    assert.equal(Number(harvestReceipt.total_value), 40)

    const harvestReplay = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('post_growth_batch_harvest', {
      ...harvestPayload,
      p_harvested_primary_qty: '4.00',
      p_harvested_total_weight: '8.0',
      p_output_quantity: '6.000',
      p_expected_source_fingerprint: harvestPreview.source_fingerprint,
      p_request_key: `${PREFIX}-harvest-post`,
    }), 'Expected harvest replay to return original result'))
    assert.equal(harvestReplay.event_id, postedHarvest.event_id)
    await expectPostgrestError(
      operatorClient.rpc('post_growth_batch_harvest', {
        ...harvestPayload,
        p_output_quantity: 7,
        p_expected_source_fingerprint: harvestPreview.source_fingerprint,
        p_request_key: `${PREFIX}-harvest-post`,
      }),
      'idempotency_key_payload_mismatch',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_harvests').update({ allocated_cost: 99 }).eq('id', postedHarvest.harvest_detail_id),
      'direct growth_batch_harvests update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_harvests').delete().eq('id', postedHarvest.harvest_detail_id),
      'direct growth_batch_harvests delete',
    )

    const harvestHistory = expectNoSupabaseError(
      await ownerClient.from('growth_batch_harvest_history').select('*').eq('growth_batch_id', harvestBatch.batch_id),
      'Expected harvest history to load',
    )
    assert.equal(harvestHistory.length, 1)
    assert.equal(harvestHistory[0].reversal_eligible, true)
    assert.equal(harvestHistory[0].reversed, false)
    const harvestTimeline = expectNoSupabaseError(
      await ownerClient.from('growth_batch_event_timeline').select('event_type,typed_detail_summary').eq('id', postedHarvest.event_id),
      'Expected harvest timeline row to load',
    )
    assert.equal(harvestTimeline.length, 1)
    assert.equal(harvestTimeline[0].event_type, 'harvest')
    assert.equal(Number(harvestTimeline[0].typed_detail_summary?.allocated_cost), 40)

    await expectPostgrestError(
      operatorClient.rpc('reverse_growth_batch_harvest', {
        p_original_event_id: postedHarvest.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Operator cannot reverse harvest',
        p_expected_source_fingerprint: null,
        p_request_key: `${PREFIX}-harvest-operator-reverse`,
      }),
      'manager_role_required',
    )
    await expectPostgrestError(
      managerClient.rpc('reverse_growth_batch_harvest', {
        p_original_event_id: postedHarvest.event_id,
        p_effective_date: todayIso(),
        p_reason: '',
        p_expected_source_fingerprint: null,
        p_request_key: `${PREFIX}-harvest-reverse-no-reason`,
      }),
      'reversal_reason_required',
    )

    const originalHarvestBeforeReverse = await querySingle(ownerClient, 'growth_batch_harvests', '*', [['eq', 'event_id', postedHarvest.event_id]])
    const reverseBefore = await harvestMutationSnapshot(harvestBatch.batch_id)
    const reversedHarvest = unwrapRpcSingle(expectNoSupabaseError(await managerClient.rpc('reverse_growth_batch_harvest', {
      p_original_event_id: postedHarvest.event_id,
      p_effective_date: todayIso(),
      p_reason: 'Controlled harvest reversal',
      p_expected_source_fingerprint: null,
      p_request_key: `${PREFIX}-harvest-reverse`,
    }), 'Expected harvest reversal to succeed'))
    assert.equal(reversedHarvest.event_type, 'harvest_reversal')
    assert.equal(reversedHarvest.original_event_id, postedHarvest.event_id)
    assert.equal(reversedHarvest.reversal_detail_id.length, 36)
    assert.equal(reversedHarvest.stock_issue_movement_id.length, 36)
    const afterHarvestReverse = await querySingle(ownerClient, 'growth_batches', harvestSnapshotSelect, [['eq', 'id', harvestBatch.batch_id]])
    assert.equal(Number(afterHarvestReverse.current_primary_qty), 10)
    assert.equal(Number(afterHarvestReverse.current_total_weight), 20)
    assert.equal(Number(afterHarvestReverse.accumulated_total_cost), 100)
    assert.equal(Number(afterHarvestReverse.harvested_cost), 0)
    assert.equal(Number(afterHarvestReverse.remaining_cost), 100)
    assert.equal(await stockMovementCount(admin, companyId), reverseBefore.movementCount + 1, 'Harvest reversal must create one stock issue')
    assert.deepEqual(await financeIsolationCounts(admin, companyId), reverseBefore.financeCounts)
    assert.deepEqual(await querySingle(ownerClient, 'items', 'unit_price', [['eq', 'id', harvestOutputItemId]]), reverseBefore.outputPrice)
    const outputBucketAfterReverse = await querySingle(ownerClient, 'stock_levels', 'qty', [
      ['eq', 'company_id', companyId],
      ['eq', 'item_id', harvestOutputItemId],
      ['eq', 'warehouse_id', transferWarehouseId],
      ['eq', 'bin_id', transferBinId],
    ])
    assert.equal(Number(outputBucketAfterReverse.qty), 0)
    assert.deepEqual(await querySingle(ownerClient, 'growth_batch_harvests', '*', [['eq', 'event_id', postedHarvest.event_id]]), originalHarvestBeforeReverse)

    const reversalDetails = expectNoSupabaseError(
      await ownerClient.from('growth_batch_harvest_reversal_lines').select('*').eq('original_event_id', postedHarvest.event_id),
      'Expected harvest reversal detail to load',
    )
    assert.equal(reversalDetails.length, 1)
    assert.equal(reversalDetails[0].stock_issue_movement_id, reversedHarvest.stock_issue_movement_id)
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_harvest_reversal_lines').update({ reason: 'mutate' }).eq('id', reversalDetails[0].id),
      'direct growth_batch_harvest_reversal_lines update',
    )
    await expectDirectMutationBlocked(
      operatorClient.from('growth_batch_harvest_reversal_lines').delete().eq('id', reversalDetails[0].id),
      'direct growth_batch_harvest_reversal_lines delete',
    )
    const harvestReverseReplay = unwrapRpcSingle(expectNoSupabaseError(await managerClient.rpc('reverse_growth_batch_harvest', {
      p_original_event_id: postedHarvest.event_id,
      p_effective_date: todayIso(),
      p_reason: 'Controlled harvest reversal',
      p_expected_source_fingerprint: null,
      p_request_key: `${PREFIX}-harvest-reverse`,
    }), 'Expected harvest reversal replay to return original result'))
    assert.equal(harvestReverseReplay.event_id, reversedHarvest.event_id)
    await expectPostgrestError(
      managerClient.rpc('reverse_growth_batch_harvest', {
        p_original_event_id: postedHarvest.event_id,
        p_effective_date: todayIso(),
        p_reason: 'Second harvest reversal',
        p_expected_source_fingerprint: null,
        p_request_key: `${PREFIX}-harvest-reverse-second`,
      }),
      'growth_batch_harvest_already_reversed',
    )

    const fullHarvestBatch = await createActiveGrowthBatch('Full Harvest Batch', { openingQty: 3, openingWeight: 9 })
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_direct_cost', {
      p_company_id: companyId,
      p_growth_batch_id: fullHarvestBatch.batch_id,
      p_category: 'labour',
      p_description: 'Full harvest cost pool',
      p_amount: 33,
      p_event_date: todayIso(),
      p_request_key: `${PREFIX}-full-harvest-cost`,
    }))
    const fullPreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_harvest', {
      ...harvestPayload,
      p_growth_batch_id: fullHarvestBatch.batch_id,
      p_harvested_primary_qty: 3,
      p_harvested_total_weight: 9,
      p_output_quantity: 9,
      p_notes: 'Full harvest',
    })))
    assert.equal(fullPreview.harvest_kind, 'full')
    assert.equal(Number(fullPreview.allocated_cost), 33)
    assert.equal(Number(fullPreview.remaining_cost_after), 0)
    const fullHarvest = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('post_growth_batch_harvest', {
      ...harvestPayload,
      p_growth_batch_id: fullHarvestBatch.batch_id,
      p_harvested_primary_qty: 3,
      p_harvested_total_weight: 9,
      p_output_quantity: 9,
      p_notes: 'Full harvest',
      p_expected_source_fingerprint: fullPreview.source_fingerprint,
      p_request_key: `${PREFIX}-full-harvest-post`,
    })))
    assert.equal(fullHarvest.harvest_kind, 'full')
    const afterFullHarvest = await querySingle(ownerClient, 'growth_batch_current_state', 'status,current_primary_qty,latest_total_weight,remaining_cost,fully_harvested_awaiting_completion', [['eq', 'id', fullHarvestBatch.batch_id]])
    assert.equal(afterFullHarvest.status, 'active')
    assert.equal(Number(afterFullHarvest.current_primary_qty), 0)
    assert.equal(Number(afterFullHarvest.latest_total_weight), 0)
    assert.equal(Number(afterFullHarvest.remaining_cost), 0)
    assert.equal(afterFullHarvest.fully_harvested_awaiting_completion, true)

    const concurrentHarvestBatch = await createActiveGrowthBatch('Concurrent Harvest Batch', { openingQty: 5, openingWeight: 10 })
    expectNoSupabaseError(await operatorClient.rpc('record_growth_batch_direct_cost', {
      p_company_id: companyId,
      p_growth_batch_id: concurrentHarvestBatch.batch_id,
      p_category: 'labour',
      p_description: 'Concurrent harvest cost pool',
      p_amount: 50,
      p_event_date: todayIso(),
      p_request_key: `${PREFIX}-concurrent-harvest-cost`,
    }))
    const concurrentPreview = unwrapRpcSingle(expectNoSupabaseError(await operatorClient.rpc('preview_growth_batch_harvest', {
      ...harvestPayload,
      p_growth_batch_id: concurrentHarvestBatch.batch_id,
      p_harvested_primary_qty: 3,
      p_harvested_total_weight: 6,
      p_output_quantity: 3,
      p_notes: 'Concurrent harvest preview',
    })))
    const concurrentHarvests = await Promise.all([
      operatorClient.rpc('post_growth_batch_harvest', {
        ...harvestPayload,
        p_growth_batch_id: concurrentHarvestBatch.batch_id,
        p_harvested_primary_qty: 3,
        p_harvested_total_weight: 6,
        p_output_quantity: 3,
        p_notes: 'Concurrent harvest A',
        p_expected_source_fingerprint: concurrentPreview.source_fingerprint,
        p_request_key: `${PREFIX}-concurrent-harvest-a`,
      }),
      ownerClient.rpc('post_growth_batch_harvest', {
        ...harvestPayload,
        p_growth_batch_id: concurrentHarvestBatch.batch_id,
        p_harvested_primary_qty: 2,
        p_harvested_total_weight: 4,
        p_output_quantity: 2,
        p_notes: 'Concurrent harvest B',
        p_expected_source_fingerprint: concurrentPreview.source_fingerprint,
        p_request_key: `${PREFIX}-concurrent-harvest-b`,
      }),
    ])
    assert.equal(concurrentHarvests.filter((result) => !result.error).length, 1, 'Only one competing harvest should succeed')
    assert.equal(concurrentHarvests.filter((result) => result.error).length, 1, 'One competing harvest should fail stale-source validation')
    const concurrentHarvestEvents = expectNoSupabaseError(
      await ownerClient.from('growth_batch_events').select('event_sequence,event_type').eq('growth_batch_id', concurrentHarvestBatch.batch_id),
      'Expected concurrent harvest events to load',
    )
    assert.equal(new Set(concurrentHarvestEvents.map((event) => event.event_sequence)).size, concurrentHarvestEvents.length, 'Concurrent harvest events must not duplicate sequence numbers')
  })
})
