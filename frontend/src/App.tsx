import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { AuditPage } from './pages/AuditPage';
import { ComputerUsePage } from './pages/ComputerUsePage';
import { AppLayout } from './components/AppLayout';
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

          {/* Signed-in app. Every page here shares the left rail, so a new
              destination is a route plus an entry in AppLayout's NAV array. */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <AppLayout>
                    <DashboardPage />
                  </AppLayout>
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/audit"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <AppLayout>
                    <AuditPage />
                  </AppLayout>
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

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
