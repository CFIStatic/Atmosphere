import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { api } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DocumentTitle } from './components/DocumentTitle';
import { SpinnerIcon } from './components/icons';
import { PLATFORM_HOME } from './lib/platforms';
import { RequirePlatform } from './components/RequirePlatform';
import { SharedDashboardPage } from './pages/SharedDashboardPage';
import { JobIntakePage } from './pages/JobIntakePage';
import { OperationsShell } from './layouts/OperationsShell';
import { JobSharePage } from './pages/JobSharePage';
import { PlatformHomePage } from './pages/PlatformHomePage';
import { MyJobsPage } from './pages/MyJobsPage';
import { getPlatform } from './lib/usePlatform';

// Auth and onboarding stay eager so /login is fast. Everything else loads on demand —
// dev mode otherwise pulls in every page on the first visit.
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const JobsPage = lazy(() => import('./pages/JobsPage').then((m) => ({ default: m.JobsPage })));
const JobDetailPage = lazy(() =>
  import('./pages/JobDetailPage').then((m) => ({ default: m.JobDetailPage })),
);
const TechnicianPage = lazy(() =>
  import('./pages/TechnicianPage').then((m) => ({ default: m.TechnicianPage })),
);
const HomeownerReportPage = lazy(() =>
  import('./pages/HomeownerReportPage').then((m) => ({ default: m.HomeownerReportPage })),
);
const JobProgressGuestPage = lazy(() =>
  import('./pages/JobProgressGuestPage').then((m) => ({ default: m.JobProgressGuestPage })),
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
        to={`/signup?step=3&next=${encodeURIComponent(returnPath)}`}
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
      // Keep the key through React StrictMode's double-mount in dev — removing
      // it here made the second mount forget the entry and bounce to home.
      // DemoRouteBridge clears it once after the router is live.
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
    // Entry was applied via initialEntries; drop it so reloads return to home.
    try {
      localStorage.removeItem('atmosphere.route');
    } catch {
      /* ignore */
    }
    const go = (event: Event) => {
      const to = (event as CustomEvent<string>).detail;
      if (typeof to === 'string' && to.startsWith('/')) navigate(to);
    };
    window.addEventListener('atmosphere:navigate', go);
    return () => window.removeEventListener('atmosphere:navigate', go);
  }, [navigate]);
  return null;
}

/** Preserve ?job= (and intake handoff state) when moving /shared → the job record. */
function SharedJobsRedirect() {
  const location = useLocation();
  const [params] = useSearchParams();
  const q = params.toString();
  const job = params.get('job');
  return (
    <Navigate
      to={job ? `/job-progress?${q}` : '/verifier-library'}
      replace
      state={location.state}
    />
  );
}

export default function App() {
  return (
    <Router {...routerProps()}>
      {import.meta.env.VITE_DEMO ? <DemoRouteBridge /> : null}
      <AuthProvider>
        <DocumentTitle />
        <Suspense fallback={<FullScreenSpinner />}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* The subcontractor's screen. Outside every guard by construction:
              they work for six general contractors and have an account with
              none of them, and a shared job record that requires signing in is
              not shared. The token in the path is the whole credential.
              `/*` keeps legacy base64 tokens that contain `/` on this page
              instead of the catch-all, which would dump a signed-in office
              user onto their jobs dashboard. */}
          <Route path="/shared/:token/*" element={<JobSharePage />} />

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
          {/* Read-only job progress for homeowners, counsel, banks — no login. */}
          <Route path="/progress/:token" element={<JobProgressGuestPage />} />

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

          {/* /overview and /dashboard keep older links alive by landing on the
              platform the person last used. */}
          <Route path="/dashboard" element={<PlatformRedirect />} />
          <Route path="/overview" element={<PlatformRedirect />} />

          <Route
            element={
              <ProtectedRoute>
                <RequireOnboarded>
                  <RequirePlatform platform="operations">
                    <OperationsShell />
                  </RequirePlatform>
                </RequireOnboarded>
              </ProtectedRoute>
            }
          >
            <Route path="/verifier-library" element={null} />
            <Route path="/field" element={<PlatformHomePage />} />
            <Route path="/intake" element={<JobIntakePage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            {/* Job record (opened from a Dashboard job name). /shared stays as
                a redirect so old bookmarks keep working without colliding with
                public share pages at /shared/:token. Bare /job-progress sends
                people to the Dashboard. */}
            <Route path="/job-progress" element={<SharedDashboardPage />} />
            <Route path="/shared" element={<SharedJobsRedirect />} />
          </Route>
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
