import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import { AuditIcon, CloseIcon, HomeIcon, MenuIcon, SignOutIcon, SpinnerIcon } from './icons';

/**
 * The signed-in shell: a persistent left rail, and the page beside it.
 *
 * On a narrow screen the rail becomes a drawer rather than disappearing, so
 * every destination stays reachable on a phone — which is where a field
 * technician actually opens this.
 */

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Shown under the label in the drawer; skipped on the desktop rail. */
  hint: string;
}

/**
 * The rail's contents. Atmosphere's larger features live on their own branches
 * and each adds a route here as it lands; keeping the list in one array is what
 * makes that a one-line change rather than a layout edit.
 */
const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon, hint: 'Your organization at a glance' },
  { to: '/audit', label: 'Audit', icon: AuditIcon, hint: 'Every agent, every step' },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon, hint }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              'group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
              isActive
                ? 'bg-brand-600/20 text-white ring-1 ring-inset ring-brand-500/40'
                : 'text-gray-400 hover:bg-white/5 hover:text-gray-100',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                width={18}
                height={18}
                className={`mt-0.5 shrink-0 ${isActive ? 'text-brand-300' : 'text-gray-500 group-hover:text-gray-300'}`}
              />
              <span className="min-w-0">
                <span className="block">{label}</span>
                <span className="mt-0.5 block text-xs font-normal text-gray-500 lg:hidden">
                  {hint}
                </span>
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountCard() {
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
    <div className="border-t border-white/10 p-3">
      <div className="rounded-lg bg-ink-800/60 px-3 py-2.5">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-gray-500">
          {membership?.org?.name ?? 'Your organization'}
        </p>
        <p className="mt-1 truncate text-sm text-gray-200" title={user?.email ?? undefined}>
          {user?.email ?? '—'}
        </p>
      </div>
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-400 transition hover:bg-white/5 hover:text-gray-100 disabled:opacity-60"
      >
        {loggingOut ? (
          <SpinnerIcon className="animate-spin" width={16} height={16} />
        ) : (
          <SignOutIcon width={16} height={16} />
        )}
        {loggingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // A drawer that survives navigation would cover the page it just opened.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-ink-900">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/10 bg-ink-900/95 lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <NavItems />
        </div>
        <AccountCard />
      </aside>

      {/* Mobile bar */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-ink-900/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="rounded-lg border border-white/10 p-2 text-gray-300 transition hover:bg-white/5"
        >
          <MenuIcon width={18} height={18} />
        </button>
        <Logo />
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
          />
          <div className="relative flex h-full w-72 max-w-[85%] flex-col border-r border-white/10 bg-ink-900 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-5">
              <Logo />
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-2 text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
              >
                <CloseIcon width={18} height={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
            <AccountCard />
          </div>
        </div>
      )}

      <main className="lg:pl-64">{children}</main>
    </div>
  );
}
