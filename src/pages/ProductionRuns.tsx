import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Factory,
  FileClock,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useOrg } from '../hooks/useOrg'
import { useIsMobile } from '../hooks/use-mobile'
import { hasRole } from '../lib/roles'
import {
  clearPostingRequestKey,
  getPostingRequestKeyForFingerprint,
  stablePostingFingerprint,
  type PostingRequestKeyRef,
} from '../lib/postingRequestKeys'
import { cn } from '../lib/utils'
import {
  PremiumDataTable,
  type PremiumDataTableColumn,
  type PremiumDataTableSortState,
} from '../components/premium/PremiumDataTable'
import { PremiumEmptyState } from '../components/premium/PremiumEmptyState'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumMobileCardList } from '../components/premium/PremiumMobileCardList'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'

type BomRow = {
  id: string
  name: string
  version: string | null
  product_id: string
  is_active: boolean | null
}

type ItemRow = {
  id: string
  name: string
  sku: string | null
  base_uom_id: string | null
  unit_price: number | null
}

type WarehouseRow = {
  id: string
  code: string | null
  name: string
}

type BinRow = {
  id: string
  code: string
  name: string
  warehouseId: string
}

type ProductionRunRow = {
  id: string
  company_id: string
  reference_no: string
  bom_id: string
  bom_name_snapshot: string | null
  bom_version_snapshot: string | null
  finished_item_id: string
  output_uom_id: string
  planned_output_qty: number
  actual_output_qty: number | null
  run_date: string
  destination_warehouse_id: string | null
  destination_bin_id: string | null
  status: 'draft' | 'posted' | 'reversed' | 'cancelled'
  notes: string | null
  base_currency_code: string
  material_cost_total: number
  extra_cost_total: number
  total_cost: number
  output_unit_cost: number
  output_receipt_movement_id: string | null
  reversal_output_issue_movement_id: string | null
  posted_at: string | null
  reversed_at: string | null
  reversal_reason: string | null
}

type ProductionRunInput = {
  id: string
  line_no: number
  item_id: string
  uom_id: string
  planned_qty: number
  actual_qty: number | null
  source_warehouse_id: string | null
  source_bin_id: string | null
  frozen_unit_cost: number | null
  frozen_total_cost: number | null
  issue_movement_id: string | null
  reversal_receipt_movement_id: string | null
}

type ProductionRunOutput = {
  id: string
  line_no: number
  item_id: string
  uom_id: string
  actual_qty: number | null
  destination_warehouse_id: string | null
  destination_bin_id: string | null
  frozen_unit_cost: number | null
  frozen_total_cost: number | null
  receipt_movement_id: string | null
  reversal_issue_movement_id: string | null
}

type ExtraCostLine = {
  id?: string
  line_no: number
  category: 'labour' | 'utilities' | 'overhead' | 'transport' | 'other'
  description: string
  amount_base: number
}

type PreviewInput = {
  id: string
  line_no: number
  item_id: string
  item_name?: string
  uom_id: string
  planned_qty: number
  actual_qty: number
  source_warehouse_id: string | null
  source_bin_id: string | null
  source_label?: string
  available_qty: number
  shortage_qty: number
  preview_unit_cost: number
  preview_total_cost: number
  ready: boolean
}

type PreviewPayload = {
  ready: boolean
  blocking_reasons?: string[]
  inputs?: PreviewInput[]
  estimated_material_cost?: number
  extra_cost_total?: number
  estimated_total_cost?: number
  estimated_unit_cost?: number
  yield_variance_qty?: number
  advisory_minutes?: number | null
}

const statusTone: Record<ProductionRunRow['status'], PremiumTone> = {
  draft: 'info',
  posted: 'positive',
  reversed: 'warning',
  cancelled: 'neutral',
}

const extraCategories: ExtraCostLine['category'][] = ['labour', 'utilities', 'overhead', 'transport', 'other']

const today = () => new Date().toISOString().slice(0, 10)
const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const money = (value: unknown, currency = 'MZN') =>
  `${currency} ${num(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const qty = (value: unknown) =>
  num(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
const compactDate = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : 'Not posted')

function statusLabel(status: ProductionRunRow['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function normalizeRows<T extends { line_no: number }>(rows: T[]) {
  return [...rows].sort((left, right) => left.line_no - right.line_no)
}

function productionRunDraftFingerprint(
  companyId: string,
  runId: string,
  fields: {
    plannedOutputQty: string
    actualOutputQty: string
    runDate: string
    destinationWarehouseId: string
    destinationBinId: string
    notes: string
  },
  inputs: ProductionRunInput[],
  extraCosts: ExtraCostLine[],
) {
  return stablePostingFingerprint({
    operation: 'production.run.preview',
    companyId,
    runId,
    fields,
    inputs: inputs.map(({ line_no, actual_qty, source_warehouse_id, source_bin_id }) => ({
      line_no,
      actual_qty: num(actual_qty),
      source_warehouse_id,
      source_bin_id,
    })),
    extraCosts: extraCosts.map(({ line_no, category, description, amount_base }) => ({
      line_no,
      category,
      description,
      amount_base: num(amount_base),
    })),
  })
}

export default function ProductionRuns() {
  const { companyId, myRole } = useOrg()
  const isMobile = useIsMobile()
  const [searchParams] = useSearchParams()
  const initialBomId = searchParams.get('bomId') || ''
  const canReverse = hasRole(myRole, ['MANAGER', 'ADMIN', 'OWNER'])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [runs, setRuns] = useState<ProductionRunRow[]>([])
  const [boms, setBoms] = useState<BomRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [bins, setBins] = useState<BinRow[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [selectedRun, setSelectedRun] = useState<ProductionRunRow | null>(null)
  const [inputs, setInputs] = useState<ProductionRunInput[]>([])
  const [outputs, setOutputs] = useState<ProductionRunOutput[]>([])
  const [extraCosts, setExtraCosts] = useState<ExtraCostLine[]>([])
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [previewFingerprint, setPreviewFingerprint] = useState('')
  const [newBomId, setNewBomId] = useState(initialBomId)
  const [newPlannedQty, setNewPlannedQty] = useState('1')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProductionRunRow['status']>('all')
  const [itemFilter, setItemFilter] = useState('all')
  const [bomFilter, setBomFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState<PremiumDataTableSortState>({ columnId: 'runDate', direction: 'desc' })
  const [draftFields, setDraftFields] = useState({
    plannedOutputQty: '1',
    actualOutputQty: '1',
    runDate: today(),
    destinationWarehouseId: '',
    destinationBinId: '',
    notes: '',
  })
  const [reverseReason, setReverseReason] = useState('')
  const [reverseConfirm, setReverseConfirm] = useState('')
  const postRequestRef = useRef<PostingRequestKeyRef>(null)
  const reverseRequestRef = useRef<PostingRequestKeyRef>(null)

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const bomById = useMemo(() => new Map(boms.map((bom) => [bom.id, bom])), [boms])
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses])
  const binById = useMemo(() => new Map(bins.map((bin) => [bin.id, bin])), [bins])

  const filteredRuns = useMemo(() => {
    const term = query.trim().toLowerCase()
    return runs.filter((run) => {
      const item = itemById.get(run.finished_item_id)
      const bom = bomById.get(run.bom_id)
      const text = `${run.reference_no} ${item?.name || ''} ${bom?.name || run.bom_name_snapshot || ''}`.toLowerCase()
      if (term && !text.includes(term)) return false
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      if (itemFilter !== 'all' && run.finished_item_id !== itemFilter) return false
      if (bomFilter !== 'all' && run.bom_id !== bomFilter) return false
      if (dateFrom && run.run_date < dateFrom) return false
      if (dateTo && run.run_date > dateTo) return false
      return true
    })
  }, [bomById, bomFilter, dateFrom, dateTo, itemById, itemFilter, query, runs, statusFilter])

  const selectedCurrency = selectedRun?.base_currency_code || 'MZN'
  const draftFingerprint = useMemo(
    () =>
      companyId && selectedRun
        ? productionRunDraftFingerprint(companyId, selectedRun.id, draftFields, inputs, extraCosts)
        : '',
    [companyId, draftFields, extraCosts, inputs, selectedRun],
  )
  const previewMatchesDraft = Boolean(preview && draftFingerprint && previewFingerprint === draftFingerprint)
  const activePreview = previewMatchesDraft ? preview : null
  const reverseConfirmMatches = Boolean(selectedRun && reverseConfirm.trim() === selectedRun.reference_no)

  const clearPostKeys = useCallback(() => {
    clearPostingRequestKey(postRequestRef)
    clearPostingRequestKey(reverseRequestRef)
  }, [])

  const invalidateDraftPreview = useCallback(() => {
    clearPostKeys()
    setPreview(null)
    setPreviewFingerprint('')
  }, [clearPostKeys])

  const loadMasterData = useCallback(async () => {
    if (!companyId) return
    const [bomRes, itemRes, whRes, binRes] = await Promise.all([
      supabase.from('boms').select('id,name,version,product_id,is_active').eq('company_id', companyId).order('name'),
      supabase.from('items').select('id,name,sku,base_uom_id,unit_price').eq('company_id', companyId).order('name'),
      supabase.from('warehouses').select('id,code,name').eq('company_id', companyId).order('name'),
      supabase.from('bins').select('id,code,name,warehouseId').eq('company_id', companyId).order('code'),
    ])
    if (bomRes.error) throw bomRes.error
    if (itemRes.error) throw itemRes.error
    if (whRes.error) throw whRes.error
    if (binRes.error) throw binRes.error
    setBoms((bomRes.data || []) as BomRow[])
    setItems((itemRes.data || []) as ItemRow[])
    setWarehouses((whRes.data || []) as WarehouseRow[])
    setBins((binRes.data || []) as BinRow[])
  }, [companyId])

  const loadRuns = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('production_runs')
      .select('*')
      .eq('company_id', companyId)
      .order('run_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const rows = (data || []) as ProductionRunRow[]
    setRuns(rows)
    if (!selectedRunId && rows.length > 0) setSelectedRunId(rows[0].id)
  }, [companyId, selectedRunId])

  const loadRunDetail = useCallback(async (runId: string) => {
    if (!companyId || !runId) {
      setSelectedRun(null)
      setInputs([])
      setOutputs([])
      setExtraCosts([])
      setPreview(null)
      setPreviewFingerprint('')
      return
    }
    const [runRes, inputRes, outputRes, extraRes] = await Promise.all([
      supabase.from('production_runs').select('*').eq('company_id', companyId).eq('id', runId).single(),
      supabase.from('production_run_inputs').select('*').eq('company_id', companyId).eq('production_run_id', runId).order('line_no'),
      supabase.from('production_run_outputs').select('*').eq('company_id', companyId).eq('production_run_id', runId).order('line_no'),
      supabase.from('production_run_extra_costs').select('*').eq('company_id', companyId).eq('production_run_id', runId).order('line_no'),
    ])
    if (runRes.error) throw runRes.error
    if (inputRes.error) throw inputRes.error
    if (outputRes.error) throw outputRes.error
    if (extraRes.error) throw extraRes.error

    const run = runRes.data as ProductionRunRow
    const runInputs = normalizeRows((inputRes.data || []) as ProductionRunInput[])
    const runOutputs = normalizeRows((outputRes.data || []) as ProductionRunOutput[])
    const runExtras = normalizeRows((extraRes.data || []) as ExtraCostLine[])
    setSelectedRun(run)
    setInputs(runInputs)
    setOutputs(runOutputs)
    setExtraCosts(runExtras)
    const loadedDraftFields = {
      plannedOutputQty: String(run.planned_output_qty || 1),
      actualOutputQty: String(run.actual_output_qty || run.planned_output_qty || 1),
      runDate: run.run_date || today(),
      destinationWarehouseId: run.destination_warehouse_id || '',
      destinationBinId: run.destination_bin_id || '',
      notes: run.notes || '',
    }
    setDraftFields(loadedDraftFields)
    setReverseReason('')
    setReverseConfirm('')
    clearPostKeys()
    if (run.status === 'draft' || run.status === 'posted' || run.status === 'reversed') {
      const previewRes = await supabase.rpc('preview_production_run', {
        p_company_id: companyId,
        p_run_id: runId,
      })
      if (!previewRes.error) {
        setPreview(previewRes.data as PreviewPayload)
        setPreviewFingerprint(productionRunDraftFingerprint(companyId, run.id, loadedDraftFields, runInputs, runExtras))
      } else {
        setPreview(null)
        setPreviewFingerprint('')
      }
    }
  }, [clearPostKeys, companyId])

  const refreshAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      await loadMasterData()
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error('Failed to load production runs')
    } finally {
      setLoading(false)
    }
  }, [companyId, loadMasterData, loadRuns])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    void loadRunDetail(selectedRunId).catch((error) => {
      console.error(error)
      toast.error('Failed to load production run detail')
    })
  }, [loadRunDetail, selectedRunId])

  function mutateDraftFields(next: Partial<typeof draftFields>) {
    invalidateDraftPreview()
    setDraftFields((current) => ({ ...current, ...next }))
  }

  function updateInput(id: string, patch: Partial<ProductionRunInput>) {
    invalidateDraftPreview()
    setInputs((current) => current.map((input) => (input.id === id ? { ...input, ...patch } : input)))
  }

  function updateExtraCost(index: number, patch: Partial<ExtraCostLine>) {
    invalidateDraftPreview()
    setExtraCosts((current) => current.map((line, idx) => (idx === index ? { ...line, ...patch } : line)))
  }

  function addExtraCost() {
    invalidateDraftPreview()
    setExtraCosts((current) => [...current, { line_no: current.length + 1, category: 'labour', description: '', amount_base: 0 }])
  }

  async function createDraft() {
    if (!companyId) return toast.error('Select an active company first')
    if (!newBomId) return toast.error('Select a recipe')
    const plannedQty = num(newPlannedQty)
    if (plannedQty <= 0) return toast.error('Planned output must be greater than zero')
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('create_production_run_draft', {
        p_company_id: companyId,
        p_bom_id: newBomId,
        p_planned_output_qty: plannedQty,
        p_run_date: today(),
        p_notes: null,
      })
      if (error) throw error
      const runId = (data as any)?.run_id
      toast.success('Production run draft created')
      await loadRuns()
      if (runId) setSelectedRunId(runId)
    } catch (error) {
      console.error(error)
      toast.error('Failed to create production run draft')
    } finally {
      setSaving(false)
    }
  }

  async function saveDraft(options?: { quiet?: boolean }) {
    if (!companyId || !selectedRun) return null
    if (selectedRun.status !== 'draft') return selectedRun
    setSaving(true)
    try {
      const payloadInputs = inputs.map((input) => ({
        line_no: input.line_no,
        actual_qty: num(input.actual_qty),
        source_warehouse_id: input.source_warehouse_id || null,
        source_bin_id: input.source_bin_id || null,
      }))
      const payloadExtras = extraCosts
        .filter((line) => num(line.amount_base) > 0 || line.description.trim())
        .map((line) => ({
          category: line.category,
          description: line.description.trim() || null,
          amount_base: num(line.amount_base),
        }))
      const { error } = await supabase.rpc('update_production_run_draft', {
        p_company_id: companyId,
        p_run_id: selectedRun.id,
        p_planned_output_qty: num(draftFields.plannedOutputQty),
        p_actual_output_qty: num(draftFields.actualOutputQty),
        p_run_date: draftFields.runDate || today(),
        p_destination_warehouse_id: draftFields.destinationWarehouseId || null,
        p_destination_bin_id: draftFields.destinationBinId || null,
        p_notes: draftFields.notes.trim() || null,
        p_inputs: payloadInputs,
        p_extra_costs: payloadExtras,
      })
      if (error) throw error
      if (!options?.quiet) toast.success('Draft saved')
      await loadRunDetail(selectedRun.id)
      await loadRuns()
      return selectedRun
    } catch (error) {
      console.error(error)
      toast.error('Failed to save production run draft')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function refreshPreview() {
    if (!companyId || !selectedRun) return
    if (selectedRun.status === 'draft') {
      const saved = await saveDraft({ quiet: true })
      if (!saved) return
      toast.success('Preview refreshed')
      return
    }
    const { data, error } = await supabase.rpc('preview_production_run', {
      p_company_id: companyId,
      p_run_id: selectedRun.id,
    })
    if (error) {
      console.error(error)
      toast.error('Failed to refresh preview')
      return
    }
    setPreview(data as PreviewPayload)
    setPreviewFingerprint(draftFingerprint)
    toast.success('Preview refreshed')
  }

  async function postRun() {
    if (!companyId || !selectedRun) return
    if (!activePreview?.ready) return toast.error('Refresh the readiness preview before posting')
    const saved = await saveDraft({ quiet: true })
    if (!saved) return
    const fingerprint = stablePostingFingerprint({
      operation: 'production.run.post',
      companyId,
      runId: selectedRun.id,
      fields: draftFields,
      inputs: inputs.map(({ line_no, actual_qty, source_warehouse_id, source_bin_id }) => ({
        line_no,
        actual_qty: num(actual_qty),
        source_warehouse_id,
        source_bin_id,
      })),
      extraCosts: extraCosts.map(({ category, description, amount_base }) => ({ category, description, amount_base })),
    })
    const requestKey = getPostingRequestKeyForFingerprint(postRequestRef, fingerprint)
    setSaving(true)
    try {
      const { error } = await supabase.rpc('post_production_run', {
        p_company_id: companyId,
        p_run_id: selectedRun.id,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(postRequestRef)
      toast.success('Production run posted')
      await loadRunDetail(selectedRun.id)
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error('Failed to post production run')
    } finally {
      setSaving(false)
    }
  }

  async function reverseRun() {
    if (!companyId || !selectedRun) return
    const reason = reverseReason.trim()
    if (!reason) return toast.error('Enter a reversal reason')
    if (!reverseConfirmMatches) return toast.error('Type the production run reference to confirm reversal')
    const fingerprint = stablePostingFingerprint({
      operation: 'production.run.reverse',
      companyId,
      runId: selectedRun.id,
      reason,
    })
    const requestKey = getPostingRequestKeyForFingerprint(reverseRequestRef, fingerprint)
    setSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_production_run', {
        p_company_id: companyId,
        p_run_id: selectedRun.id,
        p_reason: reason,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(reverseRequestRef)
      setReverseConfirm('')
      toast.success('Production run reversed')
      await loadRunDetail(selectedRun.id)
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error('Failed to reverse production run')
    } finally {
      setSaving(false)
    }
  }

  async function cancelDraft() {
    if (!companyId || !selectedRun) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('cancel_production_run_draft', {
        p_company_id: companyId,
        p_run_id: selectedRun.id,
      })
      if (error) throw error
      toast.success('Draft cancelled')
      await loadRunDetail(selectedRun.id)
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error('Failed to cancel draft')
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<PremiumDataTableColumn<ProductionRunRow>[]>(() => [
    {
      id: 'reference',
      header: 'Run',
      cell: (run) => (
        <button
          type="button"
          onClick={() => setSelectedRunId(run.id)}
          className="text-left font-semibold text-primary hover:underline"
        >
          {run.reference_no}
        </button>
      ),
      sortValue: (run) => run.reference_no,
      minWidth: 150,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (run) => <PremiumStatusBadge tone={statusTone[run.status]}>{statusLabel(run.status)}</PremiumStatusBadge>,
      sortValue: (run) => run.status,
      minWidth: 110,
    },
    {
      id: 'recipe',
      header: 'Recipe',
      cell: (run) => bomById.get(run.bom_id)?.name || run.bom_name_snapshot || 'Recipe',
      sortValue: (run) => bomById.get(run.bom_id)?.name || run.bom_name_snapshot || '',
      minWidth: 180,
    },
    {
      id: 'output',
      header: 'Output',
      cell: (run) => (
        <span>
          {itemById.get(run.finished_item_id)?.name || 'Finished item'}
          <span className="block text-xs text-muted-foreground">
            {qty(run.actual_output_qty || run.planned_output_qty)} produced / {qty(run.planned_output_qty)} planned
          </span>
        </span>
      ),
      sortValue: (run) => itemById.get(run.finished_item_id)?.name || '',
      minWidth: 220,
    },
    {
      id: 'cost',
      header: 'Cost',
      cell: (run) => (
        <span className="font-medium">
          {money(run.total_cost, run.base_currency_code)}
          <span className="block text-xs text-muted-foreground">
            {money(run.output_unit_cost, run.base_currency_code)} / unit
          </span>
        </span>
      ),
      sortValue: (run) => run.total_cost,
      align: 'right',
      minWidth: 150,
    },
    {
      id: 'runDate',
      header: 'Date',
      cell: (run) => compactDate(run.run_date),
      sortValue: (run) => run.run_date,
      minWidth: 120,
    },
  ], [bomById, itemById])

  const displayedRuns = filteredRuns
  const selectedItem = selectedRun ? itemById.get(selectedRun.finished_item_id) : null
  const draftBins = (warehouseId: string) => bins.filter((bin) => bin.warehouseId === warehouseId)

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PremiumRegisterHeader
        eyebrow="Operations"
        title="Production Runs"
        description="Plan actual production, freeze material and direct-cost snapshots, and post controlled reversals with audit-linked stock movements."
        badges={
          <>
            <PremiumStatusBadge tone="positive">Append-only ledger</PremiumStatusBadge>
            <PremiumStatusBadge tone="info">Frozen cost snapshots</PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/bom">Recipes & Assemblies</Link>
            </Button>
            <Button onClick={refreshAll} disabled={loading} variant="outline">
              <RefreshCw />
              Refresh
            </Button>
          </>
        }
        metrics={
          <>
            <PremiumMetricCard label="Drafts" value={runs.filter((run) => run.status === 'draft').length} icon={<FileClock />} tone="info" />
            <PremiumMetricCard label="Posted" value={runs.filter((run) => run.status === 'posted').length} icon={<PackageCheck />} tone="positive" />
            <PremiumMetricCard label="Reversed" value={runs.filter((run) => run.status === 'reversed').length} icon={<RotateCcw />} tone="warning" />
            <PremiumMetricCard label="Total value" value={money(runs.reduce((sum, run) => sum + num(run.total_cost), 0), selectedCurrency)} icon={<Factory />} tone="neutral" />
          </>
        }
      />

      <section className="grid gap-4 rounded-[calc(var(--radius)+0.35rem)] border border-card-border bg-surface-elevated p-4 md:grid-cols-[minmax(0,1fr)_11rem_9rem]">
        <div className="grid gap-2">
          <Label htmlFor="new-production-bom">Recipe</Label>
          <select
            id="new-production-bom"
            value={newBomId}
            onChange={(event) => setNewBomId(event.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">Select a recipe</option>
            {boms.filter((bom) => bom.is_active !== false).map((bom) => (
              <option key={bom.id} value={bom.id}>
                {bom.name}{bom.version ? ` v${bom.version}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-production-qty">Planned output</Label>
          <Input id="new-production-qty" type="number" min="0" step="0.0001" value={newPlannedQty} onChange={(event) => setNewPlannedQty(event.target.value)} />
        </div>
        <div className="flex items-end">
          <Button onClick={createDraft} disabled={saving || !companyId} className="w-full">
            <Plus />
            New run
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <section className="space-y-4">
          <div className="grid gap-3 rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card p-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="relative md:col-span-2 xl:col-span-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs, recipes or items" className="pl-9" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as any)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="reversed">Reversed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="all">All finished items</option>
              {Array.from(new Set(runs.map((run) => run.finished_item_id))).map((itemId) => (
                <option key={itemId} value={itemId}>{itemById.get(itemId)?.name || itemId}</option>
              ))}
            </select>
            <select value={bomFilter} onChange={(event) => setBomFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="all">All recipes</option>
              {Array.from(new Set(runs.map((run) => run.bom_id))).map((bomId) => (
                <option key={bomId} value={bomId}>{bomById.get(bomId)?.name || bomId}</option>
              ))}
            </select>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Run date from" />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Run date to" />
          </div>

          {isMobile ? (
            <PremiumMobileCardList
              rows={displayedRuns}
              getRowId={(run) => run.id}
              loading={loading}
              emptyState={<PremiumEmptyState icon={<Factory />} title="No production runs found" compact />}
              renderCard={(run) => (
                <button
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={cn(
                    'w-full rounded-[calc(var(--radius)+0.2rem)] border bg-card p-4 text-left shadow-[0_16px_34px_-30px_hsl(var(--foreground)/0.35)]',
                    selectedRunId === run.id ? 'border-primary/50' : 'border-card-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{run.reference_no}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{itemById.get(run.finished_item_id)?.name || 'Finished item'}</div>
                    </div>
                    <PremiumStatusBadge tone={statusTone[run.status]}>{statusLabel(run.status)}</PremiumStatusBadge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <span>{qty(run.actual_output_qty || run.planned_output_qty)} output</span>
                    <span className="text-right">{money(run.total_cost, run.base_currency_code)}</span>
                  </div>
                </button>
              )}
            />
          ) : (
            <PremiumDataTable
              rows={displayedRuns}
              columns={columns}
              getRowId={(run) => run.id}
              loading={loading}
              emptyState={<PremiumEmptyState icon={<Factory />} title="No production runs found" compact />}
              sort={sort}
              onSortChange={setSort}
              ariaLabel="Production runs"
            />
          )}
        </section>

        <section className="rounded-[calc(var(--radius)+0.35rem)] border border-card-border bg-card p-4 shadow-[0_20px_44px_-36px_hsl(var(--foreground)/0.36)]">
          {!selectedRun ? (
            <PremiumEmptyState icon={<Factory />} title="Select or create a production run" compact />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{selectedRun.reference_no}</h2>
                    <PremiumStatusBadge tone={statusTone[selectedRun.status]}>{statusLabel(selectedRun.status)}</PremiumStatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {bomById.get(selectedRun.bom_id)?.name || selectedRun.bom_name_snapshot || 'Recipe'}{' -> '}{selectedItem?.name || 'Finished item'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedRun.status === 'draft' ? (
                    <>
                      <Button variant="outline" onClick={() => void saveDraft()} disabled={saving}>
                        <Save />
                        Save
                      </Button>
                      <Button variant="outline" onClick={refreshPreview} disabled={saving}>
                        <RefreshCw />
                        Preview
                      </Button>
                      <Button onClick={postRun} disabled={saving || !activePreview?.ready}>
                        <CheckCircle2 />
                        Post run
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {selectedRun.status === 'draft' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Planned output</Label>
                    <Input type="number" min="0" step="0.0001" value={draftFields.plannedOutputQty} onChange={(event) => mutateDraftFields({ plannedOutputQty: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Actual output</Label>
                    <Input type="number" min="0" step="0.0001" value={draftFields.actualOutputQty} onChange={(event) => mutateDraftFields({ actualOutputQty: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Run date</Label>
                    <Input type="date" value={draftFields.runDate} onChange={(event) => mutateDraftFields({ runDate: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Destination warehouse</Label>
                    <select
                      value={draftFields.destinationWarehouseId}
                      onChange={(event) => mutateDraftFields({ destinationWarehouseId: event.target.value, destinationBinId: '' })}
                      className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select warehouse</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label>Destination bin</Label>
                    <select
                      value={draftFields.destinationBinId}
                      onChange={(event) => mutateDraftFields({ destinationBinId: event.target.value })}
                      className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select bin</option>
                      {draftBins(draftFields.destinationWarehouseId).map((bin) => (
                        <option key={bin.id} value={bin.id}>{bin.code} - {bin.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label>Notes</Label>
                    <Input value={draftFields.notes} onChange={(event) => mutateDraftFields({ notes: event.target.value })} placeholder="Optional production notes" />
                  </div>
                  <p className="text-sm text-muted-foreground md:col-span-2">
                    Quantities are recorded in each item&apos;s base unit.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <PremiumMetricCard label="Actual output" value={qty(selectedRun.actual_output_qty)} description={selectedItem?.name} />
                  <PremiumMetricCard label="Total cost" value={money(selectedRun.total_cost, selectedCurrency)} description="Frozen at posting" />
                  <PremiumMetricCard label="Unit cost" value={money(selectedRun.output_unit_cost, selectedCurrency)} description="Total cost / output" />
                </div>
              )}

              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Inputs</h3>
                  {activePreview?.ready ? <PremiumStatusBadge tone="positive">Ready</PremiumStatusBadge> : <PremiumStatusBadge tone="warning">Needs review</PremiumStatusBadge>}
                </div>
                <div className="space-y-3">
                  {inputs.map((input) => {
                    const previewInput = activePreview?.inputs?.find((row) => row.id === input.id)
                    return (
                      <div key={input.id} className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-muted/50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-medium">{itemById.get(input.item_id)?.name || input.item_id}</div>
                            <div className="text-xs text-muted-foreground">
                              Planned {qty(input.planned_qty)} {input.uom_id}
                              {previewInput ? ` | Available ${qty(previewInput.available_qty)} | Short ${qty(previewInput.shortage_qty)}` : ''}
                            </div>
                          </div>
                          {previewInput?.ready ? <PremiumStatusBadge tone="positive">Sufficient</PremiumStatusBadge> : <PremiumStatusBadge tone="warning">Check source</PremiumStatusBadge>}
                        </div>
                        {selectedRun.status === 'draft' ? (
                          <div className="mt-3 grid gap-3 md:grid-cols-[8rem_1fr_1fr]">
                            <Input type="number" min="0" step="0.0001" value={input.actual_qty ?? ''} onChange={(event) => updateInput(input.id, { actual_qty: num(event.target.value) })} aria-label="Actual input quantity" />
                            <select
                              value={input.source_warehouse_id || ''}
                              onChange={(event) => updateInput(input.id, { source_warehouse_id: event.target.value || null, source_bin_id: null })}
                              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                            >
                              <option value="">Source warehouse</option>
                              {warehouses.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                              ))}
                            </select>
                            <select
                              value={input.source_bin_id || ''}
                              onChange={(event) => updateInput(input.id, { source_bin_id: event.target.value || null })}
                              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                            >
                              <option value="">Source bin</option>
                              {draftBins(input.source_warehouse_id || '').map((bin) => (
                                <option key={bin.id} value={bin.id}>{bin.code} - {bin.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                            <span>Actual {qty(input.actual_qty)} {input.uom_id}</span>
                            <span>Unit cost {money(input.frozen_unit_cost, selectedCurrency)}</span>
                            <span>Movement {input.issue_movement_id ? input.issue_movement_id.slice(0, 8) : 'Not linked'}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Additional direct costs</h3>
                  {selectedRun.status === 'draft' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addExtraCost}
                    >
                      <Plus />
                      Add cost
                    </Button>
                  ) : null}
                </div>
                {extraCosts.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-card-border p-3 text-sm text-muted-foreground">No additional direct costs recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {extraCosts.map((line, index) => (
                      <div key={line.id || index} className="grid gap-2 rounded-xl border border-card-border p-3 md:grid-cols-[10rem_1fr_9rem]">
                        {selectedRun.status === 'draft' ? (
                          <>
                            <select value={line.category} onChange={(event) => updateExtraCost(index, { category: event.target.value as ExtraCostLine['category'] })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
                              {extraCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                            <Input value={line.description} onChange={(event) => updateExtraCost(index, { description: event.target.value })} placeholder="Description" />
                            <Input type="number" min="0" step="0.01" value={line.amount_base} onChange={(event) => updateExtraCost(index, { amount_base: num(event.target.value) })} />
                          </>
                        ) : (
                          <>
                            <span className="font-medium capitalize">{line.category}</span>
                            <span className="text-sm text-muted-foreground">{line.description || '-'}</span>
                            <span className="text-right font-medium">{money(line.amount_base, selectedCurrency)}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 rounded-[calc(var(--radius)+0.2rem)] border border-card-border bg-surface-muted/60 p-4 md:grid-cols-4">
                <PremiumMetricCard label="Material estimate" value={money(activePreview?.estimated_material_cost ?? selectedRun.material_cost_total, selectedCurrency)} variant="panel" />
                <PremiumMetricCard label="Direct costs" value={money(activePreview?.extra_cost_total ?? selectedRun.extra_cost_total, selectedCurrency)} variant="panel" />
                <PremiumMetricCard label="Total cost" value={money(activePreview?.estimated_total_cost ?? selectedRun.total_cost, selectedCurrency)} variant="panel" />
                <PremiumMetricCard label="Unit cost" value={money(activePreview?.estimated_unit_cost ?? selectedRun.output_unit_cost, selectedCurrency)} variant="panel" />
              </div>

              {selectedRun.status === 'draft' && !activePreview ? (
                <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-300/30 dark:bg-sky-300/10 dark:text-sky-100">
                  Refresh the readiness preview after draft changes before posting.
                </div>
              ) : null}

              {activePreview && !activePreview.ready ? (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Review source buckets, quantities, and destination before posting.</span>
                  </div>
                </div>
              ) : null}

              {selectedRun.status === 'draft' ? (
                <div className="flex flex-wrap justify-between gap-2 border-t border-card-border pt-4">
                  <Button variant="outline" onClick={cancelDraft} disabled={saving}>Cancel draft</Button>
                  <Button onClick={postRun} disabled={saving || !activePreview?.ready}>
                    <CheckCircle2 />
                    Post Production Run
                  </Button>
                </div>
              ) : null}

              {selectedRun.status === 'posted' ? (
                <div className="rounded-xl border border-card-border p-4">
                  <div className="mb-3">
                    <h3 className="font-semibold">Controlled reversal</h3>
                    <p className="text-sm text-muted-foreground">
                      Reversal creates compensating stock movements and keeps the original run and movements unchanged.
                    </p>
                  </div>
                  {canReverse ? (
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <Label>Reversal reason</Label>
                        <Input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder="Required reversal reason" />
                      </div>
                      <div className="grid gap-2">
                        <Label>Confirm reference</Label>
                        <Input
                          value={reverseConfirm}
                          onChange={(event) => setReverseConfirm(event.target.value)}
                          placeholder={`Type ${selectedRun.reference_no}`}
                        />
                        <p className="text-xs text-muted-foreground">
                          Type the Production Run reference exactly to confirm this compensating reversal.
                        </p>
                      </div>
                      <Button variant="destructive" onClick={reverseRun} disabled={saving || !reverseReason.trim() || !reverseConfirmMatches}>
                        <RotateCcw />
                        Reverse run
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Manager access is required to reverse a production run.</p>
                  )}
                </div>
              ) : null}

              {outputs.length > 0 ? (
                <div className="rounded-xl border border-card-border p-4 text-sm">
                  <h3 className="mb-2 font-semibold">Movement links</h3>
                  <div className="grid gap-2 md:grid-cols-2">
                    <span>Output receipt: {outputs[0].receipt_movement_id || 'Not posted'}</span>
                    <span>Output reversal: {outputs[0].reversal_issue_movement_id || 'Not reversed'}</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
