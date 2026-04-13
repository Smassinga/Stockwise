export type ItemPrimaryRole =
  | 'general'
  | 'resale'
  | 'raw_material'
  | 'finished_good'
  | 'assembled_product'
  | 'service'

export type ItemProfileState = {
  primaryRole: ItemPrimaryRole
  trackInventory: boolean
  canBuy: boolean
  canSell: boolean
  isAssembled: boolean
}

export type ItemProfileRecord = ItemProfileState & {
  hasActiveBom?: boolean | null
  usedAsComponent?: boolean | null
  minStock?: number | null
}

export type ItemProfileWarningCode =
  | 'assembled_without_tracking'
  | 'bom_without_assembled_flag'
  | 'assembled_without_bom'
  | 'component_without_tracking'
  | 'service_with_inventory'
  | 'service_marked_assembled'
  | 'nonstock_with_minimum'

export const ITEM_PROFILE_DEFAULTS: Record<ItemPrimaryRole, ItemProfileState> = {
  general: {
    primaryRole: 'general',
    trackInventory: true,
    canBuy: true,
    canSell: true,
    isAssembled: false,
  },
  resale: {
    primaryRole: 'resale',
    trackInventory: true,
    canBuy: true,
    canSell: true,
    isAssembled: false,
  },
  raw_material: {
    primaryRole: 'raw_material',
    trackInventory: true,
    canBuy: true,
    canSell: false,
    isAssembled: false,
  },
  finished_good: {
    primaryRole: 'finished_good',
    trackInventory: true,
    canBuy: false,
    canSell: true,
    isAssembled: false,
  },
  assembled_product: {
    primaryRole: 'assembled_product',
    trackInventory: true,
    canBuy: false,
    canSell: true,
    isAssembled: true,
  },
  service: {
    primaryRole: 'service',
    trackInventory: false,
    canBuy: false,
    canSell: true,
    isAssembled: false,
  },
}

export function profileFromRole(primaryRole: ItemPrimaryRole): ItemProfileState {
  return { ...ITEM_PROFILE_DEFAULTS[primaryRole] }
}

export function deriveItemProfileWarnings(item: ItemProfileRecord): ItemProfileWarningCode[] {
  const warnings: ItemProfileWarningCode[] = []
  const hasActiveBom = Boolean(item.hasActiveBom)
  const usedAsComponent = Boolean(item.usedAsComponent)

  if (item.isAssembled && !item.trackInventory) warnings.push('assembled_without_tracking')
  if (hasActiveBom && !item.isAssembled) warnings.push('bom_without_assembled_flag')
  if (item.isAssembled && !hasActiveBom) warnings.push('assembled_without_bom')
  if (usedAsComponent && !item.trackInventory) warnings.push('component_without_tracking')
  if (item.primaryRole === 'service' && item.trackInventory) warnings.push('service_with_inventory')
  if (item.primaryRole === 'service' && item.isAssembled) warnings.push('service_marked_assembled')
  if (!item.trackInventory && Number(item.minStock || 0) > 0) warnings.push('nonstock_with_minimum')

  return warnings
}
