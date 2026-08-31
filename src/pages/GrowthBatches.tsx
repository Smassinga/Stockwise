import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Coins,
  Download,
  LineChart,
  MoreHorizontal,
  PackageMinus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Search,
  Sprout,
  Trash2,
  WalletCards,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useIsMobile } from '../hooks/use-mobile'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { hasRole } from '../lib/roles'
import {
  clearPostingRequestKey,
  getPostingRequestKeyForFingerprint,
  stablePostingFingerprint,
  type PostingRequestKeyRef,
} from '../lib/postingRequestKeys'
import { cn } from '../lib/utils'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import {
  PremiumDataTable,
  sortPremiumRows,
  type PremiumDataTableColumn,
  type PremiumDataTableSortState,
} from '../components/premium/PremiumDataTable'
import { PremiumEmptyState } from '../components/premium/PremiumEmptyState'
import { OperationalSummaryBand } from '../components/premium/OperationalSummaryBand'
import { PremiumMobileCardList } from '../components/premium/PremiumMobileCardList'
import { getPremiumPageRows } from '../components/premium/PremiumPagination'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { ProductionPathGuide } from '../components/production/ProductionPathGuide'
import { ProductionExportDialog } from '../components/production/ProductionExportDialog'
import { loadFinanceExportCompany } from '../lib/financeExportData'
import { buildGrowthBatchExportModel } from '../lib/productionExport'

import type {
  BatchFamily,
  QuantityBasis,
  BatchStatus,
  MeasurementType,
  DirectCostCategory,
  LossType,
  LossReasonCode,
  TransferReasonCode,
  HarvestKind,
  UomRow,
  WarehouseRow,
  BinRow,
  ItemRow,
  GrowthBatchRegisterRow,
  GrowthBatchCurrentState,
  GrowthBatchDetailRow,
  GrowthBatchEventRow,
  GrowthBatchLossRow,
  GrowthBatchTransferRow,
  GrowthBatchHarvestRow,
  GrowthBatchCompletionRow,
  GrowthBatchMeasurementRow,
  GrowthBatchDirectCostRow,
  GrowthBatchStockInputRow,
  DraftForm,
  MeasurementForm,
  DirectCostForm,
  StockInputLineForm,
  StockInputForm,
  LossForm,
  LossPreview,
  TransferLocationPreview,
  TransferPreview,
  HarvestLocationPreview,
  HarvestPreview,
  CompletionPreview,
  StockInputPreview,
  ReversalForm,
  LossReversalForm,
  TransferForm,
  TransferReversalForm,
  HarvestForm,
  HarvestReversalForm,
  CompletionForm,
  CompletionReversalForm,
} from '../lib/growthBatchTypes'

import {
  growthBatchTransferCopy,
  growthBatchHarvestCopy,
  growthBatchCompletionCopy,
  type GrowthBatchHarvestCopy,
  type GrowthBatchTransferCopy,
  type GrowthBatchCompletionCopy,
} from '../lib/growthBatchCopy'

import {
  batchFamilies,
  quantityBases,
  measurementTypes,
  directCostCategories,
  mortalityReasons,
  shrinkageReasons,
  transferReasons,
  statusTone,
  eventTone,
  basisFamily,
  today,
  labelize,
  eventSummaryLabel,
  isGrowthBatchTransferBlockerCode,
  isGrowthBatchHarvestBlockerCode,
  isGrowthBatchCompletionBlockerCode,
  num,
  qty,
  qtyWithUom,
  locationDisplay,
  money,
  compactDate,
  compactDateTime,
  cleanText,
  optionalNumber,
  requiredNumber,
  emptyDraftForm,
  emptyMeasurementForm,
  emptyDirectCostForm,
  emptyStockInputLine,
  emptyStockInputForm,
  emptyLossForm,
  emptyReversalForm,
  emptyLossReversalForm,
  emptyTransferForm,
  emptyTransferReversalForm,
  emptyHarvestForm,
  emptyHarvestReversalForm,
  emptyCompletionForm,
  emptyCompletionReversalForm,
  friendlyError,
} from './growthBatches/growthBatchPageSupport'

import { DetailSection, Field, SummaryItem } from './growthBatches/GrowthBatchDetailPrimitives'
import GrowthBatchCompletionSection from './growthBatches/GrowthBatchCompletionSection'
import GrowthBatchTransferSection from './growthBatches/GrowthBatchTransferSection'

export default function GrowthBatches() {
  const { lang, t } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const domainLabel = (value: string) => tt(`productionUx.enum.${value}`, labelize(value))
  const { companyId, myRole } = useOrg()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const requestedBatchId = searchParams.get('batchId') || ''
  const requestedSection = searchParams.get('section')
  const view = requestedView === 'create' || requestedView === 'detail' || requestedView === 'register'
    ? requestedView
    : 'register'
  const section = requestedSection === 'materials'
    || requestedSection === 'lifecycle'
    || requestedSection === 'measurements'
    || requestedSection === 'costs'
    || requestedSection === 'history'
    || requestedSection === 'overview'
    ? requestedSection
    : 'overview'
  const isMobile = useIsMobile()
  const canOperate = hasRole(myRole, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'])
  const canManage = hasRole(myRole, ['OWNER', 'ADMIN', 'MANAGER'])
  const transferCopy = growthBatchTransferCopy[lang]
  const harvestCopy = growthBatchHarvestCopy[lang]
  const completionCopy = growthBatchCompletionCopy[lang]
  const growthError = (
    error: unknown,
    transfer?: GrowthBatchTransferCopy,
    harvest?: GrowthBatchHarvestCopy,
    completion?: GrowthBatchCompletionCopy,
  ) => {
    const message = friendlyError(error, transfer, harvest, completion)
    const raw = error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : String(error || '')
    if (message === raw || (lang === 'pt' && !transfer && !harvest && !completion)) {
      return tt('productionUx.validation.actionFailed', 'The Growth Batch action could not be completed. Review the entered data and try again.')
    }
    return message
  }
  const completionStatusLabel = (status: string) => (
    status === 'active' || status === 'completed'
      ? completionCopy.statuses[status]
      : domainLabel(status)
  )

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErrors, setDetailErrors] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [batches, setBatches] = useState<GrowthBatchRegisterRow[]>([])
  const [currentState, setCurrentState] = useState<GrowthBatchCurrentState | null>(null)
  const [detailRow, setDetailRow] = useState<GrowthBatchDetailRow | null>(null)
  const [measurements, setMeasurements] = useState<GrowthBatchMeasurementRow[]>([])
  const [directCosts, setDirectCosts] = useState<GrowthBatchDirectCostRow[]>([])
  const [stockInputs, setStockInputs] = useState<GrowthBatchStockInputRow[]>([])
  const [losses, setLosses] = useState<GrowthBatchLossRow[]>([])
  const [transfers, setTransfers] = useState<GrowthBatchTransferRow[]>([])
  const [harvests, setHarvests] = useState<GrowthBatchHarvestRow[]>([])
  const [completions, setCompletions] = useState<GrowthBatchCompletionRow[]>([])
  const [events, setEvents] = useState<GrowthBatchEventRow[]>([])
  const [uoms, setUoms] = useState<UomRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [bins, setBins] = useState<BinRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | BatchStatus>('all')
  const [familyFilter, setFamilyFilter] = useState<'all' | BatchFamily>('all')
  const [basisFilter, setBasisFilter] = useState<'all' | QuantityBasis>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sort, setSort] = useState<PremiumDataTableSortState>({ columnId: 'latest', direction: 'desc' })

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [measurementOpen, setMeasurementOpen] = useState(false)
  const [directCostOpen, setDirectCostOpen] = useState(false)
  const [stockInputOpen, setStockInputOpen] = useState(false)
  const [lossOpen, setLossOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [harvestOpen, setHarvestOpen] = useState(false)
  const [completionOpen, setCompletionOpen] = useState(false)
  const [reversalOpen, setReversalOpen] = useState(false)
  const [lossReversalOpen, setLossReversalOpen] = useState(false)
  const [transferReversalOpen, setTransferReversalOpen] = useState(false)
  const [harvestReversalOpen, setHarvestReversalOpen] = useState(false)
  const [completionReversalOpen, setCompletionReversalOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [draftForm, setDraftForm] = useState<DraftForm>(() => emptyDraftForm())
  const [editForm, setEditForm] = useState<DraftForm>(() => emptyDraftForm())
  const [measurementForm, setMeasurementForm] = useState<MeasurementForm>(() => emptyMeasurementForm())
  const [directCostForm, setDirectCostForm] = useState<DirectCostForm>(() => emptyDirectCostForm())
  const [stockInputForm, setStockInputForm] = useState<StockInputForm>(() => emptyStockInputForm())
  const [stockInputPreview, setStockInputPreview] = useState<StockInputPreview | null>(null)
  const [stockInputPreviewStale, setStockInputPreviewStale] = useState(false)
  const [lossForm, setLossForm] = useState<LossForm>(() => emptyLossForm())
  const [lossPreview, setLossPreview] = useState<LossPreview | null>(null)
  const [lossPreviewStale, setLossPreviewStale] = useState(false)
  const [transferForm, setTransferForm] = useState<TransferForm>(() => emptyTransferForm())
  const [transferPreview, setTransferPreview] = useState<TransferPreview | null>(null)
  const [transferPreviewStale, setTransferPreviewStale] = useState(false)
  const [harvestForm, setHarvestForm] = useState<HarvestForm>(() => emptyHarvestForm())
  const [harvestPreview, setHarvestPreview] = useState<HarvestPreview | null>(null)
  const [harvestPreviewStale, setHarvestPreviewStale] = useState(false)
  const [completionForm, setCompletionForm] = useState<CompletionForm>(() => emptyCompletionForm())
  const [completionPreview, setCompletionPreview] = useState<CompletionPreview | null>(null)
  const [completionPreviewStale, setCompletionPreviewStale] = useState(false)
  const [reversalForm, setReversalForm] = useState<ReversalForm>(() => emptyReversalForm())
  const [lossReversalForm, setLossReversalForm] = useState<LossReversalForm>(() => emptyLossReversalForm())
  const [transferReversalForm, setTransferReversalForm] = useState<TransferReversalForm>(() => emptyTransferReversalForm())
  const [harvestReversalForm, setHarvestReversalForm] = useState<HarvestReversalForm>(() => emptyHarvestReversalForm())
  const [completionReversalForm, setCompletionReversalForm] = useState<CompletionReversalForm>(() => emptyCompletionReversalForm())
  const [cancelReason, setCancelReason] = useState('')

  const createRequestRef = useRef<PostingRequestKeyRef>(null)
  const activateRequestRef = useRef<PostingRequestKeyRef>(null)
  const cancelRequestRef = useRef<PostingRequestKeyRef>(null)
  const measurementRequestRef = useRef<PostingRequestKeyRef>(null)
  const directCostRequestRef = useRef<PostingRequestKeyRef>(null)
  const stockInputRequestRef = useRef<PostingRequestKeyRef>(null)
  const stockInputReversalRequestRef = useRef<PostingRequestKeyRef>(null)
  const lossRequestRef = useRef<PostingRequestKeyRef>(null)
  const lossReversalRequestRef = useRef<PostingRequestKeyRef>(null)
  const transferRequestRef = useRef<PostingRequestKeyRef>(null)
  const transferReversalRequestRef = useRef<PostingRequestKeyRef>(null)
  const harvestRequestRef = useRef<PostingRequestKeyRef>(null)
  const harvestReversalRequestRef = useRef<PostingRequestKeyRef>(null)
  const completionRequestRef = useRef<PostingRequestKeyRef>(null)
  const completionReversalRequestRef = useRef<PostingRequestKeyRef>(null)

  const uomById = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom])), [uoms])
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selectedBatch = useMemo(() => batches.find((batch) => batch.id === selectedId) || null, [batches, selectedId])
  const detailBatch = currentState || selectedBatch
  const registerCurrencies = useMemo(
    () => [...new Set(batches.map((batch) => batch.base_currency_code).filter(Boolean))],
    [batches],
  )
  const selectedCurrency = detailBatch?.base_currency_code || (registerCurrencies.length === 1 ? registerCurrencies[0] : null)
  const previousCompanyRef = useRef<string | null>(null)

  const setRouteState = useCallback((nextView: 'register' | 'create' | 'detail', batchId?: string, nextSection = 'overview') => {
    const next = new URLSearchParams()
    next.set('view', nextView)
    if (nextView === 'detail' && batchId) {
      next.set('batchId', batchId)
      next.set('section', nextSection)
    }
    setSearchParams(next)
  }, [setSearchParams])

  const metricValues = useMemo(() => {
    const active = batches.filter((batch) => batch.status === 'active').length
    const draft = batches.filter((batch) => batch.status === 'draft').length
    const awaitingCompletion = batches.filter((batch) => batch.fully_harvested_awaiting_completion).length
    const completed = batches.filter((batch) => batch.status === 'completed').length
    return { active, draft, awaitingCompletion, completed }
  }, [batches])

  const filteredBatches = useMemo(() => {
    const term = query.trim().toLowerCase()
    return batches.filter((batch) => {
      const searchable = [
        batch.reference_no,
        batch.name,
        batch.batch_family,
        batch.primary_quantity_basis,
        batch.warehouse_name,
        batch.bin_code,
        batch.location_description,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (term && !searchable.includes(term)) return false
      if (statusFilter !== 'all' && batch.status !== statusFilter) return false
      if (familyFilter !== 'all' && batch.batch_family !== familyFilter) return false
      if (basisFilter !== 'all' && batch.primary_quantity_basis !== basisFilter) return false
      if (dateFrom && batch.start_date < dateFrom) return false
      if (dateTo && batch.start_date > dateTo) return false
      return true
    })
  }, [basisFilter, batches, dateFrom, dateTo, familyFilter, query, statusFilter])

  const primaryUomsForCreate = useMemo(
    () => uoms.filter((uom) => !basisFamily[draftForm.primaryQuantityBasis] || uom.family === basisFamily[draftForm.primaryQuantityBasis]),
    [draftForm.primaryQuantityBasis, uoms],
  )
  const primaryUomsForEdit = useMemo(
    () => uoms.filter((uom) => !basisFamily[editForm.primaryQuantityBasis] || uom.family === basisFamily[editForm.primaryQuantityBasis]),
    [editForm.primaryQuantityBasis, uoms],
  )
  const weightUoms = useMemo(() => uoms.filter((uom) => uom.family === 'mass'), [uoms])
  const areaUoms = useMemo(() => uoms.filter((uom) => uom.family === 'area'), [uoms])
  const lengthUoms = useMemo(() => uoms.filter((uom) => uom.family === 'length'), [uoms])
  const lossReasonOptions = useMemo(() => (lossForm.lossType === 'mortality' ? mortalityReasons : shrinkageReasons), [lossForm.lossType])
  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => (warehouse.status || 'active') === 'active'), [warehouses])
  const harvestOutputItems = useMemo(() => items.filter((item) => item.track_inventory && item.base_uom_id), [items])
  const selectedHarvestOutputItem = useMemo(
    () => harvestOutputItems.find((item) => item.id === harvestForm.outputItemId) || null,
    [harvestForm.outputItemId, harvestOutputItems],
  )
  const binsForTransfer = useMemo(
    () => bins.filter((bin) => bin.warehouseId === transferForm.destinationWarehouseId && (bin.status || 'active') === 'active'),
    [bins, transferForm.destinationWarehouseId],
  )
  const binsForHarvest = useMemo(
    () => bins.filter((bin) => bin.warehouseId === harvestForm.destinationWarehouseId && (bin.status || 'active') === 'active'),
    [bins, harvestForm.destinationWarehouseId],
  )
  const measurementUoms = useMemo(() => {
    if (measurementForm.measurementType === 'total_weight' || measurementForm.measurementType === 'average_weight') {
      const configured = detailBatch?.weight_uom_id ? uomById.get(detailBatch.weight_uom_id) : null
      return configured ? [configured] : weightUoms
    }
    if (measurementForm.measurementType === 'area_observation') {
      const configured = detailBatch?.area_uom_id ? uomById.get(detailBatch.area_uom_id) : null
      return configured ? [configured] : areaUoms
    }
    if (measurementForm.measurementType === 'height') return lengthUoms
    return uoms
  }, [areaUoms, detailBatch?.area_uom_id, detailBatch?.weight_uom_id, lengthUoms, measurementForm.measurementType, uomById, uoms, weightUoms])
  const binsForCreate = useMemo(
    () => bins.filter((bin) => !draftForm.warehouseId || bin.warehouseId === draftForm.warehouseId),
    [bins, draftForm.warehouseId],
  )
  const binsForEdit = useMemo(
    () => bins.filter((bin) => !editForm.warehouseId || bin.warehouseId === editForm.warehouseId),
    [bins, editForm.warehouseId],
  )

  const loadMasterData = useCallback(async () => {
    if (!companyId) return
    const [uomRes, itemRes, warehouseRes, binRes] = await Promise.all([
      supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true }),
      supabase
        .from('items')
        .select('id,sku,name,base_uom_id,track_inventory')
        .eq('company_id', companyId)
        .eq('track_inventory', true)
        .order('name', { ascending: true }),
      supabase.from('warehouses').select('id,code,name,status').eq('company_id', companyId).order('name', { ascending: true }),
      supabase.from('bins').select('id,code,name,warehouseId,status').eq('company_id', companyId).order('code', { ascending: true }),
    ])
    if (uomRes.error) throw uomRes.error
    if (itemRes.error) throw itemRes.error
    if (warehouseRes.error) throw warehouseRes.error
    if (binRes.error) throw binRes.error
    setUoms((uomRes.data || []) as UomRow[])
    setItems((itemRes.data || []) as ItemRow[])
    setWarehouses((warehouseRes.data || []) as WarehouseRow[])
    setBins((binRes.data || []) as BinRow[])
  }, [companyId])

  const loadBatches = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('growth_batches_register')
      .select('*')
      .eq('company_id', companyId)
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(250)
    if (error) throw error
    const rows = (data || []) as GrowthBatchRegisterRow[]
    setBatches(rows)
    setSelectedId((current) => (current && rows.some((batch) => batch.id === current) ? current : ''))
  }, [companyId])

  const loadDetail = useCallback(async (batchId: string) => {
    if (!companyId || !batchId) {
      setCurrentState(null)
      setDetailRow(null)
      setMeasurements([])
      setDirectCosts([])
      setStockInputs([])
      setLosses([])
      setTransfers([])
      setHarvests([])
      setCompletions([])
      setEvents([])
      setDetailErrors({})
      return
    }

    setDetailLoading(true)
    setDetailErrors({})
    try {
      const [stateRes, detailRes, measurementRes, costRes, stockInputRes, lossRes, transferRes, harvestRes, completionRes, eventRes] = await Promise.all([
        supabase.from('growth_batch_current_state').select('*').eq('company_id', companyId).eq('id', batchId).maybeSingle(),
        supabase
          .from('growth_batches')
          .select('id,species_text,purpose,notes,cancellation_reason,created_by,updated_by,activated_by,cancelled_by,completed_by,completed_at,created_at,updated_at')
          .eq('company_id', companyId)
          .eq('id', batchId)
          .maybeSingle(),
        supabase
          .from('growth_batch_measurement_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_direct_cost_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_stock_input_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false })
          .order('line_no', { ascending: true }),
        supabase
          .from('growth_batch_loss_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_transfer_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_harvest_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_completion_history')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_event_timeline')
          .select('*')
          .eq('company_id', companyId)
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: true }),
      ])
      if (stateRes.error) throw stateRes.error
      if (detailRes.error) throw detailRes.error
      setCurrentState((stateRes.data || null) as GrowthBatchCurrentState | null)
      setDetailRow((detailRes.data || null) as GrowthBatchDetailRow | null)
      const nextErrors: Record<string, boolean> = {}
      const accept = <T,>(key: string, response: { data: T[] | null; error: unknown }, setter: (rows: T[]) => void) => {
        if (response.error) {
          nextErrors[key] = true
          setter([])
          return
        }
        setter(response.data || [])
      }
      accept('measurements', measurementRes as { data: GrowthBatchMeasurementRow[] | null; error: unknown }, setMeasurements)
      accept('costs', costRes as { data: GrowthBatchDirectCostRow[] | null; error: unknown }, setDirectCosts)
      accept('materials', stockInputRes as { data: GrowthBatchStockInputRow[] | null; error: unknown }, setStockInputs)
      accept('losses', lossRes as { data: GrowthBatchLossRow[] | null; error: unknown }, setLosses)
      accept('transfers', transferRes as { data: GrowthBatchTransferRow[] | null; error: unknown }, setTransfers)
      accept('harvests', harvestRes as { data: GrowthBatchHarvestRow[] | null; error: unknown }, setHarvests)
      accept('completion', completionRes as { data: GrowthBatchCompletionRow[] | null; error: unknown }, setCompletions)
      accept('history', eventRes as { data: GrowthBatchEventRow[] | null; error: unknown }, setEvents)
      setDetailErrors(nextErrors)
    } catch (error) {
      console.error(error)
      setCurrentState(null)
      setDetailRow(null)
      setDetailErrors({ core: true })
      toast.error(tt('productionUx.growth.detailUnavailable', 'Growth Batch detail is unavailable'))
    } finally {
      setDetailLoading(false)
    }
  }, [companyId])

  const refreshAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setLoadError(false)
    try {
      await loadMasterData()
      await loadBatches()
    } catch (error) {
      console.error(error)
      setLoadError(true)
      toast.error(tt('productionUx.growth.registerUnavailable', 'Growth Batch register is unavailable'))
    } finally {
      setLoading(false)
    }
  }, [companyId, loadBatches, loadMasterData])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (view !== 'detail') {
      setSelectedId('')
      void loadDetail('')
      return
    }
    if (!requestedBatchId || (batches.length > 0 && !batches.some((batch) => batch.id === requestedBatchId))) {
      setRouteState('register')
      return
    }
    setSelectedId(requestedBatchId)
    void loadDetail(requestedBatchId)
  }, [batches, loadDetail, requestedBatchId, setRouteState, view])

  useEffect(() => {
    if (!companyId) return
    if (previousCompanyRef.current && previousCompanyRef.current !== companyId) {
      setSelectedId('')
      setRouteState('register')
    }
    previousCompanyRef.current = companyId
  }, [companyId, setRouteState])

  useEffect(() => {
    if (view !== 'create') return
    setDraftForm(emptyDraftForm())
    setCreateOpen(true)
  }, [view])

  useEffect(() => {
    setPage(1)
  }, [basisFilter, dateFrom, dateTo, familyFilter, query, statusFilter])

  useEffect(() => {
    if (!measurementOpen) return
    const onlyOption = measurementUoms.length === 1 ? measurementUoms[0] : null
    setMeasurementForm((current) => {
      if (current.uomId && measurementUoms.some((uom) => uom.id === current.uomId)) return current
      return { ...current, uomId: onlyOption?.id || '' }
    })
  }, [measurementOpen, measurementUoms])

  function setDraftBasis(value: QuantityBasis, mode: 'create' | 'edit') {
    const updater = mode === 'create' ? setDraftForm : setEditForm
    updater((current) => ({
      ...current,
      primaryQuantityBasis: value,
      primaryUomId: '',
      weightUomId: value === 'weight' ? '' : current.weightUomId,
    }))
  }

  function setDraftWarehouse(value: string, mode: 'create' | 'edit') {
    const warehouseId = value === 'none' ? '' : value
    const updater = mode === 'create' ? setDraftForm : setEditForm
    updater((current) => ({
      ...current,
      warehouseId,
      binId: '',
    }))
  }

  function setAreaUom(value: string, mode: 'create' | 'edit') {
    const updater = mode === 'create' ? setDraftForm : setEditForm
    updater((current) => ({ ...current, areaUomId: value === 'none' ? '' : value }))
  }

  function draftRpcPayload(form: DraftForm, requestKey?: string) {
    return {
      p_company_id: companyId,
      p_name: form.name.trim(),
      p_batch_family: form.batchFamily,
      p_primary_quantity_basis: form.primaryQuantityBasis,
      p_opening_primary_qty: requiredNumber(form.openingPrimaryQty),
      p_primary_uom_id: form.primaryUomId || null,
      p_start_date: form.startDate || today(),
      p_expected_end_date: form.expectedEndDate || null,
      p_species_text: cleanText(form.speciesText),
      p_purpose: cleanText(form.purpose),
      p_opening_total_weight: optionalNumber(form.openingTotalWeight),
      p_weight_uom_id: form.weightUomId || null,
      p_area: optionalNumber(form.area),
      p_area_uom_id: form.areaUomId || null,
      p_warehouse_id: form.warehouseId || null,
      p_bin_id: form.binId || null,
      p_location_description: cleanText(form.locationDescription),
      p_notes: cleanText(form.notes),
      p_request_key: requestKey,
      p_opening_total_weight_present: form.openingTotalWeight.trim() !== '',
      p_area_present: form.area.trim() !== '',
    }
  }

  function draftFingerprint(form: DraftForm) {
    return stablePostingFingerprint({
      operation: 'growth.batch.create',
      companyId,
      ...draftRpcPayload(form, undefined),
      p_request_key: null,
    })
  }

  function draftUpdatePatch(form: DraftForm) {
    return {
      name: form.name.trim(),
      batch_family: form.batchFamily,
      primary_quantity_basis: form.primaryQuantityBasis,
      opening_primary_qty: requiredNumber(form.openingPrimaryQty),
      primary_uom_id: form.primaryUomId || null,
      start_date: form.startDate || today(),
      expected_end_date: form.expectedEndDate || null,
      species_text: cleanText(form.speciesText),
      purpose: cleanText(form.purpose),
      opening_total_weight: optionalNumber(form.openingTotalWeight),
      weight_uom_id: form.weightUomId || null,
      area: optionalNumber(form.area),
      area_uom_id: form.areaUomId || null,
      warehouse_id: form.warehouseId || null,
      bin_id: form.binId || null,
      location_description: cleanText(form.locationDescription),
      notes: cleanText(form.notes),
    }
  }

  function ensureDraftFormValid(form: DraftForm) {
    const openingQty = requiredNumber(form.openingPrimaryQty)
    if (!form.name.trim()) return tt('productionUx.validation.batchName', 'Enter a batch name.')
    if (!form.primaryUomId) return tt('productionUx.validation.primaryUnit', 'Select a primary unit.')
    if (!Number.isFinite(openingQty) || openingQty <= 0) return tt('productionUx.validation.openingQuantity', 'Opening quantity must be greater than zero.')
    if (form.primaryQuantityBasis === 'count' && openingQty !== Math.trunc(openingQty)) return tt('productionUx.validation.wholeCount', 'Count batches must use whole-number quantities.')
    if (form.openingTotalWeight.trim() && !form.weightUomId) return tt('productionUx.validation.weightUnit', 'Select a weight unit when opening total weight is entered.')
    if (form.area.trim() && !form.areaUomId) return tt('productionUx.validation.areaUnit', 'Select an area unit when area is entered.')
    if (form.expectedEndDate && form.startDate && form.expectedEndDate < form.startDate) return tt('productionUx.validation.endDate', 'Expected end date must be on or after start date.')
    return null
  }

  async function createDraft() {
    if (!companyId) return toast.error(tt('productionUx.companyRequired', 'Select an active company first'))
    if (!canOperate) return toast.error(tt('productionUx.validation.createRole', 'Your role cannot create Growth Batches'))
    const validation = ensureDraftFormValid(draftForm)
    if (validation) return toast.error(validation)

    const fingerprint = draftFingerprint(draftForm)
    const requestKey = getPostingRequestKeyForFingerprint(createRequestRef, fingerprint)
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('create_growth_batch_draft', draftRpcPayload(draftForm, requestKey))
      if (error) throw error
      clearPostingRequestKey(createRequestRef)
      const batchId = (data as { batch_id?: string } | null)?.batch_id
      toast.success(tt('productionUx.growth.draftCreated', 'Growth Batch draft created'))
      setCreateOpen(false)
      setDraftForm(emptyDraftForm())
      await loadBatches()
      if (batchId) setRouteState('detail', batchId)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  function openEditDialog() {
    const batch = detailBatch
    if (!batch) return
    setEditForm({
      name: batch.name,
      batchFamily: batch.batch_family,
      primaryQuantityBasis: batch.primary_quantity_basis,
      openingPrimaryQty: String(batch.opening_primary_qty || ''),
      primaryUomId: batch.primary_uom_id || '',
      startDate: batch.start_date || today(),
      expectedEndDate: batch.expected_end_date || '',
      speciesText: detailRow?.species_text || '',
      purpose: detailRow?.purpose || '',
      openingTotalWeight: batch.opening_total_weight == null ? '' : String(batch.opening_total_weight),
      weightUomId: batch.weight_uom_id || '',
      area: batch.area == null ? '' : String(batch.area),
      areaUomId: batch.area_uom_id || '',
      warehouseId: batch.warehouse_id || '',
      binId: batch.bin_id || '',
      locationDescription: batch.location_description || '',
      notes: detailRow?.notes || '',
    })
    setEditOpen(true)
  }

  async function saveDraft() {
    if (!companyId || !detailBatch) return
    const validation = ensureDraftFormValid(editForm)
    if (validation) return toast.error(validation)
    setSaving(true)
    try {
      const { error } = await supabase.rpc('update_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: detailBatch.id,
        p_patch: draftUpdatePatch(editForm),
      })
      if (error) throw error
      toast.success(tt('productionUx.growth.draftSaved', 'Growth Batch draft saved'))
      setEditOpen(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  async function activateBatch() {
    if (!companyId || !detailBatch) return
    const fingerprint = stablePostingFingerprint({
      operation: 'growth.batch.activate',
      companyId,
      batchId: detailBatch.id,
    })
    const requestKey = getPostingRequestKeyForFingerprint(activateRequestRef, fingerprint)
    setSaving(true)
    try {
      const { error } = await supabase.rpc('activate_growth_batch', {
        p_company_id: companyId,
        p_growth_batch_id: detailBatch.id,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(activateRequestRef)
      toast.success(tt('productionUx.growth.activated', 'Growth Batch activated'))
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  async function cancelDraft() {
    if (!companyId || !detailBatch) return
    const reason = cancelReason.trim()
    if (!reason) return toast.error(tt('productionUx.validation.cancellationReason', 'Enter a cancellation reason.'))
    const fingerprint = stablePostingFingerprint({
      operation: 'growth.batch.cancel',
      companyId,
      batchId: detailBatch.id,
      reason,
    })
    const requestKey = getPostingRequestKeyForFingerprint(cancelRequestRef, fingerprint)
    setSaving(true)
    try {
      const { error } = await supabase.rpc('cancel_growth_batch_draft', {
        p_company_id: companyId,
        p_growth_batch_id: detailBatch.id,
        p_reason: reason,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(cancelRequestRef)
      toast.success(tt('productionUx.growth.draftCancelled', 'Growth Batch draft cancelled'))
      setCancelOpen(false)
      setCancelReason('')
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  async function recordMeasurement() {
    if (!companyId || !detailBatch) return
    const value = requiredNumber(measurementForm.value)
    if (!Number.isFinite(value) || (measurementForm.measurementType !== 'temperature' && value < 0)) {
      return toast.error(measurementForm.measurementType === 'temperature'
        ? tt('productionUx.validation.temperature', 'Enter a valid temperature value.')
        : tt('productionUx.validation.measurementNonNegative', 'Measurement value must be zero or greater.'))
    }
    if (!measurementForm.uomId) return toast.error(tt('productionUx.validation.measurementUnit', 'Select a measurement unit.'))
    const measurementUom = uomById.get(measurementForm.uomId)
    if (measurementForm.measurementType === 'total_weight' || measurementForm.measurementType === 'average_weight') {
      if (!detailBatch.weight_uom_id) return toast.error(tt('productionUx.validation.batchWeightUnit', 'Set a batch weight unit before recording weight measurements.'))
      if (measurementForm.uomId !== detailBatch.weight_uom_id) return toast.error(tt('productionUx.validation.weightMeasurementUnit', 'Weight measurements must use the batch weight unit.'))
    }
    if (measurementForm.measurementType === 'area_observation') {
      if (!detailBatch.area_uom_id) return toast.error(tt('productionUx.validation.batchAreaUnit', 'Set a batch area unit before recording area observations.'))
      if (measurementForm.uomId !== detailBatch.area_uom_id) return toast.error(tt('productionUx.validation.areaMeasurementUnit', 'Area observations must use the batch area unit.'))
    }
    if (measurementForm.measurementType === 'height' && measurementUom?.family !== 'length') {
      return toast.error(tt('productionUx.validation.heightUnit', 'Height measurements must use a length unit.'))
    }
    if (measurementForm.measurementType === 'other' && !measurementForm.description.trim()) {
      return toast.error(tt('productionUx.validation.otherMeasurement', 'Describe the other measurement.'))
    }
    const observedAt = measurementForm.observedAt ? new Date(measurementForm.observedAt).toISOString() : new Date().toISOString()
    const observedDate = measurementForm.observedAt ? measurementForm.observedAt.slice(0, 10) : today()
    if (observedDate < detailBatch.start_date) return toast.error(tt('productionUx.validation.observedAfterStart', 'Observed date must be on or after the batch start date.'))
    if (observedDate > today()) return toast.error(tt('productionUx.validation.observedFuture', 'Observed date cannot be in the future.'))
    const payload = {
      operation: 'growth.batch.measurement',
      companyId,
      batchId: detailBatch.id,
      measurement_type: measurementForm.measurementType,
      value,
      uom_id: measurementForm.uomId,
      observed_at: observedAt,
      sample_size: optionalNumber(measurementForm.sampleSize),
      sample_size_present: measurementForm.sampleSize.trim() !== '',
      minimum: optionalNumber(measurementForm.minimum),
      minimum_present: measurementForm.minimum.trim() !== '',
      maximum: optionalNumber(measurementForm.maximum),
      maximum_present: measurementForm.maximum.trim() !== '',
      average: optionalNumber(measurementForm.average),
      average_present: measurementForm.average.trim() !== '',
      description: cleanText(measurementForm.description),
      notes: cleanText(measurementForm.notes),
    }
    const requestKey = getPostingRequestKeyForFingerprint(measurementRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('record_growth_batch_measurement', {
        p_company_id: companyId,
        p_growth_batch_id: detailBatch.id,
        p_measurement_type: measurementForm.measurementType,
        p_value: value,
        p_uom_id: measurementForm.uomId,
        p_observed_at: observedAt,
        p_sample_size: optionalNumber(measurementForm.sampleSize),
        p_minimum: optionalNumber(measurementForm.minimum),
        p_maximum: optionalNumber(measurementForm.maximum),
        p_average: optionalNumber(measurementForm.average),
        p_description: cleanText(measurementForm.description),
        p_notes: cleanText(measurementForm.notes),
        p_request_key: requestKey,
        p_sample_size_present: measurementForm.sampleSize.trim() !== '',
        p_minimum_present: measurementForm.minimum.trim() !== '',
        p_maximum_present: measurementForm.maximum.trim() !== '',
        p_average_present: measurementForm.average.trim() !== '',
      })
      if (error) throw error
      clearPostingRequestKey(measurementRequestRef)
      toast.success(tt('productionUx.growth.measurementRecorded', 'Measurement recorded'))
      setMeasurementOpen(false)
      setMeasurementForm(emptyMeasurementForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  async function recordDirectCost() {
    if (!companyId || !detailBatch) return
    const amount = requiredNumber(directCostForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) return toast.error(tt('productionUx.validation.directCostAmount', 'Direct cost amount must be greater than zero.'))
    if (!directCostForm.description.trim()) return toast.error(tt('productionUx.validation.directCostDescription', 'Enter a direct cost description.'))
    const eventDate = directCostForm.eventDate || today()
    if (eventDate < detailBatch.start_date) return toast.error(tt('productionUx.validation.directCostAfterStart', 'Direct cost date must be on or after the batch start date.'))
    if (eventDate > today()) return toast.error(tt('productionUx.validation.directCostFuture', 'Direct cost date cannot be in the future.'))
    const payload = {
      operation: 'growth.batch.cost',
      companyId,
      batchId: detailBatch.id,
      category: directCostForm.category,
      description: directCostForm.description.trim(),
      amount,
      event_date: eventDate,
      notes: cleanText(directCostForm.notes),
    }
    const requestKey = getPostingRequestKeyForFingerprint(directCostRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('record_growth_batch_direct_cost', {
        p_company_id: companyId,
        p_growth_batch_id: detailBatch.id,
        p_category: directCostForm.category,
        p_description: directCostForm.description.trim(),
        p_amount: amount,
        p_event_date: eventDate,
        p_notes: cleanText(directCostForm.notes),
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(directCostRequestRef)
      toast.success(tt('productionUx.growth.directCostRecorded', 'Direct cost recorded'))
      setDirectCostOpen(false)
      setDirectCostForm(emptyDirectCostForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  function markStockInputPreviewStale() {
    setStockInputPreviewStale(true)
  }

  function updateStockInputLine(clientId: string, patch: Partial<StockInputLineForm>) {
    markStockInputPreviewStale()
    setStockInputForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (
        line.clientId === clientId
          ? {
              ...line,
              ...patch,
              sourceBinId: patch.sourceWarehouseId !== undefined ? '' : patch.sourceBinId ?? line.sourceBinId,
            }
          : line
      )),
    }))
  }

  function addStockInputLine() {
    markStockInputPreviewStale()
    setStockInputForm((current) => ({ ...current, lines: [...current.lines, emptyStockInputLine()] }))
  }

  function removeStockInputLine(clientId: string) {
    markStockInputPreviewStale()
    setStockInputForm((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.clientId !== clientId) : current.lines,
    }))
  }

  function stockInputPayloadLines() {
    return stockInputForm.lines.map((line) => {
      const item = itemById.get(line.itemId)
      return {
        item_id: line.itemId || null,
        uom_id: item?.base_uom_id || null,
        quantity: optionalNumber(line.quantity),
        source_warehouse_id: line.sourceWarehouseId || null,
        source_bin_id: line.sourceBinId || null,
        line_notes: cleanText(line.lineNotes),
      }
    })
  }

  function validateStockInputForm() {
    if (!detailBatch || detailBatch.status !== 'active') return tt('productionUx.validation.stockInputActive', 'Stock inputs can only be posted to active Growth Batches.')
    if (!stockInputForm.effectiveDate) return tt('productionUx.validation.stockInputDate', 'Select a stock input date.')
    if (stockInputForm.effectiveDate < detailBatch.start_date) return tt('productionUx.validation.stockInputAfterStart', 'Stock input date must be on or after the batch start date.')
    if (stockInputForm.effectiveDate > today()) return tt('productionUx.validation.stockInputFuture', 'Stock input date cannot be in the future.')
    const bucketKeys = new Set<string>()
    for (const line of stockInputForm.lines) {
      const item = itemById.get(line.itemId)
      const quantity = requiredNumber(line.quantity)
      if (!item) return tt('productionUx.validation.stockItemEachLine', 'Select a stock-tracked item for every line.')
      if (!item.base_uom_id) return tt('productionUx.validation.stockItemBaseUnit', 'Selected stock items must have a base unit.')
      if (!Number.isFinite(quantity) || quantity <= 0) return tt('productionUx.validation.stockInputQuantity', 'Stock input quantities must be greater than zero.')
      if (!line.sourceWarehouseId || !line.sourceBinId) return tt('productionUx.validation.stockInputSourceEachLine', 'Select a source warehouse and bin for every line.')
      const key = `${line.itemId}|${line.sourceWarehouseId}|${line.sourceBinId}`
      if (bucketKeys.has(key)) return tt('productionUx.validation.stockInputDuplicate', 'Combine duplicate stock input lines that use the same item, warehouse, and bin.')
      bucketKeys.add(key)
    }
    return null
  }

  async function previewStockInput() {
    if (!detailBatch) return
    const validation = validateStockInputForm()
    if (validation) return toast.error(validation)
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('preview_growth_batch_stock_input', {
        p_batch_id: detailBatch.id,
        p_effective_date: stockInputForm.effectiveDate,
        p_lines: stockInputPayloadLines(),
        p_notes: cleanText(stockInputForm.notes),
      })
      if (error) throw error
      const preview = data as StockInputPreview
      setStockInputPreview(preview)
      setStockInputPreviewStale(false)
      if (preview.ready) {
        toast.success(tt('productionUx.growth.stockInputPreviewReady', 'Stock input preview is ready'))
      } else {
        toast.error(tt('productionUx.validation.stockInputBlockers', 'Preview found blockers. Review the line details before posting.'))
      }
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  async function postStockInput() {
    if (!detailBatch) return
    const validation = validateStockInputForm()
    if (validation) return toast.error(validation)
    if (!stockInputPreview || stockInputPreviewStale) return toast.error(tt('productionUx.validation.stockInputPreviewRequired', 'Preview the current stock input before posting.'))
    if (!stockInputPreview.ready) return toast.error(tt('productionUx.validation.stockInputResolveBlockers', 'Resolve preview blockers before posting stock input.'))
    const payload = {
      operation: 'growth.batch.input',
      batchId: detailBatch.id,
      effectiveDate: stockInputForm.effectiveDate,
      notes: cleanText(stockInputForm.notes),
      lines: stockInputPayloadLines(),
    }
    const requestKey = getPostingRequestKeyForFingerprint(stockInputRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('post_growth_batch_stock_input', {
        p_batch_id: detailBatch.id,
        p_effective_date: stockInputForm.effectiveDate,
        p_lines: stockInputPayloadLines(),
        p_notes: cleanText(stockInputForm.notes),
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(stockInputRequestRef)
      toast.success(tt('productionUx.growth.stockInputPosted', 'Stock input posted'))
      setStockInputOpen(false)
      setStockInputForm(emptyStockInputForm())
      setStockInputPreview(null)
      setStockInputPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  function openStockInputDialog() {
    setStockInputForm(emptyStockInputForm())
    setStockInputPreview(null)
    setStockInputPreviewStale(false)
    setStockInputOpen(true)
  }

  function openReversalDialog(row: GrowthBatchStockInputRow) {
    setReversalForm({
      eventId: row.event_id,
      eventReference: row.event_reference,
      effectiveDate: today(),
      reason: '',
      confirmation: '',
    })
    setReversalOpen(true)
  }

  async function reverseStockInput() {
    if (!detailBatch) return
    if (!reversalForm.eventId) return
    if (!reversalForm.reason.trim()) return toast.error(tt('productionUx.validation.reversalReason', 'Enter a reversal reason.'))
    if (reversalForm.confirmation.trim() !== reversalForm.eventReference) {
      return toast.error(`${tt('productionUx.validation.stockInputConfirm', 'Type the event reference to confirm the stock-input reversal')}: ${reversalForm.eventReference}.`)
    }
    const payload = {
      operation: 'growth.batch.input.reverse',
      originalEventId: reversalForm.eventId,
      effectiveDate: reversalForm.effectiveDate,
      reason: reversalForm.reason.trim(),
    }
    const requestKey = getPostingRequestKeyForFingerprint(stockInputReversalRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_growth_batch_stock_input', {
        p_original_event_id: reversalForm.eventId,
        p_effective_date: reversalForm.effectiveDate,
        p_reason: reversalForm.reason.trim(),
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(stockInputReversalRequestRef)
      toast.success(tt('productionUx.growth.stockInputReversed', 'Stock input reversed'))
      setReversalOpen(false)
      setReversalForm(emptyReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  function markLossPreviewStale() {
    setLossPreviewStale(true)
  }

  function setLossType(value: LossType) {
    const nextReasons = value === 'mortality' ? mortalityReasons : shrinkageReasons
    markLossPreviewStale()
    setLossForm((current) => ({
      ...current,
      lossType: value,
      reasonCode: nextReasons[0],
    }))
  }

  function lossNumericValue(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : NaN
  }

  function validateLossForm() {
    if (!detailBatch || detailBatch.status !== 'active') return tt('productionUx.validation.lossActive', 'Losses can only be recorded on active Growth Batches.')
    if (!lossForm.effectiveDate) return tt('productionUx.validation.effectiveDate', 'Select an effective date.')
    if (lossForm.effectiveDate < detailBatch.start_date) return tt('productionUx.validation.lossAfterStart', 'Loss date must be on or after the batch start date.')
    if (lossForm.effectiveDate > today()) return tt('productionUx.validation.lossFuture', 'Loss date cannot be in the future.')
    if (!lossForm.reasonCode) return tt('productionUx.validation.lossReason', 'Select a loss reason.')
    if (!lossReasonOptions.includes(lossForm.reasonCode)) return tt('productionUx.validation.lossReasonValid', 'Select a valid reason for this loss type.')
    if (lossForm.reasonCode === 'other' && !lossForm.notes.trim()) return tt('productionUx.validation.lossOtherNotes', 'Add notes when the reason is Other.')

    const quantityLost = lossNumericValue(lossForm.quantityLost)
    const weightLost = lossNumericValue(lossForm.weightLost)
    if (Number.isNaN(quantityLost) || Number.isNaN(weightLost)) return tt('productionUx.validation.lossNumbers', 'Enter valid loss numbers.')
    if ((quantityLost ?? 0) < 0 || (weightLost ?? 0) < 0) return tt('productionUx.validation.lossNonNegative', 'Loss values cannot be negative.')
    if ((quantityLost ?? 0) <= 0 && (weightLost ?? 0) <= 0) return tt('productionUx.validation.lossValue', 'Enter a quantity loss, weight loss, or both.')
    if (quantityLost != null && quantityLost > 0) {
      const currentQuantity = num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)
      if (detailBatch.primary_quantity_basis === 'count' && quantityLost !== Math.trunc(quantityLost)) return tt('productionUx.validation.lossWholeCount', 'Count-basis losses must use whole-number quantities.')
      if (quantityLost > currentQuantity) return tt('productionUx.validation.lossQuantityExceeds', 'The loss quantity cannot exceed the current batch quantity.')
    }
    if (weightLost != null && weightLost > 0) {
      if (!detailBatch.weight_uom_id || detailBatch.latest_total_weight == null) return tt('productionUx.validation.lossCurrentWeight', 'Record or configure a current total weight before entering weight loss.')
      if (weightLost > num(detailBatch.latest_total_weight)) return tt('productionUx.validation.lossWeightExceeds', 'The loss weight cannot exceed the current total weight.')
    }
    return null
  }

  function lossPayload() {
    return {
      p_growth_batch_id: detailBatch?.id,
      p_loss_type: lossForm.lossType,
      p_effective_date: lossForm.effectiveDate,
      p_quantity_lost: lossNumericValue(lossForm.quantityLost),
      p_weight_lost: lossNumericValue(lossForm.weightLost),
      p_reason_code: lossForm.reasonCode,
      p_notes: cleanText(lossForm.notes),
    }
  }

  async function previewLoss() {
    if (!detailBatch) return
    const validation = validateLossForm()
    if (validation) return toast.error(validation)
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('preview_growth_batch_loss', lossPayload())
      if (error) throw error
      const preview = data as LossPreview
      setLossPreview(preview)
      setLossPreviewStale(false)
      if (preview.ready) {
        toast.success(tt('productionUx.growth.lossPreviewReady', 'Loss preview is ready'))
      } else {
        toast.error(tt('productionUx.validation.lossBlockers', 'Preview found blockers. Review the loss values before recording.'))
      }
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  async function recordLoss() {
    if (!detailBatch) return
    const validation = validateLossForm()
    if (validation) return toast.error(validation)
    if (!lossPreview || lossPreviewStale) return toast.error(tt('productionUx.validation.lossPreviewRequired', 'Preview the current loss before recording.'))
    if (!lossPreview.ready) return toast.error(tt('productionUx.validation.lossResolveBlockers', 'Resolve preview blockers before recording the loss.'))
    const payload = {
      operation: lossForm.lossType === 'mortality' ? 'growth.batch.mortality' : 'growth.batch.shrinkage',
      batchId: detailBatch.id,
      effectiveDate: lossForm.effectiveDate,
      lossType: lossForm.lossType,
      quantityLost: lossNumericValue(lossForm.quantityLost),
      weightLost: lossNumericValue(lossForm.weightLost),
      reasonCode: lossForm.reasonCode,
      notes: cleanText(lossForm.notes),
    }
    const requestKey = getPostingRequestKeyForFingerprint(lossRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('record_growth_batch_loss', {
        ...lossPayload(),
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(lossRequestRef)
      toast.success(tt('productionUx.growth.lossRecorded', '{type} recorded').replace('{type}', domainLabel(lossForm.lossType)))
      setLossOpen(false)
      setLossForm(emptyLossForm())
      setLossPreview(null)
      setLossPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  function openLossDialog() {
    setLossForm(emptyLossForm())
    setLossPreview(null)
    setLossPreviewStale(false)
    setLossOpen(true)
  }

  function openLossReversalDialog(row: GrowthBatchLossRow) {
    setLossReversalForm({
      eventId: row.event_id,
      eventReference: row.event_reference,
      lossType: row.loss_type,
      reason: '',
    })
    setLossReversalOpen(true)
  }

  async function reverseLoss() {
    if (!detailBatch) return
    if (!lossReversalForm.eventId) return
    if (!lossReversalForm.reason.trim()) return toast.error(tt('productionUx.validation.reversalReason', 'Enter a reversal reason.'))
    const payload = {
      operation: lossReversalForm.lossType === 'mortality' ? 'growth.batch.mortality.reverse' : 'growth.batch.shrinkage.reverse',
      originalEventId: lossReversalForm.eventId,
      reason: lossReversalForm.reason.trim(),
    }
    const requestKey = getPostingRequestKeyForFingerprint(lossReversalRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_growth_batch_loss', {
        p_event_id: lossReversalForm.eventId,
        p_reason: lossReversalForm.reason.trim(),
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(lossReversalRequestRef)
      toast.success(tt('productionUx.growth.lossReversed', '{type} reversed').replace('{type}', domainLabel(lossReversalForm.lossType)))
      setLossReversalOpen(false)
      setLossReversalForm(emptyLossReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error))
    } finally {
      setSaving(false)
    }
  }

  function markTransferPreviewStale() {
    setTransferPreviewStale(true)
  }

  function setTransferWarehouse(value: string) {
    markTransferPreviewStale()
    setTransferForm((current) => ({
      ...current,
      destinationWarehouseId: value === 'none' ? '' : value,
      destinationBinId: '',
    }))
  }

  function transferSourceLocationLabel(batch = detailBatch) {
    if (!batch) return transferCopy.fallback.notSet
    return locationDisplay([batch.warehouse_name, batch.bin_code, batch.bin_name, batch.location_description])
  }

  function transferHistoryLocationLabel(row: GrowthBatchTransferRow, side: 'source' | 'destination') {
    return side === 'source'
      ? locationDisplay([row.source_warehouse_name, row.source_bin_code, row.source_bin_name, row.source_location_description])
      : locationDisplay([row.destination_warehouse_name, row.destination_bin_code, row.destination_bin_name, row.destination_location_description])
  }

  function transferPreviewLocationLabel(location: TransferLocationPreview | null | undefined) {
    if (!location) return transferCopy.fallback.notSet
    return locationDisplay([location.warehouse_name, location.warehouse_code, location.bin_code, location.bin_name, location.location_description])
  }

  function transferReasonLabel(reason: TransferReasonCode | null | undefined) {
    return reason ? transferCopy.reasonLabels[reason] : transferCopy.fallback.notSet
  }

  function transferBlockerLabel(code: string | null | undefined) {
    if (!code) return transferCopy.preview.blockers
    return isGrowthBatchTransferBlockerCode(code) ? transferCopy.blockerLabels[code] : labelize(code)
  }

  const growthBatchEventTypeLabel = useCallback((eventType: GrowthBatchEventRow['event_type'] | string | null | undefined) => {
    if (eventType === 'transfer') return transferCopy.history.transferBadge
    if (eventType === 'transfer_reversal') return transferCopy.history.transferReversalBadge
    if (eventType === 'harvest') return harvestCopy.history.harvestBadge
    if (eventType === 'harvest_reversal') return harvestCopy.history.harvestReversalBadge
    if (eventType === 'completion') return completionCopy.history.completionBadge
    if (eventType === 'completion_reversal') return completionCopy.history.reversalBadge
    return eventType ? domainLabel(eventType) : tt('productionUx.growth.createdAt', 'Created')
  }, [completionCopy, harvestCopy, lang, t, transferCopy])

  function transferUnavailableReason() {
    if (!detailBatch || detailBatch.status !== 'active') return transferCopy.errors.unavailableActive
    if (!detailBatch.warehouse_id) return transferCopy.errors.sourceRequired
    if (num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) <= 0) return transferCopy.errors.quantityRequired
    if (!activeWarehouses.length) return transferCopy.errors.destinationSetupRequired
    return null
  }

  function validateTransferForm() {
    const unavailable = transferUnavailableReason()
    if (unavailable) return unavailable
    if (!detailBatch) return transferCopy.errors.selectBatch
    if (!transferForm.effectiveDate) return transferCopy.errors.effectiveDateRequired
    if (transferForm.effectiveDate < detailBatch.start_date) return transferCopy.errors.dateBeforeStart
    if (transferForm.effectiveDate > today()) return transferCopy.errors.dateFuture
    if (!transferForm.destinationWarehouseId) return transferCopy.errors.destinationRequired
    if (!activeWarehouses.some((warehouse) => warehouse.id === transferForm.destinationWarehouseId)) return transferCopy.errors.destinationInactive
    if (transferForm.destinationBinId && !binsForTransfer.some((bin) => bin.id === transferForm.destinationBinId)) return transferCopy.errors.binInactive
    if (!transferForm.reasonCode) return transferCopy.errors.purposeRequired
    if (!transferReasons.includes(transferForm.reasonCode)) return transferCopy.errors.purposeInvalid
    if (transferForm.reasonCode === 'other' && !transferForm.notes.trim()) return transferCopy.errors.otherNotesRequired
    const normalizedDescription = cleanText(transferForm.locationDescription)
    const sameWarehouse = detailBatch.warehouse_id === transferForm.destinationWarehouseId
    const sameBin = (detailBatch.bin_id || '') === (transferForm.destinationBinId || '')
    const sameDescription = (detailBatch.location_description || '').trim() === (normalizedDescription || '')
    if (sameWarehouse && sameBin && sameDescription) return transferCopy.errors.sameLocation
    return null
  }

  function transferPayload() {
    return {
      p_growth_batch_id: detailBatch?.id,
      p_destination_warehouse_id: transferForm.destinationWarehouseId || null,
      p_destination_bin_id: transferForm.destinationBinId || null,
      p_location_description: cleanText(transferForm.locationDescription),
      p_effective_date: transferForm.effectiveDate,
      p_transfer_reason: transferForm.reasonCode || null,
      p_notes: cleanText(transferForm.notes),
    }
  }

  async function previewTransfer() {
    if (!detailBatch) return
    const validation = validateTransferForm()
    if (validation) return toast.error(validation)
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('preview_growth_batch_transfer', transferPayload())
      if (error) throw error
      const preview = data as TransferPreview
      setTransferPreview(preview)
      setTransferPreviewStale(false)
      if (preview.ready) {
        toast.success(transferCopy.preview.readyToast)
      } else {
        toast.error(transferCopy.preview.blockersToast)
      }
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, transferCopy))
    } finally {
      setSaving(false)
    }
  }

  async function postTransfer() {
    if (!detailBatch) return
    const validation = validateTransferForm()
    if (validation) return toast.error(validation)
    if (!transferPreview || transferPreviewStale) return toast.error(transferCopy.errors.previewRequired)
    if (!transferPreview.ready) return toast.error(transferCopy.errors.previewBlockers)
    if (!transferPreview.source_location_fingerprint) return toast.error(transferCopy.errors.previewRefreshRequired)
    const payload = {
      operation: 'growth.batch.transfer',
      batchId: detailBatch.id,
      destinationWarehouseId: transferForm.destinationWarehouseId,
      destinationBinId: transferForm.destinationBinId || null,
      locationDescription: cleanText(transferForm.locationDescription),
      effectiveDate: transferForm.effectiveDate,
      reasonCode: transferForm.reasonCode,
      notes: cleanText(transferForm.notes),
      expectedSourceFingerprint: transferPreview.source_location_fingerprint,
    }
    const requestKey = getPostingRequestKeyForFingerprint(transferRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('transfer_growth_batch', {
        ...transferPayload(),
        p_expected_source_fingerprint: transferPreview.source_location_fingerprint,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(transferRequestRef)
      toast.success(transferCopy.success.transferred)
      setTransferOpen(false)
      setTransferForm(emptyTransferForm())
      setTransferPreview(null)
      setTransferPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, transferCopy))
    } finally {
      setSaving(false)
    }
  }

  function openTransferDialog() {
    setTransferForm(emptyTransferForm())
    setTransferPreview(null)
    setTransferPreviewStale(false)
    setTransferOpen(true)
  }

  function openTransferReversalDialog(row: GrowthBatchTransferRow) {
    setTransferReversalForm({
      eventId: row.event_id,
      eventReference: row.event_reference,
      effectiveDate: today(),
      expectedCurrentLocationFingerprint: row.current_location_fingerprint || '',
      reason: '',
    })
    setTransferReversalOpen(true)
  }

  async function reverseTransfer() {
    if (!detailBatch) return
    if (!transferReversalForm.eventId) return
    if (!transferReversalForm.reason.trim()) return toast.error(transferCopy.errors.reversalReasonRequired)
    if (!transferReversalForm.expectedCurrentLocationFingerprint) return toast.error(transferCopy.errors.historyRefreshRequired)
    const payload = {
      operation: 'growth.batch.transfer.reverse',
      batchId: detailBatch.id,
      originalEventId: transferReversalForm.eventId,
      effectiveDate: transferReversalForm.effectiveDate,
      reason: transferReversalForm.reason.trim(),
      expectedCurrentLocationFingerprint: transferReversalForm.expectedCurrentLocationFingerprint,
    }
    const requestKey = getPostingRequestKeyForFingerprint(transferReversalRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_growth_batch_transfer', {
        p_growth_batch_id: detailBatch.id,
        p_original_event_id: transferReversalForm.eventId,
        p_effective_date: transferReversalForm.effectiveDate,
        p_reason: transferReversalForm.reason.trim(),
        p_expected_current_location_fingerprint: transferReversalForm.expectedCurrentLocationFingerprint,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(transferReversalRequestRef)
      toast.success(transferCopy.success.reversed)
      setTransferReversalOpen(false)
      setTransferReversalForm(emptyTransferReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, transferCopy))
    } finally {
      setSaving(false)
    }
  }

  function markHarvestPreviewStale() {
    setHarvestPreviewStale(true)
  }

  function setHarvestWarehouse(value: string) {
    markHarvestPreviewStale()
    setHarvestForm((current) => ({
      ...current,
      destinationWarehouseId: value === 'none' ? '' : value,
      destinationBinId: '',
    }))
  }

  function harvestLocationLabel(location: HarvestLocationPreview | null | undefined) {
    if (!location) return harvestCopy.fallback.notSet
    return locationDisplay([location.warehouse_name, location.warehouse_code, location.bin_code, location.bin_name, location.location_description])
  }

  function harvestHistoryLocationLabel(row: GrowthBatchHarvestRow, side: 'source' | 'destination') {
    return side === 'source'
      ? locationDisplay([row.source_warehouse_name, row.source_warehouse_code, row.source_bin_code, row.source_bin_name, row.source_location_description])
      : locationDisplay([row.destination_warehouse_name, row.destination_warehouse_code, row.destination_bin_code, row.destination_bin_name])
  }

  function harvestKindLabel(kind: HarvestKind | string | null | undefined) {
    if (kind === 'full') return harvestCopy.history.full
    if (kind === 'partial') return harvestCopy.history.partial
    return kind ? domainLabel(kind) : harvestCopy.fallback.notSet
  }

  function harvestBlockerLabel(code: string | null | undefined) {
    if (!code) return harvestCopy.preview.blockers
    return isGrowthBatchHarvestBlockerCode(code) ? harvestCopy.blockerLabels[code] : labelize(code)
  }

  function completionBlockerLabel(code: string | null | undefined) {
    if (!code) return completionCopy.preview.blockers
    return isGrowthBatchCompletionBlockerCode(code) ? completionCopy.blockerLabels[code] : labelize(code)
  }

  function harvestUnavailableReason() {
    if (!detailBatch || detailBatch.status !== 'active') return harvestCopy.errors.unavailableActive
    if (num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) <= 0) return harvestCopy.errors.quantityRequired
    if (!harvestOutputItems.length) return harvestCopy.errors.outputSetupRequired
    if (!activeWarehouses.length) return harvestCopy.errors.destinationSetupRequired
    return null
  }

  function validateHarvestForm() {
    const unavailable = harvestUnavailableReason()
    if (unavailable) return unavailable
    if (!detailBatch) return harvestCopy.errors.selectBatch
    if (!harvestForm.effectiveDate) return harvestCopy.errors.effectiveDateRequired
    if (harvestForm.effectiveDate < detailBatch.start_date) return harvestCopy.errors.dateBeforeStart
    if (harvestForm.effectiveDate > today()) return harvestCopy.errors.dateFuture
    const harvestedQty = Number(harvestForm.harvestedPrimaryQty)
    if (!Number.isFinite(harvestedQty) || harvestedQty <= 0) return harvestCopy.blockerLabels.growth_batch_harvest_quantity_required
    if (harvestedQty > num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)) return harvestCopy.blockerLabels.growth_batch_harvest_quantity_exceeds_current
    if (detailBatch.primary_quantity_basis === 'count' && harvestedQty !== Math.trunc(harvestedQty)) return harvestCopy.blockerLabels.fractional_count_not_allowed
    if (detailBatch.latest_total_weight != null) {
      const harvestedWeight = Number(harvestForm.harvestedWeight)
      if (!Number.isFinite(harvestedWeight) || harvestedWeight <= 0) return harvestCopy.errors.weightRequired
    }
    if (!harvestForm.outputItemId || !selectedHarvestOutputItem) return harvestCopy.errors.outputItemRequired
    const outputQty = Number(harvestForm.outputQuantity)
    if (!Number.isFinite(outputQty) || outputQty <= 0) return harvestCopy.errors.outputQuantityRequired
    if (!harvestForm.destinationWarehouseId) return harvestCopy.errors.destinationRequired
    if (!activeWarehouses.some((warehouse) => warehouse.id === harvestForm.destinationWarehouseId)) return harvestCopy.errors.destinationInactive
    if (harvestForm.destinationBinId && !binsForHarvest.some((bin) => bin.id === harvestForm.destinationBinId)) return harvestCopy.errors.binInactive
    return null
  }

  function harvestPayload() {
    const harvestedWeight = harvestForm.harvestedWeight.trim() ? Number(harvestForm.harvestedWeight) : null
    return {
      p_growth_batch_id: detailBatch?.id,
      p_effective_date: harvestForm.effectiveDate,
      p_harvested_primary_qty: harvestForm.harvestedPrimaryQty.trim() ? Number(harvestForm.harvestedPrimaryQty) : null,
      p_harvested_total_weight: harvestedWeight,
      p_output_item_id: harvestForm.outputItemId || null,
      p_output_quantity: harvestForm.outputQuantity.trim() ? Number(harvestForm.outputQuantity) : null,
      p_destination_warehouse_id: harvestForm.destinationWarehouseId || null,
      p_destination_bin_id: harvestForm.destinationBinId || null,
      p_notes: cleanText(harvestForm.notes),
    }
  }

  async function previewHarvest() {
    if (!detailBatch) return
    const validation = validateHarvestForm()
    if (validation) return toast.error(validation)
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('preview_growth_batch_harvest', harvestPayload())
      if (error) throw error
      const preview = data as HarvestPreview
      setHarvestPreview(preview)
      setHarvestPreviewStale(false)
      if (preview.ready) {
        toast.success(harvestCopy.preview.readyToast)
      } else {
        toast.error(harvestCopy.preview.blockersToast)
      }
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, undefined, harvestCopy))
    } finally {
      setSaving(false)
    }
  }

  async function postHarvest() {
    if (!detailBatch) return
    const validation = validateHarvestForm()
    if (validation) return toast.error(validation)
    if (!harvestPreview || harvestPreviewStale) return toast.error(harvestCopy.errors.previewRequired)
    if (!harvestPreview.ready) return toast.error(harvestCopy.errors.previewBlockers)
    if (!harvestPreview.source_fingerprint) return toast.error(harvestCopy.errors.previewRefreshRequired)
    const payload = {
      operation: 'growth.batch.harvest',
      batchId: detailBatch.id,
      effectiveDate: harvestForm.effectiveDate,
      harvestedPrimaryQty: Number(harvestForm.harvestedPrimaryQty),
      harvestedWeight: harvestForm.harvestedWeight.trim() ? Number(harvestForm.harvestedWeight) : null,
      outputItemId: harvestForm.outputItemId,
      outputQuantity: Number(harvestForm.outputQuantity),
      destinationWarehouseId: harvestForm.destinationWarehouseId,
      destinationBinId: harvestForm.destinationBinId || null,
      notes: cleanText(harvestForm.notes),
      expectedSourceFingerprint: harvestPreview.source_fingerprint,
    }
    const requestKey = getPostingRequestKeyForFingerprint(harvestRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('post_growth_batch_harvest', {
        ...harvestPayload(),
        p_expected_source_fingerprint: harvestPreview.source_fingerprint,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(harvestRequestRef)
      toast.success(harvestCopy.success.harvested)
      setHarvestOpen(false)
      setHarvestForm(emptyHarvestForm())
      setHarvestPreview(null)
      setHarvestPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, undefined, harvestCopy))
    } finally {
      setSaving(false)
    }
  }

  function openHarvestDialog() {
    const next = emptyHarvestForm()
    next.outputItemId = harvestOutputItems[0]?.id || ''
    next.destinationWarehouseId = activeWarehouses[0]?.id || ''
    setHarvestForm(next)
    setHarvestPreview(null)
    setHarvestPreviewStale(false)
    setHarvestOpen(true)
  }

  function fillHarvestAllRemaining() {
    if (!detailBatch) return
    markHarvestPreviewStale()
    setHarvestForm((current) => ({
      ...current,
      harvestedPrimaryQty: String(num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)),
      harvestedWeight: detailBatch.latest_total_weight == null ? '' : String(num(detailBatch.latest_total_weight)),
    }))
  }

  function openHarvestReversalDialog(row: GrowthBatchHarvestRow) {
    setHarvestReversalForm({
      eventId: row.event_id,
      eventReference: row.event_reference,
      effectiveDate: today(),
      reason: '',
    })
    setHarvestReversalOpen(true)
  }

  async function reverseHarvest() {
    if (!detailBatch) return
    if (!harvestReversalForm.eventId) return
    if (!harvestReversalForm.reason.trim()) return toast.error(harvestCopy.errors.reversalReasonRequired)
    const payload = {
      operation: 'growth.batch.harvest.reverse',
      batchId: detailBatch.id,
      originalEventId: harvestReversalForm.eventId,
      effectiveDate: harvestReversalForm.effectiveDate,
      reason: harvestReversalForm.reason.trim(),
    }
    const requestKey = getPostingRequestKeyForFingerprint(harvestReversalRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_growth_batch_harvest', {
        p_original_event_id: harvestReversalForm.eventId,
        p_effective_date: harvestReversalForm.effectiveDate,
        p_reason: harvestReversalForm.reason.trim(),
        p_expected_source_fingerprint: null,
        p_request_key: requestKey,
      })
      if (error) throw error
      clearPostingRequestKey(harvestReversalRequestRef)
      toast.success(harvestCopy.success.reversed)
      setHarvestReversalOpen(false)
      setHarvestReversalForm(emptyHarvestReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, undefined, harvestCopy))
    } finally {
      setSaving(false)
    }
  }

  function markCompletionPreviewStale() {
    setCompletionPreviewStale(true)
  }

  function completionUnavailableReason() {
    if (!detailBatch) return completionCopy.errors.selectBatch
    if (!canManage) return completionCopy.errors.managerRequired
    if (detailBatch.status !== 'active') return completionCopy.errors.unavailableActive
    if (num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) !== 0) return completionCopy.errors.notReady
    if (detailBatch.latest_total_weight != null && num(detailBatch.latest_total_weight) !== 0) return completionCopy.errors.notReady
    if (num(detailBatch.remaining_cost) !== 0) return completionCopy.errors.notReady
    return null
  }

  function validateCompletionForm() {
    const unavailable = completionUnavailableReason()
    if (unavailable) return unavailable
    if (!detailBatch) return completionCopy.errors.selectBatch
    if (!completionForm.effectiveDate) return completionCopy.errors.effectiveDateRequired
    if (completionForm.effectiveDate < detailBatch.start_date) return completionCopy.errors.dateBeforeStart
    if (completionForm.effectiveDate > today()) return completionCopy.errors.dateFuture
    if (!completionForm.reason.trim()) return completionCopy.errors.reasonRequired
    return null
  }

  function completionPayload() {
    return {
      p_growth_batch_id: detailBatch?.id,
      p_effective_date: completionForm.effectiveDate,
    }
  }

  async function previewCompletion() {
    if (!detailBatch) return
    const validation = validateCompletionForm()
    if (validation) return toast.error(validation)
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('preview_growth_batch_completion', completionPayload())
      if (error) throw error
      const preview = data as CompletionPreview
      setCompletionPreview(preview)
      setCompletionPreviewStale(false)
      if (preview.ready) {
        toast.success(completionCopy.preview.readyToast)
      } else {
        toast.error(completionCopy.preview.blockersToast)
      }
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, undefined, undefined, completionCopy))
    } finally {
      setSaving(false)
    }
  }

  async function completeBatch() {
    if (!detailBatch) return
    const validation = validateCompletionForm()
    if (validation) return toast.error(validation)
    if (!completionPreview || completionPreviewStale) return toast.error(completionCopy.errors.previewRequired)
    if (!completionPreview.ready) return toast.error(completionCopy.errors.previewBlockers)
    if (!completionPreview.source_fingerprint) return toast.error(completionCopy.errors.previewRefreshRequired)
    const payload = {
      operation: 'growth.batch.complete',
      batchId: detailBatch.id,
      effectiveDate: completionForm.effectiveDate,
      reason: completionForm.reason.trim(),
      notes: cleanText(completionForm.notes),
      previewFingerprint: completionPreview.source_fingerprint,
    }
    const requestKey = getPostingRequestKeyForFingerprint(completionRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('complete_growth_batch', {
        p_growth_batch_id: detailBatch.id,
        p_request_key: requestKey,
        p_preview_fingerprint: completionPreview.source_fingerprint,
        p_effective_date: completionForm.effectiveDate,
        p_completion_reason: completionForm.reason.trim(),
        p_notes: cleanText(completionForm.notes),
      })
      if (error) throw error
      clearPostingRequestKey(completionRequestRef)
      toast.success(completionCopy.success.completed)
      setCompletionOpen(false)
      setCompletionForm(emptyCompletionForm())
      setCompletionPreview(null)
      setCompletionPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, undefined, undefined, completionCopy))
    } finally {
      setSaving(false)
    }
  }

  function openCompletionDialog() {
    setCompletionForm(emptyCompletionForm())
    setCompletionPreview(null)
    setCompletionPreviewStale(false)
    setCompletionOpen(true)
  }

  function openCompletionReversalDialog(row: GrowthBatchCompletionRow) {
    setCompletionReversalForm({
      eventId: row.event_id,
      eventReference: row.event_reference,
      effectiveDate: today(),
      reason: '',
    })
    setCompletionReversalOpen(true)
  }

  async function reverseCompletion() {
    if (!detailBatch) return
    if (!canManage) return toast.error(completionCopy.errors.managerRequired)
    if (!completionReversalForm.eventId) return toast.error(completionCopy.errors.historyRefreshRequired)
    if (!completionReversalForm.reason.trim()) return toast.error(completionCopy.errors.reversalReasonRequired)
    const payload = {
      operation: 'growth.batch.complete.reverse',
      batchId: detailBatch.id,
      originalEventId: completionReversalForm.eventId,
      effectiveDate: completionReversalForm.effectiveDate,
      reason: completionReversalForm.reason.trim(),
    }
    const requestKey = getPostingRequestKeyForFingerprint(completionReversalRequestRef, stablePostingFingerprint(payload))
    setSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_growth_batch_completion', {
        p_original_event_id: completionReversalForm.eventId,
        p_request_key: requestKey,
        p_reason: completionReversalForm.reason.trim(),
        p_effective_date: completionReversalForm.effectiveDate,
      })
      if (error) throw error
      clearPostingRequestKey(completionReversalRequestRef)
      toast.success(completionCopy.success.reversed)
      setCompletionReversalOpen(false)
      setCompletionReversalForm(emptyCompletionReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(growthError(error, undefined, undefined, completionCopy))
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<PremiumDataTableColumn<GrowthBatchRegisterRow>[]>(() => [
    {
      id: 'reference',
      header: tt('productionUx.growth.batch', 'Batch'),
      cell: (batch) => (
        <button
          type="button"
          onClick={() => setRouteState('detail', batch.id)}
          className="max-w-[15rem] text-left font-semibold text-primary hover:underline"
        >
          <span className="block truncate">{batch.reference_no}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{batch.name}</span>
        </button>
      ),
      sortValue: (batch) => batch.reference_no,
      minWidth: 180,
    },
    {
      id: 'status',
      header: tt('productionUx.common.status', 'Status'),
      cell: (batch) => <PremiumStatusBadge tone={statusTone[batch.status]}>{domainLabel(batch.status)}</PremiumStatusBadge>,
      sortValue: (batch) => batch.status,
      minWidth: 110,
    },
    {
      id: 'family',
      header: tt('productionUx.growth.family', 'Family'),
      cell: (batch) => domainLabel(batch.batch_family),
      sortValue: (batch) => batch.batch_family,
      minWidth: 120,
    },
    {
      id: 'basis',
      header: tt('productionUx.growth.quantityBasis', 'Quantity basis'),
      cell: (batch) => `${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim(),
      sortValue: (batch) => num(batch.current_primary_qty ?? batch.opening_primary_qty),
      align: 'right',
      minWidth: 140,
    },
    {
      id: 'weight',
      header: tt('productionUx.growth.latestWeight', 'Latest total weight'),
      cell: (batch) => (batch.latest_total_weight == null ? tt('productionUx.common.notRecorded', 'Not recorded') : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)),
      sortValue: (batch) => batch.latest_total_weight ?? -1,
      align: 'right',
      minWidth: 120,
    },
    {
      id: 'cost',
      header: tt('productionUx.growth.remainingCost', 'Remaining cost'),
      cell: (batch) => money(batch.remaining_cost, batch.base_currency_code || selectedCurrency),
      sortValue: (batch) => num(batch.remaining_cost),
      align: 'right',
      minWidth: 140,
    },
    {
      id: 'latest',
      header: tt('productionUx.growth.latestActivity', 'Latest activity'),
      cell: (batch) => (
        <span>
          {growthBatchEventTypeLabel(batch.latest_event_type)}
          <span className="block text-xs text-muted-foreground">{compactDate(batch.latest_event_at || batch.created_at)}</span>
        </span>
      ),
      sortValue: (batch) => batch.latest_event_at || batch.created_at,
      minWidth: 150,
    },
  ], [growthBatchEventTypeLabel, selectedCurrency, setRouteState, tt])

  const paginationLabels = useMemo(() => ({
    rowsPerPage: tt('productionUx.pagination.rows', 'Rows'),
    previous: tt('productionUx.pagination.previous', 'Previous'),
    next: tt('productionUx.pagination.next', 'Next'),
    pageSummary: (currentPage: number, totalPages: number) =>
      tt('productionUx.pagination.page', 'Page {page} of {total}')
        .replace('{page}', String(currentPage))
        .replace('{total}', String(totalPages)),
    rangeSummary: (from: number, to: number, total: number) =>
      tt('productionUx.pagination.range', '{from}-{to} of {total}')
        .replace('{from}', String(from))
        .replace('{to}', String(to))
        .replace('{total}', String(total)),
  }), [tt])

  const sortedBatches = useMemo(() => sortPremiumRows(filteredBatches, columns, sort), [columns, filteredBatches, sort])
  const mobileRows = useMemo(() => getPremiumPageRows(sortedBatches, page, pageSize), [page, pageSize, sortedBatches])

  const draftActionButtons = detailBatch?.status === 'draft' && canOperate ? (
    <div className="flex w-full min-w-0 flex-wrap gap-2 sm:justify-start">
      <Button type="button" size="sm" className="w-full sm:w-auto" onClick={activateBatch} disabled={saving}>
        <CheckCircle2 className="mr-2 h-4 w-4" />
        {tt('productionUx.growth.actions.activate', 'Activate')}
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={openEditDialog} disabled={saving}>
        <Pencil className="mr-2 h-4 w-4" />
        {tt('productionUx.growth.actions.editDraft', 'Edit draft')}
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setCancelOpen(true)} disabled={saving}>
        <Ban className="mr-2 h-4 w-4" />
        {tt('productionUx.growth.actions.cancelDraft', 'Cancel draft')}
      </Button>
    </div>
  ) : null

  const activeActionButtons = detailBatch?.status === 'active' && canOperate ? (
    <div className="flex w-full min-w-0 flex-wrap gap-2 sm:justify-start">
      {detailBatch.fully_harvested_awaiting_completion && canManage ? (
        <Button type="button" size="sm" className="w-full sm:w-auto" onClick={openCompletionDialog} disabled={saving || Boolean(completionUnavailableReason())} title={completionUnavailableReason() || undefined}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {completionCopy.actions.completeBatch}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="w-full sm:w-auto" disabled={saving}>
              <MoreHorizontal className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.actions.recordActivity', 'Record activity')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>{tt('productionUx.growth.actionGroups.materials', 'Materials')}</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={openStockInputDialog}>
                <PackageMinus className="mr-2 h-4 w-4" />
                {tt('productionUx.growth.actions.stockInput', 'Post stock input')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tt('productionUx.growth.actionGroups.observation', 'Observation')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setMeasurementOpen(true)}>
              <LineChart className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.actions.measurement', 'Record measurement')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tt('productionUx.growth.actionGroups.location', 'Location')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={openTransferDialog} disabled={Boolean(transferUnavailableReason())}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {transferCopy.actions.transferBatch}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tt('productionUx.growth.actionGroups.lifecycle', 'Lifecycle')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={openLossDialog} disabled={num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) <= 0}>
              <AlertTriangle className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.actions.loss', 'Record loss')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={openHarvestDialog} disabled={Boolean(harvestUnavailableReason())}>
              <Sprout className="mr-2 h-4 w-4" />
              {harvestCopy.actions.recordHarvest}
            </DropdownMenuItem>
            {canManage ? (
              <DropdownMenuItem onSelect={openCompletionDialog} disabled={Boolean(completionUnavailableReason())}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {completionCopy.actions.completeBatch}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{tt('productionUx.growth.actionGroups.cost', 'Cost')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setDirectCostOpen(true)}>
              <WalletCards className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.actions.memoCost', 'Add direct memo cost')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  ) : null

  async function buildGrowthExport(language: 'en' | 'pt' | 'bi', selectedSections: string[]) {
    if (!companyId || !detailBatch) throw new Error('growth_batch_export_context_unavailable')
    if (!selectedCurrency) throw new Error('growth_batch_export_currency_unavailable')
    const company = await loadFinanceExportCompany(companyId)
    const eventRow = (
      sequence: number,
      reference: string,
      date: string,
      type: string,
      effect: string,
      actor: string | null,
      notes: string | null,
    ) => ({
      sequence,
      reference,
      date,
      type,
      effect,
      actor: actor || tt('productionUx.common.teamMember', 'Team member'),
      notes,
    })
    return buildGrowthBatchExportModel({
      company,
      language,
      baseCurrency: selectedCurrency,
      selectedSections,
      reference: detailBatch.reference_no,
      name: detailBatch.name,
      family: domainLabel(detailBatch.batch_family),
      status: domainLabel(detailBatch.status),
      startDate: detailBatch.start_date,
      expectedEnd: detailBatch.expected_end_date,
      summary: [
        [tt('productionUx.growth.currentQuantity', 'Current quantity'), qtyWithUom(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty, detailBatch.primary_uom_code)],
        [tt('productionUx.growth.latestWeight', 'Latest total weight'), detailBatch.latest_total_weight == null ? tt('productionUx.common.notRecorded', 'Not recorded') : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)],
        [tt('productionUx.growth.location', 'Location'), [detailBatch.warehouse_name, detailBatch.bin_code, detailBatch.location_description].filter(Boolean).join(' / ') || tt('productionUx.common.notSet', 'Not set')],
      ],
      costSummary: [
        [tt('productionUx.growth.materialCost', 'Accumulated material cost'), num(detailBatch.accumulated_material_cost)],
        [tt('productionUx.growth.directCost', 'Accumulated direct memo cost'), num(detailBatch.accumulated_direct_cost)],
        [tt('productionUx.growth.totalCost', 'Accumulated total cost'), num(detailBatch.accumulated_total_cost)],
        [tt('productionUx.growth.harvestedCost', 'Harvested cost'), num(detailBatch.harvested_cost)],
        [tt('productionUx.growth.remainingCost', 'Remaining cost'), num(detailBatch.remaining_cost)],
      ],
      measurements: measurements.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        domainLabel(row.measurement_type),
        qtyWithUom(row.value, row.uom_code),
        row.actor_display_name,
        row.notes || row.description,
      )),
      directCosts: directCosts.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        domainLabel(row.category),
        money(row.amount, row.currency_code),
        row.actor_display_name,
        row.description,
      )),
      materials: stockInputs.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        row.item_name,
        `${qtyWithUom(row.quantity, row.uom_code)} · ${money(row.frozen_total_cost, row.currency_code)} · ${[row.source_warehouse_name, row.source_bin_code].filter(Boolean).join(' / ')}`,
        row.actor_display_name,
        row.line_notes,
      )),
      losses: losses.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        domainLabel(row.loss_type),
        `${qty(row.quantity_before)} → ${qty(row.quantity_after)} ${row.quantity_uom_code || detailBatch.primary_uom_code || ''}`.trim(),
        row.actor_display_name,
        row.notes || domainLabel(row.reason_code),
      )),
      transfers: transfers.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        tt('productionUx.growth.transfer', 'Location transfer'),
        `${transferHistoryLocationLabel(row, 'source')} → ${transferHistoryLocationLabel(row, 'destination')}`,
        row.actor_display_name,
        row.notes || domainLabel(row.transfer_reason),
      )),
      harvests: harvests.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        harvestKindLabel(row.harvest_kind),
        `${qtyWithUom(row.harvested_primary_qty, row.primary_uom_code)} · ${row.output_item_name} ${qtyWithUom(row.output_quantity, row.output_uom_code)} · ${money(row.allocated_cost, selectedCurrency)}`,
        row.actor_display_name,
        row.notes,
      )),
      completions: completions.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_effective_date,
        completionStatusLabel(row.status_after),
        `${completionStatusLabel(row.status_before)} → ${completionStatusLabel(row.status_after)}`,
        row.actor_display_name,
        row.notes || row.completion_reason,
      )),
      history: events.map((row) => eventRow(
        row.event_sequence,
        row.event_reference,
        row.event_date,
        growthBatchEventTypeLabel(row.event_type),
        row.event_summary,
        row.actor_display_name,
        row.reason || row.notes,
      )),
    })
  }

  const renderDraftForm = (
    form: DraftForm,
    setForm: React.Dispatch<React.SetStateAction<DraftForm>>,
    mode: 'create' | 'edit',
  ) => {
    const primaryUomOptions = mode === 'create' ? primaryUomsForCreate : primaryUomsForEdit
    const binOptions = mode === 'create' ? binsForCreate : binsForEdit
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tt('productionUx.growth.batchName', 'Batch name')} htmlFor={`${mode}-growth-name`}>
            <Input
              id={`${mode}-growth-name`}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={tt('productionUx.growth.batchNameExample', 'e.g. Broiler House A Week 24')}
            />
          </Field>
          <Field label={tt('productionUx.growth.family', 'Family')} htmlFor={`${mode}-growth-family`}>
            <Select value={form.batchFamily} onValueChange={(value) => setForm((current) => ({ ...current, batchFamily: value as BatchFamily }))}>
              <SelectTrigger id={`${mode}-growth-family`} aria-label={tt('productionUx.growth.family', 'Family')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {batchFamilies.map((family) => <SelectItem key={family} value={family}>{domainLabel(family)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tt('productionUx.growth.quantityBasis', 'Quantity basis')} htmlFor={`${mode}-growth-basis`}>
            <Select value={form.primaryQuantityBasis} onValueChange={(value) => setDraftBasis(value as QuantityBasis, mode)}>
              <SelectTrigger id={`${mode}-growth-basis`} aria-label={tt('productionUx.growth.quantityBasis', 'Quantity basis')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {quantityBases.map((basis) => <SelectItem key={basis} value={basis}>{domainLabel(basis)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={tt('productionUx.growth.openingQuantity', 'Opening quantity')} htmlFor={`${mode}-growth-opening-qty`}>
            <Input
              id={`${mode}-growth-opening-qty`}
              type="number"
              min="0.000001"
              step={form.primaryQuantityBasis === 'count' ? '1' : '0.000001'}
              value={form.openingPrimaryQty}
              onChange={(event) => setForm((current) => ({ ...current, openingPrimaryQty: event.target.value }))}
            />
          </Field>
          <Field label={tt('productionUx.growth.primaryUnit', 'Primary unit')} htmlFor={`${mode}-growth-primary-uom`}>
            <Select
              value={form.primaryUomId || 'none'}
              onValueChange={(value) => setForm((current) => {
                const primaryUomId = value === 'none' ? '' : value
                return {
                  ...current,
                  primaryUomId,
                  weightUomId: current.primaryQuantityBasis === 'weight' ? primaryUomId : current.weightUomId,
                }
              })}
            >
              <SelectTrigger id={`${mode}-growth-primary-uom`} aria-label={tt('productionUx.growth.primaryUnit', 'Primary unit')}><SelectValue placeholder={tt('productionUx.growth.selectUnit', 'Select unit')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tt('productionUx.forms.selectUnit', 'Select unit')}</SelectItem>
                {primaryUomOptions.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tt('productionUx.growth.startDate', 'Start date')} htmlFor={`${mode}-growth-start`}>
            <Input
              id={`${mode}-growth-start`}
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </Field>
          <Field label={tt('productionUx.growth.expectedEnd', 'Expected end')} htmlFor={`${mode}-growth-expected`}>
            <Input
              id={`${mode}-growth-expected`}
              type="date"
              value={form.expectedEndDate}
              onChange={(event) => setForm((current) => ({ ...current, expectedEndDate: event.target.value }))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tt('productionUx.growth.species', 'Species / cultivar')} htmlFor={`${mode}-growth-species`}>
            <Input
              id={`${mode}-growth-species`}
              value={form.speciesText}
              onChange={(event) => setForm((current) => ({ ...current, speciesText: event.target.value }))}
              placeholder={tt('productionUx.common.optional', 'Optional')}
            />
          </Field>
          <Field label={tt('productionUx.growth.purpose', 'Purpose')} htmlFor={`${mode}-growth-purpose`}>
            <Input
              id={`${mode}-growth-purpose`}
              value={form.purpose}
              onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
              placeholder={tt('productionUx.common.optional', 'Optional')}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={tt('productionUx.growth.openingWeight', 'Opening total weight')} htmlFor={`${mode}-growth-opening-weight`}>
            <Input
              id={`${mode}-growth-opening-weight`}
              type="number"
              min="0"
              step="0.000001"
              value={form.openingTotalWeight}
              onChange={(event) => setForm((current) => ({ ...current, openingTotalWeight: event.target.value }))}
              placeholder={tt('productionUx.common.optional', 'Optional')}
            />
          </Field>
          <Field label={tt('productionUx.growth.weightUnit', 'Weight unit')} htmlFor={`${mode}-growth-weight-uom`} hint={tt('productionUx.growth.weightUnitHelp', 'Required for opening, total, and average weight.')}>
            <Select value={form.weightUomId || 'none'} onValueChange={(value) => setForm((current) => ({ ...current, weightUomId: value === 'none' ? '' : value }))}>
              <SelectTrigger id={`${mode}-growth-weight-uom`} aria-label={tt('productionUx.growth.weightUnit', 'Weight unit')}><SelectValue placeholder={tt('productionUx.common.optional', 'Optional')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tt('productionUx.forms.noWeightUnit', 'No weight unit')}</SelectItem>
                {weightUoms.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={tt('productionUx.growth.area', 'Area')} htmlFor={`${mode}-growth-area`}>
            <Input
              id={`${mode}-growth-area`}
              type="number"
              min="0"
              step="0.000001"
              value={form.area}
              onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))}
              placeholder={tt('productionUx.common.optional', 'Optional')}
            />
          </Field>
          <Field label={tt('productionUx.growth.areaUnit', 'Area unit')} htmlFor={`${mode}-growth-area-uom`}>
            <Select value={form.areaUomId || 'none'} onValueChange={(value) => setAreaUom(value, mode)}>
              <SelectTrigger id={`${mode}-growth-area-uom`} aria-label={tt('productionUx.growth.areaUnit', 'Area unit')}><SelectValue placeholder={tt('productionUx.common.optional', 'Optional')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tt('productionUx.forms.noAreaUnit', 'No area unit')}</SelectItem>
                {areaUoms.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={tt('productionUx.growth.warehouse', 'Warehouse')} htmlFor={`${mode}-growth-warehouse`}>
            <Select value={form.warehouseId || 'none'} onValueChange={(value) => setDraftWarehouse(value, mode)}>
              <SelectTrigger id={`${mode}-growth-warehouse`} aria-label={tt('productionUx.growth.warehouse', 'Warehouse')}><SelectValue placeholder={tt('productionUx.common.optional', 'Optional')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tt('productionUx.forms.noWarehouse', 'No warehouse')}</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={tt('productionUx.growth.bin', 'Bin')} htmlFor={`${mode}-growth-bin`}>
            <Select value={form.binId || 'none'} onValueChange={(value) => setForm((current) => ({ ...current, binId: value === 'none' ? '' : value }))}>
              <SelectTrigger id={`${mode}-growth-bin`} aria-label={tt('productionUx.growth.bin', 'Bin')}><SelectValue placeholder={tt('productionUx.common.optional', 'Optional')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tt('productionUx.forms.noBin', 'No bin')}</SelectItem>
                {binOptions.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} - {bin.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={tt('productionUx.growth.locationNote', 'Location note')} htmlFor={`${mode}-growth-location`}>
            <Input
              id={`${mode}-growth-location`}
              value={form.locationDescription}
              onChange={(event) => setForm((current) => ({ ...current, locationDescription: event.target.value }))}
              placeholder={tt('productionUx.common.optional', 'Optional')}
            />
          </Field>
        </div>

        <Field label={tt('productionUx.growth.notes', 'Notes')} htmlFor={`${mode}-growth-notes`}>
          <Textarea
            id={`${mode}-growth-notes`}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder={tt('productionUx.growth.notesPlaceholder', 'Optional operating notes')}
          />
        </Field>
      </div>
    )
  }

  return (
    <main className="app-page app-page--workspace">
      <PremiumRegisterHeader
        eyebrow={tt('productionUx.growth.eyebrow', 'Group-level agricultural production')}
        title={tt('productionUx.growth.title', 'Growth Batches')}
        description={tt('productionUx.growth.description', 'Track group-level measurements, materials, losses, location, harvest and completion without implying individual records or finance posting.')}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void refreshAll()} disabled={loading || saving}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tt('common.refresh', 'Refresh')}
            </Button>
            {view !== 'register' ? (
              <Button type="button" variant="outline" onClick={() => setRouteState('register')}>
                {tt('productionUx.actions.backToRegister', 'Back to register')}
              </Button>
            ) : null}
            {view === 'register' ? (
              <Button type="button" onClick={() => setRouteState('create')} disabled={!canOperate || saving}>
                <Plus className="mr-2 h-4 w-4" />
                {tt('productionUx.growth.actions.new', 'New Growth Batch')}
              </Button>
            ) : null}
          </>
        }
      />

      {view === 'register' ? (
        <OperationalSummaryBand
          label={tt('productionUx.growth.summaryLabel', 'Growth Batch register summary')}
          items={[
            { label: tt('productionUx.growth.metrics.active', 'Active batches'), value: metricValues.active, tone: 'success' },
            { label: tt('productionUx.growth.metrics.drafts', 'Draft batches'), value: metricValues.draft, tone: 'info' },
            { label: tt('productionUx.growth.metrics.awaiting', 'Awaiting completion'), value: metricValues.awaitingCompletion, tone: 'warning' },
            { label: tt('productionUx.growth.metrics.completed', 'Completed batches'), value: metricValues.completed },
          ]}
        />
      ) : null}

      {view === 'register' ? <ProductionPathGuide /> : null}

      {view === 'register' ? <Card className="border-card-border bg-card">
        <CardContent className="grid gap-3 p-4 sm:p-5 xl:grid-cols-[minmax(16rem,1fr)_12rem_12rem_12rem_11rem_11rem]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tt('productionUx.growth.search', 'Search reference, name, family, or location')}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | BatchStatus)}>
            <SelectTrigger aria-label={tt('productionUx.growth.statusFilter', 'Status filter')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tt('productionUx.allStatuses', 'All statuses')}</SelectItem>
              {(['draft', 'active', 'completed', 'cancelled'] as BatchStatus[]).map((status) => (
                <SelectItem key={status} value={status}>{domainLabel(status)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={familyFilter} onValueChange={(value) => setFamilyFilter(value as 'all' | BatchFamily)}>
            <SelectTrigger aria-label={tt('productionUx.growth.familyFilter', 'Family filter')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tt('productionUx.growth.allFamilies', 'All families')}</SelectItem>
              {batchFamilies.map((family) => <SelectItem key={family} value={family}>{domainLabel(family)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={basisFilter} onValueChange={(value) => setBasisFilter(value as 'all' | QuantityBasis)}>
            <SelectTrigger aria-label={tt('productionUx.growth.basisFilter', 'Quantity basis filter')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tt('productionUx.growth.allBases', 'All bases')}</SelectItem>
              {quantityBases.map((basis) => <SelectItem key={basis} value={basis}>{domainLabel(basis)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label={tt('productionUx.growth.dateFrom', 'Start date from')} />
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label={tt('productionUx.growth.dateTo', 'Start date to')} />
        </CardContent>
      </Card> : null}

      <div className={cn('grid gap-5', view === 'register' && '2xl:grid-cols-[minmax(42rem,1fr)_minmax(30rem,0.8fr)]')}>
        {view === 'register' ? (
        <Card className="min-w-0 border-card-border bg-card">
          <CardHeader>
            <CardTitle>{tt('productionUx.growth.register', 'Growth Batch register')}</CardTitle>
            <CardDescription>
              {tt('productionUx.growth.registerCount', '{count} Growth Batches in the current view').replace('{count}', String(filteredBatches.length))}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <PremiumEmptyState
                icon={<AlertTriangle />}
                title={tt('productionUx.growth.registerUnavailable', 'Growth Batch register is unavailable')}
                description={tt('productionUx.growth.registerUnavailableDescription', 'The register could not be loaded. Existing data has not been treated as empty.')}
                action={<Button type="button" variant="outline" onClick={() => void refreshAll()}>{tt('common.retry', 'Retry')}</Button>}
              />
            ) : isMobile ? (
              <PremiumMobileCardList
                rows={mobileRows}
                getRowId={(batch) => batch.id}
                loading={loading}
                error={null}
                emptyState={<PremiumEmptyState icon={<Sprout />} title={tt('productionUx.growth.empty', 'No Growth Batches found')} description={tt('productionUx.growth.emptyHelp', 'Create a draft to start tracking a biological or agricultural batch.')} compact />}
                pagination={{
                  page,
                  pageSize,
                  totalItems: sortedBatches.length,
                  onPageChange: setPage,
                  onPageSizeChange: setPageSize,
                  pageSizeOptions: [5, 10, 20],
                  labels: paginationLabels,
                }}
                renderCard={(batch) => (
                  <button
                    type="button"
                    onClick={() => setRouteState('detail', batch.id)}
                    className={cn(
                      'w-full rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-4 text-left shadow-[0_14px_32px_-28px_hsl(var(--foreground)/0.34)]',
                      selectedId === batch.id && 'border-primary/40 bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-primary">{batch.reference_no}</div>
                        <div className="truncate text-sm text-muted-foreground">{batch.name}</div>
                      </div>
                      <PremiumStatusBadge tone={statusTone[batch.status]}>{domainLabel(batch.status)}</PremiumStatusBadge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <SummaryItem label={tt('productionUx.growth.quantityBasis', 'Quantity basis')} value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()} />
                      <SummaryItem label={tt('productionUx.growth.latestWeight', 'Latest total weight')} value={batch.latest_total_weight == null ? tt('productionUx.common.notRecorded', 'Not recorded') : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)} />
                      <SummaryItem label={tt('productionUx.growth.remainingCost', 'Remaining cost')} value={money(batch.remaining_cost, batch.base_currency_code || selectedCurrency)} />
                      <SummaryItem label={tt('productionUx.growth.family', 'Family')} value={domainLabel(batch.batch_family)} />
                      <SummaryItem label={tt('productionUx.growth.latestActivity', 'Latest activity')} value={compactDate(batch.latest_event_at || batch.created_at)} />
                    </div>
                  </button>
                )}
              />
            ) : (
              <PremiumDataTable
                rows={filteredBatches}
                columns={columns}
                getRowId={(batch) => batch.id}
                loading={loading}
                sort={sort}
                onSortChange={setSort}
                rowClassName={(batch) => (batch.id === selectedId ? 'bg-primary/5' : undefined)}
                emptyState={<PremiumEmptyState icon={<Sprout />} title={tt('productionUx.growth.empty', 'No Growth Batches found')} description={tt('productionUx.growth.emptyHelp', 'Create a draft to start tracking a biological or agricultural batch.')} compact />}
                pagination={{
                  page,
                  pageSize,
                  onPageChange: setPage,
                  onPageSizeChange: setPageSize,
                  pageSizeOptions: [10, 20, 50],
                  labels: paginationLabels,
                }}
                ariaLabel={tt('productionUx.growth.register', 'Growth Batch register')}
              />
            )}
          </CardContent>
        </Card>
        ) : null}

        {view === 'detail' ? <section className="min-w-0 space-y-5">
          {!detailBatch ? (
            <PremiumEmptyState icon={<Sprout />} title={tt('productionUx.growth.selectBatch', 'Select a Growth Batch')} description={tt('productionUx.growth.selectBatchHelp', 'Choose a register row to inspect lifecycle state, measurements, memo costs, and event history.')} />
          ) : (
            <>
              <Card className="border-card-border bg-card">
                <CardHeader className="gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PremiumStatusBadge tone={statusTone[detailBatch.status]}>{domainLabel(detailBatch.status)}</PremiumStatusBadge>
                      <Badge variant="outline">{domainLabel(detailBatch.batch_family)}</Badge>
                      <Badge variant="outline">{domainLabel(detailBatch.primary_quantity_basis)}</Badge>
                      {detailBatch.fully_harvested_awaiting_completion ? (
                        <Badge variant="secondary">{harvestCopy.labels.awaitingCompletion}</Badge>
                      ) : null}
                      {detailBatch.status === 'completed' ? (
                        <Badge variant="secondary">{completionCopy.history.completionBadge}</Badge>
                      ) : null}
                    </div>
                    <CardTitle className="mt-3 min-w-0 space-y-1">
                      <span className="block truncate">{detailBatch.reference_no}</span>
                      <span className="block whitespace-normal break-normal text-base font-semibold leading-snug text-card-foreground/90 sm:text-lg">
                        {detailBatch.name}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {detailRow?.purpose || tt('productionUx.growth.detailDescription', 'Group-level Growth Batch tracking. Stock inputs consume inventory, transfers move the whole batch operationally, harvests receive one output into stock, completion closes only the lifecycle, and COGS or valuation posting remains out of scope.')}
                    </CardDescription>
                  </div>
                  <div className="flex w-full min-w-0 flex-col gap-2">
                    {draftActionButtons}
                    {activeActionButtons}
                    {detailBatch.status === 'completed' || detailBatch.status === 'cancelled' ? (
                      <Button
                        type="button"
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={() => setRouteState('detail', detailBatch.id, 'history')}
                      >
                        <ClipboardList className="mr-2 h-4 w-4" />
                        {tt('productionUx.growth.actions.reviewHistory', 'Review history')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                      onClick={() => setExportOpen(true)}
                      disabled={!selectedCurrency}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {tt('productionUx.export.report', 'Export operational report')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <SummaryItem label={tt('productionUx.growth.currentQuantity', 'Current quantity')} value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                    <SummaryItem label={tt('productionUx.growth.latestWeight', 'Latest total weight')} value={detailBatch.latest_total_weight == null ? tt('productionUx.common.notRecorded', 'Not recorded') : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                    <SummaryItem label={tt('productionUx.growth.remainingCost', 'Remaining cost')} value={money(detailBatch.remaining_cost, selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} />
                    <SummaryItem label={completionCopy.labels.completedAt} value={detailBatch.completed_at ? compactDateTime(detailBatch.completed_at) : completionCopy.fallback.notRecorded} />
                    <SummaryItem label={tt('productionUx.growth.startDate', 'Start date')} value={compactDate(detailBatch.start_date)} />
                    <SummaryItem label={tt('productionUx.growth.expectedEnd', 'Expected end')} value={detailBatch.expected_end_date ? compactDate(detailBatch.expected_end_date) : tt('productionUx.common.notSet', 'Not set')} />
                    <SummaryItem
                      label={tt('productionUx.growth.location', 'Location')}
                      value={
                        detailBatch.warehouse_name || detailBatch.bin_code || detailBatch.location_description
                          ? [detailBatch.warehouse_name, detailBatch.bin_code, detailBatch.location_description].filter(Boolean).join(' / ')
                          : tt('productionUx.common.notSet', 'Not set')
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              {Object.keys(detailErrors).length > 0 ? (
                <div className="rounded-lg border border-status-warning-border bg-status-warning-muted p-4 text-sm" role="status">
                  <div className="font-medium text-status-warning-foreground">
                    {detailErrors.core
                      ? tt('productionUx.growth.detailUnavailable', 'Growth Batch detail is unavailable')
                      : tt('productionUx.growth.partialUnavailable', 'Some Growth Batch evidence is unavailable')}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {tt('productionUx.growth.partialUnavailableDescription', 'Unavailable evidence is identified separately and is not presented as an empty history or a zero cost.')}
                  </p>
                </div>
              ) : null}

              {detailLoading ? (
                <section aria-label={tt('productionUx.growth.loadingDetail', 'Loading Growth Batch detail')} className="space-y-4 border-y border-border py-5">
                  <PremiumSkeleton lines={3} />
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <PremiumSkeleton lines={2} />
                    <PremiumSkeleton lines={2} />
                    <PremiumSkeleton lines={2} />
                  </div>
                </section>
              ) : (
                <Tabs
                  value={section}
                  onValueChange={(nextSection) => setRouteState('detail', detailBatch.id, nextSection)}
                  className="min-w-0"
                >
                  <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
                    <TabsTrigger value="overview">{tt('productionUx.growth.sections.overview', 'Overview')}</TabsTrigger>
                    <TabsTrigger value="materials">{tt('productionUx.growth.sections.materials', 'Materials & Location')}</TabsTrigger>
                    <TabsTrigger value="lifecycle">{tt('productionUx.growth.sections.lifecycle', 'Lifecycle')}</TabsTrigger>
                    <TabsTrigger value="measurements">{tt('productionUx.growth.sections.measurements', 'Measurements')}</TabsTrigger>
                    <TabsTrigger value="costs">{tt('productionUx.growth.sections.costs', 'Costs')}</TabsTrigger>
                    <TabsTrigger value="history">{tt('productionUx.growth.sections.history', 'History & Audit')}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-5">
                    <DetailSection
                      title={tt('productionUx.growth.openingState', 'Opening state')}
                      description={tt('productionUx.growth.openingStateHelp', 'Opening quantities are captured on the draft and frozen when the batch is activated.')}
                    >
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <SummaryItem label={tt('productionUx.growth.openingQuantity', 'Opening quantity')} value={`${qty(detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                        <SummaryItem label={tt('productionUx.growth.openingWeight', 'Opening total weight')} value={detailBatch.opening_total_weight == null ? tt('productionUx.common.notSet', 'Not set') : qtyWithUom(detailBatch.opening_total_weight, detailBatch.weight_uom_code)} />
                        <SummaryItem label={tt('productionUx.growth.weightUnit', 'Weight unit')} value={detailBatch.weight_uom_code || tt('productionUx.common.notSet', 'Not set')} />
                        <SummaryItem label={tt('productionUx.growth.area', 'Area')} value={detailBatch.area == null ? tt('productionUx.common.notSet', 'Not set') : `${qty(detailBatch.area)} ${detailBatch.area_uom_code || ''}`.trim()} />
                        <SummaryItem label={tt('productionUx.growth.species', 'Species / cultivar')} value={detailRow?.species_text || tt('productionUx.common.notSet', 'Not set')} />
                        <SummaryItem label={tt('productionUx.growth.latestEvent', 'Latest event')} value={growthBatchEventTypeLabel(detailBatch.latest_event_type)} />
                        <SummaryItem label={tt('productionUx.growth.latestActivity', 'Latest activity')} value={compactDateTime(detailBatch.latest_event_at || detailBatch.created_at)} />
                      </div>
                      {detailRow?.notes ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{detailRow.notes}</p> : null}
                    </DetailSection>

                  </TabsContent>

                  <TabsContent value="materials">
                    <DetailSection
                      title={tt('productionUx.growth.stockInputHistory', 'Stock input history')}
                      description={tt('productionUx.growth.stockInputHistoryHelp', 'Stock inputs create physical issue movements, freeze source WAC as material cost, and do not create supplier bills, payments, bank transactions, or finance journals.')}
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" onClick={openStockInputDialog}>
                          <PackageMinus className="mr-2 h-4 w-4" />
                          {tt('productionUx.growth.actions.stockInput', 'Post stock input')}
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label={tt('productionUx.growth.materialCost', 'Accumulated material cost')} value={money(detailBatch.accumulated_material_cost, selectedCurrency)} />
                        <SummaryItem label={tt('productionUx.growth.directCost', 'Accumulated direct memo cost')} value={money(detailBatch.accumulated_direct_cost, selectedCurrency)} />
                        <SummaryItem label={tt('productionUx.growth.remainingCost', 'Remaining cost')} value={money(detailBatch.remaining_cost, selectedCurrency)} />
                      </div>
                      {detailErrors.materials ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={tt('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
                      ) : stockInputs.length === 0 ? (
                        <PremiumEmptyState icon={<PackageMinus />} title={tt('productionUx.growth.noStockInputs', 'No stock inputs yet')} description={tt('productionUx.growth.noStockInputsHelp', 'Post stock input when physical material is issued to an active batch.')} compact />
                      ) : (
                        <div className="space-y-3">
                          {stockInputs.map((line) => {
                            const canReverseLine = canManage && line.reversal_status !== 'reversed'
                            return (
                              <div key={line.id} className="rounded-xl border border-card-border bg-card p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-medium">{line.item_name}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {[line.item_sku, line.event_reference, `${tt('productionUx.growth.sequenceShort', 'Seq')} ${line.event_sequence}`].filter(Boolean).join(' / ')}
                                    </div>
                                    <div className="mt-2 text-sm text-muted-foreground">
                                      {[line.source_warehouse_name, line.source_bin_code, line.source_bin_name].filter(Boolean).join(' / ')}
                                    </div>
                                  </div>
                                  <div className="text-right text-sm">
                                    <div className="font-semibold">{qtyWithUom(line.quantity, line.uom_code || uomById.get(line.uom_id)?.code)}</div>
                                    <div className="text-xs text-muted-foreground">{money(line.frozen_total_cost, line.currency_code || selectedCurrency)}</div>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                  <span>{tt('productionUx.growth.issueMovementRecorded', 'Issue movement recorded')}</span>
                                  <span>{compactDate(line.event_effective_date)} / {compactDateTime(line.event_created_at)}</span>
                                </div>
                                {line.reversal_status === 'reversed' ? (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    {tt('productionUx.growth.reversedEvidence', 'Reversed by {reference} on {date}. Compensating receipt recorded.')
                                      .replace('{reference}', line.reversal_event_reference || tt('productionUx.growth.reversalEvent', 'reversal event'))
                                      .replace('{date}', compactDate(line.reversal_effective_date))}
                                  </p>
                                ) : canReverseLine ? (
                                  <div className="mt-3">
                                    <Button type="button" size="sm" variant="outline" onClick={() => openReversalDialog(line)} disabled={saving}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      {tt('productionUx.growth.reverseEvent', 'Reverse event')}
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <GrowthBatchTransferSection
                    batch={detailBatch}
                    transfers={transfers}
                    hasHistoryError={Boolean(detailErrors.transfers)}
                    canOperate={canOperate}
                    canManage={canManage}
                    saving={saving}
                    transferCopy={transferCopy}
                    translate={tt}
                    getTransferUnavailableReason={transferUnavailableReason}
                    getSourceLocationLabel={transferSourceLocationLabel}
                    getHistoryLocationLabel={transferHistoryLocationLabel}
                    getTransferReasonLabel={transferReasonLabel}
                    onOpenTransfer={openTransferDialog}
                    onOpenTransferReversal={openTransferReversalDialog}
                  />

                  <TabsContent value="lifecycle">
                    <DetailSection
                      title={harvestCopy.history.title}
                      description={harvestCopy.history.description}
                      action={detailBatch.status === 'active' && canOperate && num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) > 0 ? (
                        <Button size="sm" className="w-full sm:w-auto" onClick={openHarvestDialog} disabled={saving || Boolean(harvestUnavailableReason())} title={harvestUnavailableReason() || undefined}>
                          <Sprout className="mr-2 h-4 w-4" />
                          {harvestCopy.actions.recordHarvest}
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <SummaryItem label={harvestCopy.labels.currentQuantity} value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                        <SummaryItem label={harvestCopy.labels.currentWeight} value={detailBatch.latest_total_weight == null ? harvestCopy.fallback.notRecorded : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                        <SummaryItem label={harvestCopy.labels.remainingCost} value={money(detailBatch.remaining_cost, selectedCurrency)} />
                        <SummaryItem label={harvestCopy.labels.stockReceipt} value={harvestCopy.preview.noSaleNoFinance} />
                      </div>
                      {detailBatch.fully_harvested_awaiting_completion ? (
                        <div className="mb-4 rounded-xl border border-status-success-border bg-status-success-muted p-4 text-sm">
                          <div className="font-medium text-status-success-foreground">{harvestCopy.labels.fullyHarvested}</div>
                          <div className="mt-1 text-muted-foreground">{harvestCopy.labels.awaitingCompletion}</div>
                        </div>
                      ) : null}
                      {detailErrors.harvests ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={tt('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
                      ) : harvests.length === 0 ? (
                        <PremiumEmptyState icon={<Sprout />} title={harvestCopy.history.emptyTitle} description={harvestCopy.history.emptyDescription} compact />
                      ) : (
                        <div className="space-y-3">
                          {harvests.map((harvest) => {
                            const canReverseHarvest = canManage && harvest.reversal_eligible
                            return (
                              <div key={harvest.id} className="rounded-xl border border-card-border bg-card p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <PremiumStatusBadge tone="positive">{harvestCopy.history.harvestBadge}</PremiumStatusBadge>
                                      <Badge variant="secondary">{harvestKindLabel(harvest.harvest_kind)}</Badge>
                                      {harvest.reversed ? <Badge variant="outline">{harvestCopy.fallback.reversed}</Badge> : null}
                                      {!harvest.reversed && !harvest.reversal_eligible ? <Badge variant="secondary">{harvestCopy.fallback.locked}</Badge> : null}
                                    </div>
                                    <div className="mt-2 font-medium break-words">
                                      {harvest.output_item_name}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                      {[harvest.output_item_sku, harvest.event_reference, `${harvestCopy.history.sequencePrefix} ${harvest.event_sequence}`].filter(Boolean).join(' / ')}
                                    </div>
                                  </div>
                                  <div className="min-w-0 text-left text-sm font-semibold sm:text-right">
                                    <div>{qtyWithUom(harvest.harvested_primary_qty, harvest.primary_uom_code)}</div>
                                    <div className="text-xs font-normal text-muted-foreground">{compactDate(harvest.event_effective_date)}</div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                                  <SummaryItem label={harvestCopy.labels.before} value={qtyWithUom(harvest.quantity_before, harvest.primary_uom_code)} />
                                  <SummaryItem label={harvestCopy.labels.after} value={qtyWithUom(harvest.quantity_after, harvest.primary_uom_code)} />
                                  <SummaryItem label={harvestCopy.labels.harvestedWeight} value={harvest.harvested_weight == null ? harvestCopy.fallback.notRecorded : qtyWithUom(harvest.harvested_weight, harvest.weight_uom_code)} />
                                  <SummaryItem label={harvestCopy.labels.outputQuantity} value={qtyWithUom(harvest.output_quantity, harvest.output_uom_code)} />
                                  <SummaryItem label={harvestCopy.labels.destinationLocation} value={harvestHistoryLocationLabel(harvest, 'destination')} />
                                  <SummaryItem label={harvestCopy.labels.allocatedCost} value={money(harvest.allocated_cost, selectedCurrency)} />
                                  <SummaryItem label={harvestCopy.labels.outputUnitCost} value={money(harvest.output_unit_cost, selectedCurrency)} />
                                  <SummaryItem label={harvestCopy.labels.remainingCost} value={money(harvest.remaining_cost_after, selectedCurrency)} />
                                </div>
                                <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                                  <SummaryItem label={harvestCopy.labels.sourceLocation} value={harvestHistoryLocationLabel(harvest, 'source')} />
                                  <SummaryItem label={harvestCopy.labels.stockReceipt} value={harvestCopy.history.harvestBadge} />
                                </div>
                                {harvest.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{harvest.notes}</p> : null}
                                {harvest.reversed ? (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    {harvestCopy.history.reversedBy} {harvest.reversal_event_reference || harvestCopy.history.harvestReversalBadge} {harvestCopy.history.onDate} {compactDate(harvest.reversal_effective_date)}. {harvest.reversal_reason || harvestCopy.fallback.notRecorded}
                                  </p>
                                ) : canReverseHarvest ? (
                                  <div className="mt-3">
                                    <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openHarvestReversalDialog(harvest)} disabled={saving}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      {harvestCopy.actions.reverseHarvest}
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    {harvestCopy.history.lockedReason}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <GrowthBatchCompletionSection
                    batch={detailBatch}
                    completions={completions}
                    hasHistoryError={Boolean(detailErrors.completion)}
                    canManage={canManage}
                    saving={saving}
                    selectedCurrency={selectedCurrency}
                    completionCopy={completionCopy}
                    fullyHarvestedLabel={harvestCopy.labels.fullyHarvested}
                    translate={tt}
                    completionStatusLabel={completionStatusLabel}
                    getCompletionUnavailableReason={completionUnavailableReason}
                    onOpenCompletion={openCompletionDialog}
                    onOpenCompletionReversal={openCompletionReversalDialog}
                  />

                  <TabsContent value="lifecycle">
                    <DetailSection
                      title={tt('productionUx.growth.lossHistory', 'Mortality and shrinkage')}
                      description={tt('productionUx.growth.lossHistoryHelp', 'Loss events reduce the current batch quantity and/or latest total weight. They do not create stock movements, finance rows, or cost write-offs.')}
                      action={detailBatch.status === 'active' && canOperate && num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) > 0 ? (
                        <Button size="sm" onClick={openLossDialog} disabled={saving}>
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          {tt('productionUx.growth.actions.loss', 'Record loss')}
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label={tt('productionUx.growth.currentQuantity', 'Current quantity')} value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                        <SummaryItem label={tt('productionUx.growth.latestWeight', 'Latest total weight')} value={detailBatch.latest_total_weight == null ? tt('productionUx.common.notRecorded', 'Not recorded') : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                        <SummaryItem label={tt('productionUx.growth.unreversedLosses', 'Unreversed losses')} value={detailBatch.unreversed_loss_event_count ?? 0} />
                      </div>
                      {detailErrors.losses ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={tt('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
                      ) : losses.length === 0 ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.noLosses', 'No mortality or shrinkage yet')} description={tt('productionUx.growth.noLossesHelp', 'Record loss only for active batches when quantity or weight has actually reduced.')} compact />
                      ) : (
                        <div className="space-y-3">
                          {losses.map((loss) => {
                            const canReverseLoss = canManage && loss.reversal_status !== 'reversed'
                            return (
                              <div key={loss.id} className="rounded-xl border border-card-border bg-card p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <PremiumStatusBadge tone="warning">{domainLabel(loss.loss_type)}</PremiumStatusBadge>
                                      {loss.reversal_status === 'reversed' ? <Badge variant="outline">{tt('productionUx.status.reversed', 'Reversed')}</Badge> : null}
                                    </div>
                                    <div className="mt-2 font-medium">{domainLabel(loss.reason_code)}</div>
                                    <div className="text-sm text-muted-foreground">{loss.event_reference} {tt('productionUx.common.by', 'by')} {loss.actor_display_name || tt('productionUx.common.teamMember', 'Team member')}</div>
                                  </div>
                                  <div className="text-right text-sm font-semibold">
                                    {loss.quantity_lost != null ? <div>-{qtyWithUom(loss.quantity_lost, loss.quantity_uom_code || uomById.get(loss.quantity_uom_id || '')?.code)}</div> : null}
                                    {loss.weight_lost != null ? <div>-{qtyWithUom(loss.weight_lost, loss.weight_uom_code || uomById.get(loss.weight_uom_id || '')?.code)}</div> : null}
                                    <div className="text-xs font-normal text-muted-foreground">{tt('productionUx.growth.sequenceShort', 'Seq')} {loss.event_sequence} / {compactDate(loss.event_effective_date)}</div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                                  <SummaryItem label={tt('productionUx.growth.quantity', 'Quantity')} value={`${qty(loss.quantity_before)} -> ${qty(loss.quantity_after)} ${loss.quantity_uom_code || detailBatch.primary_uom_code || ''}`.trim()} />
                                  <SummaryItem label={tt('productionUx.growth.weight', 'Weight')} value={loss.total_weight_before == null && loss.total_weight_after == null ? tt('productionUx.common.notAffected', 'Not affected') : `${qty(loss.total_weight_before)} -> ${qty(loss.total_weight_after)} ${loss.weight_uom_code || detailBatch.weight_uom_code || ''}`.trim()} />
                                </div>
                                {loss.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{loss.notes}</p> : null}
                                {loss.reversal_status === 'reversed' ? (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    {tt('productionUx.growth.lossReversalEvidence', 'Reversed by {reference} on {date}. {reason}')
                                      .replace('{reference}', loss.reversal_event_reference || tt('productionUx.growth.reversalEvent', 'reversal event'))
                                      .replace('{date}', compactDate(loss.reversal_effective_date))
                                      .replace('{reason}', loss.reversal_reason || tt('productionUx.growth.reasonRecorded', 'Reason recorded.'))}
                                  </p>
                                ) : canReverseLoss ? (
                                  <div className="mt-3">
                                    <Button type="button" size="sm" variant="outline" onClick={() => openLossReversalDialog(loss)} disabled={saving}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      {tt('productionUx.growth.reverseLoss', 'Reverse loss event')}
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="measurements">
                    <DetailSection
                      title={tt('productionUx.growth.measurementHistory', 'Measurement history')}
                      description={tt('productionUx.growth.measurementHistoryHelp', 'Measurements are append-only. Total-weight measurements update latest total weight; population does not change.')}
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" onClick={() => setMeasurementOpen(true)}>
                          <LineChart className="mr-2 h-4 w-4" />
                          {tt('productionUx.growth.actions.measurement', 'Record measurement')}
                        </Button>
                      ) : null}
                    >
                      {detailErrors.measurements ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={tt('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
                      ) : measurements.length === 0 ? (
                        <PremiumEmptyState icon={<Ruler />} title={tt('productionUx.growth.noMeasurements', 'No measurements yet')} compact />
                      ) : (
                        <div className="space-y-3">
                          {measurements.map((measurement) => (
                            <div key={measurement.id} className="rounded-xl border border-card-border bg-card p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-medium">{domainLabel(measurement.measurement_type)}</div>
                                  <div className="text-sm text-muted-foreground">{measurement.event_reference} {tt('productionUx.common.by', 'by')} {measurement.actor_display_name || tt('productionUx.common.teamMember', 'Team member')}</div>
                                </div>
                                <div className="text-right text-sm font-semibold">
                                  {qtyWithUom(measurement.value, measurement.uom_code || uomById.get(measurement.uom_id)?.code)}
                                  <div className="text-xs font-normal text-muted-foreground">{tt('productionUx.growth.sequenceShort', 'Seq')} {measurement.event_sequence} · {compactDateTime(measurement.observed_at)}</div>
                                </div>
                              </div>
                              {measurement.description || measurement.notes ? (
                                <p className="mt-3 text-sm leading-6 text-muted-foreground">{measurement.description || measurement.notes}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="costs">
                    <DetailSection
                      title={tt('productionUx.growth.memoCosts', 'Memo direct costs')}
                      description={tt('productionUx.growth.memoCostsHelp', 'Direct costs update Growth Batch rollups only. They do not create bills, cash, bank, settlement, journal, invoice, stock, or COGS rows.')}
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" variant="outline" onClick={() => setDirectCostOpen(true)}>
                          <WalletCards className="mr-2 h-4 w-4" />
                          {tt('productionUx.growth.actions.memoCost', 'Add direct memo cost')}
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label={tt('productionUx.growth.directCost', 'Accumulated direct memo cost')} value={money(detailBatch.accumulated_direct_cost, selectedCurrency)} />
                        <SummaryItem label={tt('productionUx.growth.materialCost', 'Accumulated material cost')} value={money(detailBatch.accumulated_material_cost, selectedCurrency)} />
                        <SummaryItem label={tt('productionUx.growth.remainingCost', 'Remaining cost')} value={money(detailBatch.remaining_cost, selectedCurrency)} />
                      </div>
                      {detailErrors.costs ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={tt('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
                      ) : directCosts.length === 0 ? (
                        <PremiumEmptyState icon={<Coins />} title={tt('productionUx.growth.noMemoCosts', 'No memo direct costs yet')} compact />
                      ) : (
                        <div className="space-y-3">
                          {directCosts.map((cost) => (
                            <div key={cost.id} className="rounded-xl border border-card-border bg-card p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-medium">{cost.description}</div>
                                  <div className="text-sm text-muted-foreground">{domainLabel(cost.category)} / {cost.event_reference} / {tt('productionUx.growth.sequenceShort', 'Seq')} {cost.event_sequence}</div>
                                </div>
                                <div className="text-right text-sm font-semibold">
                                  {money(cost.amount, cost.currency_code)}
                                  <div className="text-xs font-normal text-muted-foreground">{compactDate(cost.event_date)}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="history">
                    <DetailSection
                      title={tt('productionUx.growth.timelineTitle', 'Event timeline')}
                      description={tt('productionUx.growth.timelineDescription', 'Lifecycle events are immutable and sequence-numbered per Growth Batch.')}
                    >
                      {detailErrors.history ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title={tt('productionUx.growth.historyUnavailable', 'History unavailable')} description={tt('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
                      ) : events.length === 0 ? (
                        <PremiumEmptyState icon={<CalendarDays />} title={tt('productionUx.growth.noEvents', 'No lifecycle events yet')} compact />
                      ) : (
                        <div className="space-y-3">
                          {events.map((event) => (
                            <div key={event.id} className="grid gap-3 rounded-xl border border-card-border bg-card p-4 sm:grid-cols-[auto,1fr]">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-surface-muted text-sm font-semibold">
                                {event.event_sequence}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <PremiumStatusBadge tone={eventTone[event.event_type]}>{growthBatchEventTypeLabel(event.event_type)}</PremiumStatusBadge>
                                    <div className="mt-2 font-medium">{eventSummaryLabel(event, lang, growthBatchEventTypeLabel)}</div>
                                    <div className="text-sm text-muted-foreground">{event.event_reference}</div>
                                  </div>
                                  {event.total_cost_delta ? <div className="text-sm font-semibold">{money(event.total_cost_delta, event.currency_code || selectedCurrency)}</div> : null}
                                  {event.weight_value != null ? <div className="text-sm font-semibold">{qtyWithUom(event.weight_value, event.weight_uom_code)}</div> : null}
                                </div>
                                <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 sm:grid-cols-3">
                                  <SummaryItem label={tt('productionUx.growth.effectiveDate', 'Effective date')} value={compactDate(event.event_date)} />
                                  <SummaryItem label={tt('productionUx.growth.recordedAt', 'Recorded at')} value={compactDateTime(event.event_at)} />
                                  <SummaryItem label={tt('productionUx.growth.actor', 'Actor')} value={event.actor_display_name || tt('productionUx.common.teamMember', 'Team member')} />
                                  {event.quantity_delta != null ? <SummaryItem label={tt('productionUx.growth.quantityEffect', 'Quantity effect')} value={qty(event.quantity_delta)} /> : null}
                                  {event.weight_delta != null ? <SummaryItem label={tt('productionUx.growth.weightEffect', 'Weight effect')} value={qtyWithUom(event.weight_delta, event.weight_uom_code)} /> : null}
                                  <SummaryItem label={tt('productionUx.growth.costEffect', 'Cost effect')} value={money(event.total_cost_delta, event.currency_code || selectedCurrency, tt('productionUx.costUnavailable', 'Cost unavailable'))} />
                                </div>
                                {event.reason || event.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{event.reason || event.notes}</p> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="history">
                    <DetailSection
                      title={tt('productionUx.growth.auditTitle', 'Audit and lifecycle')}
                      description={tt('productionUx.growth.auditDescription', 'Read-only timestamps and actor evidence for the selected Growth Batch.')}
                    >
                      <div className="grid gap-4 sm:grid-cols-2">
                        <SummaryItem label={tt('productionUx.growth.createdAt', 'Created')} value={compactDateTime(detailRow?.created_at || detailBatch.created_at)} />
                        <SummaryItem label={tt('productionUx.growth.updatedAt', 'Updated')} value={compactDateTime(detailRow?.updated_at)} />
                        <SummaryItem label={tt('productionUx.growth.activatedAt', 'Activated')} value={compactDateTime(detailBatch.activated_at)} />
                        <SummaryItem label={tt('productionUx.growth.cancelledAt', 'Cancelled')} value={compactDateTime(detailBatch.cancelled_at)} />
                        <SummaryItem label={tt('productionUx.growth.actorEvidence', 'Actor evidence')} value={tt('productionUx.growth.actorEvidenceHelp', 'Shown on each lifecycle event where available')} />
                      </div>
                      {detailRow?.cancellation_reason ? (
                        <p className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                          {tt('productionUx.growth.cancellationReason', 'Cancellation reason')}: {detailRow.cancellation_reason}
                        </p>
                      ) : null}
                    </DetailSection>
                  </TabsContent>
                </Tabs>
              )}
            </>
          )}
        </section> : null}
      </div>

      {detailBatch ? (
        <ProductionExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          title={tt('productionUx.export.growthTitle', 'Growth Batch Activity & Cost Report')}
          scope={`${detailBatch.reference_no} · ${detailBatch.name}`}
          recordCount={events.length}
          currencyBasis={selectedCurrency || tt('productionUx.common.unavailable', 'Unavailable')}
          sectionOptions={[
            { id: 'materials', label: tt('productionUx.growth.sections.stockInputs', 'Stock inputs') },
            { id: 'costs', label: tt('productionUx.growth.sections.directCosts', 'Direct memo costs') },
            { id: 'lifecycle-losses', label: tt('productionUx.growth.sections.losses', 'Losses') },
            { id: 'lifecycle-transfers', label: tt('productionUx.growth.sections.transfers', 'Location transfers') },
            { id: 'lifecycle-harvests', label: tt('productionUx.growth.sections.harvests', 'Harvests') },
            { id: 'lifecycle-completion', label: tt('productionUx.growth.sections.completion', 'Completion') },
            { id: 'measurements', label: tt('productionUx.growth.sections.measurements', 'Measurements') },
            { id: 'history', label: tt('productionUx.growth.sections.history', 'History & Audit') },
          ]}
          buildModel={buildGrowthExport}
        />
      ) : null}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open && view === 'create') setRouteState('register')
        }}
      >
        <DialogContent className="max-w-4xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.createTitle', 'Create Growth Batch draft')}</DialogTitle>
            <DialogDescription>{tt('productionUx.growth.createDescription', 'Drafts can be edited until activation. Activation freezes the opening state and creates the first lifecycle event.')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">{renderDraftForm(draftForm, setDraftForm, 'create')}</DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setCreateOpen(false)
              setRouteState('register')
            }} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" onClick={createDraft} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.createDraft', 'Create draft')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-4xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.editTitle', 'Edit draft')}</DialogTitle>
            <DialogDescription>{tt('productionUx.growth.editDescription', 'Draft changes are blocked after activation or cancellation.')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">{renderDraftForm(editForm, setEditForm, 'edit')}</DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" onClick={saveDraft} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {tt('productionUx.forms.saveDraft', 'Save draft')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.cancelTitle', 'Cancel draft')}</DialogTitle>
            <DialogDescription>{tt('productionUx.growth.cancelDescription', 'Cancellation creates an immutable event and prevents activation.')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={tt('productionUx.growth.cancellationReason', 'Cancellation reason')} htmlFor="growth-cancel-reason">
              <Textarea id="growth-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" variant="destructive" onClick={cancelDraft} disabled={saving}>{tt('productionUx.growth.actions.cancelDraft', 'Cancel draft')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={measurementOpen} onOpenChange={setMeasurementOpen}>
        <DialogContent className="max-w-3xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.actions.measurement', 'Record measurement')}</DialogTitle>
            <DialogDescription>{tt('productionUx.growth.measurementDescription', 'Measurements are informational events. They do not change physical stock.')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={tt('productionUx.forms.type', 'Type')} htmlFor="growth-measurement-type">
                  <Select value={measurementForm.measurementType} onValueChange={(value) => setMeasurementForm((current) => ({ ...current, measurementType: value as MeasurementType }))}>
                    <SelectTrigger id="growth-measurement-type" aria-label={tt('productionUx.forms.measurementType', 'Measurement type')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {measurementTypes.map((type) => <SelectItem key={type} value={type}>{domainLabel(type)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={tt('productionUx.forms.value', 'Value')} htmlFor="growth-measurement-value">
                  <Input
                    id="growth-measurement-value"
                    type="number"
                    min={measurementForm.measurementType === 'temperature' ? undefined : '0'}
                    step="0.000001"
                    value={measurementForm.value}
                    onChange={(event) => setMeasurementForm((current) => ({ ...current, value: event.target.value }))}
                  />
                </Field>
                <Field label={tt('productionUx.forms.unit', 'Unit')} htmlFor="growth-measurement-uom">
                  <Select value={measurementForm.uomId || 'none'} onValueChange={(value) => setMeasurementForm((current) => ({ ...current, uomId: value === 'none' ? '' : value }))}>
                    <SelectTrigger id="growth-measurement-uom" aria-label={tt('productionUx.forms.measurementUnit', 'Measurement unit')}><SelectValue placeholder={tt('productionUx.forms.selectUnit', 'Select unit')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tt('productionUx.forms.selectUnit', 'Select unit')}</SelectItem>
                      {measurementUoms.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label={tt('productionUx.forms.observedAt', 'Observed at')} htmlFor="growth-measurement-observed">
                <Input
                  id="growth-measurement-observed"
                  type="datetime-local"
                  value={measurementForm.observedAt}
                  onChange={(event) => setMeasurementForm((current) => ({ ...current, observedAt: event.target.value }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={tt('productionUx.forms.sampleSize', 'Sample size')} htmlFor="growth-measurement-sample"><Input id="growth-measurement-sample" type="number" min="0" step="0.000001" value={measurementForm.sampleSize} onChange={(event) => setMeasurementForm((current) => ({ ...current, sampleSize: event.target.value }))} /></Field>
                <Field label={tt('productionUx.forms.minimum', 'Minimum')} htmlFor="growth-measurement-min"><Input id="growth-measurement-min" type="number" min={measurementForm.measurementType === 'temperature' ? undefined : '0'} step="0.000001" value={measurementForm.minimum} onChange={(event) => setMeasurementForm((current) => ({ ...current, minimum: event.target.value }))} /></Field>
                <Field label={tt('productionUx.forms.maximum', 'Maximum')} htmlFor="growth-measurement-max"><Input id="growth-measurement-max" type="number" min={measurementForm.measurementType === 'temperature' ? undefined : '0'} step="0.000001" value={measurementForm.maximum} onChange={(event) => setMeasurementForm((current) => ({ ...current, maximum: event.target.value }))} /></Field>
                <Field label={tt('productionUx.forms.average', 'Average')} htmlFor="growth-measurement-avg"><Input id="growth-measurement-avg" type="number" min={measurementForm.measurementType === 'temperature' ? undefined : '0'} step="0.000001" value={measurementForm.average} onChange={(event) => setMeasurementForm((current) => ({ ...current, average: event.target.value }))} /></Field>
              </div>
              <Field label={tt('productionUx.forms.description', 'Description')} htmlFor="growth-measurement-description">
                <Input id="growth-measurement-description" value={measurementForm.description} onChange={(event) => setMeasurementForm((current) => ({ ...current, description: event.target.value }))} placeholder={tt('productionUx.forms.requiredForOther', 'Required only for Other')} />
              </Field>
              <Field label={tt('productionUx.common.notes', 'Notes')} htmlFor="growth-measurement-notes">
                <Textarea id="growth-measurement-notes" value={measurementForm.notes} onChange={(event) => setMeasurementForm((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMeasurementOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" onClick={recordMeasurement} disabled={saving}>{tt('productionUx.growth.actions.measurement', 'Record measurement')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={directCostOpen} onOpenChange={setDirectCostOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.actions.memoCost', 'Add direct memo cost')}</DialogTitle>
            <DialogDescription>{tt('productionUx.growth.memoCostDescription', 'Direct memo costs update only the Growth Batch operational cost rollup and create no finance posting.')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tt('productionUx.forms.category', 'Category')} htmlFor="growth-direct-cost-category">
                  <Select value={directCostForm.category} onValueChange={(value) => setDirectCostForm((current) => ({ ...current, category: value as DirectCostCategory }))}>
                    <SelectTrigger id="growth-direct-cost-category" aria-label={tt('productionUx.forms.directCostCategory', 'Direct cost category')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {directCostCategories.map((category) => <SelectItem key={category} value={category}>{domainLabel(category)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={tt('productionUx.forms.eventDate', 'Event date')} htmlFor="growth-direct-cost-date">
                  <Input id="growth-direct-cost-date" type="date" value={directCostForm.eventDate} onChange={(event) => setDirectCostForm((current) => ({ ...current, eventDate: event.target.value }))} />
                </Field>
              </div>
              <Field label={tt('productionUx.forms.description', 'Description')} htmlFor="growth-direct-cost-description">
                <Input id="growth-direct-cost-description" value={directCostForm.description} onChange={(event) => setDirectCostForm((current) => ({ ...current, description: event.target.value }))} />
              </Field>
              <Field label={`${tt('productionUx.forms.amount', 'Amount')} (${selectedCurrency})`} htmlFor="growth-direct-cost-amount">
                <Input id="growth-direct-cost-amount" type="number" min="0.01" step="0.01" value={directCostForm.amount} onChange={(event) => setDirectCostForm((current) => ({ ...current, amount: event.target.value }))} />
              </Field>
              <Field label={tt('productionUx.common.notes', 'Notes')} htmlFor="growth-direct-cost-notes">
                <Textarea id="growth-direct-cost-notes" value={directCostForm.notes} onChange={(event) => setDirectCostForm((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDirectCostOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" onClick={recordDirectCost} disabled={saving}>{tt('productionUx.growth.actions.memoCost', 'Add direct memo cost')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stockInputOpen} onOpenChange={setStockInputOpen}>
        <DialogContent className="max-w-5xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.actions.stockInput', 'Post stock input')}</DialogTitle>
            <DialogDescription>
              {tt('productionUx.growth.stockInputDescription', 'This records physical stock consumption and material cost for the batch. It does not create a supplier bill, cash payment, bank transaction or finance journal.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tt('productionUx.forms.effectiveDate', 'Effective date')} htmlFor="growth-stock-input-date">
                  <Input
                    id="growth-stock-input-date"
                    type="date"
                    value={stockInputForm.effectiveDate}
                    onChange={(event) => {
                      markStockInputPreviewStale()
                      setStockInputForm((current) => ({ ...current, effectiveDate: event.target.value }))
                    }}
                  />
                </Field>
                <Field label={tt('productionUx.forms.transactionNotes', 'Transaction notes')} htmlFor="growth-stock-input-notes">
                  <Input
                    id="growth-stock-input-notes"
                    value={stockInputForm.notes}
                    onChange={(event) => {
                      markStockInputPreviewStale()
                      setStockInputForm((current) => ({ ...current, notes: event.target.value }))
                    }}
                    placeholder={tt('productionUx.common.optional', 'Optional')}
                  />
                </Field>
              </div>

              <div className="space-y-3">
                {stockInputForm.lines.map((line, index) => {
                  const item = itemById.get(line.itemId)
                  const previewLine = stockInputPreview?.lines?.find((row) => row.line_no === index + 1)
                  const lineBins = bins.filter((bin) => !line.sourceWarehouseId || bin.warehouseId === line.sourceWarehouseId)
                  return (
                    <div key={line.clientId} className="rounded-xl border border-card-border bg-card p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="font-medium">{tt('productionUx.forms.line', 'Line')} {index + 1}</div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`${tt('productionUx.forms.removeStockInputLine', 'Remove stock input line')} ${index + 1}`}
                          onClick={() => removeStockInputLine(line.clientId)}
                          disabled={stockInputForm.lines.length === 1 || saving}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1.3fr)_9rem_minmax(12rem,1fr)_minmax(12rem,1fr)]">
                        <Field label={tt('productionUx.forms.item', 'Item')} htmlFor={`growth-stock-input-item-${line.clientId}`}>
                          <Select value={line.itemId || 'none'} onValueChange={(value) => updateStockInputLine(line.clientId, { itemId: value === 'none' ? '' : value })}>
                            <SelectTrigger id={`growth-stock-input-item-${line.clientId}`} aria-label={`${tt('productionUx.forms.stockInputItemLine', 'Stock input item line')} ${index + 1}`}>
                              <SelectValue placeholder={tt('productionUx.forms.selectItem', 'Select item')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{tt('productionUx.forms.selectItem', 'Select item')}</SelectItem>
                              {items.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.sku ? `${option.sku} - ` : ''}{option.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field
                          label={tt('productionUx.forms.quantity', 'Quantity')}
                          htmlFor={`growth-stock-input-qty-${line.clientId}`}
                          hint={item?.base_uom_id
                            ? `${tt('productionUx.forms.baseUnit', 'Base unit')}: ${uomById.get(item.base_uom_id)?.code || tt('productionUx.common.unavailable', 'Unavailable')}`
                            : tt('productionUx.forms.baseUnitAfterSelection', 'Base unit appears after item selection.')}
                        >
                          <Input
                            id={`growth-stock-input-qty-${line.clientId}`}
                            type="number"
                            min="0.000001"
                            step="0.000001"
                            value={line.quantity}
                            onChange={(event) => updateStockInputLine(line.clientId, { quantity: event.target.value })}
                          />
                        </Field>
                        <Field label={tt('productionUx.forms.sourceWarehouse', 'Source warehouse')} htmlFor={`growth-stock-input-wh-${line.clientId}`}>
                          <Select value={line.sourceWarehouseId || 'none'} onValueChange={(value) => updateStockInputLine(line.clientId, { sourceWarehouseId: value === 'none' ? '' : value })}>
                            <SelectTrigger id={`growth-stock-input-wh-${line.clientId}`} aria-label={`${tt('productionUx.forms.stockInputSourceWarehouseLine', 'Stock input source warehouse line')} ${index + 1}`}><SelectValue placeholder={tt('productionUx.selectWarehouse', 'Select warehouse')} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{tt('productionUx.selectWarehouse', 'Select warehouse')}</SelectItem>
                              {warehouses.map((warehouse) => (
                                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label={tt('productionUx.forms.sourceBin', 'Source bin')} htmlFor={`growth-stock-input-bin-${line.clientId}`}>
                          <Select value={line.sourceBinId || 'none'} onValueChange={(value) => updateStockInputLine(line.clientId, { sourceBinId: value === 'none' ? '' : value })}>
                            <SelectTrigger id={`growth-stock-input-bin-${line.clientId}`} aria-label={`${tt('productionUx.forms.stockInputSourceBinLine', 'Stock input source bin line')} ${index + 1}`}><SelectValue placeholder={tt('productionUx.selectBin', 'Select bin')} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{tt('productionUx.selectBin', 'Select bin')}</SelectItem>
                              {lineBins.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} - {bin.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <Field label={tt('productionUx.forms.lineNotes', 'Line notes')} htmlFor={`growth-stock-input-notes-${line.clientId}`}>
                        <Input
                          id={`growth-stock-input-notes-${line.clientId}`}
                          value={line.lineNotes}
                          onChange={(event) => updateStockInputLine(line.clientId, { lineNotes: event.target.value })}
                          placeholder={tt('productionUx.common.optional', 'Optional')}
                        />
                      </Field>
                      {previewLine ? (
                        <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-3">
                          <SummaryItem label={tt('productionUx.forms.available', 'Available')} value={qtyWithUom(previewLine.available_quantity, uomById.get(previewLine.uom_id)?.code)} />
                          <SummaryItem label={tt('productionUx.forms.estimatedWac', 'Estimated WAC')} value={money(previewLine.estimated_unit_cost, selectedCurrency)} />
                          <SummaryItem label={tt('productionUx.forms.lineMaterialCost', 'Line material cost')} value={money(previewLine.estimated_line_cost, selectedCurrency)} />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              <Button type="button" variant="outline" onClick={addStockInputLine} disabled={saving}>
                <Plus className="mr-2 h-4 w-4" />
                {tt('productionUx.forms.addLine', 'Add line')}
              </Button>

              {stockInputPreview ? (
                <div className={cn('rounded-xl border p-4 text-sm', stockInputPreview.ready && !stockInputPreviewStale ? 'border-status-success-border bg-status-success-muted' : 'border-status-warning-border bg-status-warning-muted')}>
                  <div className="font-medium">{stockInputPreviewStale
                    ? tt('productionUx.forms.previewStale', 'Preview is stale')
                    : stockInputPreview.ready
                      ? tt('productionUx.forms.previewReady', 'Preview ready')
                      : tt('productionUx.forms.previewBlockers', 'Preview blockers')}</div>
                  {stockInputPreview.blocking_reasons?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {stockInputPreview.blocking_reasons.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{growthError(String(blocker.code || 'blocker'))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <SummaryItem label={tt('productionUx.forms.materialDelta', 'Material delta')} value={money(stockInputPreview.estimated_total_material_cost, selectedCurrency)} />
                    <SummaryItem label={tt('productionUx.forms.projectedMaterial', 'Projected material')} value={money(stockInputPreview.projected_material_cost, selectedCurrency)} />
                    <SummaryItem label={tt('productionUx.forms.projectedRemaining', 'Projected remaining')} value={money(stockInputPreview.projected_remaining_cost, selectedCurrency)} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStockInputOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" variant="outline" onClick={previewStockInput} disabled={saving}>{tt('productionUx.forms.preview', 'Preview')}</Button>
            <Button type="button" onClick={postStockInput} disabled={saving || !stockInputPreview || stockInputPreviewStale || !stockInputPreview.ready}>
              <PackageMinus className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.actions.stockInput', 'Post stock input')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-3xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{transferCopy.dialog.title}</DialogTitle>
            <DialogDescription>
              {transferCopy.dialog.description}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="rounded-xl border border-card-border bg-muted/20 p-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <SummaryItem label={transferCopy.labels.currentLocation} value={transferSourceLocationLabel()} />
                  <SummaryItem label={transferCopy.labels.entireCurrentQuantity} value={`${qty(detailBatch?.current_primary_qty ?? detailBatch?.opening_primary_qty)} ${detailBatch?.primary_uom_code || ''}`.trim()} />
                  <SummaryItem label={transferCopy.labels.latestTotalWeight} value={detailBatch?.latest_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                  <SummaryItem label={transferCopy.labels.costs} value={transferCopy.fallback.unchanged} />
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {transferCopy.dialog.stockNote}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={transferCopy.labels.destinationWarehouse} htmlFor="growth-transfer-warehouse">
                  <Select value={transferForm.destinationWarehouseId || 'none'} onValueChange={setTransferWarehouse}>
                    <SelectTrigger id="growth-transfer-warehouse" aria-label={transferCopy.aria.destinationWarehouse}><SelectValue placeholder={transferCopy.dialog.warehousePlaceholder} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{transferCopy.dialog.warehousePlaceholder}</SelectItem>
                      {activeWarehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {locationDisplay([warehouse.name, warehouse.code])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={transferCopy.labels.destinationBin} htmlFor="growth-transfer-bin" hint={transferCopy.dialog.binHint}>
                  <Select
                    value={transferForm.destinationBinId || 'none'}
                    onValueChange={(value) => {
                      markTransferPreviewStale()
                      setTransferForm((current) => ({ ...current, destinationBinId: value === 'none' ? '' : value }))
                    }}
                    disabled={!transferForm.destinationWarehouseId}
                  >
                    <SelectTrigger id="growth-transfer-bin" aria-label={transferCopy.aria.destinationBin}><SelectValue placeholder={transferCopy.dialog.binPlaceholder} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{transferCopy.dialog.noBin}</SelectItem>
                      {binsForTransfer.map((bin) => (
                        <SelectItem key={bin.id} value={bin.id}>
                          {locationDisplay([bin.code, bin.name])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={transferCopy.labels.effectiveDate} htmlFor="growth-transfer-date">
                  <Input
                    id="growth-transfer-date"
                    type="date"
                    value={transferForm.effectiveDate}
                    onChange={(event) => {
                      markTransferPreviewStale()
                      setTransferForm((current) => ({ ...current, effectiveDate: event.target.value }))
                    }}
                  />
                </Field>
                <Field label={transferCopy.labels.purpose} htmlFor="growth-transfer-reason">
                  <Select
                    value={transferForm.reasonCode || 'none'}
                    onValueChange={(value) => {
                      markTransferPreviewStale()
                      setTransferForm((current) => ({ ...current, reasonCode: value === 'none' ? '' : value as TransferReasonCode }))
                    }}
                  >
                    <SelectTrigger id="growth-transfer-reason" aria-label={transferCopy.aria.transferPurpose}><SelectValue placeholder={transferCopy.dialog.purposePlaceholder} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{transferCopy.dialog.purposePlaceholder}</SelectItem>
                      {transferReasons.map((reason) => <SelectItem key={reason} value={reason}>{transferReasonLabel(reason)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={transferCopy.labels.locationNote} htmlFor="growth-transfer-location-note" hint={transferCopy.dialog.locationNoteHint}>
                  <Input
                    id="growth-transfer-location-note"
                    value={transferForm.locationDescription}
                    onChange={(event) => {
                      markTransferPreviewStale()
                      setTransferForm((current) => ({ ...current, locationDescription: event.target.value }))
                    }}
                  />
                </Field>
                <Field label={transferCopy.labels.notes} htmlFor="growth-transfer-notes" hint={transferForm.reasonCode === 'other' ? transferCopy.dialog.notesRequiredHint : transferCopy.dialog.notesOptionalHint}>
                  <Input
                    id="growth-transfer-notes"
                    value={transferForm.notes}
                    onChange={(event) => {
                      markTransferPreviewStale()
                      setTransferForm((current) => ({ ...current, notes: event.target.value }))
                    }}
                  />
                </Field>
              </div>

              {transferPreview ? (
                <div className={cn('rounded-xl border p-4 text-sm', transferPreview.ready && !transferPreviewStale ? 'border-status-success-border bg-status-success-muted' : 'border-status-warning-border bg-status-warning-muted')}>
                  <div className="font-medium">{transferPreviewStale ? transferCopy.preview.stale : transferPreview.ready ? transferCopy.preview.ready : transferCopy.preview.blockers}</div>
                  {transferPreview.blocking_reasons?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {transferPreview.blocking_reasons.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{transferBlockerLabel(String(blocker.code || ''))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <SummaryItem label={transferCopy.labels.from} value={transferPreviewLocationLabel(transferPreview.source_location)} />
                    <SummaryItem label={transferCopy.labels.to} value={transferPreviewLocationLabel(transferPreview.destination_location)} />
                    <SummaryItem label={transferCopy.labels.entireQuantity} value={qtyWithUom(transferPreview.current_quantity, transferPreview.quantity_uom_code || detailBatch?.primary_uom_code)} />
                    <SummaryItem label={transferCopy.labels.entireWeight} value={transferPreview.current_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(transferPreview.current_total_weight, transferPreview.weight_uom_code || detailBatch?.weight_uom_code)} />
                    <SummaryItem label={transferCopy.labels.stockLedger} value={transferCopy.fallback.notAffected} />
                    <SummaryItem label={transferCopy.labels.costs} value={transferCopy.fallback.unchanged} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransferOpen(false)} disabled={saving}>{transferCopy.actions.close}</Button>
            <Button type="button" variant="outline" onClick={previewTransfer} disabled={saving}>{transferCopy.actions.preview}</Button>
            <Button type="button" onClick={postTransfer} disabled={saving || !transferPreview || transferPreviewStale || !transferPreview.ready}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {transferCopy.actions.transferBatch}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferReversalOpen} onOpenChange={setTransferReversalOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{transferCopy.dialog.reversalTitle}</DialogTitle>
            <DialogDescription>
              {transferCopy.dialog.reversalDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <SummaryItem label={transferCopy.labels.originalEvent} value={transferReversalForm.eventReference || transferCopy.fallback.notSelected} />
              <Field label={transferCopy.labels.effectiveDate} htmlFor="growth-transfer-reversal-date">
                <Input
                  id="growth-transfer-reversal-date"
                  type="date"
                  value={transferReversalForm.effectiveDate}
                  onChange={(event) => setTransferReversalForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                />
              </Field>
              <Field label={transferCopy.labels.reason} htmlFor="growth-transfer-reversal-reason">
                <Textarea
                  id="growth-transfer-reversal-reason"
                  value={transferReversalForm.reason}
                  onChange={(event) => setTransferReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTransferReversalOpen(false)} disabled={saving}>{transferCopy.actions.close}</Button>
            <Button type="button" variant="destructive" onClick={reverseTransfer} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {transferCopy.actions.reverseTransfer}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={harvestOpen} onOpenChange={setHarvestOpen}>
        <DialogContent className="max-w-4xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{harvestCopy.dialog.title}</DialogTitle>
            <DialogDescription>
              {harvestCopy.dialog.description}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="rounded-xl border border-card-border bg-muted/20 p-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryItem label={harvestCopy.labels.currentQuantity} value={`${qty(detailBatch?.current_primary_qty ?? detailBatch?.opening_primary_qty)} ${detailBatch?.primary_uom_code || ''}`.trim()} />
                  <SummaryItem label={harvestCopy.labels.currentWeight} value={detailBatch?.latest_total_weight == null ? harvestCopy.fallback.notRecorded : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                  <SummaryItem label={harvestCopy.labels.remainingCost} value={money(detailBatch?.remaining_cost, selectedCurrency)} />
                  <SummaryItem label={harvestCopy.labels.sourceLocation} value={transferSourceLocationLabel()} />
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {harvestCopy.preview.noSaleNoFinance}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={harvestCopy.labels.harvestedQuantity} htmlFor="growth-harvest-quantity" hint={`${harvestCopy.labels.currentQuantity}: ${qtyWithUom(detailBatch?.current_primary_qty ?? detailBatch?.opening_primary_qty, detailBatch?.primary_uom_code)}`}>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="growth-harvest-quantity"
                      type="number"
                      min="0"
                      step={detailBatch?.primary_quantity_basis === 'count' ? '1' : '0.000001'}
                      value={harvestForm.harvestedPrimaryQty}
                      onChange={(event) => {
                        markHarvestPreviewStale()
                        setHarvestForm((current) => ({ ...current, harvestedPrimaryQty: event.target.value }))
                      }}
                    />
                    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={fillHarvestAllRemaining} disabled={saving}>
                      {harvestCopy.actions.harvestAll}
                    </Button>
                  </div>
                </Field>
                <Field label={harvestCopy.labels.harvestedWeight} htmlFor="growth-harvest-weight" hint={detailBatch?.latest_total_weight == null ? harvestCopy.fallback.notRecorded : harvestCopy.dialog.weightRequiredHint}>
                  <Input
                    id="growth-harvest-weight"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={harvestForm.harvestedWeight}
                    onChange={(event) => {
                      markHarvestPreviewStale()
                      setHarvestForm((current) => ({ ...current, harvestedWeight: event.target.value }))
                    }}
                    disabled={detailBatch?.latest_total_weight == null}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={harvestCopy.labels.outputItem} htmlFor="growth-harvest-output-item" hint={harvestCopy.dialog.outputHint}>
                  <Select
                    value={harvestForm.outputItemId || 'none'}
                    onValueChange={(value) => {
                      markHarvestPreviewStale()
                      setHarvestForm((current) => ({ ...current, outputItemId: value === 'none' ? '' : value }))
                    }}
                  >
                    <SelectTrigger id="growth-harvest-output-item" aria-label={harvestCopy.aria.outputItem}><SelectValue placeholder={harvestCopy.dialog.outputPlaceholder} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{harvestCopy.dialog.outputPlaceholder}</SelectItem>
                      {harvestOutputItems.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {[item.name, item.sku, uomById.get(item.base_uom_id || '')?.code].filter(Boolean).join(' / ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={harvestCopy.labels.outputQuantity} htmlFor="growth-harvest-output-quantity" hint={`${harvestCopy.labels.outputBaseUom}: ${uomById.get(selectedHarvestOutputItem?.base_uom_id || '')?.code || harvestCopy.fallback.notSelected}`}>
                  <Input
                    id="growth-harvest-output-quantity"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={harvestForm.outputQuantity}
                    onChange={(event) => {
                      markHarvestPreviewStale()
                      setHarvestForm((current) => ({ ...current, outputQuantity: event.target.value }))
                    }}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={harvestCopy.labels.destinationWarehouse} htmlFor="growth-harvest-warehouse">
                  <Select value={harvestForm.destinationWarehouseId || 'none'} onValueChange={setHarvestWarehouse}>
                    <SelectTrigger id="growth-harvest-warehouse" aria-label={harvestCopy.aria.destinationWarehouse}><SelectValue placeholder={harvestCopy.dialog.warehousePlaceholder} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{harvestCopy.dialog.warehousePlaceholder}</SelectItem>
                      {activeWarehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {locationDisplay([warehouse.name, warehouse.code])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={harvestCopy.labels.destinationBin} htmlFor="growth-harvest-bin">
                  <Select
                    value={harvestForm.destinationBinId || 'none'}
                    onValueChange={(value) => {
                      markHarvestPreviewStale()
                      setHarvestForm((current) => ({ ...current, destinationBinId: value === 'none' ? '' : value }))
                    }}
                    disabled={!harvestForm.destinationWarehouseId}
                  >
                    <SelectTrigger id="growth-harvest-bin" aria-label={harvestCopy.aria.destinationBin}><SelectValue placeholder={harvestCopy.dialog.binPlaceholder} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{harvestCopy.fallback.noBin}</SelectItem>
                      {binsForHarvest.map((bin) => (
                        <SelectItem key={bin.id} value={bin.id}>
                          {locationDisplay([bin.code, bin.name])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={harvestCopy.labels.effectiveDate} htmlFor="growth-harvest-date">
                  <Input
                    id="growth-harvest-date"
                    type="date"
                    value={harvestForm.effectiveDate}
                    onChange={(event) => {
                      markHarvestPreviewStale()
                      setHarvestForm((current) => ({ ...current, effectiveDate: event.target.value }))
                    }}
                  />
                </Field>
                <Field label={harvestCopy.labels.notes} htmlFor="growth-harvest-notes" hint={harvestCopy.dialog.notesHint}>
                  <Input
                    id="growth-harvest-notes"
                    value={harvestForm.notes}
                    onChange={(event) => {
                      markHarvestPreviewStale()
                      setHarvestForm((current) => ({ ...current, notes: event.target.value }))
                    }}
                  />
                </Field>
              </div>

              {harvestPreview ? (
                <div className={cn('rounded-xl border p-4 text-sm', harvestPreview.ready && !harvestPreviewStale ? 'border-status-success-border bg-status-success-muted' : 'border-status-warning-border bg-status-warning-muted')}>
                  <div className="font-medium">{harvestPreviewStale ? harvestCopy.preview.stale : harvestPreview.ready ? harvestCopy.preview.ready : harvestCopy.preview.blockers}</div>
                  {harvestPreview.blocking_reasons?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {harvestPreview.blocking_reasons.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{harvestBlockerLabel(String(blocker.code || ''))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryItem label={harvestCopy.labels.harvestKind} value={harvestKindLabel(harvestPreview.harvest_kind)} />
                    <SummaryItem label={harvestCopy.labels.before} value={qtyWithUom(harvestPreview.current_quantity, harvestPreview.primary_uom_code || detailBatch?.primary_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.harvestedQuantity} value={qtyWithUom(harvestPreview.harvested_primary_qty, harvestPreview.primary_uom_code || detailBatch?.primary_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.after} value={qtyWithUom(harvestPreview.resulting_quantity, harvestPreview.primary_uom_code || detailBatch?.primary_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.harvestedWeight} value={harvestPreview.harvested_total_weight == null ? harvestCopy.fallback.notRecorded : qtyWithUom(harvestPreview.harvested_total_weight, harvestPreview.weight_uom_code || detailBatch?.weight_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.outputItem} value={harvestPreview.output_item_name || harvestCopy.fallback.notSelected} />
                    <SummaryItem label={harvestCopy.labels.outputQuantity} value={qtyWithUom(harvestPreview.output_quantity, harvestPreview.output_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.destinationLocation} value={harvestLocationLabel(harvestPreview.destination_location)} />
                    <SummaryItem label={harvestCopy.labels.allocatedCost} value={money(harvestPreview.allocated_cost, selectedCurrency)} />
                    <SummaryItem label={harvestCopy.labels.outputUnitCost} value={money(harvestPreview.output_unit_cost, selectedCurrency)} />
                    <SummaryItem label={harvestCopy.labels.remainingCost} value={money(harvestPreview.remaining_cost_after, selectedCurrency)} />
                    <SummaryItem label={harvestCopy.labels.stockReceipt} value={harvestPreview.stock_effect_note || harvestCopy.fallback.notAffected} />
                    <SummaryItem label={harvestCopy.labels.finance} value={harvestCopy.fallback.notAffected} />
                    <SummaryItem label={harvestCopy.labels.sale} value={harvestCopy.fallback.notAffected} />
                    <SummaryItem label={harvestCopy.labels.cogs} value={harvestCopy.fallback.notAffected} />
                    <SummaryItem label={harvestCopy.labels.sellingPrice} value={harvestCopy.fallback.unchanged} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setHarvestOpen(false)} disabled={saving}>{harvestCopy.actions.close}</Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={previewHarvest} disabled={saving}>{harvestCopy.actions.preview}</Button>
            <Button type="button" className="w-full sm:w-auto" onClick={postHarvest} disabled={saving || !harvestPreview || harvestPreviewStale || !harvestPreview.ready}>
              <Sprout className="mr-2 h-4 w-4" />
              {harvestCopy.actions.recordHarvest}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={harvestReversalOpen} onOpenChange={setHarvestReversalOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{harvestCopy.dialog.reversalTitle}</DialogTitle>
            <DialogDescription>
              {harvestCopy.dialog.reversalDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <SummaryItem label={harvestCopy.labels.originalEvent} value={harvestReversalForm.eventReference || harvestCopy.fallback.notSelected} />
              <Field label={harvestCopy.labels.effectiveDate} htmlFor="growth-harvest-reversal-date">
                <Input
                  id="growth-harvest-reversal-date"
                  type="date"
                  value={harvestReversalForm.effectiveDate}
                  onChange={(event) => setHarvestReversalForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                />
              </Field>
              <Field label={harvestCopy.labels.reason} htmlFor="growth-harvest-reversal-reason">
                <Textarea
                  id="growth-harvest-reversal-reason"
                  value={harvestReversalForm.reason}
                  onChange={(event) => setHarvestReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setHarvestReversalOpen(false)} disabled={saving}>{harvestCopy.actions.close}</Button>
            <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={reverseHarvest} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {harvestCopy.actions.reverseHarvest}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completionOpen} onOpenChange={setCompletionOpen}>
        <DialogContent className="max-w-3xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{completionCopy.dialog.title}</DialogTitle>
            <DialogDescription>
              {completionCopy.dialog.description}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="rounded-xl border border-card-border bg-muted/20 p-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryItem label={completionCopy.labels.currentStatus} value={completionStatusLabel(detailBatch?.status || 'active')} />
                  <SummaryItem label={completionCopy.labels.afterStatus} value={completionStatusLabel('completed')} />
                  <SummaryItem label={completionCopy.labels.currentQuantity} value={qtyWithUom(detailBatch?.current_primary_qty ?? detailBatch?.opening_primary_qty, detailBatch?.primary_uom_code)} />
                  <SummaryItem label={completionCopy.labels.currentWeight} value={detailBatch?.latest_total_weight == null ? completionCopy.fallback.notRecorded : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                  <SummaryItem label={completionCopy.labels.remainingCost} value={money(detailBatch?.remaining_cost, selectedCurrency)} />
                  <SummaryItem label={completionCopy.labels.stockLedger} value={completionCopy.fallback.notAffected} />
                  <SummaryItem label={completionCopy.labels.finance} value={completionCopy.fallback.notAffected} />
                  <SummaryItem label={completionCopy.labels.sellingPrice} value={completionCopy.fallback.unchanged} />
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {completionCopy.preview.lifecycleOnly}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={completionCopy.labels.effectiveDate} htmlFor="growth-completion-date">
                  <Input
                    id="growth-completion-date"
                    type="date"
                    value={completionForm.effectiveDate}
                    onChange={(event) => {
                      markCompletionPreviewStale()
                      setCompletionForm((current) => ({ ...current, effectiveDate: event.target.value }))
                    }}
                  />
                </Field>
                <Field label={completionCopy.labels.reason} htmlFor="growth-completion-reason">
                  <Input
                    id="growth-completion-reason"
                    value={completionForm.reason}
                    onChange={(event) => {
                      markCompletionPreviewStale()
                      setCompletionForm((current) => ({ ...current, reason: event.target.value }))
                    }}
                  />
                </Field>
              </div>

              <Field label={completionCopy.labels.notes} htmlFor="growth-completion-notes" hint={completionCopy.dialog.notesHint}>
                <Textarea
                  id="growth-completion-notes"
                  value={completionForm.notes}
                  onChange={(event) => {
                    markCompletionPreviewStale()
                    setCompletionForm((current) => ({ ...current, notes: event.target.value }))
                  }}
                />
              </Field>

              {completionPreview ? (
                <div className={cn('rounded-xl border p-4 text-sm', completionPreview.ready && !completionPreviewStale ? 'border-status-success-border bg-status-success-muted' : 'border-status-warning-border bg-status-warning-muted')}>
                  <div className="font-medium">{completionPreviewStale ? completionCopy.preview.stale : completionPreview.ready ? completionCopy.preview.ready : completionCopy.preview.blockers}</div>
                  {completionPreview.blockers?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {completionPreview.blockers.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{completionBlockerLabel(String(blocker.code || ''))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryItem label={completionCopy.labels.currentStatus} value={completionStatusLabel(completionPreview.status_before)} />
                    <SummaryItem label={completionCopy.labels.afterStatus} value={completionStatusLabel(completionPreview.status_after)} />
                    <SummaryItem label={completionCopy.labels.currentQuantity} value={qtyWithUom(completionPreview.current_primary_qty, completionPreview.primary_uom_code || detailBatch?.primary_uom_code)} />
                    <SummaryItem label={completionCopy.labels.currentWeight} value={completionPreview.current_total_weight == null ? completionCopy.fallback.notRecorded : qtyWithUom(completionPreview.current_total_weight, completionPreview.weight_uom_code || detailBatch?.weight_uom_code)} />
                    <SummaryItem label={completionCopy.labels.accumulatedCost} value={money(completionPreview.accumulated_total_cost, selectedCurrency)} />
                    <SummaryItem label={completionCopy.labels.harvestedCost} value={money(completionPreview.harvested_cost, selectedCurrency)} />
                    <SummaryItem label={completionCopy.labels.remainingCost} value={money(completionPreview.remaining_cost, selectedCurrency)} />
                    <SummaryItem label={completionCopy.labels.stockLedger} value={completionCopy.fallback.notAffected} />
                    <SummaryItem label={completionCopy.labels.finance} value={completionCopy.fallback.notAffected} />
                    <SummaryItem label={completionCopy.labels.sale} value={completionCopy.fallback.notAffected} />
                    <SummaryItem label={completionCopy.labels.cogs} value={completionCopy.fallback.notAffected} />
                    <SummaryItem label={completionCopy.labels.sellingPrice} value={completionCopy.fallback.unchanged} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setCompletionOpen(false)} disabled={saving}>{completionCopy.actions.close}</Button>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={previewCompletion} disabled={saving}>{completionCopy.actions.preview}</Button>
            <Button type="button" className="w-full sm:w-auto" onClick={completeBatch} disabled={saving || !completionPreview || completionPreviewStale || !completionPreview.ready}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {completionCopy.actions.completeBatch}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completionReversalOpen} onOpenChange={setCompletionReversalOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{completionCopy.dialog.reversalTitle}</DialogTitle>
            <DialogDescription>
              {completionCopy.dialog.reversalDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <SummaryItem label={completionCopy.labels.originalEvent} value={completionReversalForm.eventReference || completionCopy.fallback.notSelected} />
              <Field label={completionCopy.labels.effectiveDate} htmlFor="growth-completion-reversal-date">
                <Input
                  id="growth-completion-reversal-date"
                  type="date"
                  value={completionReversalForm.effectiveDate}
                  onChange={(event) => setCompletionReversalForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                />
              </Field>
              <Field label={completionCopy.labels.reason} htmlFor="growth-completion-reversal-reason">
                <Textarea
                  id="growth-completion-reversal-reason"
                  value={completionReversalForm.reason}
                  onChange={(event) => setCompletionReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setCompletionReversalOpen(false)} disabled={saving}>{completionCopy.actions.close}</Button>
            <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={reverseCompletion} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {completionCopy.actions.reverseCompletion}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lossOpen} onOpenChange={setLossOpen}>
        <DialogContent className="max-w-3xl" closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.lossTitle', 'Record mortality or shrinkage')}</DialogTitle>
            <DialogDescription>
              {tt('productionUx.growth.lossDescription', 'This records operational biological loss only. It updates current batch quantity and/or weight without stock movements, finance rows, or cost write-off.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tt('productionUx.forms.lossType', 'Loss type')} htmlFor="growth-loss-type">
                  <Select value={lossForm.lossType} onValueChange={(value) => setLossType(value as LossType)}>
                    <SelectTrigger id="growth-loss-type" aria-label={tt('productionUx.forms.lossType', 'Loss type')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mortality">{tt('productionUx.growth.mortality', 'Mortality')}</SelectItem>
                      <SelectItem value="shrinkage">{tt('productionUx.growth.shrinkage', 'Shrinkage')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={tt('productionUx.forms.effectiveDate', 'Effective date')} htmlFor="growth-loss-date">
                  <Input
                    id="growth-loss-date"
                    type="date"
                    value={lossForm.effectiveDate}
                    onChange={(event) => {
                      markLossPreviewStale()
                      setLossForm((current) => ({ ...current, effectiveDate: event.target.value }))
                    }}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={`${tt('productionUx.forms.quantityLost', 'Quantity lost')} (${detailBatch?.primary_uom_code || tt('productionUx.forms.unit', 'Unit')})`}
                  htmlFor="growth-loss-quantity"
                  hint={`${tt('productionUx.forms.current', 'Current')}: ${qtyWithUom(detailBatch?.current_primary_qty ?? detailBatch?.opening_primary_qty, detailBatch?.primary_uom_code)}`}
                >
                  <Input
                    id="growth-loss-quantity"
                    type="number"
                    min="0"
                    step={detailBatch?.primary_quantity_basis === 'count' ? '1' : '0.000001'}
                    value={lossForm.quantityLost}
                    onChange={(event) => {
                      markLossPreviewStale()
                      setLossForm((current) => ({ ...current, quantityLost: event.target.value }))
                    }}
                  />
                </Field>
                {detailBatch?.weight_uom_id ? (
                  <Field
                    label={`${tt('productionUx.forms.weightLost', 'Weight lost')} (${detailBatch.weight_uom_code || tt('productionUx.forms.unit', 'Unit')})`}
                    htmlFor="growth-loss-weight"
                    hint={`${tt('productionUx.forms.current', 'Current')}: ${detailBatch.latest_total_weight == null ? tt('productionUx.common.notRecorded', 'Not recorded') : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)}`}
                  >
                    <Input
                      id="growth-loss-weight"
                      type="number"
                      min="0"
                      step="0.000001"
                      value={lossForm.weightLost}
                      onChange={(event) => {
                        markLossPreviewStale()
                        setLossForm((current) => ({ ...current, weightLost: event.target.value }))
                      }}
                    />
                  </Field>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={tt('productionUx.forms.reason', 'Reason')} htmlFor="growth-loss-reason">
                  <Select
                    value={lossForm.reasonCode || 'none'}
                    onValueChange={(value) => {
                      markLossPreviewStale()
                      setLossForm((current) => ({ ...current, reasonCode: value === 'none' ? '' : value as LossReasonCode }))
                    }}
                  >
                    <SelectTrigger id="growth-loss-reason" aria-label={tt('productionUx.forms.lossReason', 'Loss reason')}><SelectValue placeholder={tt('productionUx.forms.selectReason', 'Select reason')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tt('productionUx.forms.selectReason', 'Select reason')}</SelectItem>
                      {lossReasonOptions.map((reason) => <SelectItem key={reason} value={reason}>{domainLabel(reason)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={tt('productionUx.common.notes', 'Notes')}
                  htmlFor="growth-loss-notes"
                  hint={lossForm.reasonCode === 'other'
                    ? tt('productionUx.forms.requiredForOtherShort', 'Required for Other.')
                    : tt('productionUx.forms.optionalUnlessOther', 'Optional unless reason is Other.')}
                >
                  <Input
                    id="growth-loss-notes"
                    value={lossForm.notes}
                    onChange={(event) => {
                      markLossPreviewStale()
                      setLossForm((current) => ({ ...current, notes: event.target.value }))
                    }}
                  />
                </Field>
              </div>

              {lossPreview ? (
                <div className={cn('rounded-xl border p-4 text-sm', lossPreview.ready && !lossPreviewStale ? 'border-status-success-border bg-status-success-muted' : 'border-status-warning-border bg-status-warning-muted')}>
                  <div className="font-medium">{lossPreviewStale
                    ? tt('productionUx.forms.previewStale', 'Preview is stale')
                    : lossPreview.ready
                      ? tt('productionUx.forms.previewReady', 'Preview ready')
                      : tt('productionUx.forms.previewBlockers', 'Preview blockers')}</div>
                  {lossPreview.blocking_reasons?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {lossPreview.blocking_reasons.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{growthError(String(blocker.code || 'blocker'))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <SummaryItem label={tt('productionUx.growth.quantity', 'Quantity')} value={`${qty(lossPreview.current_quantity)} -> ${qty(lossPreview.resulting_quantity)} ${lossPreview.quantity_uom_code || detailBatch?.primary_uom_code || ''}`.trim()} />
                    <SummaryItem label={tt('productionUx.growth.weight', 'Weight')} value={lossPreview.current_total_weight == null && lossPreview.resulting_total_weight == null ? tt('productionUx.common.notAffected', 'Not affected') : `${qty(lossPreview.current_total_weight)} -> ${qty(lossPreview.resulting_total_weight)} ${lossPreview.weight_uom_code || detailBatch?.weight_uom_code || ''}`.trim()} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLossOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" variant="outline" onClick={previewLoss} disabled={saving}>{tt('productionUx.forms.preview', 'Preview')}</Button>
            <Button type="button" onClick={recordLoss} disabled={saving || !lossPreview || lossPreviewStale || !lossPreview.ready}>
              <AlertTriangle className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.actions.loss', 'Record loss')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lossReversalOpen} onOpenChange={setLossReversalOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.reverseLoss', 'Reverse loss event')}</DialogTitle>
            <DialogDescription>
              {tt('productionUx.growth.reverseLossDescription', 'This creates a separate reversal event and restores the original frozen quantity and weight.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <SummaryItem label={tt('productionUx.forms.originalEvent', 'Original event')} value={lossReversalForm.eventReference || tt('productionUx.forms.notSelected', 'Not selected')} />
              <Field label={tt('productionUx.forms.reason', 'Reason')} htmlFor="growth-loss-reversal-reason">
                <Textarea
                  id="growth-loss-reversal-reason"
                  value={lossReversalForm.reason}
                  onChange={(event) => setLossReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLossReversalOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" variant="destructive" onClick={reverseLoss} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.reverseLoss', 'Reverse loss event')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reversalOpen} onOpenChange={setReversalOpen}>
        <DialogContent closeLabel={tt('common.close', 'Close')}>
          <DialogHeader>
            <DialogTitle>{tt('productionUx.growth.reverseStockInput', 'Reverse stock-input event')}</DialogTitle>
            <DialogDescription>{tt('productionUx.growth.reverseStockInputDescription', 'This creates compensating stock receipts for one stock-input event. It is not a whole-batch reversal.')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <Field label={tt('productionUx.forms.effectiveDate', 'Effective date')} htmlFor="growth-stock-reversal-date">
                <Input
                  id="growth-stock-reversal-date"
                  type="date"
                  value={reversalForm.effectiveDate}
                  onChange={(event) => setReversalForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                />
              </Field>
              <Field label={tt('productionUx.forms.reason', 'Reason')} htmlFor="growth-stock-reversal-reason">
                <Textarea
                  id="growth-stock-reversal-reason"
                  value={reversalForm.reason}
                  onChange={(event) => setReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
              <Field label={`${tt('productionUx.forms.typeReferenceToConfirm', 'Type the reference to confirm')}: ${reversalForm.eventReference}`} htmlFor="growth-stock-reversal-confirm">
                <Input
                  id="growth-stock-reversal-confirm"
                  value={reversalForm.confirmation}
                  onChange={(event) => setReversalForm((current) => ({ ...current, confirmation: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReversalOpen(false)} disabled={saving}>{tt('common.close', 'Close')}</Button>
            <Button type="button" variant="destructive" onClick={reverseStockInput} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {tt('productionUx.growth.reverseStockInput', 'Reverse stock-input event')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
