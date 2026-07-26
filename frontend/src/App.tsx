import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { TooltipProvider } from './design';
import { AssistantProvider } from './assistant/AssistantContext';
import { ThemeProvider } from './shell/ThemeContext';
import { ViewerProvider, useViewer } from './shell/ViewerContext';
import { AppShell } from './shell/AppShell';
import { homeFor } from './domain/permissions';

import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { SpinnerIcon } from './components/icons';

// Workspace pages are split per route. No role sees all twelve sections, so
// shipping them in the initial bundle would cost every user — including a
// technician on site over cellular — for screens they will never open.
const OverviewPage = lazy(() =>
  import('./features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const MyWorkPage = lazy(() =>
  import('./features/myWork/MyWorkPage').then((m) => ({ default: m.MyWorkPage })),
);
const ApprovalsPage = lazy(() =>
  import('./features/approvals/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })),
);
const JobsPage = lazy(() =>
  import('./features/jobs/JobsPage').then((m) => ({ default: m.JobsPage })),
);
const JobWorkspacePage = lazy(() =>
  import('./features/jobs/JobWorkspacePage').then((m) => ({ default: m.JobWorkspacePage })),
);
const SchedulePage = lazy(() =>
  import('./features/schedule/SchedulePage').then((m) => ({ default: m.SchedulePage })),
);
const EstimatesPage = lazy(() =>
  import('./features/estimates/EstimatesPage').then((m) => ({ default: m.EstimatesPage })),
);
const CustomersPage = lazy(() =>
  import('./features/customers/CustomersPage').then((m) => ({ default: m.CustomersPage })),
);
const FinancialsPage = lazy(() =>
  import('./features/financials/FinancialsPage').then((m) => ({ default: m.FinancialsPage })),
);
const AgentsPage = lazy(() =>
  import('./features/agents/AgentsPage').then((m) => ({ default: m.AgentsPage })),
);
const WorkflowsPage = lazy(() =>
  import('./features/workflows/WorkflowsPage').then((m) => ({ default: m.WorkflowsPage })),
);
const ConnectionsPage = lazy(() =>
  import('./features/connections/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })),
);
const SettingsPage = lazy(() =>
  import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const FieldPage = lazy(() =>
  import('./features/field/FieldPage').then((m) => ({ default: m.FieldPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Operational data goes stale fast, but refetching on every window focus
      // makes a dense dashboard flicker. 30s is the compromise.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function FullScreenSpinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-canvas text-brand-300"
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

/** For the onboarding route: if already onboarded, skip straight to the app. */
function RequireNotOnboarded({ children }: { children: ReactNode }) {
  const { membership, membershipLoading } = useAuth();
  if (membershipLoading) return <FullScreenSpinner />;
  if (membership) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Sends each role to the surface it actually works from — a field technician
 * lands on My Work, an accountant on Financials — rather than a shared dashboard
 * that is wrong for most of the company.
 */
function RoleHome() {
  const { role } = useViewer();
  return <Navigate to={homeFor(role)} replace />;
}

/** Field mode is a phone surface; nudge desktop users back to the full app. */
function FieldRedirectOnDesktop({ children }: { children: ReactNode }) {
  const isDesktop =
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  if (isDesktop) return <Navigate to="/my-work" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider>
              <Routes>
                {/* Public auth surfaces — unchanged. */}
                <Route path="/login" element={<LoginPage />} />
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

                {/* The operational command center. */}
                <Route
                  element={
                    <ProtectedRoute>
                      <RequireOnboarded>
                        <ViewerProvider>
                          <AssistantProvider>
                            <Suspense fallback={<FullScreenSpinner />}>
                              <AppShell />
                            </Suspense>
                          </AssistantProvider>
                        </ViewerProvider>
                      </RequireOnboarded>
                    </ProtectedRoute>
                  }
                >
                  <Route path="/" element={<RoleHome />} />
                  <Route path="/overview" element={<OverviewPage />} />
                  <Route path="/my-work" element={<MyWorkPage />} />
                  <Route path="/approvals" element={<ApprovalsPage />} />
                  <Route path="/jobs" element={<JobsPage />} />
                  <Route path="/jobs/:jobId" element={<JobWorkspacePage />} />
                  <Route path="/schedule" element={<SchedulePage />} />
                  <Route path="/estimates" element={<EstimatesPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/financials" element={<FinancialsPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/workflows" element={<WorkflowsPage />} />
                  <Route path="/connections" element={<ConnectionsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route
                    path="/field"
                    element={
                      <FieldRedirectOnDesktop>
                        <FieldPage />
                      </FieldRedirectOnDesktop>
                    }
                  />
                  <Route path="*" element={<RoleHome />} />
                </Route>
              </Routes>
            </TooltipProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
