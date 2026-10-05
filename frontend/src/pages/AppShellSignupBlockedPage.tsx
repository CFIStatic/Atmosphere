import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAuth } from '../context/AuthContext';
import { WEBSITE_SIGNUP_URL } from '../lib/appShell';

/**
 * iPhone/Android app only: /signup never runs inside the app. Creating an
 * account, a company, and choosing a plan happen on atmosphereteam.com in
 * Safari / the system browser. The link opens outside the app because
 * atmosphereteam.com is not one of the app's in-app hosts (Capacitor hands it
 * to the OS). No prices and no purchase wording.
 */
export function AppShellSignupBlockedPage() {
  const { user, logout } = useAuth();
  return (
    <div className="relative flex min-h-screen flex-col bg-paper-100">
      <header className="flex items-center justify-between gap-4 px-6 py-8">
        <Logo size="lg" />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-2">
        <div
          data-testid="app-shell-signup-blocked"
          className="w-full max-w-md rounded-2xl border border-line bg-paper-0 p-6 shadow-lift"
        >
          <h1 className="text-xl font-bold tracking-tight text-ink-900">
            {user ? 'Finish setup on atmosphereteam.com' : 'Create your account on atmosphereteam.com'}
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            {user
              ? 'Company setup is done on atmosphereteam.com, not in this app. When it is finished, come back here.'
              : 'New accounts and company setup are done on atmosphereteam.com, not in this app. When your account is ready, come back here and sign in.'}
          </p>
          <a
            href={WEBSITE_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="app-shell-signup-website-link"
            className="mt-6 flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 font-semibold text-ink-900 transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          >
            Open atmosphereteam.com
          </a>
          {user ? (
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-3 w-full rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-paper-200"
            >
              Sign out
            </button>
          ) : (
            <Link
              to="/login"
              className="mt-3 block w-full rounded-lg border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink-700 hover:bg-paper-200"
            >
              Back to sign in
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
