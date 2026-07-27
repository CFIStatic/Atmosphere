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
import { EscalationQueue } from '../components/EscalationQueue';
import { SpinnerIcon, CheckIcon, MicIcon, MonitorIcon, GlobeIcon } from '../components/icons';
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
          {/* Anything the verifier could not settle on its own. Renders nothing
              when the queue is empty, so it only appears when it matters. */}
          <EscalationQueue />

          {/* The daily driver gets a card of its own — it is a summary you read,
              not a destination you pick. */}
          <Link
            to="/pm"
            className="mt-4 block rounded-xl border border-line bg-paper-0 p-5 shadow-card transition hover:border-brand-300 hover:bg-brand-50"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
              Project Manager
            </p>
            <p className="mt-1.5 text-lg font-semibold text-ink-900">What needs you today</p>
            <p className="mt-1 max-w-lg text-sm text-ink-600">
              Every open job checked against the drying log, the schedule, the crew board and the
              paperwork — with the missed readings and the stalled dry-outs pulled to the top.
            </p>
          </Link>

          {/* The places you can go and work. Same card shape throughout, so none
              of them reads as the more important one. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Link to="/technician" className="flex items-start gap-3 rounded-xl border border-line bg-paper-0 p-5 shadow-card transition hover:border-brand-300 hover:bg-brand-50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-card">
                <MicIcon width={20} height={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Technician app</p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Record audio and video, talk through a job, and detect what the camera sees.
                </p>
              </div>
            </Link>

            <Link to="/web-access" className="flex items-start gap-3 rounded-xl border border-line bg-paper-0 p-5 shadow-card transition hover:border-brand-300 hover:bg-brand-50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-card">
                <GlobeIcon width={20} height={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Web access</p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Sign in to carrier portals and vendor sites, pull data out, and enter data —
                  without leaving Atmosphere.
                </p>
              </div>
            </Link>

            <Link to="/computer-use" className="flex items-start gap-3 rounded-xl border border-line bg-paper-0 p-5 shadow-card transition hover:border-brand-300 hover:bg-brand-50">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-card">
                <MonitorIcon width={20} height={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Computer use</p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Let Claude see and operate a computer — connect an Anthropic key and run the
                  agent on any machine.
                </p>
              </div>
            </Link>
          </div>

          {/* Construction Estimator */}
          <Link
            to="/estimator"
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur transition hover:border-brand-500/40 hover:bg-ink-700/60"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-400">
                Construction Estimator
              </p>
              <p className="mt-1.5 text-lg font-semibold text-white">
                Turn a scan into a rebuild estimate
              </p>
              <p className="mt-1 text-sm text-gray-400">
                Reads DocuSketch photos and measurements, finds the job in Dash, and builds the
                Xactimate scope — including the rebuild implied by a mitigation estimate.
              </p>
            </div>
            <span aria-hidden="true" className="shrink-0 text-2xl text-brand-300">
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
      </div>
    </AppShell>
  );
}
