import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const templates = await read('supabase/functions/_shared/emailTemplates.ts')
const layout = await read('supabase/functions/_shared/emailLayout.ts')
const lab = await read('supabase/functions/email-template-lab/index.ts')
const invite = await read('supabase/functions/mailer-invite/index.ts')
const report = await read('supabase/functions/mailer-report/index.ts')
const digest = await read('supabase/functions/digest-worker/index.ts')
const reminders = await read('supabase/functions/due-reminder-worker/index.ts')
const access = await read('supabase/functions/mailer-company-access/index.ts')
const { renderDiscriminatedEmail } = await import('../../supabase/functions/_shared/emailTemplates.ts')

const block = (start, end) => templates.slice(templates.indexOf(start), templates.indexOf(end))

test('template payloads are a discriminated key-to-input map without generic metric bags', () => {
  for (const name of ['MemberInviteEmailInput', 'ReportReadyEmailInput', 'DailyDigestEmailInput', 'DueReminderEmailInput', 'CompanyAccessExpiryEmailInput', 'CompanyAccessPurgeEmailInput', 'CompanyAccessActivationEmailInput']) assert.match(templates, new RegExp(`type ${name}`))
  assert.match(templates, /EmailTemplateInputMap/)
  assert.doesNotMatch(templates, /metrics\?: Record<string/)
  assert.doesNotMatch(templates, /\bany\b/)
})

test('invitation content is purpose-specific in EN and PT', () => {
  const source = block('function renderMember', 'function renderReport')
  for (const copy of ['You have been invited to join', 'Foi convidado para entrar na', 'Accept invitation', 'Aceitar convite', 'never ask for your password', 'nunca lhe pedirá a palavra-passe']) assert.match(source, new RegExp(copy))
  assert.doesNotMatch(source, /Operational sales|Gross profit|dueDate|documentReference|Sales Order/)
})

test('report content includes period and optional filters but no collection evidence', () => {
  const source = block('function renderReport', 'function renderDigest')
  assert.match(source, /reportName/); assert.match(source, /input\.period/); assert.match(source, /input\.filters/)
  assert.doesNotMatch(source, /dueDate|outstandingAmount|roleName|Gross profit/)
})

test('digest owns all ten operational metrics and incomplete-cost warning', () => {
  const source = block('function renderDigest', 'function renderReminder')
  for (const field of ['operationalSales','knownCogs','grossProfit','grossMargin','transactions','openOrders','lowStockItems','outOfStockItems','missingCostEvidence','topProductsServices']) assert.match(source, new RegExp(field))
  assert.match(source, /Some sales are missing cost evidence/)
  assert.match(source, /Algumas vendas não têm evidência de custo completa/)
})

test('reminder families have distinct customer copy and no internal recognition wording', () => {
  const source = block('function renderReminder', 'function renderExpiry')
  assert.match(source, /Payment reminder for/); assert.match(source, /Lembrete de pagamento da/)
  assert.match(source, /View Sales Order/); assert.match(source, /View invoice/)
  assert.doesNotMatch(source, /active financial document|operational recognition|linkedOrder/)
})

test('access families exclude operational and document fields', () => {
  const source = templates.slice(templates.indexOf('function renderExpiry'), templates.indexOf('function renderAdaptiveReminder'))
  assert.match(source, /will not charge you automatically/); assert.match(source, /não efectua cobranças automáticas/)
  assert.match(source, /cannot be restored through the application/); assert.match(source, /não poderão ser recuperados através da aplicação/)
  assert.doesNotMatch(source, /operationalSales|documentReference|Gross profit|Sales Order/)
})

test('versions advance with template semantics', () => {
  for (const pair of ['member_invite: 3','report_ready: 4','daily_digest: 3','due_reminder_sales_order: 4','due_reminder_sales_invoice: 4','company_access_expiry: 3','company_access_purge: 3','company_access_activation: 3']) assert.match(templates, new RegExp(pair))
})

test('brand layout is email-safe, green, responsive and semantically restrained', () => {
  assert.match(layout, /<table role="presentation"/); assert.match(layout, /max-width:620px/)
  assert.match(layout, /STOCKWISE_EMAIL_BRAND\.accent/); assert.doesNotMatch(layout, /gradient|purple|lavender|#fef3c7/i)
  assert.match(layout, /destructive/); assert.match(layout, /#A63D40/)
  assert.match(layout, /alt="\$\{escapeEmailHtml\(identity\)\} logo"/)
})

test('QA scenarios are isolated per template and expose preview metadata', () => {
  for (const key of ['member_invite','report_ready','daily_digest','due_reminder_sales_order','due_reminder_sales_invoice','company_access_expiry','company_access_purge','company_access_activation']) assert.match(lab, new RegExp(`${key}: \\{ templateKey: "${key}"`))
  assert.match(lab, /semanticVariant/); assert.match(lab, /requiredFields/); assert.match(lab, /scenarioLabel/)
  assert.doesNotMatch(lab, /const scenario = \{[\s\S]*documentReference[\s\S]*planName[\s\S]*metrics/)
})

test('all production callers pass their own discriminant and current version', () => {
  assert.match(invite, /templateKey: "member_invite"/); assert.match(invite, /templateVersion: 3/)
  assert.match(report, /templateKey: "report_ready"/); assert.match(report, /templateVersion: 4/)
  assert.match(digest, /templateKey: "daily_digest"/); assert.match(digest, /templateVersion: 3/)
  assert.match(reminders, /outstandingAmount: row\.amount/); assert.match(reminders, /templateVersion: 4/)
  assert.match(access, /templateVersion: shared\.templateVersion/)
})

test('rendering escapes values and validates action origins', () => {
  assert.match(layout, /escapeEmailHtml/); assert.match(templates, /email_action_url_not_allowed/)
  assert.match(templates, /https:\/\/stockwiseapp\.com/); assert.doesNotMatch(templates, /innerHTML|dangerouslySetInnerHTML/)
})

test('rendered invitation contains no leaked financial or document evidence', () => {
  const rendered = renderDiscriminatedEmail('en', { templateKey: 'member_invite', brand: { companyName: 'QA & Co' }, inviterName: 'Samuel <QA>', role: 'MANAGER', expiresAt: '2026-08-15', actionUrl: 'https://stockwiseapp.com/accept-invite' }, true)
  assert.match(rendered.subject, /^\[StockWise QA\] QA & Co — You have been invited/)
  assert.match(rendered.html, /QA &amp; Co/); assert.match(rendered.html, /Samuel &lt;QA&gt;/)
  assert.doesNotMatch(`${rendered.html}\n${rendered.text}`, /Operational sales|Gross profit|Due date|QA-SO-/)
})

test('rendered report, digest and reminders keep their semantic fields isolated', () => {
  const brand = { companyName: 'QA Example Company' }
  const reportMail = renderDiscriminatedEmail('pt', { templateKey: 'report_ready', brand, reportName: 'Desempenho operacional', period: 'Julho de 2026', filters: ['Todos os armazéns'], actionUrl: 'https://stockwiseapp.com/reports' }, true)
  assert.match(reportMail.text, /Período: Julho de 2026/); assert.doesNotMatch(reportMail.text, /Data de vencimento|Valor em aberto/)
  const digestMail = renderDiscriminatedEmail('pt', { templateKey: 'daily_digest', brand, period: '2026-07-31', actionUrl: 'https://stockwiseapp.com/dashboard', metrics: { operationalSales: 1250, knownCogs: 500, grossProfit: null, grossMargin: null, transactions: 5, openOrders: 2, lowStockItems: 1, outOfStockItems: 0, missingCostEvidence: 1, topProductsServices: ['Serviço QA'], currencyCode: 'MZN' } }, true)
  assert.match(digestMail.text, /MZN 1\.250,00/); assert.match(digestMail.text, /Lucro bruto: Indisponível/); assert.doesNotMatch(digestMail.text, /MZN 1250,00|1\.250,00 MZN/)
  const reminder = renderDiscriminatedEmail('en', { templateKey: 'due_reminder_sales_invoice', brand, documentReference: 'QA-INV-0001', dueDate: '2026-08-15', outstandingAmount: 1250, currencyCode: 'MZN', stageOffsetDays: 3, daysUntilDue: 3, relativeState: 'upcoming', tone: 'gentle_urgency', actionUrl: 'https://stockwiseapp.com/sales-invoices/qa' }, true)
  assert.match(reminder.text, /Outstanding amount: MZN 1,250\.00/); assert.doesNotMatch(reminder.text, /Operational sales|Gross profit|Manager/)
})

test('production rendering omits QA markers and unsafe action origins are rejected', () => {
  const input = { templateKey: 'company_access_activation', brand: { companyName: 'QA Example Company' }, planName: 'Business', activeFrom: '2026-08-15', activeUntil: '2027-08-15', actionUrl: 'https://stockwiseapp.com/dashboard', supportEmail: 'support@example.invalid' }
  const production = renderDiscriminatedEmail('en', input, false)
  assert.doesNotMatch(production.subject, /StockWise QA/); assert.doesNotMatch(production.html, /TEST EMAIL/)
  assert.throws(() => renderDiscriminatedEmail('en', { ...input, actionUrl: 'https://attacker.invalid/collect' }, false), /email_action_url_not_allowed/)
})
