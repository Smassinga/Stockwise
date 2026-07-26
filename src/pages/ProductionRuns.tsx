import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Download,
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
import { ProductionPathGuide } from '../components/production/ProductionPathGuide'
import { ProductionExportDialog } from '../components/production/ProductionExportDialog'
import { loadFinanceExportCompany } from '../lib/financeExportData'
import { buildProductionRunExportModel } from '../lib/productionExport'
import { useI18n, withI18nFallback } from '../lib/i18n'

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

type UomRow = {
  id: string
  code: string
  name: string
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
const money = (value: unknown, currency?: string | null, unavailable = 'Cost unavailable') =>
  currency
    ? `${currency} ${num(value).toLocaleString(activeDocumentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : unavailable
const recipeVersionLabel = (version?: string | null) => {
  const value = String(version || '').trim()
  if (!value) return ''
  return /^v/i.test(value) ? value : `v${value}`
}
const qty = (value: unknown) =>
  num(value).toLocaleString(activeDocumentLocale(), { maximumFractionDigits: 4 })

function activeDocumentLocale() {
  return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('pt')
    ? 'pt-MZ'
    : 'en-GB'
}

const compactDate = (value?: string | null, fallback = '-') =>
  (value ? new Date(value).toLocaleDateString(activeDocumentLocale()) : fallback)

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
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialBomId = searchParams.get('bomId') || ''
  const requestedRunId = searchParams.get('runId') || ''
  const requestedView = searchParams.get('view')
  const view = requestedView === 'create' || requestedView === 'detail' || requestedView === 'register'
    ? requestedView
    : initialBomId
      ? 'create'
      : 'register'
  const canReverse = hasRole(myRole, ['MANAGER', 'ADMIN', 'OWNER'])
  const canOperate = hasRole(myRole, ['OPERATOR', 'MANAGER', 'ADMIN', 'OWNER'])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runs, setRuns] = useState<ProductionRunRow[]>([])
  const [boms, setBoms] = useState<BomRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [uoms, setUoms] = useState<UomRow[]>([])
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
  const [exportOpen, setExportOpen] = useState(false)
  const [lastResult, setLastResult] = useState<'posted' | 'reversed' | null>(null)
  const postRequestRef = useRef<PostingRequestKeyRef>(null)
  const reverseRequestRef = useRef<PostingRequestKeyRef>(null)
  const previousCompanyRef = useRef<string | null>(null)

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const uomById = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom])), [uoms])
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

  const selectedCurrency = selectedRun?.base_currency_code || null
  const filteredCurrencies = useMemo(
    () => [...new Set(filteredRuns.map((run) => run.base_currency_code).filter(Boolean))],
    [filteredRuns],
  )
  const filteredCurrency = filteredCurrencies.length === 1 ? filteredCurrencies[0] : null
  const statusLabel = useCallback((status: ProductionRunRow['status']) => {
    const labels: Record<ProductionRunRow['status'], string> = {
      draft: tt('productionUx.status.draft', 'Draft'),
      posted: tt('productionUx.status.posted', 'Posted'),
      reversed: tt('productionUx.status.reversed', 'Reversed'),
      cancelled: tt('productionUx.status.cancelled', 'Cancelled'),
    }
    return labels[status]
  }, [lang, t])

  const setView = useCallback((nextView: 'register' | 'create' | 'detail', id?: string) => {
    const next = new URLSearchParams()
    next.set('view', nextView)
    if (nextView === 'detail' && id) next.set('runId', id)
    if (nextView === 'create' && initialBomId) next.set('bomId', initialBomId)
    setSearchParams(next)
  }, [initialBomId, setSearchParams])

  const openRun = useCallback((runId: string) => {
    setLastResult(null)
    setSelectedRunId(runId)
    setView('detail', runId)
  }, [setView])
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
    const [bomRes, itemRes, uomRes, whRes, binRes] = await Promise.all([
      supabase.from('boms').select('id,name,version,product_id,is_active').eq('company_id', companyId).order('name'),
      supabase.from('items').select('id,name,sku,base_uom_id,unit_price').eq('company_id', companyId).order('name'),
      supabase.from('uoms').select('id,code,name').order('code'),
      supabase.from('warehouses').select('id,code,name').eq('company_id', companyId).order('name'),
      supabase.from('bins').select('id,code,name,warehouseId').eq('company_id', companyId).order('code'),
    ])
    if (bomRes.error) throw bomRes.error
    if (itemRes.error) throw itemRes.error
    if (uomRes.error) throw uomRes.error
    if (whRes.error) throw whRes.error
    if (binRes.error) throw binRes.error
    setBoms((bomRes.data || []) as BomRow[])
    setItems((itemRes.data || []) as ItemRow[])
    setUoms((uomRes.data || []) as UomRow[])
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
  }, [companyId])

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
    setLoadError(false)
    try {
      await loadMasterData()
      await loadRuns()
    } catch (error) {
      console.error(error)
      setLoadError(true)
      toast.error(tt('productionUx.run.loadFailed', 'Production Run evidence is unavailable'))
    } finally {
      setLoading(false)
    }
  }, [companyId, lang, loadMasterData, loadRuns, t])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (view !== 'detail') {
      setSelectedRun(null)
      setSelectedRunId('')
      setDetailError(false)
      return
    }
    if (!requestedRunId || !runs.some((run) => run.id === requestedRunId)) {
      if (!loading) setView('register')
      return
    }
    setSelectedRunId(requestedRunId)
    setDetailError(false)
    void loadRunDetail(requestedRunId).catch((error) => {
      console.error(error)
      setDetailError(true)
      toast.error(tt('productionUx.run.detailFailed', 'Production Run detail is unavailable'))
    })
  }, [lang, loadRunDetail, loading, requestedRunId, runs, setView, t, view])

  useEffect(() => {
    setNewBomId(initialBomId)
  }, [initialBomId])

  useEffect(() => {
    if (previousCompanyRef.current && previousCompanyRef.current !== companyId) {
      setSelectedRunId('')
      setSelectedRun(null)
      setSearchParams(new URLSearchParams([['view', 'register']]), { replace: true })
    }
    previousCompanyRef.current = companyId
  }, [companyId, setSearchParams])

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
    if (!companyId) return toast.error(tt('productionUx.companyRequired', 'Select an active company first'))
    if (!newBomId) return toast.error(tt('productionUx.recipeRequired', 'Select a Recipe'))
    const plannedQty = num(newPlannedQty)
    if (plannedQty <= 0) return toast.error(tt('productionUx.run.plannedRequired', 'Planned output must be greater than zero'))
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
      toast.success(tt('productionUx.run.created', 'Production Run draft created'))
      await loadRuns()
      if (runId) openRun(runId)
    } catch (error) {
      console.error(error)
      toast.error(tt('productionUx.run.createFailed', 'The Production Run draft could not be created'))
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
      if (!options?.quiet) toast.success(tt('productionUx.run.saved', 'Draft saved'))
      await loadRunDetail(selectedRun.id)
      await loadRuns()
      return selectedRun
    } catch (error) {
      console.error(error)
      toast.error(tt('productionUx.run.saveFailed', 'The Production Run draft could not be saved'))
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
      toast.success(tt('productionUx.run.previewRefreshed', 'Readiness preview refreshed'))
      return
    }
    const { data, error } = await supabase.rpc('preview_production_run', {
      p_company_id: companyId,
      p_run_id: selectedRun.id,
    })
    if (error) {
      console.error(error)
      toast.error(tt('productionUx.run.previewFailed', 'Readiness evidence is unavailable'))
      return
    }
    setPreview(data as PreviewPayload)
    setPreviewFingerprint(draftFingerprint)
    toast.success(tt('productionUx.run.previewRefreshed', 'Readiness preview refreshed'))
  }

  async function postRun() {
    if (!companyId || !selectedRun) return
    if (!activePreview?.ready) return toast.error(tt('productionUx.run.previewRequired', 'Refresh the readiness preview before posting'))
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
      toast.success(tt('productionUx.run.posted', 'Production Run posted'))
      setLastResult('posted')
      await loadRunDetail(selectedRun.id)
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error(tt('productionUx.run.postFailed', 'The Production Run could not be posted'))
    } finally {
      setSaving(false)
    }
  }

  async function reverseRun() {
    if (!companyId || !selectedRun) return
    const reason = reverseReason.trim()
    if (!reason) return toast.error(tt('productionUx.run.reversalReasonRequired', 'Enter a reversal reason'))
    if (!reverseConfirmMatches) return toast.error(tt('productionUx.run.reversalReferenceRequired', 'Type the Production Run reference to confirm reversal'))
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
      toast.success(tt('productionUx.run.reversed', 'Production Run reversed'))
      setLastResult('reversed')
      await loadRunDetail(selectedRun.id)
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error(tt('productionUx.run.reverseFailed', 'The Production Run could not be reversed'))
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
      toast.success(tt('productionUx.run.cancelled', 'Draft cancelled'))
      await loadRunDetail(selectedRun.id)
      await loadRuns()
    } catch (error) {
      console.error(error)
      toast.error(tt('productionUx.run.cancelFailed', 'The draft could not be cancelled'))
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<PremiumDataTableColumn<ProductionRunRow>[]>(() => [
    {
      id: 'reference',
      header: tt('productionUx.run.reference', 'Production Run'),
      cell: (run) => (
        <button
          type="button"
          onClick={() => openRun(run.id)}
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
      header: tt('productionUx.common.status', 'Status'),
      cell: (run) => <PremiumStatusBadge tone={statusTone[run.status]}>{statusLabel(run.status)}</PremiumStatusBadge>,
      sortValue: (run) => run.status,
      minWidth: 110,
    },
    {
      id: 'recipe',
      header: tt('productionUx.recipe', 'Recipe'),
      cell: (run) => bomById.get(run.bom_id)?.name || run.bom_name_snapshot || tt('productionUx.recipe', 'Recipe'),
      sortValue: (run) => bomById.get(run.bom_id)?.name || run.bom_name_snapshot || '',
      minWidth: 180,
    },
    {
      id: 'output',
      header: tt('productionUx.run.output', 'Output'),
      cell: (run) => (
        <span>
          {itemById.get(run.finished_item_id)?.name || tt('productionUx.finishedItem', 'Finished item')}
          <span className="block text-xs text-muted-foreground">
            {tt('productionUx.run.outputComparison', '{actual} actual / {planned} planned')
              .replace('{actual}', qty(run.actual_output_qty ?? run.planned_output_qty))
              .replace('{planned}', qty(run.planned_output_qty))}
          </span>
        </span>
      ),
      sortValue: (run) => itemById.get(run.finished_item_id)?.name || '',
      minWidth: 220,
    },
    {
      id: 'cost',
      header: tt('productionUx.run.cost', 'Cost'),
      cell: (run) => (
        <span className="font-medium">
          {money(run.total_cost, run.base_currency_code)}
          <span className="block text-xs text-muted-foreground">
            {money(run.output_unit_cost, run.base_currency_code, tt('productionUx.costUnavailable', 'Cost unavailable'))} / {tt('productionUx.unit', 'unit')}
          </span>
        </span>
      ),
      sortValue: (run) => run.total_cost,
      align: 'right',
      minWidth: 150,
    },
    {
      id: 'runDate',
      header: tt('productionUx.common.date', 'Date'),
      cell: (run) => compactDate(run.run_date, tt('productionUx.notRecorded', 'Not recorded')),
      sortValue: (run) => run.run_date,
      minWidth: 120,
    },
  ], [bomById, itemById, lang, openRun, statusLabel, t])

  const displayedRuns = filteredRuns
  const selectedItem = selectedRun ? itemById.get(selectedRun.finished_item_id) : null
  const draftBins = (warehouseId: string) => bins.filter((bin) => bin.warehouseId === warehouseId)
  const warehouseLocation = (warehouseId?: string | null, binId?: string | null) => {
    const warehouse = warehouseId ? warehouseById.get(warehouseId) : null
    const bin = binId ? binById.get(binId) : null
    return [warehouse?.name, bin ? `${bin.code} - ${bin.name}` : null].filter(Boolean).join(' / ')
      || tt('productionUx.locationUnavailable', 'Location unavailable')
  }

  const buildExportModel = async (language: 'en' | 'pt' | 'bi') => {
    if (!companyId || !selectedRun) throw new Error('production_run_export_unavailable')
    const company = await loadFinanceExportCompany(companyId)
    const runCurrency = selectedRun.base_currency_code
    if (!runCurrency) throw new Error('production_run_currency_unavailable')
    const runItem = itemById.get(selectedRun.finished_item_id)
    return buildProductionRunExportModel({
      company,
      language,
      baseCurrency: runCurrency,
      reference: selectedRun.reference_no,
      status: statusLabel(selectedRun.status),
      runDate: selectedRun.run_date,
      recipe: selectedRun.bom_name_snapshot || bomById.get(selectedRun.bom_id)?.name || tt('productionUx.recipe', 'Recipe'),
      version: selectedRun.bom_version_snapshot,
      finishedItem: runItem?.name || tt('productionUx.finishedItem', 'Finished item'),
      plannedOutput: num(selectedRun.planned_output_qty),
      actualOutput: selectedRun.actual_output_qty == null ? null : num(selectedRun.actual_output_qty),
      materialCost: num(activePreview?.estimated_material_cost ?? selectedRun.material_cost_total),
      extraCost: num(activePreview?.extra_cost_total ?? selectedRun.extra_cost_total),
      totalCost: num(activePreview?.estimated_total_cost ?? selectedRun.total_cost),
      outputUnitCost: num(activePreview?.estimated_unit_cost ?? selectedRun.output_unit_cost),
      destination: warehouseLocation(selectedRun.destination_warehouse_id, selectedRun.destination_bin_id),
      inputs: inputs.map((input) => {
        const previewInput = activePreview?.inputs?.find((row) => row.id === input.id)
        return {
          item: itemById.get(input.item_id)?.name || tt('productionUx.itemUnavailable', 'Item unavailable'),
          quantity: num(input.actual_qty ?? input.planned_qty),
          source: warehouseLocation(input.source_warehouse_id, input.source_bin_id),
          unitCost: num(selectedRun.status === 'draft' ? previewInput?.preview_unit_cost : input.frozen_unit_cost),
          totalCost: num(selectedRun.status === 'draft' ? previewInput?.preview_total_cost : input.frozen_total_cost),
          reference: input.issue_movement_id
            ? `${selectedRun.reference_no} / ${tt('productionUx.input', 'Input')} ${input.line_no}`
            : tt('productionUx.notPosted', 'Not posted'),
        }
      }),
      extraCosts: extraCosts.map((line) => ({
        type: tt(`productionUx.extraCost.${line.category}`, line.category),
        notes: line.description || '—',
        totalCost: num(line.amount_base),
      })),
      outputs: outputs.map((output) => ({
        item: itemById.get(output.item_id)?.name || runItem?.name || tt('productionUx.finishedItem', 'Finished item'),
        quantity: num(output.actual_qty ?? selectedRun.actual_output_qty),
        destination: warehouseLocation(output.destination_warehouse_id, output.destination_bin_id),
        unitCost: num(output.frozen_unit_cost ?? selectedRun.output_unit_cost),
        totalCost: num(output.frozen_total_cost ?? selectedRun.total_cost),
        reference: output.receipt_movement_id
          ? `${selectedRun.reference_no} / ${tt('productionUx.outputReceipt', 'Output receipt')}`
          : tt('productionUx.notPosted', 'Not posted'),
      })),
    })
  }

  return (
    <div className="app-page app-page--workspace space-y-6 overflow-x-hidden">
      <PremiumRegisterHeader
        eyebrow={tt('productionUx.eyebrow', 'Production control')}
        title={tt('productionUx.run.title', 'Production Runs')}
        description={tt('productionUx.run.description', 'Plan actual production, preserve frozen cost evidence, and keep posting and reversal traceable.')}
        badges={
          <>
            <PremiumStatusBadge tone="neutral">{tt('productionUx.appendOnly', 'Append-only stock evidence')}</PremiumStatusBadge>
            <PremiumStatusBadge tone="info">{tt('productionUx.frozenSnapshots', 'Frozen cost snapshots')}</PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/bom">{tt('productionUx.path.recipe', 'Recipes & Assemblies')}</Link>
            </Button>
            {view === 'register' ? (
              <>
                <Button onClick={refreshAll} disabled={loading} variant="outline">
                  <RefreshCw />
                  {tt('common.refresh', 'Refresh')}
                </Button>
                {canOperate ? (
                  <Button onClick={() => setView('create')}>
                    <Plus />
                    {tt('productionUx.run.new', 'New Production Run')}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button variant="outline" onClick={() => setView('register')}>
                {tt('productionUx.backToRegister', 'Back to register')}
              </Button>
            )}
            {view === 'detail' && selectedRun ? (
              <Button variant="outline" onClick={() => setExportOpen(true)}>
                <Download />
                {tt('productionUx.export.costSheet', 'Export cost sheet')}
              </Button>
            ) : null}
          </>
        }
        metrics={view === 'register' ? (
          <>
            <PremiumMetricCard label={tt('productionUx.status.draft', 'Drafts')} value={runs.filter((run) => run.status === 'draft').length} icon={<FileClock />} tone="info" />
            <PremiumMetricCard label={tt('productionUx.status.posted', 'Posted')} value={runs.filter((run) => run.status === 'posted').length} icon={<PackageCheck />} tone="positive" />
            <PremiumMetricCard label={tt('productionUx.status.reversed', 'Reversed')} value={runs.filter((run) => run.status === 'reversed').length} icon={<RotateCcw />} tone="warning" />
            <PremiumMetricCard
              label={tt('productionUx.run.filteredCost', 'Posted production cost')}
              value={filteredCurrency
                ? money(filteredRuns.filter((run) => run.status === 'posted').reduce((sum, run) => sum + num(run.total_cost), 0), filteredCurrency)
                : tt('productionUx.currencyUnavailable', 'Currency evidence unavailable or mixed')}
              icon={<Factory />}
              tone="neutral"
            />
          </>
        ) : null}
      />

      <ProductionPathGuide />

      {loadError ? (
        <PremiumEmptyState
          icon={<AlertTriangle />}
          title={tt('productionUx.run.loadFailed', 'Production Run evidence is unavailable')}
          description={tt('productionUx.run.loadFailedHelp', 'No missing register or cost evidence has been treated as an empty or zero result.')}
          action={<Button variant="outline" onClick={refreshAll}>{tt('common.retry', 'Try again')}</Button>}
        />
      ) : null}

      {view === 'create' && !loadError ? (
      <section className="grid gap-4 border-y border-card-border bg-surface-muted/30 px-1 py-5 md:grid-cols-[minmax(0,1fr)_11rem_9rem]">
        <div className="md:col-span-3">
          <h2 className="text-lg font-semibold">{tt('productionUx.run.createTitle', 'Create Production Run draft')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tt('productionUx.run.createHelp', 'Choose an active Recipe and planned output. Continue in detail to record actual quantities, sources, costs, and readiness.')}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-production-bom">{tt('productionUx.recipe', 'Recipe')}</Label>
          <select
            id="new-production-bom"
            value={newBomId}
            onChange={(event) => setNewBomId(event.target.value)}
            className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
          >
            <option value="">{tt('productionUx.recipeSelect', 'Select a Recipe')}</option>
            {boms.filter((bom) => bom.is_active !== false).map((bom) => (
              <option key={bom.id} value={bom.id}>
                {bom.name}{bom.version ? ` ${recipeVersionLabel(bom.version)}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-production-qty">{tt('productionUx.run.plannedOutput', 'Planned output')}</Label>
          <Input id="new-production-qty" type="number" min="0" step="0.0001" value={newPlannedQty} onChange={(event) => setNewPlannedQty(event.target.value)} />
        </div>
        <div className="flex items-end">
          <Button onClick={createDraft} disabled={saving || !companyId || !canOperate} className="w-full">
            <Plus />
            {tt('productionUx.run.createDraft', 'Create draft')}
          </Button>
        </div>
      </section>
      ) : null}

      {view === 'register' && !loadError ? (
      <div className="space-y-5">
        <section className="space-y-4">
          <div className="grid gap-3 rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card p-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="relative md:col-span-2 xl:col-span-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tt('productionUx.run.search', 'Search runs, Recipes, or items')} className="pl-9" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as any)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="all">{tt('productionUx.allStatuses', 'All statuses')}</option>
              <option value="draft">{statusLabel('draft')}</option>
              <option value="posted">{statusLabel('posted')}</option>
              <option value="reversed">{statusLabel('reversed')}</option>
              <option value="cancelled">{statusLabel('cancelled')}</option>
            </select>
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="all">{tt('productionUx.allFinishedItems', 'All finished items')}</option>
              {Array.from(new Set(runs.map((run) => run.finished_item_id))).map((itemId) => (
                <option key={itemId} value={itemId}>{itemById.get(itemId)?.name || tt('productionUx.itemUnavailable', 'Item unavailable')}</option>
              ))}
            </select>
            <select value={bomFilter} onChange={(event) => setBomFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              <option value="all">{tt('productionUx.allRecipes', 'All Recipes')}</option>
              {Array.from(new Set(runs.map((run) => run.bom_id))).map((bomId) => (
                <option key={bomId} value={bomId}>{bomById.get(bomId)?.name || tt('productionUx.recipeUnavailable', 'Recipe unavailable')}</option>
              ))}
            </select>
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label={tt('productionUx.dateFrom', 'Run date from')} />
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label={tt('productionUx.dateTo', 'Run date to')} />
          </div>

          {isMobile ? (
            <PremiumMobileCardList
              rows={displayedRuns}
              getRowId={(run) => run.id}
              loading={loading}
              emptyState={<PremiumEmptyState icon={<Factory />} title={tt('productionUx.run.empty', 'No Production Runs found')} compact />}
              renderCard={(run) => (
                <button
                  type="button"
                  onClick={() => openRun(run.id)}
                  className={cn(
                    'w-full rounded-[calc(var(--radius)+0.2rem)] border bg-card p-4 text-left shadow-[0_16px_34px_-30px_hsl(var(--foreground)/0.35)]',
                    selectedRunId === run.id ? 'border-primary/50 border-l-4' : 'border-card-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{run.reference_no}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{itemById.get(run.finished_item_id)?.name || tt('productionUx.finishedItem', 'Finished item')}</div>
                    </div>
                    <PremiumStatusBadge tone={statusTone[run.status]}>{statusLabel(run.status)}</PremiumStatusBadge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <span>{qty(run.actual_output_qty ?? run.planned_output_qty)} {tt('productionUx.run.outputShort', 'output')}</span>
                    <span className="text-right">
                      {run.status === 'draft'
                        ? tt('productionUx.run.draftCost', 'Preview required')
                        : money(run.total_cost, run.base_currency_code, tt('productionUx.costUnavailable', 'Cost unavailable'))}
                    </span>
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
              emptyState={<PremiumEmptyState icon={<Factory />} title={tt('productionUx.run.empty', 'No Production Runs found')} compact />}
              sort={sort}
              onSortChange={setSort}
              ariaLabel={tt('productionUx.run.register', 'Production Runs register')}
            />
          )}
        </section>
      </div>
      ) : null}

      {view === 'detail' && !loadError ? (
        <section className="border-y border-card-border bg-card py-5">
          {detailError ? (
            <PremiumEmptyState
              icon={<AlertTriangle />}
              title={tt('productionUx.run.detailFailed', 'Production Run detail is unavailable')}
              description={tt('productionUx.run.detailFailedHelp', 'The register remains available. No missing cost or movement evidence is shown as zero.')}
              action={<Button variant="outline" onClick={() => setView('register')}>{tt('productionUx.backToRegister', 'Back to register')}</Button>}
            />
          ) : !selectedRun ? (
            <PremiumEmptyState icon={<Factory />} title={tt('productionUx.run.loadingDetail', 'Loading Production Run detail...')} compact />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold">{selectedRun.reference_no}</h2>
                    <PremiumStatusBadge tone={statusTone[selectedRun.status]}>{statusLabel(selectedRun.status)}</PremiumStatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedRun.bom_name_snapshot || bomById.get(selectedRun.bom_id)?.name || tt('productionUx.recipe', 'Recipe')}
                    {' → '}
                    {selectedItem?.name || tt('productionUx.finishedItem', 'Finished item')}
                  </p>
                </div>
              </div>

              {selectedRun.status === 'draft' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>{tt('productionUx.run.plannedOutput', 'Planned output')}</Label>
                    <Input type="number" min="0" step="0.0001" value={draftFields.plannedOutputQty} onChange={(event) => mutateDraftFields({ plannedOutputQty: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{tt('productionUx.run.actualOutput', 'Actual output')}</Label>
                    <Input type="number" min="0" step="0.0001" value={draftFields.actualOutputQty} onChange={(event) => mutateDraftFields({ actualOutputQty: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{tt('productionUx.run.date', 'Run date')}</Label>
                    <Input type="date" value={draftFields.runDate} onChange={(event) => mutateDraftFields({ runDate: event.target.value })} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{tt('productionUx.destinationWarehouse', 'Destination warehouse')}</Label>
                    <select
                      value={draftFields.destinationWarehouseId}
                      onChange={(event) => mutateDraftFields({ destinationWarehouseId: event.target.value, destinationBinId: '' })}
                      className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="">{tt('productionUx.selectWarehouse', 'Select warehouse')}</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label>{tt('productionUx.destinationBin', 'Destination bin')}</Label>
                    <select
                      value={draftFields.destinationBinId}
                      onChange={(event) => mutateDraftFields({ destinationBinId: event.target.value })}
                      className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                    >
                      <option value="">{tt('productionUx.selectBin', 'Select bin')}</option>
                      {draftBins(draftFields.destinationWarehouseId).map((bin) => (
                        <option key={bin.id} value={bin.id}>{bin.code} - {bin.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label>{tt('productionUx.common.notes', 'Notes')}</Label>
                    <Input value={draftFields.notes} onChange={(event) => mutateDraftFields({ notes: event.target.value })} placeholder={tt('productionUx.run.notesPlaceholder', 'Optional production notes')} />
                  </div>
                  <p className="text-sm text-muted-foreground md:col-span-2">
                    {tt('productionUx.run.baseUomOnly', 'Production Run quantities are recorded in each item’s base UOM. General UOM conversion is not applied.')}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <PremiumMetricCard label={tt('productionUx.run.actualOutput', 'Actual output')} value={qty(selectedRun.actual_output_qty)} description={selectedItem?.name} />
                  <PremiumMetricCard label={tt('productionUx.run.totalCost', 'Total production cost')} value={money(selectedRun.total_cost, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} description={tt('productionUx.run.frozenPosted', 'Frozen at posting')} />
                  <PremiumMetricCard label={tt('productionUx.run.unitCost', 'Output unit cost')} value={money(selectedRun.output_unit_cost, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} description={tt('productionUx.run.unitCostHelp', 'Frozen total cost divided by actual output')} />
                </div>
              )}

              <div className="grid gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tt('productionUx.run.inputs', 'Inputs')}</h3>
                  {selectedRun.status === 'draft'
                    ? activePreview?.ready
                      ? <PremiumStatusBadge tone="positive">{tt('productionUx.ready', 'Ready')}</PremiumStatusBadge>
                      : <PremiumStatusBadge tone="warning">{tt('productionUx.needsReview', 'Needs review')}</PremiumStatusBadge>
                    : <PremiumStatusBadge tone="neutral">{tt('productionUx.frozenEvidence', 'Frozen evidence')}</PremiumStatusBadge>}
                </div>
                <div className="space-y-3">
                  {inputs.map((input) => {
                    const previewInput = activePreview?.inputs?.find((row) => row.id === input.id)
                    return (
                      <div key={input.id} className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-muted/50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-medium">{itemById.get(input.item_id)?.name || tt('productionUx.itemUnavailable', 'Item unavailable')}</div>
                            <div className="text-xs text-muted-foreground">
                              {tt('productionUx.run.inputPlan', 'Planned {qty} {uom}')
                                .replace('{qty}', qty(input.planned_qty))
                                .replace('{uom}', uomById.get(input.uom_id)?.code || tt('productionUx.baseUom', 'base UOM'))}
                              {previewInput
                                ? ` · ${tt('productionUx.available', 'Available')} ${qty(previewInput.available_qty)} · ${tt('productionUx.shortage', 'Shortage')} ${qty(previewInput.shortage_qty)}`
                                : ''}
                            </div>
                          </div>
                          {selectedRun.status === 'draft'
                            ? previewInput?.ready
                              ? <PremiumStatusBadge tone="positive">{tt('productionUx.sufficient', 'Sufficient')}</PremiumStatusBadge>
                              : <PremiumStatusBadge tone="warning">{tt('productionUx.checkSource', 'Check source')}</PremiumStatusBadge>
                            : null}
                        </div>
                        {selectedRun.status === 'draft' ? (
                          <div className="mt-3 grid gap-3 md:grid-cols-[8rem_1fr_1fr]">
                            <Input type="number" min="0" step="0.0001" value={input.actual_qty ?? ''} onChange={(event) => updateInput(input.id, { actual_qty: num(event.target.value) })} aria-label={tt('productionUx.run.actualInput', 'Actual input quantity')} />
                            <select
                              value={input.source_warehouse_id || ''}
                              onChange={(event) => updateInput(input.id, { source_warehouse_id: event.target.value || null, source_bin_id: null })}
                              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                            >
                              <option value="">{tt('productionUx.sourceWarehouse', 'Source warehouse')}</option>
                              {warehouses.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                              ))}
                            </select>
                            <select
                              value={input.source_bin_id || ''}
                              onChange={(event) => updateInput(input.id, { source_bin_id: event.target.value || null })}
                              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
                            >
                              <option value="">{tt('productionUx.sourceBin', 'Source bin')}</option>
                              {draftBins(input.source_warehouse_id || '').map((bin) => (
                                <option key={bin.id} value={bin.id}>{bin.code} - {bin.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                            <span>{tt('productionUx.actual', 'Actual')} {qty(input.actual_qty)} {uomById.get(input.uom_id)?.code || tt('productionUx.baseUom', 'base UOM')}</span>
                            <span>{tt('productionUx.run.frozenInputCost', 'Frozen input cost')} {money(input.frozen_unit_cost, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))}</span>
                            <span>
                              {input.issue_movement_id
                                ? <Link className="font-medium text-primary hover:underline" to={`/movements?search=${encodeURIComponent(selectedRun.reference_no)}`}>{tt('productionUx.viewMovementEvidence', 'View movement evidence')}</Link>
                                : tt('productionUx.notPosted', 'Not posted')}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{tt('productionUx.run.extraCosts', 'Additional direct costs')}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{tt('productionUx.run.extraCostBoundary', 'Operational production-cost snapshots only. No cash, bank, AP, settlement, or journal posting.')}</p>
                  </div>
                  {selectedRun.status === 'draft' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addExtraCost}
                    >
                      <Plus />
                      {tt('productionUx.run.addCost', 'Add cost')}
                    </Button>
                  ) : null}
                </div>
                {extraCosts.length === 0 ? (
                  <p className="rounded-md border border-dashed border-card-border p-3 text-sm text-muted-foreground">{tt('productionUx.run.noExtraCosts', 'No additional direct costs recorded.')}</p>
                ) : (
                  <div className="space-y-2">
                    {extraCosts.map((line, index) => (
                      <div key={line.id || index} className="grid gap-2 rounded-xl border border-card-border p-3 md:grid-cols-[10rem_1fr_9rem]">
                        {selectedRun.status === 'draft' ? (
                          <>
                            <select value={line.category} onChange={(event) => updateExtraCost(index, { category: event.target.value as ExtraCostLine['category'] })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
                              {extraCategories.map((category) => (
                                <option key={category} value={category}>
                                  {tt(`productionUx.extraCost.${category}`, category)}
                                </option>
                              ))}
                            </select>
                            <Input value={line.description} onChange={(event) => updateExtraCost(index, { description: event.target.value })} placeholder={tt('common.description', 'Description')} />
                            <Input type="number" min="0" step="0.01" value={line.amount_base} onChange={(event) => updateExtraCost(index, { amount_base: num(event.target.value) })} />
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{tt(`productionUx.extraCost.${line.category}`, line.category)}</span>
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
                <PremiumMetricCard
                  label={selectedRun.status === 'draft' ? tt('productionUx.run.materialEstimate', 'Material cost estimate') : tt('productionUx.run.materialFrozen', 'Frozen material cost')}
                  value={selectedRun.status === 'draft' && !activePreview ? tt('productionUx.previewRequired', 'Preview required') : money(activePreview?.estimated_material_cost ?? selectedRun.material_cost_total, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))}
                  variant="panel"
                />
                <PremiumMetricCard label={tt('productionUx.run.extraCosts', 'Additional direct costs')} value={money(activePreview?.extra_cost_total ?? selectedRun.extra_cost_total, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} variant="panel" />
                <PremiumMetricCard label={tt('productionUx.run.totalCost', 'Total production cost')} value={selectedRun.status === 'draft' && !activePreview ? tt('productionUx.previewRequired', 'Preview required') : money(activePreview?.estimated_total_cost ?? selectedRun.total_cost, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} variant="panel" />
                <PremiumMetricCard label={tt('productionUx.run.unitCost', 'Output unit cost')} value={selectedRun.status === 'draft' && !activePreview ? tt('productionUx.previewRequired', 'Preview required') : money(activePreview?.estimated_unit_cost ?? selectedRun.output_unit_cost, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} variant="panel" />
              </div>

              {selectedRun.status === 'draft' && !activePreview ? (
                <div role="status" className="rounded-xl border border-informational/25 bg-informational/8 p-3 text-sm text-informational dark:border-informational/30 dark:bg-informational/10">
                  {tt('productionUx.run.previewStale', 'Save the draft and refresh readiness after material changes. Posting remains blocked until the preview is current.')}
                </div>
              ) : null}

              {activePreview && !activePreview.ready ? (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-100">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{tt('productionUx.run.previewBlocked', 'Resolve the listed source, quantity, and destination blockers before posting.')}</span>
                  </div>
                </div>
              ) : null}

              {selectedRun.status === 'draft' ? (
                <div className="flex flex-wrap justify-between gap-2 border-t border-card-border pt-4">
                  <Button variant="outline" onClick={cancelDraft} disabled={saving}>{tt('productionUx.run.cancelDraft', 'Cancel draft')}</Button>
                  {!activePreview ? (
                    <Button onClick={refreshPreview} disabled={saving}>
                      <Save />
                      {tt('productionUx.run.savePreview', 'Save and preview readiness')}
                    </Button>
                  ) : activePreview.ready ? (
                    <Button onClick={postRun} disabled={saving}>
                      <CheckCircle2 />
                      {tt('productionUx.run.post', 'Post Production Run')}
                    </Button>
                  ) : (
                    <Button onClick={refreshPreview} disabled={saving} variant="outline">
                      <RefreshCw />
                      {tt('productionUx.run.refreshPreview', 'Refresh readiness')}
                    </Button>
                  )}
                </div>
              ) : null}

              {selectedRun.status === 'posted' ? (
                <div className="rounded-xl border border-card-border p-4">
                  <div className="mb-3">
                    <h3 className="font-semibold">{tt('productionUx.run.controlledReversal', 'Controlled reversal')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {tt('productionUx.run.reversalHelp', 'Reversal creates compensating stock movements and keeps the original Production Run and movements immutable. Current WAC may differ after intervening stock activity.')}
                    </p>
                  </div>
                  {canReverse ? (
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <Label>{tt('productionUx.run.reversalReason', 'Reversal reason')}</Label>
                        <Input value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} placeholder={tt('productionUx.run.reversalReasonPlaceholder', 'Required reversal reason')} />
                      </div>
                      <div className="grid gap-2">
                        <Label>{tt('productionUx.run.confirmReference', 'Confirm reference')}</Label>
                        <Input
                          value={reverseConfirm}
                          onChange={(event) => setReverseConfirm(event.target.value)}
                          placeholder={tt('productionUx.run.typeReference', 'Type {reference}').replace('{reference}', selectedRun.reference_no)}
                        />
                        <p className="text-xs text-muted-foreground">
                          {tt('productionUx.run.confirmHelp', 'Type the Production Run reference exactly to confirm this compensating reversal.')}
                        </p>
                      </div>
                      <Button variant="destructive" onClick={reverseRun} disabled={saving || !reverseReason.trim() || !reverseConfirmMatches}>
                        <RotateCcw />
                        {tt('productionUx.run.reverse', 'Reverse Production Run')}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{tt('productionUx.run.managerRequired', 'Manager, Admin, or Owner access is required to reverse a Production Run.')}</p>
                  )}
                </div>
              ) : null}

              {lastResult ? (
                <div
                  tabIndex={-1}
                  className="rounded-md border border-primary/30 bg-primary/7 p-4"
                  role="status"
                >
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                    <div className="min-w-0">
                      <h3 className="font-semibold">
                        {lastResult === 'posted'
                          ? tt('productionUx.run.posted', 'Production Run posted')
                          : tt('productionUx.run.reversed', 'Production Run reversed')}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedRun.reference_no} · {selectedItem?.name || tt('productionUx.finishedItem', 'Finished item')}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/movements?search=${encodeURIComponent(selectedRun.reference_no)}`}>
                            {tt('productionUx.viewStockMovements', 'View Stock Movements')}
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/bom?view=detail&bomId=${selectedRun.bom_id}`}>
                            {tt('productionUx.viewRecipe', 'View Recipe')}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {outputs.length > 0 ? (
                <div className="rounded-xl border border-card-border p-4 text-sm">
                  <h3 className="mb-2 font-semibold">{tt('productionUx.run.movementEvidence', 'Stock movement evidence')}</h3>
                  <div className="grid gap-2 md:grid-cols-2">
                    <span>
                      {tt('productionUx.outputReceipt', 'Output receipt')}: {' '}
                      {outputs[0].receipt_movement_id
                        ? <Link className="font-medium text-primary hover:underline" to={`/movements?search=${encodeURIComponent(selectedRun.reference_no)}`}>{selectedRun.reference_no}</Link>
                        : tt('productionUx.notPosted', 'Not posted')}
                    </span>
                    <span>
                      {tt('productionUx.outputReversal', 'Output reversal')}: {' '}
                      {outputs[0].reversal_issue_movement_id
                        ? <Link className="font-medium text-primary hover:underline" to={`/movements?search=${encodeURIComponent(selectedRun.reference_no)}`}>{selectedRun.reference_no}</Link>
                        : tt('productionUx.notReversed', 'Not reversed')}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      <ProductionExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        title={tt('productionUx.export.runTitle', 'Production Run Cost Sheet')}
        scope={selectedRun?.reference_no || tt('productionUx.run.noSelection', 'No Production Run selected')}
        recordCount={inputs.length + extraCosts.length + outputs.length}
        currencyBasis={selectedCurrency
          ? tt('productionUx.baseCurrency', 'Company base currency: {code}').replace('{code}', selectedCurrency)
          : tt('productionUx.currencyUnavailable', 'Currency evidence unavailable')}
        buildModel={buildExportModel}
      />
    </div>
  )
}
