import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Coins,
  LineChart,
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
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useIsMobile } from '../hooks/use-mobile'
import { useI18n, type Locale } from '../lib/i18n'
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
type LossType = 'mortality' | 'shrinkage'
type LossReasonCode = 'disease' | 'injury' | 'predator' | 'weather' | 'handling' | 'culling' | 'natural_loss' | 'drying' | 'spoilage' | 'quality_loss' | 'other'
type TransferReasonCode = 'operational_move' | 'space_management' | 'biosecurity' | 'environment' | 'maintenance' | 'consolidation' | 'other'
type HarvestKind = 'partial' | 'full'

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
  status?: string | null
}

type BinRow = {
  id: string
  code: string
  name: string
  warehouseId: string
  status?: string | null
}

type ItemRow = {
  id: string
  sku: string | null
  name: string
  base_uom_id: string | null
  track_inventory: boolean
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
  current_material_cost: number
  current_direct_cost: number
  current_total_cost: number
  current_harvested_cost: number
  current_remaining_cost: number
  accumulated_material_cost: number
  accumulated_direct_cost: number
  accumulated_total_cost: number
  harvested_cost: number
  remaining_cost: number
  projected_material_cost: number
  projected_direct_cost: number
  projected_total_cost: number
  projected_harvested_cost: number
  projected_remaining_cost: number
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
  stock_input_event_count?: number
  stock_input_line_count?: number
  stock_input_material_cost?: number
  loss_event_count?: number
  mortality_event_count?: number
  shrinkage_event_count?: number
  unreversed_loss_event_count?: number
  harvest_event_count?: number
  unreversed_harvest_event_count?: number
  reversed_harvest_event_count?: number
  harvested_output_quantity?: number
  fully_harvested_awaiting_completion?: boolean
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
  stock_input_event_count?: number
  stock_input_line_count?: number
  stock_input_material_cost?: number
  loss_event_count?: number
  mortality_event_count?: number
  shrinkage_event_count?: number
  unreversed_loss_event_count?: number
  reversed_loss_event_count?: number
  harvest_event_count?: number
  unreversed_harvest_event_count?: number
  reversed_harvest_event_count?: number
  harvested_output_quantity?: number
  fully_harvested_awaiting_completion?: boolean
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
  event_type: 'activation' | 'measurement' | 'direct_cost' | 'cancellation' | 'stock_input' | 'stock_input_reversal' | 'mortality' | 'shrinkage' | 'mortality_reversal' | 'shrinkage_reversal' | 'transfer' | 'transfer_reversal' | 'harvest' | 'harvest_reversal'
  event_at: string
  event_date: string
  actor_display_name: string | null
  quantity_delta: number | null
  weight_value: number | null
  weight_delta: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  material_cost_delta: number
  direct_cost_delta: number
  total_cost_delta: number
  currency_code: string | null
  notes: string | null
  reason: string | null
  event_summary: string
  typed_detail_summary: Record<string, unknown> | null
  original_event_id?: string | null
}

type GrowthBatchLossRow = {
  id: string
  growth_batch_id: string
  event_id: string
  event_sequence: number
  event_reference: string
  event_effective_date: string
  event_created_at: string
  actor_display_name: string | null
  loss_type: LossType
  quantity_lost: number | null
  quantity_uom_id: string | null
  quantity_uom_code: string | null
  weight_lost: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  reason_code: LossReasonCode
  notes: string | null
  quantity_before: number | null
  quantity_after: number | null
  total_weight_before: number | null
  total_weight_after: number | null
  reversal_status: 'not_reversed' | 'reversed'
  reversal_event_id: string | null
  reversal_event_reference: string | null
  reversal_event_sequence: number | null
  reversal_timestamp: string | null
  reversal_effective_date: string | null
  reversal_actor_display_name: string | null
  reversal_reason: string | null
  restored_quantity: number | null
  restored_quantity_uom_id: string | null
  restored_quantity_uom_code: string | null
  restored_weight: number | null
  restored_weight_uom_id: string | null
  restored_weight_uom_code: string | null
}

type GrowthBatchTransferRow = {
  id: string
  growth_batch_id: string
  event_id: string
  event_sequence: number
  event_reference: string
  event_effective_date: string
  event_created_at: string
  actor_display_name: string | null
  source_warehouse_id: string | null
  source_warehouse_code: string | null
  source_warehouse_name: string | null
  source_bin_id: string | null
  source_bin_code: string | null
  source_bin_name: string | null
  source_location_description: string | null
  destination_warehouse_id: string
  destination_warehouse_code: string | null
  destination_warehouse_name: string | null
  destination_bin_id: string | null
  destination_bin_code: string | null
  destination_bin_name: string | null
  destination_location_description: string | null
  current_location_fingerprint: string | null
  primary_quantity_basis: QuantityBasis
  current_primary_qty: number
  primary_uom_id: string
  primary_uom_code: string | null
  current_total_weight: number | null
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
  transfer_reason: TransferReasonCode
  notes: string | null
  reversed: boolean
  reversal_detail_id: string | null
  reversal_event_id: string | null
  reversal_event_reference: string | null
  reversal_event_sequence: number | null
  reversal_effective_date: string | null
  reversal_timestamp: string | null
  reversal_actor_display_name: string | null
  reversal_reason: string | null
  is_latest_location_event: boolean
  current_location_matches_destination: boolean
  source_warehouse_active: boolean
  source_bin_active: boolean
  reversal_eligible: boolean
}

type GrowthBatchHarvestRow = {
  id: string
  growth_batch_id: string
  growth_batch_reference: string
  event_id: string
  event_reference: string
  event_sequence: number
  event_effective_date: string
  event_created_at: string
  actor_display_name: string | null
  harvest_kind: HarvestKind
  harvested_primary_qty: number
  primary_uom_id: string
  primary_uom_code: string | null
  quantity_before: number
  quantity_after: number
  harvested_weight: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  total_weight_before: number | null
  total_weight_after: number | null
  output_item_id: string
  output_item_sku: string | null
  output_item_name: string
  output_uom_id: string
  output_uom_code: string | null
  output_quantity: number
  destination_warehouse_id: string
  destination_warehouse_code: string | null
  destination_warehouse_name: string | null
  destination_bin_id: string | null
  destination_bin_code: string | null
  destination_bin_name: string | null
  allocated_cost: number
  output_unit_cost: number
  accumulated_total_cost: number
  harvested_cost_before: number
  harvested_cost_after: number
  remaining_cost_before: number
  remaining_cost_after: number
  stock_receipt_movement_id: string
  source_warehouse_id: string | null
  source_warehouse_code: string | null
  source_warehouse_name: string | null
  source_bin_id: string | null
  source_bin_code: string | null
  source_bin_name: string | null
  source_location_description: string | null
  notes: string | null
  reversed: boolean
  reversal_detail_id: string | null
  reversal_event_id: string | null
  reversal_event_reference: string | null
  reversal_event_sequence: number | null
  reversal_effective_date: string | null
  reversal_timestamp: string | null
  reversal_actor_display_name: string | null
  reversal_reason: string | null
  reversal_stock_issue_movement_id: string | null
  is_latest_cost_quantity_weight_event: boolean
  reversal_eligible: boolean
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

type GrowthBatchStockInputRow = {
  id: string
  growth_batch_id: string
  event_id: string
  event_sequence: number
  event_reference: string
  event_effective_date: string
  event_created_at: string
  actor_display_name: string | null
  line_no: number
  item_id: string
  item_name: string
  item_sku: string | null
  quantity: number
  uom_id: string
  uom_code: string | null
  source_warehouse_id: string
  source_warehouse_name: string | null
  source_bin_id: string
  source_bin_code: string | null
  source_bin_name: string | null
  frozen_unit_cost: number
  frozen_total_cost: number
  currency_code: string
  issue_movement_id: string
  line_notes: string | null
  reversal_status: 'not_reversed' | 'reversed'
  reversal_event_id: string | null
  reversal_event_reference: string | null
  reversal_timestamp: string | null
  reversal_effective_date: string | null
  reversal_actor_display_name: string | null
  reversal_reason: string | null
  reversal_receipt_movement_id: string | null
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

type StockInputLineForm = {
  clientId: string
  itemId: string
  quantity: string
  sourceWarehouseId: string
  sourceBinId: string
  lineNotes: string
}

type StockInputForm = {
  effectiveDate: string
  notes: string
  lines: StockInputLineForm[]
}

type LossForm = {
  lossType: LossType
  effectiveDate: string
  quantityLost: string
  weightLost: string
  reasonCode: LossReasonCode | ''
  notes: string
}

type LossPreview = {
  ready: boolean
  blocking_reasons: Array<{ code?: string; [key: string]: unknown }>
  batch_id: string
  reference_no: string
  status: BatchStatus
  loss_type: LossType
  effective_date: string
  reason_code: LossReasonCode
  current_quantity: number
  quantity_lost: number | null
  resulting_quantity: number
  quantity_uom_id: string | null
  quantity_uom_code: string | null
  current_total_weight: number | null
  weight_lost: number | null
  resulting_total_weight: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
}

type TransferLocationPreview = {
  warehouse_id: string | null
  warehouse_code?: string | null
  warehouse_name?: string | null
  bin_id: string | null
  bin_code?: string | null
  bin_name?: string | null
  location_description?: string | null
}

type TransferPreview = {
  ready: boolean
  blocking_reasons: Array<{ code?: string; [key: string]: unknown }>
  batch_id: string
  reference_no: string
  status: BatchStatus
  effective_date: string
  transfer_reason: TransferReasonCode | null
  source_location_fingerprint: string | null
  source_location: TransferLocationPreview
  destination_location: TransferLocationPreview
  current_quantity: number
  quantity_uom_id: string | null
  quantity_uom_code: string | null
  current_total_weight: number | null
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
  full_batch_transfer: boolean
  stock_ledger_effect: string
  finance_effect: string
  cost_effect: string
}

type HarvestLocationPreview = {
  warehouse_id: string | null
  warehouse_code?: string | null
  warehouse_name?: string | null
  bin_id: string | null
  bin_code?: string | null
  bin_name?: string | null
  location_description?: string | null
}

type HarvestPreview = {
  ready: boolean
  blocking_reasons: Array<{ code?: string; [key: string]: unknown }>
  batch_id: string
  reference_no: string
  name: string
  batch_family: BatchFamily
  status: BatchStatus
  effective_date: string
  harvest_kind: HarvestKind
  current_quantity: number
  harvested_primary_qty: number | null
  resulting_quantity: number
  primary_uom_id: string
  primary_uom_code: string | null
  current_total_weight: number | null
  harvested_total_weight: number | null
  resulting_total_weight: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  accumulated_total_cost: number
  harvested_cost_before: number
  harvested_cost_after: number
  remaining_cost_before: number
  remaining_cost_after: number
  allocated_cost: number
  output_item_id: string | null
  output_item_name: string | null
  output_uom_id: string | null
  output_uom_code: string | null
  output_quantity: number | null
  output_unit_cost: number
  destination_location: HarvestLocationPreview | null
  source_location: HarvestLocationPreview | null
  source_fingerprint: string | null
  stock_effect: string
  stock_effect_note: string
  finance_effect: string
  cogs_effect: string
  sale_effect: string
  items_unit_price_effect: string
  notes: string | null
}

type StockInputPreviewLine = {
  line_no: number
  item_id: string
  item_name: string
  item_sku: string | null
  uom_id: string
  quantity: number
  source_warehouse_id: string
  source_warehouse_name: string | null
  source_bin_id: string
  source_bin_code: string | null
  source_bin_name: string | null
  available_quantity: number
  shortage: number
  estimated_unit_cost: number
  estimated_line_cost: number
  line_notes: string | null
}

type StockInputPreview = {
  ready: boolean
  blocking_reasons: Array<{ code?: string; line_no?: number; [key: string]: unknown }>
  lines: StockInputPreviewLine[]
  estimated_total_material_cost: number
  current_material_cost: number
  current_direct_cost: number
  current_total_cost: number
  current_harvested_cost: number
  current_remaining_cost: number
  projected_material_cost: number
  projected_total_cost: number
  projected_remaining_cost: number
}

type ReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  reason: string
  confirmation: string
}

type LossReversalForm = {
  eventId: string
  eventReference: string
  lossType: LossType
  reason: string
}

type TransferForm = {
  destinationWarehouseId: string
  destinationBinId: string
  locationDescription: string
  effectiveDate: string
  reasonCode: TransferReasonCode | ''
  notes: string
}

type TransferReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  expectedCurrentLocationFingerprint: string
  reason: string
}

type HarvestForm = {
  effectiveDate: string
  harvestedPrimaryQty: string
  harvestedWeight: string
  outputItemId: string
  outputQuantity: string
  destinationWarehouseId: string
  destinationBinId: string
  notes: string
}

type HarvestReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  reason: string
}

const batchFamilies: BatchFamily[] = ['poultry', 'livestock', 'fish', 'crop', 'nursery', 'other']
const quantityBases: QuantityBasis[] = ['count', 'weight', 'area', 'other']
const measurementTypes: MeasurementType[] = ['total_weight', 'average_weight', 'height', 'area_observation', 'temperature', 'other']
const directCostCategories: DirectCostCategory[] = ['labour', 'utilities', 'veterinary', 'transport', 'land_preparation', 'water', 'rent', 'other']
const mortalityReasons: LossReasonCode[] = ['disease', 'injury', 'predator', 'weather', 'handling', 'culling', 'other']
const shrinkageReasons: LossReasonCode[] = ['weather', 'handling', 'natural_loss', 'drying', 'spoilage', 'quality_loss', 'other']
const transferReasons: TransferReasonCode[] = ['operational_move', 'space_management', 'biosecurity', 'environment', 'maintenance', 'consolidation', 'other']

const harvestBlockerCodes = [
  'growth_batch_not_active',
  'growth_batch_harvest_empty_batch',
  'growth_batch_harvest_date_before_start',
  'growth_batch_harvest_date_in_future',
  'growth_batch_harvest_date_before_latest_state_event',
  'growth_batch_harvest_quantity_required',
  'growth_batch_harvest_quantity_exceeds_current',
  'fractional_count_not_allowed',
  'growth_batch_harvest_weight_required',
  'growth_batch_harvest_weight_invalid',
  'growth_batch_harvest_weight_exceeds_current',
  'growth_batch_harvest_weight_without_current_weight',
  'growth_batch_harvest_full_weight_must_match_current',
  'growth_batch_harvest_output_quantity_required',
  'growth_batch_harvest_output_item_required',
  'growth_batch_harvest_output_item_invalid',
  'growth_batch_harvest_output_item_not_stock_tracked',
  'growth_batch_harvest_output_item_base_uom_required',
  'growth_batch_harvest_destination_required',
  'growth_batch_harvest_destination_invalid',
  'growth_batch_harvest_destination_inactive',
  'growth_batch_harvest_destination_bin_invalid',
  'growth_batch_harvest_source_fingerprint_required',
  'growth_batch_harvest_source_changed',
  'growth_batch_harvest_sequence_invalid',
  'growth_batch_harvest_reversal_dependency_exists',
  'growth_batch_harvest_current_state_mismatch',
  'growth_batch_harvest_reversal_insufficient_output_stock',
  'growth_batch_harvest_reversal_date_before_original',
  'growth_batch_harvest_already_reversed',
  'reversal_reason_required',
] as const

type GrowthBatchHarvestBlockerCode = (typeof harvestBlockerCodes)[number]

const transferBlockerCodes = [
  'growth_batch_transfer_reason_invalid',
  'growth_batch_transfer_notes_required',
  'growth_batch_not_active',
  'growth_batch_transfer_empty_batch',
  'growth_batch_transfer_source_required',
  'source_location_not_canonical',
  'growth_batch_transfer_quantity_required',
  'growth_batch_transfer_source_fingerprint_required',
  'growth_batch_transfer_source_changed',
  'growth_batch_transfer_destination_required',
  'destination_warehouse_required',
  'growth_batch_transfer_destination_inactive',
  'destination_warehouse_inactive',
  'destination_bin_inactive',
  'destination_warehouse_invalid',
  'destination_bin_invalid',
  'growth_batch_transfer_same_location',
  'growth_batch_transfer_stale_source',
  'growth_batch_transfer_not_latest',
  'growth_batch_transfer_reversal_dependency_exists',
  'growth_batch_transfer_current_location_changed',
  'growth_batch_transfer_current_location_mismatch',
  'growth_batch_transfer_not_found',
  'growth_batch_transfer_original_event_invalid',
  'growth_batch_transfer_sequence_invalid',
  'growth_batch_transfer_source_inactive',
  'growth_batch_transfer_original_source_inactive',
  'growth_batch_transfer_date_before_latest_location_event',
  'growth_batch_transfer_reversal_date_before_original',
  'growth_batch_transfer_date_before_start',
  'growth_batch_transfer_date_in_future',
  'growth_batch_transfer_already_reversed',
] as const

type GrowthBatchTransferBlockerCode = (typeof transferBlockerCodes)[number]

type GrowthBatchHarvestCopy = {
  actions: {
    recordHarvest: string
    reverseHarvest: string
    preview: string
    close: string
    harvestAll: string
  }
  aria: {
    outputItem: string
    destinationWarehouse: string
    destinationBin: string
  }
  labels: {
    tab: string
    currentQuantity: string
    currentWeight: string
    fullyHarvested: string
    awaitingCompletion: string
    harvestKind: string
    harvestedQuantity: string
    harvestedWeight: string
    outputItem: string
    outputBaseUom: string
    outputQuantity: string
    destinationWarehouse: string
    destinationBin: string
    effectiveDate: string
    notes: string
    before: string
    after: string
    allocatedCost: string
    outputUnitCost: string
    remainingCost: string
    stockReceipt: string
    finance: string
    sale: string
    cogs: string
    sellingPrice: string
    originalEvent: string
    reason: string
    sourceLocation: string
    destinationLocation: string
  }
  fallback: {
    notSet: string
    notRecorded: string
    notSelected: string
    teamMember: string
    reversed: string
    locked: string
    unchanged: string
    notAffected: string
    noBin: string
  }
  dialog: {
    title: string
    description: string
    allHint: string
    weightRequiredHint: string
    outputHint: string
    warehousePlaceholder: string
    binPlaceholder: string
    outputPlaceholder: string
    notesHint: string
    reversalTitle: string
    reversalDescription: string
  }
  history: {
    title: string
    description: string
    emptyTitle: string
    emptyDescription: string
    harvestBadge: string
    harvestReversalBadge: string
    partial: string
    full: string
    by: string
    sequencePrefix: string
    reversedBy: string
    onDate: string
    lockedReason: string
  }
  preview: {
    readyToast: string
    blockersToast: string
    stale: string
    ready: string
    blockers: string
    noSaleNoFinance: string
  }
  success: {
    harvested: string
    reversed: string
  }
  errors: {
    unavailableActive: string
    quantityRequired: string
    destinationSetupRequired: string
    outputSetupRequired: string
    selectBatch: string
    effectiveDateRequired: string
    dateBeforeStart: string
    dateFuture: string
    outputItemRequired: string
    outputQuantityRequired: string
    destinationRequired: string
    destinationInactive: string
    binInactive: string
    weightRequired: string
    previewRequired: string
    previewBlockers: string
    previewRefreshRequired: string
    reversalReasonRequired: string
    historyRefreshRequired: string
    managerRequired: string
    requestMismatch: string
    requestInProgress: string
    permissionDenied: string
    actionFailed: string
  }
  blockerLabels: Record<GrowthBatchHarvestBlockerCode, string>
}

type GrowthBatchTransferCopy = {
  actions: {
    transferBatch: string
    reverseTransfer: string
    preview: string
    close: string
  }
  aria: {
    destinationWarehouse: string
    destinationBin: string
    transferPurpose: string
  }
  labels: {
    currentLocation: string
    currentQuantity: string
    latestWeight: string
    latestTotalWeight: string
    entireCurrentQuantity: string
    entireQuantity: string
    entireWeight: string
    fullQuantityMoved: string
    weightSnapshot: string
    destinationWarehouse: string
    destinationBin: string
    effectiveDate: string
    purpose: string
    locationNote: string
    notes: string
    stockLedger: string
    costs: string
    costEffect: string
    from: string
    to: string
    originalEvent: string
    reason: string
  }
  fallback: {
    notSet: string
    notRecorded: string
    notSelected: string
    teamMember: string
    reversalEvent: string
    reasonRecorded: string
    unchanged: string
    notAffected: string
  }
  dialog: {
    title: string
    description: string
    stockNote: string
    binHint: string
    warehousePlaceholder: string
    binPlaceholder: string
    noBin: string
    purposePlaceholder: string
    locationNoteHint: string
    notesRequiredHint: string
    notesOptionalHint: string
    reversalTitle: string
    reversalDescription: string
  }
  history: {
    title: string
    description: string
    emptyTitle: string
    emptyDescription: string
    transferBadge: string
    transferReversalBadge: string
    reversedBadge: string
    lockedBadge: string
    by: string
    sequencePrefix: string
    reversedBy: string
    onDate: string
    lockedReason: string
  }
  preview: {
    readyToast: string
    blockersToast: string
    stale: string
    ready: string
    blockers: string
  }
  success: {
    transferred: string
    reversed: string
  }
  errors: {
    unavailableActive: string
    sourceRequired: string
    quantityRequired: string
    destinationSetupRequired: string
    selectBatch: string
    effectiveDateRequired: string
    dateBeforeStart: string
    dateFuture: string
    destinationRequired: string
    destinationInactive: string
    binInactive: string
    purposeRequired: string
    purposeInvalid: string
    otherNotesRequired: string
    sameLocation: string
    previewRequired: string
    previewBlockers: string
    previewRefreshRequired: string
    reversalReasonRequired: string
    historyRefreshRequired: string
    managerRequired: string
    requestMismatch: string
    requestInProgress: string
    permissionDenied: string
    actionFailed: string
  }
  reasonLabels: Record<TransferReasonCode, string>
  blockerLabels: Record<GrowthBatchTransferBlockerCode, string>
}

const growthBatchTransferCopy: Record<Locale, GrowthBatchTransferCopy> = {
  en: {
    actions: {
      transferBatch: 'Transfer batch',
      reverseTransfer: 'Reverse transfer',
      preview: 'Preview',
      close: 'Close',
    },
    aria: {
      destinationWarehouse: 'Destination warehouse',
      destinationBin: 'Destination bin',
      transferPurpose: 'Transfer purpose',
    },
    labels: {
      currentLocation: 'Current location',
      currentQuantity: 'Current quantity',
      latestWeight: 'Latest weight',
      latestTotalWeight: 'Latest total weight',
      entireCurrentQuantity: 'Entire current quantity',
      entireQuantity: 'Entire quantity',
      entireWeight: 'Entire weight',
      fullQuantityMoved: 'Full quantity moved',
      weightSnapshot: 'Weight snapshot',
      destinationWarehouse: 'Destination warehouse',
      destinationBin: 'Destination bin',
      effectiveDate: 'Effective date',
      purpose: 'Purpose',
      locationNote: 'Location note',
      notes: 'Notes',
      stockLedger: 'Stock ledger',
      costs: 'Costs',
      costEffect: 'Cost effect',
      from: 'From',
      to: 'To',
      originalEvent: 'Original event',
      reason: 'Reason',
    },
    fallback: {
      notSet: 'Not set',
      notRecorded: 'Not recorded',
      notSelected: 'Not selected',
      teamMember: 'Team member',
      reversalEvent: 'reversal event',
      reasonRecorded: 'Reason recorded.',
      unchanged: 'Unchanged',
      notAffected: 'Not affected',
    },
    dialog: {
      title: 'Transfer Growth Batch location',
      description: 'This moves the entire current batch to another operational location. Quantity, weight, stock ledger, costs, and finance rows remain unchanged.',
      stockNote: 'This is not a stock transfer. Previously consumed inventory remains in the Growth Batch history.',
      binHint: 'Optional. Bins are limited to the selected warehouse.',
      warehousePlaceholder: 'Select warehouse',
      binPlaceholder: 'No bin',
      noBin: 'No bin',
      purposePlaceholder: 'Select purpose',
      locationNoteHint: 'Optional detail for the destination location.',
      notesRequiredHint: 'Required for Other.',
      notesOptionalHint: 'Optional unless purpose is Other.',
      reversalTitle: 'Reverse location transfer',
      reversalDescription: 'This creates a separate transfer-reversal event and moves the current whole batch back to the original source location. Quantity, weight, and costs stay unchanged.',
    },
    history: {
      title: 'Location transfers',
      description: 'Transfers move the entire current active batch between operational locations. They do not split quantity, move stock, write off cost, or post finance rows.',
      emptyTitle: 'No location transfers yet',
      emptyDescription: 'Transfer only when the whole active batch moves to another valid company location.',
      transferBadge: 'Transfer',
      transferReversalBadge: 'Transfer reversal',
      reversedBadge: 'Reversed',
      lockedBadge: 'Locked',
      by: 'by',
      sequencePrefix: 'Seq',
      reversedBy: 'Reversed by',
      onDate: 'on',
      lockedReason: 'Only the latest unreversed transfer can be reversed, and the original source must remain active.',
    },
    preview: {
      readyToast: 'Transfer preview is ready',
      blockersToast: 'Preview found blockers. Review the destination before posting.',
      stale: 'Preview is stale',
      ready: 'Preview ready',
      blockers: 'Preview blockers',
    },
    success: {
      transferred: 'Growth Batch transferred',
      reversed: 'Growth Batch transfer reversed',
    },
    errors: {
      unavailableActive: 'Transfers are only available for active Growth Batches.',
      sourceRequired: 'This batch needs a current warehouse before it can be transferred.',
      quantityRequired: 'Only active batches with current quantity greater than zero can be transferred.',
      destinationSetupRequired: 'Create or activate a destination warehouse before transferring a Growth Batch.',
      selectBatch: 'Select a Growth Batch.',
      effectiveDateRequired: 'Select an effective date.',
      dateBeforeStart: 'Transfer date must be on or after the batch start date.',
      dateFuture: 'Transfer date cannot be in the future.',
      destinationRequired: 'Select a destination warehouse.',
      destinationInactive: 'Select an active destination warehouse.',
      binInactive: 'Select an active bin that belongs to the destination warehouse.',
      purposeRequired: 'Select a transfer purpose.',
      purposeInvalid: 'Select a valid transfer purpose.',
      otherNotesRequired: 'Add notes when the transfer purpose is Other.',
      sameLocation: 'Select a destination different from the current location.',
      previewRequired: 'Preview the current transfer before posting.',
      previewBlockers: 'Resolve preview blockers before posting the transfer.',
      previewRefreshRequired: 'Refresh and preview again before posting.',
      reversalReasonRequired: 'Enter a reversal reason.',
      historyRefreshRequired: 'Refresh the transfer history before reversing.',
      managerRequired: 'Only Manager, Admin, or Owner roles can reverse transfers.',
      requestMismatch: 'This retry key belongs to different transfer inputs. Change nothing and retry, or submit the updated transfer again.',
      requestInProgress: 'A matching transfer request is already in progress. Wait a moment and refresh.',
      permissionDenied: 'Your role cannot perform this transfer action.',
      actionFailed: 'The Growth Batch action failed.',
    },
    reasonLabels: {
      operational_move: 'Operational move',
      space_management: 'Space management',
      biosecurity: 'Biosecurity',
      environment: 'Environment',
      maintenance: 'Maintenance',
      consolidation: 'Consolidation',
      other: 'Other',
    },
    blockerLabels: {
      growth_batch_transfer_reason_invalid: 'Select a valid transfer purpose.',
      growth_batch_transfer_notes_required: 'Add notes when the transfer purpose is Other.',
      growth_batch_not_active: 'Transfers are only available for active Growth Batches.',
      growth_batch_transfer_empty_batch: 'Only active batches with current quantity greater than zero can be transferred.',
      growth_batch_transfer_source_required: 'This batch needs a current warehouse before it can be transferred.',
      source_location_not_canonical: 'This batch needs a current warehouse before it can be transferred.',
      growth_batch_transfer_quantity_required: 'Only active batches with current quantity greater than zero can be transferred.',
      growth_batch_transfer_source_fingerprint_required: 'Refresh and preview again before posting.',
      growth_batch_transfer_source_changed: 'The batch location changed after preview. Refresh and preview again.',
      growth_batch_transfer_destination_required: 'Select a destination warehouse.',
      destination_warehouse_required: 'Select a destination warehouse.',
      growth_batch_transfer_destination_inactive: 'Select an active destination location.',
      destination_warehouse_inactive: 'Select an active destination location.',
      destination_bin_inactive: 'Select an active destination location.',
      destination_warehouse_invalid: 'Select a valid destination location for this company.',
      destination_bin_invalid: 'Select a valid destination location for this company.',
      growth_batch_transfer_same_location: 'Select a destination different from the current location.',
      growth_batch_transfer_stale_source: 'The batch location changed after preview. Refresh and preview again.',
      growth_batch_transfer_not_latest: 'Only the latest unreversed location transfer can be reversed.',
      growth_batch_transfer_reversal_dependency_exists: 'Only the latest unreversed location transfer can be reversed.',
      growth_batch_transfer_current_location_changed: 'The batch is no longer at the destination recorded for this transfer.',
      growth_batch_transfer_current_location_mismatch: 'The batch is no longer at the destination recorded for this transfer.',
      growth_batch_transfer_not_found: 'Refresh the transfer history before reversing.',
      growth_batch_transfer_original_event_invalid: 'Refresh the transfer history before reversing.',
      growth_batch_transfer_sequence_invalid: 'The batch event sequence changed. Refresh and try again.',
      growth_batch_transfer_source_inactive: 'The original source location is inactive. Make a new transfer to an active location instead.',
      growth_batch_transfer_original_source_inactive: 'The original source location is inactive. Make a new transfer to an active location instead.',
      growth_batch_transfer_date_before_latest_location_event: 'Transfer dates must not be earlier than the latest location-changing event.',
      growth_batch_transfer_reversal_date_before_original: 'Reversal date must be on or after the original transfer date.',
      growth_batch_transfer_date_before_start: 'Transfer dates must be on or after the batch start date.',
      growth_batch_transfer_date_in_future: 'Transfer dates cannot be in the future.',
      growth_batch_transfer_already_reversed: 'This transfer has already been reversed.',
    },
  },
  pt: {
    actions: {
      transferBatch: 'Transferir lote',
      reverseTransfer: 'Reverter transferência',
      preview: 'Pré-visualizar',
      close: 'Fechar',
    },
    aria: {
      destinationWarehouse: 'Armazém de destino',
      destinationBin: 'Localização de destino',
      transferPurpose: 'Finalidade da transferência',
    },
    labels: {
      currentLocation: 'Localização actual',
      currentQuantity: 'Quantidade actual',
      latestWeight: 'Peso mais recente',
      latestTotalWeight: 'Peso total mais recente',
      entireCurrentQuantity: 'Quantidade actual completa',
      entireQuantity: 'Quantidade completa',
      entireWeight: 'Peso completo',
      fullQuantityMoved: 'Quantidade completa movida',
      weightSnapshot: 'Registo do peso',
      destinationWarehouse: 'Armazém de destino',
      destinationBin: 'Localização de destino',
      effectiveDate: 'Data efectiva',
      purpose: 'Finalidade',
      locationNote: 'Nota da localização',
      notes: 'Notas',
      stockLedger: 'Livro de stock',
      costs: 'Custos',
      costEffect: 'Efeito no custo',
      from: 'Origem',
      to: 'Destino',
      originalEvent: 'Evento original',
      reason: 'Motivo',
    },
    fallback: {
      notSet: 'Não definido',
      notRecorded: 'Não registado',
      notSelected: 'Não seleccionado',
      teamMember: 'Membro da equipa',
      reversalEvent: 'evento de reversão',
      reasonRecorded: 'Motivo registado.',
      unchanged: 'Inalterado',
      notAffected: 'Não afectado',
    },
    dialog: {
      title: 'Transferir localização do Lote de Crescimento',
      description: 'Esta operação move todo o lote actual para outra localização operacional. A quantidade, o peso, o livro de stock, os custos e as linhas financeiras permanecem inalterados.',
      stockNote: 'Esta operação não é uma transferência de stock. O inventário consumido anteriormente permanece no histórico do Lote de Crescimento.',
      binHint: 'Opcional. As localizações ficam limitadas ao armazém seleccionado.',
      warehousePlaceholder: 'Seleccione o armazém',
      binPlaceholder: 'Sem localização',
      noBin: 'Sem localização',
      purposePlaceholder: 'Seleccione a finalidade',
      locationNoteHint: 'Detalhe opcional para a localização de destino.',
      notesRequiredHint: 'Obrigatório para Outro.',
      notesOptionalHint: 'Opcional, excepto quando a finalidade é Outro.',
      reversalTitle: 'Reverter transferência de localização',
      reversalDescription: 'Esta operação cria um evento separado de reversão de transferência e move o lote actual completo de volta para a localização de origem inicial. A quantidade, o peso e os custos permanecem inalterados.',
    },
    history: {
      title: 'Transferências de localização',
      description: 'As transferências movem todo o lote activo actual entre localizações operacionais. Não dividem quantidade, não movimentam stock, não abatem custos e não criam linhas financeiras.',
      emptyTitle: 'Ainda não existem transferências de localização',
      emptyDescription: 'Transfira apenas quando todo o lote activo se move para outra localização válida da empresa.',
      transferBadge: 'Transferência',
      transferReversalBadge: 'Reversão de transferência',
      reversedBadge: 'Revertida',
      lockedBadge: 'Bloqueada',
      by: 'por',
      sequencePrefix: 'Seq.',
      reversedBy: 'Revertida por',
      onDate: 'em',
      lockedReason: 'Apenas a transferência não revertida mais recente pode ser revertida, e a origem inicial deve continuar activa.',
    },
    preview: {
      readyToast: 'A pré-visualização da transferência está pronta',
      blockersToast: 'A pré-visualização encontrou bloqueios. Reveja o destino antes de publicar.',
      stale: 'A pré-visualização está desactualizada',
      ready: 'Pré-visualização pronta',
      blockers: 'Bloqueios da pré-visualização',
    },
    success: {
      transferred: 'Lote de Crescimento transferido',
      reversed: 'Transferência do Lote de Crescimento revertida',
    },
    errors: {
      unavailableActive: 'As transferências só estão disponíveis para Lotes de Crescimento activos.',
      sourceRequired: 'Este lote precisa de um armazém actual antes de poder ser transferido.',
      quantityRequired: 'Apenas lotes activos com quantidade actual superior a zero podem ser transferidos.',
      destinationSetupRequired: 'Crie ou active um armazém de destino antes de transferir um Lote de Crescimento.',
      selectBatch: 'Seleccione um Lote de Crescimento.',
      effectiveDateRequired: 'Seleccione uma data efectiva.',
      dateBeforeStart: 'A data da transferência deve ser igual ou posterior à data de início do lote.',
      dateFuture: 'A data da transferência não pode estar no futuro.',
      destinationRequired: 'Seleccione um armazém de destino.',
      destinationInactive: 'Seleccione um armazém de destino activo.',
      binInactive: 'Seleccione uma localização activa que pertença ao armazém de destino.',
      purposeRequired: 'Seleccione a finalidade da transferência.',
      purposeInvalid: 'Seleccione uma finalidade de transferência válida.',
      otherNotesRequired: 'Adicione notas quando a finalidade da transferência é Outro.',
      sameLocation: 'Seleccione um destino diferente da localização actual.',
      previewRequired: 'Pré-visualize a transferência actual antes de publicar.',
      previewBlockers: 'Resolva os bloqueios da pré-visualização antes de publicar a transferência.',
      previewRefreshRequired: 'Actualize e pré-visualize novamente antes de publicar.',
      reversalReasonRequired: 'Introduza o motivo da reversão.',
      historyRefreshRequired: 'Actualize o histórico de transferências antes de reverter.',
      managerRequired: 'Apenas as funções Manager, Admin ou Owner podem reverter transferências.',
      requestMismatch: 'Esta chave de repetição pertence a dados de transferência diferentes. Não altere nada e tente novamente, ou submeta a transferência actualizada.',
      requestInProgress: 'Já existe um pedido de transferência correspondente em curso. Aguarde um momento e actualize.',
      permissionDenied: 'A sua função não pode executar esta acção de transferência.',
      actionFailed: 'A acção do Lote de Crescimento falhou.',
    },
    reasonLabels: {
      operational_move: 'Movimento operacional',
      space_management: 'Gestão de espaço',
      biosecurity: 'Biossegurança',
      environment: 'Ambiente',
      maintenance: 'Manutenção',
      consolidation: 'Consolidação',
      other: 'Outro',
    },
    blockerLabels: {
      growth_batch_transfer_reason_invalid: 'Seleccione uma finalidade de transferência válida.',
      growth_batch_transfer_notes_required: 'Adicione notas quando a finalidade da transferência é Outro.',
      growth_batch_not_active: 'As transferências só estão disponíveis para Lotes de Crescimento activos.',
      growth_batch_transfer_empty_batch: 'Apenas lotes activos com quantidade actual superior a zero podem ser transferidos.',
      growth_batch_transfer_source_required: 'Este lote precisa de um armazém actual antes de poder ser transferido.',
      source_location_not_canonical: 'Este lote precisa de um armazém actual antes de poder ser transferido.',
      growth_batch_transfer_quantity_required: 'Apenas lotes activos com quantidade actual superior a zero podem ser transferidos.',
      growth_batch_transfer_source_fingerprint_required: 'Actualize e pré-visualize novamente antes de publicar.',
      growth_batch_transfer_source_changed: 'A localização do lote mudou depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_transfer_destination_required: 'Seleccione um armazém de destino.',
      destination_warehouse_required: 'Seleccione um armazém de destino.',
      growth_batch_transfer_destination_inactive: 'Seleccione uma localização de destino activa.',
      destination_warehouse_inactive: 'Seleccione uma localização de destino activa.',
      destination_bin_inactive: 'Seleccione uma localização de destino activa.',
      destination_warehouse_invalid: 'Seleccione uma localização de destino válida para esta empresa.',
      destination_bin_invalid: 'Seleccione uma localização de destino válida para esta empresa.',
      growth_batch_transfer_same_location: 'Seleccione um destino diferente da localização actual.',
      growth_batch_transfer_stale_source: 'A localização do lote mudou depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_transfer_not_latest: 'Apenas a transferência de localização não revertida mais recente pode ser revertida.',
      growth_batch_transfer_reversal_dependency_exists: 'Apenas a transferência de localização não revertida mais recente pode ser revertida.',
      growth_batch_transfer_current_location_changed: 'O lote já não está no destino registado para esta transferência.',
      growth_batch_transfer_current_location_mismatch: 'O lote já não está no destino registado para esta transferência.',
      growth_batch_transfer_not_found: 'Actualize o histórico de transferências antes de reverter.',
      growth_batch_transfer_original_event_invalid: 'Actualize o histórico de transferências antes de reverter.',
      growth_batch_transfer_sequence_invalid: 'A sequência de eventos do lote mudou. Actualize e tente novamente.',
      growth_batch_transfer_source_inactive: 'A localização de origem inicial está inactiva. Faça uma nova transferência para uma localização activa.',
      growth_batch_transfer_original_source_inactive: 'A localização de origem inicial está inactiva. Faça uma nova transferência para uma localização activa.',
      growth_batch_transfer_date_before_latest_location_event: 'As datas de transferência não podem ser anteriores ao evento de localização mais recente.',
      growth_batch_transfer_reversal_date_before_original: 'A data de reversão deve ser igual ou posterior à data da transferência original.',
      growth_batch_transfer_date_before_start: 'As datas de transferência devem ser iguais ou posteriores à data de início do lote.',
      growth_batch_transfer_date_in_future: 'As datas de transferência não podem estar no futuro.',
      growth_batch_transfer_already_reversed: 'Esta transferência já foi revertida.',
    },
  },
}

const growthBatchHarvestCopy: Record<Locale, GrowthBatchHarvestCopy> = {
  en: {
    actions: {
      recordHarvest: 'Record harvest',
      reverseHarvest: 'Reverse harvest',
      preview: 'Preview',
      close: 'Close',
      harvestAll: 'Harvest all remaining',
    },
    aria: {
      outputItem: 'Harvest output item',
      destinationWarehouse: 'Harvest destination warehouse',
      destinationBin: 'Harvest destination bin',
    },
    labels: {
      tab: 'Harvests',
      currentQuantity: 'Current quantity',
      currentWeight: 'Current weight',
      fullyHarvested: 'Fully harvested',
      awaitingCompletion: 'Awaiting completion',
      harvestKind: 'Harvest type',
      harvestedQuantity: 'Harvested batch quantity',
      harvestedWeight: 'Actual harvested weight',
      outputItem: 'Output stock item',
      outputBaseUom: 'Output base unit',
      outputQuantity: 'Output stock quantity',
      destinationWarehouse: 'Destination warehouse',
      destinationBin: 'Destination bin',
      effectiveDate: 'Effective date',
      notes: 'Notes',
      before: 'Before',
      after: 'After',
      allocatedCost: 'Allocated batch cost',
      outputUnitCost: 'Output unit cost',
      remainingCost: 'Remaining batch cost',
      stockReceipt: 'Stock receipt',
      finance: 'Finance',
      sale: 'Sale',
      cogs: 'COGS',
      sellingPrice: 'Selling price',
      originalEvent: 'Original event',
      reason: 'Reason',
      sourceLocation: 'Source location',
      destinationLocation: 'Output destination',
    },
    fallback: {
      notSet: 'Not set',
      notRecorded: 'Not recorded',
      notSelected: 'Not selected',
      teamMember: 'Team member',
      reversed: 'Reversed',
      locked: 'Locked',
      unchanged: 'Unchanged',
      notAffected: 'Not affected',
      noBin: 'No bin',
    },
    dialog: {
      title: 'Record depleting harvest',
      description: 'This reduces the Growth Batch quantity and receives one output item into stock at allocated batch cost. It does not sell, invoice, post COGS, or create finance rows.',
      allHint: 'Uses the entire current quantity and, when recorded, the entire current total weight.',
      weightRequiredHint: 'Required because this batch has a current total weight.',
      outputHint: 'The selected stock-tracked item receives one inventory receipt using its base unit.',
      warehousePlaceholder: 'Select warehouse',
      binPlaceholder: 'No bin',
      outputPlaceholder: 'Select output item',
      notesHint: 'Optional controlled harvest note.',
      reversalTitle: 'Reverse harvest',
      reversalDescription: 'This creates a separate harvest-reversal event, restores the batch quantity, weight, and cost allocation, and posts one compensating stock issue from the original output bucket.',
    },
    history: {
      title: 'Harvests',
      description: 'Depleting harvests reduce batch quantity, receive one output item into stock, and move cost from remaining to harvested allocation only.',
      emptyTitle: 'No harvests yet',
      emptyDescription: 'Record a harvest when biological quantity leaves the Growth Batch and one stock output is received.',
      harvestBadge: 'Harvest',
      harvestReversalBadge: 'Harvest reversal',
      partial: 'Partial',
      full: 'Full',
      by: 'by',
      sequencePrefix: 'Seq',
      reversedBy: 'Reversed by',
      onDate: 'on',
      lockedReason: 'Only the latest unreversed quantity, weight, or cost-affecting harvest can be reversed, and enough output stock must remain in the original bucket.',
    },
    preview: {
      readyToast: 'Harvest preview is ready',
      blockersToast: 'Preview found blockers. Review quantity, output, and destination before posting.',
      stale: 'Preview is stale',
      ready: 'Preview ready',
      blockers: 'Preview blockers',
      noSaleNoFinance: 'No sale, COGS, invoice, finance posting, or selling-price change is created.',
    },
    success: {
      harvested: 'Growth Batch harvest posted',
      reversed: 'Growth Batch harvest reversed',
    },
    errors: {
      unavailableActive: 'Harvests are only available for active Growth Batches.',
      quantityRequired: 'Only active batches with current quantity greater than zero can be harvested.',
      destinationSetupRequired: 'Create or activate a destination warehouse before recording a harvest.',
      outputSetupRequired: 'Create an active stock-tracked output item before recording a harvest.',
      selectBatch: 'Select a Growth Batch.',
      effectiveDateRequired: 'Select an effective date.',
      dateBeforeStart: 'Harvest date must be on or after the batch start date.',
      dateFuture: 'Harvest date cannot be in the future.',
      outputItemRequired: 'Select the output stock item.',
      outputQuantityRequired: 'Enter an output stock quantity greater than zero.',
      destinationRequired: 'Select a destination warehouse.',
      destinationInactive: 'Select an active destination warehouse.',
      binInactive: 'Select an active bin that belongs to the destination warehouse.',
      weightRequired: 'Enter the actual harvested weight for this batch.',
      previewRequired: 'Preview the current harvest before posting.',
      previewBlockers: 'Resolve preview blockers before posting the harvest.',
      previewRefreshRequired: 'Refresh and preview again before posting.',
      reversalReasonRequired: 'Enter a reversal reason.',
      historyRefreshRequired: 'Refresh the harvest history before reversing.',
      managerRequired: 'Only Manager, Admin, or Owner roles can reverse harvests.',
      requestMismatch: 'This retry key belongs to different harvest inputs. Change nothing and retry, or submit the updated harvest again.',
      requestInProgress: 'A matching harvest request is already in progress. Wait a moment and refresh.',
      permissionDenied: 'Your role cannot perform this harvest action.',
      actionFailed: 'The Growth Batch harvest action failed.',
    },
    blockerLabels: {
      growth_batch_not_active: 'Harvests are only available for active Growth Batches.',
      growth_batch_harvest_empty_batch: 'Only active batches with current quantity greater than zero can be harvested.',
      growth_batch_harvest_date_before_start: 'Harvest date must be on or after the batch start date.',
      growth_batch_harvest_date_in_future: 'Harvest date cannot be in the future.',
      growth_batch_harvest_date_before_latest_state_event: 'Harvest date cannot be earlier than the latest quantity, weight, cost, or location state event.',
      growth_batch_harvest_quantity_required: 'Enter a harvested batch quantity greater than zero.',
      growth_batch_harvest_quantity_exceeds_current: 'Harvested quantity cannot exceed the current batch quantity.',
      fractional_count_not_allowed: 'Count-basis harvests must use whole-number quantities.',
      growth_batch_harvest_weight_required: 'Enter the actual harvested weight for this batch.',
      growth_batch_harvest_weight_invalid: 'Harvested weight must be greater than zero.',
      growth_batch_harvest_weight_exceeds_current: 'Harvested weight cannot exceed the current total weight.',
      growth_batch_harvest_weight_without_current_weight: 'Do not enter harvested weight when the batch has no current total weight.',
      growth_batch_harvest_full_weight_must_match_current: 'A full harvest must use the entire current total weight.',
      growth_batch_harvest_output_quantity_required: 'Enter an output stock quantity greater than zero.',
      growth_batch_harvest_output_item_required: 'Select the output stock item.',
      growth_batch_harvest_output_item_invalid: 'Select a company-owned output stock item.',
      growth_batch_harvest_output_item_not_stock_tracked: 'The output item must be stock-tracked.',
      growth_batch_harvest_output_item_base_uom_required: 'The output item needs a base unit.',
      growth_batch_harvest_destination_required: 'Select a destination warehouse.',
      growth_batch_harvest_destination_invalid: 'Select a valid destination warehouse for this company.',
      growth_batch_harvest_destination_inactive: 'Select an active destination warehouse or bin.',
      growth_batch_harvest_destination_bin_invalid: 'Select a valid bin in the destination warehouse.',
      growth_batch_harvest_source_fingerprint_required: 'Refresh and preview again before posting.',
      growth_batch_harvest_source_changed: 'The batch quantity, weight, cost, status, or location changed after preview. Refresh and preview again.',
      growth_batch_harvest_sequence_invalid: 'The batch event sequence changed. Refresh and try again.',
      growth_batch_harvest_reversal_dependency_exists: 'A later quantity, weight, or cost-affecting event depends on this harvest. Reverse later dependent events first.',
      growth_batch_harvest_current_state_mismatch: 'The batch no longer matches this harvest state. Refresh the history before reversing.',
      growth_batch_harvest_reversal_insufficient_output_stock: 'The original output bucket does not have enough stock for reversal.',
      growth_batch_harvest_reversal_date_before_original: 'Reversal date must be on or after the original harvest date.',
      growth_batch_harvest_already_reversed: 'This harvest has already been reversed.',
      reversal_reason_required: 'Enter a reversal reason.',
    },
  },
  pt: {
    actions: {
      recordHarvest: 'Registar colheita',
      reverseHarvest: 'Reverter colheita',
      preview: 'Pré-visualizar',
      close: 'Fechar',
      harvestAll: 'Colher todo o restante',
    },
    aria: {
      outputItem: 'Item de saída da colheita',
      destinationWarehouse: 'Armazém de destino da colheita',
      destinationBin: 'Localização de destino da colheita',
    },
    labels: {
      tab: 'Colheitas',
      currentQuantity: 'Quantidade actual',
      currentWeight: 'Peso actual',
      fullyHarvested: 'Totalmente colhido',
      awaitingCompletion: 'A aguardar conclusão',
      harvestKind: 'Tipo de colheita',
      harvestedQuantity: 'Quantidade colhida do lote',
      harvestedWeight: 'Peso real colhido',
      outputItem: 'Item de stock produzido',
      outputBaseUom: 'Unidade base do item',
      outputQuantity: 'Quantidade de stock produzida',
      destinationWarehouse: 'Armazém de destino',
      destinationBin: 'Localização de destino',
      effectiveDate: 'Data efectiva',
      notes: 'Notas',
      before: 'Antes',
      after: 'Depois',
      allocatedCost: 'Custo do lote alocado',
      outputUnitCost: 'Custo unitário produzido',
      remainingCost: 'Custo restante do lote',
      stockReceipt: 'Recepção de stock',
      finance: 'Finanças',
      sale: 'Venda',
      cogs: 'CMV',
      sellingPrice: 'Preço de venda',
      originalEvent: 'Evento original',
      reason: 'Motivo',
      sourceLocation: 'Localização de origem',
      destinationLocation: 'Destino da produção',
    },
    fallback: {
      notSet: 'Não definido',
      notRecorded: 'Não registado',
      notSelected: 'Não seleccionado',
      teamMember: 'Membro da equipa',
      reversed: 'Revertida',
      locked: 'Bloqueada',
      unchanged: 'Inalterado',
      notAffected: 'Não afectado',
      noBin: 'Sem localização',
    },
    dialog: {
      title: 'Registar colheita depletiva',
      description: 'Esta operação reduz a quantidade do Lote de Crescimento e recebe um item produzido em stock ao custo alocado do lote. Não vende, não factura, não regista CMV e não cria linhas financeiras.',
      allHint: 'Usa toda a quantidade actual e, quando registado, todo o peso total actual.',
      weightRequiredHint: 'Obrigatório porque este lote tem peso total actual.',
      outputHint: 'O item rastreado em stock recebe uma recepção de inventário usando a sua unidade base.',
      warehousePlaceholder: 'Seleccione o armazém',
      binPlaceholder: 'Sem localização',
      outputPlaceholder: 'Seleccione o item produzido',
      notesHint: 'Nota controlada opcional da colheita.',
      reversalTitle: 'Reverter colheita',
      reversalDescription: 'Esta operação cria um evento separado de reversão da colheita, restaura a quantidade, o peso e a alocação de custo do lote, e publica uma saída compensatória do stock produzido original.',
    },
    history: {
      title: 'Colheitas',
      description: 'As colheitas depletivas reduzem a quantidade do lote, recebem um item produzido em stock e movem custo apenas de restante para colhido.',
      emptyTitle: 'Ainda não existem colheitas',
      emptyDescription: 'Registe uma colheita quando a quantidade biológica sai do Lote de Crescimento e uma produção de stock é recebida.',
      harvestBadge: 'Colheita',
      harvestReversalBadge: 'Reversão de colheita',
      partial: 'Parcial',
      full: 'Total',
      by: 'por',
      sequencePrefix: 'Seq.',
      reversedBy: 'Revertida por',
      onDate: 'em',
      lockedReason: 'Apenas a colheita não revertida mais recente que afecta quantidade, peso ou custo pode ser revertida, e deve existir stock suficiente no local de saída original.',
    },
    preview: {
      readyToast: 'A pré-visualização da colheita está pronta',
      blockersToast: 'A pré-visualização encontrou bloqueios. Reveja a quantidade, a produção e o destino antes de publicar.',
      stale: 'A pré-visualização está desactualizada',
      ready: 'Pré-visualização pronta',
      blockers: 'Bloqueios da pré-visualização',
      noSaleNoFinance: 'Não cria venda, CMV, factura, lançamento financeiro nem alteração do preço de venda.',
    },
    success: {
      harvested: 'Colheita do Lote de Crescimento publicada',
      reversed: 'Colheita do Lote de Crescimento revertida',
    },
    errors: {
      unavailableActive: 'As colheitas só estão disponíveis para Lotes de Crescimento activos.',
      quantityRequired: 'Apenas lotes activos com quantidade actual superior a zero podem ser colhidos.',
      destinationSetupRequired: 'Crie ou active um armazém de destino antes de registar uma colheita.',
      outputSetupRequired: 'Crie um item produzido activo e rastreado em stock antes de registar uma colheita.',
      selectBatch: 'Seleccione um Lote de Crescimento.',
      effectiveDateRequired: 'Seleccione uma data efectiva.',
      dateBeforeStart: 'A data da colheita deve ser igual ou posterior à data de início do lote.',
      dateFuture: 'A data da colheita não pode estar no futuro.',
      outputItemRequired: 'Seleccione o item de stock produzido.',
      outputQuantityRequired: 'Introduza uma quantidade de stock produzido superior a zero.',
      destinationRequired: 'Seleccione um armazém de destino.',
      destinationInactive: 'Seleccione um armazém de destino activo.',
      binInactive: 'Seleccione uma localização activa que pertença ao armazém de destino.',
      weightRequired: 'Introduza o peso real colhido para este lote.',
      previewRequired: 'Pré-visualize a colheita actual antes de publicar.',
      previewBlockers: 'Resolva os bloqueios da pré-visualização antes de publicar a colheita.',
      previewRefreshRequired: 'Actualize e pré-visualize novamente antes de publicar.',
      reversalReasonRequired: 'Introduza o motivo da reversão.',
      historyRefreshRequired: 'Actualize o histórico de colheitas antes de reverter.',
      managerRequired: 'Apenas as funções Manager, Admin ou Owner podem reverter colheitas.',
      requestMismatch: 'Esta chave de repetição pertence a dados de colheita diferentes. Não altere nada e tente novamente, ou submeta a colheita actualizada.',
      requestInProgress: 'Já existe um pedido de colheita correspondente em curso. Aguarde um momento e actualize.',
      permissionDenied: 'A sua função não pode executar esta acção de colheita.',
      actionFailed: 'A acção de colheita do Lote de Crescimento falhou.',
    },
    blockerLabels: {
      growth_batch_not_active: 'As colheitas só estão disponíveis para Lotes de Crescimento activos.',
      growth_batch_harvest_empty_batch: 'Apenas lotes activos com quantidade actual superior a zero podem ser colhidos.',
      growth_batch_harvest_date_before_start: 'A data da colheita deve ser igual ou posterior à data de início do lote.',
      growth_batch_harvest_date_in_future: 'A data da colheita não pode estar no futuro.',
      growth_batch_harvest_date_before_latest_state_event: 'A data da colheita não pode ser anterior ao evento de quantidade, peso, custo ou localização mais recente.',
      growth_batch_harvest_quantity_required: 'Introduza uma quantidade colhida superior a zero.',
      growth_batch_harvest_quantity_exceeds_current: 'A quantidade colhida não pode exceder a quantidade actual do lote.',
      fractional_count_not_allowed: 'Colheitas baseadas em contagem devem usar quantidades inteiras.',
      growth_batch_harvest_weight_required: 'Introduza o peso real colhido para este lote.',
      growth_batch_harvest_weight_invalid: 'O peso colhido deve ser superior a zero.',
      growth_batch_harvest_weight_exceeds_current: 'O peso colhido não pode exceder o peso total actual.',
      growth_batch_harvest_weight_without_current_weight: 'Não introduza peso colhido quando o lote não tem peso total actual.',
      growth_batch_harvest_full_weight_must_match_current: 'Uma colheita total deve usar todo o peso total actual.',
      growth_batch_harvest_output_quantity_required: 'Introduza uma quantidade de stock produzido superior a zero.',
      growth_batch_harvest_output_item_required: 'Seleccione o item de stock produzido.',
      growth_batch_harvest_output_item_invalid: 'Seleccione um item produzido pertencente à empresa.',
      growth_batch_harvest_output_item_not_stock_tracked: 'O item produzido deve ser rastreado em stock.',
      growth_batch_harvest_output_item_base_uom_required: 'O item produzido precisa de unidade base.',
      growth_batch_harvest_destination_required: 'Seleccione um armazém de destino.',
      growth_batch_harvest_destination_invalid: 'Seleccione um armazém de destino válido para esta empresa.',
      growth_batch_harvest_destination_inactive: 'Seleccione um armazém ou localização de destino activo.',
      growth_batch_harvest_destination_bin_invalid: 'Seleccione uma localização válida no armazém de destino.',
      growth_batch_harvest_source_fingerprint_required: 'Actualize e pré-visualize novamente antes de publicar.',
      growth_batch_harvest_source_changed: 'A quantidade, o peso, o custo, o estado ou a localização do lote mudaram depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_harvest_sequence_invalid: 'A sequência de eventos do lote mudou. Actualize e tente novamente.',
      growth_batch_harvest_reversal_dependency_exists: 'Um evento posterior de quantidade, peso ou custo depende desta colheita. Reverta primeiro os eventos dependentes posteriores.',
      growth_batch_harvest_current_state_mismatch: 'O lote já não corresponde ao estado desta colheita. Actualize o histórico antes de reverter.',
      growth_batch_harvest_reversal_insufficient_output_stock: 'O local de produção original não tem stock suficiente para reversão.',
      growth_batch_harvest_reversal_date_before_original: 'A data de reversão deve ser igual ou posterior à data da colheita original.',
      growth_batch_harvest_already_reversed: 'Esta colheita já foi revertida.',
      reversal_reason_required: 'Introduza o motivo da reversão.',
    },
  },
}

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
  stock_input: 'positive',
  stock_input_reversal: 'warning',
  mortality: 'warning',
  shrinkage: 'warning',
  mortality_reversal: 'info',
  shrinkage_reversal: 'info',
  transfer: 'info',
  transfer_reversal: 'warning',
  harvest: 'positive',
  harvest_reversal: 'warning',
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

function isGrowthBatchTransferBlockerCode(code: string): code is GrowthBatchTransferBlockerCode {
  return (transferBlockerCodes as readonly string[]).includes(code)
}

function isGrowthBatchHarvestBlockerCode(code: string): code is GrowthBatchHarvestBlockerCode {
  return (harvestBlockerCodes as readonly string[]).includes(code)
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

function locationDisplay(parts: Array<string | null | undefined>) {
  const value = parts.filter(Boolean).join(' / ')
  return value || 'Not set'
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

function emptyStockInputLine(): StockInputLineForm {
  return {
    clientId: crypto.randomUUID(),
    itemId: '',
    quantity: '',
    sourceWarehouseId: '',
    sourceBinId: '',
    lineNotes: '',
  }
}

function emptyStockInputForm(): StockInputForm {
  return {
    effectiveDate: today(),
    notes: '',
    lines: [emptyStockInputLine()],
  }
}

function emptyLossForm(): LossForm {
  return {
    lossType: 'mortality',
    effectiveDate: today(),
    quantityLost: '',
    weightLost: '',
    reasonCode: 'disease',
    notes: '',
  }
}

function emptyReversalForm(): ReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    reason: '',
    confirmation: '',
  }
}

function emptyLossReversalForm(): LossReversalForm {
  return {
    eventId: '',
    eventReference: '',
    lossType: 'mortality',
    reason: '',
  }
}

function emptyTransferForm(): TransferForm {
  return {
    destinationWarehouseId: '',
    destinationBinId: '',
    locationDescription: '',
    effectiveDate: today(),
    reasonCode: 'operational_move',
    notes: '',
  }
}

function emptyTransferReversalForm(): TransferReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    expectedCurrentLocationFingerprint: '',
    reason: '',
  }
}

function emptyHarvestForm(): HarvestForm {
  return {
    effectiveDate: today(),
    harvestedPrimaryQty: '',
    harvestedWeight: '',
    outputItemId: '',
    outputQuantity: '',
    destinationWarehouseId: '',
    destinationBinId: '',
    notes: '',
  }
}

function emptyHarvestReversalForm(): HarvestReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    reason: '',
  }
}

function friendlyError(error: unknown, transferCopy?: GrowthBatchTransferCopy, harvestCopy?: GrowthBatchHarvestCopy) {
  const raw = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '')
  const rules: [RegExp, string][] = [
    [/fractional_count_not_allowed/i, harvestCopy?.blockerLabels.fractional_count_not_allowed || 'Count batches must use whole-number quantities.'],
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
    [/growth_batch_input_date_before_start/i, 'Stock input date must be on or after the batch start date.'],
    [/growth_batch_input_date_in_future/i, 'Stock input date cannot be in the future.'],
    [/growth_batch_input_lines_required/i, 'Add at least one stock input line.'],
    [/growth_batch_input_quantity_invalid/i, 'Stock input quantities must be greater than zero.'],
    [/growth_batch_input_duplicate_bucket/i, 'Combine duplicate stock input lines that use the same item, warehouse, and bin.'],
    [/growth_batch_input_uom_mismatch/i, 'Stock inputs must use the item base unit.'],
    [/growth_batch_input_source_invalid|warehouse_not_found|bin_not_found/i, 'Select a valid source warehouse and bin.'],
    [/growth_batch_input_item_not_stock_tracked/i, 'Select a stock-tracked inventory item.'],
    [/insufficient_stock/i, 'The selected source bin does not have enough stock.'],
    [/growth_batch_stock_input_already_reversed/i, 'This stock-input event has already been reversed.'],
    [/growth_batch_loss_already_reversed/i, 'This loss event has already been reversed.'],
    [/growth_batch_loss_reversal_dependency_exists/i, 'A later quantity or weight event depends on this loss. Reverse later dependent events first.'],
    [/growth_batch_transfer_reason_invalid/i, transferCopy?.errors.purposeInvalid || 'Select a valid transfer purpose.'],
    [/growth_batch_transfer_notes_required/i, transferCopy?.errors.otherNotesRequired || 'Add notes when the transfer purpose is Other.'],
    [/growth_batch_transfer_source_required|source_location_not_canonical/i, transferCopy?.errors.sourceRequired || 'This batch needs a current warehouse before it can be transferred.'],
    [/growth_batch_transfer_quantity_required|growth_batch_transfer_empty_batch/i, transferCopy?.errors.quantityRequired || 'Only active batches with current quantity greater than zero can be transferred.'],
    [/growth_batch_transfer_source_fingerprint_required/i, transferCopy?.errors.previewRefreshRequired || 'Refresh and preview again before posting.'],
    [/growth_batch_transfer_source_changed/i, transferCopy?.blockerLabels.growth_batch_transfer_source_changed || 'The batch location changed after preview. Refresh and preview again.'],
    [/growth_batch_transfer_destination_required|destination_warehouse_required/i, transferCopy?.errors.destinationRequired || 'Select a destination warehouse.'],
    [/growth_batch_transfer_destination_inactive|destination_warehouse_inactive|destination_bin_inactive/i, transferCopy?.blockerLabels.growth_batch_transfer_destination_inactive || 'Select an active destination location.'],
    [/destination_warehouse_invalid|destination_bin_invalid/i, transferCopy?.blockerLabels.destination_warehouse_invalid || 'Select a valid destination location for this company.'],
    [/growth_batch_transfer_same_location/i, transferCopy?.errors.sameLocation || 'Select a destination different from the current location.'],
    [/growth_batch_transfer_stale_source/i, transferCopy?.blockerLabels.growth_batch_transfer_stale_source || 'The batch location changed after preview. Refresh and preview again.'],
    [/growth_batch_transfer_not_latest|growth_batch_transfer_reversal_dependency_exists/i, transferCopy?.blockerLabels.growth_batch_transfer_not_latest || 'Only the latest unreversed location transfer can be reversed.'],
    [/growth_batch_transfer_current_location_changed|growth_batch_transfer_current_location_mismatch/i, transferCopy?.blockerLabels.growth_batch_transfer_current_location_changed || 'The batch is no longer at the destination recorded for this transfer.'],
    [/growth_batch_transfer_not_found|growth_batch_transfer_original_event_invalid/i, transferCopy?.errors.historyRefreshRequired || 'Refresh the transfer history before reversing.'],
    [/growth_batch_transfer_sequence_invalid/i, transferCopy?.blockerLabels.growth_batch_transfer_sequence_invalid || 'The batch event sequence changed. Refresh and try again.'],
    [/growth_batch_transfer_source_inactive|growth_batch_transfer_original_source_inactive/i, transferCopy?.blockerLabels.growth_batch_transfer_source_inactive || 'The original source location is inactive. Make a new transfer to an active location instead.'],
    [/growth_batch_transfer_date_before_latest_location_event/i, transferCopy?.blockerLabels.growth_batch_transfer_date_before_latest_location_event || 'Transfer dates must not be earlier than the latest location-changing event.'],
    [/growth_batch_transfer_reversal_date_before_original/i, transferCopy?.blockerLabels.growth_batch_transfer_reversal_date_before_original || 'Reversal date must be on or after the original transfer date.'],
    [/growth_batch_transfer_date_before_start/i, transferCopy?.errors.dateBeforeStart || 'Transfer dates must be on or after the batch start date.'],
    [/growth_batch_transfer_date_in_future/i, transferCopy?.errors.dateFuture || 'Transfer dates cannot be in the future.'],
    [/growth_batch_transfer_already_reversed/i, transferCopy?.blockerLabels.growth_batch_transfer_already_reversed || 'This transfer has already been reversed.'],
    [/growth_batch_harvest_source_fingerprint_required/i, harvestCopy?.errors.previewRefreshRequired || 'Refresh and preview again before posting.'],
    [/growth_batch_harvest_source_changed/i, harvestCopy?.blockerLabels.growth_batch_harvest_source_changed || 'The batch changed after preview. Refresh and preview again.'],
    [/growth_batch_harvest_quantity_required|growth_batch_harvest_empty_batch/i, harvestCopy?.blockerLabels.growth_batch_harvest_quantity_required || 'Enter a harvested batch quantity greater than zero.'],
    [/growth_batch_harvest_quantity_exceeds_current/i, harvestCopy?.blockerLabels.growth_batch_harvest_quantity_exceeds_current || 'Harvested quantity cannot exceed the current batch quantity.'],
    [/growth_batch_harvest_weight_required/i, harvestCopy?.blockerLabels.growth_batch_harvest_weight_required || 'Enter the actual harvested weight for this batch.'],
    [/growth_batch_harvest_weight_invalid|growth_batch_harvest_weight_exceeds_current|growth_batch_harvest_full_weight_must_match_current|growth_batch_harvest_weight_without_current_weight/i, harvestCopy?.errors.weightRequired || 'Review harvested weight.'],
    [/growth_batch_harvest_output_item_required|growth_batch_harvest_output_item_invalid|growth_batch_harvest_output_item_not_stock_tracked|growth_batch_harvest_output_item_base_uom_required/i, harvestCopy?.errors.outputItemRequired || 'Select a valid stock-tracked output item.'],
    [/growth_batch_harvest_output_quantity_required/i, harvestCopy?.errors.outputQuantityRequired || 'Enter an output stock quantity greater than zero.'],
    [/growth_batch_harvest_destination_required|growth_batch_harvest_destination_invalid|growth_batch_harvest_destination_inactive|growth_batch_harvest_destination_bin_invalid/i, harvestCopy?.errors.destinationRequired || 'Select a valid active destination.'],
    [/growth_batch_harvest_date_before_latest_state_event/i, harvestCopy?.blockerLabels.growth_batch_harvest_date_before_latest_state_event || 'Harvest date cannot be earlier than the latest state event.'],
    [/growth_batch_harvest_date_before_start/i, harvestCopy?.errors.dateBeforeStart || 'Harvest date must be on or after the batch start date.'],
    [/growth_batch_harvest_date_in_future/i, harvestCopy?.errors.dateFuture || 'Harvest date cannot be in the future.'],
    [/growth_batch_harvest_reversal_dependency_exists/i, harvestCopy?.blockerLabels.growth_batch_harvest_reversal_dependency_exists || 'A later event depends on this harvest.'],
    [/growth_batch_harvest_current_state_mismatch/i, harvestCopy?.blockerLabels.growth_batch_harvest_current_state_mismatch || 'Refresh the harvest history before reversing.'],
    [/growth_batch_harvest_reversal_insufficient_output_stock/i, harvestCopy?.blockerLabels.growth_batch_harvest_reversal_insufficient_output_stock || 'The original output bucket does not have enough stock for reversal.'],
    [/growth_batch_harvest_reversal_date_before_original/i, harvestCopy?.blockerLabels.growth_batch_harvest_reversal_date_before_original || 'Reversal date must be on or after the original harvest date.'],
    [/growth_batch_harvest_already_reversed/i, harvestCopy?.blockerLabels.growth_batch_harvest_already_reversed || 'This harvest has already been reversed.'],
    [/loss_quantity_exceeds_current_quantity/i, 'The loss quantity cannot exceed the current batch quantity.'],
    [/loss_weight_exceeds_current_weight/i, 'The loss weight cannot exceed the current total weight.'],
    [/loss_value_required/i, 'Enter a quantity loss, weight loss, or both.'],
    [/loss_reason_invalid/i, 'Select a valid reason for this loss type.'],
    [/loss_notes_required/i, 'Add notes when the reason is Other.'],
    [/growth_batch_current_weight_required/i, 'Record or configure a current total weight before entering weight loss.'],
    [/reversal_reason_required/i, transferCopy?.errors.reversalReasonRequired || 'Enter a reversal reason.'],
    [/manager_role_required/i, transferCopy?.errors.managerRequired || 'Only Manager, Admin, or Owner roles can reverse events.'],
    [/growth_batch_not_draft/i, 'Only draft Growth Batches can be changed or activated.'],
    [/growth_batch_not_active/i, transferCopy?.errors.unavailableActive || 'This action can only be recorded on an active Growth Batch.'],
    [/growth_batch_cancelled/i, 'This Growth Batch has already been cancelled.'],
    [/idempotency_key_payload_mismatch/i, transferCopy?.errors.requestMismatch || 'This retry key belongs to different inputs. Change nothing and retry, or submit the updated form again.'],
    [/request_in_progress/i, transferCopy?.errors.requestInProgress || 'A matching request is already in progress. Wait a moment and refresh.'],
    [/cross_company_access_denied|company_access_denied/i, 'The selected company or location is not available to your account.'],
    [/permission denied|not allowed|forbidden/i, transferCopy?.errors.permissionDenied || 'Your role cannot perform this action.'],
    [/invalid_direct_cost/i, 'Enter a valid cost category, description, and amount greater than zero.'],
    [/invalid_measurement/i, 'Enter a valid measurement type, value, unit, and range.'],
  ]
  return rules.find(([pattern]) => pattern.test(raw))?.[1] || raw || harvestCopy?.errors.actionFailed || transferCopy?.errors.actionFailed || 'The Growth Batch action failed.'
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
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between md:space-y-0">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action ? <div className="flex w-full min-w-0 flex-wrap gap-2 md:w-auto md:justify-end">{action}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function GrowthBatches() {
  const { lang } = useI18n()
  const { companyId, myRole } = useOrg()
  const isMobile = useIsMobile()
  const canOperate = hasRole(myRole, ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'])
  const canManage = hasRole(myRole, ['OWNER', 'ADMIN', 'MANAGER'])
  const transferCopy = growthBatchTransferCopy[lang]
  const harvestCopy = growthBatchHarvestCopy[lang]

  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
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
  const [reversalOpen, setReversalOpen] = useState(false)
  const [lossReversalOpen, setLossReversalOpen] = useState(false)
  const [transferReversalOpen, setTransferReversalOpen] = useState(false)
  const [harvestReversalOpen, setHarvestReversalOpen] = useState(false)
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
  const [reversalForm, setReversalForm] = useState<ReversalForm>(() => emptyReversalForm())
  const [lossReversalForm, setLossReversalForm] = useState<LossReversalForm>(() => emptyLossReversalForm())
  const [transferReversalForm, setTransferReversalForm] = useState<TransferReversalForm>(() => emptyTransferReversalForm())
  const [harvestReversalForm, setHarvestReversalForm] = useState<HarvestReversalForm>(() => emptyHarvestReversalForm())
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

  const uomById = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom])), [uoms])
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
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
      setStockInputs([])
      setLosses([])
      setTransfers([])
      setHarvests([])
      setEvents([])
      return
    }

    setDetailLoading(true)
    try {
      const [stateRes, detailRes, measurementRes, costRes, stockInputRes, lossRes, transferRes, harvestRes, eventRes] = await Promise.all([
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
          .from('growth_batch_stock_input_history')
          .select('*')
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false })
          .order('line_no', { ascending: true }),
        supabase
          .from('growth_batch_loss_history')
          .select('*')
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_transfer_history')
          .select('*')
          .eq('growth_batch_id', batchId)
          .order('event_sequence', { ascending: false }),
        supabase
          .from('growth_batch_harvest_history')
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
      if (stockInputRes.error) throw stockInputRes.error
      if (lossRes.error) throw lossRes.error
      if (transferRes.error) throw transferRes.error
      if (harvestRes.error) throw harvestRes.error
      if (eventRes.error) throw eventRes.error
      setCurrentState((stateRes.data || null) as GrowthBatchCurrentState | null)
      setDetailRow((detailRes.data || null) as GrowthBatchDetailRow | null)
      setMeasurements((measurementRes.data || []) as GrowthBatchMeasurementRow[])
      setDirectCosts((costRes.data || []) as GrowthBatchDirectCostRow[])
      setStockInputs((stockInputRes.data || []) as GrowthBatchStockInputRow[])
      setLosses((lossRes.data || []) as GrowthBatchLossRow[])
      setTransfers((transferRes.data || []) as GrowthBatchTransferRow[])
      setHarvests((harvestRes.data || []) as GrowthBatchHarvestRow[])
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
    if (!detailBatch || detailBatch.status !== 'active') return 'Stock inputs can only be posted to active Growth Batches.'
    if (!stockInputForm.effectiveDate) return 'Select a stock input date.'
    if (stockInputForm.effectiveDate < detailBatch.start_date) return 'Stock input date must be on or after the batch start date.'
    if (stockInputForm.effectiveDate > today()) return 'Stock input date cannot be in the future.'
    const bucketKeys = new Set<string>()
    for (const line of stockInputForm.lines) {
      const item = itemById.get(line.itemId)
      const quantity = requiredNumber(line.quantity)
      if (!item) return 'Select a stock-tracked item for every line.'
      if (!item.base_uom_id) return 'Selected stock items must have a base unit.'
      if (!Number.isFinite(quantity) || quantity <= 0) return 'Stock input quantities must be greater than zero.'
      if (!line.sourceWarehouseId || !line.sourceBinId) return 'Select a source warehouse and bin for every line.'
      const key = `${line.itemId}|${line.sourceWarehouseId}|${line.sourceBinId}`
      if (bucketKeys.has(key)) return 'Combine duplicate stock input lines that use the same item, warehouse, and bin.'
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
        toast.success('Stock input preview is ready')
      } else {
        toast.error('Preview found blockers. Review the line details before posting.')
      }
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  async function postStockInput() {
    if (!detailBatch) return
    const validation = validateStockInputForm()
    if (validation) return toast.error(validation)
    if (!stockInputPreview || stockInputPreviewStale) return toast.error('Preview the current stock input before posting.')
    if (!stockInputPreview.ready) return toast.error('Resolve preview blockers before posting stock input.')
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
      toast.success('Stock input posted')
      setStockInputOpen(false)
      setStockInputForm(emptyStockInputForm())
      setStockInputPreview(null)
      setStockInputPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
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
    if (!reversalForm.reason.trim()) return toast.error('Enter a reversal reason.')
    if (reversalForm.confirmation.trim() !== reversalForm.eventReference) {
      return toast.error(`Type ${reversalForm.eventReference} to confirm the stock-input reversal.`)
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
      toast.success('Stock input reversed')
      setReversalOpen(false)
      setReversalForm(emptyReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
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
    if (!detailBatch || detailBatch.status !== 'active') return 'Losses can only be recorded on active Growth Batches.'
    if (!lossForm.effectiveDate) return 'Select an effective date.'
    if (lossForm.effectiveDate < detailBatch.start_date) return 'Loss date must be on or after the batch start date.'
    if (lossForm.effectiveDate > today()) return 'Loss date cannot be in the future.'
    if (!lossForm.reasonCode) return 'Select a loss reason.'
    if (!lossReasonOptions.includes(lossForm.reasonCode)) return 'Select a valid reason for this loss type.'
    if (lossForm.reasonCode === 'other' && !lossForm.notes.trim()) return 'Add notes when the reason is Other.'

    const quantityLost = lossNumericValue(lossForm.quantityLost)
    const weightLost = lossNumericValue(lossForm.weightLost)
    if (Number.isNaN(quantityLost) || Number.isNaN(weightLost)) return 'Enter valid loss numbers.'
    if ((quantityLost ?? 0) < 0 || (weightLost ?? 0) < 0) return 'Loss values cannot be negative.'
    if ((quantityLost ?? 0) <= 0 && (weightLost ?? 0) <= 0) return 'Enter a quantity loss, weight loss, or both.'
    if (quantityLost != null && quantityLost > 0) {
      const currentQuantity = num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)
      if (detailBatch.primary_quantity_basis === 'count' && quantityLost !== Math.trunc(quantityLost)) return 'Count-basis losses must use whole-number quantities.'
      if (quantityLost > currentQuantity) return 'The loss quantity cannot exceed the current batch quantity.'
    }
    if (weightLost != null && weightLost > 0) {
      if (!detailBatch.weight_uom_id || detailBatch.latest_total_weight == null) return 'Record or configure a current total weight before entering weight loss.'
      if (weightLost > num(detailBatch.latest_total_weight)) return 'The loss weight cannot exceed the current total weight.'
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
        toast.success('Loss preview is ready')
      } else {
        toast.error('Preview found blockers. Review the loss values before recording.')
      }
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
    } finally {
      setSaving(false)
    }
  }

  async function recordLoss() {
    if (!detailBatch) return
    const validation = validateLossForm()
    if (validation) return toast.error(validation)
    if (!lossPreview || lossPreviewStale) return toast.error('Preview the current loss before recording.')
    if (!lossPreview.ready) return toast.error('Resolve preview blockers before recording the loss.')
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
      toast.success(`${labelize(lossForm.lossType)} recorded`)
      setLossOpen(false)
      setLossForm(emptyLossForm())
      setLossPreview(null)
      setLossPreviewStale(false)
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
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
    if (!lossReversalForm.reason.trim()) return toast.error('Enter a reversal reason.')
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
      toast.success(`${labelize(lossReversalForm.lossType)} reversed`)
      setLossReversalOpen(false)
      setLossReversalForm(emptyLossReversalForm())
      await loadBatches()
      await loadDetail(detailBatch.id)
    } catch (error) {
      console.error(error)
      toast.error(friendlyError(error))
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
    return eventType ? labelize(eventType) : 'Created'
  }, [harvestCopy, transferCopy])

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
      toast.error(friendlyError(error, transferCopy))
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
      toast.error(friendlyError(error, transferCopy))
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
      toast.error(friendlyError(error, transferCopy))
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
    return kind ? labelize(kind) : harvestCopy.fallback.notSet
  }

  function harvestBlockerLabel(code: string | null | undefined) {
    if (!code) return harvestCopy.preview.blockers
    return isGrowthBatchHarvestBlockerCode(code) ? harvestCopy.blockerLabels[code] : labelize(code)
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
      toast.error(friendlyError(error, undefined, harvestCopy))
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
      toast.error(friendlyError(error, undefined, harvestCopy))
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
      toast.error(friendlyError(error, undefined, harvestCopy))
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
          {growthBatchEventTypeLabel(batch.latest_event_type)}
          <span className="block text-xs text-muted-foreground">{compactDate(batch.latest_event_at || batch.created_at)}</span>
        </span>
      ),
      sortValue: (batch) => batch.latest_event_at || batch.created_at,
      minWidth: 150,
    },
  ], [growthBatchEventTypeLabel, selectedCurrency])

  const sortedBatches = useMemo(() => sortPremiumRows(filteredBatches, columns, sort), [columns, filteredBatches, sort])
  const mobileRows = useMemo(() => getPremiumPageRows(sortedBatches, page, pageSize), [page, pageSize, sortedBatches])

  const draftActionButtons = detailBatch?.status === 'draft' && canOperate ? (
    <div className="flex w-full min-w-0 flex-wrap gap-2 sm:justify-start">
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={openEditDialog} disabled={saving}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit draft
      </Button>
      <Button type="button" size="sm" className="w-full sm:w-auto" onClick={activateBatch} disabled={saving}>
        <CheckCircle2 className="mr-2 h-4 w-4" />
        Activate
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setCancelOpen(true)} disabled={saving}>
        <Ban className="mr-2 h-4 w-4" />
        Cancel
      </Button>
    </div>
  ) : null

  const activeActionButtons = detailBatch?.status === 'active' && canOperate ? (
    <div className="flex w-full min-w-0 flex-wrap gap-2 sm:justify-start">
      <Button type="button" size="sm" className="w-full sm:w-auto" onClick={openStockInputDialog} disabled={saving}>
        <PackageMinus className="mr-2 h-4 w-4" />
        Post stock input
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={openTransferDialog} disabled={saving || Boolean(transferUnavailableReason())} title={transferUnavailableReason() || undefined}>
        <ArrowRightLeft className="mr-2 h-4 w-4" />
        {transferCopy.actions.transferBatch}
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={openHarvestDialog} disabled={saving || Boolean(harvestUnavailableReason())} title={harvestUnavailableReason() || undefined}>
        <Sprout className="mr-2 h-4 w-4" />
        {harvestCopy.actions.recordHarvest}
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={openLossDialog} disabled={saving || num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) <= 0} title={num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) <= 0 ? harvestCopy.labels.awaitingCompletion : undefined}>
        <AlertTriangle className="mr-2 h-4 w-4" />
        Record loss
      </Button>
      <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => setMeasurementOpen(true)} disabled={saving}>
        <LineChart className="mr-2 h-4 w-4" />
        Record measurement
      </Button>
      <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => setDirectCostOpen(true)} disabled={saving}>
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
        eyebrow="G1-G5.1 governed lifecycle"
        title="Growth Batches"
        description="Manage live biological or agricultural batches at group level. G5.1 adds governed depleting harvests, one stock output receipt, event-specific harvest reversal, append-only history, and finance isolation."
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
            <PremiumMetricCard label="Active" value={metricValues.active} description="Batches open for measurements, transfers, losses, harvests, and memo costs" icon={<Sprout />} tone="positive" variant="panel" />
            <PremiumMetricCard label="Drafts" value={metricValues.draft} description="Prepared but not activated" icon={<ClipboardList />} tone="info" variant="panel" />
            <PremiumMetricCard label="Memo direct costs" value={money(metricValues.directCost, selectedCurrency)} description="Separate from stock-input material cost" icon={<Coins />} tone="warning" variant="panel" />
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

      <div className="grid gap-5 2xl:grid-cols-[minmax(42rem,1fr)_minmax(30rem,0.8fr)]">
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
                <CardHeader className="gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PremiumStatusBadge tone={statusTone[detailBatch.status]}>{labelize(detailBatch.status)}</PremiumStatusBadge>
                      <Badge variant="outline">{labelize(detailBatch.batch_family)}</Badge>
                      <Badge variant="outline">{labelize(detailBatch.primary_quantity_basis)}</Badge>
                      {detailBatch.fully_harvested_awaiting_completion ? (
                        <Badge variant="secondary">{harvestCopy.labels.awaitingCompletion}</Badge>
                      ) : null}
                    </div>
                    <CardTitle className="mt-3 min-w-0 space-y-1">
                      <span className="block truncate">{detailBatch.reference_no}</span>
                      <span className="block whitespace-normal break-normal text-base font-semibold leading-snug text-card-foreground/90 sm:text-lg">
                        {detailBatch.name}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {detailRow?.purpose || 'Group-level Growth Batch tracking. Stock inputs consume inventory, transfers move the whole batch operationally, harvests receive one output into stock, and COGS or valuation posting remains out of scope.'}
                    </CardDescription>
                  </div>
                  <div className="flex w-full min-w-0 flex-col gap-2">
                    {draftActionButtons}
                    {activeActionButtons}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <SummaryItem label="Current quantity" value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                    <SummaryItem label="Latest weight" value={detailBatch.latest_total_weight == null ? 'Not recorded' : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                    <SummaryItem label="Remaining cost" value={money(detailBatch.remaining_cost, selectedCurrency)} />
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
                    <TabsTrigger value="stock">Stock inputs</TabsTrigger>
                    <TabsTrigger value="transfers">{transferCopy.history.title}</TabsTrigger>
                    <TabsTrigger value="harvests">{harvestCopy.labels.tab}</TabsTrigger>
                    <TabsTrigger value="losses">Losses</TabsTrigger>
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
                        <SummaryItem label="Latest event" value={growthBatchEventTypeLabel(detailBatch.latest_event_type)} />
                        <SummaryItem label="Latest activity" value={compactDateTime(detailBatch.latest_event_at || detailBatch.created_at)} />
                      </div>
                      {detailRow?.notes ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{detailRow.notes}</p> : null}
                    </DetailSection>

                    <DetailSection
                      title="Future scope guard"
                      description="These controls remain unavailable until later phases add completion, splitting, biological valuation, and accounting policies."
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        {['Split or child batches', 'Completion', 'Whole-batch reversal', 'Fair value adjustments', 'FIFO / COGS posting', 'Automatic finance posting'].map((item) => (
                          <div key={item} className="flex items-center gap-2 rounded-xl border border-card-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="stock">
                    <DetailSection
                      title="Stock input history"
                      description="Stock inputs create physical issue movements, freeze source WAC as material cost, and do not create supplier bills, payments, bank transactions, or finance journals."
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" onClick={openStockInputDialog}>
                          <PackageMinus className="mr-2 h-4 w-4" />
                          Post stock input
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label="Material cost" value={money(detailBatch.accumulated_material_cost, selectedCurrency)} />
                        <SummaryItem label="Direct cost" value={money(detailBatch.accumulated_direct_cost, selectedCurrency)} />
                        <SummaryItem label="Remaining cost" value={money(detailBatch.remaining_cost, selectedCurrency)} />
                      </div>
                      {stockInputs.length === 0 ? (
                        <PremiumEmptyState icon={<PackageMinus />} title="No stock inputs yet" description="Post stock input when physical material is issued to an active batch." compact />
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
                                      {[line.item_sku, line.event_reference, `Seq ${line.event_sequence}`].filter(Boolean).join(' / ')}
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
                                  <span>Movement {line.issue_movement_id}</span>
                                  <span>{compactDate(line.event_effective_date)} / {compactDateTime(line.event_created_at)}</span>
                                </div>
                                {line.reversal_status === 'reversed' ? (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    Reversed by {line.reversal_event_reference || 'reversal event'} on {compactDate(line.reversal_effective_date)}. Receipt movement {line.reversal_receipt_movement_id}.
                                  </p>
                                ) : canReverseLine ? (
                                  <div className="mt-3">
                                    <Button type="button" size="sm" variant="outline" onClick={() => openReversalDialog(line)} disabled={saving}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      Reverse event
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

                  <TabsContent value="transfers">
                    <DetailSection
                      title={transferCopy.history.title}
                      description={transferCopy.history.description}
                      action={detailBatch.status === 'active' && canOperate ? (
                        <Button size="sm" className="w-full sm:w-auto" onClick={openTransferDialog} disabled={saving || Boolean(transferUnavailableReason())} title={transferUnavailableReason() || undefined}>
                          <ArrowRightLeft className="mr-2 h-4 w-4" />
                          {transferCopy.actions.transferBatch}
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label={transferCopy.labels.currentLocation} value={transferSourceLocationLabel()} />
                        <SummaryItem label={transferCopy.labels.currentQuantity} value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                        <SummaryItem label={transferCopy.labels.latestWeight} value={detailBatch.latest_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                      </div>
                      {transfers.length === 0 ? (
                        <PremiumEmptyState icon={<ArrowRightLeft />} title={transferCopy.history.emptyTitle} description={transferCopy.history.emptyDescription} compact />
                      ) : (
                        <div className="space-y-3">
                          {transfers.map((transfer) => {
                            const canReverseTransfer = canManage && transfer.reversal_eligible
                            return (
                              <div key={transfer.id} className="rounded-xl border border-card-border bg-card p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <PremiumStatusBadge tone="info">{transferCopy.history.transferBadge}</PremiumStatusBadge>
                                      {transfer.reversed ? <Badge variant="outline">{transferCopy.history.reversedBadge}</Badge> : null}
                                      {!transfer.reversed && !transfer.reversal_eligible ? <Badge variant="secondary">{transferCopy.history.lockedBadge}</Badge> : null}
                                    </div>
                                    <div className="mt-2 font-medium break-words">
                                      {transferHistoryLocationLabel(transfer, 'source')} {' -> '} {transferHistoryLocationLabel(transfer, 'destination')}
                                    </div>
                                    <div className="text-sm text-muted-foreground">{transfer.event_reference} {transferCopy.history.by} {transfer.actor_display_name || transferCopy.fallback.teamMember}</div>
                                  </div>
                                  <div className="text-right text-sm font-semibold">
                                    <div>{qtyWithUom(transfer.current_primary_qty, transfer.primary_uom_code)}</div>
                                    <div className="text-xs font-normal text-muted-foreground">{transferCopy.history.sequencePrefix} {transfer.event_sequence} / {compactDate(transfer.event_effective_date)}</div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                  <SummaryItem label={transferCopy.labels.fullQuantityMoved} value={qtyWithUom(transfer.current_primary_qty, transfer.primary_uom_code)} />
                                  <SummaryItem label={transferCopy.labels.weightSnapshot} value={transfer.current_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(transfer.current_total_weight, transfer.weight_uom_code)} />
                                  <SummaryItem label={transferCopy.labels.purpose} value={transferReasonLabel(transfer.transfer_reason)} />
                                  <SummaryItem label={transferCopy.labels.costEffect} value={transferCopy.fallback.unchanged} />
                                </div>
                                {transfer.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{transfer.notes}</p> : null}
                                {transfer.reversed ? (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    {transferCopy.history.reversedBy} {transfer.reversal_event_reference || transferCopy.fallback.reversalEvent} {transferCopy.history.onDate} {compactDate(transfer.reversal_effective_date)}. {transfer.reversal_reason || transferCopy.fallback.reasonRecorded}
                                  </p>
                                ) : canReverseTransfer ? (
                                  <div className="mt-3">
                                    <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openTransferReversalDialog(transfer)} disabled={saving}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      {transferCopy.actions.reverseTransfer}
                                    </Button>
                                  </div>
                                ) : (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    {transferCopy.history.lockedReason}
                                  </p>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </DetailSection>
                  </TabsContent>

                  <TabsContent value="harvests">
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
                        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                          <div className="font-medium text-emerald-700 dark:text-emerald-300">{harvestCopy.labels.fullyHarvested}</div>
                          <div className="mt-1 text-muted-foreground">{harvestCopy.labels.awaitingCompletion}</div>
                        </div>
                      ) : null}
                      {harvests.length === 0 ? (
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

                  <TabsContent value="losses">
                    <DetailSection
                      title="Mortality and shrinkage"
                      description="Loss events reduce the current batch quantity and/or latest total weight. They do not create stock movements, finance rows, or cost write-offs."
                      action={detailBatch.status === 'active' && canOperate && num(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty) > 0 ? (
                        <Button size="sm" onClick={openLossDialog} disabled={saving}>
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          Record loss
                        </Button>
                      ) : null}
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <SummaryItem label="Current quantity" value={`${qty(detailBatch.current_primary_qty ?? detailBatch.opening_primary_qty)} ${detailBatch.primary_uom_code || ''}`.trim()} />
                        <SummaryItem label="Latest weight" value={detailBatch.latest_total_weight == null ? 'Not recorded' : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)} />
                        <SummaryItem label="Unreversed losses" value={detailBatch.unreversed_loss_event_count ?? 0} />
                      </div>
                      {losses.length === 0 ? (
                        <PremiumEmptyState icon={<AlertTriangle />} title="No mortality or shrinkage yet" description="Record loss only for active batches when quantity or weight has actually reduced." compact />
                      ) : (
                        <div className="space-y-3">
                          {losses.map((loss) => {
                            const canReverseLoss = canManage && loss.reversal_status !== 'reversed'
                            return (
                              <div key={loss.id} className="rounded-xl border border-card-border bg-card p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <PremiumStatusBadge tone="warning">{labelize(loss.loss_type)}</PremiumStatusBadge>
                                      {loss.reversal_status === 'reversed' ? <Badge variant="outline">Reversed</Badge> : null}
                                    </div>
                                    <div className="mt-2 font-medium">{labelize(loss.reason_code)}</div>
                                    <div className="text-sm text-muted-foreground">{loss.event_reference} by {loss.actor_display_name || 'Team member'}</div>
                                  </div>
                                  <div className="text-right text-sm font-semibold">
                                    {loss.quantity_lost != null ? <div>-{qtyWithUom(loss.quantity_lost, loss.quantity_uom_code || uomById.get(loss.quantity_uom_id || '')?.code)}</div> : null}
                                    {loss.weight_lost != null ? <div>-{qtyWithUom(loss.weight_lost, loss.weight_uom_code || uomById.get(loss.weight_uom_id || '')?.code)}</div> : null}
                                    <div className="text-xs font-normal text-muted-foreground">Seq {loss.event_sequence} / {compactDate(loss.event_effective_date)}</div>
                                  </div>
                                </div>
                                <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                                  <SummaryItem label="Quantity" value={`${qty(loss.quantity_before)} -> ${qty(loss.quantity_after)} ${loss.quantity_uom_code || detailBatch.primary_uom_code || ''}`.trim()} />
                                  <SummaryItem label="Weight" value={loss.total_weight_before == null && loss.total_weight_after == null ? 'Not affected' : `${qty(loss.total_weight_before)} -> ${qty(loss.total_weight_after)} ${loss.weight_uom_code || detailBatch.weight_uom_code || ''}`.trim()} />
                                </div>
                                {loss.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{loss.notes}</p> : null}
                                {loss.reversal_status === 'reversed' ? (
                                  <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                                    Reversed by {loss.reversal_event_reference || 'reversal event'} on {compactDate(loss.reversal_effective_date)}. {loss.reversal_reason || 'Reason recorded.'}
                                  </p>
                                ) : canReverseLoss ? (
                                  <div className="mt-3">
                                    <Button type="button" size="sm" variant="outline" onClick={() => openLossReversalDialog(loss)} disabled={saving}>
                                      <RotateCcw className="mr-2 h-4 w-4" />
                                      Reverse loss
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
                                    <PremiumStatusBadge tone={eventTone[event.event_type]}>{growthBatchEventTypeLabel(event.event_type)}</PremiumStatusBadge>
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

      <Dialog open={stockInputOpen} onOpenChange={setStockInputOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Post stock input</DialogTitle>
            <DialogDescription>
              This records physical stock consumption and material cost for the batch. It does not create a supplier bill, cash payment, bank transaction or finance journal.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Effective date" htmlFor="growth-stock-input-date">
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
                <Field label="Transaction notes" htmlFor="growth-stock-input-notes">
                  <Input
                    id="growth-stock-input-notes"
                    value={stockInputForm.notes}
                    onChange={(event) => {
                      markStockInputPreviewStale()
                      setStockInputForm((current) => ({ ...current, notes: event.target.value }))
                    }}
                    placeholder="Optional"
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
                        <div className="font-medium">Line {index + 1}</div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove stock input line ${index + 1}`}
                          onClick={() => removeStockInputLine(line.clientId)}
                          disabled={stockInputForm.lines.length === 1 || saving}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,1.3fr)_9rem_minmax(12rem,1fr)_minmax(12rem,1fr)]">
                        <Field label="Item" htmlFor={`growth-stock-input-item-${line.clientId}`}>
                          <Select value={line.itemId || 'none'} onValueChange={(value) => updateStockInputLine(line.clientId, { itemId: value === 'none' ? '' : value })}>
                            <SelectTrigger id={`growth-stock-input-item-${line.clientId}`} aria-label={`Stock input item line ${index + 1}`}>
                              <SelectValue placeholder="Select item" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Select item</SelectItem>
                              {items.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.sku ? `${option.sku} - ` : ''}{option.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Quantity" htmlFor={`growth-stock-input-qty-${line.clientId}`} hint={item?.base_uom_id ? `Base unit: ${uomById.get(item.base_uom_id)?.code || item.base_uom_id}` : 'Base unit appears after item selection.'}>
                          <Input
                            id={`growth-stock-input-qty-${line.clientId}`}
                            type="number"
                            min="0.000001"
                            step="0.000001"
                            value={line.quantity}
                            onChange={(event) => updateStockInputLine(line.clientId, { quantity: event.target.value })}
                          />
                        </Field>
                        <Field label="Source warehouse" htmlFor={`growth-stock-input-wh-${line.clientId}`}>
                          <Select value={line.sourceWarehouseId || 'none'} onValueChange={(value) => updateStockInputLine(line.clientId, { sourceWarehouseId: value === 'none' ? '' : value })}>
                            <SelectTrigger id={`growth-stock-input-wh-${line.clientId}`} aria-label={`Stock input source warehouse line ${index + 1}`}><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Select warehouse</SelectItem>
                              {warehouses.map((warehouse) => (
                                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code ? `${warehouse.code} - ` : ''}{warehouse.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Source bin" htmlFor={`growth-stock-input-bin-${line.clientId}`}>
                          <Select value={line.sourceBinId || 'none'} onValueChange={(value) => updateStockInputLine(line.clientId, { sourceBinId: value === 'none' ? '' : value })}>
                            <SelectTrigger id={`growth-stock-input-bin-${line.clientId}`} aria-label={`Stock input source bin line ${index + 1}`}><SelectValue placeholder="Select bin" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Select bin</SelectItem>
                              {lineBins.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} - {bin.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <Field label="Line notes" htmlFor={`growth-stock-input-notes-${line.clientId}`}>
                        <Input
                          id={`growth-stock-input-notes-${line.clientId}`}
                          value={line.lineNotes}
                          onChange={(event) => updateStockInputLine(line.clientId, { lineNotes: event.target.value })}
                          placeholder="Optional"
                        />
                      </Field>
                      {previewLine ? (
                        <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-3">
                          <SummaryItem label="Available" value={qtyWithUom(previewLine.available_quantity, uomById.get(previewLine.uom_id)?.code)} />
                          <SummaryItem label="Estimated WAC" value={money(previewLine.estimated_unit_cost, selectedCurrency)} />
                          <SummaryItem label="Line material cost" value={money(previewLine.estimated_line_cost, selectedCurrency)} />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              <Button type="button" variant="outline" onClick={addStockInputLine} disabled={saving}>
                <Plus className="mr-2 h-4 w-4" />
                Add line
              </Button>

              {stockInputPreview ? (
                <div className={cn('rounded-xl border p-4 text-sm', stockInputPreview.ready && !stockInputPreviewStale ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
                  <div className="font-medium">{stockInputPreviewStale ? 'Preview is stale' : stockInputPreview.ready ? 'Preview ready' : 'Preview blockers'}</div>
                  {stockInputPreview.blocking_reasons?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {stockInputPreview.blocking_reasons.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{labelize(String(blocker.code || 'blocker'))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <SummaryItem label="Material delta" value={money(stockInputPreview.estimated_total_material_cost, selectedCurrency)} />
                    <SummaryItem label="Projected material" value={money(stockInputPreview.projected_material_cost, selectedCurrency)} />
                    <SummaryItem label="Projected remaining" value={money(stockInputPreview.projected_remaining_cost, selectedCurrency)} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setStockInputOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" variant="outline" onClick={previewStockInput} disabled={saving}>Preview</Button>
            <Button type="button" onClick={postStockInput} disabled={saving || !stockInputPreview || stockInputPreviewStale || !stockInputPreview.ready}>
              <PackageMinus className="mr-2 h-4 w-4" />
              Post stock input
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-3xl">
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
                <div className={cn('rounded-xl border p-4 text-sm', transferPreview.ready && !transferPreviewStale ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
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
        <DialogContent>
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
        <DialogContent className="max-w-4xl">
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
                <div className={cn('rounded-xl border p-4 text-sm', harvestPreview.ready && !harvestPreviewStale ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
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
        <DialogContent>
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

      <Dialog open={lossOpen} onOpenChange={setLossOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Record mortality or shrinkage</DialogTitle>
            <DialogDescription>
              This records operational biological loss only. It updates current batch quantity and/or weight without stock movements, finance rows, or cost write-off.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Loss type" htmlFor="growth-loss-type">
                  <Select value={lossForm.lossType} onValueChange={(value) => setLossType(value as LossType)}>
                    <SelectTrigger id="growth-loss-type" aria-label="Loss type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mortality">Mortality</SelectItem>
                      <SelectItem value="shrinkage">Shrinkage</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Effective date" htmlFor="growth-loss-date">
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
                <Field label={`Quantity lost (${detailBatch?.primary_uom_code || 'unit'})`} htmlFor="growth-loss-quantity" hint={`Current: ${qtyWithUom(detailBatch?.current_primary_qty ?? detailBatch?.opening_primary_qty, detailBatch?.primary_uom_code)}`}>
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
                  <Field label={`Weight lost (${detailBatch.weight_uom_code || 'unit'})`} htmlFor="growth-loss-weight" hint={`Current: ${detailBatch.latest_total_weight == null ? 'Not recorded' : qtyWithUom(detailBatch.latest_total_weight, detailBatch.weight_uom_code)}`}>
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
                <Field label="Reason" htmlFor="growth-loss-reason">
                  <Select
                    value={lossForm.reasonCode || 'none'}
                    onValueChange={(value) => {
                      markLossPreviewStale()
                      setLossForm((current) => ({ ...current, reasonCode: value === 'none' ? '' : value as LossReasonCode }))
                    }}
                  >
                    <SelectTrigger id="growth-loss-reason" aria-label="Loss reason"><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select reason</SelectItem>
                      {lossReasonOptions.map((reason) => <SelectItem key={reason} value={reason}>{labelize(reason)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Notes" htmlFor="growth-loss-notes" hint={lossForm.reasonCode === 'other' ? 'Required for Other.' : 'Optional unless reason is Other.'}>
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
                <div className={cn('rounded-xl border p-4 text-sm', lossPreview.ready && !lossPreviewStale ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
                  <div className="font-medium">{lossPreviewStale ? 'Preview is stale' : lossPreview.ready ? 'Preview ready' : 'Preview blockers'}</div>
                  {lossPreview.blocking_reasons?.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                      {lossPreview.blocking_reasons.map((blocker, index) => (
                        <li key={`${blocker.code || 'blocker'}-${index}`}>{labelize(String(blocker.code || 'blocker'))}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <SummaryItem label="Quantity" value={`${qty(lossPreview.current_quantity)} -> ${qty(lossPreview.resulting_quantity)} ${lossPreview.quantity_uom_code || detailBatch?.primary_uom_code || ''}`.trim()} />
                    <SummaryItem label="Weight" value={lossPreview.current_total_weight == null && lossPreview.resulting_total_weight == null ? 'Not affected' : `${qty(lossPreview.current_total_weight)} -> ${qty(lossPreview.resulting_total_weight)} ${lossPreview.weight_uom_code || detailBatch?.weight_uom_code || ''}`.trim()} />
                  </div>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLossOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" variant="outline" onClick={previewLoss} disabled={saving}>Preview</Button>
            <Button type="button" onClick={recordLoss} disabled={saving || !lossPreview || lossPreviewStale || !lossPreview.ready}>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Record loss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lossReversalOpen} onOpenChange={setLossReversalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse loss event</DialogTitle>
            <DialogDescription>
              This creates a separate {labelize(lossReversalForm.lossType)} reversal event and restores the original frozen quantity and weight.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <SummaryItem label="Original event" value={lossReversalForm.eventReference || 'Not selected'} />
              <Field label="Reason" htmlFor="growth-loss-reversal-reason">
                <Textarea
                  id="growth-loss-reversal-reason"
                  value={lossReversalForm.reason}
                  onChange={(event) => setLossReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLossReversalOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" variant="destructive" onClick={reverseLoss} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reverse loss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reversalOpen} onOpenChange={setReversalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse stock-input event</DialogTitle>
            <DialogDescription>This creates compensating stock receipts for one stock-input event. It is not a whole-batch reversal.</DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="grid gap-4">
              <Field label="Effective date" htmlFor="growth-stock-reversal-date">
                <Input
                  id="growth-stock-reversal-date"
                  type="date"
                  value={reversalForm.effectiveDate}
                  onChange={(event) => setReversalForm((current) => ({ ...current, effectiveDate: event.target.value }))}
                />
              </Field>
              <Field label="Reason" htmlFor="growth-stock-reversal-reason">
                <Textarea
                  id="growth-stock-reversal-reason"
                  value={reversalForm.reason}
                  onChange={(event) => setReversalForm((current) => ({ ...current, reason: event.target.value }))}
                />
              </Field>
              <Field label={`Type ${reversalForm.eventReference} to confirm`} htmlFor="growth-stock-reversal-confirm">
                <Input
                  id="growth-stock-reversal-confirm"
                  value={reversalForm.confirmation}
                  onChange={(event) => setReversalForm((current) => ({ ...current, confirmation: event.target.value }))}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReversalOpen(false)} disabled={saving}>Close</Button>
            <Button type="button" variant="destructive" onClick={reverseStockInput} disabled={saving || !canManage}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reverse stock input
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
