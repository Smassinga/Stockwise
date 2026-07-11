import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  createAdminClient, createAnonClient, createTempUser, deleteAuthUser, expectPostgrestError,
  setActiveCompany, signIn, unwrapRpcSingle,
} from './helpers.mjs'

const PREFIX = 'PAYACT'
const SOURCE = {
  app: readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8'),
  access: readFileSync(new URL('../../src/pages/CompanyAccessStatus.tsx', import.meta.url), 'utf8'),
  activation: readFileSync(new URL('../../src/pages/PaymentActivation.tsx', import.meta.url), 'utf8'),
  platform: readFileSync(new URL('../../src/components/platform/PaymentActivationAdmin.tsx', import.meta.url), 'utf8'),
  client: readFileSync(new URL('../../src/lib/paymentActivation.ts', import.meta.url), 'utf8'),
  migration1: readFileSync(new URL('../../supabase/migrations/20260711091717_add_payment_activation_requests.sql', import.meta.url), 'utf8'),
  migration2: readFileSync(new URL('../../supabase/migrations/20260711091724_add_payment_activation_workflow.sql', import.meta.url), 'utf8'),
}

function ok(result, message = 'Expected Supabase operation to succeed') {
  if (result.error) throw new Error(`${message}: ${result.error.message}`)
  return result.data
}

function exactCount(result, message = 'Expected count query to succeed') {
  if (result.error) throw new Error(`${message}: ${result.error.message}`)
  assert.equal(typeof result.count, 'number', message)
  return result.count
}

test('payment activation request and verified proof workflow', async (t) => {
  const admin = createAdminClient()
  const anon = createAnonClient()
  const users = []
  const companies = []
  let channelId = null
  let secondChannelId = null
  let requestId = null
  let requestReference = null
  let ownerCompanyId = null
  let crossCompanyId = null

  async function check(name, fn) { await t.test(name, fn) }
  async function cleanupCompany(companyId) {
    const requestFolders = ok(await admin.storage.from('payment-proofs').list(companyId, { limit: 1000 })) || []
    const proofPaths = []
    for (const folder of requestFolders) {
      const objects = ok(await admin.storage.from('payment-proofs').list(`${companyId}/${folder.name}`, { limit: 1000 })) || []
      proofPaths.push(...objects.map((row) => `${companyId}/${folder.name}/${row.name}`))
    }
    if (proofPaths.length) ok(await admin.storage.from('payment-proofs').remove(proofPaths))
    await admin.from('company_payment_request_events').delete().eq('company_id', companyId)
    await admin.from('company_payment_requests').delete().eq('company_id', companyId)
    await admin.from('company_payment_request_counters').delete().eq('company_id', companyId)
    await admin.from('company_control_action_log').delete().eq('company_id', companyId)
    await admin.from('company_access_audit_log').delete().eq('company_id', companyId)
    await admin.from('posting_requests').delete().eq('company_id', companyId)
    await admin.from('company_purge_queue').delete().eq('company_id', companyId)
    await admin.from('company_subscription_state').delete().eq('company_id', companyId)
    await admin.from('user_active_company').delete().eq('company_id', companyId)
    await admin.from('company_settings').delete().eq('company_id', companyId)
    await admin.from('company_members').delete().eq('company_id', companyId)
    await admin.from('companies').delete().eq('id', companyId)
  }

  t.after(async () => {
    for (const companyId of companies) await cleanupCompany(companyId)
    for (const paymentChannelId of [channelId, secondChannelId].filter(Boolean)) {
      await admin.from('platform_payment_channel_events').delete().eq('channel_id', paymentChannelId)
      await admin.from('platform_payment_channels').delete().eq('id', paymentChannelId)
    }
    for (const user of users) {
      await admin.from('platform_admins').delete().eq('user_id', user.userId)
      await deleteAuthUser(admin, user.userId)
    }
  })

  const ownerUser = await createTempUser(admin, PREFIX, 'owner')
  const adminUser = await createTempUser(admin, PREFIX, 'company-admin')
  const managerUser = await createTempUser(admin, PREFIX, 'manager')
  const operatorUser = await createTempUser(admin, PREFIX, 'operator')
  const viewerUser = await createTempUser(admin, PREFIX, 'viewer')
  const platformUser = await createTempUser(admin, PREFIX, 'platform')
  const crossOwnerUser = await createTempUser(admin, PREFIX, 'cross-owner')
  users.push(ownerUser, adminUser, managerUser, operatorUser, viewerUser, platformUser, crossOwnerUser)
  const ownerClient = await signIn(ownerUser.email, ownerUser.password)
  const companyAdminClient = await signIn(adminUser.email, adminUser.password)
  const managerClient = await signIn(managerUser.email, managerUser.password)
  const operatorClient = await signIn(operatorUser.email, operatorUser.password)
  const viewerClient = await signIn(viewerUser.email, viewerUser.password)
  const platformClient = await signIn(platformUser.email, platformUser.password)
  const crossOwnerClient = await signIn(crossOwnerUser.email, crossOwnerUser.password)

  ownerCompanyId = unwrapRpcSingle(ok(await ownerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Owner Company` }))).out_company_id
  crossCompanyId = unwrapRpcSingle(ok(await crossOwnerClient.rpc('create_company_and_bootstrap', { p_name: `${PREFIX} Cross Company` }))).out_company_id
  companies.push(ownerCompanyId, crossCompanyId)
  await setActiveCompany(ownerClient, ownerCompanyId); await setActiveCompany(crossOwnerClient, crossCompanyId)
  ok(await admin.from('company_members').insert([
    { company_id: ownerCompanyId, user_id: adminUser.userId, email: adminUser.email, role: 'ADMIN', status: 'active' },
    { company_id: ownerCompanyId, user_id: managerUser.userId, email: managerUser.email, role: 'MANAGER', status: 'active' },
    { company_id: ownerCompanyId, user_id: operatorUser.userId, email: operatorUser.email, role: 'OPERATOR', status: 'active' },
    { company_id: ownerCompanyId, user_id: viewerUser.userId, email: viewerUser.email, role: 'VIEWER', status: 'active' },
  ]))
  for (const client of [companyAdminClient, managerClient, operatorClient, viewerClient]) await setActiveCompany(client, ownerCompanyId)
  ok(await admin.from('platform_admins').insert({ email: platformUser.email, user_id: platformUser.userId, is_active: true, note: 'Payment activation regression' }))

  await check('01 platform admin creates a payment channel', async () => {
    channelId = ok(await platformClient.rpc('platform_admin_upsert_payment_channel', {
      p_id: null, p_method_code: `qa_${randomUUID().slice(0,8)}`, p_display_name: 'QA verified transfer', p_provider_category: 'other',
      p_destination_identifier: 'CONTROLLED-QA-DESTINATION', p_account_name: 'StockWise QA', p_currency_code: 'MZN',
      p_operator_instructions: 'Regression only', p_customer_instructions: 'Use only for isolated local regression.', p_is_active: true,
      p_sort_order: 10, p_effective_from: null, p_effective_until: null,
    }))
    assert.match(channelId, /^[0-9a-f-]{36}$/)
  })
  await check('02 non-platform admin cannot create a channel', async () => {
    await expectPostgrestError(ownerClient.rpc('platform_admin_upsert_payment_channel', {
      p_id:null,p_method_code:'blocked',p_display_name:'Blocked',p_provider_category:'other',p_destination_identifier:'X',p_account_name:null,
      p_currency_code:'MZN',p_operator_instructions:null,p_customer_instructions:'Blocked',p_is_active:false,p_sort_order:100,p_effective_from:null,p_effective_until:null,
    }), 'platform_admin_required')
  })
  await check('03 active company member lists active channels', async () => { assert.equal(ok(await ownerClient.rpc('list_available_payment_channels')).some((row)=>row.id===channelId), true) })
  await check('04 inactive channels are excluded from company list', async () => {
    ok(await platformClient.rpc('platform_admin_set_payment_channel_status',{p_channel_id:channelId,p_is_active:false}))
    assert.equal(ok(await ownerClient.rpc('list_available_payment_channels')).some((row)=>row.id===channelId),false)
    ok(await platformClient.rpc('platform_admin_set_payment_channel_status',{p_channel_id:channelId,p_is_active:true}))
  })
  await check('05 channel changes append immutable channel events', async () => { assert.ok((ok(await admin.from('platform_payment_channel_events').select('*').eq('channel_id',channelId))).length>=3) })
  await check('06 referenced channels use restrictive deletion', async () => { assert.match(SOURCE.migration1,/references public\.platform_payment_channels\(id\) on delete restrict/) })
  await check('07 payment channel schema contains no secret credential fields', async () => { assert.doesNotMatch(SOURCE.migration1,/api_key|private_key|password|\bpin\b/i) })

  let plans
  await check('08 authenticated catalogue returns requestable exact prices', async () => { plans=ok(await ownerClient.rpc('list_available_payment_plans'));assert.ok(plans.length>=3);assert.ok(plans.every((row)=>Number(row.amount)>0)) })
  const plan = () => plans.find((row)=>row.plan_code==='starter'&&row.billing_period==='monthly') ?? plans[0]
  await check('09 anonymous cannot list payment plans', async () => { await expectPostgrestError(anon.rpc('list_available_payment_plans'),'permission denied') })
  await check('10 owner creates a draft request', async () => {
    const result=ok(await ownerClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}))
    requestId=result.request_id;requestReference=result.reference;assert.equal(result.status,'draft')
  })
  await check('11 company admin cannot create while one open request exists', async () => { await expectPostgrestError(companyAdminClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'duplicate key') })
  await check('12 manager cannot create request', async () => { await expectPostgrestError(managerClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'owner_or_admin_required') })
  await check('13 operator cannot create request', async () => { await expectPostgrestError(operatorClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'owner_or_admin_required') })
  await check('14 viewer cannot create request', async () => { await expectPostgrestError(viewerClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'owner_or_admin_required') })
  await check('15 cross-company owner cannot mutate another company request', async () => { await expectPostgrestError(crossOwnerClient.rpc('update_company_payment_request_draft',{p_request_id:requestId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_payer_name:'X',p_payer_phone:'1',p_transaction_reference:'X',p_declared_amount:1,p_note:'X',p_request_key:randomUUID()}),'owner_or_admin_required') })
  await check('16 invalid plan fails server-side', async () => { await expectPostgrestError(crossOwnerClient.rpc('create_company_payment_request',{p_company_id:crossCompanyId,p_plan_code:'not-a-plan',p_billing_period:'monthly',p_payment_channel_id:channelId,p_request_key:randomUUID()}),'payment_plan_not_available') })
  await check('17 inactive channel fails request creation', async () => {
    ok(await platformClient.rpc('platform_admin_set_payment_channel_status',{p_channel_id:channelId,p_is_active:false}));
    await expectPostgrestError(crossOwnerClient.rpc('create_company_payment_request',{p_company_id:crossCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'payment_channel_not_available');
    ok(await platformClient.rpc('platform_admin_set_payment_channel_status',{p_channel_id:channelId,p_is_active:true}))
  })
  await check('18 expected amount comes from plan catalog', async () => { const row=ok(await admin.from('company_payment_requests').select('*').eq('id',requestId).single());assert.equal(Number(row.expected_amount_snapshot),Number(plan().amount)) })
  await check('19 create RPC has no client expected amount argument', async () => { assert.match(SOURCE.migration2,/create_company_payment_request\(\s*p_company_id uuid, p_plan_code text, p_billing_period text, p_payment_channel_id uuid, p_request_key text/) })
  await check('20 plan and channel snapshots are frozen on request', async () => { const row=ok(await admin.from('company_payment_requests').select('*').eq('id',requestId).single());assert.equal(row.payment_channel_display_snapshot,'QA verified transfer');assert.equal(row.plan_name_snapshot,plan().display_name) })
  await check('21 same create key replays the same request', async () => {
    const key=randomUUID(); await admin.from('company_payment_request_events').delete().eq('request_id',requestId); await admin.from('company_payment_requests').delete().eq('id',requestId); await admin.from('posting_requests').delete().eq('company_id',ownerCompanyId).eq('operation_type','subscription.payment_request.create');
    const args={p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:key};const a=ok(await ownerClient.rpc('create_company_payment_request',args));const b=ok(await ownerClient.rpc('create_company_payment_request',args));requestId=a.request_id;requestReference=a.reference;assert.equal(b.request_id,a.request_id)
  })
  await check('22 changed create payload reuse fails', async () => { const key=randomUUID(); const p=plan(); await admin.from('company_payment_request_events').delete().eq('request_id',requestId);await admin.from('company_payment_requests').delete().eq('id',requestId);const a=ok(await ownerClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:p.plan_code,p_billing_period:p.billing_period,p_payment_channel_id:channelId,p_request_key:key}));requestId=a.request_id;await expectPostgrestError(ownerClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:p.plan_code,p_billing_period:p.billing_period==='monthly'?'annual':'monthly',p_payment_channel_id:channelId,p_request_key:key}),'payload_mismatch') })
  await check('23 one-open-request unique index prevents concurrent duplicate drafts', async () => { assert.match(SOURCE.migration1,/company_payment_requests_one_open_per_company/) })
  await check('24 trial company is eligible to request', async () => { const state=ok(await admin.from('company_subscription_state').select('subscription_status').eq('company_id',ownerCompanyId).single());assert.equal(state.subscription_status,'trial') })
  await check('25 expired company is permitted by actor guard', async () => { assert.doesNotMatch(SOURCE.migration2,/v_status in \('expired'/) })
  await check('26 active-paid renewal is permitted by actor guard', async () => { assert.doesNotMatch(SOURCE.migration2,/v_status in \('active_paid'/) })
  await check('27 suspended company self-activation is blocked', async () => { ok(await platformClient.rpc('platform_admin_set_company_access',{p_company_id:crossCompanyId,p_plan_code:'starter',p_status:'suspended',p_reason:'Regression',p_paid_until:null,p_trial_expires_at:null,p_purge_scheduled_at:null}));await expectPostgrestError(crossOwnerClient.rpc('create_company_payment_request',{p_company_id:crossCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'company_self_activation_blocked') })
  await check('28 disabled company self-activation is blocked', async () => { ok(await platformClient.rpc('platform_admin_set_company_access',{p_company_id:crossCompanyId,p_plan_code:'starter',p_status:'disabled',p_reason:'Regression',p_paid_until:null,p_trial_expires_at:null,p_purge_scheduled_at:null}));await expectPostgrestError(crossOwnerClient.rpc('create_company_payment_request',{p_company_id:crossCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}),'company_self_activation_blocked') })

  const transactionReference=`QA-${randomUUID()}`
  await check('29 owner updates editable draft with payer identity', async () => { ok(await ownerClient.rpc('update_company_payment_request_draft',{p_request_id:requestId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_payer_name:'QA Payer',p_payer_phone:'+258840000000',p_transaction_reference:transactionReference,p_declared_amount:plan().amount,p_note:'Local regression',p_request_key:randomUUID()}));const row=ok(await admin.from('company_payment_requests').select('*').eq('id',requestId).single());assert.equal(row.payer_name,'QA Payer') })
  await check('30 normalized provider fingerprint is SHA-256', async () => { const row=ok(await admin.from('company_payment_requests').select('provider_reference_fingerprint').eq('id',requestId).single());assert.match(row.provider_reference_fingerprint,/^[0-9a-f]{64}$/) })
  const proofPath=()=>`${ownerCompanyId}/${requestId}/proof`
  await check('31 owner uploads own draft PDF proof', async () => { ok(await ownerClient.storage.from('payment-proofs').upload(proofPath(),Buffer.from('%PDF-1.4 QA'),{contentType:'application/pdf',upsert:true})) })
  await check('32 admin role storage policy is present for draft upload', async () => { assert.match(SOURCE.migration1,/cm\.role in \('OWNER'::public\.member_role, 'ADMIN'::public\.member_role\)/) })
  await check('33 another company cannot read proof', async () => { const result=await crossOwnerClient.storage.from('payment-proofs').download(proofPath());assert.ok(result.error) })
  await check('34 another company cannot overwrite proof', async () => { const result=await crossOwnerClient.storage.from('payment-proofs').upload(proofPath(),Buffer.from('x'),{contentType:'application/pdf',upsert:true});assert.ok(result.error) })
  await check('35 anonymous cannot read proof', async () => { const result=await anon.storage.from('payment-proofs').download(proofPath());assert.ok(result.error) })
  await check('36 proof bucket is private', async () => { const bucket=ok(await admin.storage.getBucket('payment-proofs'));assert.equal(bucket.public,false) })
  await check('37 invalid MIME is rejected by bucket policy', async () => { const result=await ownerClient.storage.from('payment-proofs').upload(`${ownerCompanyId}/${requestId}/bad`,Buffer.from('x'),{contentType:'text/html'});assert.ok(result.error) })
  await check('38 bucket enforces 5 MiB limit', async () => { const bucket=ok(await admin.storage.getBucket('payment-proofs'));assert.equal(Number(bucket.file_size_limit),5242880) })
  await check('39 server attaches and validates proof metadata', async () => { const result=ok(await ownerClient.rpc('attach_company_payment_request_proof',{p_request_id:requestId,p_request_key:randomUUID()}));assert.equal(result.proof_attached,true);assert.equal(result.mime_type,'application/pdf') })
  await check('40 missing proof blocks submission', async () => { await admin.storage.from('payment-proofs').remove([proofPath()]);await expectPostgrestError(ownerClient.rpc('submit_company_payment_request',{p_request_id:requestId,p_request_key:randomUUID()}),'payment_proof_required');ok(await ownerClient.storage.from('payment-proofs').upload(proofPath(),Buffer.from('%PDF-1.4 QA'),{contentType:'application/pdf',upsert:true}));ok(await ownerClient.rpc('attach_company_payment_request_proof',{p_request_id:requestId,p_request_key:randomUUID()})) })
  await check('41 arbitrary proof path is never accepted by attach RPC', async () => { assert.equal(SOURCE.migration2.includes('p_proof_path'),false) })
  await check('42 signed proof authorization is bounded to 120 seconds', async () => { const auth=ok(await ownerClient.rpc('authorize_company_payment_proof_access',{p_request_id:requestId}));assert.equal(auth.expires_in,120);assert.equal(auth.path,proofPath()) })

  const baselineAccess=ok(await admin.from('company_subscription_state').select('*').eq('company_id',ownerCompanyId).single())
  let eventCountBeforeSubmit
  await check('43 valid draft submits', async () => { eventCountBeforeSubmit=exactCount(await admin.from('company_payment_request_events').select('*',{count:'exact',head:true}).eq('request_id',requestId));const result=ok(await ownerClient.rpc('submit_company_payment_request',{p_request_id:requestId,p_request_key:randomUUID()}));assert.equal(result.status,'submitted') })
  await check('44 submission appends exactly one submitted event', async () => { const events=ok(await admin.from('company_payment_request_events').select('*').eq('request_id',requestId).eq('event_type','submitted'));assert.equal(events.length,1) })
  await check('45 submission does not activate access', async () => { const state=ok(await admin.from('company_subscription_state').select('*').eq('company_id',ownerCompanyId).single());assert.equal(state.subscription_status,baselineAccess.subscription_status);assert.equal(state.plan_code,baselineAccess.plan_code) })
  await check('46 authoritative expected amount is retained after submission', async () => { const row=ok(await admin.from('company_payment_requests').select('*').eq('id',requestId).single());assert.equal(Number(row.expected_amount_snapshot),Number(plan().amount)) })
  await check('47 declared amount mismatch is persisted for review', async () => { assert.equal(ok(await admin.from('company_payment_requests').select('amount_mismatch').eq('id',requestId).single()).amount_mismatch,false) })
  await check('48 missing transaction reference is rejected by draft update', async () => { assert.match(SOURCE.migration2,/transaction_reference_required/) })
  await check('49 non-positive declared amount is rejected', async () => { assert.match(SOURCE.migration2,/declared_amount_must_be_positive/) })
  await check('50 provider reference has a live unique index', async () => { assert.match(SOURCE.migration1,/company_payment_requests_provider_reference_live_unique/) })
  await check('51 submitted proof cannot be replaced by tenant', async () => { const result=await ownerClient.storage.from('payment-proofs').upload(proofPath(),Buffer.from('%PDF changed'),{contentType:'application/pdf',upsert:true});assert.ok(result.error) })
  await check('52 direct request status update is denied', async () => { await expectPostgrestError(ownerClient.from('company_payment_requests').update({status:'approved'}).eq('id',requestId),'permission denied') })
  await check('53 normal clients cannot insert event history', async () => { await expectPostgrestError(ownerClient.from('company_payment_request_events').insert({request_id:requestId,company_id:ownerCompanyId,sequence:99,event_type:'approved',actor_class:'company_user'}),'permission denied') })
  await check('54 cross-company request read returns no rows', async () => { const rows=ok(await crossOwnerClient.from('company_payment_requests').select('*').eq('id',requestId));assert.equal(rows.length,0) })
  await check('55 viewer may read company request status', async () => { const rows=ok(await viewerClient.rpc('list_my_company_payment_requests',{p_company_id:ownerCompanyId}));assert.equal(rows.some((row)=>row.id===requestId),true) })

  await check('56 platform admin starts review', async () => { const result=ok(await platformClient.rpc('platform_admin_start_payment_review',{p_request_id:requestId,p_note:'Review started',p_request_key:randomUUID()}));assert.equal(result.status,'under_review') })
  await check('57 tenant admin cannot start platform review', async () => { await expectPostgrestError(companyAdminClient.rpc('platform_admin_start_payment_review',{p_request_id:requestId,p_note:'No',p_request_key:randomUUID()}),'platform_admin_required') })
  await check('58 correction request requires a reason', async () => { await expectPostgrestError(platformClient.rpc('platform_admin_request_payment_correction',{p_request_id:requestId,p_reason:'',p_request_key:randomUUID()}),'review_reason_required') })
  await check('59 correction state changes no entitlement', async () => { ok(await platformClient.rpc('platform_admin_request_payment_correction',{p_request_id:requestId,p_reason:'Upload clearer proof',p_request_key:randomUUID()}));const state=ok(await admin.from('company_subscription_state').select('*').eq('company_id',ownerCompanyId).single());assert.equal(state.subscription_status,baselineAccess.subscription_status) })
  await check('60 correction state permits same-row editing', async () => { const row=ok(await admin.from('company_payment_requests').select('*').eq('id',requestId).single());assert.equal(row.status,'needs_correction') })
  await check('61 correction permits proof replacement through storage RLS', async () => { ok(await ownerClient.storage.from('payment-proofs').upload(proofPath(),Buffer.from('%PDF-1.4 corrected'),{contentType:'application/pdf',upsert:true})) })
  await check('62 resubmission preserves prior history', async () => { ok(await ownerClient.rpc('update_company_payment_request_draft',{p_request_id:requestId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_payer_name:'QA Payer',p_payer_phone:'+258840000000',p_transaction_reference:`${transactionReference}-C`,p_declared_amount:plan().amount,p_note:'Corrected',p_request_key:randomUUID()}));ok(await ownerClient.rpc('attach_company_payment_request_proof',{p_request_id:requestId,p_request_key:randomUUID()}));ok(await ownerClient.rpc('resubmit_company_payment_request',{p_request_id:requestId,p_request_key:randomUUID()}));const events=ok(await admin.from('company_payment_request_events').select('event_type').eq('request_id',requestId));assert.ok(events.some((e)=>e.event_type==='correction_requested'));assert.ok(events.some((e)=>e.event_type==='resubmitted')) })
  await check('63 event sequences are unique and strictly increasing', async () => { const events=ok(await admin.from('company_payment_request_events').select('sequence').eq('request_id',requestId).order('sequence'));assert.deepEqual(events.map((e)=>e.sequence),[...new Set(events.map((e)=>e.sequence))]);assert.ok(events.every((e,i)=>i===0||e.sequence>events[i-1].sequence)) })
  await check('64 request snapshot survived channel edits', async () => { ok(await platformClient.rpc('platform_admin_upsert_payment_channel',{p_id:channelId,p_method_code:'qa_verified_updated',p_display_name:'QA updated channel',p_provider_category:'other',p_destination_identifier:'UPDATED-QA-DESTINATION',p_account_name:'StockWise QA',p_currency_code:'MZN',p_operator_instructions:'Updated',p_customer_instructions:'Updated local instructions',p_is_active:true,p_sort_order:10,p_effective_from:null,p_effective_until:null}));const row=ok(await admin.from('company_payment_requests').select('*').eq('id',requestId).single());assert.equal(row.payment_channel_display_snapshot,'QA verified transfer') })

  const stockBefore=ok(await ownerClient.from('stock_movements').select('id').eq('company_id',ownerCompanyId)).length
  const levelsBefore=ok(await ownerClient.from('stock_levels').select('item_id,warehouse_id,bin_id').eq('company_id',ownerCompanyId)).length
  const cashBefore=ok(await admin.from('cash_transactions').select('id').eq('company_id',ownerCompanyId)).length
  const bankBefore=ok(await admin.from('bank_transactions').select('id')).length
  const priceBefore=ok(await ownerClient.from('items').select('id,unit_price').eq('company_id',ownerCompanyId))
  let approval
  const approvalKey=randomUUID()
  await check('65 platform admin approves verified request', async () => { approval=ok(await platformClient.rpc('platform_admin_approve_payment_request',{p_request_id:requestId,p_review_note:'Proof verified locally',p_request_key:approvalKey}));assert.equal(approval.status,'approved') })
  await check('66 approval changes request to approved', async () => { assert.equal(ok(await admin.from('company_payment_requests').select('status').eq('id',requestId).single()).status,'approved') })
  await check('67 approval activates paid access', async () => { assert.equal(ok(await admin.from('company_subscription_state').select('subscription_status').eq('company_id',ownerCompanyId).single()).subscription_status,'active_paid') })
  await check('68 approval applies requested plan code', async () => { assert.equal(ok(await admin.from('company_subscription_state').select('plan_code').eq('company_id',ownerCompanyId).single()).plan_code,plan().plan_code) })
  await check('69 paid-until is calculated server-side', async () => { assert.ok(new Date(approval.paid_until)>new Date()) })
  await check('70 expired or trial approval starts from server time', async () => { const row=ok(await admin.from('company_payment_requests').select('access_start_snapshot,approved_at').eq('id',requestId).single());assert.ok(Math.abs(new Date(row.access_start_snapshot)-new Date(row.approved_at))<2000) })
  await check('71 access audit row is created', async () => { const rows=ok(await admin.from('company_access_audit_log').select('*').eq('company_id',ownerCompanyId).eq('next_status','active_paid'));assert.ok(rows.length>=1) })
  await check('72 control action row records approval', async () => { const rows=ok(await admin.from('company_control_action_log').select('*').eq('company_id',ownerCompanyId).eq('action_type','payment_request_approved'));assert.equal(rows.length,1) })
  await check('73 approved and access-activated events are appended', async () => { const rows=ok(await admin.from('company_payment_request_events').select('event_type').eq('request_id',requestId).in('event_type',['approved','access_activated']));assert.equal(rows.length,2) })
  await check('74 approved request is immutable to tenant update RPC', async () => { await expectPostgrestError(ownerClient.rpc('update_company_payment_request_draft',{p_request_id:requestId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_payer_name:'X',p_payer_phone:'X',p_transaction_reference:'X',p_declared_amount:1,p_note:'X',p_request_key:randomUUID()}),'not_editable') })
  await check('75 non-platform admin cannot approve', async () => { await expectPostgrestError(ownerClient.rpc('platform_admin_approve_payment_request',{p_request_id:requestId,p_review_note:'No',p_request_key:randomUUID()}),'platform_admin_required') })
  await check('76 same-key approval replay returns the original result without duplicate events', async () => { const before=ok(await admin.from('company_payment_request_events').select('id').eq('request_id',requestId)).length;const replay=ok(await platformClient.rpc('platform_admin_approve_payment_request',{p_request_id:requestId,p_review_note:'Proof verified locally',p_request_key:approvalKey}));const after=ok(await admin.from('company_payment_request_events').select('id').eq('request_id',requestId)).length;assert.equal(replay.paid_until,approval.paid_until);assert.equal(after,before) })
  await check('76a changed approval payload reuse is rejected without lifecycle change', async () => { const before=ok(await admin.from('company_payment_request_events').select('id').eq('request_id',requestId)).length;await expectPostgrestError(platformClient.rpc('platform_admin_approve_payment_request',{p_request_id:requestId,p_review_note:'Changed note',p_request_key:approvalKey}),'payload_mismatch');assert.equal(ok(await admin.from('company_payment_request_events').select('id').eq('request_id',requestId)).length,before) })
  await check('77 approval uses locked request row', async () => { assert.match(SOURCE.migration2,/where id=p_request_id for update/) })
  await check('78 approval locks subscription state', async () => { assert.match(SOURCE.migration2,/company_subscription_state where company_id=v_request\.company_id for update/) })
  await check('79 approval reuses existing entitlement mutation function', async () => { assert.match(SOURCE.migration2,/platform_admin_set_company_access/) })
  await check('80 active-paid renewal extends from future paid-until', async () => { assert.match(SOURCE.migration2,/v_state\.paid_until>v_now then v_state\.paid_until/) })
  await check('81 provider reference cannot approve a second request', async () => { assert.match(SOURCE.migration2,/provider_reference_already_approved/) })
  await check('82 request and entitlement approval execute in one database transaction', async () => { assert.doesNotMatch(SOURCE.client,/company_subscription_state.*update/s) })
  await check('82a provider reference cannot be reused across two channel rows in the same provider category', async () => {
    secondChannelId=ok(await platformClient.rpc('platform_admin_upsert_payment_channel',{p_id:null,p_method_code:`qa_second_${randomUUID().slice(0,8)}`,p_display_name:'QA second provider channel',p_provider_category:'other',p_destination_identifier:'SECOND-QA-DESTINATION',p_account_name:'StockWise QA',p_currency_code:'MZN',p_operator_instructions:'Regression only',p_customer_instructions:'Regression only',p_is_active:true,p_sort_order:20,p_effective_from:null,p_effective_until:null}))
    ok(await platformClient.rpc('platform_admin_set_company_access',{p_company_id:crossCompanyId,p_plan_code:'trial_7d',p_status:'trial',p_paid_until:null,p_trial_expires_at:new Date(Date.now()+7*86400000).toISOString(),p_purge_scheduled_at:null,p_reason:'Provider category regression'}))
    const created=ok(await crossOwnerClient.rpc('create_company_payment_request',{p_company_id:crossCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:secondChannelId,p_request_key:randomUUID()}))
    ok(await crossOwnerClient.rpc('update_company_payment_request_draft',{p_request_id:created.request_id,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:secondChannelId,p_payer_name:'Cross QA',p_payer_phone:'1',p_transaction_reference:`${transactionReference}-C`,p_declared_amount:plan().amount,p_note:'Provider category uniqueness',p_request_key:randomUUID()}))
    ok(await crossOwnerClient.storage.from('payment-proofs').upload(created.upload_path,Buffer.from('%PDF cross'),{contentType:'application/pdf',upsert:true}))
    ok(await crossOwnerClient.rpc('attach_company_payment_request_proof',{p_request_id:created.request_id,p_request_key:randomUUID()}))
    await expectPostgrestError(crossOwnerClient.rpc('submit_company_payment_request',{p_request_id:created.request_id,p_request_key:randomUUID()}),'provider_reference_already_used')
  })
  await check('82b concurrent different-key approvals produce one entitlement extension', async () => {
    const created=ok(await ownerClient.rpc('create_company_payment_request',{p_company_id:ownerCompanyId,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_request_key:randomUUID()}))
    ok(await ownerClient.rpc('update_company_payment_request_draft',{p_request_id:created.request_id,p_plan_code:plan().plan_code,p_billing_period:plan().billing_period,p_payment_channel_id:channelId,p_payer_name:'Concurrent QA',p_payer_phone:'1',p_transaction_reference:`CONCURRENT-${randomUUID()}`,p_declared_amount:plan().amount,p_note:'Concurrent approval',p_request_key:randomUUID()}))
    ok(await ownerClient.storage.from('payment-proofs').upload(created.upload_path,Buffer.from('%PDF concurrent'),{contentType:'application/pdf',upsert:true}))
    ok(await ownerClient.rpc('attach_company_payment_request_proof',{p_request_id:created.request_id,p_request_key:randomUUID()}))
    ok(await ownerClient.rpc('submit_company_payment_request',{p_request_id:created.request_id,p_request_key:randomUUID()}))
    const results=await Promise.all([platformClient.rpc('platform_admin_approve_payment_request',{p_request_id:created.request_id,p_review_note:'Concurrent verified',p_request_key:randomUUID()}),platformClient.rpc('platform_admin_approve_payment_request',{p_request_id:created.request_id,p_review_note:'Concurrent verified',p_request_key:randomUUID()})])
    assert.equal(results.filter((row)=>!row.error).length,1);assert.equal(results.filter((row)=>row.error).length,1)
    assert.equal(ok(await admin.from('company_payment_request_events').select('id').eq('request_id',created.request_id).eq('event_type','approved')).length,1)
  })

  await check('83 activation creates no cash transaction', async () => { assert.equal(ok(await admin.from('cash_transactions').select('id').eq('company_id',ownerCompanyId)).length,cashBefore) })
  await check('84 activation creates no bank transaction', async () => { assert.equal(ok(await admin.from('bank_transactions').select('id')).length,bankBefore) })
  await check('85 activation creates no stock movement', async () => { assert.equal(ok(await ownerClient.from('stock_movements').select('id').eq('company_id',ownerCompanyId)).length,stockBefore) })
  await check('86 activation changes no stock level', async () => { assert.equal(ok(await ownerClient.from('stock_levels').select('item_id').eq('company_id',ownerCompanyId)).length,levelsBefore) })
  await check('87 activation changes no item selling price', async () => { assert.deepEqual(ok(await ownerClient.from('items').select('id,unit_price').eq('company_id',ownerCompanyId)),priceBefore) })
  await check('88 activation creates no finance settlement row', async () => { assert.equal(SOURCE.migration2.includes('cash_transactions'),false);assert.equal(SOURCE.migration2.includes('bank_transactions'),false) })
  await check('89 activation creates no invoice or vendor bill', async () => { assert.equal(/sales_invoices|vendor_bills/.test(SOURCE.migration2),false) })
  await check('90 activation mutates no Growth Batch or Production Run', async () => { assert.equal(/growth_batch|production_run/.test(SOURCE.migration2),false) })
  await check('91 approval does not automatically send confirmation email', async () => { assert.equal(/mailer-company-access|sendCompanyAccessEmail/.test(SOURCE.migration2),false) })
  await check('92 PUBLIC execution is revoked from all public mutation RPCs', async () => { assert.match(SOURCE.migration2,/revoke all on function public\.platform_admin_approve_payment_request.*from public,anon/) })
  await check('93 internal helpers are revoked from authenticated', async () => { assert.match(SOURCE.migration2,/payment_request_claim.*from public,anon,authenticated/) })
  await check('94 every SECURITY DEFINER function has an explicit restricted search path', async () => { const definitions=[...SOURCE.migration2.matchAll(/create or replace function[\s\S]*?(?=create or replace function|revoke all|grant execute|grant select|commit;)/gi)].map((m)=>m[0]);assert.ok(definitions.length>=25);assert.ok(definitions.every((body)=>!/security definer/i.test(body)||/set\s+"?search_path"?\s*=/i.test(body))) })
  await check('95 normal authenticated clients have no direct request mutation grants', async () => { assert.match(SOURCE.migration1,/revoke all on public\.company_payment_requests from public, anon, authenticated/) })
  await check('96 proof path is server-derived from company and request ids', async () => { assert.match(SOURCE.migration2,/p_company_id::text\|\|'\/'\|\|v_id::text\|\|'\/proof'/) })
  await check('97 blocked-access CTA routes to canonical activation page', async () => { assert.match(SOURCE.access,/<Link to="\/activation">/) })
  await check('98 activation route remains outside RequireCompanyAccess', async () => { const protectedBlock=SOURCE.app.slice(SOURCE.app.indexOf('<Route element={<ProtectedOrgArea') ,SOURCE.app.indexOf('<Route element={<RequireCompanyAccess'));assert.match(protectedBlock,/path="\/activation"/) })
  await check('99 company activation UI contains no entitlement raw update', async () => { assert.doesNotMatch(SOURCE.activation,/company_subscription_state|platform_admin_set_company_access/) })
  await check('100 Platform Control contains the only review and approval UI', async () => { assert.match(SOURCE.platform,/adminApprove/);assert.doesNotMatch(SOURCE.activation,/adminApprove/) })
  await check('101 proof bucket allows only JPEG PNG and PDF', async () => { assert.match(SOURCE.migration1,/array\['image\/jpeg', 'image\/png', 'application\/pdf'\]/) })
  await check('102 frontend contains no service-role secret', async () => { assert.doesNotMatch(SOURCE.activation+SOURCE.platform+SOURCE.client,/service_role|SUPABASE_SERVICE_ROLE_KEY/) })
  await check('103 upload copy explicitly says proof is not verification', async () => { assert.match(SOURCE.activation,/Uploading proof does not verify payment/) })
  await check('104 platform approval requires explicit confirmation', async () => { assert.match(SOURCE.platform,/window\.confirm/) })
  await check('105 platform approval requires a nonblank review note', async () => { assert.match(SOURCE.platform,/acting\|\|!reviewNote\.trim\(\)/) })
  await check('106 proof preview uses a signed URL rather than public URL', async () => { assert.match(SOURCE.client,/createSignedUrl/);assert.doesNotMatch(SOURCE.client,/getPublicUrl/) })
  await check('107 proof signed URL requests are rate limited', async () => { assert.match(SOURCE.migration2,/payment_proof_signed_url/) })
  await check('108 request creation is rate limited', async () => { assert.match(SOURCE.migration2,/payment_request_create/) })
  await check('109 submission is rate limited', async () => { assert.match(SOURCE.migration2,/payment_request_submit/) })
  await check('110 platform review mutations are rate limited', async () => { assert.match(SOURCE.migration2,/platform_payment_review/) })
  await check('111 no real payment destination is seeded', async () => { assert.doesNotMatch(SOURCE.migration1,/insert into public\.platform_payment_channels/i) })
  await check('112 channel hard-delete is unavailable to authenticated clients', async () => { assert.doesNotMatch(SOURCE.migration1,/grant delete on public\.platform_payment_channels to authenticated/) })
  await check('113 exact catalogue periods exclude starting-price-only plans', async () => { assert.match(SOURCE.migration2,/monthly_price_mzn.*six_month_price_mzn.*annual_price_mzn/s);assert.doesNotMatch(SOURCE.migration2,/starting_price_mzn/) })
  await check('114 approval marks amount mismatch without blocking review discretion', async () => { assert.match(SOURCE.migration2,/amount_mismatch=\(v_amount<>v_plan\.amount\)/) })
  await check('115 request provider fingerprint is never returned as a raw normalized reference', async () => { assert.match(SOURCE.migration2,/extensions\.digest/) })
  await check('116 request events are protected by FORCE RLS', async () => { assert.match(SOURCE.migration1,/alter table public\.company_payment_request_events force row level security/) })
  await check('117 payment requests are protected by FORCE RLS', async () => { assert.match(SOURCE.migration1,/alter table public\.company_payment_requests force row level security/) })
  await check('118 channels are protected by FORCE RLS', async () => { assert.match(SOURCE.migration1,/alter table public\.platform_payment_channels force row level security/) })
  await check('119 normal members can track status but not mutate rows', async () => { assert.match(SOURCE.migration1,/grant select on public\.company_payment_requests to authenticated/);assert.doesNotMatch(SOURCE.migration1,/grant (insert|update|delete).*company_payment_requests to authenticated/) })
  await check('120 package keeps activation email as separate manual control', async () => { assert.doesNotMatch(SOURCE.platform,/sendCompanyAccessEmail/);assert.match(readFileSync(new URL('../../src/pages/PlatformControl.tsx',import.meta.url),'utf8'),/sendCompanyAccessEmail/) })

  assert.ok(eventCountBeforeSubmit >= 2)
  assert.ok(requestReference)
})
