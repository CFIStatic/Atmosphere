import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DashboardPage } from './pages/DashboardPage';
import { TechnicianPage } from './pages/TechnicianPage';
import { SpinnerIcon } from './components/icons';

function FullScreenSpinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-paper-100 text-brand-600"
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

          {/* The technician app. Open to every onboarded member — a project
              manager reviewing a job needs the same capture tools a field
              technician does. */}
          <Route
            path="/technician"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <TechnicianPage />
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
