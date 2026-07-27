import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';
import { BoltIcon, ChartIcon, CreditCardIcon, HomeIcon, MicIcon, SpinnerIcon } from './icons';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: HomeIcon },
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
  const { logout } = useAuth();
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

          <nav aria-label="Primary" className="hidden gap-1 sm:flex">
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

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100 disabled:opacity-60"
          >
            {loggingOut && <SpinnerIcon className="animate-spin" width={16} height={16} />}
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>

        {/* The same navigation, kept reachable on narrow screens. */}
        <nav aria-label="Primary" className="flex gap-1 border-t border-line px-4 py-2 sm:hidden">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
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

      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-10">{children}</main>
    </div>
  );
}
