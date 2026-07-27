import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  type BillingOverview,
  type OrgMember,
} from '../lib/api';
import { AppShell } from '../components/AppShell';
import { PinSetupCard } from '../components/PinSetupCard';
import { SpinnerIcon, CheckIcon } from '../components/icons';
import { formatUsd, usedPct } from '../lib/money';

export function DashboardPage() {
  const { user, membership } = useAuth();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
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

    // A missing balance should not blank the dashboard — the card just hides.
    api
      .getBillingOverview()
      .then((o) => {
        if (!cancelled) setBilling(o);
      })
      .catch(() => {
        if (!cancelled) setBilling(null);
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
      <div className="mx-auto max-w-4xl">
        <div className="animate-fade-in-up">
          <p className="text-sm font-medium text-brand-400">{org?.name ?? 'Your organization'}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            Welcome to Atmosphere 🎉
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

          {/* Credits — the balance that gates every metered request. */}
          {billing && (
            <Link
              to="/billing"
              className="mt-4 block rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur transition hover:border-brand-500/40 hover:bg-ink-700/50"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Credit balance
                </p>
                <p className="text-xs text-brand-400">Manage billing →</p>
              </div>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-white">
                {formatUsd(billing.balance.totalNanos)}
              </p>
              <p className="mt-0.5 text-sm text-gray-400">
                {billing.subscription.planName} plan ·{' '}
                {formatUsd(billing.periodUsage.priceNanos)} used this period
              </p>
              {billing.subscription.includedCreditsNanos > 0 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300"
                    style={{
                      width: `${usedPct(
                        billing.periodUsage.priceNanos,
                        billing.subscription.includedCreditsNanos,
                      )}%`,
                    }}
                  />
                </div>
              )}
            </Link>
          )}

          {/* Device PIN */}
          <div className="mt-4">
            <PinSetupCard />
          </div>

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
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600/30 text-sm font-semibold uppercase text-brand-200">
                            {(m.email ?? '?').slice(0, 2)}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-white">
                              {m.email ?? m.userId}
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
      </div>
    </AppShell>
  );
}
