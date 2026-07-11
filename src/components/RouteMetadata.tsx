import { useLocation } from 'react-router-dom'
import { SEO } from '../lib/seo'
import { useI18n } from '../lib/i18n'

type RouteMeta = {
  title: string
  description: string
  noindex?: boolean
}

function getRouteMeta(pathname: string, lang: 'en' | 'pt'): RouteMeta {
  const t = {
    landingTitle:
      lang === 'pt'
        ? 'StockWise - Stock, vendas, lotes e registos do negócio'
        : 'StockWise - Inventory, Sales, Growth Batches, and Business Records',
    landingDescription:
      lang === 'pt'
        ? 'Controle stock, compras, vendas, pagamentos, produção, Growth Batches e registos comerciais num workspace sério para empresas em Moçambique.'
        : 'Control stock, purchases, sales, payments, production activity, Growth Batches, and business records in one serious workspace for Mozambican businesses.',
    appDescription:
      lang === 'pt'
        ? 'Workspace autenticado do StockWise para stock, encomendas, caixa, bancos e reporting.'
        : 'Authenticated StockWise workspace for stock, orders, cash, banks, and reporting.',
  }

  if (pathname === '/') return { title: t.landingTitle, description: t.landingDescription }

  const exact: Record<string, RouteMeta> = {
    '/login': { title: 'Login | StockWise', description: t.appDescription, noindex: true },
    '/auth': { title: 'Login | StockWise', description: t.appDescription, noindex: true },
    '/dashboard': { title: 'Dashboard | StockWise', description: t.appDescription, noindex: true },
    '/operator': { title: 'Point of Sale | StockWise', description: t.appDescription, noindex: true },
    '/items': { title: 'Items | StockWise', description: t.appDescription, noindex: true },
    '/movements': { title: 'Movements | StockWise', description: t.appDescription, noindex: true },
    '/warehouses': { title: 'Warehouses | StockWise', description: t.appDescription, noindex: true },
    '/transactions': { title: 'Transactions | StockWise', description: t.appDescription, noindex: true },
    '/cash': { title: 'Cash | StockWise', description: t.appDescription, noindex: true },
    '/banks': { title: 'Banks | StockWise', description: t.appDescription, noindex: true },
    '/orders': { title: 'Orders | StockWise', description: t.appDescription, noindex: true },
    '/sales-invoices': { title: 'Sales Invoices | StockWise', description: t.appDescription, noindex: true },
    '/compliance/mz': { title: 'Mozambique Compliance | StockWise', description: t.appDescription, noindex: true },
    '/vendor-bills': { title: 'Vendor Bills | StockWise', description: t.appDescription, noindex: true },
    '/settlements': { title: 'Receivables and Payables | StockWise', description: t.appDescription, noindex: true },
    '/reports': { title: 'Reports | StockWise', description: t.appDescription, noindex: true },
    '/stock-levels': { title: 'Stock Levels | StockWise', description: t.appDescription, noindex: true },
    '/currency': { title: 'Currency | StockWise', description: t.appDescription, noindex: true },
    '/customers': { title: 'Customers | StockWise', description: t.appDescription, noindex: true },
    '/suppliers': { title: 'Suppliers | StockWise', description: t.appDescription, noindex: true },
    '/settings': { title: 'Settings | StockWise', description: t.appDescription, noindex: true },
    '/uom': { title: 'Units | StockWise', description: t.appDescription, noindex: true },
    '/setup/import': { title: 'Opening Data Import | StockWise', description: t.appDescription, noindex: true },
    '/bom': { title: 'Assembly | StockWise', description: t.appDescription, noindex: true },
    '/production-runs': { title: 'Production Runs | StockWise', description: t.appDescription, noindex: true },
    '/growth-batches': { title: 'Growth Batches | StockWise', description: t.appDescription, noindex: true },
    '/landed-cost': { title: 'Landed Cost | StockWise', description: t.appDescription, noindex: true },
    '/users': { title: 'Users | StockWise', description: t.appDescription, noindex: true },
    '/users/roles': { title: 'User Roles | StockWise', description: t.appDescription, noindex: true },
    '/profile': { title: 'Profile | StockWise', description: t.appDescription, noindex: true },
    '/search': { title: 'Search | StockWise', description: t.appDescription, noindex: true },
    '/onboarding': { title: 'Onboarding | StockWise', description: t.appDescription, noindex: true },
    '/company-access': { title: 'Company Access | StockWise', description: t.appDescription, noindex: true },
    '/activation': { title: 'Verified Activation | StockWise', description: t.appDescription, noindex: true },
    '/platform-control': { title: 'Platform Control | StockWise', description: t.appDescription, noindex: true },
    '/accept-invite': { title: 'Accept Invite | StockWise', description: t.appDescription, noindex: true },
    '/auth/callback': { title: 'Signing In | StockWise', description: t.appDescription, noindex: true },
    '/update-password': { title: 'Update Password | StockWise', description: t.appDescription, noindex: true },
  }

  if (exact[pathname]) return exact[pathname]
  if (pathname.startsWith('/banks/')) return { title: 'Bank Details | StockWise', description: t.appDescription, noindex: true }
  if (pathname.startsWith('/sales-invoices/')) return { title: 'Sales Invoice Details | StockWise', description: t.appDescription, noindex: true }
  if (pathname.startsWith('/vendor-bills/')) return { title: 'Vendor Bill Details | StockWise', description: t.appDescription, noindex: true }

  return { title: 'StockWise', description: t.landingDescription, noindex: pathname !== '/' }
}

export default function RouteMetadata() {
  const { pathname } = useLocation()
  const { lang } = useI18n()
  const meta = getRouteMeta(pathname, lang)

  return <SEO title={meta.title} description={meta.description} noindex={meta.noindex} />
}

