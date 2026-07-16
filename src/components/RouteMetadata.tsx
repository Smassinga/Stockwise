import { useLocation } from 'react-router-dom'
import { SEO } from '../lib/seo'
import { useI18n, withI18nFallback } from '../lib/i18n'

type RouteMeta = {
  title: string
  description: string
  noindex?: boolean
}

type TitleDefinition = readonly [key: string, fallback: string]

function getRouteMeta(
  pathname: string,
  search: string,
  lang: 'en' | 'pt',
  tt: (key: string, fallback: string) => string,
): RouteMeta {
  const landingTitle = lang === 'pt'
    ? 'StockWise - Stock, vendas, lotes e registos do negócio'
    : 'StockWise - Inventory, Sales, Growth Batches, and Business Records'
  const landingDescription = lang === 'pt'
    ? 'Controle stock, compras, vendas, pagamentos, produção, lotes de crescimento e registos comerciais num workspace sério para empresas em Moçambique.'
    : 'Control stock, purchases, sales, payments, production activity, Growth Batches, and business records in one serious workspace for Mozambican businesses.'
  const appDescription = lang === 'pt'
    ? 'Workspace autenticado do StockWise para stock, vendas, compras, caixa, bancos e relatórios.'
    : 'Authenticated StockWise workspace for inventory, sales, purchasing, cash, banks, and reporting.'

  if (pathname === '/') return { title: landingTitle, description: landingDescription }

  const exact: Record<string, TitleDefinition> = {
    '/login': ['routeTitle.login', 'Sign in'],
    '/auth': ['routeTitle.login', 'Sign in'],
    '/auth/callback': ['routeTitle.signingIn', 'Signing in'],
    '/update-password': ['routeTitle.updatePassword', 'Update password'],
    '/accept-invite': ['routeTitle.acceptInvite', 'Accept invitation'],
    '/onboarding': ['routeTitle.onboarding', 'Company setup'],
    '/company-access': ['routeTitle.companyAccess', 'Company access'],
    '/activation': ['routeTitle.activation', 'Verified activation'],
    '/dashboard': ['nav.dashboard', 'Dashboard'],
    '/operator': ['nav.operator', 'Point of Sale'],
    '/items': ['nav.items', 'Items'],
    '/movements': ['nav.movements', 'Stock Movements'],
    '/warehouses': ['nav.warehouses', 'Warehouses'],
    '/transactions': ['nav.transactions', 'Transactions'],
    '/cash': ['nav.cash', 'Cash'],
    '/banks': ['nav.banks', 'Banks'],
    '/sales-invoices': ['nav.salesInvoices', 'Sales Invoices'],
    '/compliance/mz': ['nav.complianceMz', 'Mozambique Compliance'],
    '/vendor-bills': ['nav.vendorBills', 'Vendor Bills'],
    '/settlements': ['nav.settlements', 'Settlements'],
    '/reports': ['nav.reports', 'Reports'],
    '/stock-levels': ['nav.stockLevels', 'Stock Levels'],
    '/currency': ['nav.currency', 'Currency'],
    '/customers': ['nav.customers', 'Customers'],
    '/suppliers': ['nav.suppliers', 'Suppliers'],
    '/settings': ['nav.settings', 'Settings'],
    '/settings/uoms': ['nav.uom', 'Units of Measure'],
    '/uom': ['nav.uom', 'Units of Measure'],
    '/setup/import': ['nav.openingData', 'Opening Data'],
    '/bom': ['nav.bom', 'Recipes & Assemblies'],
    '/production-runs': ['nav.productionRuns', 'Production Runs'],
    '/growth-batches': ['nav.growthBatches', 'Growth Batches'],
    '/landed-cost': ['nav.landedCost', 'Landed Cost'],
    '/users': ['nav.users', 'Users'],
    '/users/roles': ['nav.roles', 'Roles'],
    '/profile': ['common.profile', 'Profile'],
    '/search': ['routeTitle.search', 'Search'],
    '/platform-control': ['nav.platformControl', 'Platform Control'],
  }

  let definition = exact[pathname]
  if (pathname === '/orders') {
    definition = new URLSearchParams(search).get('tab') === 'sales'
      ? ['nav.salesOrders', 'Sales Orders']
      : ['nav.purchaseOrders', 'Purchase Orders']
  } else if (pathname.startsWith('/orders/sales/')) {
    definition = ['nav.salesOrders', 'Sales Orders']
  } else if (pathname.startsWith('/orders/purchase/')) {
    definition = ['nav.purchaseOrders', 'Purchase Orders']
  } else if (pathname.startsWith('/banks/')) {
    definition = ['routeTitle.bankDetails', 'Bank Details']
  } else if (pathname.startsWith('/sales-invoices/')) {
    definition = ['routeTitle.salesInvoiceDetails', 'Sales Invoice Details']
  } else if (pathname.startsWith('/vendor-bills/')) {
    definition = ['routeTitle.vendorBillDetails', 'Vendor Bill Details']
  }

  if (definition) {
    return {
      title: `${tt(definition[0], definition[1])} | StockWise`,
      description: appDescription,
      noindex: true,
    }
  }

  return { title: 'StockWise', description: landingDescription, noindex: pathname !== '/' }
}

export default function RouteMetadata() {
  const { pathname, search } = useLocation()
  const { lang, t } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const meta = getRouteMeta(pathname, search, lang, tt)

  return <SEO title={meta.title} description={meta.description} noindex={meta.noindex} />
}
