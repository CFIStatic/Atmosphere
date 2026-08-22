import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canManageAccess, canSeeAccounts } from '../lib/access';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/overview', label: 'Overview' },
  { to: '/accounts', label: 'Accounts', internal: true },
  { to: '/access', label: 'Access', internal: true },
  { to: '/usage', label: 'Usage' },
  { to: '/experiments', label: 'Experiments', internal: true },
  { to: '/metering', label: 'Metering', internal: true },
  { to: '/system', label: 'System' },
] as const;

export function Shell() {
  const { user, access, logout } = useAuth();
  const location = useLocation();
  const internal = canSeeAccounts(access?.scope);
  const links = NAV.filter((item) => !('internal' in item && item.internal) || internal);
  const pending = canManageAccess(access?.scope) ? (access?.pendingAccessRequests ?? 0) : 0;

  return (
    <div className="min-h-screen bg-paper-100 text-ink-900">
      <header className="sticky top-0 z-20 border-b border-line bg-paper-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/15 text-brand-600">
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden>
                <path d="M7 22.5 16 8.5 25 22.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M11.5 22.5h9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">Atmosphere</p>
              <p className="text-[11px] uppercase tracking-[0.16em] text-ink-500">Internal</p>
            </div>
          </div>
          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm transition ${
                    isActive || location.pathname.startsWith(item.to)
                      ? 'bg-paper-200 text-ink-900'
                      : 'text-ink-600 hover:bg-paper-200/70 hover:text-ink-800'
                  }`
                }
              >
                {item.label}
                {item.to === '/access' && pending > 0 && (
                  <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 text-[10px] font-medium text-white">
                    {pending}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-ink-600">
            <ThemeToggle />
            <span className="hidden sm:inline">{access?.displayName ?? user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md px-2 py-1 text-ink-500 hover:bg-paper-200 hover:text-ink-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
