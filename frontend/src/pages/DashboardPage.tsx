import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type OrgMember,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
import { displayName, initials } from '../lib/display';
import { SpinnerIcon, CheckIcon, SettingsIcon } from '../components/icons';

export function DashboardPage() {
  const { user, profile, membership } = useAuth();
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
    <AppShell>
      <main className="cx-aurora min-h-screen px-6 py-10 sm:px-10">
        <div className="mx-auto max-w-4xl animate-fade-in-up">
          <p className="text-sm font-medium text-brand-400">{org?.name ?? 'Your organization'}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            Welcome back, {displayName(profile?.fullName, user?.email)} 🎉
          </h1>
          <p className="mt-2 max-w-xl text-gray-400">
            You're signed in as{' '}
            <span className="text-gray-200">{user?.email}</span>
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
            <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Organization
              </p>
              <p className="mt-1.5 text-lg font-semibold text-white">{org?.name ?? '—'}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Invite code
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                <code className="rounded-md bg-ink-700 px-2.5 py-1 font-mono text-lg tracking-widest text-brand-300">
                  {org?.joinCode ?? '—'}
                </code>
                {org?.joinCode && (
                  <button
                    onClick={copyCode}
                    className="flex items-center gap-1 text-sm text-gray-400 transition hover:text-gray-200"
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
              <p className="mt-2 text-xs text-gray-500">
                Share this code so teammates can link their account.
              </p>
            </div>
          </div>

          {/* Computer use */}
          <Link
            to="/computer-use"
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-brand-400/25 bg-brand-500/10 p-5 backdrop-blur transition hover:border-brand-400/50 hover:bg-brand-500/15"
          >
            <div>
              <p className="text-lg font-semibold text-white">Computer Use</p>
              <p className="mt-1 text-sm text-brand-100/70">
                Let Claude see and operate a computer for you — connect an Anthropic API key and
                run the agent on any machine.
              </p>
            </div>
            <span aria-hidden className="shrink-0 text-2xl text-brand-300">
              →
            </span>
          </Link>

          {/* Account settings — including the device PIN — live in Settings now,
              so the dashboard stays a view of the organization. */}
          <Link
            to="/settings"
            className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-ink-800/40 p-5 transition hover:border-white/20 hover:bg-ink-800/70"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-600/20 text-brand-200">
              <SettingsIcon width={20} height={20} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">Settings</span>
              <span className="block text-sm text-gray-400">
                Your name, password, PIN sign-in, and device preferences.
              </span>
            </span>
          </Link>

          {/* Linked accounts */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-white">Linked accounts</h2>
            <p className="mt-1 text-sm text-gray-400">
              Everyone linked to {org?.name ?? 'your organization'} can work and communicate
              together.
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              {members === null ? (
                <div className="grid place-items-center py-10 text-brand-300">
                  <SpinnerIcon className="animate-spin" width={22} height={22} />
                </div>
              ) : members.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-500">No linked accounts yet.</p>
              ) : (
                <ul className="divide-y divide-white/10">
                  {members.map((m) => {
                    const isYou = m.userId === user?.id;
                    return (
                      <li
                        key={m.userId}
                        className="flex items-center justify-between gap-4 bg-ink-800/40 px-5 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600/30 text-sm font-semibold text-brand-200">
                            {initials(m.fullName, m.email)}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-white">
                              {displayName(m.fullName, m.email)}
                              {isYou && <span className="ml-2 text-xs text-brand-400">(you)</span>}
                            </p>
                            <p className="text-xs text-gray-500">{WORK_TYPE_LABELS[m.workType]}</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-ink-700/60 px-3 py-1 text-xs font-medium text-gray-300">
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
    </AppShell>
  );
}
