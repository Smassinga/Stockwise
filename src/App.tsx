// src/App.tsx
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './components/layout/AppLayout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Items = lazy(() => import('./pages/Items'));
const StockMovements = lazy(() => import('./pages/StockMovements'));
const Reports = lazy(() => import('./pages/Reports'));
const Warehouses = lazy(() => import('./pages/Warehouses').then(m => ({ default: m.Warehouses })));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Orders = lazy(() => import('./pages/Orders'));
const StockLevels = lazy(() => import('./pages/StockLevels'));
const CurrencyPage = lazy(() => import('./pages/Currency'));
const CustomersPage = lazy(() => import('./pages/Customers'));
const SuppliersPage = lazy(() => import('./pages/Suppliers'));
const BOMPage = lazy(() => import('./pages/BOM'));
const Auth = lazy(() => import('./pages/Auth'));
const UomSettings = lazy(() => import('./pages/UomSettings'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Cash = lazy(() => import('./pages/Cash'));
const Banks = lazy(() => import('./pages/Banks'));
const BankDetail = lazy(() => import('./pages/BankDetail'));
const ResponsiveDemo = lazy(() => import('./pages/ResponsiveDemo'));
const Profile = lazy(() => import('./pages/Profile')); // Add this line
const SearchResults = lazy(() => import('./pages/SearchResults')); // Add this line
import { OrgProvider, useOrg } from './hooks/useOrg';
import { CanManageUsers } from './lib/roles';

function LoadingSplash() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Loading…
    </div>
  );
}

/** Route guard for private areas (only checks auth) */
function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingSplash />;
  if (!user) return <Navigate to="/auth" replace state={{ from: location }} />;
  return <Outlet />;
}

/** NEW: Require org membership before mounting the main app shell */
function RequireMembership() {
  const { user, loading: authLoading } = useAuth();
  const { myRole, loading: orgLoading } = useOrg();

  if (authLoading || orgLoading) return <LoadingSplash />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!myRole) return <Navigate to="/onboarding" replace />; // not a member yet
  return <Outlet />;
}

/** Public-only guard — but membership-aware */
function PublicOnly() {
  const { user, loading: authLoading } = useAuth();
  const { myRole, loading: orgLoading } = useOrg();

  if (authLoading) return <LoadingSplash />;

  // Not logged in → allow public routes (Auth)
  if (!user) return <Outlet />;

  // Logged in → wait org status, then route correctly
  if (orgLoading) return <LoadingSplash />;
  return <Navigate to={myRole ? '/dashboard' : '/onboarding'} replace />;
}

/** Root decider: logged-out -> /auth; logged-in+no company -> /onboarding; else /dashboard */
function RootDecider() {
  const { user, loading: authLoading } = useAuth();
  const { myRole, loading: orgLoading } = useOrg();

  if (authLoading) return <LoadingSplash />;
  if (!user) return <Navigate to="/auth" replace />;
  if (orgLoading) return <LoadingSplash />;
  if (!myRole) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/dashboard" replace />;
}

/** Extra guard for org role (e.g., Users page) */
function RequireOrgRole({ allowed }: { allowed: string[] }) {
  const { loading, myRole } = useOrg();
  if (loading) return <LoadingSplash />;
  if (!myRole || !allowed.includes(myRole)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <OrgProvider>
      <Routes>
        {/* Public (but if logged, route to onboarding or dashboard) */}
        <Route path="/auth" element={<PublicOnly />}>
          <Route index element={<Suspense fallback={<LoadingSplash />}><Auth /></Suspense>} />
        </Route>
        <Route path="/auth/callback" element={<Suspense fallback={<LoadingSplash />}><AuthCallback /></Suspense>} />
        
        {/* Public: invite landing — stores token & handles auth/redirect */}
        <Route path="/accept-invite" element={<Suspense fallback={<LoadingSplash />}><AcceptInvite /></Suspense>} />
        
        {/* Private area (must be logged in) */}
        <Route element={<RequireAuth />}>
          {/* Onboarding is private but outside the app shell */}
          <Route path="/onboarding" element={<Suspense fallback={<LoadingSplash />}><Onboarding /></Suspense>} />

          {/* Main app requires membership before mounting */}
          <Route element={<RequireMembership />}>
            <Route element={<AppLayout user={user!}><Outlet /></AppLayout>}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Suspense fallback={<LoadingSplash />}><Dashboard /></Suspense>} />
              <Route path="/items" element={<Suspense fallback={<LoadingSplash />}><Items /></Suspense>} />
              <Route path="/movements" element={<Suspense fallback={<LoadingSplash />}><StockMovements /></Suspense>} />
              <Route path="/warehouses" element={<Suspense fallback={<LoadingSplash />}><Warehouses /></Suspense>} />
              <Route path="/transactions" element={<Suspense fallback={<LoadingSplash />}><Transactions /></Suspense>} />
              <Route path="/cash" element={<Suspense fallback={<LoadingSplash />}><Cash /></Suspense>} /> {/* NEW */}
              <Route path="/banks" element={<Suspense fallback={<LoadingSplash />}><Banks /></Suspense>} />              {/* NEW */}
              <Route path="/banks/:bankId" element={<Suspense fallback={<LoadingSplash />}><BankDetail /></Suspense>} />

              {/* Only OWNER/ADMIN/MANAGER can access Users */}
              <Route element={<RequireOrgRole allowed={CanManageUsers} />}>
                <Route path="/users" element={<Suspense fallback={<LoadingSplash />}><Users /></Suspense>} />
              </Route>

              <Route path="/reports" element={<Suspense fallback={<LoadingSplash />}><Reports /></Suspense>} />
              <Route path="/orders" element={<Suspense fallback={<LoadingSplash />}><Orders /></Suspense>} />
              <Route path="/stock-levels" element={<Suspense fallback={<LoadingSplash />}><StockLevels /></Suspense>} />
              <Route path="/currency" element={<Suspense fallback={<LoadingSplash />}><CurrencyPage /></Suspense>} />
              <Route path="/customers" element={<Suspense fallback={<LoadingSplash />}><CustomersPage /></Suspense>} />
              <Route path="/suppliers" element={<Suspense fallback={<LoadingSplash />}><SuppliersPage /></Suspense>} />
              <Route path="/settings" element={<Suspense fallback={<LoadingSplash />}><Settings /></Suspense>} />
              <Route path="/settings/uoms" element={<Suspense fallback={<LoadingSplash />}><UomSettings /></Suspense>} />
              {/* Friendly top-level path for sidebar */}
              <Route path="/uom" element={<Suspense fallback={<LoadingSplash />}><UomSettings /></Suspense>} />
              <Route path="/bom" element={<Suspense fallback={<LoadingSplash />}><BOMPage /></Suspense>} />
              {/* Responsive demo page */}
              <Route path="/responsive-demo" element={<Suspense fallback={<LoadingSplash />}><ResponsiveDemo /></Suspense>} />
              {/* Profile page */}
              <Route path="/profile" element={<Suspense fallback={<LoadingSplash />}><Profile /></Suspense>} />
              {/* Search results page */}
              <Route path="/search" element={<Suspense fallback={<LoadingSplash />}><SearchResults /></Suspense>} />
            </Route>
          </Route>
        </Route>

        {/* Fallback uses the decider */}
        <Route path="*" element={<RootDecider />} />
      </Routes>
    </OrgProvider>
  );
}
