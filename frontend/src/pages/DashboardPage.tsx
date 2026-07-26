import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type OrgMember,
} from '../lib/api';
import { Logo } from '../components/Logo';
import { PinSetupCard } from '../components/PinSetupCard';
import { SpinnerIcon, CheckIcon, MicIcon } from '../components/icons';

export function DashboardPage() {
  const { user, membership, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [copied, setCopied] = useState(false);

  const org = membership?.org;

  useEffect(() => {
    let cancelled = false;
    api
      .getMembers()
      .then(({ members }) => {
        if (!cancelled) setMembers(members);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  async function copyCode() {
    if (!org?.joinCode) return;
    try {
      await navigator.clipboard.writeText(org.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  }

  return (
    <div className="cx-aurora min-h-screen bg-paper-100">
      <header className="flex items-center justify-between border-b border-line px-6 py-4 sm:px-10">
        <Logo />
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-2 rounded-lg border border-line bg-paper-0 px-4 py-2 text-sm font-medium text-ink-800 transition hover:bg-paper-100 disabled:opacity-60"
        >
          {loggingOut && <SpinnerIcon className="animate-spin" width={16} height={16} />}
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-600">{org?.name ?? 'Your organization'}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink-900">
            Welcome to Atmosphere 🎉
          </h1>
          <p className="mt-2 max-w-xl text-ink-600">
            You're signed in as{' '}
            <span className="text-ink-800">{user?.email}</span>
            {membership && (
              <>
                {' '}
                — {ROLE_LABELS[membership.role]} ·{' '}
                {WORK_TYPE_LABELS[membership.workType]}
              </>
            )}
            .
          </p>

          {/* Org + invite */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-paper-0 shadow-card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Organization
              </p>
              <p className="mt-1.5 text-lg font-semibold text-ink-900">{org?.name ?? '—'}</p>
            </div>

            <div className="rounded-xl border border-line bg-paper-0 shadow-card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Invite code
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                <code className="rounded-md border border-line bg-paper-100 px-2.5 py-1 font-mono text-lg tracking-widest text-brand-700">
                  {org?.joinCode ?? '—'}
                </code>
                {org?.joinCode && (
                  <button
                    onClick={copyCode}
                    className="flex items-center gap-1 text-sm text-ink-600 transition hover:text-ink-900"
                  >
                    {copied ? (
                      <>
                        <CheckIcon width={16} height={16} /> Copied
                      </>
                    ) : (
                      'Copy'
                    )}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-500">
                Share this code so teammates can link their account.
              </p>
            </div>
          </div>

          {/* Technician app */}
          <Link
            to="/technician"
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-brand-200 bg-brand-50 p-5 transition hover:border-brand-300 hover:bg-brand-100"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-card">
                <MicIcon width={20} height={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Open the technician app</p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Record audio and video, talk through a job, and detect what the camera sees.
                </p>
              </div>
            </div>
            <span aria-hidden="true" className="shrink-0 text-brand-600">
              →
            </span>
          </Link>

          {/* Device PIN */}
          <div className="mt-4">
            <PinSetupCard />
          </div>

          {/* Linked accounts */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-ink-900">Linked accounts</h2>
            <p className="mt-1 text-sm text-ink-600">
              Everyone linked to {org?.name ?? 'your organization'} can work and communicate
              together.
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-line">
              {members === null ? (
                <div className="grid place-items-center py-10 text-brand-600">
                  <SpinnerIcon className="animate-spin" width={22} height={22} />
                </div>
              ) : members.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-ink-500">No linked accounts yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {members.map((m) => {
                    const isYou = m.userId === user?.id;
                    return (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-4 bg-paper-0 px-5 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-50 text-sm font-semibold uppercase text-brand-700">
                            {(m.email ?? '?').slice(0, 2)}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-ink-900">
                              {m.email ?? m.userId}
                              {isYou && <span className="ml-2 text-xs text-brand-600">(you)</span>}
                            </p>
                            <p className="text-xs text-ink-500">{WORK_TYPE_LABELS[m.workType]}</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-line bg-paper-0 px-3 py-1 text-xs font-medium text-ink-700">
                          {ROLE_LABELS[m.role]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
