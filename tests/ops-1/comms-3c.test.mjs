import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const controls = await read('supabase/migrations/20260801230536_collections_control_and_event_ledger.sql')
const lifecycle = await read('supabase/migrations/20260801230543_collections_promise_and_reminder_integration.sql')
const reportNullAnchorFix = await read('supabase/migrations/20260802005533_fix_collections_report_optional_anchor.sql')
const worker = await read('supabase/functions/due-reminder-worker/index.ts')
const panel = await read('src/components/collections/CollectionsControlPanel.tsx')
const invoices = await read('src/pages/SalesInvoiceDetail.tsx')
const orders = await read('src/pages/Orders/SalesOrders.tsx')
const reports = await read('src/pages/Reports.tsx')
const notificationPresentation = await read('src/lib/notificationPresentation.ts')
const lab = await read('supabase/functions/email-template-lab/index.ts')
const labUi = await read('src/components/platform/EmailTemplateLab.tsx')

test('collection controls default lazily to active and remain unique per exposure chain', () => {
  assert.match(controls, /status text not null default 'active'/)
  assert.match(controls, /unique\s*\(\s*company_id\s*,\s*exposure_chain_id\s*\)/i)
  assert.match(controls, /ar_get_or_create_collection_control/)
})

test('collection current state is RPC-only with row and forced row security', () => {
  assert.match(controls, /alter table public\.ar_collection_controls enable row level security/i)
  assert.match(controls, /alter table public\.ar_collection_controls force row level security/i)
  assert.match(controls, /revoke all on table public\.ar_collection_controls from public,anon,authenticated/i)
})

test('collection mutations enforce manager authority, optimistic versions and idempotency', () => {
  assert.match(controls, /ar_require_collection_manager/)
  for (const role of ['MANAGER', 'ADMIN', 'OWNER']) assert.match(controls, new RegExp(`'${role}'`))
  assert.match(controls, /stale_collection_control_version/)
  assert.match(controls, /idempotency_key/)
})

test('collection events are immutable evidence rather than mutable history', () => {
  assert.match(controls, /ar_collection_control_events_immutable/)
  assert.match(controls, /raise exception 'collection_control_events_are_immutable'/)
  assert.match(controls, /unique\s*\(company_id,idempotency_key\)/i)
})

test('promise evidence validates amount and keeps due date and payment posting outside its authority', () => {
  assert.match(lifecycle, /promised_amount numeric not null check \(promised_amount > 0\)/i)
  assert.match(lifecycle, /v_amount>\(v_anchor->>'outstanding_amount'\)::numeric\+0\.005[\s\S]*invalid_promise_amount/)
  assert.doesNotMatch(lifecycle, /update public\.sales_invoices set due_date|insert into public\.cash_transactions|insert into public\.bank_transactions/i)
})

test('only one open promise governs an exposure and revision supersedes immutable evidence', () => {
  assert.match(lifecycle, /create unique index ar_payment_promises_one_open_idx/i)
  assert.match(lifecycle, /status='superseded',updated_at=now\(\)/)
  assert.match(lifecycle, /set superseded_by=v_new\.id/)
  assert.match(lifecycle, /promise_revised/)
})

test('promise evaluation distinguishes kept, partial and broken using settlement and credit deltas', () => {
  assert.match(lifecycle, /settled_amount'\)::numeric,0\)-r\.settled_amount_at_recording,0\)/)
  assert.match(lifecycle, /credited_amount'\)::numeric,0\)-r\.credited_amount_at_recording,0\)/)
  assert.match(lifecycle, /then 'kept' when v_covered>0\.005 then 'partially_kept' else 'broken'/)
})

test('promise evaluation is company-timezone aware and idempotently skips evaluated promises', () => {
  assert.match(lifecycle, /p_local_day date,p_timezone text,p_promise_id uuid default null/)
  assert.match(lifecycle, /p\.status='open' and p\.promised_date<p_local_day/)
  assert.match(lifecycle, /p_promise_id is null or p\.id=p_promise_id/)
  assert.match(lifecycle, /company_timezone_required/)
  assert.match(lifecycle, /evaluated_at=now\(\)/)
})

test('paused, disputed, promise and manual controls suppress external reminders with structured reasons', () => {
  for (const reason of ['collection_paused', 'collection_disputed', 'promise_open', 'manual_follow_up_required']) {
    assert.match(lifecycle, new RegExp(reason))
  }
  assert.match(lifecycle, /eligibility_result/)
  assert.match(lifecycle, /skip_reason/)
})

test('worker performs final eligibility immediately before provider send', () => {
  const check = worker.indexOf('check_due_reminder_collection_eligibility')
  const send = worker.indexOf('await sendTransactionalEmail')
  assert.ok(check >= 0 && send > check)
  assert.ok(worker.includes('if (!(collectionEligibility as { allowed?: boolean } | null)?.allowed)'))
})

test('pending stages are superseded while accepted reminder evidence stays immutable', () => {
  assert.match(controls, /status='superseded'/)
  assert.match(controls, /status in \('pending','processing','failed'\)/)
  assert.doesNotMatch(controls, /status in \('pending','processing','failed','accepted'\)/)
})

test('returning active delegates to adaptive latest-stage selection without replay code', () => {
  assert.match(lifecycle, /build_adaptive_due_reminder_batch/)
  assert.match(lifecycle, /build_due_reminder_batch/)
  assert.doesNotMatch(lifecycle, /replay_missed|send_all_missed/i)
})

test('invoice issuance moves the same exposure control and blocks Sales Order bypass', () => {
  assert.match(lifecycle, /ar_collection_invoice_anchor_trigger/)
  assert.match(lifecycle, /anchor_moved_to_invoice/)
  assert.match(lifecycle, /active_anchor_kind='sales_invoice'/)
  assert.match(controls, /financial_anchor='sales_invoice'/)
})

test('settlement and credit resolution closes controls and suppresses future pending stages', () => {
  assert.match(lifecycle, /control_closed_after_settlement/)
  assert.match(lifecycle, /status='closed'/)
  assert.match(lifecycle, /outstanding_amount'\)::numeric<=0\.005/)
})

test('UI exposes collections controls only at the active receivable anchor', () => {
  assert.match(invoices, /CollectionsControlPanel/)
  assert.match(invoices, /anchorKind="sales_invoice"/)
  assert.match(orders, /!linkedFiscalInvoice/)
  assert.match(orders, /anchorKind="sales_order"/)
})

test('collections panel explains suppression and financial non-authority in EN and PT', () => {
  assert.match(panel, /Automatic customer reminders will stop/)
  assert.match(panel, /Os lembretes automáticos ao cliente ficarão suspensos/)
  assert.match(panel, /outstanding balance will not change/i)
  assert.match(panel, /saldo em aberto não será alterado/i)
})

test('collections timeline localizes known event types and never exposes a raw fallback enum', () => {
  assert.match(panel, /collectionEventLabels/)
  assert.match(panel, /anchor_moved_to_invoice/)
  assert.doesNotMatch(panel, /event\.event_type\.replaceAll/)
})

test('receivables reporting provides collection fields and all required filters without changing money formatting', () => {
  for (const field of ['collectionStatus', 'collectionOwner', 'nextActionAt', 'promiseDate', 'promisedAmount', 'disputeCategory', 'daysOverdue', 'lastReminderStage']) {
    assert.match(reports, new RegExp(field))
  }
  for (const filter of ['promise_due_today', 'broken_promise', 'follow_up_overdue']) assert.match(reports, new RegExp(filter))
  assert.match(reports, /formatMoneyBase/)
})

test('receivables reporting does not resolve an absent collections anchor', () => {
  assert.match(reportNullAnchorFix, /when ctrl\.id is null then null::date/i)
  assert.match(reportNullAnchorFix, /ar_resolve_exposure_anchor\(p_company_id,ctrl\.active_anchor_kind,ctrl\.active_anchor_id\)/)
  assert.doesNotMatch(reportNullAnchorFix, /\)anchor on ctrl\.id is not null/)
})

test('evaluated promise evidence remains reportable after the current control link is cleared', () => {
  assert.match(lifecycle, /where p\.company_id=p_company_id and p\.exposure_chain_id=ctrl\.exposure_chain_id/)
  assert.match(lifecycle, /order by \(p\.id=ctrl\.current_promise_id\) desc,p\.created_at desc/)
})

test('internal follow-up notifications are targeted and deduplicated with canonical document links', () => {
  assert.match(lifecycle, /owner_user_id is not null/)
  assert.match(lifecycle, /cm\.company_id=p_control\.company_id[\s\S]*cm\.role in \('OWNER','ADMIN','MANAGER'\)/)
  assert.match(lifecycle, /'\/sales-invoices\/'/)
  assert.match(lifecycle, /'\/orders\?tab=sales&orderId='/)
  assert.match(notificationPresentation, /collections\.promise_broken/)
})

test('Template Lab exposes suppressed control scenarios without sending customer messages', () => {
  for (const scenario of ['paused', 'disputed', 'promise_open', 'promise_due_today', 'promise_kept', 'promise_partially_kept', 'promise_broken', 'manual_follow_up']) {
    assert.match(lab, new RegExp(scenario))
  }
  assert.match(lab, /externalSendingAllowed/)
  assert.match(lab, /metadata \}, 409/)
  assert.match(labUi, /Collections scenario/)
})
