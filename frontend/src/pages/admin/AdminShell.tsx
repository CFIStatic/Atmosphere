import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Logo } from '../../components/Logo';
import { SpinnerIcon } from '../../components/icons';
import { useAuth } from '../../context/AuthContext';
import { scopeAtLeast, type PlatformStaffScope } from '../../lib/adminApi';

const TABS: Array<{
  to: string;
  label: string;
  min: PlatformStaffScope;
  end?: boolean;
}> = [
  { to: '/admin', label: 'Accounts', min: 'support', end: true },
  { to: '/admin/users', label: 'Users', min: 'support' },
  { to: '/admin/infrastructure', label: 'Infrastructure', min: 'ops' },
  { to: '/admin/database', label: 'Database', min: 'ops' },
  { to: '/admin/audit', label: 'Audit', min: 'support' },
];

export function AdminShell({
  scope,
  title,
  strapline,
  children,
}: {
  scope: PlatformStaffScope;
  title: string;
  strapline: string;
  children: ReactNode;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-ink-900 text-gray-100">
      <header className="border-b border-white/10 px-6 py-4 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Logo className="text-white" />
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-200">
              Internal
            </span>
            <span className="hidden text-xs text-gray-500 sm:inline">scope: {scope}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/analytics"
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
            >
              Analytics
            </Link>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 transition hover:bg-white/5"
            >
              Back to app
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-white/10 bg-ink-700/70 px-3 py-2 text-sm text-gray-200 transition hover:bg-ink-600"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-1" aria-label="Admin sections">
          {TABS.filter((t) => scopeAtLeast(scope, t.min)).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  'rounded-lg px-3 py-1.5 text-sm transition',
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
                ].join(' ')
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-400">{strapline}</p>
        </div>
        {children}
        <footer className="mt-14 border-t border-white/10 pt-6 text-xs text-gray-600">
          Atmosphere internal support portal — customer data. Do not forward outside the company.
          Mutating actions are written to the audit log.
        </footer>
      </main>
    </div>
  );
}

export function AdminLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-screen place-items-center bg-ink-900 text-brand-300"
    >
      <SpinnerIcon className="animate-spin" width={28} height={28} />
      <span className="sr-only">Loading admin portal…</span>
    </div>
  );
}

export function AdminErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 px-6 py-12 text-center">
      <p className="text-sm font-medium text-gray-200">Could not load</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-500">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Try again
        </button>
      )}
    </div>
  );
}
