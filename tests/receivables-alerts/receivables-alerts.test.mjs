import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const migration = await read('supabase/migrations/20260813065928_internal_receivables_alerts.sql')
const repairMigration = await read('supabase/migrations/20260820175131_repair_finance_notification_truth.sql')
const presentation = await read('src/lib/notificationPresentation.ts')
const navigation = await read('src/lib/notificationNavigation.ts')
const notificationCenter = await read('src/components/notifications/NotificationCenter.tsx')
const notificationsPage = await read('src/pages/Notifications.tsx')
const settings = await read('src/pages/Settings.tsx')
const settlements = await read('src/pages/Settlements.tsx')

const presentationModule = await import(`data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(presentation, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
).toString('base64')}`)

test('receivables alerts bind only to the canonical Package A AR contracts', () => {
  assert.match(migration, /from public\.v_customer_receivable_exposures e/i)
  assert.match(migration, /left join public\.v_customer_unapplied_credit c/i)
  assert.match(migration, /sum\(e\.outstanding_amount_base\)/i)
  assert.doesNotMatch(migration, /outstanding_amount_base\s*-\s*[^\n]*unapplied|unapplied_credit_base\s*-|unallocated_customer_credit\s*-/i)
  assert.match(migration, /and not e\.collections_suppressed/i)
})

test('one alert aggregates each company, customer, currency and configured bucket', () => {
  assert.match(migration, /group by e\.company_id,e\.customer_id,e\.currency_code,e\.bucket_offset_days/i)
  assert.match(migration, /count\(\*\)::integer document_count/i)
  assert.match(migration, /concat_ws\(':','receivables-due',r\.customer_id,r\.currency_code,r\.bucket_offset_days,p_local_day\)/i)
  assert.match(migration, /on conflict\(company_id,user_id,deduplication_key\)/i)
  assert.doesNotMatch(migration, /read_at\s*=\s*null|dismissed_at\s*=\s*null/i)
  assert.match(migration, /exposureChainIds/)
  assert.match(migration, /notificationsRefreshed/)
  assert.match(migration, /notifications_active_receivables_idx/)
})

test('recipient, preference and lifecycle contracts are database enforced', () => {
  for (const role of ['OWNER', 'ADMIN', 'MANAGER']) assert.match(migration, new RegExp(`'${role}'`))
  assert.doesNotMatch(
    migration.match(/for m in[\s\S]*?loop/i)?.[0] || '',
    /'OPERATOR'|'VIEWER'/i,
  )
  assert.match(migration, /np\.category='receivables'[\s\S]*np\.in_app_mode='off'/i)
  assert.match(migration, /set resolved_at=now\(\)/i)
  assert.match(migration, /e\.outstanding_amount_base>0\.005[\s\S]*not e\.collections_suppressed/i)
})

test('scheduler is server-side, timezone-aware and independent of customer email delivery', () => {
  assert.match(migration, /create extension if not exists pg_cron/i)
  assert.match(migration, /p_now at time zone v_timezone/i)
  assert.match(migration, /dueReminders,internalAlertsEnabled/i)
  assert.match(migration, /cron\.schedule\([\s\S]*stockwise-receivables-internal-alerts/i)
  assert.match(migration, /scheduleOffsetsDefaulted/)
  assert.match(migration, /jsonb_typeof\(coalesce\(r\.settings#>'\{dueReminders,leadDays\}'/i)
  assert.doesNotMatch(
    migration,
    /sendTransactionalEmail|supabase\.functions|net\.http|due-reminder-worker|smtp_/i,
  )
  assert.match(settings, /dueReminders\.internalAlertsEnabled/)
  assert.match(settings, /dueReminders\.enabled/)
  assert.match(settings, /settings\.dueReminders\.companySchedule/)
})

test('notification writes are internal while read/dismiss and self preferences remain usable', () => {
  assert.match(migration, /drop policy if exists notifications_insert_operator_plus_scoped/i)
  assert.match(migration, /revoke all on table public\.notifications from public, anon, authenticated/i)
  assert.match(migration, /grant select, update on table public\.notifications to authenticated/i)
  assert.match(migration, /revoke all on table public\.notification_preferences from public, anon, authenticated/i)
  assert.match(migration, /grant select, insert, update on table public\.notification_preferences to authenticated/i)
  assert.match(migration, /alter table public\.notifications force row level security/i)
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/i)
})

test('legacy approval notification triggers continue through a non-callable internal emitter', () => {
  assert.match(migration, /emit_cash_approval_notif[\s\S]*security definer[\s\S]*set search_path=pg_catalog,public,extensions/i)
  assert.match(migration, /tg_po_awaiting_notify\(\)[\s\S]*security definer/i)
  assert.match(migration, /tg_so_awaiting_notify\(\)[\s\S]*security definer/i)
  assert.match(migration, /revoke all on function public\.emit_cash_approval_notif[^;]+from public,anon,authenticated/i)
  assert.match(migration, /grant execute on function public\.emit_cash_approval_notif[^;]+to service_role/i)
})

test('PT and EN presentation shows aggregate outstanding and separate unapplied-credit context', () => {
  for (const event of ['due_soon', 'due_today', 'overdue', 'severely_overdue']) {
    assert.match(presentation, new RegExp(`receivables\\.${event}`))
  }
  assert.match(presentation, /Unallocated customer credit:/)
  assert.match(presentation, /Crédito de cliente não alocado:/)
  assert.match(presentation, /documentCount/)
  assert.match(presentation, /outstandingAmount/)
})

test('notification deep links revalidate access and await deliberate company switching', () => {
  assert.match(navigation, /from\('company_members'\)[\s\S]*\.eq\('status', 'active'\)/i)
  assert.match(navigation, /access\.access_enabled === true/i)
  assert.match(navigation, /companyFromUrl && companyFromUrl !== targetCompanyId/i)
  assert.match(navigation, /const switched = await setActiveCompany\(targetCompanyId\)/i)
  assert.match(notificationCenter, /prepareNotificationNavigation/)
  assert.match(notificationsPage, /prepareNotificationNavigation/)
  assert.match(notificationCenter, /company_id/)
  assert.match(notificationsPage, /company_id/)
})

test('notification action URLs cannot escape the StockWise origin', () => {
  const { safeNotificationActionUrl } = presentationModule
  assert.equal(safeNotificationActionUrl('/settlements?view=receipts'), '/settlements?view=receipts')
  assert.equal(safeNotificationActionUrl('https://evil.example/'), null)
  assert.equal(safeNotificationActionUrl('//evil.example/'), null)
  assert.equal(safeNotificationActionUrl('/\\evil.example/'), null)
})

test('the receivables deep link opens canonical customer AR context without netting credit', () => {
  assert.match(repairMigration, /view=exposure&side=ar&customerId=/)
  assert.match(repairMigration, /'arContext','customer-exposure'/)
  assert.match(settlements, /from\('v_customer_receivable_exposures'\)/)
  assert.doesNotMatch(settlements, /\.eq\('anchor_kind', 'sales_invoice'\)\s*\.order\('due_date'/)
  assert.match(settlements, /from\('v_customer_unapplied_credit'\)/)
  assert.match(settlements, /data-testid="customer-receivables-context"/)
  assert.match(settlements, /data-testid="alert-receivables-context"/)
  assert.match(settlements, /data-testid="customer-receivables-open-documents"/)
  assert.match(settlements, /data-testid="customer-unapplied-credit"/)
  assert.match(settlements, /searchParams\.get\('customerId'\)/)
})

test('rollback-only local SQL matrix passes when the reset local stack is available', async (context) => {
  const sql = await read('tests/receivables-alerts/receivables-alerts.sql')
  const probe = spawnSync(
    'docker',
    [
      'exec', 'supabase_db_Stockwise', 'psql', '-U', 'postgres', '-d', 'postgres', '-At',
      '-c', "select position('notificationsRefreshed' in coalesce(pg_get_functiondef(to_regprocedure('public.evaluate_receivable_internal_alerts(uuid,date,text,integer[])')),''))>0",
    ],
    { encoding: 'utf8' },
  )
  if (probe.error?.code === 'ENOENT') {
    context.skip('Docker is unavailable; run after the local Supabase stack is restored.')
    return
  }
  if (probe.status !== 0 || probe.stdout.trim() !== 't') {
    context.skip('The local database has not been reset to the current Package C migration yet.')
    return
  }
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_Stockwise', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const output = `${result.stdout}\n${result.stderr}`
  assert.match(output, /PASS aggregate, currency, preference, dedupe and resolution/)
  assert.match(output, /PASS notification forgery and emitter calls denied/)
  assert.match(output, /PASS PO and SO approval notification continuity/)
  assert.match(output, /PASS atomic POS cash and bank notification suppression/)
})
