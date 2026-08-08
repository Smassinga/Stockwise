import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const foundation = await readFile(new URL('../../supabase/migrations/20260729212931_add_service_job_actual_costing_foundation.sql', import.meta.url), 'utf8')
const dashboard = await readFile(new URL('../../supabase/migrations/20260729214142_integrate_service_actuals_into_owner_dashboard.sql', import.meta.url), 'utf8')
const workspace = await readFile(new URL('../../src/pages/ServiceJobs.tsx', import.meta.url), 'utf8')
const salesOrders = await readFile(new URL('../../src/pages/Orders/SalesOrders.tsx', import.meta.url), 'utf8')
const dashboardPage = await readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8')
const navigation = await readFile(new URL('../../src/components/layout/navigation.ts', import.meta.url), 'utf8')
const app = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const pt = JSON.parse(await readFile(new URL('../../src/locales/pt.json', import.meta.url), 'utf8'))

test('service jobs are company scoped with separate execution and costing state', () => {
  assert.match(foundation, /CREATE TABLE public\.service_jobs[\s\S]+company_id uuid NOT NULL/)
  assert.match(foundation, /execution_status IN \('planned','in_progress','completed','cancelled'\)/)
  assert.match(foundation, /costing_status IN \('open','finalised'\)/)
})
test('job references use an atomic company counter rather than row count', () => {
  assert.match(foundation, /service_job_counters/)
  assert.match(foundation, /ON CONFLICT \(company_id\) DO UPDATE/)
  assert.doesNotMatch(foundation, /max\s*\([^)]*job_reference/i)
})
test('only explicitly classified service items are eligible', () =>
  assert.match(foundation, /i\.primary_role = 'service'/))
test('one active job owns a sales order service line', () =>
  assert.match(foundation, /UNIQUE INDEX service_job_lines_one_active_job_idx[\s\S]+WHERE active_link/))
test('cancelled jobs preserve evidence and release active links', () => {
  assert.match(foundation, /UPDATE public\.service_job_lines SET active_link=false/)
  assert.doesNotMatch(foundation, /DELETE FROM public\.service_job_(lines|events|materials|direct_costs)/)
})
test('execution transitions are backend governed', () => {
  assert.match(foundation, /CREATE OR REPLACE FUNCTION public\.transition_service_job/)
  assert.match(foundation, /service_job_invalid_transition/)
  assert.match(foundation, /FOR UPDATE/)
})
test('completion rejects an open timer', () =>
  assert.match(foundation, /service_job_completion_blocked[\s\S]+service_job_time_entries/))
test('only one open timer exists per worker and company', () =>
  assert.match(foundation, /UNIQUE INDEX service_job_one_open_timer_per_worker_idx[\s\S]+stopped_at IS NULL/))
test('timer duration is calculated from server time', () => {
  assert.match(foundation, /extract\(epoch FROM \(now\(\)-v_entry\.started_at\)\)/)
  assert.doesNotMatch(foundation, /p_duration_minutes[\s\S]{0,120}stop_service_job_timer/)
})
test('manual time is positive, bounded and membership validated', () => {
  assert.match(foundation, /p_duration_minutes NOT BETWEEN 1 AND 1440/)
  assert.match(foundation, /company_members[\s\S]+status='active'/)
})
test('time evidence is not automatically labour cost', () => {
  assert.match(workspace, /Time worked does not become labour cost until an actual labour cost is recorded/)
  assert.doesNotMatch(foundation, /INSERT INTO public\.service_job_direct_costs[\s\S]{0,500}start_service_job_timer/)
})
test('direct costs freeze source currency, FX and base amount', () => {
  assert.match(foundation, /source_currency text NOT NULL/)
  assert.match(foundation, /fx_to_base numeric NOT NULL CHECK \(fx_to_base > 0\)/)
  assert.match(foundation, /round\(p_source_amount\*p_fx_to_base,4\)/)
})
test('direct-cost corrections use immutable reversal evidence', () => {
  assert.match(foundation, /reverse_service_job_direct_cost/)
  assert.match(foundation, /UNIQUE \(reverses_id\)/)
  assert.doesNotMatch(foundation, /DELETE FROM public\.service_job_direct_costs/)
})
test('company materials post to the canonical stock ledger at WAC', () => {
  assert.match(foundation, /CREATE OR REPLACE FUNCTION public\.issue_service_job_material/)
  assert.match(foundation, /SELECT sl\.avg_cost INTO v_avg_cost FROM public\.stock_levels/)
  assert.match(foundation, /INSERT INTO public\.stock_movements/)
  assert.match(foundation, /'SERVICE_JOB_MATERIAL'/)
})
test('material issue and reversal are idempotent', () => {
  assert.match(foundation, /'service\.job\.material\.issue'/)
  assert.match(foundation, /'service\.job\.material\.reverse'/)
  assert.match(foundation, /idempotency_key_payload_mismatch/)
})
test('customer supplied material creates zero stock and zero cost', () => {
  assert.match(foundation, /supply_type = 'customer' AND stock_movement_id IS NULL AND base_amount = 0/)
  assert.match(workspace, /Customer supplied/)
})
test('vendor allocations are line level and lock available cost', () => {
  assert.match(foundation, /vendor_bill_line_id uuid NOT NULL/)
  assert.match(foundation, /FROM public\.vendor_bill_lines[\s\S]+FOR UPDATE/)
  assert.match(foundation, /service_job_vendor_allocation_exceeds_available/)
})
test('vendor allocation does not mutate AP truth', () => {
  const allocationFunction = foundation.match(/CREATE OR REPLACE FUNCTION public\.allocate_vendor_bill_line_to_service_job[\s\S]+?END;\n\$\$;/)?.[0] || ''
  assert.doesNotMatch(allocationFunction, /UPDATE public\.vendor_bills/)
  assert.doesNotMatch(allocationFunction, /INSERT INTO public\.(vendor_bills|cash_transactions)/)
})
test('actual cost excludes time and customer-supplied materials', () => {
  const summaryFunction = foundation.match(/CREATE OR REPLACE FUNCTION public\.get_service_job_cost_summary[\s\S]+?END;\n\$\$;/)?.[0] || ''
  assert.match(summaryFunction, /supply_type='company'/)
  assert.doesNotMatch(summaryFunction, /service_job_time_entries/)
})
test('zero-cost finalisation requires explicit confirmation and reason', () => {
  assert.match(foundation, /service_job_zero_cost_confirmation_required/)
  assert.match(foundation, /NOT p_confirm_zero OR NULLIF\(btrim\(p_zero_cost_reason\),''\) IS NULL/)
})
test('finalisation is admin-only, server-calculated, locked and idempotent', () => {
  assert.match(foundation, /service_job_assert_role\(p_company_id,true\)/)
  assert.match(foundation, /get_service_job_cost_summary\(p_company_id,p_service_job_id\)/)
  assert.match(foundation, /FOR UPDATE/)
  assert.match(foundation, /'service\.job\.cost\.finalise'/)
})
test('reopening costing uses the current fingerprint and clears current truth', () => {
  assert.match(foundation, /cost_fingerprint IS DISTINCT FROM p_current_fingerprint/)
  assert.match(foundation, /costing_status='open'[\s\S]+total_actual_cost=0[\s\S]+cost_fingerprint=NULL/)
})
test('all new maintained tables force RLS', () => {
  const tables = ['service_job_counters','service_jobs','service_job_lines','service_job_time_entries','service_job_direct_costs','service_job_materials','service_job_vendor_allocations','service_job_events']
  for (const table of tables) assert.match(foundation, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`))
})
test('authenticated clients have read access but no direct mutation grants', () => {
  assert.match(foundation, /GRANT SELECT ON public\.service_jobs/)
  assert.match(foundation, /REVOKE ALL ON public\.service_job_counters[\s\S]+FROM PUBLIC, anon, authenticated/)
  assert.doesNotMatch(foundation, /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]+TO authenticated/)
})
test('every service RPC uses a fixed search path', () => {
  const definitions = [...foundation.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)[\s\S]+?AS \$\$/g)]
  assert.ok(definitions.length >= 14)
  for (const definition of definitions) assert.match(definition[0], /SET search_path = ''/)
})
test('service events are append only and actor stamped', () => {
  assert.match(foundation, /CREATE TABLE public\.service_job_events/)
  assert.match(foundation, /actor_id uuid NOT NULL DEFAULT auth\.uid\(\)/)
  assert.doesNotMatch(foundation, /(UPDATE|DELETE) public\.service_job_events/)
})
test('owner dashboard recognises service revenue on completion', () => {
  assert.match(dashboard, /sj\.actual_completion::date/)
  assert.match(dashboard, /sj\.execution_status='completed'/)
  assert.match(dashboard, /serviceSales/)
})
test('owner dashboard withholds gross profit while service costing is open', () => {
  assert.match(dashboard, /serviceOpenCostingCount/)
  assert.match(dashboard, /grossProfit',CASE WHEN v_missing=0/)
})
test('mixed orders remove embedded service sales before adding completed service evidence', () =>
  assert.match(dashboard, /v_goods_sales-v_embedded_service_sales\+v_service_sales/))
test('dashboard chart keeps sales primary and uses maintained COGS and profit tokens', () => {
  assert.match(dashboardPage, /dataKey="sales"[\s\S]+stroke="hsl\(var\(--chart-revenue-line\)\)"/)
  assert.match(dashboardPage, /dataKey="knownCogs"[\s\S]+dashboard\.cogs[\s\S]+stroke="hsl\(var\(--chart-cogs-line\)\)"/)
  assert.match(dashboardPage, /dataKey="grossProfit"[\s\S]+stroke="hsl\(var\(--chart-margin-line\)\)"/)
  assert.doesNotMatch(dashboardPage, /var\(--success\)/)
})
test('workspace is routed, navigable and starts from a Sales Order', () => {
  assert.match(app, /path="\/service-jobs"/)
  assert.match(navigation, /id: 'serviceJobs'[\s\S]+to: '\/service-jobs'/)
  assert.match(salesOrders, /navigate\(`\/service-jobs\?salesOrderId=\$\{selectedSO\.id\}`\)/)
})
test('workspace keeps company and customer materials visibly separate', () => {
  assert.match(workspace, /companyMaterials/)
  assert.match(workspace, /customerMaterials/)
  assert.match(workspace, /from\('uoms'\)\.select\('id,code,name'\)/)
  assert.match(workspace, /<Select value=\{customerUom\} onValueChange=\{setCustomerUom\}>/)
  assert.doesNotMatch(workspace, /useState\('ea'\)/)
  assert.doesNotMatch(workspace, /fixed-width/)
})
test('Portuguese service terminology is UTF-8 and exact', () => {
  assert.equal(pt['nav.serviceJobs'], 'Trabalhos de serviço')
  assert.equal(pt['serviceJobs.customerSupplied'], 'Fornecido pelo cliente')
  assert.match(pt['serviceJobs.timeCostWarning'], /mão-de-obra/)
})
