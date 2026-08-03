import { useEffect, useRef, useState, type ReactNode, type ComponentType, type SVGProps } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, ROLE_LABELS } from '../lib/api';
import { displayName, initials } from '../lib/display';
import { setPreference, usePreferences } from '../lib/preferences';
import { PLATFORMS, PLATFORM_HOME, PLATFORM_IDS, platformOfPath } from '../lib/platforms';
import { usePlatform } from '../lib/usePlatform';
import { Logo } from './Logo';
import {
  AuditIcon,
  BoltIcon,
  BriefcaseIcon,
  ChartIcon,
  CreditCardIcon,
  GlobeIcon,
  GaugeIcon,
  HistoryIcon,
  HomeIcon,
  MailIcon,
  MicIcon,
  PlugIcon,
  SpinnerIcon,
  UsersIcon,
  ChevronDownIcon,
  CloseIcon,
  GaugeIcon,
  LogOutIcon,
  MenuIcon,
  MicIcon,
  MoonIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
} from './icons';

type IconComp = ComponentType<SVGProps<SVGSVGElement>>;

const NAV: Array<{ to: string; label: string; Icon: IconComp }> = [
  { to: '/dashboard', label: 'Dashboard', Icon: HomeIcon },
  { to: '/sales', label: 'Outreach', Icon: SparkIcon },
  { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
  { to: '/finance', label: 'Finance', Icon: GaugeIcon },
  { to: '/memory', label: 'Memory', Icon: HistoryIcon },
  { to: '/team', label: 'Team', Icon: UsersIcon },
  { to: '/technician', label: 'Technician', Icon: MicIcon },
  { to: '/connectors', label: 'Connectors', Icon: PlugIcon },
  { to: '/computer-use', label: 'Computer', Icon: BoltIcon },
  { to: '/email-marketing', label: 'Email', Icon: MailIcon },
  { to: '/integrations', label: 'CRM', Icon: GlobeIcon },
  { to: '/usage', label: 'Usage', Icon: ChartIcon },
  { to: '/billing', label: 'Billing', Icon: CreditCardIcon },
  { to: '/audit', label: 'Audit', Icon: AuditIcon },
];

/**
 * Shared page frame: brand on the left rail, primary navigation underneath,
 * account menu in the top-right of the content pane.
 */
export function AppShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  /** Drop the max-width constraint for workspace-style pages. */
  wide?: boolean;
}) {
  return (
    <div className="cx-aurora flex min-h-screen bg-paper-100">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-paper-0/80 backdrop-blur lg:flex">
        <div className="border-b border-line px-4 py-4">
          <Logo />
        </div>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-600 hover:bg-paper-100 hover:text-ink-900'
                }`
              }
            >
              <Icon width={17} height={17} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-paper-0/60 px-4 py-3 backdrop-blur sm:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden text-sm text-ink-500 lg:block">Atmosphere</div>
          <AccountMenu />
        </header>

        {/* Mobile nav — horizontal scroll, same destinations as the left rail. */}
        <nav
          aria-label="Primary"
          className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden"
        >
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:text-ink-900'
                }`
              }
            >
              <Icon width={16} height={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <main className={`w-full flex-1 px-4 py-6 sm:px-8 ${wide ? '' : 'mx-auto max-w-6xl'}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

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
            {membership && (
              <p className="mt-1 text-xs text-ink-500">{ROLE_LABELS[membership.role]}</p>
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
