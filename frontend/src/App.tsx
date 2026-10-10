import HdOrderScreenshotPage from './pages/HdOrderScreenshotPage';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TermsAcknowledgment } from './components/TermsAcknowledgment';
import { sessionTermsAcceptedForCurrent } from './lib/terms';
import { ApiError } from './lib/api';
import { ProtectedRoute } from './components/ProtectedRoute';
import { api } from './lib/api';
import { getBillingOnboardingShared } from './lib/billingOnboardingShared';
import { LoginPage } from './pages/LoginPage';
import { AppShellSignupBlockedPage } from './pages/AppShellSignupBlockedPage';
import { isInAppShell } from './lib/appShell';
import { readFirstRun, unpaidWorkspaceTarget } from './lib/firstRun';
import { isUnpaidEvaluationLocation } from './lib/unpaidEvaluation';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { DocumentTitle } from './components/DocumentTitle';
import { DocumentRobotsMeta } from './components/DocumentRobotsMeta';
import { SpinnerIcon } from './components/icons';
import { PLATFORM_HOME } from './lib/platforms';
import { RequirePlatform } from './components/RequirePlatform';
import { OperationsShell } from './layouts/OperationsShell';
import { getPlatform } from './lib/usePlatform';
import { jobFilePath, sharedJobsRedirectTo } from './lib/jobFileAsk';
import { packetTimelineLocation } from './components/shared/jobTimeline';
import { HOMEOWNER_HUB_PATH, LEGACY_HOMEOWNER_HUB_PATH, isHomeownerHubPath, isHomeownerPortalPath } from './lib/homeownerHub';
import { useHomeownerPortal } from './lib/homeownerPortal';
import { resolveNoOrgDestination } from './lib/postAuth';

// Auth and onboarding stay eager so /login is fast. Everything else loads on demand —
// dev mode otherwise pulls in every page on the first visit.
const SignupPage = lazy(() => import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })));
const FirstRunPage = lazy(() => import('./pages/FirstRunPage').then((m) => ({ default: m.FirstRunPage })));
const SharedDashboardPage = lazy(() => import('./pages/SharedDashboardPage').then((m) => ({ default: m.SharedDashboardPage })));
const JobIntakePage = lazy(() => import('./pages/JobIntakePage').then((m) => ({ default: m.JobIntakePage })));
const PlatformHomePage = lazy(() => import('./pages/PlatformHomePage').then((m) => ({ default: m.PlatformHomePage })));
const MyJobsPage = lazy(() => import('./pages/MyJobsPage').then((m) => ({ default: m.MyJobsPage })));
const JobSharePage = lazy(() => import('./pages/JobSharePage').then((m) => ({ default: m.JobSharePage })));
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SpeakerIdPreviewPage = import.meta.env.DEV
  ? lazy(() => import('./pages/SpeakerIdPreviewPage').then((m) => ({ default: m.SpeakerIdPreviewPage })))
  : null;
const LoginsPage = lazy(() => import('./pages/LoginsPage').then((m) => ({ default: m.LoginsPage })));
const PlaybooksLibraryPage = lazy(() =>
  import('./pages/PlaybooksLibraryPage').then((m) => ({ default: m.PlaybooksLibraryPage })),
);
const ShareLinkGate = lazy(() =>
  import('./pages/ShareLinkGate').then((m) => ({ default: m.ShareLinkGate })),
);

const TERMS_EXEMPT_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/guest',
  '/shared/',
  '/progress',
];

function isTermsExemptPath(pathname: string): boolean {
  if (TERMS_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return true;
  }
  return false;
}

function TermsGate({ children }: { children: ReactNode }) {
  const { user, loading, needsTermsAcceptance, termsLoading, acceptTerms, logout } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <FullScreenSpinner />;
  // Soft skip when this session already acknowledged the current Terms (signup /
  // modal accept). Version bumps still force re-ack via CURRENT_TERMS_VERSION mismatch.
  if (
    !user ||
    !needsTermsAcceptance ||
    isTermsExemptPath(location.pathname) ||
    sessionTermsAcceptedForCurrent()
  ) {
    return <>{children}</>;
  }

  async function onAccept(version: string) {
    setError(null);
    setSubmitting(true);
    try {
      await acceptTerms(version);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your acknowledgment. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TermsAcknowledgment
      submitting={submitting || termsLoading}
      error={error}
      onAccept={onAccept}
      onSignOut={() => {
        void logout();
      }}
    />
  );
}

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
  const fieldEmbed =
    typeof document !== 'undefined' && document.documentElement.dataset.fieldEmbed === '1';
  const jobProgressViewer =
    location.pathname === '/job-progress' || location.pathname.startsWith('/jobs/');
  const homeownerHub = isHomeownerHubPath(location.pathname);
  const homeownerPortal = isHomeownerPortalPath(location.pathname);

  if (membershipLoading) return <FullScreenSpinner />;
  if (!membership && homeownerPortal && !fieldEmbed) {
    return <HomeownerPortalGate from={`${location.pathname}${location.search}${location.hash}`}>{children}</HomeownerPortalGate>;
  }
  if (!membership) {
    // Embed sessions skip the workspace wizard so Field Capture can open
    // Platform. A null office membership is a finished read, not a hang.
    if (fieldEmbed) return <RequireBillingSetup>{children}</RequireBillingSetup>;
    // Homeowners who claimed a progress share open /job-progress without an org.
    if (jobProgressViewer || homeownerHub) return <>{children}</>;
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    return <NoOrgOfficeRedirect from={returnPath} />;
  }
  return <RequireBillingSetup>{children}</RequireBillingSetup>;
}

/**
 * Dashboard and Settings for someone with no org: open only for an invited
 * homeowner (a live job invite to their email). Anyone else goes to setup.
 */
function HomeownerPortalGate({ from, children }: { from: string; children: ReactNode }) {
  const { loading, homeowner } = useHomeownerPortal();
  if (loading) return <FullScreenSpinner />;
  if (!homeowner) return <NoOrgOfficeRedirect from={from} />;
  return <>{children}</>;
}

/** Org creators must finish Stripe before the dashboard; joiners skip when not required. */
function RequireBillingSetup({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { membership } = useAuth();
  const [gate, setGate] = useState<'loading' | 'ready' | 'blocked' | 'error'>('loading');
  const fieldEmbed =
    typeof document !== 'undefined' && document.documentElement.dataset.fieldEmbed === '1';
  // Only skip when there is no org membership on a grant-only surface. Org
  // members on /job-progress still must finish Stripe when billing is required.
  const jobProgressViewer =
    !membership &&
    (location.pathname === '/job-progress' ||
      location.pathname.startsWith('/jobs/') ||
      isHomeownerHubPath(location.pathname) ||
      isHomeownerPortalPath(location.pathname));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (fieldEmbed || jobProgressViewer) {
          if (!cancelled) setGate('ready');
          return;
        }
        const status = await getBillingOnboardingShared(api.getBillingOnboarding);
        if (cancelled) return;
        setGate(status.required && !status.complete ? 'blocked' : 'ready');
      } catch {
        if (!cancelled) setGate(fieldEmbed || jobProgressViewer ? 'ready' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fieldEmbed, jobProgressViewer]);

  if (gate === 'loading') return <FullScreenSpinner />;
  if (gate === 'error') {
    return (
      <div className="grid min-h-screen place-items-center bg-paper-100 px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-ink-900">Could not confirm billing</h1>
          <p className="mt-2 text-sm text-ink-600">
            We could not reach billing for this workspace. Refresh to try again — unpaid
            workspaces stay on the billing step.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-900"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (gate === 'blocked' && isUnpaidEvaluationLocation(location.pathname, location.search)) {
    return <>{children}</>;
  }
  if (gate === 'blocked') {
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    // First evidence before plan and card: an unpaid workspace that has not
    // seen any yet goes to the welcome page; after that, to billing.
    return <Navigate to={unpaidWorkspaceTarget(readFirstRun(membership?.org?.id), returnPath)} replace />;
  }
  return <>{children}</>;
}

function BillingSettingsRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ section: 'billing' });
  const checkout = params.get('checkout');
  if (checkout) next.set('checkout', checkout);
  return <Navigate to={`/settings?${next.toString()}`} replace />;
}

/** Grant-only accounts hit office Overview — send them to the hub when grants exist. */
function NoOrgOfficeRedirect({ from }: { from: string }) {
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveNoOrgDestination(from).then((dest) => {
      if (!cancelled) setTo(dest);
    });
    return () => {
      cancelled = true;
    };
  }, [from]);

  if (!to) return <FullScreenSpinner />;
  return <Navigate to={to} replace />;
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

/** Job Files used to open /jobs/:id — that is the same file as Overview now. */
function JobFileFromProfileRedirect() {
  const { id = '' } = useParams();
  const location = useLocation();
  const packet = packetTimelineLocation(id, location.pathname, location.search, location.hash);
  return <Navigate to={packet ?? jobFilePath(id)} replace />;
}

/** Preserve ?job= (and intake handoff state) when moving /shared → the job file. */
function SharedJobsRedirect() {
  const location = useLocation();
  const [params] = useSearchParams();
  return (
    <Navigate
      to={sharedJobsRedirectTo(params.toString())}
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
        <DocumentRobotsMeta />
        <Suspense fallback={<FullScreenSpinner />}>
          <TermsGate>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/__screens__/hd-order" element={<HdOrderScreenshotPage />} />

          {/* iPhone/Android app: sign-up and plans happen on atmosphereteam.com, never in the app. */}
          <Route path="/signup" element={isInAppShell() ? <AppShellSignupBlockedPage /> : <SignupPage />} />
          {/* First run, value before payment: first job and first evidence, then plan. */}
          <Route
            path="/welcome"
            element={
              <ProtectedRoute>
                <FirstRunPage />
              </ProtectedRoute>
            }
          />

          {/* The subcontractor's screen. Outside every guard by construction:
              they work for six general contractors and have an account with
              none of them, and a shared job record that requires signing in is
              not shared. The token in the path is the whole credential.
              `/*` keeps legacy base64 tokens that contain `/` on this page
              instead of the catch-all, which would dump a signed-in office
              user onto their jobs dashboard. */}
          <Route path="/guest" element={<JobSharePage />} />
          <Route path="/shared/:token/*" element={<JobSharePage />} />

          {/* The same person, one level up. A sub who has proved they control
              a phone or an inbox gets every job across every general
              contractor on one screen — which is why this route is outside
              the org guards too: the list spans organizations the sub is a
              member of none of. */}
          <Route path="/my-jobs" element={<MyJobsPage />} />

          {/* Old homeowner list. Homeowners now use the office Dashboard
              (/verifier-library), which lists only the jobs shared with them. */}
          <Route
            path={LEGACY_HOMEOWNER_HUB_PATH}
            element={<Navigate to={HOMEOWNER_HUB_PATH} replace />}
          />

          {/* Recovery routes stay outside ProtectedRoute: a locked-out user has
              no session, and the reset link must work in a fresh browser. */}
          {import.meta.env.DEV && SpeakerIdPreviewPage ? (
            <Route
              path="/dev/speaker-identification"
              element={
                <Suspense fallback={null}>
                  <SpeakerIdPreviewPage />
                </Suspense>
              }
            />
          ) : null}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Homeowner share links: sign in (same page as contractors), then the
              job opens in the portal. /progress and /progress-view are older
              aliases; ?token= is forwarded, otherwise the Dashboard. */}
          <Route path="/progress-view" element={<LegacyProgressRedirect />} />
          <Route path="/progress" element={<LegacyProgressRedirect />} />
          <Route path="/progress/:token" element={<ShareLinkGate />} />

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
            <Route path="/field" element={<PlatformHomePage platform="field" />} />
            <Route path="/my-work" element={<Navigate to="/field" replace />} />
            <Route path="/intake" element={<JobIntakePage />} />
            <Route path="/logins" element={<LoginsPage />} />
            <Route path="/jobs" element={<Navigate to="/verifier-library" replace />} />
            {/* Same job file as Overview — /jobs/:id bookmarks join /job-progress. */}
            <Route path="/jobs/:id/packet" element={<JobFileFromProfileRedirect />} />
            <Route path="/jobs/:id/packets" element={<JobFileFromProfileRedirect />} />
            <Route path="/jobs/:id/claim-ready" element={<JobFileFromProfileRedirect />} />
            <Route path="/jobs/:id" element={<JobFileFromProfileRedirect />} />
            <Route path="/job-progress" element={<SharedDashboardPage />} />
            <Route path="/shared" element={<SharedJobsRedirect />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/crm" element={<Navigate to="/settings?section=connect" replace />} />
            <Route path="/playbooks" element={<PlaybooksLibraryPage />} />
          </Route>

          <Route path="/billing" element={<BillingSettingsRedirect />} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </TermsGate>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

/** Older share URLs without a path token: forward ?token=, else the Dashboard. */
function LegacyProgressRedirect() {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token')?.trim();
  if (token) return <Navigate to={`/progress/${encodeURIComponent(token)}`} replace />;
  return <Navigate to={HOMEOWNER_HUB_PATH} replace />;
}
