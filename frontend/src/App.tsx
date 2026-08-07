import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { api } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SpinnerIcon } from './components/icons';
import { PLATFORM_HOME } from './lib/platforms';
import { RequirePlatform } from './components/RequirePlatform';
import { CampaignsPage } from './pages/CampaignsPage';
import { ProfilerPage } from './pages/ProfilerPage';
import { TerritoriesPage } from './pages/TerritoriesPage';
import { SalesWorkPage } from './pages/SalesWorkPage';
import { SharedDashboardPage } from './pages/SharedDashboardPage';
import { JobIntakePage } from './pages/JobIntakePage';
import { VerifierLibraryPage } from './pages/VerifierLibraryPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { JobSharePage } from './pages/JobSharePage';
import { PlatformHomePage } from './pages/PlatformHomePage';
import { MyWorkPage } from './pages/MyWorkPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { SchedulePage } from './pages/SchedulePage';
import { CustomersPage } from './pages/CustomersPage';
import { PipelinePage } from './pages/PipelinePage';
import { ProspectorPage } from './pages/ProspectorPage';
import { JobCostingPage } from './pages/JobCostingPage';
import { MyJobsPage } from './pages/MyJobsPage';
import { getPlatform } from './lib/usePlatform';

// Auth and onboarding stay eager so /login is fast. Everything else loads on demand —
// dev mode otherwise pulls in every page on the first visit.
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
  const location = useLocation();
  if (membershipLoading) return <FullScreenSpinner />;
  if (!membership) {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/signup?step=2&next=${encodeURIComponent(returnPath)}`}
        replace
      />
    );
  }
  return <RequireBillingSetup>{children}</RequireBillingSetup>;
}

/** Org creators must finish Stripe before the dashboard; joiners skip when not required. */
function RequireBillingSetup({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [gate, setGate] = useState<'loading' | 'ready' | 'blocked'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getBillingOnboarding();
        if (cancelled) return;
        setGate(status.required && !status.complete ? 'blocked' : 'ready');
      } catch {
        if (!cancelled) setGate('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === 'loading') return <FullScreenSpinner />;
  if (gate === 'blocked') {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/signup?step=5&next=${encodeURIComponent(returnPath)}`}
        replace
      />
    );
  }
  return <>{children}</>;
}

/** For the onboarding route: if already onboarded, skip straight to the dashboard. */
function RequireNotOnboarded({ children }: { children: ReactNode }) {
  const { membership, membershipLoading } = useAuth();
  if (membershipLoading) return <FullScreenSpinner />;
  if (membership) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Sends bare/legacy paths to whichever platform this device last used. */
function PlatformRedirect() {
  return <Navigate to={PLATFORM_HOME[getPlatform()]} replace />;
}

// Demo builds run in sandboxed frames where history-API navigation is not
// available, so they route in memory; real builds keep clean URLs.
const Router = import.meta.env.VITE_DEMO ? MemoryRouter : BrowserRouter;

/**
 * A memory router has no URL to read, so a demo cannot be opened on a
 * particular screen the way a real build can. This carries the entry point in
 * localStorage instead — the only way to reach a page that is deliberately
 * outside the console, like the subcontractor's job link.
 */
function routerProps(): Record<string, unknown> {
  if (!import.meta.env.VITE_DEMO) return {};
  try {
    const entry = localStorage.getItem('atmosphere.route');
    if (entry) {
      // Consumed, not remembered. Leaving it set would send every reload back
      // to the same screen however far somebody had navigated, which reads as
      // the app refusing to move.
      localStorage.removeItem('atmosphere.route');
      return { initialEntries: [entry] };
    }
  } catch {
    /* storage denied — fall through to the default entry */
  }
  return {};
}

/**
 * Demo only: a way in from outside React.
 *
 * The published artifact has its own view switcher, which is plain DOM sitting
 * beside the app rather than inside it — a memory router has no URL for it to
 * change. This listens for the one event that switcher fires, so switching to
 * the subcontractor's screen is a navigation rather than a full reload of a
 * three-megabyte page.
 *
 * Inside the Router by necessity: useNavigate only exists there.
 */
function DemoRouteBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = (event: Event) => {
      const to = (event as CustomEvent<string>).detail;
      if (typeof to === 'string' && to.startsWith('/')) navigate(to);
    };
    window.addEventListener('atmosphere:navigate', go);
    return () => window.removeEventListener('atmosphere:navigate', go);
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <Router {...routerProps()}>
      {import.meta.env.VITE_DEMO ? <DemoRouteBridge /> : null}
      <AuthProvider>
        <Suspense fallback={<FullScreenSpinner />}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* The subcontractor's screen. Outside every guard by construction:
              they work for six general contractors and have an account with
              none of them, and a shared job record that requires signing in is
              not shared. The token in the path is the whole credential. */}
          <Route path="/shared/:token" element={<JobSharePage />} />

          {/* The same person, one level up. A sub who has proved they control
              a phone or an inbox gets every job across every general
              contractor on one screen — which is why this route is outside
              the org guards too: the list spans organizations the sub is a
              member of none of. */}
          <Route path="/my-jobs" element={<MyJobsPage />} />

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

          {/* The four products share one console: same shell, same layout,
              different work. /overview and /dashboard keep older links alive
              by landing on the platform the person last used. */}
          <Route path="/dashboard" element={<PlatformRedirect />} />
          <Route path="/overview" element={<PlatformRedirect />} />
          {[
            { path: '/sales', element: <PlatformHomePage platform="sales" /> },
            { path: '/operations', element: <PlatformHomePage platform="operations" /> },
            { path: '/field', element: <PlatformHomePage platform="field" /> },
            { path: '/manager', element: <PlatformHomePage platform="manager" /> },
            { path: '/my-work', element: <MyWorkPage /> },
            { path: '/approvals', element: <ApprovalsPage /> },
            { path: '/schedule', element: <SchedulePage /> },
            { path: '/customers', element: <CustomersPage /> },
            { path: '/pipeline', element: <PipelinePage /> },
            // Prospecting is Sales' alone. Landing here from another platform
            // switches into Sales rather than framing a sales tool with
            // somebody else's navigation.
            {
              path: '/prospector',
              element: (
                <RequirePlatform platform="sales">
                  <ProspectorPage />
                </RequirePlatform>
              ),
            },
            {
              path: '/profiler',
              element: (
                <RequirePlatform platform="sales">
                  <ProfilerPage />
                </RequirePlatform>
              ),
            },
            // Campaigns and Territories are Sales' alone, same as prospecting.
            {
              path: '/campaigns',
              element: (
                <RequirePlatform platform="sales">
                  <CampaignsPage />
                </RequirePlatform>
              ),
            },
            {
              path: '/territories',
              element: (
                <RequirePlatform platform="sales">
                  <TerritoriesPage />
                </RequirePlatform>
              ),
            },
            {
              path: '/work',
              element: (
                <RequirePlatform platform="sales">
                  <SalesWorkPage />
                </RequirePlatform>
              ),
            },
            {
              path: '/shared',
              element: (
                <RequirePlatform platform="operations">
                  <SharedDashboardPage />
                </RequirePlatform>
              ),
            },
            {
              path: '/intake',
              element: (
                <RequirePlatform platform="operations">
                  <JobIntakePage />
                </RequirePlatform>
              ),
            },
            {
              path: '/verifier-library',
              element: (
                <RequirePlatform platform="operations">
                  <VerifierLibraryPage />
                </RequirePlatform>
              ),
            },
            {
              path: '/purchase-orders',
              element: (
                <RequirePlatform platform="operations">
                  <PurchaseOrdersPage />
                </RequirePlatform>
              ),
            },
            { path: '/costing', element: <JobCostingPage /> },
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
            path="/sales-agent"
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <SalesAgentPage />
                </RequireOnboarded>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-agent/:id"
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
    </Router>
  );
}
