export type LandedCostMethod = 'quantity' | 'value' | 'equal'

export type LandedCostCharge = {
  label: string
  amount: number
}

export type LandedCostReceiptBucket = {
  key: string
  itemId: string
  itemLabel: string
  poLineId: string | null
  warehouseId: string | null
  warehouseLabel: string | null
  binId: string | null
  binLabel: string | null
  stockLevelId: string | null
  receivedQtyBase: number
  receiptValueBase: number
  onHandQtyBase: number
  previousAvgCost: number
}

export type LandedCostPreviewLine = LandedCostReceiptBucket & {
  allocatedExtra: number
  deltaPerReceivedUnit: number
  impactedQtyBase: number
  appliedRevaluation: number
  unappliedValue: number
  newAvgCost: number
  currentValue: number
  newValue: number
}

const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const round = (value: number, precision = 6) => {
  const factor = 10 ** precision
  return Math.round(n(value) * factor) / factor
}

export function buildLandedCostPreview(options: {
  buckets: LandedCostReceiptBucket[]
  charges: LandedCostCharge[]
  method: LandedCostMethod
}) {
  const validBuckets = options.buckets.filter(bucket => n(bucket.receivedQtyBase) > 0)
  const totalExtra = round(options.charges.reduce((sum, charge) => sum + n(charge.amount), 0))
  const totalReceiptQty = round(validBuckets.reduce((sum, bucket) => sum + n(bucket.receivedQtyBase), 0))
  const totalReceiptValue = round(validBuckets.reduce((sum, bucket) => sum + n(bucket.receiptValueBase), 0))
  const canAllocate = options.method !== 'value' || totalReceiptValue > 0

  let allocatedSoFar = 0

  const preview = validBuckets.map((bucket, index) => {
    const qtyShare = totalReceiptQty > 0 ? n(bucket.receivedQtyBase) / totalReceiptQty : 0
    const valueShare = totalReceiptValue > 0 ? n(bucket.receiptValueBase) / totalReceiptValue : 0
    const equalShare = validBuckets.length > 0 ? 1 / validBuckets.length : 0

    const share = options.method === 'quantity'
      ? qtyShare
      : options.method === 'value'
        ? valueShare
        : equalShare

    const allocatedExtra = !canAllocate
      ? 0
      : index === validBuckets.length - 1
      ? round(totalExtra - allocatedSoFar)
      : round(totalExtra * share)

    allocatedSoFar = round(allocatedSoFar + allocatedExtra)

    const deltaPerReceivedUnit = n(bucket.receivedQtyBase) > 0
      ? round(allocatedExtra / n(bucket.receivedQtyBase))
      : 0
    const impactedQtyBase = round(Math.max(0, Math.min(n(bucket.onHandQtyBase), n(bucket.receivedQtyBase))))
    const appliedRevaluation = round(deltaPerReceivedUnit * impactedQtyBase)
    const unappliedValue = round(Math.max(0, allocatedExtra - appliedRevaluation))
    const currentValue = round(n(bucket.onHandQtyBase) * n(bucket.previousAvgCost))
    const newAvgCost = n(bucket.onHandQtyBase) > 0
      ? round(n(bucket.previousAvgCost) + (appliedRevaluation / n(bucket.onHandQtyBase)))
      : round(n(bucket.previousAvgCost))
    const newValue = round(n(bucket.onHandQtyBase) * newAvgCost)

    return {
      ...bucket,
      allocatedExtra,
      deltaPerReceivedUnit,
      impactedQtyBase,
      appliedRevaluation,
      unappliedValue,
      newAvgCost,
      currentValue,
      newValue,
    }
  })

  const totalAppliedValue = round(preview.reduce((sum, row) => sum + row.appliedRevaluation, 0))
  const totalUnappliedValue = round(preview.reduce((sum, row) => sum + row.unappliedValue, 0))
  const totalCurrentValue = round(preview.reduce((sum, row) => sum + row.currentValue, 0))
  const totalNewValue = round(preview.reduce((sum, row) => sum + row.newValue, 0))

  return {
    preview,
    totalExtra,
    totalReceiptQty,
    totalReceiptValue,
    totalAppliedValue,
    totalUnappliedValue,
    totalCurrentValue,
    totalNewValue,
  }
}
