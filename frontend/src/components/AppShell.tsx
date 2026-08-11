import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ROLE_LABELS } from '../lib/api';
import { displayName, initials } from '../lib/display';
import { setPreference, usePreferences } from '../lib/preferences';
import {
  cycleThemePreference,
  resolveTheme,
  themeLabel,
} from '../lib/theme';
import { PLATFORMS, VISIBLE_PLATFORM_IDS, platformOfPath } from '../lib/platforms';
import { usePlatform } from '../lib/usePlatform';
import { useFeatureTimer } from '../hooks/useFeatureTimer';
import { Logo } from './Logo';
import {
  ChevronDownIcon,
  CloseIcon,
  GaugeIcon,
  LogOutIcon,
  MenuIcon,
  MicIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SpinnerIcon,
  SunIcon,
} from './icons';

/**
 * Every destination the jump palette can reach — visible platforms only.
 * A palette that jumps into hidden products would quietly resurrect them.
 */
const JUMP_TARGETS = (() => {
  const seen = new Map<string, { to: string; label: string; Icon: typeof GaugeIcon }>();
  for (const id of VISIBLE_PLATFORM_IDS) {
    for (const group of PLATFORMS[id].groups) {
      for (const item of group.items) {
        const key = `${item.to}:${item.label}`;
        if (!seen.has(key)) seen.set(key, item);
      }
    }
  }
  // Later product (agent runs): seen.set('/audit:Audit trail', { to: '/audit', label: 'Audit trail', Icon: AuditIcon });
  seen.set('/technician:Field capture', { to: '/technician', label: 'Field capture', Icon: MicIcon });
  return [...seen.values()];
})();

/**
 * The console frame: fixed sidebar, top bar with the jump palette and the
 * approvals pill, and the page content. `rail` renders a right-hand column on
 * wide screens — the Overview passes the Atmosphere panel through it.
 */
export function AppShell({
  children,
  rail,
  wide = false,
}: {
  children: ReactNode;
  /** Drop the max-width constraint for workspace-style pages. */
  wide?: boolean;
  rail?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [approvalCount, setApprovalCount] = useState(0);
  const [platformId, setPlatformId] = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();

  // Whole-console session time for Atmosphere-internal product analytics.
  useFeatureTimer('app_shell');

  // Landing on a platform's home makes it the active one; shared screens
  // (Jobs, Billing, Settings) leave the choice alone, so opening a job from
  // Sales does not throw you into Operations.
  useEffect(() => {
    const fromPath = platformOfPath(location.pathname);
    if (fromPath && fromPath !== platformId) setPlatformId(fromPath);
  }, [location.pathname, platformId, setPlatformId]);

  const platform = PLATFORMS[platformId];

  // The pill is a glance, not a live feed — one fetch per mount is enough,
  // and a backend without the verifier configured simply shows no pill.
  useEffect(() => {
    let cancelled = false;
    api
      .getEscalations()
      .then(({ escalations }) => {
        if (!cancelled) setApprovalCount(escalations.filter((e) => e.status === 'open').length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-paper-100">
      {/* ---- Sidebar ---- */}
      {/* Fixed full-width rail on desktop; slide-in drawer on mobile. */}
      <aside
        className={`glass-rail fixed inset-y-0 left-0 z-40 flex w-60 flex-col transition-transform duration-200 md:translate-x-0 md:transform-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between px-5 py-5">
          <Logo />
          <button
            className="text-ink-500 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <nav aria-label="Primary" className="cx-scroll cx-gutter min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-1">
          {platform.groups.map((group) => (
            <div key={group.label} className="mt-4 first:mt-0">
              <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, Icon }) => {
                  const tourTarget =
                    to === '/intake' ? 'nav-start-job' : to === '/shared' ? 'nav-job-progress' : undefined;
                  return (
                  <NavLink
                    key={`${group.label}-${to}`}
                    to={to}
                    data-tour={tourTarget}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-ink-600 hover:bg-paper-200 hover:text-ink-900'
                      }`
                    }
                  >
                    <Icon width={16} height={16} className="shrink-0" />
                    <span className="flex-1 truncate">{label}</span>
                    {to === '/approvals' && approvalCount > 0 && (
                      <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                        {approvalCount}
                      </span>
                    )}
                  </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ---- Top bar + content ---- */}
      <div className="md:pl-60">
        <header className="glass-bar sticky top-0 z-20">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              className="text-ink-600 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <MenuIcon width={20} height={20} />
            </button>

            <JumpPalette />

            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />
              {/* Approvals are an office concern; the Field app's topbar
                  carries capture, not a queue. */}
              {approvalCount > 0 && platformId !== 'field' && (
                <button
                  onClick={() => navigate('/approvals')}
                  className="hidden items-center gap-1.5 rounded-full border border-caution-200 bg-caution-50 px-3 py-1.5 text-xs font-semibold text-caution-600 transition hover:border-caution-600 sm:flex"
                >
                  {approvalCount} awaiting approval
                </button>
              )}
              <AccountMenu />
            </div>
          </div>
        </header>

        <div className={rail ? 'xl:flex' : undefined}>
          <main
            className={`min-w-0 flex-1 px-4 py-6 sm:px-6 ${rail || wide ? '' : 'max-w-6xl'}`}
          >
            {children}
          </main>
          {rail && (
            <aside className="w-full shrink-0 px-4 pb-8 sm:px-6 xl:w-[352px] xl:pl-2 xl:pt-6">
              {rail}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Cycles System → Light → Dark. The icon shows the *current* preference so a
 * dark choice stays dark on every route until the user changes it — including
 * when the OS would have preferred light.
 */
function ThemeToggle() {
  const { theme } = usePreferences();
  const next = cycleThemePreference(theme);
  const resolved = resolveTheme(theme);
  const label = themeLabel(theme);
  return (
    <button
      onClick={() => setPreference('theme', next)}
      aria-label={`Appearance: ${label}. Click for ${themeLabel(next)}.`}
      title={`Appearance: ${label} (click for ${themeLabel(next).toLowerCase()})`}
      className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-600 transition hover:border-line-strong hover:text-ink-900"
    >
      {theme === 'system' ? (
        <MonitorIcon width={15} height={15} />
      ) : resolved === 'dark' ? (
        <MoonIcon width={15} height={15} />
      ) : (
        <SunIcon width={15} height={15} />
      )}
    </button>
  );
}

/**
 * The jump palette: type to filter destinations, Enter goes to the first
 * match. ⌘K / Ctrl-K focuses it from anywhere, which is the whole point —
 * hands stay on the keys between screens.
 */
function JumpPalette() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return JUMP_TARGETS;
    return JUMP_TARGETS.filter((t) => t.label.toLowerCase().includes(q));
  }, [query]);

  const go = useCallback(
    (to: string) => {
      navigate(to);
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    },
    [navigate],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-lg glass-card px-3 py-2 text-sm text-ink-500 transition focus-within:border-brand-500">
        <SearchIcon width={15} height={15} className="shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) go(matches[0].to);
          }}
          placeholder="Jump to…"
          aria-label="Jump to a screen"
          className="w-full bg-transparent text-ink-900 placeholder-ink-500 outline-none"
        />
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-500 sm:block">
          ⌘K
        </kbd>
      </div>

      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl glass-panel">
          {matches.slice(0, 7).map(({ to, label, Icon }, i) => (
            <button
              key={`${to}-${label}`}
              onClick={() => go(to)}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition hover:bg-paper-200 ${
                i === 0 ? 'text-ink-900' : 'text-ink-700'
              }`}
            >
              <Icon width={15} height={15} className="text-ink-500" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The account block. It carries the two things that are about *you* rather
 * than about the work: Settings, and signing out.
 */
function AccountMenu() {
  const { user, profile, membership, logout } = useAuth();
  const { confirmSignOut } = usePreferences();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const name = displayName(profile?.fullName, user?.email);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    if (confirmSignOut && !window.confirm('Sign out of Atmosphere?')) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full transition hover:opacity-90"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500 text-xs font-semibold text-white">
          {initials(profile?.fullName, user?.email)}
        </span>
        <ChevronDownIcon width={14} height={14} className="hidden shrink-0 text-ink-500 sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl glass-panel"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium text-ink-900">{name}</p>
            <p className="truncate text-xs text-ink-500">{user?.email}</p>
            {membership?.org?.name && (
              <p className="mt-1 text-xs text-ink-500">{membership.org.name}</p>
            )}
          </div>

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-800 transition hover:bg-paper-200"
          >
            <SettingsIcon width={17} height={17} className="text-ink-500" />
            Settings
          </button>

          <button
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left text-sm text-danger-600 transition hover:bg-danger-50 disabled:opacity-60"
          >
            {loggingOut ? (
              <SpinnerIcon className="animate-spin" width={17} height={17} />
            ) : (
              <LogOutIcon width={17} height={17} />
            )}
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Consistent page heading with an optional action on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-sm font-medium text-brand-600">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Centred spinner for a panel that has not loaded yet. */
export function PanelSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid place-items-center py-12 text-brand-600">
      <SpinnerIcon className="animate-spin" width={24} height={24} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-600"
    >
      {message}
    </p>
  );
}
