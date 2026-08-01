import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OverviewPage } from './pages/OverviewPage';
import { MyWorkPage } from './pages/MyWorkPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { SchedulePage } from './pages/SchedulePage';
import { CustomersPage } from './pages/CustomersPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuditPage } from './pages/AuditPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { MemoryPage } from './pages/MemoryPage';
import { TeamMemoryPage } from './pages/TeamMemoryPage';
import { TechnicianPage } from './pages/TechnicianPage';
import { BillingPage } from './pages/BillingPage';
import { UsagePage } from './pages/UsagePage';
import { ProjectManagerPage } from './pages/ProjectManagerPage';
import { PmProjectPage } from './pages/PmProjectPage';
import { WebAccessPage } from './pages/WebAccessPage';
import { ComputerUsePage } from './pages/ComputerUsePage';
import { EstimatorPage } from './pages/EstimatorPage';
import { MitigationEstimatorPage } from './pages/MitigationEstimatorPage';
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

// Demo builds run in sandboxed frames where history-API navigation is not
// available, so they route in memory; real builds keep clean URLs.
const Router = import.meta.env.VITE_DEMO ? MemoryRouter : BrowserRouter;

export default function App() {
  return (
    <Router>
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

          <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
          {[
            { path: '/overview', element: <OverviewPage /> },
            { path: '/my-work', element: <MyWorkPage /> },
            { path: '/approvals', element: <ApprovalsPage /> },
            { path: '/schedule', element: <SchedulePage /> },
            { path: '/customers', element: <CustomersPage /> },
          ].map(({ path, element }) => (
            <Route
              key={path}
              path={path}
              element={
                <ProtectedRoute>
                  <RequireOnboarded>{element}</RequireOnboarded>
                </ProtectedRoute>
              }
            />
          ))}

          <Route
            path="/audit"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <AuditPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          {/* Agent Memory. Same guard as the dashboard: all of it is scoped to
              an organization, so onboarding has to come first. */}
          {[
            { path: '/jobs', element: <JobsPage /> },
            { path: '/jobs/:id', element: <JobDetailPage /> },
            { path: '/memory', element: <MemoryPage /> },
            { path: '/team', element: <TeamMemoryPage /> },
          ].map(({ path, element }) => (
            <Route
              key={path}
              path={path}
              element={
                <ProtectedRoute>
                  <RequireOnboarded>{element}</RequireOnboarded>
                </ProtectedRoute>
              }
            />
          ))}
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
            path="/mitigation"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <MitigationEstimatorPage />
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

          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}
