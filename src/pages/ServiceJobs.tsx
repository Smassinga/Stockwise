import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock3, Plus, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { Textarea } from '../components/ui/textarea'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { OperationalSummaryBand } from '../components/premium/OperationalSummaryBand'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumSection } from '../components/premium/PremiumSection'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'
import { formatOperationalQuantity } from '../lib/operationalQuantity'
import { financeCan } from '../lib/permissions'

type Job = {
  id: string
  job_reference: string
  sales_order_id: string
  order_no: string | null
  customer_name: string
  title: string
  description: string | null
  execution_status: 'planned' | 'in_progress' | 'completed' | 'cancelled'
  costing_status: 'open' | 'finalised'
  scheduled_start: string | null
  scheduled_end: string | null
  actual_start: string | null
  actual_completion: string | null
  total_actual_cost: number
  cost_fingerprint: string | null
  explicit_zero: boolean
  zero_cost_reason: string | null
  service_line_count: number
  worked_minutes: number
}
type JobLine = {
  id: string; sales_order_line_id: string; description_snapshot: string
  billing_basis: 'per_job' | 'per_hour' | 'fixed_fee'; commercial_quantity: number
}
type TimeEntry = {
  id: string; worker_display_name: string; work_date: string; started_at: string | null
  stopped_at: string | null; duration_minutes: number | null; notes: string | null; source: 'timer' | 'manual'
}
type Material = {
  id: string; supply_type: 'company' | 'customer'; description: string; quantity: number
  uom_id: string; base_amount: number; occurred_on: string; reverses_id: string | null; reversed_by_id: string | null
}
type DirectCost = {
  id: string; category: string; description: string; source_currency: string
  source_amount: number; base_amount: number; cost_date: string; reverses_id: string | null; reversed_by_id: string | null
}
type Allocation = {
  id: string; vendor_bill_id: string; source_amount: number; base_amount: number
  cost_category: string; allocation_date: string; reverses_id: string | null; reversed_by_id: string | null
}
type ReceiptCandidate = {
  company_id: string; service_job_id: string; receipt_channel: 'cash' | 'bank'
  receipt_transaction_id: string; received_on: string; receipt_amount_base: number
  anchor_type: string; anchor_reference: string | null; memo: string | null
}
type ReceiptShare = {
  id: string; company_id: string; service_job_id: string; receipt_channel: 'cash' | 'bank'
  receipt_cash_transaction_id: string | null; receipt_bank_transaction_id: string | null
  receipt_amount_base: number; share_percent: number; share_amount_base: number
  direct_cost_id: string; description_snapshot: string; payout_channel: 'cash' | 'bank' | null
  payout_bank_id: string | null; paid_at: string | null; created_at: string
}
type JobBank = { id: string; name: string; bank_name: string | null }
type Event = { id: string; event_type: string; occurred_at: string; reason: string | null }
type CostSummary = {
  materials: number; labour: number; subcontractors: number; suppliers: number
  otherDirectCosts: number; totalActualCost: number
}

const statusTone = (status: Job['execution_status']): PremiumTone =>
  status === 'completed' ? 'success' : status === 'cancelled' ? 'danger' : status === 'in_progress' ? 'info' : 'neutral'
const requestKey = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const receiptCandidateKey = (row: ReceiptCandidate) => `${row.receipt_channel}:${row.receipt_transaction_id}`

export default function ServiceJobs() {
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const { companyId, myRole } = useOrg()
  const [params, setParams] = useSearchParams()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [baseCode, setBaseCode] = useState('MZN')
  const [filter, setFilter] = useState('all')
  const selectedId = params.get('jobId')
  const salesOrderId = params.get('salesOrderId')
  const selected = jobs.find(job => job.id === selectedId) || null
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const money = useCallback((value: number) => formatMoneyBase(Number(value || 0), baseCode, locale), [baseCode, locale])
  const canOperate = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'].includes(myRole || '')
  const canAdmin = ['OWNER', 'ADMIN'].includes(myRole || '')
  const canManageSettlement = financeCan.settlementSensitive(myRole)

  useEffect(() => { getBaseCurrencyCode().then(setBaseCode) }, [])
  useEffect(() => {
    if (!companyId) return
    let active = true
    setLoading(true)
    supabase.from('service_jobs_register').select('*').eq('company_id', companyId)
      .order('created_at', { ascending: false }).then(({ data, error: readError }) => {
        if (!active) return
        if (readError) console.error('Service Job register load failed', readError)
        setError(readError ? tt('serviceJobs.loadFailed', 'Service Jobs could not be loaded. Try again.') : null)
        if (!readError) setJobs((data || []) as Job[])
        setLoading(false)
      })
    return () => { active = false }
  }, [companyId, revision])

  const visible = useMemo(() => jobs.filter(job => filter === 'all'
    || (filter === 'active' && !['completed', 'cancelled'].includes(job.execution_status))
    || job.execution_status === filter
    || (filter === 'costing_open' && job.execution_status === 'completed' && job.costing_status === 'open')),
  [jobs, filter])
  const metrics = useMemo(() => ({
    active: jobs.filter(job => ['planned', 'in_progress'].includes(job.execution_status)).length,
    completedOpen: jobs.filter(job => job.execution_status === 'completed' && job.costing_status === 'open').length,
    finalised: jobs.filter(job => job.costing_status === 'finalised').length,
    actualCost: jobs.filter(job => job.costing_status === 'finalised').reduce((sum, job) => sum + Number(job.total_actual_cost), 0),
  }), [jobs])
  const refresh = () => setRevision(value => value + 1)
  const openJob = (id: string | null) => {
    const copy = new URLSearchParams(params)
    id ? copy.set('jobId', id) : copy.delete('jobId')
    setParams(copy)
  }

  return (
    <div className="app-page space-y-6">
      <PremiumPageHeader
        title={tt('serviceJobs.title', 'Service Jobs')}
        actions={<Button variant="outline" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />{tt('common.refresh', 'Refresh')}</Button>}
      />
      <OperationalSummaryBand label={tt('serviceJobs.summaryLabel', 'Service Job register summary')} items={[
        { label: tt('serviceJobs.active', 'Active jobs'), value: String(metrics.active), tone: 'info' },
        { label: tt('serviceJobs.completedOpen', 'Completed, costing open'), value: String(metrics.completedOpen), tone: metrics.completedOpen ? 'warning' : 'neutral' },
        { label: tt('serviceJobs.finalised', 'Costing finalised'), value: String(metrics.finalised) },
        { label: tt('serviceJobs.finalisedCost', 'Finalised actual cost'), value: money(metrics.actualCost) },
      ]} />
      {salesOrderId && canOperate ? <CreateFromOrder companyId={companyId!} salesOrderId={salesOrderId} tt={tt}
        onCreated={id => { const copy = new URLSearchParams(params); copy.delete('salesOrderId'); copy.set('jobId', id); setParams(copy); refresh() }}
        onCancel={() => { const copy = new URLSearchParams(params); copy.delete('salesOrderId'); setParams(copy) }} /> : null}
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>{tt('serviceJobs.register', 'Job register')}</CardTitle></div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-full sm:w-56" aria-label={tt('serviceJobs.filter', 'Filter jobs')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{tt('serviceJobs.active', 'Active jobs')}</SelectItem>
              <SelectItem value="planned">{tt('serviceJobs.status.planned', 'Planned')}</SelectItem>
              <SelectItem value="in_progress">{tt('serviceJobs.status.inProgress', 'In progress')}</SelectItem>
              <SelectItem value="completed">{tt('serviceJobs.status.completed', 'Completed')}</SelectItem>
              <SelectItem value="costing_open">{tt('serviceJobs.completedOpen', 'Completed, costing open')}</SelectItem>
              <SelectItem value="cancelled">{tt('serviceJobs.status.cancelled', 'Cancelled')}</SelectItem>
              <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? <PremiumSkeleton rows={5} /> : error ? <PremiumStatePanel tone="danger" title={tt('serviceJobs.unavailable', 'Service Jobs unavailable')} description={error} />
            : visible.length ? <div className="divide-y rounded-xl border">
              {visible.map(job => <button key={job.id} type="button" onClick={() => openJob(job.id)}
                className="grid w-full gap-3 p-4 text-left transition hover:bg-muted/50 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center">
                <span className="min-w-0"><span className="block font-semibold">{job.job_reference} · {job.title}</span><span className="block truncate text-sm text-muted-foreground">{job.customer_name} · {job.order_no || '—'}</span></span>
                <span className="text-sm text-muted-foreground">{job.service_line_count} {tt('serviceJobs.lines', 'service lines')} · {(Math.round(Number(job.worked_minutes || 0) / 60 * 10) / 10).toLocaleString(locale, { maximumFractionDigits: 1 })}h</span>
                <span className="flex flex-wrap gap-2"><PremiumStatusBadge tone={statusTone(job.execution_status)}>{statusLabel(job.execution_status, tt)}</PremiumStatusBadge><PremiumStatusBadge tone={job.costing_status === 'finalised' ? 'success' : 'neutral'}>{job.costing_status === 'finalised' ? tt('serviceJobs.costing.finalised', 'Costing finalised') : tt('serviceJobs.costing.open', 'Costing open')}</PremiumStatusBadge></span>
              </button>)}
            </div> : <PremiumEmptyState
              title={jobs.length ? tt('serviceJobs.filteredEmpty', 'No Service Jobs match this filter') : tt('serviceJobs.empty', 'No Service Jobs yet')}
              description={jobs.length ? tt('serviceJobs.filteredEmptyHelp', 'Choose another status to review the full register.') : tt('serviceJobs.emptyHelp', 'Open an eligible Sales Order and create a job from its service lines.')}
            />}
        </CardContent>
      </Card>
      <Sheet open={Boolean(selected)} onOpenChange={open => { if (!open) openJob(null) }}>
        <SheetContent className="w-full overflow-x-hidden overflow-y-auto sm:max-w-3xl">
          {selected ? <JobDetail job={selected} companyId={companyId!} canOperate={canOperate} canAdmin={canAdmin}
            canManageSettlement={canManageSettlement} money={money} locale={locale} tt={tt} refresh={refresh} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function CreateFromOrder({ companyId, salesOrderId, tt, onCreated, onCancel }: {
  companyId: string; salesOrderId: string; tt: (key: string, fallback: string) => string
  onCreated: (id: string) => void; onCancel: () => void
}) {
  const [lines, setLines] = useState<{ id: string; item_id: string; description: string | null; qty: number; name: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [billing, setBilling] = useState<Record<string, 'per_job' | 'per_hour' | 'fixed_fee'>>({})
  const [scheduledStart, setScheduledStart] = useState('')
  const [scheduledEnd, setScheduledEnd] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data: orderLines, error } = await supabase.from('sales_order_lines')
        .select('id,item_id,description,qty').eq('company_id', companyId).eq('so_id', salesOrderId)
      if (error) { console.error('Service line load failed', error); toast.error(tt('serviceJobs.createLoadFailed', 'Eligible service lines could not be loaded.')); return }
      const itemIds = [...new Set((orderLines || []).map(line => line.item_id))]
      const { data: items, error: itemError } = await supabase.from('items').select('id,name,primary_role')
        .eq('company_id', companyId).in('id', itemIds)
      if (!active) return
      if (itemError) { console.error('Service item load failed', itemError); toast.error(tt('serviceJobs.createLoadFailed', 'Eligible service lines could not be loaded.')); return }
      const serviceItems = new Map((items || []).filter(item => item.primary_role === 'service').map(item => [item.id, item.name]))
      const eligible = (orderLines || []).filter(line => serviceItems.has(line.item_id))
        .map(line => ({ ...line, name: serviceItems.get(line.item_id)! }))
      setLines(eligible); setSelected(eligible.map(line => line.id))
      setBilling(Object.fromEntries(eligible.map(line => [line.id, 'per_job'])))
      if (eligible.length) setTitle(eligible.length === 1 ? eligible[0].name : 'Service work')
    })()
    return () => { active = false }
  }, [companyId, salesOrderId])
  const create = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('create_service_job', {
      p_company_id: companyId, p_sales_order_id: salesOrderId, p_line_ids: selected,
      p_title: title, p_description: description || null,
      p_scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : null,
      p_scheduled_end: scheduledEnd ? new Date(scheduledEnd).toISOString() : null, p_billing_basis: billing,
    })
    setBusy(false)
    if (error) { console.error('Service Job creation failed', error); toast.error(tt('serviceJobs.createFailed', 'The Service Job was not created. Review the order and try again.')); return }
    toast.success(tt('serviceJobs.created', 'Service Job created')); onCreated(data as string)
  }
  return <Card>
    <CardHeader><CardTitle>{tt('serviceJobs.createFromOrder', 'Create from Sales Order')}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {lines.length ? <div className="space-y-2">{lines.map(line => <label key={line.id} className="flex min-h-11 items-start gap-3 rounded-lg border p-3">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={selected.includes(line.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, line.id] : previous.filter(id => id !== line.id))} />
        <span className="min-w-0 flex-1"><span className="block font-medium">{line.description || line.name}</span><span className="block text-xs text-muted-foreground">{line.qty}</span><Select value={billing[line.id] || 'per_job'} onValueChange={value => setBilling(previous => ({ ...previous, [line.id]: value as 'per_job' | 'per_hour' | 'fixed_fee' }))}><SelectTrigger className="mt-2 w-full sm:w-44" aria-label={tt('serviceJobs.billingBasis', 'Billing basis')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="per_job">{tt('serviceJobs.billing.perJob', 'Per job')}</SelectItem><SelectItem value="per_hour">{tt('serviceJobs.billing.perHour', 'Per hour')}</SelectItem><SelectItem value="fixed_fee">{tt('serviceJobs.billing.fixedFee', 'Fixed fee')}</SelectItem></SelectContent></Select></span>
      </label>)}</div> : <PremiumStatePanel tone="warning" title={tt('serviceJobs.noEligibleLines', 'No eligible service lines')} description={tt('serviceJobs.noEligibleLinesHelp', 'Only items explicitly classified with the Service role can create a Service Job.')} />}
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1"><Label>{tt('serviceJobs.jobTitle', 'Job title')}</Label><Input value={title} onChange={event => setTitle(event.target.value)} /></label><label className="space-y-1"><Label>{tt('common.description', 'Description')}</Label><Input value={description} onChange={event => setDescription(event.target.value)} /></label><label className="space-y-1"><Label>{tt('serviceJobs.scheduledStart', 'Scheduled start')}</Label><Input type="datetime-local" value={scheduledStart} onChange={event => setScheduledStart(event.target.value)} /></label><label className="space-y-1"><Label>{tt('serviceJobs.scheduledEnd', 'Scheduled end')}</Label><Input type="datetime-local" min={scheduledStart} value={scheduledEnd} onChange={event => setScheduledEnd(event.target.value)} /></label></div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !title.trim() || !selected.length} onClick={create}>{tt('serviceJobs.create', 'Create Service Job')}</Button><Button variant="outline" onClick={onCancel}>{tt('common.cancel', 'Cancel')}</Button></div>
    </CardContent>
  </Card>
}

function JobDetail({ job, companyId, canOperate, canAdmin, canManageSettlement, money, locale, tt, refresh }: {
  job: Job; companyId: string; canOperate: boolean; canAdmin: boolean; canManageSettlement: boolean
  money: (value: number) => string; locale: string; tt: (key: string, fallback: string) => string; refresh: () => void
}) {
  const [lines, setLines] = useState<JobLine[]>([])
  const [times, setTimes] = useState<TimeEntry[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [costs, setCosts] = useState<DirectCost[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [manualMinutes, setManualMinutes] = useState('60')
  const [directDescription, setDirectDescription] = useState('')
  const [directAmount, setDirectAmount] = useState('')
  const [directCategory, setDirectCategory] = useState('labour')
  const [customerMaterial, setCustomerMaterial] = useState('')
  const [customerQuantity, setCustomerQuantity] = useState('1')
  const [customerUom, setCustomerUom] = useState('')
  const [uoms, setUoms] = useState<{ id: string; code: string; name: string }[]>([])
  const [stockItems, setStockItems] = useState<{ id: string; name: string; base_uom_id: string }[]>([])
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [bins, setBins] = useState<{ id: string; name: string; warehouseId: string }[]>([])
  const [vendorLines, setVendorLines] = useState<{ id: string; description: string; line_total: number; vendor_bill_id: string; reference: string }[]>([])
  const [stockItemId, setStockItemId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [binId, setBinId] = useState('')
  const [stockQuantity, setStockQuantity] = useState('1')
  const [vendorLineId, setVendorLineId] = useState('')
  const [vendorAmount, setVendorAmount] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [receiptCandidates, setReceiptCandidates] = useState<ReceiptCandidate[]>([])
  const [receiptShares, setReceiptShares] = useState<ReceiptShare[]>([])
  const [shareBanks, setShareBanks] = useState<JobBank[]>([])
  const [shareReceiptKey, setShareReceiptKey] = useState('')
  const [sharePercent, setSharePercent] = useState('50')
  const [shareExistingCostId, setShareExistingCostId] = useState('__new__')
  const [shareDescription, setShareDescription] = useState('')
  const [sharePayoutMode, setSharePayoutMode] = useState<'cost_only' | 'cash' | 'bank'>('cost_only')
  const [sharePayoutBankId, setSharePayoutBankId] = useState('')

  const load = useCallback(async () => {
    setDetailLoading(true)
    setDetailError(null)
    const [lineRead, timeRead, materialRead, costRead, allocationRead, eventRead, costSummary, itemRead, uomRead, warehouseRead, binRead, billRead, receiptCandidateRead, receiptShareRead, shareBankRead] = await Promise.all([
      supabase.from('service_job_lines').select('*').eq('service_job_id', job.id).order('created_at'),
      supabase.from('service_job_time_entries').select('*').eq('service_job_id', job.id).order('created_at', { ascending: false }),
      supabase.from('service_job_materials').select('*').eq('service_job_id', job.id).order('created_at', { ascending: false }),
      supabase.from('service_job_direct_costs').select('*').eq('service_job_id', job.id).order('created_at', { ascending: false }),
      supabase.from('service_job_vendor_allocations').select('*').eq('service_job_id', job.id).order('created_at', { ascending: false }),
      supabase.from('service_job_events').select('id,event_type,occurred_at,reason').eq('service_job_id', job.id).order('occurred_at', { ascending: false }),
      supabase.rpc('get_service_job_cost_summary', { p_company_id: companyId, p_service_job_id: job.id }),
      supabase.from('items').select('id,name,base_uom_id').eq('company_id', companyId).eq('track_inventory', true).order('name'),
      supabase.from('uoms').select('id,code,name').order('code'),
      supabase.from('warehouses').select('id,name').eq('company_id', companyId).eq('status', 'active').order('name'),
      supabase.from('bins').select('id,name,warehouseId').eq('company_id', companyId).eq('status', 'active').order('name'),
      supabase.from('vendor_bills').select('id,internal_reference').eq('company_id', companyId).eq('document_workflow_status', 'posted').eq('approval_status', 'approved'),
      supabase.from('v_service_job_receipt_candidates').select('*').eq('company_id', companyId).eq('service_job_id', job.id).order('received_on', { ascending: false }),
      supabase.from('service_job_receipt_shares').select('*').eq('company_id', companyId).eq('service_job_id', job.id).order('created_at', { ascending: false }),
      supabase.from('bank_accounts').select('id,name,bank_name').eq('company_id', companyId).order('name'),
    ])
    const firstError = [lineRead, timeRead, materialRead, costRead, allocationRead, eventRead, costSummary, itemRead, uomRead, warehouseRead, binRead, billRead, receiptCandidateRead, receiptShareRead, shareBankRead].find(result => result.error)?.error
    if (firstError) {
      console.error('Service Job detail load failed', firstError)
      setDetailError(tt('serviceJobs.detailLoadFailed', 'Service Job evidence could not be loaded. Try again.'))
      setDetailLoading(false)
      return
    }
    const loadedCosts = (costRead.data || []) as DirectCost[]
    const loadedCandidates = (receiptCandidateRead.data || []) as ReceiptCandidate[]
    const loadedShares = (receiptShareRead.data || []) as ReceiptShare[]
    const loadedBanks = (shareBankRead.data || []) as JobBank[]
    setLines((lineRead.data || []) as JobLine[])
    setTimes((timeRead.data || []) as TimeEntry[])
    setMaterials((materialRead.data || []) as Material[])
    setCosts(loadedCosts)
    setAllocations((allocationRead.data || []) as Allocation[])
    setEvents((eventRead.data || []) as Event[])
    setSummary(costSummary.data as CostSummary)
    setReceiptCandidates(loadedCandidates)
    setReceiptShares(loadedShares)
    setShareBanks(loadedBanks)
    setShareReceiptKey(current => loadedCandidates.some(row => receiptCandidateKey(row) === current)
      ? current
      : (loadedCandidates[0] ? receiptCandidateKey(loadedCandidates[0]) : ''))
    setShareExistingCostId(current => current === '__new__' || loadedCosts.some(cost => (
      cost.id === current && cost.category === 'subcontractor' && !cost.reverses_id && !cost.reversed_by_id
      && !loadedShares.some(share => share.direct_cost_id === current)
    )) ? current : '__new__')
    setSharePayoutBankId(current => loadedBanks.some(bank => bank.id === current) ? current : '')
    setStockItems((itemRead.data || []) as { id: string; name: string; base_uom_id: string }[])
    const availableUoms = (uomRead.data || []) as { id: string; code: string; name: string }[]
    setUoms(availableUoms)
    setCustomerUom(current => availableUoms.some(uom => uom.id === current)
      ? current
      : (availableUoms.find(uom => uom.code.toUpperCase() === 'EA')?.id || availableUoms[0]?.id || ''))
    setWarehouses((warehouseRead.data || []) as { id: string; name: string }[])
    setBins((binRead.data || []) as { id: string; name: string; warehouseId: string }[])
    const billIds = (billRead.data || []).map(bill => bill.id)
    if (billIds.length) {
      const lineResult = await supabase.from('vendor_bill_lines').select('id,description,line_total,vendor_bill_id')
        .eq('company_id', companyId).in('vendor_bill_id', billIds).gt('line_total', 0)
      if (lineResult.error) {
        console.error('Service Job vendor evidence load failed', lineResult.error)
        setDetailError(tt('serviceJobs.detailLoadFailed', 'Service Job evidence could not be loaded. Try again.'))
      }
      else {
        const references = new Map((billRead.data || []).map(bill => [bill.id, bill.internal_reference]))
        setVendorLines((lineResult.data || []).map(line => ({ ...line, reference: references.get(line.vendor_bill_id) || '—' })))
      }
    } else setVendorLines([])
    setDetailLoading(false)
  }, [companyId, job.id])
  useEffect(() => { void load() }, [load])
  const mutate = async (name: string, args: Record<string, unknown>, success: string) => {
    setBusy(true)
    const { error } = await supabase.rpc(name, args)
    setBusy(false)
    if (error) {
      console.error(`Service Job action failed: ${name}`, error)
      toast.error(tt('serviceJobs.actionFailed', 'The action did not complete. Review the current job state and try again.'))
      return
    }
    toast.success(success); setReason(''); await load(); refresh()
  }
  const openTimer = times.find(entry => entry.source === 'timer' && !entry.stopped_at)
  const linkedDirectCostIds = new Set(receiptShares.map(share => share.direct_cost_id))
  const eligibleShareCosts = costs.filter(cost => cost.category === 'subcontractor'
    && !cost.reverses_id && !cost.reversed_by_id && !linkedDirectCostIds.has(cost.id))
  const selectedReceipt = receiptCandidates.find(row => receiptCandidateKey(row) === shareReceiptKey) || null
  const normalizedSharePercent = Number(sharePercent)
  const calculatedShareAmount = selectedReceipt && Number.isFinite(normalizedSharePercent)
    ? Math.round((Number(selectedReceipt.receipt_amount_base) * normalizedSharePercent / 100 + Number.EPSILON) * 100) / 100
    : 0

  const shareErrorMessage = (error: unknown) => {
    const message = String((error as { message?: string } | null)?.message || '').toLowerCase()
    if (message.includes('cost_amount_mismatch')) return tt('serviceJobs.shareCostMismatch', 'The selected direct cost does not match the calculated collection share.')
    if (message.includes('cost_already_linked')) return tt('serviceJobs.shareCostLinked', 'That direct cost is already linked to another collection share.')
    if (message.includes('share_exceeds_receipt')) return tt('serviceJobs.shareExceedsReceipt', 'Linked shares cannot exceed the actual amount collected.')
    if (message.includes('receipt_not_eligible')) return tt('serviceJobs.shareReceiptUnavailable', 'That receipt is no longer eligible for this Service Job. Refresh and try again.')
    if (message.includes('insufficient_company_role')) return tt('serviceJobs.sharePayoutPermission', 'Finance authority is required to pay a collection share from cash or bank.')
    return tt('serviceJobs.shareFailed', 'The collection share could not be recorded. Review the receipt, cost and payout details.')
  }

  const recordReceiptShare = async () => {
    if (!selectedReceipt || !Number.isFinite(normalizedSharePercent) || normalizedSharePercent <= 0 || normalizedSharePercent > 100) {
      toast.error(tt('serviceJobs.shareInvalid', 'Choose an actual receipt and enter a share percentage between 0 and 100.'))
      return
    }
    const existingCost = shareExistingCostId === '__new__' ? null : eligibleShareCosts.find(cost => cost.id === shareExistingCostId) || null
    if (existingCost && Math.abs(Number(existingCost.base_amount) - calculatedShareAmount) > 0.005) {
      toast.error(tt('serviceJobs.shareCostMismatch', 'The selected direct cost does not match the calculated collection share.'))
      return
    }
    if (!existingCost && !shareDescription.trim()) {
      toast.error(tt('serviceJobs.shareDescriptionRequired', 'Describe the collaborator or revenue-share cost before recording it.'))
      return
    }
    if (sharePayoutMode !== 'cost_only' && !canManageSettlement) {
      toast.error(tt('serviceJobs.sharePayoutPermission', 'Finance authority is required to pay a collection share from cash or bank.'))
      return
    }
    if (sharePayoutMode === 'bank' && !sharePayoutBankId) {
      toast.error(tt('serviceJobs.shareBankRequired', 'Choose the bank or wallet that will fund the payout.'))
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('record_service_job_receipt_share', {
        p_company_id: companyId,
        p_service_job_id: job.id,
        p_receipt_channel: selectedReceipt.receipt_channel,
        p_receipt_transaction_id: selectedReceipt.receipt_transaction_id,
        p_share_percent: normalizedSharePercent,
        p_description: shareDescription.trim() || null,
        p_existing_direct_cost_id: existingCost?.id || null,
        p_payout_channel: sharePayoutMode === 'cost_only' ? null : sharePayoutMode,
        p_payout_bank_id: sharePayoutMode === 'bank' ? sharePayoutBankId : null,
        p_paid_on: new Date().toISOString().slice(0, 10),
        p_request_key: requestKey('service-receipt-share'),
      })
      if (error) throw error
      toast.success(tt('serviceJobs.shareRecorded', 'Collection share linked to the Service Job'))
      setShareExistingCostId('__new__')
      setShareDescription('')
      setSharePayoutMode('cost_only')
      await load()
      refresh()
    } catch (error) {
      console.error('Service Job collection share failed', error)
      toast.error(shareErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const payReceiptShare = async (share: ReceiptShare, channel: 'cash' | 'bank') => {
    if (!canManageSettlement) {
      toast.error(tt('serviceJobs.sharePayoutPermission', 'Finance authority is required to pay a collection share from cash or bank.'))
      return
    }
    if (channel === 'bank' && !sharePayoutBankId) {
      toast.error(tt('serviceJobs.shareBankRequired', 'Choose the bank or wallet that will fund the payout.'))
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('pay_service_job_receipt_share', {
        p_company_id: companyId,
        p_share_id: share.id,
        p_payout_channel: channel,
        p_bank_id: channel === 'bank' ? sharePayoutBankId : null,
        p_paid_on: new Date().toISOString().slice(0, 10),
        p_memo: `Revenue-share payout: ${share.description_snapshot}`,
        p_request_key: requestKey('service-receipt-share-payout'),
      })
      if (error) throw error
      toast.success(tt('serviceJobs.sharePaid', 'Collection-share payout recorded'))
      await load()
      refresh()
    } catch (error) {
      console.error('Service Job collection share payout failed', error)
      toast.error(shareErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <SheetHeader>
      <div className="flex flex-wrap items-center gap-2"><PremiumStatusBadge tone={statusTone(job.execution_status)}>{statusLabel(job.execution_status, tt)}</PremiumStatusBadge><PremiumStatusBadge tone={job.costing_status === 'finalised' ? 'success' : 'neutral'}>{job.costing_status === 'finalised' ? tt('serviceJobs.costing.finalised', 'Costing finalised') : tt('serviceJobs.costing.open', 'Costing open')}</PremiumStatusBadge></div>
      <SheetTitle>{job.job_reference} · {job.title}</SheetTitle>
      <SheetDescription>{job.customer_name} · {job.order_no || '—'}</SheetDescription>
    </SheetHeader>
    <SheetBody className="space-y-6 pb-10">
      {detailLoading ? <PremiumSkeleton lines={8} /> : detailError ? (
        <PremiumStatePanel tone="danger" title={tt('serviceJobs.unavailable', 'Service Jobs unavailable')} description={detailError} action={<Button variant="outline" onClick={() => void load()}>{tt('common.retry', 'Try again')}</Button>} />
      ) : <>
      <div className="flex flex-wrap gap-2">
        {canOperate && job.execution_status === 'planned' ? <Button disabled={busy} onClick={() => mutate('transition_service_job', { p_company_id: companyId, p_service_job_id: job.id, p_action: 'start', p_reason: null }, tt('serviceJobs.started', 'Job started'))}>{tt('serviceJobs.start', 'Start job')}</Button> : null}
        {canOperate && job.execution_status === 'in_progress' ? <Button disabled={busy || Boolean(openTimer)} onClick={() => mutate('transition_service_job', { p_company_id: companyId, p_service_job_id: job.id, p_action: 'complete', p_reason: null }, tt('serviceJobs.completed', 'Job completed'))}>{tt('serviceJobs.complete', 'Complete job')}</Button> : null}
        {canOperate && ['planned', 'in_progress'].includes(job.execution_status) ? <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => mutate('transition_service_job', { p_company_id: companyId, p_service_job_id: job.id, p_action: 'cancel', p_reason: reason }, tt('serviceJobs.cancelled', 'Job cancelled'))}>{tt('serviceJobs.cancel', 'Cancel job')}</Button> : null}
        {canAdmin && job.execution_status === 'completed' ? <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => mutate('transition_service_job', { p_company_id: companyId, p_service_job_id: job.id, p_action: 'reopen', p_reason: reason }, tt('serviceJobs.reopened', 'Execution reopened'))}>{tt('serviceJobs.reopenExecution', 'Reopen execution')}</Button> : null}
      </div>
      {(canOperate && ['planned', 'in_progress'].includes(job.execution_status)) || (canAdmin && job.execution_status === 'completed') ? <div className="space-y-2"><Label htmlFor="service-reason">{tt('serviceJobs.reason', 'Reason')}</Label><Textarea id="service-reason" value={reason} onChange={event => setReason(event.target.value)} /></div> : null}

      <PremiumSection title={tt('serviceJobs.scope', 'Service scope')}>
        <div className="space-y-2">{lines.map(line => <Card key={line.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{line.description_snapshot}</p><p className="text-xs text-muted-foreground">{line.commercial_quantity} · {billingLabel(line.billing_basis, tt)}</p></div></CardContent></Card>)}</div>
      </PremiumSection>

      <PremiumSection title={tt('serviceJobs.time', 'Time worked')} description={tt('serviceJobs.timeCostWarning', 'Time worked does not become labour cost until an actual labour cost is recorded.')}>
        {canOperate && job.costing_status === 'open' && ['planned', 'in_progress', 'completed'].includes(job.execution_status) ? <div className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap gap-2">
            {openTimer ? <Button disabled={busy} onClick={() => mutate('stop_service_job_timer', { p_company_id: companyId, p_time_entry_id: openTimer.id }, tt('serviceJobs.timerStopped', 'Timer stopped'))}><Clock3 className="mr-2 h-4 w-4" />{tt('serviceJobs.stopTimer', 'Stop timer')}</Button>
              : <Button disabled={busy || job.execution_status !== 'in_progress'} onClick={() => mutate('start_service_job_timer', { p_company_id: companyId, p_service_job_id: job.id, p_worker_user_id: null, p_worker_display_name: tt('serviceJobs.currentUser', 'Current user'), p_notes: null }, tt('serviceJobs.timerStarted', 'Timer started'))}><Clock3 className="mr-2 h-4 w-4" />{tt('serviceJobs.startTimer', 'Start timer')}</Button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><label className="space-y-1"><Label>{tt('serviceJobs.minutes', 'Minutes')}</Label><Input type="number" min="1" max="1440" value={manualMinutes} onChange={event => setManualMinutes(event.target.value)} /></label><Button variant="outline" disabled={busy || Number(manualMinutes) < 1} onClick={() => mutate('add_service_job_manual_time', { p_company_id: companyId, p_service_job_id: job.id, p_worker_user_id: null, p_worker_display_name: tt('serviceJobs.currentUser', 'Current user'), p_work_date: new Date().toISOString().slice(0, 10), p_duration_minutes: Number(manualMinutes), p_notes: null }, tt('serviceJobs.timeAdded', 'Time entry added'))}><Plus className="mr-2 h-4 w-4" />{tt('serviceJobs.addManualTime', 'Add manual time')}</Button></div>
        </div> : null}
        <EvidenceList empty={tt('serviceJobs.noTime', 'No time recorded.')} rows={times.map(entry => ({ id: entry.id, title: `${entry.worker_display_name} · ${entry.duration_minutes ?? tt('serviceJobs.running', 'Running')}`, detail: `${entry.work_date} · ${entry.source}` }))} />
      </PremiumSection>

      <PremiumSection title={tt('serviceJobs.materials', 'Materials')}>
        {canOperate && job.costing_status === 'open' ? <label className="mb-3 block space-y-1"><Label>{tt('serviceJobs.correctionReason', 'Correction reason')}</Label><Input value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} placeholder={tt('serviceJobs.correctionReasonHelp', 'Required for reversals')} /></label> : null}
        <h3 className="mb-2 font-semibold">{tt('serviceJobs.companyMaterials', 'Company stock')}</h3>
        {canOperate && job.costing_status === 'open' ? <div className="mb-3 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <label className="space-y-1"><Label>{tt('serviceJobs.stockItem', 'Stock item')}</Label><Select value={stockItemId} onValueChange={setStockItemId}><SelectTrigger><SelectValue placeholder={tt('serviceJobs.chooseItem', 'Choose item')} /></SelectTrigger><SelectContent>{stockItems.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><Label>{tt('common.quantity', 'Quantity')}</Label><Input type="number" min="0.0001" value={stockQuantity} onChange={event => setStockQuantity(event.target.value)} /></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.warehouse', 'Warehouse')}</Label><Select value={warehouseId} onValueChange={value => { setWarehouseId(value); setBinId('') }}><SelectTrigger><SelectValue placeholder={tt('serviceJobs.chooseWarehouse', 'Choose warehouse')} /></SelectTrigger><SelectContent>{warehouses.map(row => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.bin', 'Bin')}</Label><Select value={binId} onValueChange={setBinId}><SelectTrigger><SelectValue placeholder={tt('serviceJobs.chooseBin', 'Choose bin')} /></SelectTrigger><SelectContent>{bins.filter(row => row.warehouseId === warehouseId).map(row => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent></Select></label>
          <Button className="sm:col-span-2" variant="outline" disabled={busy || !stockItemId || !warehouseId || !binId || Number(stockQuantity) <= 0} onClick={() => {
            const item = stockItems.find(row => row.id === stockItemId)
            return mutate('issue_service_job_material', { p_company_id: companyId, p_service_job_id: job.id, p_item_id: stockItemId, p_warehouse_id: warehouseId, p_bin_id: binId, p_quantity: Number(stockQuantity), p_uom_id: item?.base_uom_id, p_posting_request_key: requestKey('service-material'), p_note: null }, tt('serviceJobs.materialIssued', 'Company material issued'))
          }}>{tt('serviceJobs.issueMaterial', 'Issue company material')}</Button>
        </div> : null}
        <div className="divide-y rounded-xl border">{materials.filter(item => item.supply_type === 'company').length ? materials.filter(item => item.supply_type === 'company').map(item => <div key={item.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium">{item.description} · {formatOperationalQuantity(Number(item.quantity), locale)} {uoms.find(uom => uom.id === item.uom_id)?.code || tt('serviceJobs.uomUnavailable', 'Unit unavailable')}</p><p className="text-xs text-muted-foreground">{item.reverses_id ? tt('serviceJobs.reversal', 'Reversal') : money(item.base_amount)}</p></div>{canOperate && job.costing_status === 'open' && !item.reverses_id && !item.reversed_by_id ? <Button size="sm" variant="outline" disabled={busy || !correctionReason.trim()} onClick={() => mutate('reverse_service_job_material', { p_company_id: companyId, p_material_id: item.id, p_reason: correctionReason, p_posting_request_key: requestKey('service-material-reversal') }, tt('serviceJobs.materialReversed', 'Material issue reversed'))}>{tt('serviceJobs.reverse', 'Reverse')}</Button> : null}</div>) : <p className="p-4 text-sm text-muted-foreground">{tt('serviceJobs.noCompanyMaterials', 'No company-stock materials issued.')}</p>}</div>
        <h3 className="mb-2 mt-5 font-semibold">{tt('serviceJobs.customerMaterials', 'Customer supplied')}</h3>
        {canOperate && job.costing_status === 'open' ? <div className="mb-3 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2"><Label>{tt('common.description', 'Description')}</Label><Input value={customerMaterial} onChange={event => setCustomerMaterial(event.target.value)} /></label>
          <label className="space-y-1"><Label>{tt('common.quantity', 'Quantity')}</Label><Input type="number" min="0.0001" value={customerQuantity} onChange={event => setCustomerQuantity(event.target.value)} /></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.uom', 'Unit')}</Label><Select value={customerUom} onValueChange={setCustomerUom}><SelectTrigger><SelectValue placeholder={tt('serviceJobs.chooseUom', 'Choose unit')} /></SelectTrigger><SelectContent>{uoms.map(uom => <SelectItem key={uom.id} value={uom.id}>{uom.code} · {uom.name}</SelectItem>)}</SelectContent></Select></label>
          <Button className="sm:col-span-2" variant="outline" disabled={busy || !customerMaterial.trim() || Number(customerQuantity) <= 0 || !customerUom} onClick={() => mutate('add_customer_service_job_material', { p_company_id: companyId, p_service_job_id: job.id, p_description: customerMaterial, p_quantity: Number(customerQuantity), p_uom_id: customerUom, p_occurred_on: new Date().toISOString().slice(0, 10), p_item_id: null, p_notes: null }, tt('serviceJobs.customerMaterialAdded', 'Customer-supplied material recorded'))}>{tt('serviceJobs.addCustomerMaterial', 'Record customer-supplied material')}</Button>
        </div> : null}
        <EvidenceList empty={tt('serviceJobs.noCustomerMaterials', 'No customer-supplied materials recorded.')} rows={materials.filter(item => item.supply_type === 'customer').map(item => ({ id: item.id, title: `${item.description} · ${formatOperationalQuantity(Number(item.quantity), locale)} ${uoms.find(uom => uom.id === item.uom_id)?.code || tt('serviceJobs.uomUnavailable', 'Unit unavailable')}`, detail: tt('serviceJobs.customerSupplied', 'Customer supplied') }))} />
      </PremiumSection>

      <PremiumSection title={tt('serviceJobs.directCosts', 'Direct costs')}>
        {canOperate && job.costing_status === 'open' ? <div className="mb-3 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <label className="space-y-1"><Label>{tt('serviceJobs.category', 'Category')}</Label><Select value={directCategory} onValueChange={setDirectCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="labour">{tt('serviceJobs.labour', 'Labour')}</SelectItem><SelectItem value="subcontractor">{tt('serviceJobs.subcontractor', 'Subcontractor')}</SelectItem><SelectItem value="other_direct_cost">{tt('serviceJobs.otherDirectCost', 'Other direct cost')}</SelectItem></SelectContent></Select></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.amount', 'Amount')}</Label><Input type="number" min="0.01" value={directAmount} onChange={event => setDirectAmount(event.target.value)} /></label>
          <label className="space-y-1 sm:col-span-2"><Label>{tt('common.description', 'Description')}</Label><Input value={directDescription} onChange={event => setDirectDescription(event.target.value)} /></label>
          <Button className="sm:col-span-2" variant="outline" disabled={busy || !directDescription.trim() || Number(directAmount) <= 0} onClick={() => mutate('add_service_job_direct_cost', { p_company_id: companyId, p_service_job_id: job.id, p_category: directCategory, p_description: directDescription, p_source_currency: 'MZN', p_source_amount: Number(directAmount), p_fx_to_base: 1, p_cost_date: new Date().toISOString().slice(0, 10), p_external_reference: null, p_supplier_id: null, p_time_entry_id: null }, tt('serviceJobs.costAdded', 'Direct cost recorded'))}>{tt('serviceJobs.addCost', 'Record direct cost')}</Button>
        </div> : null}
        <div className="divide-y rounded-xl border">{costs.length ? costs.map(cost => <div key={cost.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium">{cost.description} · {money(cost.base_amount)}</p><p className="text-xs text-muted-foreground">{cost.reverses_id ? tt('serviceJobs.reversal', 'Reversal') : cost.category}</p></div>{canOperate && job.costing_status === 'open' && !cost.reverses_id && !cost.reversed_by_id ? <Button size="sm" variant="outline" disabled={busy || !correctionReason.trim()} onClick={() => mutate('reverse_service_job_direct_cost', { p_company_id: companyId, p_direct_cost_id: cost.id, p_reason: correctionReason }, tt('serviceJobs.costReversed', 'Direct cost reversed'))}>{tt('serviceJobs.reverse', 'Reverse')}</Button> : null}</div>) : <p className="p-4 text-sm text-muted-foreground">{tt('serviceJobs.noDirectCosts', 'No direct costs recorded.')}</p>}</div>
      </PremiumSection>

      <PremiumSection
        title={tt('serviceJobs.collectionRevenueShare', 'Collection revenue share')}
        description={tt('serviceJobs.collectionRevenueShareHelp', 'Optional: link an actual customer collection to a collaborator share. The full customer receipt stays intact; the share remains a separate job cost and cash/bank payout.')}
      >
        {canOperate && job.costing_status === 'open' ? receiptCandidates.length ? <div className="mb-3 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <label className="space-y-1 sm:col-span-2"><Label>{tt('serviceJobs.actualReceipt', 'Actual customer receipt')}</Label><Select value={shareReceiptKey} onValueChange={setShareReceiptKey}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{receiptCandidates.map(receipt => <SelectItem key={receiptCandidateKey(receipt)} value={receiptCandidateKey(receipt)}>{receipt.received_on} · {receipt.anchor_reference || receipt.anchor_type} · {money(receipt.receipt_amount_base)} · {receipt.receipt_channel}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.sharePercent', 'Share %')}</Label><Input type="number" min="0.01" max="100" step="0.01" value={sharePercent} onChange={event => setSharePercent(event.target.value)} /></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.calculatedShare', 'Calculated share')}</Label><Input value={money(calculatedShareAmount)} readOnly className="bg-muted/40" /></label>
          <label className="space-y-1 sm:col-span-2"><Label>{tt('serviceJobs.linkExistingCost', 'Link existing direct cost')}</Label><Select value={shareExistingCostId} onValueChange={setShareExistingCostId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__new__">{tt('serviceJobs.createNewShareCost', 'Create new subcontractor cost')}</SelectItem>{eligibleShareCosts.map(cost => <SelectItem key={cost.id} value={cost.id}>{cost.description} · {money(cost.base_amount)}</SelectItem>)}</SelectContent></Select></label>
          {shareExistingCostId === '__new__' ? <label className="space-y-1 sm:col-span-2"><Label>{tt('serviceJobs.shareDescription', 'Collaborator / cost description')}</Label><Input value={shareDescription} onChange={event => setShareDescription(event.target.value)} placeholder={tt('serviceJobs.shareDescriptionPlaceholder', 'e.g. Nordino revenue share')} /></label> : null}
          <label className="space-y-1 sm:col-span-2"><Label>{tt('serviceJobs.payoutTreatment', 'Payout treatment')}</Label><Select value={sharePayoutMode} onValueChange={value => setSharePayoutMode(value as 'cost_only' | 'cash' | 'bank')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cost_only">{tt('serviceJobs.recordCostOnly', 'Record cost only')}</SelectItem>{canManageSettlement ? <SelectItem value="cash">{tt('serviceJobs.payFromCash', 'Record cost and pay from cash')}</SelectItem> : null}{canManageSettlement ? <SelectItem value="bank">{tt('serviceJobs.payFromBank', 'Record cost and pay from bank')}</SelectItem> : null}</SelectContent></Select></label>
          {canManageSettlement && shareBanks.length ? <label className="space-y-1 sm:col-span-2"><Label>{tt('serviceJobs.payoutBank', 'Payout bank / wallet (for bank payments)')}</Label><Select value={sharePayoutBankId} onValueChange={setSharePayoutBankId}><SelectTrigger><SelectValue placeholder={tt('serviceJobs.choosePayoutBank', 'Choose bank or wallet')} /></SelectTrigger><SelectContent>{shareBanks.map(bank => <SelectItem key={bank.id} value={bank.id}>{bank.name}{bank.bank_name ? ` · ${bank.bank_name}` : ''}</SelectItem>)}</SelectContent></Select></label> : null}
          <div className="sm:col-span-2 rounded-lg bg-muted/35 p-3 text-xs text-muted-foreground">{tt('serviceJobs.shareAccountingHelp', 'The customer settlement is never netted. This action only records or links the collaborator share, and optionally posts its separate payout.')}</div>
          <Button className="sm:col-span-2" variant="outline" disabled={busy || !selectedReceipt || calculatedShareAmount <= 0 || (shareExistingCostId === '__new__' && !shareDescription.trim()) || (sharePayoutMode === 'bank' && !sharePayoutBankId)} onClick={() => void recordReceiptShare()}>{tt('serviceJobs.linkCollectionShare', 'Link collection share')}</Button>
        </div> : <PremiumStatePanel tone="neutral" title={tt('serviceJobs.noActualReceipts', 'No actual customer receipts yet')} description={tt('serviceJobs.noActualReceiptsHelp', 'Post an approved-order or issued-invoice customer settlement first. The receipt will then be available here for optional revenue-share linking.')} /> : null}
        <div className="divide-y rounded-xl border">{receiptShares.length ? receiptShares.map(share => {
          const receiptId = share.receipt_cash_transaction_id || share.receipt_bank_transaction_id || ''
          const receipt = receiptCandidates.find(candidate => candidate.receipt_channel === share.receipt_channel && candidate.receipt_transaction_id === receiptId)
          return <div key={share.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{share.description_snapshot} · {money(share.share_amount_base)}</p><p className="text-xs text-muted-foreground">{receipt?.anchor_reference || share.receipt_channel} · {Number(share.share_percent).toLocaleString(locale, { maximumFractionDigits: 2 })}% of {money(share.receipt_amount_base)} · {share.paid_at ? tt('serviceJobs.sharePaidStatus', 'Paid') : tt('serviceJobs.shareUnpaidStatus', 'Cost recorded, payout pending')}</p></div>{!share.paid_at && canManageSettlement ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void payReceiptShare(share, 'cash')}>{tt('serviceJobs.payFromCashShort', 'Pay cash')}</Button><Button size="sm" variant="outline" disabled={busy || !sharePayoutBankId} onClick={() => void payReceiptShare(share, 'bank')}>{tt('serviceJobs.payFromBankShort', 'Pay bank')}</Button></div> : null}</div>
        }) : <p className="p-4 text-sm text-muted-foreground">{tt('serviceJobs.noReceiptShares', 'No collection-share links recorded.')}</p>}</div>
      </PremiumSection>

      <PremiumSection title={tt('serviceJobs.supplierAllocations', 'Supplier allocations')} description={tt('serviceJobs.supplierAllocationHelp', 'Allocations assign existing approved Vendor Bill line cost; they do not create another payable.')}>
        {canOperate && job.costing_status === 'open' ? <div className="mb-3 grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
          <label className="space-y-1"><Label>{tt('serviceJobs.vendorBillLine', 'Vendor Bill line')}</Label><Select value={vendorLineId} onValueChange={value => { setVendorLineId(value); const line = vendorLines.find(row => row.id === value); if (line) setVendorAmount(String(line.line_total)) }}><SelectTrigger><SelectValue placeholder={tt('serviceJobs.chooseVendorLine', 'Choose approved posted line')} /></SelectTrigger><SelectContent>{vendorLines.map(line => <SelectItem key={line.id} value={line.id}>{line.reference} · {line.description}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1"><Label>{tt('serviceJobs.amount', 'Amount')}</Label><Input type="number" min="0.01" value={vendorAmount} onChange={event => setVendorAmount(event.target.value)} /></label>
          <Button className="sm:col-span-2" variant="outline" disabled={busy || !vendorLineId || Number(vendorAmount) <= 0} onClick={() => mutate('allocate_vendor_bill_line_to_service_job', { p_company_id: companyId, p_service_job_id: job.id, p_vendor_bill_line_id: vendorLineId, p_source_amount: Number(vendorAmount), p_cost_category: 'supplier', p_allocation_date: new Date().toISOString().slice(0, 10) }, tt('serviceJobs.vendorAllocated', 'Vendor Bill cost allocated'))}>{tt('serviceJobs.allocateVendorCost', 'Allocate supplier cost')}</Button>
        </div> : null}
        <div className="divide-y rounded-xl border">{allocations.length ? allocations.map(item => <div key={item.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-medium">{item.cost_category} · {money(item.base_amount)}</p><p className="text-xs text-muted-foreground">{item.reverses_id ? tt('serviceJobs.reversal', 'Reversal') : item.allocation_date}</p></div>{canOperate && job.costing_status === 'open' && !item.reverses_id && !item.reversed_by_id ? <Button size="sm" variant="outline" disabled={busy || !correctionReason.trim()} onClick={() => mutate('reverse_service_job_vendor_allocation', { p_company_id: companyId, p_allocation_id: item.id, p_reason: correctionReason }, tt('serviceJobs.allocationReversed', 'Supplier allocation reversed'))}>{tt('serviceJobs.reverse', 'Reverse')}</Button> : null}</div>) : <p className="p-4 text-sm text-muted-foreground">{tt('serviceJobs.noAllocations', 'No Vendor Bill cost allocated.')}</p>}</div>
      </PremiumSection>

      <PremiumSection title={tt('serviceJobs.costSummary', 'Actual cost summary')}>
        {summary ? <Card><CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
          <Cost label={tt('serviceJobs.materialCost', 'Materials')} value={money(summary.materials)} />
          <Cost label={tt('serviceJobs.labour', 'Labour')} value={money(summary.labour)} />
          <Cost label={tt('serviceJobs.subcontractors', 'Subcontractors')} value={money(summary.subcontractors)} />
          <Cost label={tt('serviceJobs.suppliers', 'Suppliers')} value={money(summary.suppliers)} />
          <Cost label={tt('serviceJobs.otherDirectCosts', 'Other direct costs')} value={money(summary.otherDirectCosts)} />
          <Cost label={tt('serviceJobs.totalActualCost', 'Total actual cost')} value={money(summary.totalActualCost)} strong />
        </CardContent></Card> : <PremiumStatePanel tone="neutral" title={tt('serviceJobs.costUnavailable', 'Actual cost is not available')} description={tt('serviceJobs.costUnavailableHelp', 'No missing cost evidence is presented as zero.')} />}
        {canAdmin && summary && job.execution_status === 'completed' && job.costing_status === 'open' ? <Button className="mt-3 w-full sm:w-auto" disabled={busy || (summary.totalActualCost === 0 && !reason.trim())} onClick={() => mutate('finalise_service_job_costing', { p_company_id: companyId, p_service_job_id: job.id, p_posting_request_key: requestKey('service-cost'), p_confirm_zero: summary.totalActualCost === 0, p_zero_cost_reason: summary.totalActualCost === 0 ? reason : null }, tt('serviceJobs.costingFinalised', 'Actual costing finalised'))}>{tt('serviceJobs.finaliseCosting', 'Finalise costing')}</Button> : null}
        {canAdmin && job.costing_status === 'finalised' ? <Button className="mt-3" variant="outline" disabled={busy || !reason.trim()} onClick={() => mutate('reopen_service_job_costing', { p_company_id: companyId, p_service_job_id: job.id, p_current_fingerprint: job.cost_fingerprint, p_reason: reason }, tt('serviceJobs.costingReopened', 'Costing reopened'))}>{tt('serviceJobs.reopenCosting', 'Reopen costing')}</Button> : null}
      </PremiumSection>
      <PremiumSection title={tt('serviceJobs.timeline', 'Audit timeline')}>
        <EvidenceList empty={tt('serviceJobs.noEvents', 'No events.')} rows={events.map(event => ({ id: event.id, title: eventLabel(event.event_type, tt), detail: `${new Date(event.occurred_at).toLocaleString()}${event.reason ? ` · ${event.reason}` : ''}` }))} />
      </PremiumSection>
      </>}
    </SheetBody>
  </>
}

function EvidenceList({ rows, empty }: { rows: { id: string; title: string; detail: string }[]; empty: string }) {
  return rows.length ? <div className="divide-y rounded-xl border">{rows.map(row => <div key={row.id} className="p-3"><p className="font-medium">{row.title}</p><p className="text-xs text-muted-foreground">{row.detail}</p></div>)}</div>
    : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>
}
function Cost({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={strong ? 'font-bold tabular-nums' : 'font-semibold tabular-nums'}>{value}</p></div>
}
function statusLabel(status: Job['execution_status'], tt: (key: string, fallback: string) => string) {
  return ({ planned: tt('serviceJobs.status.planned', 'Planned'), in_progress: tt('serviceJobs.status.inProgress', 'In progress'), completed: tt('serviceJobs.status.completed', 'Completed'), cancelled: tt('serviceJobs.status.cancelled', 'Cancelled') })[status]
}
function billingLabel(value: JobLine['billing_basis'], tt: (key: string, fallback: string) => string) {
  return ({ per_job: tt('serviceJobs.billing.perJob', 'Per job'), per_hour: tt('serviceJobs.billing.perHour', 'Per hour'), fixed_fee: tt('serviceJobs.billing.fixedFee', 'Fixed fee') })[value]
}
function eventLabel(value: string, tt: (key: string, fallback: string) => string) {
  return tt(`serviceJobs.event.${value}`, value.replaceAll('_', ' '))
}
