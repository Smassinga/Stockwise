import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const migration = await read('supabase/migrations/20260813065922_platform_admin_assisted_customer_provisioning.sql')

test('assisted provisioning keeps authority narrower than normal company membership', () => {
  assert.match(migration, /create or replace function public\.platform_admin_provision_customer_company/)
  assert.match(migration, /owner_user_id[\s\S]*null/)
  assert.match(migration, /subscription_status[\s\S]*'disabled'/)
  assert.match(migration, /platform_admin_has_workspace_company\(company_id\)/)
  assert.match(migration, /stockwise\.assisted_setup_operation[\s\S]*opening_stock_import/)
  assert.match(migration, /platform_admin_post_opening_stock_import/)
  assert.match(migration, /platform_admin_update_assisted_item_min_stock/)
  assert.match(migration, /platform_admin_update_assisted_item_min_stock\([\s\S]*?p_item_id uuid/)
  assert.match(migration, /create_item_with_profile[\s\S]*platform_admin_has_workspace_company\(p_company_id\)/)
  assert.doesNotMatch(migration, /create policy items_(?:insert|update)_platform_workspace/i)
  assert.match(migration, /bins_update_platform_workspace[\s\S]*w\.id = bins\."warehouseId"[\s\S]*w\.company_id = bins\.company_id/i)
  assert.doesNotMatch(migration, /create policy company_settings_(?:insert|update)_platform_workspace/i)
  assert.match(migration, /company_currencies_delete_platform_workspace[\s\S]*cs\.base_currency_code = company_currencies\.currency_code/i)
  assert.match(migration, /company_settings_enabled_base_currency_fkey[\s\S]*foreign key \(company_id, base_currency_code\)[\s\S]*company_currencies \(company_id, currency_code\)/i)
  assert.match(migration, /customers_insert_platform_workspace[\s\S]*pt\.company_id = customers\.company_id/i)
  assert.match(migration, /suppliers_insert_platform_workspace[\s\S]*pt\.company_id = suppliers\.company_id/i)
  assert.match(migration, /fx_rates_insert_platform_workspace[\s\S]*lower\(rate::text\) not in \('nan', 'infinity', '-infinity'\)/i)
  assert.match(migration, /r\.qty::text[\s\S]*'nan', 'infinity', '-infinity'/i)
  assert.doesNotMatch(migration, /create or replace function public\.(?:current_company_id|current_user_company_ids|has_company_role|actor_role_for)/i)
  const accessFunction = migration.match(/create or replace function public\.company_access_is_enabled[\s\S]*?\n\$\$;/i)?.[0] || ''
  assert.equal(accessFunction, '')
  const platformAdminFunction = migration.match(/create or replace function public\.is_platform_admin\(\)[\s\S]*?\n\$\$;/i)?.[0] || ''
  const workspacePredicate = migration.match(/create or replace function public\.platform_admin_has_workspace_company[\s\S]*?\n\$\$;/i)?.[0] || ''
  assert.match(platformAdminFunction, /pa\.user_id = auth\.uid\(\)/)
  assert.doesNotMatch(platformAdminFunction, /auth\.jwt|pa\.email/i)
  assert.match(workspacePredicate, /coalesce\([\s\S]*platform_admin_workspace_company_id\(\)[\s\S]*false[\s\S]*\)/i)
  assert.match(migration, /revoke all on function public\.tg_guard_assisted_company_owner\(\) from public, anon, authenticated/i)
  assert.match(migration, /tg_guard_warehouse_delete_inventory_evidence[\s\S]*stock_levels[\s\S]*stock_movements[\s\S]*warehouse_has_inventory_evidence/i)
  assert.match(migration, /tg_guard_bin_delete_inventory_evidence[\s\S]*stock_levels[\s\S]*stock_movements[\s\S]*bin_has_inventory_evidence/i)
  assert.match(migration, /revoke all on function public\.link_membership_for_me\(uuid\) from public, anon/i)
  assert.match(migration, /grant execute on function public\.link_membership_for_me\(uuid\) to authenticated, service_role/i)
})

test('Edge invitation authority is bound to the authenticated user id', async () => {
  const [adminUsers, mailerInvite] = await Promise.all([
    read('supabase/functions/admin-users/index.ts'),
    read('supabase/functions/mailer-invite/index.ts'),
  ])
  const actorMembership = adminUsers.match(/async function loadActorMembership[\s\S]*?\n}/)?.[0] || ''
  const actorRole = mailerInvite.match(/async function getActorRole[\s\S]*?\n}/)?.[0] || ''
  assert.match(actorMembership, /\.eq\("user_id", userId\)/)
  assert.doesNotMatch(actorMembership, /\.eq\("email", userEmail\)/)
  assert.match(actorRole, /\.eq\("user_id", userId\)/)
  assert.doesNotMatch(actorRole, /\.eq\("email", userEmail\)/)
})

test('assisted workspace membership authority is read-only in the admin Edge function', async () => {
  const adminUsers = await read('supabase/functions/admin-users/index.ts')
  const mutationDenials = adminUsers.match(
    /guard\.authority === "platform_workspace"[\s\S]*?platform_workspace_member_mutation_not_allowed/g,
  ) ?? []
  assert.equal(mutationDenials.length, 5)
})

test('platform admin bootstrap cannot create an active email-only authority row', async () => {
  const bootstrap = await read('scripts/bootstrap-platform-admin.mjs')
  assert.match(migration, /platform_admins_active_user_required[\s\S]*not is_active or user_id is not null/i)
  assert.match(bootstrap, /if \(!userId\)[\s\S]*process\.exit\(1\)/)
})

test('owner handover and trial are explicit, exact and one-time', () => {
  assert.match(migration, /tg_guard_assisted_company_owner/)
  assert.match(migration, /assisted_owner_change_requires_invitation_acceptance/)
  assert.match(migration, /lower\(i\.email::text\) = v_email/)
  assert.match(migration, /invite_email_mismatch/)
  assert.match(migration, /delete from public\.platform_admin_workspace_contexts[\s\S]*company_id = p_company_id/)
  assert.match(migration, /assisted_owner_activation_required_before_trial/)
  assert.match(migration, /v_expires := v_now \+ interval '7 days'/)
  assert.match(migration, /assisted_trial_cannot_be_restarted/)
  assert.match(migration, /new\.trial_started_at := old\.trial_started_at/)
  assert.match(migration, /stockwise_email_is_active_platform_admin/)
  assert.match(migration, /assisted_invitee_must_not_be_platform_admin/)
  const acceptanceFunction = migration.match(/create or replace function public\.stockwise_accept_company_invitation[\s\S]*?\n\$\$;/i)?.[0] || ''
  assert.match(acceptanceFunction, /assisted_company_provisioning[\s\S]*stockwise_email_is_active_platform_admin\(v_email\)[\s\S]*assisted_invitee_must_not_be_platform_admin/)
})

test('invitation discovery cannot activate or take over another identity', () => {
  const linkFunction = migration.match(/create or replace function public\.link_invites_to_user[\s\S]*?\n\$\$;/i)?.[0] || ''
  const syncFunction = migration.match(/create or replace function public\.sync_invites_for_me[\s\S]*?\n\$\$;/i)?.[0] || ''
  assert.match(linkFunction, /auth\.jwt\(\) ->> 'role'[\s\S]*service_role/)
  assert.match(linkFunction, /p_user_id is distinct from auth\.uid\(\)/)
  assert.doesNotMatch(linkFunction, /status\s*=\s*'active'/i)
  assert.doesNotMatch(linkFunction, /accepted_at\s*=/i)
  assert.doesNotMatch(syncFunction, /status\s*=\s*'active'/i)
  assert.doesNotMatch(syncFunction, /accepted_at\s*=/i)
})

test('frontend exposes an explicit localized, route-keyed setup workspace only', async () => {
  const [app, shell, org, openingImport] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/platform/AssistedWorkspaceShell.tsx'),
    read('src/hooks/useOrg.tsx'),
    read('src/pages/OpeningImport.tsx'),
  ])
  const workspaceRoutes = app.match(/<Route path="\/platform-workspace\/:companyId"[\s\S]*?<\/Route>/)?.[0] || ''
  for (const route of ['settings', 'warehouses', 'items', 'customers', 'suppliers', 'setup/import', 'users', 'currency']) {
    assert.match(workspaceRoutes, new RegExp(`path="${route.replace('/', '\\/')}"`))
  }
  for (const forbidden of ['dashboard', 'orders', 'settlements', 'operator', 'production-runs', 'growth-batches']) {
    assert.doesNotMatch(workspaceRoutes, new RegExp(`path="${forbidden}"`))
  }
  assert.match(app, /<OrgProvider key=\{companyId\} platformWorkspaceCompanyId=\{companyId\}>/)
  assert.match(shell, /platform\.assisted\.contextLabel/)
  assert.match(shell, /sections\.warehouses\.title/)
  assert.match(shell, /setup\.areas\.opening_data\.title/)
  assert.match(shell, /Return to Platform Control/)
  assert.match(org, /authorityMode:\s*platformWorkspaceCompanyId \? 'platform_workspace' : 'membership'/)
  assert.doesNotMatch(org, /supabase\.rpc\(['"]accept_my_invite/)
  assert.match(openingImport, /authorityMode === 'platform_workspace'[\s\S]*platform_admin_post_opening_stock_import/)
})

test('assisted provisioning passes the rollback-only local SQL security matrix', (context) => {
  const sqlPath = new URL('./assisted-provisioning.sql', import.meta.url)
  const sqlResult = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_Stockwise', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: readFileSync(sqlPath, 'utf8'), encoding: 'utf8' },
  )
  if (sqlResult.error?.code === 'ENOENT') {
    context.skip('Docker is unavailable; run this test when the local Supabase stack is active.')
    return
  }
  assert.equal(sqlResult.status, 0, `${sqlResult.stdout}\n${sqlResult.stderr}`)
  const output = `${sqlResult.stdout}\n${sqlResult.stderr}`
  for (const evidence of [
    'PASS ownerless shell and trial not started',
    'PASS active platform administrator requires an Auth user identity',
    'PASS stale platform administrator email has no platform or reset authority',
    'PASS platform administrator identity cannot become assisted tenant member or owner',
    'PASS platform administrator cannot accept an assisted invite after changing email',
    'PASS normal user and missing workspace denied',
    'PASS empty assisted warehouse remains deletable',
    'PASS empty assisted bin remains deletable',
    'PASS narrow workspace setup and no membership authority',
    'PASS warehouse inventory evidence blocks deletion',
    'PASS bin inventory evidence blocks deletion',
    'PASS assisted bin remains in its company warehouse',
    'PASS assisted customer and supplier terms remain company scoped',
    'PASS assisted item profile uses governed creation and minimum-stock update',
    'PASS assisted base currency remains governed and enabled',
    'PASS base currency enabled invariant survives privileged concurrent writes',
    'PASS non-finite assisted opening quantities rejected',
    'PASS direct owner assignment denied',
    'PASS wrong-email acceptance denied',
    'PASS exact owner handover closes context',
    'PASS exact one-time seven-day trial',
    'PASS self-service onboarding preserved',
  ]) assert.match(output, new RegExp(evidence))
})
