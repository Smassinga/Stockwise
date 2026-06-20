import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Coins,
  LineChart,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Save,
  Search,
  Sprout,
  WalletCards,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
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
import { Label } from '../components/ui/label'
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
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumMobileCardList } from '../components/premium/PremiumMobileCardList'
import { getPremiumPageRows } from '../components/premium/PremiumPagination'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'

type BatchFamily = 'poultry' | 'livestock' | 'fish' | 'crop' | 'nursery' | 'other'
type QuantityBasis = 'count' | 'weight' | 'area' | 'other'
type BatchStatus = 'draft' | 'active' | 'completed' | 'cancelled'
type MeasurementType = 'total_weight' | 'average_weight' | 'height' | 'area_observation' | 'temperature' | 'other'
type DirectCostCategory = 'labour' | 'utilities' | 'veterinary' | 'transport' | 'land_preparation' | 'water' | 'rent' | 'other'

type UomRow = {
  id: string
  code: string
  name: string
  family: string | null
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

type GrowthBatchRegisterRow = {
  id: string
  company_id: string
  reference_no: string
  name: string
  batch_family: BatchFamily
  primary_quantity_basis: QuantityBasis
  status: BatchStatus
  start_date: string
  expected_end_date: string | null
  opening_primary_qty: number
  current_primary_qty: number | null
  primary_uom_id: string
  primary_uom_code: string | null
  opening_total_weight: number | null
  latest_total_weight: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  area: number | null
  area_uom_id: string | null
  area_uom_code: string | null
  accumulated_material_cost: number
  accumulated_direct_cost: number
  accumulated_total_cost: number
  harvested_cost: number
  remaining_cost: number
  warehouse_id: string | null
  warehouse_name: string | null
  bin_id: string | null
  bin_code: string | null
  bin_name: string | null
  location_description: string | null
  base_currency_code: string | null
  latest_event_sequence: number
  latest_event_type: string | null
  latest_event_at: string | null
  created_at: string
  activated_at: string | null
  cancelled_at: string | null
}

type GrowthBatchCurrentState = GrowthBatchRegisterRow & {
  latest_measurement_type: MeasurementType | null
  latest_measurement_value: number | null
  latest_measurement_uom_id: string | null
  latest_measurement_uom_code: string | null
  latest_measurement_observed_at: string | null
  event_count: number
  measurement_count: number
  direct_cost_count: number
  direct_cost_total: number
  created_by: string | null
  updated_by: string | null
  activated_by: string | null
  cancelled_by: string | null
}

type GrowthBatchDetailRow = {
  id: string
  species_text: string | null
  purpose: string | null
  notes: string | null
  cancellation_reason: string | null
  created_by: string | null
  updated_by: string | null
  activated_by: string | null
  cancelled_by: string | null
  completed_by: string | null
  created_at: string
  updated_at: string
}

type GrowthBatchEventRow = {
  id: string
  event_sequence: number
  event_reference: string
  event_type: 'activation' | 'measurement' | 'direct_cost' | 'cancellation'
  event_at: string
  event_date: string
  actor_display_name: string | null
  quantity_delta: number | null
  weight_value: number | null
  weight_delta: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  direct_cost_delta: number
  total_cost_delta: number
  currency_code: string | null
  notes: string | null
  reason: string | null
  event_summary: string
  typed_detail_summary: Record<string, unknown> | null
}

type GrowthBatchMeasurementRow = {
  id: string
  event_id: string
  event_sequence: number
  event_reference: string
  event_effective_date: string
  event_created_at: string
  observed_at: string
  measurement_type: MeasurementType
  description: string | null
  value: number
  uom_id: string
  uom_code: string | null
  sample_size: number | null
  minimum_value: number | null
  maximum_value: number | null
  average_value: number | null
  notes: string | null
  actor_display_name: string | null
}

type GrowthBatchDirectCostRow = {
  id: string
  event_id: string
  event_sequence: number
  event_reference: string
  event_effective_date: string
  event_created_at: string
  event_date: string
  category: DirectCostCategory
  description: string
  amount: number
  currency_code: string
  actor_display_name: string | null
}

type DraftForm = {
  name: string
  batchFamily: BatchFamily
  primaryQuantityBasis: QuantityBasis
  openingPrimaryQty: string
  primaryUomId: string
  startDate: string
  expectedEndDate: string
  speciesText: string
  purpose: string
  openingTotalWeight: string
  weightUomId: string
  area: string
  areaUomId: string
  warehouseId: string
  binId: string
  locationDescription: string
  notes: string
}

type MeasurementForm = {
  measurementType: MeasurementType
  value: string
  uomId: string
  observedAt: string
  sampleSize: string
  minimum: string
  maximum: string
  average: string
  description: string
  notes: string
}

type DirectCostForm = {
  category: DirectCostCategory
  description: string
  amount: string
  eventDate: string
  notes: string
}

const batchFamilies: BatchFamily[] = ['poultry', 'livestock', 'fish', 'crop', 'nursery', 'other']
const quantityBases: QuantityBasis[] = ['count', 'weight', 'area', 'other']
const measurementTypes: MeasurementType[] = ['total_weight', 'average_weight', 'height', 'area_observation', 'temperature', 'other']
const directCostCategories: DirectCostCategory[] = ['labour', 'utilities', 'veterinary', 'transport', 'land_preparation', 'water', 'rent', 'other']

const statusTone: Record<BatchStatus, PremiumTone> = {
  draft: 'info',
  active: 'positive',
  completed: 'neutral',
  cancelled: 'warning',
}

const eventTone: Record<GrowthBatchEventRow['event_type'], PremiumTone> = {
  activation: 'positive',
  measurement: 'info',
  direct_cost: 'warning',
  cancellation: 'neutral',
}

const basisFamily: Record<QuantityBasis, string | null> = {
  count: 'count',
  weight: 'mass',
  area: 'area',
  other: null,
}

const today = () => new Date().toISOString().slice(0, 10)

function localDatetimeNow() {
  const now = new Date()
  now.setSeconds(0, 0)
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function labelize(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function qty(value: unknown, maximumFractionDigits = 4) {
  return num(value).toLocaleString(undefined, { maximumFractionDigits })
}

function qtyWithUom(value: unknown, uomCode?: string | null, maximumFractionDigits = 4) {
  return `${qty(value, maximumFractionDigits)} ${uomCode || 'unit not set'}`.trim()
}

function money(value: unknown, currency = 'MZN') {
  return `${currency || 'MZN'} ${num(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function compactDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : 'Not set'
}

function compactDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded'
}

function cleanText(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function requiredNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function emptyDraftForm(): DraftForm {
  return {
    name: '',
    batchFamily: 'poultry',
    primaryQuantityBasis: 'count',
    openingPrimaryQty: '1',
    primaryUomId: '',
    startDate: today(),
    expectedEndDate: '',
    speciesText: '',
    purpose: '',
    openingTotalWeight: '',
    weightUomId: '',
    area: '',
    areaUomId: '',
    warehouseId: '',
    binId: '',
    locationDescription: '',
    notes: '',
  }
}

function emptyMeasurementForm(): MeasurementForm {
  return {
    measurementType: 'total_weight',
    value: '',
    uomId: '',
    observedAt: localDatetimeNow(),
    sampleSize: '',
    minimum: '',
    maximum: '',
    average: '',
    description: '',
    notes: '',
  }
}

function emptyDirectCostForm(): DirectCostForm {
  return {
    category: 'labour',
    description: '',
    amount: '',
    eventDate: today(),
    notes: '',
  }
}

function friendlyError(error: unknown) {
  const raw = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '')
  const rules: [RegExp, string][] = [
    [/fractional_count_not_allowed/i, 'Count batches must use whole-number quantities.'],
    [/growth_batch_name_required/i, 'Enter a batch name.'],
    [/invalid_growth_batch_quantity/i, 'Opening quantity must be greater than zero.'],
    [/uom_required/i, 'Select a unit for the primary quantity.'],
    [/growth_batch_weight_uom_required/i, 'Select a weight unit before recording opening, total, or average weight.'],
    [/growth_batch_weight_uom_mismatch|growth_batch_weight_uom_must_be_mass/i, 'Weight measurements must use the batch weight unit.'],
    [/area_uom_required/i, 'Select an area unit when area is entered.'],
    [/growth_batch_area_uom_required|growth_batch_area_uom_mismatch/i, 'Area observations must use the batch area unit.'],
    [/growth_batch_height_uom_mismatch/i, 'Height measurements must use a length unit.'],
    [/invalid_growth_batch_dates/i, 'Expected end date must be on or after the start date.'],
    [/growth_batch_start_date_future/i, 'Start date cannot be in the future when activating.'],
    [/growth_batch_event_before_start/i, 'Measurement and memo cost dates must be on or after the batch start date.'],
    [/growth_batch_event_future/i, 'Measurement and memo cost dates cannot be in the future.'],
    [/growth_batch_not_draft/i, 'Only draft Growth Batches can be changed or activated.'],
    [/growth_batch_not_active/i, 'Measurements and direct costs can only be recorded on active Growth Batches.'],
    [/growth_batch_cancelled/i, 'This Growth Batch has already been cancelled.'],
    [/idempotency_key_payload_mismatch/i, 'This retry key belongs to different inputs. Change nothing and retry, or submit the updated form again.'],
    [/request_in_progress/i, 'A matching request is already in progress. Wait a moment and refresh.'],
    [/cross_company_access_denied|company_access_denied/i, 'The selected company or location is not available to your account.'],
    [/permission denied|not allowed|forbidden/i, 'Your role cannot perform this action.'],
    [/invalid_direct_cost/i, 'Enter a valid cost category, description, and amount greater than zero.'],
    [/invalid_measurement/i, 'Enter a valid measurement type, value, unit, and range.'],
  ]
  return rules.find(([pattern]) => pattern.test(raw))?.[1] || raw || 'The Growth Batch action failed.'
}

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="premium-label">{label}</div>
      <div className="mt-1 min-w-0 break-words text-sm font-medium">{value}</div>
    </div>
  )
}

function DetailSection({
  title,
  description,
  children,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className="border-card-border bg-card">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function GrowthBatches() {
  const { companyId, myRole } = useOrg()
  const isMobile = useIsMobile()
  const canOperate = hasRole(myRole, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'])

  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [batches, setBatches] = useState<GrowthBatchRegisterRow[]>([])
  const [currentState, setCurrentState] = useState<GrowthBatchCurrentState | null>(null)
  const [detailRow, setDetailRow] = useState<GrowthBatchDetailRow | null>(null)
  const [measurements, setMeasurements] = useState<GrowthBatchMeasurementRow[]>([])
  const [directCosts, setDirectCosts] = useState<GrowthBatchDirectCostRow[]>([])
  const [events, setEvents] = useState<GrowthBatchEventRow[]>([])
  const [uoms, setUoms] = useState<UomRow[]>([])
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
  const [draftForm, setDraftForm] = useState<DraftForm>(() => emptyDraftForm())
  const [editForm, setEditForm] = useState<DraftForm>(() => emptyDraftForm())
  const [measurementForm, setMeasurementForm] = useState<MeasurementForm>(() => emptyMeasurementForm())
  const [directCostForm, setDirectCostForm] = useState<DirectCostForm>(() => emptyDirectCostForm())
  const [cancelReason, setCancelReason] = useState('')

  const createRequestRef = useRef<PostingRequestKeyRef>(null)
  const activateRequestRef = useRef<PostingRequestKeyRef>(null)
  const cancelRequestRef = useRef<PostingRequestKeyRef>(null)
  const measurementRequestRef = useRef<PostingRequestKeyRef>(null)
  const directCostRequestRef = useRef<PostingRequestKeyRef>(null)

  const uomById = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom])), [uoms])
  const selectedBatch = useMemo(() => batches.find((batch) => batch.id === selectedId) || null, [batches, selectedId])
  const detailBatch = currentState || selectedBatch
  const selectedCurrency = detailBatch?.base_currency_code || 'MZN'

  const metricValues = useMemo(() => {
    const active = batches.filter((batch) => batch.status === 'active').length
    const draft = batches.filter((batch) => batch.status === 'draft').length
    const directCost = batches.reduce((total, batch) => total + num(batch.accumulated_direct_cost), 0)
    const latest = batches
      .map((batch) => batch.latest_event_at || batch.created_at)
      .filter(Boolean)
      .sort()
      .at(-1)
    return { active, draft, directCost, latest }
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
    const [uomRes, warehouseRes, binRes] = await Promise.all([
      supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true }),
      supabase.from('warehouses').select('id,code,name').eq('company_id', companyId).order('name', { ascending: true }),
      supabase.from('bins').select('id,code,name,warehouseId').eq('company_id', companyId).order('code', { ascending: true }),
    ])
    if (uomRes.error) throw uomRes.error
    if (warehouseRes.error) throw warehouseRes.error
    if (binRes.error) throw binRes.error
    setUoms((uomRes.data || []) as UomRow[])
    setWarehouses((warehouseRes.data || []) as WarehouseRow[])
    setBins((binRes.data || []) as BinRow[])
  }, [companyId])

  const loadBatches = useCallback(async () => {
    if (!companyId) return
    const { data, error } = await supabase
      .from('growth_batches_register')
      .select('*')
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(250)
    if (error) throw error
    const rows = (data || []) as GrowthBatchRegisterRow[]
    setBatches(rows)
    setSelectedId((current) => {
      if (current && rows.some((batch) => batch.id === current)) return current
      return rows[0]?.id || ''
    })
  }, [companyId])

  const loadDetail = useCallback(async (batchId: string) => {
    if (!companyId || !batchId) {
      setCurrentState(null)
      setDetailRow(null)
      setMeasurements([])
      setDirectCosts([])
      setEvents([])
      return
    }

    setDetailLoading(true)
    try {
      const [stateRes, detailRes, measurementRes, costRes, eventRes] = await Promise.all([
        supabase.from('growth_batch_current_state').select('*').eq('id', batchId).maybeSingle(),
        supabase
          .from('growth_batches')
          .select('id,species_text,purpose,notes,cancellation_reason,created_by,updated_by,activated_by,cancelled_by,completed_by,created_at,updated_at')
          .eq('company_id', companyId)
          .eq('id', batchId)
          .maybeSingle(),
        supabase
          .from('growth_batch_measurement_history')
          .select('*')
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_direct_cost_history')
          .select('*')
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_event_timeline')
          .select('*')
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: true }),
      ])
      if (stateRes.error) throw stateRes.error
      if (detailRes.error) throw detailRes.error
      if (measurementRes.error) throw measurementRes.error
      if (costRes.error) throw costRes.error
      if (eventRes.error) throw eventRes.error
      setCurrentState((stateRes.data || null) as GrowthBatchCurrentState | null)
      setDetailRow((detailRes.data || null) as GrowthBatchDetailRow | null)
      setMeasurements((measurementRes.data || []) as GrowthBatchMeasurementRow[])
      setDirectCosts((costRes.data || []) as GrowthBatchDirectCostRow[])
      setEvents((eventRes.data || []) as GrowthBatchEventRow[])
    } catch (error) {
      console.error(error)
      toast.error('Failed to load Growth Batch detail')
    } finally {
      setDetailLoading(false)
    }
  }, [companyId])

  const refreshAll = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      await loadMasterData()
      await loadBatches()
    } catch (error) {
      console.error(error)
      toast.error('Failed to load Growth Batches')
    } finally {
      setLoading(false)
    }
  }, [companyId, loadBatches, loadMasterData])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    void loadDetail(selectedId)
  }, [loadDetail, selectedId])

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
    if (!form.name.trim()) return 'Enter a batch name.'
    if (!form.primaryUomId) return 'Select a primary unit.'
    if (!Number.isFinite(openingQty) || openingQty <= 0) return 'Opening quantity must be greater than zero.'
    if (form.primaryQuantityBasis === 'count' && openingQty !== Math.trunc(openingQty)) return 'Count batches must use whole-number quantities.'
    if (form.openingTotalWeight.trim() && !form.weightUomId) return 'Select a weight unit when opening total weight is entered.'
    if (form.area.trim() && !form.areaUomId) return 'Select an area unit when area is entered.'
    if (form.expectedEndDate && form.startDate && form.expectedEndDate < form.startDate) return 'Expected end date must be on or after start date.'
    return null
  }

  async function createDraft() {
    if (!companyId) return toast.error('Select an active company first')
    if (!canOperate) return toast.error('Your role cannot create Growth Batches')
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
      toast.success('Growth Batch draft created')
      setCreateOpen(false)
      setDraftForm(emptyDraftForm())
      await loadBatches()
      if (batchId) setSelectedId(batchId)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
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
      toast.success('Growth Batch draft saved')
      setEditOpen(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
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
      toast.success('Growth Batch activated')
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  async function cancelDraft() {
    if (!companyId || !detailBatch) return
    const reason = cancelReason.trim()
    if (!reason) return toast.error('Enter a cancellation reason.')
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
      toast.success('Growth Batch draft cancelled')
      setCancelOpen(false)
      setCancelReason('')
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  async function recordMeasurement() {
    if (!companyId || !detailBatch) return
    const value = requiredNumber(measurementForm.value)
    if (!Number.isFinite(value) || (measurementForm.measurementType !== 'temperature' && value < 0)) {
      return toast.error(measurementForm.measurementType === 'temperature' ? 'Enter a valid temperature value.' : 'Measurement value must be zero or greater.')
    }
    if (!measurementForm.uomId) return toast.error('Select a measurement unit.')
    const measurementUom = uomById.get(measurementForm.uomId)
    if (measurementForm.measurementType === 'total_weight' || measurementForm.measurementType === 'average_weight') {
      if (!detailBatch.weight_uom_id) return toast.error('Set a batch weight unit before recording weight measurements.')
      if (measurementForm.uomId !== detailBatch.weight_uom_id) return toast.error('Weight measurements must use the batch weight unit.')
    }
    if (measurementForm.measurementType === 'area_observation') {
      if (!detailBatch.area_uom_id) return toast.error('Set a batch area unit before recording area observations.')
      if (measurementForm.uomId !== detailBatch.area_uom_id) return toast.error('Area observations must use the batch area unit.')
    }
    if (measurementForm.measurementType === 'height' && measurementUom?.family !== 'length') {
      return toast.error('Height measurements must use a length unit.')
    }
    if (measurementForm.measurementType === 'other' && !measurementForm.description.trim()) {
      return toast.error('Describe the other measurement.')
    }
    const observedAt = measurementForm.observedAt ? new Date(measurementForm.observedAt).toISOString() : new Date().toISOString()
    const observedDate = measurementForm.observedAt ? measurementForm.observedAt.slice(0, 10) : today()
    if (observedDate < detailBatch.start_date) return toast.error('Observed date must be on or after the batch start date.')
    if (observedDate > today()) return toast.error('Observed date cannot be in the future.')
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
      toast.success('Measurement recorded')
      setMeasurementOpen(false)
      setMeasurementForm(emptyMeasurementForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  async function recordDirectCost() {
    if (!companyId || !detailBatch) return
    const amount = requiredNumber(directCostForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Direct cost amount must be greater than zero.')
    if (!directCostForm.description.trim()) return toast.error('Enter a direct cost description.')
    const eventDate = directCostForm.eventDate || today()
    if (eventDate < detailBatch.start_date) return toast.error('Direct cost date must be on or after the batch start date.')
    if (eventDate > today()) return toast.error('Direct cost date cannot be in the future.')
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
      toast.success('Direct cost recorded')
      setDirectCostOpen(false)
      setDirectCostForm(emptyDirectCostForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<PremiumDataTableColumn<GrowthBatchRegisterRow>[]>(() => [
    {
      id: 'reference',
      header: 'Batch',
      cell: (batch) => (
        <button
          type="button"
          onClick={() => setSelectedId(batch.id)}
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
      header: 'Status',
      cell: (batch) => <PremiumStatusBadge tone={statusTone[batch.status]}>{labelize(batch.status)}</PremiumStatusBadge>,
      sortValue: (batch) => batch.status,
      minWidth: 110,
    },
    {
      id: 'family',
      header: 'Family',
      cell: (batch) => labelize(batch.batch_family),
      sortValue: (batch) => batch.batch_family,
      minWidth: 120,
    },
    {
      id: 'basis',
      header: 'Basis',
      cell: (batch) => `${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim(),
      sortValue: (batch) => num(batch.current_primary_qty ?? batch.opening_primary_qty),
      align: 'right',
      minWidth: 140,
    },
    {
      id: 'weight',
      header: 'Weight',
      cell: (batch) => (batch.latest_total_weight == null ? 'Not recorded' : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)),
      sortValue: (batch) => batch.latest_total_weight ?? -1,
      align: 'right',
      minWidth: 120,
    },
    {
      id: 'cost',
      header: 'Memo cost',
      cell: (batch) => money(batch.remaining_cost, batch.base_currency_code || selectedCurrency),
      sortValue: (batch) => num(batch.remaining_cost),
      align: 'right',
      minWidth: 140,
    },
    {
      id: 'latest',
      header: 'Latest',
      cell: (batch) => (
        <span>
          {batch.latest_event_type ? labelize(batch.latest_event_type) : 'Created'}
          <span className="block text-xs text-muted-foreground">{compactDate(batch.latest_event_at || batch.created_at)}</span>
        </span>
      ),
      sortValue: (batch) => batch.latest_event_at || batch.created_at,
      minWidth: 150,
    },
  ], [selectedCurrency])

  const sortedBatches = useMemo(() => sortPremiumRows(filteredBatches, columns, sort), [columns, filteredBatches, sort])
  const mobileRows = useMemo(() => getPremiumPageRows(sortedBatches, page, pageSize), [page, pageSize, sortedBatches])

  const draftActionButtons = detailBatch?.status === 'draft' && canOperate ? (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={openEditDialog} disabled={saving}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit draft
      </Button>
      <Button type="button" size="sm" onClick={activateBatch} disabled={saving}>
        <CheckCircle2 className="mr-2 h-4 w-4" />
        Activate
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={saving}>
        <Ban className="mr-2 h-4 w-4" />
        Cancel
      </Button>
    </div>
  ) : null

  const activeActionButtons = detailBatch?.status === 'active' && canOperate ? (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => setMeasurementOpen(true)} disabled={saving}>
        <LineChart className="mr-2 h-4 w-4" />
        Record measurement
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setDirectCostOpen(true)} disabled={saving}>
        <WalletCards className="mr-2 h-4 w-4" />
        Add memo cost
      </Button>
    </div>
  ) : null

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
          <Field label="Batch name" htmlFor={`${mode}-growth-name`}>
            <Input
              id={`${mode}-growth-name`}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Broiler House A Week 24"
            />
          </Field>
          <Field label="Family" htmlFor={`${mode}-growth-family`}>
            <Select value={form.batchFamily} onValueChange={(value) => setForm((current) => ({ ...current, batchFamily: value as BatchFamily }))}>
              <SelectTrigger id={`${mode}-growth-family`} aria-label="Batch family"><SelectValue /></SelectTrigger>
              <SelectContent>
                {batchFamilies.map((family) => <SelectItem key={family} value={family}>{labelize(family)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity basis" htmlFor={`${mode}-growth-basis`}>
            <Select value={form.primaryQuantityBasis} onValueChange={(value) => setDraftBasis(value as QuantityBasis, mode)}>
              <SelectTrigger id={`${mode}-growth-basis`} aria-label="Quantity basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                {quantityBases.map((basis) => <SelectItem key={basis} value={basis}>{labelize(basis)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Opening quantity" htmlFor={`${mode}-growth-opening-qty`}>
            <Input
              id={`${mode}-growth-opening-qty`}
              type="number"
              min="0.000001"
              step={form.primaryQuantityBasis === 'count' ? '1' : '0.000001'}
              value={form.openingPrimaryQty}
              onChange={(event) => setForm((current) => ({ ...current, openingPrimaryQty: event.target.value }))}
            />
          </Field>
          <Field label="Primary unit" htmlFor={`${mode}-growth-primary-uom`}>
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
              <SelectTrigger id={`${mode}-growth-primary-uom`} aria-label="Primary unit"><SelectValue placeholder="Select unit" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select unit</SelectItem>
                {primaryUomOptions.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor={`${mode}-growth-start`}>
            <Input
              id={`${mode}-growth-start`}
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </Field>
          <Field label="Expected end" htmlFor={`${mode}-growth-expected`}>
            <Input
              id={`${mode}-growth-expected`}
              type="date"
              value={form.expectedEndDate}
              onChange={(event) => setForm((current) => ({ ...current, expectedEndDate: event.target.value }))}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Species / cultivar" htmlFor={`${mode}-growth-species`}>
            <Input
              id={`${mode}-growth-species`}
              value={form.speciesText}
              onChange={(event) => setForm((current) => ({ ...current, speciesText: event.target.value }))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Purpose" htmlFor={`${mode}-growth-purpose`}>
            <Input
              id={`${mode}-growth-purpose`}
              value={form.purpose}
              onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Opening total weight" htmlFor={`${mode}-growth-opening-weight`}>
            <Input
              id={`${mode}-growth-opening-weight`}
              type="number"
              min="0"
              step="0.000001"
              value={form.openingTotalWeight}
              onChange={(event) => setForm((current) => ({ ...current, openingTotalWeight: event.target.value }))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Weight unit" htmlFor={`${mode}-growth-weight-uom`} hint="Required for opening, total, and average weight.">
            <Select value={form.weightUomId || 'none'} onValueChange={(value) => setForm((current) => ({ ...current, weightUomId: value === 'none' ? '' : value }))}>
              <SelectTrigger id={`${mode}-growth-weight-uom`} aria-label="Weight unit"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No weight unit</SelectItem>
                {weightUoms.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Area" htmlFor={`${mode}-growth-area`}>
            <Input
              id={`${mode}-growth-area`}
              type="number"
              min="0"
              step="0.000001"
              value={form.area}
              onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))}
              placeholder="Optional"
            />
          </Field>
          <Field label="Area unit" htmlFor={`${mode}-growth-area-uom`}>
            <Select value={form.areaUomId || 'none'} onValueChange={(value) => setAreaUom(value, mode)}>
              <SelectTrigger id={`${mode}-growth-area-uom`} aria-label="Area unit"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No area unit</SelectItem>
                {areaUoms.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Warehouse" htmlFor={`${mode}-growth-warehouse`}>
            <Select value={form.warehouseId || 'none'} onValueChange={(value) => setDraftWarehouse(value, mode)}>
              <SelectTrigger id={`${mode}-growth-warehouse`} aria-label="Warehouse"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No warehouse</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Bin" htmlFor={`${mode}-growth-bin`}>
            <Select value={form.binId || 'none'} onValueChange={(value) => setForm((current) => ({ ...current, binId: value === 'none' ? '' : value }))}>
              <SelectTrigger id={`${mode}-growth-bin`} aria-label="Bin"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No bin</SelectItem>
                {binOptions.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} - {bin.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Location note" htmlFor={`${mode}-growth-location`}>
            <Input
              id={`${mode}-growth-location`}
              value={form.locationDescription}
              onChange={(event) => setForm((current) => ({ ...current, locationDescription: event.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>

        <Field label="Notes" htmlFor={`${mode}-growth-notes`}>
          <Textarea
            id={`${mode}-growth-notes`}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Optional operating notes"
          />
        </Field>
      </div>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <PremiumRegisterHeader
        eyebrow="G1-G2 controlled lifecycle"
        title="Growth Batches"
        description="Manage live biological or agricultural batches at group level. G1-G2 supports drafts, activation, measurements, and memo direct costs without stock movements, COGS, harvests, or finance postings."
        badges={
          <>
            <PremiumStatusBadge tone="info">Append-only event ledger</PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral">No FIFO or COGS claim</PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void refreshAll()} disabled={loading || saving}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              type="button"
              onClick={() => {
                setDraftForm(emptyDraftForm())
                setCreateOpen(true)
              }}
              disabled={!canOperate || saving}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Growth Batch
            </Button>
          </>
        }
        metrics={
          <>
            <PremiumMetricCard label="Active" value={metricValues.active} description="Batches open for measurements and memo costs" icon={<Sprout />} tone="positive" variant="panel" />
            <PremiumMetricCard label="Drafts" value={metricValues.draft} description="Prepared but not activated" icon={<ClipboardList />} tone="info" variant="panel" />
            <PremiumMetricCard label="Memo direct costs" value={money(metricValues.directCost, selectedCurrency)} description="Rollup only, no finance posting" icon={<Coins />} tone="warning" variant="panel" />
            <PremiumMetricCard label="Latest activity" value={compactDate(metricValues.latest)} description="Newest event or created batch in the register" icon={<Activity />} tone="neutral" variant="panel" />
          </>
        }
      />

      <Card className="border-card-border bg-card">
        <CardContent className="grid gap-3 p-4 sm:p-5 xl:grid-cols-[minmax(16rem,1fr)_12rem_12rem_12rem_11rem_11rem]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reference, name, family, or location"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | BatchStatus)}>
            <SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(['draft', 'active', 'completed', 'cancelled'] as BatchStatus[]).map((status) => (
                <SelectItem key={status} value={status}>{labelize(status)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={familyFilter} onValueChange={(value) => setFamilyFilter(value as 'all' | BatchFamily)}>
            <SelectTrigger aria-label="Family filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All families</SelectItem>
              {batchFamilies.map((family) => <SelectItem key={family} value={family}>{labelize(family)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={basisFilter} onValueChange={(value) => setBasisFilter(value as 'all' | QuantityBasis)}>
            <SelectTrigger aria-label="Quantity basis filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bases</SelectItem>
              {quantityBases.map((basis) => <SelectItem key={basis} value={basis}>{labelize(basis)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Start date from" />
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Start date to" />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.72fr)]">
        <Card className="min-w-0 border-card-border bg-card">
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>{filteredBatches.length} Growth Batch{filteredBatches.length === 1 ? '' : 'es'} in the current view</CardDescription>
          </CardHeader>
          <CardContent>
            {isMobile ? (
              <PremiumMobileCardList
                rows={mobileRows}
                getRowId={(batch) => batch.id}
                loading={loading}
                error={null}
                emptyState={<PremiumEmptyState icon={<Sprout />} title="No Growth Batches found" description="Create a draft to start tracking a biological or agricultural batch." compact />}
                pagination={{
                  page,
                  pageSize,
                  totalItems: sortedBatches.length,
                  onPageChange: setPage,
                  onPageSizeChange: setPageSize,
                  pageSizeOptions: [5, 10, 20],
                }}
                renderCard={(batch) => (
                  <button
                    type="button"
                    onClick={() => setSelectedId(batch.id)}
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
                      <PremiumStatusBadge tone={statusTone[batch.status]}>{labelize(batch.status)}</PremiumStatusBadge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <SummaryItem label="Basis" value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()} />
                      <SummaryItem label="Weight" value={batch.latest_total_weight == null ? 'Not recorded' : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)} />
                      <SummaryItem label="Memo cost" value={money(batch.remaining_cost, batch.base_currency_code || selectedCurrency)} />
                      <SummaryItem label="Family" value={labelize(batch.batch_family)} />
                      <SummaryItem label="Latest" value={compactDate(batch.latest_event_at || batch.created_at)} />
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
                emptyState={<PremiumEmptyState icon={<Sprout />} title="No Growth Batches found" description="Create a draft to start tracking a biological or agricultural batch." compact />}
                pagination={{
                  page,
                  pageSize,
                  onPageChange: setPage,
                  onPageSizeChange: setPageSize,
                  pageSizeOptions: [10, 20, 50],
                }}
                ariaLabel="Growth Batches register"
              />
            )}
          </CardContent>
        </Card>

        <section className="min-w-0 space-y-5">
          {!detailBatch ? (
            <PremiumEmptyState icon={<Sprout />} title="Select a Growth Batch" description="Choose a register row to inspect lifecycle state, measurements, memo costs, and event history." />
          ) : (
            <>
              <Card className="border-card-border bg-card">
                <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PremiumStatusBadge tone={statusTone[detailBatch.status]}>{labelize(detailBatch.status)}</PremiumStatusBadge>
                      <Badge variant="outline">{labelize(detailBatch.batch_family)}</Badge>
                      <Badge variant="outline">{labelize(detailBatch.primary_quantity_basis)}</Badge>
                    </div>
                    <CardTitle className="mt-3 break-words">{detailBatch.reference_no} - {detailBatch.name}</CardTitle>
                    <CardDescription>
                      {detailRow?.purpose || 'Group-level Growth Batch tracking for G1-G2. Physical stock inputs, harvests, transfers, COGS, and valuation posting are outside this phase.'}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    {draftActionButtons}
                    {activeActionButtons}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <SummaryItem label="Current quantity" value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                    <SummaryItem label="Latest weight" value={detailBatch.latest_total_weight == null ? 'Not recorded' : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                    <SummaryItem label="Memo remaining cost" value={money(detailBatch.remaining_cost, selectedCurrency)} />
                    <SummaryItem label="Start date" value={compactDate(detailBatch.start_date)} />
                    <SummaryItem label="Expected end" value={compactDate(detailBatch.expected_end_date)} />
                    <SummaryItem
                      label="Location"
                      value={
                        detailBatch.warehouse_name || detailBatch.bin_code || detailBatch.location_description
                          ? [detailBatch.warehouse_name, detailBatch.bin_code, detailBatch.location_description].filter(Boolean).join(' / ')
                          : 'Not set'
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              {detailLoading ? (
                <Card className="border-card-border bg-card">
                  <CardContent className="p-5 text-sm text-muted-foreground">Loading Growth Batch detail...</CardContent>
                </Card>
              ) : (
                <Tabs defaultValue="overview" className="min-w-0">
                  <TabsList className="w-full justify-start overflow-x-auto">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="measurements">Measurements</TabsTrigger>
                    <TabsTrigger value="costs">Direct costs</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="audit">Audit</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-5">
                    <DetailSection
                      title="Opening state"
                      description="Opening quantities are captured on the draft and frozen when the batch is activated."
                    >
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <SummaryItem label="Opening quantity" value={`${qty(detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                        <SummaryItem label="Opening total weight" value={detailBatch.opening_total_weight == null ? 'Not set' : qtyWithUom(detailBatch.opening_total_weight, detailBatch.weight_uom_code)} />
                        <SummaryItem label="Weight unit" value={detailBatch.weight_uom_code || 'Not set'} />
                        <SummaryItem label="Area" value={detailBatch.area == null ? 'Not set' : `${qty(detailBatch.area)} ${detailBatch.area_uom_code || ''}`.trim()} />
                        <SummaryItem label="Species / cultivar" value={detailRow?.species_text || 'Not set'} />
                        <SummaryItem label="Latest event" value={detailBatch.latest_event_type ? labelize(detailBatch.latest_event_type) : 'Created'} />
                        <SummaryItem label="Latest activity" value={compactDateTime(detailBatch.latest_event_at || detailBatch.created_at)} />
                      </div>
                      {detailRow?.notes ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{detailRow.notes}</p> : null}
                    </DetailSection>

                    <DetailSection
                      title="G1-G2 scope guard"
                      description="These controls are intentionally unavailable until later phases connect stock, harvest, and valuation policies end to end."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        {['Stock inputs', 'Mortality / shrinkage', 'Transfers', 'Harvest / split outputs', 'Completion', 'Reversal', 'Fair value adjustments', 'FIFO / COGS posting'].map((item) => (
                          <div key={item} className="flex items-center gap-2 rounded-xl border border-card-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="measurements">
                    <DetailSection
                      title="Measurement history"
                      description="Measurements are append-only. Total-weight measurements update latest total weight; population does not change in G1-G2."
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" onClick={() => setMeasurementOpen(true)}>
                          <LineChart className="mr-2 h-4 w-4" />
                          Record
                        </Button>
                      ) : null}
                    >
                      {measurements.length === 0 ? (
                        <PremiumEmptyState icon={<Ruler />} title="No measurements yet" compact />
                      ) : (
                        <div className="space-y-3">
                          {measurements.map((measurement) => (
                            <div key={measurement.id} className="rounded-xl border border-card-border bg-card p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-medium">{labelize(measurement.measurement_type)}</div>
                                  <div className="text-sm text-muted-foreground">{measurement.event_reference} by {measurement.actor_display_name || 'Team member'}</div>
                                </div>
                                <div className="text-right text-sm font-semibold">
                                  {qtyWithUom(measurement.value, measurement.uom_code || uomById.get(measurement.uom_id)?.code)}
                                  <div className="text-xs font-normal text-muted-foreground">Seq {measurement.event_sequence} · {compactDateTime(measurement.observed_at)}</div>
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
                      title="Memo direct costs"
                      description="Direct costs update Growth Batch rollups only. They do not create bills, cash, bank, settlement, journal, invoice, stock, or COGS rows."
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" variant="outline" onClick={() => setDirectCostOpen(true)}>
                          <WalletCards className="mr-2 h-4 w-4" />
                          Add cost
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label="Direct cost total" value={money(detailBatch.accumulated_direct_cost, selectedCurrency)} />
                        <SummaryItem label="Material cost total" value={money(detailBatch.accumulated_material_cost, selectedCurrency)} />
                        <SummaryItem label="Remaining memo cost" value={money(detailBatch.remaining_cost, selectedCurrency)} />
                      </div>
                      {directCosts.length === 0 ? (
                        <PremiumEmptyState icon={<Coins />} title="No memo direct costs yet" compact />
                      ) : (
                        <div className="space-y-3">
                          {directCosts.map((cost) => (
                            <div key={cost.id} className="rounded-xl border border-card-border bg-card p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-medium">{cost.description}</div>
                                  <div className="text-sm text-muted-foreground">{labelize(cost.category)} / {cost.event_reference} / Seq {cost.event_sequence}</div>
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

                  <TabsContent value="timeline">
                    <DetailSection title="Event timeline" description="Lifecycle events are immutable and sequence-numbered per Growth Batch.">
                      {events.length === 0 ? (
                        <PremiumEmptyState icon={<CalendarDays />} title="No lifecycle events yet" compact />
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
                                    <PremiumStatusBadge tone={eventTone[event.event_type]}>{labelize(event.event_type)}</PremiumStatusBadge>
                                    <div className="mt-2 font-medium">{event.event_summary}</div>
                                    <div className="text-sm text-muted-foreground">{event.event_reference} / {compactDateTime(event.event_at)}</div>
                                  </div>
                                  {event.total_cost_delta ? <div className="text-sm font-semibold">{money(event.total_cost_delta, event.currency_code || selectedCurrency)}</div> : null}
                                  {event.weight_value != null ? <div className="text-sm font-semibold">{qtyWithUom(event.weight_value, event.weight_uom_code)}</div> : null}
                                </div>
                                {event.reason || event.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{event.reason || event.notes}</p> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="audit">
                    <DetailSection title="Audit and lifecycle" description="Read-only user and timestamp references for the selected Growth Batch.">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <SummaryItem label="Created" value={compactDateTime(detailRow?.created_at || detailBatch.created_at)} />
                        <SummaryItem label="Updated" value={compactDateTime(detailRow?.updated_at)} />
                        <SummaryItem label="Activated" value={compactDateTime(detailBatch.activated_at)} />
                        <SummaryItem label="Cancelled" value={compactDateTime(detailBatch.cancelled_at)} />
                        <SummaryItem label="Created by" value={detailRow?.created_by || currentState?.created_by || 'Not recorded'} />
                        <SummaryItem label="Updated by" value={detailRow?.updated_by || currentState?.updated_by || 'Not recorded'} />
                      </div>
                      {detailRow?.cancellation_reason ? (
                        <p className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                          Cancellation reason: {detailRow.cancellation_reason}
                        </p>
                      ) : null}
                    </DetailSection>
                  </TabsContent>
                </Tabs>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Create Growth Batch Draft</DialogTitle>
            <DialogDescription>Drafts can be edited until activation. Activation freezes the opening state and creates the first lifecycle event.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">{renderDraftForm(draftForm, setDraftForm, 'create')}</DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" onClick={createDraft} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit Draft</DialogTitle>
            <DialogDescription>Draft changes are blocked after activation or cancellation.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">{renderDraftForm(editForm, setEditForm, 'edit')}</DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" onClick={saveDraft} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Draft</DialogTitle>
            <DialogDescription>Cancellation creates an immutable event and prevents activation.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Cancellation reason" htmlFor="growth-cancel-reason">
              <Textarea id="growth-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" variant="destructive" onClick={cancelDraft} disabled={saving}>Cancel draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={measurementOpen} onOpenChange={setMeasurementOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Record Measurement</DialogTitle>
            <DialogDescription>Measurements are memo events. They do not change physical stock.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Type" htmlFor="growth-measurement-type">
                  <Select value={measurementForm.measurementType} onValueChange={(value) => setMeasurementForm((current) => ({ ...current, measurementType: value as MeasurementType }))}>
                    <SelectTrigger id="growth-measurement-type" aria-label="Measurement type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {measurementTypes.map((type) => <SelectItem key={type} value={type}>{labelize(type)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Value" htmlFor="growth-measurement-value">
                  <Input
                    id="growth-measurement-value"
                    type="number"
                    min={measurementForm.measurementType === 'temperature' ? undefined : '0'}
                    step="0.000001"
                    value={measurementForm.value}
                    onChange={(event) => setMeasurementForm((current) => ({ ...current, value: event.target.value }))}
                  />
                </Field>
                <Field label="Unit" htmlFor="growth-measurement-uom">
                  <Select value={measurementForm.uomId || 'none'} onValueChange={(value) => setMeasurementForm((current) => ({ ...current, uomId: value === 'none' ? '' : value }))}>
                    <SelectTrigger id="growth-measurement-uom" aria-label="Measurement unit"><SelectValue placeholder="Select unit" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select unit</SelectItem>
                      {measurementUoms.map((uom) => <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Observed at" htmlFor="growth-measurement-observed">
                <Input
                  id="growth-measurement-observed"
                  type="datetime-local"
                  value={measurementForm.observedAt}
                  onChange={(event) => setMeasurementForm((current) => ({ ...current, observedAt: event.target.value }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Sample size" htmlFor="growth-measurement-sample"><Input id="growth-measurement-sample" type="number" min="0" step="0.000001" value={measurementForm.sampleSize} onChange={(event) => setMeasurementForm((current) => ({ ...current, sampleSize: event.target.value }))} /></Field>
                <Field label="Minimum" htmlFor="growth-measurement-min"><Input id="growth-measurement-min" type="number" min={measurementForm.measurementType === 'temperature' ? undefined : '0'} step="0.000001" value={measurementForm.minimum} onChange={(event) => setMeasurementForm((current) => ({ ...current, minimum: event.target.value }))} /></Field>
                <Field label="Maximum" htmlFor="growth-measurement-max"><Input id="growth-measurement-max" type="number" min={measurementForm.measurementType === 'temperature' ? undefined : '0'} step="0.000001" value={measurementForm.maximum} onChange={(event) => setMeasurementForm((current) => ({ ...current, maximum: event.target.value }))} /></Field>
                <Field label="Average" htmlFor="growth-measurement-avg"><Input id="growth-measurement-avg" type="number" min={measurementForm.measurementType === 'temperature' ? undefined : '0'} step="0.000001" value={measurementForm.average} onChange={(event) => setMeasurementForm((current) => ({ ...current, average: event.target.value }))} /></Field>
              </div>
              <Field label="Description" htmlFor="growth-measurement-description">
                <Input id="growth-measurement-description" value={measurementForm.description} onChange={(event) => setMeasurementForm((current) => ({ ...current, description: event.target.value }))} placeholder="Required only for Other" />
              </Field>
              <Field label="Notes" htmlFor="growth-measurement-notes">
                <Textarea id="growth-measurement-notes" value={measurementForm.notes} onChange={(event) => setMeasurementForm((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMeasurementOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" onClick={recordMeasurement} disabled={saving}>Record measurement</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={directCostOpen} onOpenChange={setDirectCostOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Memo Direct Cost</DialogTitle>
            <DialogDescription>Memo direct costs update only the Growth Batch cost rollup.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="growth-direct-cost-category">
                  <Select value={directCostForm.category} onValueChange={(value) => setDirectCostForm((current) => ({ ...current, category: value as DirectCostCategory }))}>
                    <SelectTrigger id="growth-direct-cost-category" aria-label="Direct cost category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {directCostCategories.map((category) => <SelectItem key={category} value={category}>{labelize(category)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Event date" htmlFor="growth-direct-cost-date">
                  <Input id="growth-direct-cost-date" type="date" value={directCostForm.eventDate} onChange={(event) => setDirectCostForm((current) => ({ ...current, eventDate: event.target.value }))} />
                </Field>
              </div>
              <Field label="Description" htmlFor="growth-direct-cost-description">
                <Input id="growth-direct-cost-description" value={directCostForm.description} onChange={(event) => setDirectCostForm((current) => ({ ...current, description: event.target.value }))} />
              </Field>
              <Field label={`Amount (${selectedCurrency})`} htmlFor="growth-direct-cost-amount">
                <Input id="growth-direct-cost-amount" type="number" min="0.01" step="0.01" value={directCostForm.amount} onChange={(event) => setDirectCostForm((current) => ({ ...current, amount: event.target.value }))} />
              </Field>
              <Field label="Notes" htmlFor="growth-direct-cost-notes">
                <Textarea id="growth-direct-cost-notes" value={directCostForm.notes} onChange={(event) => setDirectCostForm((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDirectCostOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" onClick={recordDirectCost} disabled={saving}>Add memo cost</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
