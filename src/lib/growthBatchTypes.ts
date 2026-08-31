// Growth-batch workspace data, form, and preview contracts.
// Runtime posting, stock, costing, and lifecycle behavior remains in the workspace/domain layers.

export type BatchFamily = 'poultry' | 'livestock' | 'fish' | 'crop' | 'nursery' | 'other'
export type QuantityBasis = 'count' | 'weight' | 'area' | 'other'
export type BatchStatus = 'draft' | 'active' | 'completed' | 'cancelled'
export type MeasurementType = 'total_weight' | 'average_weight' | 'height' | 'area_observation' | 'temperature' | 'other'
export type DirectCostCategory = 'labour' | 'utilities' | 'veterinary' | 'transport' | 'land_preparation' | 'water' | 'rent' | 'other'
export type LossType = 'mortality' | 'shrinkage'
export type LossReasonCode = 'disease' | 'injury' | 'predator' | 'weather' | 'handling' | 'culling' | 'natural_loss' | 'drying' | 'spoilage' | 'quality_loss' | 'other'
export type TransferReasonCode = 'operational_move' | 'space_management' | 'biosecurity' | 'environment' | 'maintenance' | 'consolidation' | 'other'
export type HarvestKind = 'partial' | 'full'

export type UomRow = {
  id: string
  code: string
  name: string
  family: string | null
}

export type WarehouseRow = {
  id: string
  code: string | null
  name: string
  status?: string | null
}

export type BinRow = {
  id: string
  code: string
  name: string
  warehouseId: string
  status?: string | null
}

export type ItemRow = {
  id: string
  sku: string | null
  name: string
  base_uom_id: string | null
  track_inventory: boolean
}

export type GrowthBatchRegisterRow = {
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
  completion_event_count?: number
  unreversed_completion_event_count?: number
  reversed_completion_event_count?: number
  completed_at?: string | null
  created_at: string
  activated_at: string | null
  cancelled_at: string | null
}

export type GrowthBatchCurrentState = GrowthBatchRegisterRow & {
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
  completion_event_count?: number
  unreversed_completion_event_count?: number
  reversed_completion_event_count?: number
  completed_at?: string | null
  created_by: string | null
  updated_by: string | null
  activated_by: string | null
  cancelled_by: string | null
  completed_by?: string | null
}

export type GrowthBatchDetailRow = {
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
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type GrowthBatchEventRow = {
  id: string
  event_sequence: number
  event_reference: string
  event_type: 'activation' | 'measurement' | 'direct_cost' | 'cancellation' | 'stock_input' | 'stock_input_reversal' | 'mortality' | 'shrinkage' | 'mortality_reversal' | 'shrinkage_reversal' | 'transfer' | 'transfer_reversal' | 'harvest' | 'harvest_reversal' | 'completion' | 'completion_reversal'
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

export type GrowthBatchLossRow = {
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

export type GrowthBatchTransferRow = {
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

export type GrowthBatchHarvestRow = {
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

export type GrowthBatchCompletionRow = {
  id: string
  growth_batch_id: string
  growth_batch_reference: string
  growth_batch_name: string | null
  event_id: string
  event_reference: string
  event_sequence: number
  event_effective_date: string
  event_created_at: string
  actor_display_name: string | null
  status_before: BatchStatus
  status_after: BatchStatus
  current_primary_qty: number
  primary_uom_id: string
  primary_uom_code: string | null
  current_total_weight: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  accumulated_material_cost: number
  accumulated_direct_cost: number
  accumulated_total_cost: number
  harvested_cost: number
  remaining_cost: number
  completion_reason: string
  notes: string | null
  completed_by: string | null
  completed_at: string | null
  reversed: boolean
  reversal_detail_id: string | null
  reversal_event_id: string | null
  reversal_event_reference: string | null
  reversal_event_sequence: number | null
  reversal_effective_date: string | null
  reversal_timestamp: string | null
  reversal_actor_display_name: string | null
  reversal_reason: string | null
  reversal_eligible: boolean
}

export type GrowthBatchMeasurementRow = {
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

export type GrowthBatchDirectCostRow = {
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

export type GrowthBatchStockInputRow = {
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

export type DraftForm = {
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

export type MeasurementForm = {
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

export type DirectCostForm = {
  category: DirectCostCategory
  description: string
  amount: string
  eventDate: string
  notes: string
}

export type StockInputLineForm = {
  clientId: string
  itemId: string
  quantity: string
  sourceWarehouseId: string
  sourceBinId: string
  lineNotes: string
}

export type StockInputForm = {
  effectiveDate: string
  notes: string
  lines: StockInputLineForm[]
}

export type LossForm = {
  lossType: LossType
  effectiveDate: string
  quantityLost: string
  weightLost: string
  reasonCode: LossReasonCode | ''
  notes: string
}

export type LossPreview = {
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

export type TransferLocationPreview = {
  warehouse_id: string | null
  warehouse_code?: string | null
  warehouse_name?: string | null
  bin_id: string | null
  bin_code?: string | null
  bin_name?: string | null
  location_description?: string | null
}

export type TransferPreview = {
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

export type HarvestLocationPreview = {
  warehouse_id: string | null
  warehouse_code?: string | null
  warehouse_name?: string | null
  bin_id: string | null
  bin_code?: string | null
  bin_name?: string | null
  location_description?: string | null
}

export type HarvestPreview = {
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

export type CompletionPreview = {
  ready: boolean
  blockers: Array<{ code?: string; [key: string]: unknown }>
  batch_id: string
  reference_no: string
  name: string
  batch_family: BatchFamily
  status_before: BatchStatus
  status_after: BatchStatus
  effective_date: string
  current_primary_qty: number
  primary_uom_id: string
  primary_uom_code: string | null
  current_total_weight: number | null
  weight_uom_id: string | null
  weight_uom_code: string | null
  accumulated_material_cost: number
  accumulated_direct_cost: number
  accumulated_total_cost: number
  harvested_cost: number
  remaining_cost: number
  latest_event_sequence: number
  source_fingerprint: string | null
  stock_effect: string
  finance_effect: string
  sale_effect: string
  cogs_effect: string
  explanation: string
}

export type StockInputPreviewLine = {
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

export type StockInputPreview = {
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

export type ReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  reason: string
  confirmation: string
}

export type LossReversalForm = {
  eventId: string
  eventReference: string
  lossType: LossType
  reason: string
}

export type TransferForm = {
  destinationWarehouseId: string
  destinationBinId: string
  locationDescription: string
  effectiveDate: string
  reasonCode: TransferReasonCode | ''
  notes: string
}

export type TransferReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  expectedCurrentLocationFingerprint: string
  reason: string
}

export type HarvestForm = {
  effectiveDate: string
  harvestedPrimaryQty: string
  harvestedWeight: string
  outputItemId: string
  outputQuantity: string
  destinationWarehouseId: string
  destinationBinId: string
  notes: string
}

export type HarvestReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  reason: string
}

export type CompletionForm = {
  effectiveDate: string
  reason: string
  notes: string
}

export type CompletionReversalForm = {
  eventId: string
  eventReference: string
  effectiveDate: string
  reason: string
}
