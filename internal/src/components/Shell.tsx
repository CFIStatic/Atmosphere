import { useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canManageAccess, canSeeAccounts } from '../lib/access';
import { isTestData, onTestData } from '../lib/api';
import { NAV_GROUPS } from '../lib/nav';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { ErrorBoundary } from './ErrorBoundary';

function useTestDataFlag(): boolean {
  return useSyncExternalStore(onTestData, isTestData, () => false);
}

export function Shell() {
  const { user, access, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const testData = useTestDataFlag();
  const internal = canSeeAccounts(access?.scope);
  const pending = canManageAccess(access?.scope) ? (access?.pendingAccessRequests ?? 0) : 0;
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.internal || internal),
  })).filter((group) => group.items.length > 0);

  const path = location.pathname;

  const nav = (
    <nav aria-label="Reports" className="space-y-5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="eyebrow px-3 pb-1">{group.title}</p>
          <ul className="space-y-px">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between border-l-2 px-3 py-[5px] text-[13px] transition ${
                      isActive || path.startsWith(`${item.to}/`)
                        ? 'border-brand-500 font-medium text-ink-900'
                        : 'border-transparent text-ink-600 hover:border-line-strong hover:text-ink-900'
                    }`
                  }
                >
                  <span>{item.label}</span>
                  {item.to === '/access' && pending > 0 && (
                    <span className="text-[11px] font-semibold tabular-nums text-brand-600" aria-label={`${pending} pending`}>
                      {pending}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-paper-100 text-ink-900">
      {testData && (
        <div
          className="sticky top-0 z-30 border-b border-caution-600/40 bg-paper-0 px-4 py-1 text-center text-[10.5px] font-semibold uppercase tracking-[0.16em] text-caution-600"
          role="status"
          data-testid="test-data-ribbon"
        >
          TEST DATA · mock API · not production figures
        </div>
      )}
      <header className={`sticky ${testData ? 'top-[23px]' : 'top-0'} z-20 border-b border-line bg-paper-0`}>
        <div className="flex items-center gap-4 px-4 py-2.5 lg:px-6">
          <button
            type="button"
            className="btn px-2 py-1 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
          <div className="flex min-w-0 items-end gap-2.5">
            <Logo />
            <span className="mb-[1px] hidden border-l border-line-strong pl-2.5 font-display text-[19px] leading-none text-ink-700 sm:inline">
              Analytics
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[13px] text-ink-600">
            <ThemeToggle />
            <span className="hidden max-w-[16rem] truncate md:inline">{access?.displayName ?? user?.email}</span>
            <button type="button" onClick={() => void logout()} className="text-ink-500 hover:text-ink-900">
              Sign out
            </button>
          </div>
        </div>
      </header>
      {menuOpen && (
        <div id="mobile-nav" className="border-b border-line bg-paper-0 px-1 py-4 lg:hidden">
          {nav}
        </div>
      )}
      <div className="mx-auto flex max-w-[1440px]">
        <aside className="sticky top-[53px] hidden h-[calc(100vh-53px)] w-60 shrink-0 overflow-y-auto border-r border-line py-6 pr-2 lg:block">
          {nav}
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
