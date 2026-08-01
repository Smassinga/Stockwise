import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const identitySource = await read('supabase/functions/_shared/emailIdentity.ts')
const mailer = await read('supabase/functions/_shared/mailer.ts')
const templates = await read('supabase/functions/_shared/emailTemplates.ts')
const reminderMigration = await read('supabase/migrations/20260801171022_adaptive_due_reminder_lifecycle.sql')
const identityMigration = await read('supabase/migrations/20260801171011_company_communication_identity.sql')
const worker = await read('supabase/functions/due-reminder-worker/index.ts')
const settings = await read('src/pages/Settings.tsx')
const lab = await read('supabase/functions/email-template-lab/index.ts')
const labUi = await read('src/components/platform/EmailTemplateLab.tsx')
const { resolveEmailIdentity } = await import('../../supabase/functions/_shared/emailIdentity.ts')
const { renderDiscriminatedEmail } = await import('../../supabase/functions/_shared/emailTemplates.ts')

const base = { company: { name: 'Leny Doçuras', email: 'hello@leny.example' }, communicationSettings: { financeEmail: 'finance@leny.example', invitationReplyToEmail: 'invite@leny.example' }, technicalFromEmail: 'notifications@stockwiseapp.com', stockWiseReplyToEmail: 'support@stockwiseapp.com', stockWiseReplyToName: 'StockWise Support' }

test('central identity resolver applies all four company-aware categories', () => {
  const reminder = resolveEmailIdentity({ ...base, templateKey: 'due_reminder_sales_invoice', language: 'en' })
  assert.equal(reminder.fromName, 'Leny Doçuras'); assert.equal(reminder.fromEmail, 'notifications@stockwiseapp.com'); assert.equal(reminder.replyToEmail, 'finance@leny.example'); assert.equal(reminder.replyToName, 'Leny Doçuras — Finance')
  const digest = resolveEmailIdentity({ ...base, templateKey: 'daily_digest', language: 'en' })
  assert.equal(digest.fromName, 'StockWise for Leny Doçuras'); assert.equal(digest.replyToEmail, 'hello@leny.example')
  const invite = resolveEmailIdentity({ ...base, templateKey: 'member_invite', inviter: { name: 'Samuel', email: 'samuel@example.com' }, language: 'pt' })
  assert.equal(invite.fromName, 'Leny Doçuras via StockWise'); assert.equal(invite.replyToEmail, 'samuel@example.com')
  const access = resolveEmailIdentity({ ...base, templateKey: 'company_access_expiry', language: 'pt' })
  assert.equal(access.fromName, 'StockWise'); assert.equal(access.replyToEmail, 'support@stockwiseapp.com')
})

test('mailer passes message-level Reply-To name and immutable identity evidence', () => {
  assert.match(mailer, /replyToName\?: string \| null/)
  assert.match(mailer, /message\.replyToName \|\| ready\.defaultReplyToName \|\| message\.fromName/)
  for (const field of ['from_name','from_email','reply_to_name','reply_to_email','identity_category','company_name_snapshot']) assert.match(mailer, new RegExp(field))
  assert.match(identityMigration, /alter table app\.mail_dispatch_events[\s\S]*add column from_name/)
  assert.doesNotMatch(identityMigration, /body_html|rendered_html/i)
})

test('adaptive reminder subjects and copy are exact in EN and PT', () => {
  const brand = { companyName: 'Leny Doçuras', subjectCompanyLabel: 'Leny Doçuras' }
  const render = (language, offset, state, tone) => renderDiscriminatedEmail(language, { templateKey: 'due_reminder_sales_invoice', brand, recipientName: 'Cliente QA', documentReference: 'LEN-INV0004', issueDate: '1 August 2026', dueDate: '4 August 2026', totalAmount: 25000, outstandingAmount: 15000, currencyCode: 'MZN', stageOffsetDays: offset, daysUntilDue: offset, relativeState: state, tone, actionUrl: 'https://stockwiseapp.com/sales-invoices/qa' })
  assert.equal(render('en', 7, 'upcoming', 'friendly').subject, 'Leny Doçuras — Invoice LEN-INV0004 is due in 7 days')
  assert.equal(render('en', 1, 'due_tomorrow', 'gentle_urgency').subject, 'Leny Doçuras — Invoice LEN-INV0004 is due tomorrow')
  assert.equal(render('pt', 0, 'due_today', 'action_required').subject, 'Leny Doçuras — A Fatura LEN-INV0004 vence hoje')
  assert.equal(render('pt', -3, 'overdue', 'overdue').subject, 'Leny Doçuras — A Fatura LEN-INV0004 está vencida há 3 dias')
  assert.equal(render('en', -15, 'overdue', 'escalated').subject, 'Leny Doçuras — Invoice LEN-INV0004 remains unpaid after 15 days')
  assert.match(render('pt', -15, 'overdue', 'escalated').text, /MZN 15\.000,00/)
})

test('stage ledger versioning, atomic claim and missed-run selection are durable', () => {
  assert.match(reminderMigration, /unique\(company_id,anchor_kind,anchor_id,due_date_snapshot,stage_offset_days,recipient,language\)/i)
  assert.match(reminderMigration, /due_date_snapshot<>/)
  assert.match(reminderMigration, /status='superseded'/)
  assert.match(reminderMigration, /on conflict \(company_id,anchor_kind,anchor_id,due_date_snapshot,stage_offset_days,recipient,language\)/i)
  assert.match(reminderMigration, /status='processing'/)
  assert.match(reminderMigration, /select min\(d\)::integer offset_days/)
  assert.match(reminderMigration, /d >= \(r->>'days_until_due'\)::integer/)
  assert.match(worker, /build_adaptive_due_reminder_batch/)
  assert.match(worker, /eligibility\.recheck/)
  assert.match(worker, /reserve_due_reminder_stage/)
  assert.match(worker, /finish_due_reminder_stage/)
})

test('active anchor remains server authoritative and one stage is sent per run', () => {
  assert.match(reminderMigration, /build_due_reminder_batch/)
  assert.match(worker, /Sales Invoice|sales_invoice/i)
  assert.match(worker, /for \(const row of reminders\)/)
  assert.match(worker, /if \(!stageId\) continue/)
})

test('settings preserve offsets and require explicit preset application', () => {
  assert.match(settings, /data\.dueReminders\?\.leadDays/)
  assert.match(settings, /Apply recommended preset/)
  assert.match(settings, /setReminderLeadDays\(\[7, 3, 1, 0, -3, -15, -30\]\)/)
  assert.match(settings, /value >= -365 && value <= 365/)
  assert.match(settings, /company_communication_profiles/)
  assert.match(settings, /Finance and collections email/)
  assert.match(settings, /notifications@stockwiseapp\.com/)
})

test('Template Lab exposes identity and all seven lifecycle scenarios', () => {
  assert.match(lab, /identity/); assert.match(lab, /reminderStage/); assert.match(lab, /stage_offset_days/)
  assert.match(lab, /language === "pt" \? "15 de Agosto de 2026" : "15 August 2026"/)
  assert.match(lab, /language === "pt" \? "31 de Julho de 2026" : "31 July 2026"/)
  assert.match(lab, /documentReference: "QA-INV-0002"/)
  for (const offset of [7,3,1,0,-3,-15,-30]) assert.match(labUi, new RegExp(`['\"]?${offset}['\"]?`))
})

test('security controls cover company communication settings and private stages', () => {
  assert.match(identityMigration, /enable row level security/); assert.match(identityMigration, /force row level security/)
  assert.match(identityMigration, /has_company_role\(company_id, array\['OWNER'::public\.member_role,'ADMIN'::public\.member_role\]\)/)
  assert.match(reminderMigration, /revoke all on table app\.due_reminder_stage_dispatches from public,anon,authenticated/)
  assert.match(reminderMigration, /set search_path = pg_catalog, public, app/)
})

test('template versions advance for inbox-visible COMMS-3 semantics', () => {
  for (const pair of ['member_invite: 3','report_ready: 4','daily_digest: 3','due_reminder_sales_order: 4','due_reminder_sales_invoice: 4','company_access_expiry: 3','company_access_purge: 3','company_access_activation: 3']) assert.match(templates, new RegExp(pair))
})
