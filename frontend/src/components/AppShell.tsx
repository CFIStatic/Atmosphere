import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import {
  BoltIcon,
  BriefcaseIcon,
  ChartIcon,
  CreditCardIcon,
  HistoryIcon,
  HomeIcon,
  MicIcon,
  SpinnerIcon,
  UsersIcon,
} from './icons';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: HomeIcon },
  { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
  { to: '/memory', label: 'Memory', Icon: HistoryIcon },
  { to: '/team', label: 'Team', Icon: UsersIcon },
  { to: '/technician', label: 'Technician', Icon: MicIcon },
  { to: '/computer-use', label: 'Computer', Icon: BoltIcon },
  { to: '/usage', label: 'Usage', Icon: ChartIcon },
  { to: '/billing', label: 'Billing', Icon: CreditCardIcon },
];

/**
 * Shared page frame: brand, primary navigation and sign-out. Keeps the header
 * identical across screens so navigation does not shift as you move between them.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, membership, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

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

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-600 xl:inline" title={user?.email ?? ''}>
              {membership?.org?.name ?? user?.email}
            </span>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100 disabled:opacity-60"
            >
              {loggingOut && <SpinnerIcon className="animate-spin" width={16} height={16} />}
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
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
