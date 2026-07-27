import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/api';
import { displayName, initials } from '../lib/display';
import { usePreferences } from '../lib/preferences';
import { Logo } from './Logo';
import {
  ChartIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CloseIcon,
  CreditCardIcon,
  GlobeIcon,
  HomeIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  SettingsIcon,
  SpinnerIcon,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: HomeIcon },
  { to: '/pm', label: 'Project Manager', icon: ClipboardIcon },
  { to: '/web-access', label: 'Web Access', icon: GlobeIcon },
  { to: '/computer-use', label: 'Computer Use', icon: MonitorIcon },
  { to: '/usage', label: 'Usage', icon: ChartIcon },
  { to: '/billing', label: 'Billing', icon: CreditCardIcon },
];

/**
 * The signed-in chrome: a left rail on wide screens, a drawer on narrow ones.
 *
 * The account lives at the *bottom* of the rail — name, role, and the way into
 * Settings — because that is where people reach for it, and because it keeps
 * account actions away from the navigation they use all day.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { collapsedSidebar } = usePreferences();
  const location = useLocation();

  // A drawer that survived a navigation would cover the page it just opened.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const railWidth = collapsedSidebar ? 'lg:w-[4.75rem]' : 'lg:w-64';
  const contentOffset = collapsedSidebar ? 'lg:pl-[4.75rem]' : 'lg:pl-64';

  return (
    <div className="min-h-screen bg-ink-900">
      {/* Desktop rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-white/10 bg-ink-800/60 backdrop-blur lg:flex lg:flex-col ${railWidth}`}
      >
        <Sidebar collapsed={collapsedSidebar} />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-ink-900/90 px-4 py-3 backdrop-blur lg:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-lg border border-white/10 bg-ink-700/70 p-2 text-gray-300 transition hover:bg-ink-600"
        >
          <MenuIcon />
        </button>
        <Logo />
        <MobileAccountButton />
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-white/10 bg-ink-800 shadow-2xl">
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 transition hover:bg-white/5 hover:text-gray-200"
            >
              <CloseIcon />
            </button>
            <Sidebar collapsed={false} />
          </div>
        </div>
      )}

      <div className={contentOffset}>{children}</div>
    </div>
  );
}

/** The rail's contents — identical in the desktop rail and the mobile drawer. */
function Sidebar({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className={`flex items-center px-4 py-5 ${collapsed ? 'justify-center px-0' : ''}`}>
        {collapsed ? <LogoGlyph /> : <Logo />}
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                collapsed ? 'justify-center px-0' : ''
              } ${
                isActive
                  ? 'bg-brand-600/20 text-brand-200'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`
            }
          >
            <item.icon width={18} height={18} />
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>

      <AccountPanel collapsed={collapsed} />
    </div>
  );
}

function LogoGlyph() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 shadow-lg shadow-brand-900/40">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="5" fill="white" fillOpacity="0.95" />
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="3.6"
          stroke="white"
          strokeWidth="1.5"
          transform="rotate(-25 12 12)"
        />
      </svg>
    </span>
  );
}

/**
 * The bottom-left account block: who you are signed in as, a direct link to
 * Settings, and a menu with the rest of the account actions.
 */
function AccountPanel({ collapsed }: { collapsed: boolean }) {
  const { user, profile, membership } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const name = displayName(profile?.fullName, user?.email);
  const subtitle = membership ? ROLE_LABELS[membership.role] : (user?.email ?? '');

  // Dismiss on an outside click or Escape — a menu pinned to the corner is easy
  // to leave open by accident.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={panelRef} className="relative border-t border-white/10 p-3">
      {menuOpen && <AccountMenu onClose={() => setMenuOpen(false)} collapsed={collapsed} />}

      {collapsed ? (
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={name}
            className="grid h-10 w-10 place-items-center rounded-full bg-brand-600/30 text-sm font-semibold text-brand-100 transition hover:bg-brand-600/50"
          >
            {initials(profile?.fullName, user?.email)}
          </button>
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `rounded-lg p-2 transition ${
                isActive ? 'bg-brand-600/20 text-brand-200' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`
            }
          >
            <SettingsIcon width={18} height={18} />
          </NavLink>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/30 text-sm font-semibold text-brand-100">
              {initials(profile?.fullName, user?.email)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{name}</span>
              <span className="block truncate text-xs text-gray-500">{subtitle}</span>
            </span>
            <ChevronRightIcon
              width={16}
              height={16}
              className={`shrink-0 text-gray-500 transition-transform ${menuOpen ? '-rotate-90' : 'rotate-0'}`}
            />
          </button>

          <NavLink
            to="/settings"
            title="Settings"
            aria-label="Settings"
            className={({ isActive }) =>
              `shrink-0 rounded-lg p-2 transition ${
                isActive
                  ? 'bg-brand-600/20 text-brand-200'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`
            }
          >
            <SettingsIcon width={18} height={18} />
          </NavLink>
        </div>
      )}
    </div>
  );
}

function AccountMenu({ onClose, collapsed }: { onClose: () => void; collapsed: boolean }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { confirmSignOut } = usePreferences();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (confirmSignOut && !window.confirm('Sign out of Atmosphere?')) return;
    setSigningOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div
      role="menu"
      className={`absolute bottom-full z-40 mb-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-ink-700 shadow-2xl shadow-black/50 ${
        collapsed ? 'left-2' : 'left-3 right-3 w-auto'
      }`}
    >
      <div className="border-b border-white/10 px-4 py-3">
        <p className="truncate text-xs text-gray-500">Signed in as</p>
        <p className="truncate text-sm text-gray-200">{user?.email}</p>
      </div>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          navigate('/settings');
        }}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-200 transition hover:bg-white/5"
      >
        <SettingsIcon width={17} height={17} className="text-gray-400" />
        Settings
      </button>
      <button
        role="menuitem"
        onClick={handleSignOut}
        disabled={signingOut}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
      >
        {signingOut ? (
          <SpinnerIcon className="animate-spin" width={17} height={17} />
        ) : (
          <LogOutIcon width={17} height={17} />
        )}
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

/** The mobile counterpart of the account block: a tap straight into Settings. */
function MobileAccountButton() {
  const { user, profile } = useAuth();
  return (
    <NavLink
      to="/settings"
      aria-label="Settings"
      className="grid h-9 w-9 place-items-center rounded-full bg-brand-600/30 text-xs font-semibold text-brand-100"
    >
      {initials(profile?.fullName, user?.email)}
    </NavLink>
  );
}
