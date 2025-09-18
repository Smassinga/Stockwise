// src/App.tsx
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './components/layout/AppLayout';

import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import StockMovements from './pages/StockMovements';
import Reports from './pages/Reports';
import { Warehouses } from './pages/Warehouses';
import Users from './pages/Users';
import { Settings } from './pages/Settings';
import Orders from './pages/Orders';
import CurrencyPage from './pages/Currency';
import CustomersPage from './pages/Customers';
import SuppliersPage from './pages/Suppliers';
import BOMPage from './pages/BOM'
import Auth from './pages/Auth';
import UomSettings from './pages/UomSettings';
import AuthCallback from './pages/AuthCallback';
import Onboarding from './pages/Onboarding';

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
          <Route index element={<Auth />} />
        </Route>
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Private area (must be logged in) */}
        <Route element={<RequireAuth />}>
          {/* Onboarding is private but outside the app shell */}
          <Route path="/onboarding" element={<Onboarding />} />

          {/* Main app requires membership before mounting */}
          <Route element={<RequireMembership />}>
            <Route element={<AppLayout user={user!}><Outlet /></AppLayout>}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/items" element={<Items />} />
              <Route path="/movements" element={<StockMovements />} />
              <Route path="/warehouses" element={<Warehouses />} />

              {/* Only OWNER/ADMIN/MANAGER can access Users */}
              <Route element={<RequireOrgRole allowed={CanManageUsers} />}>
                <Route path="/users" element={<Users />} />
              </Route>

              <Route path="/reports" element={<Reports />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/currency" element={<CurrencyPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/uoms" element={<UomSettings />} />
              <Route path="/bom" element={<BOMPage />} />
            </Route>
          </Route>
        </Route>

        {/* Fallback uses the decider */}
        <Route path="*" element={<RootDecider />} />
      </Routes>
    </OrgProvider>
  );
}
