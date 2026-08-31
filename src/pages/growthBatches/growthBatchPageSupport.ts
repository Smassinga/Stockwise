import type { Locale } from '../../lib/i18n'
import type { PremiumTone } from '../../components/premium/PremiumStatusBadge'
import {
  harvestBlockerCodes,
  transferBlockerCodes,
  completionBlockerCodes,
  type GrowthBatchHarvestBlockerCode,
  type GrowthBatchTransferBlockerCode,
  type GrowthBatchCompletionBlockerCode,
  type GrowthBatchHarvestCopy,
  type GrowthBatchTransferCopy,
  type GrowthBatchCompletionCopy,
} from '../../lib/growthBatchCopy'
import type {
  BatchFamily,
  QuantityBasis,
  BatchStatus,
  MeasurementType,
  DirectCostCategory,
  LossReasonCode,
  TransferReasonCode,
  GrowthBatchEventRow,
  DraftForm,
  MeasurementForm,
  DirectCostForm,
  StockInputLineForm,
  StockInputForm,
  LossForm,
  ReversalForm,
  LossReversalForm,
  TransferForm,
  TransferReversalForm,
  HarvestForm,
  HarvestReversalForm,
  CompletionForm,
  CompletionReversalForm,
} from '../../lib/growthBatchTypes'

export const batchFamilies: BatchFamily[] = ['poultry', 'livestock', 'fish', 'crop', 'nursery', 'other']
export const quantityBases: QuantityBasis[] = ['count', 'weight', 'area', 'other']
export const measurementTypes: MeasurementType[] = ['total_weight', 'average_weight', 'height', 'area_observation', 'temperature', 'other']
export const directCostCategories: DirectCostCategory[] = ['labour', 'utilities', 'veterinary', 'transport', 'land_preparation', 'water', 'rent', 'other']
export const mortalityReasons: LossReasonCode[] = ['disease', 'injury', 'predator', 'weather', 'handling', 'culling', 'other']
export const shrinkageReasons: LossReasonCode[] = ['weather', 'handling', 'natural_loss', 'drying', 'spoilage', 'quality_loss', 'other']
export const transferReasons: TransferReasonCode[] = ['operational_move', 'space_management', 'biosecurity', 'environment', 'maintenance', 'consolidation', 'other']

export const statusTone: Record<BatchStatus, PremiumTone> = {
  draft: 'info',
  active: 'positive',
  completed: 'neutral',
  cancelled: 'warning',
}

export const eventTone: Record<GrowthBatchEventRow['event_type'], PremiumTone> = {
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
  completion: 'neutral',
  completion_reversal: 'info',
  cancellation: 'neutral',
}

export const basisFamily: Record<QuantityBasis, string | null> = {
  count: 'count',
  weight: 'mass',
  area: 'area',
  other: null,
}

export const today = () => new Date().toISOString().slice(0, 10)

export function localDatetimeNow() {
  const now = new Date()
  now.setSeconds(0, 0)
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function labelize(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function eventSummaryLabel(
  event: Pick<GrowthBatchEventRow, 'event_type' | 'event_summary'>,
  lang: Locale,
  eventTypeLabel: (eventType: string | null | undefined) => string,
) {
  const summary = event.event_summary?.trim()
  const normalizedSummary = summary?.toLowerCase()
  const usesBackendCode = !summary
    || normalizedSummary === event.event_type
    || /^[a-z]+(?:_[a-z]+)+$/.test(summary)

  return lang === 'pt' || usesBackendCode ? eventTypeLabel(event.event_type) : summary
}

export function isGrowthBatchTransferBlockerCode(code: string): code is GrowthBatchTransferBlockerCode {
  return (transferBlockerCodes as readonly string[]).includes(code)
}

export function isGrowthBatchHarvestBlockerCode(code: string): code is GrowthBatchHarvestBlockerCode {
  return (harvestBlockerCodes as readonly string[]).includes(code)
}

export function isGrowthBatchCompletionBlockerCode(code: string): code is GrowthBatchCompletionBlockerCode {
  return (completionBlockerCodes as readonly string[]).includes(code)
}

export function num(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function qty(value: unknown, maximumFractionDigits = 4) {
  return num(value).toLocaleString(activeDocumentLocale(), { maximumFractionDigits })
}

export function qtyWithUom(value: unknown, uomCode?: string | null, maximumFractionDigits = 4) {
  return `${qty(value, maximumFractionDigits)} ${uomCode || 'unit not set'}`.trim()
}

export function locationDisplay(parts: Array<string | null | undefined>) {
  const value = parts.filter(Boolean).join(' / ')
  return value || 'Not set'
}

export function money(value: unknown, currency?: string | null, unavailable = 'Cost unavailable') {
  if (!currency) return unavailable
  return `${currency} ${num(value).toLocaleString(activeDocumentLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function activeDocumentLocale() {
  return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('pt')
    ? 'pt-MZ'
    : 'en-GB'
}

export function compactDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString(activeDocumentLocale()) : 'Not set'
}

export function compactDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString(activeDocumentLocale()) : 'Not recorded'
}

export function cleanText(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

export function optionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function requiredNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

export function emptyDraftForm(): DraftForm {
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

export function emptyMeasurementForm(): MeasurementForm {
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

export function emptyDirectCostForm(): DirectCostForm {
  return {
    category: 'labour',
    description: '',
    amount: '',
    eventDate: today(),
    notes: '',
  }
}

export function emptyStockInputLine(): StockInputLineForm {
  return {
    clientId: crypto.randomUUID(),
    itemId: '',
    quantity: '',
    sourceWarehouseId: '',
    sourceBinId: '',
    lineNotes: '',
  }
}

export function emptyStockInputForm(): StockInputForm {
  return {
    effectiveDate: today(),
    notes: '',
    lines: [emptyStockInputLine()],
  }
}

export function emptyLossForm(): LossForm {
  return {
    lossType: 'mortality',
    effectiveDate: today(),
    quantityLost: '',
    weightLost: '',
    reasonCode: 'disease',
    notes: '',
  }
}

export function emptyReversalForm(): ReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    reason: '',
    confirmation: '',
  }
}

export function emptyLossReversalForm(): LossReversalForm {
  return {
    eventId: '',
    eventReference: '',
    lossType: 'mortality',
    reason: '',
  }
}

export function emptyTransferForm(): TransferForm {
  return {
    destinationWarehouseId: '',
    destinationBinId: '',
    locationDescription: '',
    effectiveDate: today(),
    reasonCode: 'operational_move',
    notes: '',
  }
}

export function emptyTransferReversalForm(): TransferReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    expectedCurrentLocationFingerprint: '',
    reason: '',
  }
}

export function emptyHarvestForm(): HarvestForm {
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

export function emptyHarvestReversalForm(): HarvestReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    reason: '',
  }
}

export function emptyCompletionForm(): CompletionForm {
  return {
    effectiveDate: today(),
    reason: '',
    notes: '',
  }
}

export function emptyCompletionReversalForm(): CompletionReversalForm {
  return {
    eventId: '',
    eventReference: '',
    effectiveDate: today(),
    reason: '',
  }
}

export function friendlyError(error: unknown, transferCopy?: GrowthBatchTransferCopy, harvestCopy?: GrowthBatchHarvestCopy, completionCopy?: GrowthBatchCompletionCopy) {
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
    [/growth_batch_completion_source_fingerprint_required/i, completionCopy?.errors.previewRefreshRequired || 'Refresh and preview again before completing.'],
    [/growth_batch_completion_stale_source/i, completionCopy?.blockerLabels.growth_batch_completion_stale_source || 'The batch changed after preview. Refresh and preview again.'],
    [/growth_batch_completion_quantity_remaining/i, completionCopy?.blockerLabels.growth_batch_completion_quantity_remaining || 'Completion requires zero current quantity.'],
    [/growth_batch_completion_weight_remaining/i, completionCopy?.blockerLabels.growth_batch_completion_weight_remaining || 'Completion requires zero current weight.'],
    [/growth_batch_completion_cost_remaining/i, completionCopy?.blockerLabels.growth_batch_completion_cost_remaining || 'Completion requires zero remaining cost.'],
    [/growth_batch_completion_reason_required/i, completionCopy?.errors.reasonRequired || 'Enter a completion reason.'],
    [/growth_batch_completion_status_invalid/i, completionCopy?.blockerLabels.growth_batch_completion_status_invalid || 'Completion requires the expected lifecycle status.'],
    [/growth_batch_completion_chronology_invalid/i, completionCopy?.blockerLabels.growth_batch_completion_chronology_invalid || 'Completion date cannot be earlier than the latest state event.'],
    [/growth_batch_completion_date_before_start/i, completionCopy?.errors.dateBeforeStart || 'Completion date must be on or after the batch start date.'],
    [/growth_batch_completion_date_in_future/i, completionCopy?.errors.dateFuture || 'Completion date cannot be in the future.'],
    [/growth_batch_completion_reversal_dependency_exists/i, completionCopy?.blockerLabels.growth_batch_completion_reversal_dependency_exists || 'A later event depends on this completion.'],
    [/growth_batch_completion_current_state_mismatch|growth_batch_completion_state_changed/i, completionCopy?.blockerLabels.growth_batch_completion_current_state_mismatch || 'Refresh the completion history before reversing.'],
    [/growth_batch_completion_reversal_status_invalid/i, completionCopy?.blockerLabels.growth_batch_completion_reversal_status_invalid || 'Completion reversal requires the batch to still be completed.'],
    [/growth_batch_completion_not_found|growth_batch_completion_original_event_invalid/i, completionCopy?.errors.historyRefreshRequired || 'Refresh the completion history before reversing.'],
    [/growth_batch_completion_reversal_date_before_original/i, completionCopy?.blockerLabels.growth_batch_completion_reversal_date_before_original || 'Reversal date must be on or after the original completion date.'],
    [/growth_batch_completion_already_reversed/i, completionCopy?.blockerLabels.growth_batch_completion_already_reversed || 'This completion has already been reversed.'],
    [/loss_quantity_exceeds_current_quantity/i, 'The loss quantity cannot exceed the current batch quantity.'],
    [/loss_weight_exceeds_current_weight/i, 'The loss weight cannot exceed the current total weight.'],
    [/loss_value_required/i, 'Enter a quantity loss, weight loss, or both.'],
    [/loss_reason_invalid/i, 'Select a valid reason for this loss type.'],
    [/loss_notes_required/i, 'Add notes when the reason is Other.'],
    [/growth_batch_current_weight_required/i, 'Record or configure a current total weight before entering weight loss.'],
    [/reversal_reason_required/i, completionCopy?.errors.reversalReasonRequired || harvestCopy?.errors.reversalReasonRequired || transferCopy?.errors.reversalReasonRequired || 'Enter a reversal reason.'],
    [/manager_role_required/i, completionCopy?.errors.managerRequired || harvestCopy?.errors.managerRequired || transferCopy?.errors.managerRequired || 'Only Manager, Admin, or Owner roles can reverse events.'],
    [/growth_batch_not_draft/i, 'Only draft Growth Batches can be changed or activated.'],
    [/growth_batch_not_active/i, completionCopy?.errors.unavailableActive || harvestCopy?.errors.unavailableActive || transferCopy?.errors.unavailableActive || 'This action can only be recorded on an active Growth Batch.'],
    [/growth_batch_cancelled/i, 'This Growth Batch has already been cancelled.'],
    [/idempotency_key_payload_mismatch/i, completionCopy?.errors.requestMismatch || harvestCopy?.errors.requestMismatch || transferCopy?.errors.requestMismatch || 'This retry key belongs to different inputs. Change nothing and retry, or submit the updated form again.'],
    [/request_in_progress/i, completionCopy?.errors.requestInProgress || harvestCopy?.errors.requestInProgress || transferCopy?.errors.requestInProgress || 'A matching request is already in progress. Wait a moment and refresh.'],
    [/cross_company_access_denied|company_access_denied/i, 'The selected company or location is not available to your account.'],
    [/permission denied|not allowed|forbidden/i, completionCopy?.errors.permissionDenied || harvestCopy?.errors.permissionDenied || transferCopy?.errors.permissionDenied || 'Your role cannot perform this action.'],
    [/invalid_direct_cost/i, 'Enter a valid cost category, description, and amount greater than zero.'],
    [/invalid_measurement/i, 'Enter a valid measurement type, value, unit, and range.'],
  ]
  return rules.find(([pattern]) => pattern.test(raw))?.[1] || raw || completionCopy?.errors.actionFailed || harvestCopy?.errors.actionFailed || transferCopy?.errors.actionFailed || 'The Growth Batch action failed.'
}
