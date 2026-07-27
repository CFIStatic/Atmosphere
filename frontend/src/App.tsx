import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsPage } from './pages/SettingsPage';
import { BillingPage } from './pages/BillingPage';
import { UsagePage } from './pages/UsagePage';
import { ProjectManagerPage } from './pages/ProjectManagerPage';
import { PmProjectPage } from './pages/PmProjectPage';
import { WebAccessPage } from './pages/WebAccessPage';
import { ComputerUsePage } from './pages/ComputerUsePage';
import { EstimatorPage } from './pages/EstimatorPage';
import { SpinnerIcon } from './components/icons';

function FullScreenSpinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-ink-900 text-brand-300"
    >
      <SpinnerIcon className="animate-spin" width={28} height={28} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** Requires the user to have completed onboarding; otherwise send to /onboarding. */
function RequireOnboarded({ children }: { children: ReactNode }) {
  const { membership, membershipLoading } = useAuth();
  if (membershipLoading) return <FullScreenSpinner />;
  if (!membership) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/** For the onboarding route: if already onboarded, skip straight to the dashboard. */
function RequireNotOnboarded({ children }: { children: ReactNode }) {
  const { membership, membershipLoading } = useAuth();
  if (membershipLoading) return <FullScreenSpinner />;
  if (membership) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Recovery routes stay outside ProtectedRoute: a locked-out user has
              no session, and the reset link must work in a fresh browser. */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <RequireNotOnboarded>
                  <OnboardingPage />
                </RequireNotOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <DashboardPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          {/* The Project Manager area. Guarded only by onboarding: the
              database decides who may change a project, and a route guard that
              hid the screens would just make a field technician's read-only
              view unreachable. */}
          <Route
            path="/pm"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <ProjectManagerPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />
          <Route
            path="/pm/projects/:id"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <PmProjectPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          {/* Web Access sits behind onboarding: connections belong to an
              organization, so there is nothing to show before you have one. */}
          <Route
            path="/web-access"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <WebAccessPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/billing"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <BillingPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/usage"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <UsagePage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/computer-use"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <ComputerUsePage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/estimator"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <EstimatorPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <SettingsPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
