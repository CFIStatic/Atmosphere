import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  api,
  ROLE_LABELS,
  WORK_TYPE_LABELS,
  JOB_STATUS_LABELS,
  JOB_STATUS_STYLES,
  formatMinutes,
  timeAgo,
  type BillingOverview,
  type JobSummary,
  type MemoryEvent,
  type MemoryStats,
  type OrgMember,
} from '../lib/api';
import { AppShell, PanelSpinner } from '../components/AppShell';
import { MemoryFeed } from '../components/MemoryFeed';
import { PinSetupCard } from '../components/PinSetupCard';
import { EscalationQueue } from '../components/EscalationQueue';
import { SpinnerIcon, CheckIcon, MicIcon, MonitorIcon, GlobeIcon, PlugIcon } from '../components/icons';
import { formatUsd, usedPct } from '../lib/money';

export function DashboardPage() {
  const { user, membership } = useAuth();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [events, setEvents] = useState<MemoryEvent[] | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
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

    // The record and the open jobs. Each fails to an empty state on its own —
    // the dashboard should still render if one endpoint is unhappy.
    api
      .getJobs({ status: 'open' })
      .then(({ jobs }) => {
        if (!cancelled) setJobs(jobs);
      })
      .catch(() => {
        if (!cancelled) setJobs([]);
      });

    api
      .getMemory({ limit: 8 })
      .then(({ events }) => {
        if (!cancelled) setEvents(events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });

    api
      .getMemoryStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => undefined);

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

          {/* Headline numbers from the record */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Open jobs', value: jobs === null ? '—' : String(jobs.length) },
              { label: 'Team', value: members === null ? '—' : String(members.length) },
              { label: 'Work logged', value: stats ? formatMinutes(stats.minutesLogged) : '—' },
              { label: 'Recorded', value: stats ? stats.totalEvents.toLocaleString() : '—' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-3.5 backdrop-blur"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {stat.label}
                </p>
                <p className="mt-1 text-2xl font-semibold text-white">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Active jobs */}
          <section className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Active jobs</h2>
              <Link
                to="/jobs"
                className="text-sm font-medium text-brand-300 transition hover:text-brand-200"
              >
                All jobs →
              </Link>
            </div>

            <div className="mt-4">
              {jobs === null ? (
                <PanelSpinner label="Loading jobs" />
              ) : jobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
                  <p className="text-sm text-gray-400">No open jobs yet.</p>
                  <Link
                    to="/jobs"
                    className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
                  >
                    Open the first one
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10">
                  {jobs.slice(0, 6).map((job) => (
                    <li key={job.jobId} className="bg-ink-800/40">
                      <Link
                        to={`/jobs/${job.jobId}`}
                        className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-ink-700/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{job.title}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            <span className="font-mono text-brand-300/80">#{job.jobNumber}</span> ·{' '}
                            {job.tasksDone}/{job.taskCount} tasks · {job.crewSize} on crew
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${JOB_STATUS_STYLES[job.status]}`}
                        >
                          {JOB_STATUS_LABELS[job.status]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

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
              className="mt-4 block rounded-xl border border-line bg-paper-0 shadow-card p-5 transition hover:border-brand-300 hover:bg-brand-50"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Credit balance
                </p>
                <p className="text-xs text-brand-600">Manage billing →</p>
              </div>
              <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink-900">
                {formatUsd(billing.balance.totalNanos)}
              </p>
              <p className="mt-0.5 text-sm text-ink-600">
                {billing.subscription.planName} plan ·{' '}
                {formatUsd(billing.periodUsage.priceNanos)} used this period
              </p>
              {billing.subscription.includedCreditsNanos > 0 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-300">
                  <div
                    className="h-full rounded-full bg-brand-500"
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

          {/* Mitigation estimator — only meaningful for mitigation crews. */}
          {membership?.workType === 'mitigation' && (
            <Link
              to="/mitigation"
              className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-brand-500/30 bg-brand-600/10 p-5 transition hover:bg-brand-600/20"
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-brand-300">
                  Mitigation
                </p>
                <p className="mt-1 text-lg font-semibold text-white">Build an estimate</p>
                <p className="mt-1 text-sm text-gray-400">
                  DocuSketch, MICA, photos and notes in — a priced, documented Xactimate scope out.
                </p>
              </div>
              <span aria-hidden className="text-2xl text-brand-300">
                →
              </span>
            </Link>
          )}

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
            <Link to="/connectors" className="flex items-start gap-3 rounded-xl border border-line bg-paper-0 p-5 shadow-card transition hover:border-brand-300 hover:bg-brand-50 sm:col-span-2">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-card">
                <PlugIcon width={20} height={20} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Connectors</p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Connect ServiceTitan, AccuLynx, Xactimate, carrier portals, and more — through
                  web access or a computer-use agent.
                </p>
              </div>
            </Link>

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
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-paper-0 shadow-card p-5 transition hover:border-brand-300 hover:bg-brand-50"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Construction Estimator
              </p>
              <p className="mt-1.5 text-lg font-semibold text-ink-900">
                Turn a scan into a rebuild estimate
              </p>
              <p className="mt-1 text-sm text-ink-600">
                Reads DocuSketch photos and measurements, finds the job in Dash, and builds the
                Xactimate scope — including the rebuild implied by a mitigation estimate.
              </p>
            </div>
            <span aria-hidden="true" className="shrink-0 text-2xl text-brand-600">
              →
            </span>
          </Link>

          {/* Device PIN */}
          <div className="mt-4">
            <PinSetupCard />
          </div>

          {/* Latest activity from the record */}
          <section className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Latest activity</h2>
              <Link
                to="/memory"
                className="text-sm font-medium text-brand-300 transition hover:text-brand-200"
              >
                Full memory →
              </Link>
            </div>
            <p className="mt-1 text-sm text-gray-400">
              {stats
                ? `${stats.totalEvents.toLocaleString()} entries recorded, last one ${timeAgo(events?.[0]?.occurredAt)}.`
                : 'Everything anyone does is recorded here.'}
            </p>
            <div className="mt-4">
              {events === null ? (
                <PanelSpinner label="Loading activity" />
              ) : (
                <MemoryFeed events={events} emptyLabel="Nothing recorded yet." />
              )}
            </div>
          </section>

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
