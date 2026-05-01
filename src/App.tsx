import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import RouteMetadata from './components/RouteMetadata'
import { AppLayout } from './components/layout/AppLayout'
import { useAuth } from './hooks/useAuth'
import { OrgProvider, useOrg } from './hooks/useOrg'
import { getMyCompanyAccessState, getPlatformAdminStatus } from './lib/companyAccess'
import { CanManageUsers } from './lib/roles'

const LandingPage = lazy(() => import('./pages/LandingPage'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Items = lazy(() => import('./pages/Items'))
const Operator = lazy(() => import('./pages/Operator'))
const StockMovements = lazy(() => import('./pages/StockMovements'))
const Reports = lazy(() => import('./pages/Reports'))
const Warehouses = lazy(() => import('./pages/Warehouses').then((m) => ({ default: m.Warehouses })))
const Users = lazy(() => import('./pages/Users'))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const Orders = lazy(() => import('./pages/Orders'))
const SalesInvoices = lazy(() => import('./pages/SalesInvoices'))
const SalesInvoiceDetail = lazy(() => import('./pages/SalesInvoiceDetail'))
const MozambiqueCompliance = lazy(() => import('./pages/MozambiqueCompliance'))
const VendorBills = lazy(() => import('./pages/VendorBills'))
const VendorBillDetail = lazy(() => import('./pages/VendorBillDetail'))
const Settlements = lazy(() => import('./pages/Settlements'))
const StockLevels = lazy(() => import('./pages/StockLevels'))
const CurrencyPage = lazy(() => import('./pages/Currency'))
const CustomersPage = lazy(() => import('./pages/Customers'))
const SuppliersPage = lazy(() => import('./pages/Suppliers'))
const BOMPage = lazy(() => import('./pages/BOM'))
const LandedCostPage = lazy(() => import('./pages/LandedCost'))
const Auth = lazy(() => import('./pages/Auth'))
const UomSettings = lazy(() => import('./pages/UomSettings'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Transactions = lazy(() => import('./pages/Transactions'))
const Cash = lazy(() => import('./pages/Cash'))
const Banks = lazy(() => import('./pages/Banks'))
const BankDetail = lazy(() => import('./pages/BankDetail'))
const Profile = lazy(() => import('./pages/Profile'))
const SearchResults = lazy(() => import('./pages/SearchResults'))
const CompanyAccessStatus = lazy(() => import('./pages/CompanyAccessStatus'))
const PlatformControl = lazy(() => import('./pages/PlatformControl'))
const OpeningImport = lazy(() => import('./pages/OpeningImport'))

function LoadingSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground">
      Loading...
    </div>
  )
}

function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingSplash />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

function PublicOnly() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingSplash />
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function RequireMembership() {
  const { user, loading: authLoading } = useAuth()
  const { myRole, memberStatus, loading: orgLoading } = useOrg()

  if (authLoading || orgLoading) return <LoadingSplash />
  if (!user) return <Navigate to="/login" replace />
  if (!myRole || memberStatus !== 'active') return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function RequireCompanyAccess() {
  const { companyId, loading: orgLoading } = useOrg()
  const [checking, setChecking] = useState(true)
  const [accessEnabled, setAccessEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!companyId) {
        if (!cancelled) {
          setAccessEnabled(false)
          setChecking(false)
        }
        return
      }

      try {
        setChecking(true)
        const state = await getMyCompanyAccessState(companyId)
        if (!cancelled) {
          setAccessEnabled(Boolean(state?.access_enabled))
        }
      } catch (error) {
        console.error('[Access] company access check failed', error)
        if (!cancelled) {
          setAccessEnabled(false)
        }
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [companyId])

  if (orgLoading || checking) return <LoadingSplash />
  if (!companyId) return <Navigate to="/onboarding" replace />
  if (!accessEnabled) return <Navigate to="/company-access" replace />
  return <Outlet />
}

function RequirePlatformAdmin() {
  const { user, loading: authLoading } = useAuth()
  const [checking, setChecking] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!user) {
        if (!cancelled) {
          setIsAdmin(false)
          setChecking(false)
        }
        return
      }

      try {
        setChecking(true)
        const status = await getPlatformAdminStatus()
        if (!cancelled) {
          setIsAdmin(Boolean(status?.is_admin))
        }
      } catch (error) {
        console.error('[Access] platform admin check failed', error)
        if (!cancelled) {
          setIsAdmin(false)
        }
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user])

  if (authLoading || checking) return <LoadingSplash />
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function RequireOrgRole({ allowed }: { allowed: readonly string[] }) {
  const { loading, myRole } = useOrg()

  if (loading) return <LoadingSplash />
  if (!myRole || !allowed.includes(myRole)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function ProtectedOrgArea() {
  return (
    <OrgProvider>
      <RequireMembership />
    </OrgProvider>
  )
}

function AppShellRoute() {
  const { user } = useAuth()

  if (!user) return <LoadingSplash />
  return (
    <AppLayout user={user}>
      <Outlet />
    </AppLayout>
  )
}

function FallbackRoute() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingSplash />
  return <Navigate to={user ? '/dashboard' : '/'} replace />
}

function LegacyOrderWorkspaceRedirect({ tab }: { tab: 'purchase' | 'sales' }) {
  const { orderId } = useParams()

  if (!orderId) {
    return <Navigate to={`/orders?tab=${tab}`} replace />
  }

  const params = new URLSearchParams()
  params.set('tab', tab)
  params.set('orderId', orderId)
  return <Navigate to={`/orders?${params.toString()}`} replace />
}

export default function App() {
  return (
    <>
      <RouteMetadata />
      <Routes>
        <Route path="/" element={<Suspense fallback={<LoadingSplash />}><LandingPage /></Suspense>} />

        <Route path="/login" element={<PublicOnly />}>
          <Route index element={<Suspense fallback={<LoadingSplash />}><Auth /></Suspense>} />
        </Route>
        <Route path="/auth" element={<Navigate to="/login" replace />} />

        <Route path="/auth/callback" element={<Suspense fallback={<LoadingSplash />}><AuthCallback /></Suspense>} />
        <Route path="/accept-invite" element={<Suspense fallback={<LoadingSplash />}><AcceptInvite /></Suspense>} />

        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<Suspense fallback={<LoadingSplash />}><Onboarding /></Suspense>} />
          <Route element={<RequirePlatformAdmin />}>
            <Route path="/platform-control" element={<Suspense fallback={<LoadingSplash />}><PlatformControl /></Suspense>} />
          </Route>

          <Route element={<ProtectedOrgArea />}>
            <Route path="/company-access" element={<Suspense fallback={<LoadingSplash />}><CompanyAccessStatus /></Suspense>} />

            <Route element={<RequireCompanyAccess />}>
              <Route element={<AppShellRoute />}>
                <Route path="/dashboard" element={<Suspense fallback={<LoadingSplash />}><Dashboard /></Suspense>} />
                <Route path="/operator" element={<Suspense fallback={<LoadingSplash />}><Operator /></Suspense>} />
                <Route path="/items" element={<Suspense fallback={<LoadingSplash />}><Items /></Suspense>} />
                <Route path="/movements" element={<Suspense fallback={<LoadingSplash />}><StockMovements /></Suspense>} />
                <Route path="/warehouses" element={<Suspense fallback={<LoadingSplash />}><Warehouses /></Suspense>} />
                <Route path="/transactions" element={<Suspense fallback={<LoadingSplash />}><Transactions /></Suspense>} />
                <Route path="/cash" element={<Suspense fallback={<LoadingSplash />}><Cash /></Suspense>} />
                <Route path="/banks" element={<Suspense fallback={<LoadingSplash />}><Banks /></Suspense>} />
                <Route path="/banks/:bankId" element={<Suspense fallback={<LoadingSplash />}><BankDetail /></Suspense>} />

                <Route element={<RequireOrgRole allowed={CanManageUsers} />}>
                  <Route path="/users" element={<Suspense fallback={<LoadingSplash />}><Users /></Suspense>} />
                  <Route path="/users/roles" element={<Suspense fallback={<LoadingSplash />}><Users /></Suspense>} />
                </Route>

                <Route path="/reports" element={<Suspense fallback={<LoadingSplash />}><Reports /></Suspense>} />
                <Route path="/orders/sales/:orderId" element={<LegacyOrderWorkspaceRedirect tab="sales" />} />
                <Route path="/orders/purchase/:orderId" element={<LegacyOrderWorkspaceRedirect tab="purchase" />} />
                <Route path="/orders" element={<Suspense fallback={<LoadingSplash />}><Orders /></Suspense>} />
                <Route path="/sales-invoices" element={<Suspense fallback={<LoadingSplash />}><SalesInvoices /></Suspense>} />
                <Route path="/sales-invoices/:invoiceId" element={<Suspense fallback={<LoadingSplash />}><SalesInvoiceDetail /></Suspense>} />
                <Route path="/compliance/mz" element={<Suspense fallback={<LoadingSplash />}><MozambiqueCompliance /></Suspense>} />
                <Route path="/vendor-bills" element={<Suspense fallback={<LoadingSplash />}><VendorBills /></Suspense>} />
                <Route path="/vendor-bills/:billId" element={<Suspense fallback={<LoadingSplash />}><VendorBillDetail /></Suspense>} />
                <Route path="/settlements" element={<Suspense fallback={<LoadingSplash />}><Settlements /></Suspense>} />
                <Route path="/stock-levels" element={<Suspense fallback={<LoadingSplash />}><StockLevels /></Suspense>} />
                <Route path="/currency" element={<Suspense fallback={<LoadingSplash />}><CurrencyPage /></Suspense>} />
                <Route path="/customers" element={<Suspense fallback={<LoadingSplash />}><CustomersPage /></Suspense>} />
                <Route path="/suppliers" element={<Suspense fallback={<LoadingSplash />}><SuppliersPage /></Suspense>} />
                <Route path="/settings" element={<Suspense fallback={<LoadingSplash />}><Settings /></Suspense>} />
                <Route path="/settings/uoms" element={<Suspense fallback={<LoadingSplash />}><UomSettings /></Suspense>} />
                <Route path="/uom" element={<Suspense fallback={<LoadingSplash />}><UomSettings /></Suspense>} />
                <Route path="/setup/import" element={<Suspense fallback={<LoadingSplash />}><OpeningImport /></Suspense>} />
                <Route path="/bom" element={<Suspense fallback={<LoadingSplash />}><BOMPage /></Suspense>} />
                <Route path="/landed-cost" element={<Suspense fallback={<LoadingSplash />}><LandedCostPage /></Suspense>} />
                <Route path="/profile" element={<Suspense fallback={<LoadingSplash />}><Profile /></Suspense>} />
                <Route path="/search" element={<Suspense fallback={<LoadingSplash />}><SearchResults /></Suspense>} />
              </Route>
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<FallbackRoute />} />
      </Routes>
    </>
  )
}
