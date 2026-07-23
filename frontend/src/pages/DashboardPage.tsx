import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { SpinnerIcon } from '../components/icons';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  const joined = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  return (
    <div className="cx-aurora min-h-screen bg-ink-900">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4 sm:px-10">
        <Logo />
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-700/70 px-4 py-2 text-sm font-medium text-gray-200 transition hover:bg-ink-600 disabled:opacity-60"
        >
          {loggingOut && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-4xl px-6 py-12 sm:px-10">
        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-400">Dashboard</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            You're signed in 🎉
          </h1>
          <p className="mt-2 max-w-xl text-gray-400">
            This protected page is only reachable with a valid session. Your session lives in a
            secure, httpOnly cookie issued by the Commandx backend.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <InfoCard label="Signed in as" value={user?.email ?? '—'} />
            <InfoCard label="User ID" value={user?.id ?? '—'} mono />
            <InfoCard label="Member since" value={joined} />
            <InfoCard
              label="Email confirmed"
              value={user?.emailConfirmed ? 'Yes' : 'Pending'}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function InfoCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1.5 truncate text-lg text-white ${mono ? 'font-mono text-sm' : ''}`}>
        {value}
      </p>
    </div>
  );
}
