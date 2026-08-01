import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SpinnerIcon } from './components/icons';

// Auth and onboarding stay eager so /login is fast. Everything else loads on demand —
// dev mode otherwise pulls in every page on the first visit.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const InternalAnalyticsRoute = lazy(() =>
  import('./pages/analytics/AnalyticsRoutes').then((m) => ({
    default: m.InternalAnalyticsRoute,
  })),
);
const InvestorAnalyticsRoute = lazy(() =>
  import('./pages/analytics/AnalyticsRoutes').then((m) => ({
    default: m.InvestorAnalyticsRoute,
  })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AuditPage = lazy(() =>
  import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })),
);
const JobsPage = lazy(() => import('./pages/JobsPage').then((m) => ({ default: m.JobsPage })));
const JobDetailPage = lazy(() =>
  import('./pages/JobDetailPage').then((m) => ({ default: m.JobDetailPage })),
);
const MemoryPage = lazy(() =>
  import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })),
);
const TeamMemoryPage = lazy(() =>
  import('./pages/TeamMemoryPage').then((m) => ({ default: m.TeamMemoryPage })),
);
const TechnicianPage = lazy(() =>
  import('./pages/TechnicianPage').then((m) => ({ default: m.TechnicianPage })),
);
const BillingPage = lazy(() =>
  import('./pages/BillingPage').then((m) => ({ default: m.BillingPage })),
);
const UsagePage = lazy(() => import('./pages/UsagePage').then((m) => ({ default: m.UsagePage })));
const ProjectManagerPage = lazy(() =>
  import('./pages/ProjectManagerPage').then((m) => ({ default: m.ProjectManagerPage })),
);
const PmProjectPage = lazy(() =>
  import('./pages/PmProjectPage').then((m) => ({ default: m.PmProjectPage })),
);
const FinancePage = lazy(() =>
  import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })),
);
const FinanceSharePage = lazy(() =>
  import('./pages/FinanceSharePage').then((m) => ({ default: m.FinanceSharePage })),
);
const WebAccessPage = lazy(() =>
  import('./pages/WebAccessPage').then((m) => ({ default: m.WebAccessPage })),
);
const ConnectorsPage = lazy(() =>
  import('./pages/ConnectorsPage').then((m) => ({ default: m.ConnectorsPage })),
);
const ComputerUsePage = lazy(() =>
  import('./pages/ComputerUsePage').then((m) => ({ default: m.ComputerUsePage })),
);
const EstimatorPage = lazy(() =>
  import('./pages/EstimatorPage').then((m) => ({ default: m.EstimatorPage })),
);
const MitigationEstimatorPage = lazy(() =>
  import('./pages/MitigationEstimatorPage').then((m) => ({
    default: m.MitigationEstimatorPage,
  })),
);
const SalesAgentPage = lazy(() =>
  import('./pages/SalesAgentPage').then((m) => ({ default: m.SalesAgentPage })),
);
const EmailMarketingPage = lazy(() =>
  import('./pages/EmailMarketingPage').then((m) => ({ default: m.EmailMarketingPage })),
);
const IntegrationsPage = lazy(() =>
  import('./pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);
const HomeownerReportPage = lazy(() =>
  import('./pages/HomeownerReportPage').then((m) => ({ default: m.HomeownerReportPage })),
);

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
        <Suspense fallback={<FullScreenSpinner />}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Recovery routes stay outside ProtectedRoute: a locked-out user has
              no session, and the reset link must work in a fresh browser. */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Tokenized HomeOwner Report — no staff session required. */}
          <Route path="/report/:token" element={<HomeownerReportPage />} />
          {/* Third-party financial dataroom — token in the URL is the credential. */}
          <Route path="/share/finance/:token" element={<FinanceSharePage />} />

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

          {/* Growth analytics. Onboarding is required — every figure is scoped to
              a signed-in staff member, and the guards inside re-check access. */}
          <Route
            path="/analytics"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <InternalAnalyticsRoute />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics/investor"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <InvestorAnalyticsRoute />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

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

          {/* Financial Agent — CEO / CFO / accountant cockpit. RLS decides who
              may change connections and cost codes; every member can read. */}
          <Route
            path="/finance"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <FinancePage />
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
            path="/connectors"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <ConnectorsPage />
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
            path="/sales"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <SalesAgentPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales/:id"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <SalesAgentPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/email-marketing"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <EmailMarketingPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />

          <Route
            path="/integrations"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <IntegrationsPage />
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
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
