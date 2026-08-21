import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RequireStaff } from './components/RequireStaff';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { AccountsPage } from './pages/AccountsPage';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { UsagePage } from './pages/UsagePage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { MeteringPage } from './pages/MeteringPage';
import { SystemPage } from './pages/SystemPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireStaff>
                <Shell />
              </RequireStaff>
            }
          >
            <Route index element={<Navigate to="/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="accounts/:orgId" element={<AccountDetailPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="experiments" element={<ExperimentsPage />} />
            <Route path="metering" element={<MeteringPage />} />
            <Route path="system" element={<SystemPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
