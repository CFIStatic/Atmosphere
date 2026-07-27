import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import {
  SpinnerIcon,
  HomeIcon,
  BriefcaseIcon,
  HistoryIcon,
  UsersIcon,
} from './icons';

/**
 * The frame every signed-in page sits in: brand, primary navigation, sign out.
 *
 * Extracted when the app grew past a single screen — the dashboard used to own
 * this markup, and duplicating it per page would have let the pages drift.
 */

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: HomeIcon },
  { to: '/jobs', label: 'Jobs', Icon: BriefcaseIcon },
  { to: '/memory', label: 'Memory', Icon: HistoryIcon },
  { to: '/team', label: 'Team', Icon: UsersIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, membership, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="cx-aurora min-h-screen bg-ink-900">
      <header className="border-b border-white/10">
        <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <button
            onClick={() => navigate('/dashboard')}
            className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Atmosphere home"
          >
            <Logo />
          </button>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-400 sm:inline" title={user?.email ?? ''}>
              {membership?.org?.name ?? user?.email}
            </span>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-700/70 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-ink-600 disabled:opacity-60"
            >
              {loggingOut && <SpinnerIcon className="animate-spin" width={16} height={16} />}
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 sm:px-8" aria-label="Primary">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition',
                  isActive
                    ? 'border-brand-400 text-white'
                    : 'border-transparent text-gray-400 hover:border-white/20 hover:text-gray-200',
                ].join(' ')
              }
            >
              <Icon width={17} height={17} />
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
        {eyebrow && <p className="text-sm font-medium text-brand-400">{eyebrow}</p>}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-gray-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Centred spinner for a panel that has not loaded yet. */
export function PanelSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid place-items-center py-12 text-brand-300">
      <SpinnerIcon className="animate-spin" width={24} height={24} />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {hint && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
    >
      {message}
    </p>
  );
}
