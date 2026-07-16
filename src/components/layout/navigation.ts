import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Factory,
  FileInput,
  FileUp,
  HandCoins,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Package,
  ReceiptText,
  Ruler,
  ServerCog,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Sprout,
  Truck,
  UserRound,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'

export type NavigationGroupId =
  | 'overview'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'production'
  | 'finance'
  | 'administration'
  | 'platform'

export type NavigationItemId =
  | 'dashboard'
  | 'pointOfSale'
  | 'salesOrders'
  | 'salesInvoices'
  | 'customers'
  | 'purchaseOrders'
  | 'vendorBills'
  | 'suppliers'
  | 'landedCost'
  | 'items'
  | 'stockLevels'
  | 'movements'
  | 'warehouses'
  | 'openingData'
  | 'recipes'
  | 'productionRuns'
  | 'growthBatches'
  | 'settlements'
  | 'cash'
  | 'banks'
  | 'transactions'
  | 'reports'
  | 'compliance'
  | 'users'
  | 'roles'
  | 'currency'
  | 'uom'
  | 'settings'
  | 'platformControl'

export type NavigationDefinition = {
  id: NavigationItemId
  group: NavigationGroupId
  labelKey: string
  fallbackLabel: string
  descriptionKey?: string
  fallbackDescription?: string
  to: string
  icon: LucideIcon
  requiresUserManagement?: boolean
  requiresPlatformAdmin?: boolean
}

export const navigationGroups: Array<{
  id: NavigationGroupId
  labelKey: string
  fallbackLabel: string
}> = [
  { id: 'overview', labelKey: 'shell.nav.overview', fallbackLabel: 'Overview' },
  { id: 'sales', labelKey: 'shell.nav.sales', fallbackLabel: 'Sales' },
  { id: 'purchasing', labelKey: 'shell.nav.purchasing', fallbackLabel: 'Purchasing' },
  { id: 'inventory', labelKey: 'shell.nav.inventory', fallbackLabel: 'Inventory' },
  { id: 'production', labelKey: 'shell.nav.production', fallbackLabel: 'Production' },
  { id: 'finance', labelKey: 'shell.nav.finance', fallbackLabel: 'Finance' },
  { id: 'administration', labelKey: 'shell.nav.administration', fallbackLabel: 'Administration' },
  { id: 'platform', labelKey: 'shell.nav.platform', fallbackLabel: 'Platform' },
]

export const navigationDefinitions: NavigationDefinition[] = [
  { id: 'dashboard', group: 'overview', labelKey: 'nav.dashboard', fallbackLabel: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { id: 'pointOfSale', group: 'overview', labelKey: 'nav.operator', fallbackLabel: 'Point of Sale', to: '/operator', icon: ShoppingBasket },

  { id: 'salesOrders', group: 'sales', labelKey: 'nav.salesOrders', fallbackLabel: 'Sales Orders', to: '/orders?tab=sales', icon: ClipboardCheck },
  { id: 'salesInvoices', group: 'sales', labelKey: 'nav.salesInvoices', fallbackLabel: 'Sales Invoices', to: '/sales-invoices', icon: ReceiptText },
  { id: 'customers', group: 'sales', labelKey: 'nav.customers', fallbackLabel: 'Customers', to: '/customers', icon: UserRound },

  { id: 'purchaseOrders', group: 'purchasing', labelKey: 'nav.purchaseOrders', fallbackLabel: 'Purchase Orders', to: '/orders?tab=purchase', icon: ClipboardList },
  { id: 'vendorBills', group: 'purchasing', labelKey: 'nav.vendorBills', fallbackLabel: 'Vendor Bills', to: '/vendor-bills', icon: FileInput },
  { id: 'suppliers', group: 'purchasing', labelKey: 'nav.suppliers', fallbackLabel: 'Suppliers', to: '/suppliers', icon: Truck },
  { id: 'landedCost', group: 'purchasing', labelKey: 'nav.landedCost', fallbackLabel: 'Landed Cost', to: '/landed-cost', icon: Calculator },

  { id: 'items', group: 'inventory', labelKey: 'nav.items', fallbackLabel: 'Items', to: '/items', icon: Package },
  {
    id: 'stockLevels',
    group: 'inventory',
    labelKey: 'nav.stockLevels',
    fallbackLabel: 'Stock Levels',
    descriptionKey: 'nav.description.stockLevels',
    fallbackDescription: 'Current quantities by item and warehouse',
    to: '/stock-levels',
    icon: Boxes,
  },
  {
    id: 'movements',
    group: 'inventory',
    labelKey: 'nav.movements',
    fallbackLabel: 'Stock Movements',
    descriptionKey: 'nav.description.movements',
    fallbackDescription: 'Receipts, issues, transfers, and movement history',
    to: '/movements',
    icon: ArrowLeftRight,
  },
  { id: 'warehouses', group: 'inventory', labelKey: 'nav.warehouses', fallbackLabel: 'Warehouses', to: '/warehouses', icon: Warehouse },
  {
    id: 'openingData',
    group: 'inventory',
    labelKey: 'nav.openingData',
    fallbackLabel: 'Opening Data',
    descriptionKey: 'nav.description.openingData',
    fallbackDescription: 'Import opening master data and stock',
    to: '/setup/import',
    icon: FileUp,
  },

  {
    id: 'recipes',
    group: 'production',
    labelKey: 'nav.bom',
    fallbackLabel: 'Recipes & Assemblies',
    descriptionKey: 'nav.description.recipes',
    fallbackDescription: 'Define assembly recipes and component requirements',
    to: '/bom',
    icon: ListTree,
  },
  { id: 'productionRuns', group: 'production', labelKey: 'nav.productionRuns', fallbackLabel: 'Production Runs', to: '/production-runs', icon: Factory },
  { id: 'growthBatches', group: 'production', labelKey: 'nav.growthBatches', fallbackLabel: 'Growth Batches', to: '/growth-batches', icon: Sprout },

  {
    id: 'settlements',
    group: 'finance',
    labelKey: 'nav.settlements',
    fallbackLabel: 'Settlements',
    descriptionKey: 'nav.description.settlements',
    fallbackDescription: 'Customer collections and supplier payments',
    to: '/settlements',
    icon: HandCoins,
  },
  { id: 'cash', group: 'finance', labelKey: 'nav.cash', fallbackLabel: 'Cash', to: '/cash', icon: Wallet },
  { id: 'banks', group: 'finance', labelKey: 'nav.banks', fallbackLabel: 'Banks', to: '/banks', icon: Landmark },
  {
    id: 'transactions',
    group: 'finance',
    labelKey: 'nav.transactions',
    fallbackLabel: 'Transactions',
    descriptionKey: 'nav.description.transactions',
    fallbackDescription: 'Combined cash and bank ledger activity',
    to: '/transactions',
    icon: ListChecks,
  },
  { id: 'reports', group: 'finance', labelKey: 'nav.reports', fallbackLabel: 'Reports', to: '/reports', icon: BarChart3 },
  {
    id: 'compliance',
    group: 'finance',
    labelKey: 'nav.complianceMz',
    fallbackLabel: 'Mozambique Compliance',
    descriptionKey: 'nav.description.compliance',
    fallbackDescription: 'Fiscal readiness and Mozambique document settings',
    to: '/compliance/mz',
    icon: ShieldCheck,
  },

  { id: 'users', group: 'administration', labelKey: 'nav.users', fallbackLabel: 'Users', to: '/users', icon: Users, requiresUserManagement: true },
  { id: 'roles', group: 'administration', labelKey: 'nav.roles', fallbackLabel: 'Roles', to: '/users/roles', icon: KeyRound, requiresUserManagement: true },
  { id: 'currency', group: 'administration', labelKey: 'nav.currency', fallbackLabel: 'Currency', to: '/currency', icon: Coins },
  { id: 'uom', group: 'administration', labelKey: 'nav.uom', fallbackLabel: 'Units of Measure', to: '/uom', icon: Ruler },
  { id: 'settings', group: 'administration', labelKey: 'nav.settings', fallbackLabel: 'Settings', to: '/settings', icon: SlidersHorizontal },

  {
    id: 'platformControl',
    group: 'platform',
    labelKey: 'nav.platformControl',
    fallbackLabel: 'Platform Control',
    descriptionKey: 'nav.description.platformControl',
    fallbackDescription: 'WiseCore platform administration, separate from company settings',
    to: '/platform-control',
    icon: ServerCog,
    requiresPlatformAdmin: true,
  },
]

function matchesPath(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function isNavigationItemActive(
  item: Pick<NavigationDefinition, 'id' | 'to'>,
  pathname: string,
  search: string,
) {
  const params = new URLSearchParams(search)

  if (item.id === 'salesOrders') {
    return pathname.startsWith('/orders/sales/')
      || (pathname === '/orders' && params.get('tab') === 'sales')
  }
  if (item.id === 'purchaseOrders') {
    return pathname.startsWith('/orders/purchase/')
      || (pathname === '/orders' && params.get('tab') !== 'sales')
  }
  if (item.id === 'users') return pathname === '/users'
  if (item.id === 'roles') return pathname === '/users/roles'
  if (item.id === 'uom') return pathname === '/uom' || pathname === '/settings/uoms'
  if (item.id === 'settings') return pathname === '/settings'

  return matchesPath(pathname, item.to.split('?')[0])
}

export function isOrdersWorkspaceActive(pathname: string) {
  return pathname === '/orders' || pathname.startsWith('/orders/')
}
