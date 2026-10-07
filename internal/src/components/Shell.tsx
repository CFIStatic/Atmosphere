import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canManageAccess, canSeeAccounts } from '../lib/access';
import { isTestData, onTestData } from '../lib/api';
import { NAV_GROUPS, type NavGroup } from '../lib/nav';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../lib/sidebar';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { ErrorBoundary } from './ErrorBoundary';

function useTestDataFlag(): boolean {
  return useSyncExternalStore(onTestData, isTestData, () => false);
}

interface Hint {
  label: string;
  top: number;
  left: number;
}

/**
 * The report's table of contents. Expanded: group captions and labels.
 * Collapsed: an icon rail; labels stay in the accessible name and show as a
 * tooltip on hover or keyboard focus.
 */
function SideNav({
  groups,
  collapsed,
  pending,
  onNavigate,
  onHint,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  pending: number;
  onNavigate?: () => void;
  onHint?: (hint: Hint | null) => void;
}) {
  const show = (label: string) => (event: { currentTarget: HTMLElement }) => {
    if (!collapsed || !onHint) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onHint({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  };
  const hide = () => onHint?.(null);

  return (
    <nav aria-label="Reports" className={collapsed ? 'space-y-2' : 'space-y-5'}>
      {groups.map((group, index) => (
        <div key={group.title} role="group" aria-label={group.title}>
          {collapsed ? (
            index > 0 && <div aria-hidden="true" className="mx-3 mb-2 border-t border-line" />
          ) : (
            <p className="eyebrow mb-1 px-3" aria-hidden="true">
              {group.title}
            </p>
          )}
          <ul className="space-y-px">
            {group.items.map((item) => {
              const Icon = item.icon;
              const badge = item.to === '/access' && pending > 0 ? pending : 0;
              const name = badge ? `${item.label}, ${badge} pending` : item.label;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={() => {
                      hide();
                      onNavigate?.();
                    }}
                    onMouseEnter={show(name)}
                    onMouseLeave={hide}
                    onFocus={show(name)}
                    onBlur={hide}
                    aria-label={collapsed ? name : undefined}
                    className={({ isActive }) =>
                      `nav-item group ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                        isActive ? 'nav-item-active' : 'text-ink-600 hover:bg-paper-200 hover:text-ink-900'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className="relative shrink-0">
                          <Icon
                            aria-hidden="true"
                            className={`h-4 w-4 ${isActive ? 'text-brand-600' : 'text-ink-500 group-hover:text-ink-800'}`}
                            strokeWidth={1.75}
                          />
                          {collapsed && badge > 0 && (
                            <span aria-hidden="true" className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-brand-500" />
                          )}
                        </span>
                        {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                        {!collapsed && badge > 0 && (
                          <span
                            className="border border-brand-500/50 px-1 text-[10.5px] font-semibold leading-[16px] tabular-nums text-brand-600"
                            aria-label={`${badge} pending`}
                          >
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Shell() {
  const { user, access, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const [hint, setHint] = useState<Hint | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const testData = useTestDataFlag();
  const internal = canSeeAccounts(access?.scope);
  const pending = canManageAccess(access?.scope) ? (access?.pendingAccessRequests ?? 0) : 0;
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.internal || internal),
  })).filter((group) => group.items.length > 0);

  const toggleCollapsed = useCallback(() => {
    setHint(null);
    setCollapsed((value) => {
      writeSidebarCollapsed(!value);
      return !value;
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuButton.current?.focus();
  }, []);

  // Drawer: focus the first control, lock page scroll, close on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, closeMenu]);

  // Tooltips are dismissible with Escape and never outlive a scroll.
  useEffect(() => {
    if (!hint) return;
    const clear = () => setHint(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', clear, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', clear, true);
    };
  }, [hint]);

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !drawer.current) return;
    const items = Array.from(drawer.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const top = testData ? 'top-[79px] h-[calc(100vh-79px)]' : 'top-[56px] h-[calc(100vh-56px)]';
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

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
      <header className={`sticky ${testData ? 'top-[23px]' : 'top-0'} z-20 h-14 border-b border-line bg-paper-0`}>
        <div className="flex h-full items-center gap-3 px-3 sm:px-4 lg:px-5">
          <button
            ref={menuButton}
            type="button"
            className="grid h-8 w-8 place-items-center border border-line text-ink-700 transition hover:border-line-strong hover:text-ink-900 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          >
            <Menu aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <div className="flex min-w-0 items-end gap-2.5">
            <Logo />
            <span className="mb-[1px] hidden border-l border-line-strong pl-2.5 font-display text-[19px] leading-none text-ink-700 sm:inline">
              Analytics
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2.5 text-[13px] text-ink-600 sm:gap-3">
            <ThemeToggle />
            <span className="hidden max-w-[16rem] truncate md:inline">{access?.displayName ?? user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 text-ink-500 transition hover:text-ink-900"
            >
              <LogOut aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 h-full w-full cursor-default bg-ink-900/40"
            onClick={closeMenu}
          />
          <div
            id="mobile-nav"
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onKeyDown={trapFocus}
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-line bg-paper-50"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <span className="eyebrow">Atmosphere Analytics</span>
              <button
                type="button"
                onClick={closeMenu}
                aria-label="Close navigation"
                className="grid h-8 w-8 place-items-center text-ink-600 hover:text-ink-900"
              >
                <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-4">
              <SideNav groups={groups} collapsed={false} pending={pending} onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="flex">
        <aside
          id="analytics-sidebar"
          aria-label="Sidebar"
          data-collapsed={collapsed ? 'true' : 'false'}
          className={`sticky ${top} hidden shrink-0 flex-col border-r border-line bg-paper-50 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex ${
            collapsed ? 'w-[60px]' : 'w-60'
          }`}
        >
          <div
            className={`flex-1 overflow-y-auto overflow-x-hidden py-5 ${collapsed ? 'px-2' : 'px-3'}`}
            onScroll={() => setHint(null)}
          >
            <SideNav groups={groups} collapsed={collapsed} pending={pending} onHint={setHint} />
          </div>
          <div className={`shrink-0 border-t border-line py-2 ${collapsed ? 'px-2' : 'px-3'}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls="analytics-sidebar"
              aria-label={toggleLabel}
              title={collapsed ? undefined : `${toggleLabel}`}
              onMouseEnter={(e) => {
                if (!collapsed) return;
                const rect = e.currentTarget.getBoundingClientRect();
                setHint({ label: toggleLabel, top: rect.top + rect.height / 2, left: rect.right + 8 });
              }}
              onMouseLeave={() => setHint(null)}
              onFocus={(e) => {
                if (!collapsed) return;
                const rect = e.currentTarget.getBoundingClientRect();
                setHint({ label: toggleLabel, top: rect.top + rect.height / 2, left: rect.right + 8 });
              }}
              onBlur={() => setHint(null)}
              className={`nav-item w-full text-ink-500 hover:bg-paper-200 hover:text-ink-900 ${collapsed ? 'justify-center px-0' : 'px-3'}`}
              data-testid="sidebar-toggle"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <>
                  <PanelLeftClose aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  <span className="text-[12.5px]">Collapse</span>
                </>
              )}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {hint && (
        <div
          role="tooltip"
          aria-hidden="true"
          data-testid="nav-tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap bg-ink-900 px-2 py-1 text-[12px] font-medium text-paper-0"
          style={{ top: hint.top, left: hint.left }}
        >
          {hint.label}
        </div>
      )}
    </div>
  );
}
