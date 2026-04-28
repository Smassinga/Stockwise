import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAdminClient,
  createTempUser,
  deleteAuthUser,
  expectPostgrestError,
  setActiveCompany,
  signIn,
  unwrapRpcSingle,
} from './helpers.mjs'

const PREFIX = `onb-${Date.now().toString(36)}`

async function safeDelete(operation) {
  try {
    await operation()
  } catch (error) {
    console.warn('[onboarding-regression] cleanup warning', error?.message || error)
  }
}

async function cleanupCompany(admin, companyId) {
  if (!companyId) return

  await safeDelete(() => admin.from('company_invites').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('company_access_audit_log').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('company_purge_queue').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('company_subscription_state').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('user_active_company').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('payment_terms').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('company_settings').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('company_members').delete().eq('company_id', companyId))
  await safeDelete(() => admin.from('companies').delete().eq('id', companyId))
}

function expectNoError(result, message) {
  assert.equal(result.error, null, message || result.error?.message || 'Unexpected Supabase error')
  return result.data
}

test('Onboarding and company invitation flow', async (t) => {
  const admin = createAdminClient()
  const created = {
    companyIds: new Set(),
    userIds: new Set(),
  }

  t.after(async () => {
    for (const companyId of created.companyIds) {
      await cleanupCompany(admin, companyId)
    }
    for (const userId of created.userIds) {
      await deleteAuthUser(admin, userId)
    }
  })

  const ownerUser = await createTempUser(admin, PREFIX, 'owner')
  const invitedUser = await createTempUser(admin, PREFIX, 'invited')
  const createChoiceUser = await createTempUser(admin, PREFIX, 'create-choice')
  const expiredUser = await createTempUser(admin, PREFIX, 'expired')
  const cleanUser = await createTempUser(admin, PREFIX, 'clean')
  const strangerUser = await createTempUser(admin, PREFIX, 'stranger')
  for (const user of [ownerUser, invitedUser, createChoiceUser, expiredUser, cleanUser, strangerUser]) {
    created.userIds.add(user.userId)
  }

  const ownerClient = await signIn(ownerUser.email, ownerUser.password)
  const invitedClient = await signIn(invitedUser.email, invitedUser.password)
  const createChoiceClient = await signIn(createChoiceUser.email, createChoiceUser.password)
  const expiredClient = await signIn(expiredUser.email, expiredUser.password)
  const cleanClient = await signIn(cleanUser.email, cleanUser.password)
  const strangerClient = await signIn(strangerUser.email, strangerUser.password)

  const rpcProbe = await cleanClient.rpc('list_my_pending_company_invitations')
  if (rpcProbe.error?.code === 'PGRST202') {
    t.diagnostic(
      'Skipping onboarding invitation regression because migration 20260428194000 is not applied in the target Supabase environment.',
    )
    return
  }
  if (rpcProbe.error) throw rpcProbe.error

  let ownerCompanyId = null

  await t.test('New user without invitations can bootstrap directly', async () => {
    const bootstrap = unwrapRpcSingle(expectNoError(
      await cleanClient.rpc('create_company_and_bootstrap', {
        p_name: `${PREFIX} Clean Company`,
      }),
      'Expected clean user bootstrap to succeed',
    ))

    assert.ok(bootstrap?.out_company_id, 'Expected bootstrap to return a company id')
    created.companyIds.add(bootstrap.out_company_id)
    await setActiveCompany(cleanClient, bootstrap.out_company_id)

    assert.equal((rpcProbe.data || []).length, 0)
  })

  await t.test('Owner can invite another user and only the invited account can discover it', async () => {
    const bootstrap = unwrapRpcSingle(
      expectNoError(
        await ownerClient.rpc('create_company_and_bootstrap', {
          p_name: `${PREFIX} Owner Company`,
        }),
        'Expected owner bootstrap to succeed',
      ),
    )

    ownerCompanyId = bootstrap.out_company_id
    created.companyIds.add(ownerCompanyId)
    await setActiveCompany(ownerClient, ownerCompanyId)

    const { data: inviteToken, error: inviteError } = await ownerClient.rpc('invite_company_member', {
      p_company: ownerCompanyId,
      p_email: invitedUser.email.toLowerCase(),
      p_role: 'MANAGER',
    })
    if (inviteError) throw inviteError
    assert.ok(inviteToken, 'Expected invite creation to return a token')

    const pendingInvites = expectNoError(
      await invitedClient.rpc('list_my_pending_company_invitations'),
      'Expected invited user pending invite lookup to succeed',
    )
    assert.equal(pendingInvites.length, 1)
    assert.equal(pendingInvites[0].company_id, ownerCompanyId)
    assert.equal(pendingInvites[0].role, 'MANAGER')
    assert.equal(pendingInvites[0].invitation_status, 'pending')
    assert.ok(pendingInvites[0].expires_at, 'Expected invite expiry metadata')

    const strangerInvites = expectNoError(
      await strangerClient.rpc('list_my_pending_company_invitations'),
      'Expected unrelated user invite lookup to succeed',
    )
    assert.equal(strangerInvites.length, 0)

    await expectPostgrestError(
      strangerClient.rpc('accept_invite_with_token', { p_token: inviteToken }),
      'invite_email_mismatch',
    )
  })

  await t.test('Invited user can accept the pending invitation and enter the invited company context', async () => {
    const acceptResult = await invitedClient.rpc('accept_my_invite', { p_company_id: ownerCompanyId })
    if (acceptResult.error) throw acceptResult.error
    assert.equal(acceptResult.data, true)

    await setActiveCompany(invitedClient, ownerCompanyId)

    const { data: membershipRows, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, user_id, email, role, status')
      .eq('company_id', ownerCompanyId)
      .eq('email', invitedUser.email.toLowerCase())

    if (membershipError) throw membershipError
    assert.equal(membershipRows.length, 1)
    assert.equal(membershipRows[0].user_id, invitedUser.userId)
    assert.equal(membershipRows[0].status, 'active')
    assert.equal(membershipRows[0].role, 'MANAGER')

    const pendingAfterAccept = expectNoError(
      await invitedClient.rpc('list_my_pending_company_invitations'),
      'Expected invite list to clear after acceptance',
    )
    assert.equal(pendingAfterAccept.length, 0)
  })

  await t.test('Invited user can create a new company without consuming the invitation', async () => {
    const { data: inviteToken, error: inviteError } = await ownerClient.rpc('invite_company_member', {
      p_company: ownerCompanyId,
      p_email: createChoiceUser.email.toLowerCase(),
      p_role: 'VIEWER',
    })
    if (inviteError) throw inviteError
    assert.ok(inviteToken, 'Expected create-choice invite creation to return a token')

    const beforeCreateInvites = expectNoError(
      await createChoiceClient.rpc('list_my_pending_company_invitations'),
      'Expected create-choice user invite list lookup to succeed',
    )
    assert.equal(beforeCreateInvites.length, 1)
    assert.equal(beforeCreateInvites[0].company_id, ownerCompanyId)

    const bootstrap = unwrapRpcSingle(
      expectNoError(
        await createChoiceClient.rpc('create_company_and_bootstrap', {
          p_name: `${PREFIX} Created Company`,
        }),
        'Expected invited user create-company bootstrap to succeed',
      ),
    )

    assert.ok(bootstrap?.out_company_id, 'Expected invited user bootstrap to create a company')
    assert.notEqual(bootstrap.out_company_id, ownerCompanyId)
    created.companyIds.add(bootstrap.out_company_id)
    await setActiveCompany(createChoiceClient, bootstrap.out_company_id)

    const secondBootstrap = unwrapRpcSingle(
      expectNoError(
        await createChoiceClient.rpc('create_company_and_bootstrap', {
          p_name: `${PREFIX} Created Company Again`,
        }),
        'Expected repeated bootstrap to return the active company',
      ),
    )
    assert.equal(secondBootstrap.out_company_id, bootstrap.out_company_id)

    const pendingAfterCreate = expectNoError(
      await createChoiceClient.rpc('list_my_pending_company_invitations'),
      'Expected create-choice user invite list to remain available after company creation',
    )
    assert.equal(pendingAfterCreate.length, 1)
    assert.equal(pendingAfterCreate[0].company_id, ownerCompanyId)

    const { data: createChoiceMemberships, error: membershipsError } = await admin
      .from('company_members')
      .select('company_id, status')
      .eq('email', createChoiceUser.email.toLowerCase())
      .order('company_id', { ascending: true })
    if (membershipsError) throw membershipsError

    const invitedMembership = createChoiceMemberships.find((row) => row.company_id === ownerCompanyId)
    const ownedMembership = createChoiceMemberships.find((row) => row.company_id === bootstrap.out_company_id)
    assert.equal(invitedMembership?.status, 'invited')
    assert.equal(ownedMembership?.status, 'active')

    const companyProfileUpdate = await createChoiceClient
      .from('companies')
      .update({
        legal_name: `${PREFIX} Created Legal, Lda`,
        address_line1: 'Avenida de Teste 100',
        city: 'Maputo',
      })
      .eq('id', bootstrap.out_company_id)
    if (companyProfileUpdate.error) throw companyProfileUpdate.error
  })

  await t.test('Expired invitations are excluded from the onboarding list and rejected on accept', async () => {
    const { data: inviteToken, error: inviteError } = await ownerClient.rpc('invite_company_member', {
      p_company: ownerCompanyId,
      p_email: expiredUser.email.toLowerCase(),
      p_role: 'VIEWER',
    })
    if (inviteError) throw inviteError
    assert.ok(inviteToken, 'Expected expired invite creation to return a token')

    const { error: expireError } = await admin
      .from('company_invites')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('token', inviteToken)
    if (expireError) throw expireError

    const expiredList = expectNoError(
      await expiredClient.rpc('list_my_pending_company_invitations'),
      'Expected expired user invite list lookup to succeed',
    )
    assert.equal(expiredList.length, 0)

    await expectPostgrestError(
      expiredClient.rpc('accept_my_invite', { p_company_id: ownerCompanyId }),
      'invite_invalid_or_expired',
    )

    await expectPostgrestError(
      expiredClient.rpc('accept_invite_with_token', { p_token: inviteToken }),
      'invalid_or_expired',
    )
  })
})
