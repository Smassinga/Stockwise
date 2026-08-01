import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const receipts = await read('supabase/migrations/20260731101543_governed_payment_receipts.sql')
const reports = await read('supabase/migrations/20260731102631_authoritative_operational_reports.sql')
const reportJoinFix = await read('supabase/migrations/20260731194059_fix_operational_report_text_uuid_joins.sql')
const reportAgeingFix = await read('supabase/migrations/20260731195222_fix_inventory_ageing_aggregation.sql')
const dispatch = await read('supabase/migrations/20260731104537_mail_dispatch_audit_and_template_registry.sql')
const notifications = await read('supabase/migrations/20260731110051_actionable_notification_events.sql')
const receiptOutput = await read('src/lib/receiptOutput.ts')
const receiptActions = await read('src/components/receipts/ReceiptActions.tsx')
const receiptHandler = await read('src/hooks/useReceiptOutput.ts')
const lazyCore = await read('src/lib/lazyRecoveryCore.ts')
const lazyWrapper = await read('src/lib/lazyWithRecovery.ts')
const routeBoundary = await read('src/components/RouteErrorBoundary.tsx')
const app = await read('src/App.tsx')
const vercel = await read('vercel.json')
const reportPage = await read('src/pages/Reports.tsx')
const excel = await read('src/lib/excelExport.ts')
const currency = await read('src/lib/currency.ts')
const itemsPage = await read('src/pages/Items.tsx')
const operatorPage = await read('src/pages/Operator.tsx')
const stockLevelsPage = await read('src/pages/StockLevels.tsx')
const purchaseOrdersPage = await read('src/pages/Orders/PurchaseOrders.tsx')
const salesOrdersPage = await read('src/pages/Orders/SalesOrders.tsx')
const templates = await read('supabase/functions/_shared/emailTemplates.ts')
const emailLayout = await read('supabase/functions/_shared/emailLayout.ts')
const templateLab = await read('supabase/functions/email-template-lab/index.ts')
assert.match(templateLab, /https:\/\/stockwiseapp\.com/, 'template lab allows the production StockWise origin')
assert.match(templateLab, /allowedOrigins\.has\(origin\) \? origin/, 'template lab returns CORS only for maintained origins')
assert.match(templateLab, /"Vary": "Origin"/, 'template lab varies cached CORS responses by origin')
const notificationPage = await read('src/pages/Notifications.tsx')
const {
  StaleChunkError,
  importWithRecovery,
  isChunkLoadFailure,
  lazyRecoveryMarkerKey,
} = await import('../../src/lib/lazyRecoveryCore.ts')

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
    values,
  }
}

test('receipt reference is server generated from a company sequence', () => assert.match(receipts, /payment_receipt_sequences[\s\S]+receipt_reference/))
test('one authoritative receipt is unique per settlement', () => assert.match(receipts, /payment_receipts_settlement_unique unique \(settlement_channel, settlement_id\)/i))
test('receipt issuance uses fixed search paths and restricted execution', () => { assert.match(receipts, /set search_path\s*=\s*pg_catalog,\s*public/i); assert.match(receipts, /revoke all on function/i) })
test('receipt evidence is immutable and cannot be deleted', () => { assert.match(receipts, /payment_receipts_immutable/i); assert.match(receipts, /delete/i) })
test('receipt supports non-fiscal wording and three print formats', () => { assert.match(receiptOutput, /Non-fiscal receipt/); assert.match(receiptOutput, /58mm/); assert.match(receiptOutput, /80mm/); assert.match(receiptOutput, /A4/) })
test('receipt history exposes separate handled 58 mm and 80 mm print controls', () => { assert.match(receiptActions, /requestPrint\(receipt, '58mm', 'receipt_history'\)/); assert.match(receiptActions, /requestPrint\(receipt, '80mm', 'receipt_history'\)/); assert.match(receiptActions, /Print 58 mm/); assert.match(receiptActions, /Imprimir 80 mm/) })
test('A4 receipt PDF includes immutable line, identity and payment evidence', () => { assert.match(receiptOutput, /const lines = receipt\.line_evidence/); assert.match(receiptOutput, /refs\.sales_order/); assert.match(receiptOutput, /snapshotValue\(company, 'tax_id'\)/); assert.match(receiptOutput, /print_footer_note/); assert.match(receiptOutput, /formatMoneyBase\(Number\(line\.unit_price/); assert.doesNotMatch(receiptOutput, /amount tendered|change amount/i) })
test('printing is separate from authoritative receipt creation', () => assert.doesNotMatch(receiptOutput, /operator_sale_post|insert\(/i))
test('POS completion retains print-last evidence after Done', () => { assert.match(operatorPage, /lastSaleTitle: 'Sale completed'/); assert.match(operatorPage, /lastSaleTitle: 'Venda concluída'/); assert.match(operatorPage, /completionOpen \? copy\.printReceipt : copy\.printLastReceipt/); assert.match(operatorPage, /done: 'Done'/); assert.match(operatorPage, /done: 'Concluir'/); assert.match(operatorPage, /setCompletionOpen\(false\)/) })

test('blocked receipt popups are a normal result and never throw', () => { assert.match(receiptOutput, /if \(!popup\) return \{ ok: false, reason: 'popup_blocked' \}/); assert.doesNotMatch(receiptOutput, /if \(!popup\) throw/); assert.match(receiptHandler, /result\.reason === 'popup_blocked'/) })
test('receipt popup clears its opener and prints only after load', () => { assert.match(receiptOutput, /popup\.opener = null/); assert.match(receiptOutput, /addEventListener\('load'/); assert.match(receiptOutput, /\{ once: true \}/); assert.doesNotMatch(receiptOutput, /noopener,noreferrer/) })
test('receipt print handling provides localized blocked and rendering feedback', () => { assert.match(receiptHandler, /Allow pop-ups to print the receipt\./); assert.match(receiptHandler, /Permita janelas pop-up para imprimir o recibo\./); assert.match(receiptHandler, /The receipt could not be prepared for printing\./); assert.match(receiptHandler, /Não foi possível preparar o recibo para impressão\./) })
test('receipt output failures report safe context without payment payloads', () => { assert.match(receiptHandler, /receipt_reference/); assert.match(receiptHandler, /receipt_format/); assert.doesNotMatch(receiptHandler, /customer_snapshot|amount_received|destination_snapshot|settlement_id/) })
test('receipt PDF rejection is caught and localized by every caller', () => { assert.match(receiptHandler, /try[\s\S]*await saveReceiptPdf[\s\S]*catch/); assert.match(receiptHandler, /The receipt PDF could not be generated\./); assert.match(receiptHandler, /Não foi possível gerar o PDF do recibo\./); assert.match(receiptActions, /void requestPdf/); assert.match(operatorPage, /void requestPdf/); assert.doesNotMatch(receiptActions, /void saveReceiptPdf/) })
test('receipt viewing and printing remain mutation free', () => { for (const source of [receiptOutput, receiptHandler, receiptActions]) assert.doesNotMatch(source, /operator_sale_post|payment_settlements.*insert|stock_movements.*insert|payment_receipts.*insert/i) })

test('lazy recovery recognizes only maintained stale chunk messages', () => { assert.match(lazyCore, /Failed to fetch dynamically imported module/); assert.match(lazyCore, /Importing a module script failed/); assert.match(lazyCore, /ChunkLoadError/); assert.match(lazyCore, /Loading chunk/); assert.match(lazyCore, /if \(!isChunkLoadFailure\(error\)\) throw error/) })
test('lazy recovery classifier rejects unrelated application errors', () => { assert.equal(isChunkLoadFailure(new Error('Failed to fetch dynamically imported module: /assets/a.js')), true); assert.equal(isChunkLoadFailure(new Error('Application data request failed')), false) })
test('successful lazy imports avoid reload and clear the scoped marker', async () => { const storage = memoryStorage(); const key = lazyRecoveryMarkerKey('Settlements', '/settlements', 'qa'); storage.setItem(key, JSON.stringify({ attemptedAt: 100 })); let reloads = 0; const loaded = await importWithRecovery('Settlements', async () => ({ default: 'ok' }), { pathname: '/settlements', release: 'qa', storage, reload: () => { reloads += 1 }, now: () => 101 }); assert.equal(loaded.default, 'ok'); assert.equal(reloads, 0); assert.equal(storage.getItem(key), null) })
test('first stale chunk failure marks and reloads exactly once', async () => { const storage = memoryStorage(); let reloads = 0; void importWithRecovery('Settlements', async () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/old.js') }, { pathname: '/settlements', release: 'qa', storage, reload: () => { reloads += 1 }, now: () => 200 }); await new Promise(resolve => setImmediate(resolve)); assert.equal(reloads, 1); assert.equal(storage.values.size, 1) })
test('second stale chunk failure is controlled and never reloads', async () => { const storage = memoryStorage(); const key = lazyRecoveryMarkerKey('PlatformControl', '/platform-control', 'qa'); storage.setItem(key, JSON.stringify({ attemptedAt: 300 })); let reloads = 0; await assert.rejects(() => importWithRecovery('PlatformControl', async () => { throw new Error('ChunkLoadError') }, { pathname: '/platform-control', release: 'qa', storage, reload: () => { reloads += 1 }, now: () => 301 }), StaleChunkError); assert.equal(reloads, 0) })
test('unrelated lazy import failures pass through unchanged', async () => { const storage = memoryStorage(); const original = new Error('Business module failed'); await assert.rejects(() => importWithRecovery('Reports', async () => { throw original }, { pathname: '/reports', release: 'qa', storage, reload: () => assert.fail('must not reload'), now: () => 400 }), error => error === original); assert.equal(storage.values.size, 0) })
test('lazy recovery stores one short-lived marker before reload', () => { assert.match(lazyCore, /storage\.setItem\(markerKey/); assert.match(lazyCore, /runtime\.reload\(\)/); assert.ok(lazyCore.indexOf('storage.setItem(markerKey') < lazyCore.indexOf('runtime.reload()')); assert.match(lazyCore, /RECOVERY_TTL_MS/) })
test('lazy recovery clears its marker after a successful import', () => assert.match(lazyCore, /const loaded = await importer\(\)[\s\S]*storage\.removeItem\(markerKey\)[\s\S]*return loaded/))
test('a second chunk failure reaches the controlled boundary without another reload', () => { assert.match(lazyCore, /if \(readMarker\(runtime, markerKey\)\) throw new StaleChunkError/); assert.match(routeBoundary, /error instanceof StaleChunkError/); assert.match(routeBoundary, /lazy_route_recovery/) })
test('lazy recovery marker contains no query, token or credential material', () => { assert.match(lazyWrapper, /pathname: window\.location\.pathname/); assert.doesNotMatch(lazyCore, /location\.search|token|credential|localStorage/i) })
test('named route exports remain compatible with the recovery wrapper', () => { assert.match(app, /lazyWithRecovery\('Warehouses',[\s\S]*default: m\.Warehouses/); assert.match(app, /lazyWithRecovery\('Settings',[\s\S]*default: m\.Settings/) })
test('every route-level lazy import uses the recovery wrapper', () => { assert.doesNotMatch(app, /\blazy\(\(\) => import/); for (const route of ['Dashboard', 'Operator', 'Reports', 'Orders', 'SalesInvoices', 'VendorBills', 'Settlements', 'PlatformControl', 'NotificationsPage']) assert.match(app, new RegExp(`lazyWithRecovery\\('${route}'`)) })
test('route recovery screen is localized and accessible without raw asset details', () => { assert.match(routeBoundary, /App update available/); assert.match(routeBoundary, /Actualização da aplicação disponível/); assert.match(routeBoundary, /Reload to continue with the latest version/); assert.match(routeBoundary, /Recarregue para continuar com a versão mais recente/); assert.match(routeBoundary, /<h1/); assert.match(routeBoundary, /Go to dashboard/); assert.match(routeBoundary, /Ir para o dashboard/); assert.doesNotMatch(routeBoundary, /https?:\/\/|assets\//) })
test('hashed asset cache policy overrides the navigation no-store policy', () => { const config = JSON.parse(vercel); const broad = config.headers.findIndex(entry => entry.source === '/(.*)'); const assets = config.headers.findIndex(entry => entry.source === '/assets/(.*)'); assert.ok(broad >= 0); assert.ok(assets > broad); assert.deepEqual(config.headers[broad].headers.find(header => header.key === 'Cache-Control'), { key: 'Cache-Control', value: 'no-store' }); assert.deepEqual(config.headers[assets].headers.find(header => header.key === 'Cache-Control'), { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }) })

test('reports use one bounded authoritative RPC', () => { assert.match(reportPage, /get_operational_report/); assert.doesNotMatch(reportPage, /ordersSource|cashSource|cashSalesSource/) })
test('performance reporting reuses owner dashboard authority', () => assert.match(reports, /get_owner_dashboard/))
test('report RPC is company scoped with explicit authenticated access checks', () => { assert.match(reports, /current_company_id\(\)/); assert.match(reports, /auth\.uid\(\) is null/); assert.match(reports, /member_has_company_access/) })
test('service recognition remains actual completion based', () => assert.match(reports, /actual_completion/))
test('missing cost remains unavailable', () => assert.match(reports, /cost_evidence|missing_cost|gross_profit/i))
test('report catalogue is query backed and lazy selected', () => { assert.match(reportPage, /params\.get\(['"]report['"]\)/); assert.match(reportPage, /get_operational_report/); assert.match(reportPage, /p_report_code:\s*report/) })
test('report field labels are localized in English and Portuguese', () => { assert.match(reportPage, /missingCostCount:\s*'Missing cost count'/); assert.match(reportPage, /missingCostCount:\s*'Custos em falta'/); assert.match(reportPage, /fieldLabels\[lang\]\[key\]/) })
test('missing cost counts remain numeric rather than currency values', () => { assert.match(reportPage, /const moneyFields = new Set/); assert.match(reportPage, /moneyFields\.has\(key\)/); assert.doesNotMatch(reportPage, /\(sales\|cogs\|profit\|cost\|value\|amount\|balance/) })
test('report UoM labels never expose raw UUIDs on screen or in exports', () => { assert.match(reportPage, /from\(['"]uoms['"]\)\.select\(['"]id,code,name['"]\)/); assert.match(reportPage, /uuidPattern\.test\(value\) \? null : value/); assert.match(reportPage, /resolvedValue\(column, row\[column\]\)/) })
test('report status and costing enums are localized for display and exports', () => { assert.match(reportPage, /in_stock:\s*'In stock'/); assert.match(reportPage, /in_stock:\s*'Em stock'/); assert.match(reportPage, /finalised:\s*'Finalizado'/); assert.match(reportPage, /key === 'stockStatus' \|\| key === 'costingState'/); assert.match(reportPage, /resolvedValue\(column, row\[column\]\)/) })
test('stock movement report safely compares legacy text references to UUID keys', () => { assert.match(reportJoinFix, /so\.id::text=sm\.ref_id/); assert.match(reportJoinFix, /po\.id::text=sm\.ref_id/); assert.match(reportJoinFix, /p\.id::text=sm\.created_by/); assert.doesNotMatch(reportJoinFix, /so\.id=sm\.ref_id|p\.id=sm\.created_by/) })
test('inventory ageing aggregates rows before JSON rendering', () => { assert.match(reportAgeingFix, /ageing_rows as \(/); assert.match(reportAgeingFix, /from ageing_rows/); assert.doesNotMatch(reportAgeingFix, /jsonb_agg\(jsonb_build_object\([\s\S]*?'quantity',\s*sum\(/) })

test('workbook exports set StockWise identity and print setup', () => { assert.match(excel, /creator\s*=\s*['"]StockWise/); assert.match(excel, /printArea|fitToPage|printTitlesRow/) })
test('workbook exports support autofilter and frozen headings', () => { assert.match(excel, /autoFilter/); assert.match(excel, /views/) })
test('currency formatter emits explicit code with required PT MZN grouping', () => { assert.match(currency, /MZN \$\{absolute\}/); assert.match(currency, /startsWith\('pt'\) \? 'pt-BR' : locale/); assert.match(currency, /\$\{currencyCode\} \$\{new Intl\.NumberFormat/); assert.doesNotMatch(currency, /style:\s*['"]currency['"]/) })
test('item selling prices use the maintained code-first money formatter', () => { assert.match(itemsPage, /formatMoneyBase/); assert.doesNotMatch(itemsPage, /\.format\(value\)\} \$\{currencyCode\}/) })
test('POS uses the maintained code-first EN or PT money formatter throughout', () => { assert.match(operatorPage, /formatMoneyBase\([\s\S]*?row\.item\.unitPrice[\s\S]*?lang === 'pt' \? 'pt-MZ' : 'en-MZ'/); assert.doesNotMatch(operatorPage, /round2\(row\.item\.unitPrice \?\? 0\)\.toLocaleString/); assert.doesNotMatch(operatorPage, /preview\?\.(subtotal|tax_total|total)[\s\S]{0,160}toLocaleString/); assert.doesNotMatch(operatorPage, /\}\{' '\}[\s\S]{0,40}\{baseCurrencyCode\}/) })
test('stock valuation uses the active EN or PT locale for MZN presentation', () => { assert.match(stockLevelsPage, /const \{ t, lang \} = useI18n\(\)/); assert.match(stockLevelsPage, /formatMoneyBase\(value, baseCode, lang === 'pt' \? 'pt-MZ' : 'en-MZ'\)/) })
test('order workspaces pass the active EN or PT locale to money formatting', () => { for (const page of [purchaseOrdersPage, salesOrdersPage]) { assert.match(page, /lang === 'pt' \? 'pt-MZ' : 'en-MZ'/); assert.match(page, /formatMoneyBaseRaw\(amount, code, moneyLocale\)/) } })

test('email registry contains every maintained template family', () => ['due_reminder_sales_order','due_reminder_sales_invoice','daily_digest','member_invite','report_ready','company_access_expiry','company_access_purge','company_access_activation'].forEach(key => assert.match(templates, new RegExp(key))))
test('email templates provide EN and PT renderers with versions', () => { assert.match(templates, /supportedLanguages:\s*\[['"]en['"],\s*['"]pt['"]\]/); assert.match(templates, /version:/) })
test('shared email layout provides QA banner and plain fallback', () => { assert.match(emailLayout, /StockWise email test/); assert.match(emailLayout, /Teste de email do StockWise/) })
test('template lab is platform-admin gated and recipient restricted', () => { assert.match(templateLab, /platform.admin|platform_admin/i); assert.match(templateLab, /EMAIL_QA_ALLOWED_RECIPIENTS/) })
test('dispatch evidence excludes rendered HTML', () => { assert.match(dispatch, /mail_dispatch_events/); assert.doesNotMatch(dispatch, /html\s+text|body_html/i) })
test('dispatch evidence is force-RLS protected', () => assert.match(dispatch, /force row level security/i))

test('notification events are targeted and deduplicated', () => { assert.match(notifications, /user_id/); assert.match(notifications, /notifications_event_dedup_unique/) })
test('notification preferences are company and user scoped', () => { assert.match(notifications, /notification_preferences/); assert.match(notifications, /company_id=public\.current_company_id\(\) and user_id=auth\.uid\(\)/) })
test('notification actions reject external URLs', () => assert.match(notifications, /action_url.*like '\/%'.*not like '\/\/%'/is))
test('legacy notification title and body remain supported', () => { assert.match(notificationPage, /title/); assert.match(notificationPage, /body/); assert.match(notificationPage, /notificationPresentation/) })
test('notification page supports read, dismiss and filters', () => { assert.match(notificationPage, /markAll/); assert.match(notificationPage, /dismissed_at/); assert.match(notificationPage, /category/) })
