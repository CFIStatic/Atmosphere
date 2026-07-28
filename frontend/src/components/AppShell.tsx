import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/api';
import { displayName, initials } from '../lib/display';
import { usePreferences } from '../lib/preferences';
import { Logo } from './Logo';
import {
  AuditIcon,
  BoltIcon,
  BriefcaseIcon,
  ChartIcon,
  CreditCardIcon,
  GaugeIcon,
  HistoryIcon,
  HomeIcon,
  MicIcon,
  SpinnerIcon,
  UsersIcon,
  ChevronDownIcon,
  LogOutIcon,
  SettingsIcon,
} from './icons';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: HomeIcon },
  { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
  { to: '/finance', label: 'Finance', Icon: GaugeIcon },
  { to: '/memory', label: 'Memory', Icon: HistoryIcon },
  { to: '/team', label: 'Team', Icon: UsersIcon },
  { to: '/technician', label: 'Technician', Icon: MicIcon },
  { to: '/computer-use', label: 'Computer', Icon: BoltIcon },
  { to: '/usage', label: 'Usage', Icon: ChartIcon },
  { to: '/billing', label: 'Billing', Icon: CreditCardIcon },
  { to: '/audit', label: 'Audit', Icon: AuditIcon },
];

/**
 * Shared page frame: brand, primary navigation and sign-out. Keeps the header
 * identical across screens so navigation does not shift as you move between them.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="border-b border-line">
        <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <Logo />

          <nav aria-label="Primary" className="hidden gap-1 lg:flex">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
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

          <AccountMenu />
        </div>

        {/* The same navigation, kept reachable on narrow screens. */}
        <nav
          aria-label="Primary"
          className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 lg:hidden"
        >
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:text-ink-900'
                }`
              }
            >
              <Icon width={16} height={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-10">{children}</main>
    </div>
  );
}

/**
 * The account block, sitting where the user's own details belong — beside their
 * name at the end of the header. It carries the two things that are about *you*
 * rather than about the work: Settings, and signing out. Keeping them here, off
 * the primary navigation, is what stops account actions from competing with the
 * screens people use all day.
 */
function AccountMenu() {
  const { user, profile, membership, logout } = useAuth();
  const { confirmSignOut } = usePreferences();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const name = displayName(profile?.fullName, user?.email);

  // Dismiss on an outside click or Escape — a menu anchored to the corner is
  // easy to leave open by accident.
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
        className="flex items-center gap-2.5 rounded-lg border border-line bg-paper-0 py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-ink-800 transition hover:bg-paper-100"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500 text-xs font-semibold text-white">
          {initials(profile?.fullName, user?.email)}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
        <ChevronDownIcon width={15} height={15} className="shrink-0 text-ink-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-paper-0 shadow-lift"
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
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-800 transition hover:bg-paper-100"
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
      className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700"
    >
      {message}
    </p>
  );
}
