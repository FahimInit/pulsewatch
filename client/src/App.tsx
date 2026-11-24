import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { silentRefreshSession } from '@/api/client';
import { useAuthStore } from '@/stores/auth-store';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import { OverviewPage } from '@/pages/OverviewPage';
import { MonitorsPage } from '@/pages/MonitorsPage';
import { MonitorDetailPage } from '@/pages/MonitorDetailPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { IncidentDetailPage } from '@/pages/IncidentDetailPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { AlertRulesPage } from '@/pages/AlertRulesPage';
import { StatusPagesManagePage } from '@/pages/StatusPagesManagePage';
import { PublicStatusPage } from '@/pages/PublicStatusPage';
import { SettingsPage } from '@/pages/SettingsPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <div className="min-h-screen grid place-items-center bg-pw-bg text-pw-muted text-[12px]">
        Restoring secure session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

function GuestOnlyRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);

  if (isBootstrapping) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const setBootstrapping = useAuthStore((s) => s.setBootstrapping);

  useEffect(() => {
    // Skip auth refresh probe on public status page views if unauthenticated
    silentRefreshSession().finally(() => {
      setBootstrapping(false);
    });
  }, [setBootstrapping]);

  return (
    <Routes>
      {/* Public Unauthenticated Status Page */}
      <Route path="/status/:slug" element={<PublicStatusPage />} />

      {/* Guest Auth Routes */}
      <Route
        path="/login"
        element={
          <GuestOnlyRoute>
            <LoginPage />
          </GuestOnlyRoute>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnlyRoute>
            <RegisterPage />
          </GuestOnlyRoute>
        }
      />

      {/* Protected Workspace Dashboard */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="monitors/:monitorId" element={<MonitorDetailPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="incidents/:incidentId" element={<IncidentDetailPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="alert-rules" element={<AlertRulesPage />} />
        <Route path="status-pages" element={<StatusPagesManagePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
