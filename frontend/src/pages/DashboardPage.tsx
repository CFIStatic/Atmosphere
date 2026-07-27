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
  type JobSummary,
  type MemoryEvent,
  type MemoryStats,
  type OrgMember,
} from '../lib/api';
import { AppShell, PanelSpinner } from '../components/AppShell';
import { MemoryFeed } from '../components/MemoryFeed';
import { PinSetupCard } from '../components/PinSetupCard';
import { CheckIcon } from '../components/icons';

export function DashboardPage() {
  const { user, membership } = useAuth();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [events, setEvents] = useState<MemoryEvent[] | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [copied, setCopied] = useState(false);

  const org = membership?.org;

  useEffect(() => {
    let cancelled = false;
    const set = <T,>(setter: (v: T) => void, fallback: T) => ({
      ok: (v: T) => !cancelled && setter(v),
      fail: () => !cancelled && setter(fallback),
    });

    const m = set<OrgMember[]>(setMembers, []);
    api.getMembers().then(({ members }) => m.ok(members)).catch(m.fail);

    const j = set<JobSummary[]>(setJobs, []);
    api.getJobs({ status: 'open' }).then(({ jobs }) => j.ok(jobs)).catch(j.fail);

    const e = set<MemoryEvent[]>(setEvents, []);
    api.getMemory({ limit: 8 }).then(({ events }) => e.ok(events)).catch(e.fail);

    api.getMemoryStats().then((s) => !cancelled && setStats(s)).catch(() => undefined);

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
      <div className="animate-fade-in-up">
        <p className="text-sm font-medium text-brand-400">{org?.name ?? 'Your organization'}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Welcome to Atmosphere</h1>
        <p className="mt-2 max-w-xl text-gray-400">
          You're signed in as <span className="text-gray-200">{user?.email}</span>
          {membership && (
            <>
              {' '}
              — {ROLE_LABELS[membership.role]} · {WORK_TYPE_LABELS[membership.workType]}
            </>
          )}
          .
        </p>

        {/* Headline numbers from the record */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Open jobs', value: jobs === null ? '—' : String(jobs.length) },
            { label: 'Team', value: members === null ? '—' : String(members.length) },
            {
              label: 'Work logged',
              value: stats ? formatMinutes(stats.minutesLogged) : '—',
            },
            { label: 'Recorded', value: stats ? stats.totalEvents.toLocaleString() : '—' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/10 bg-ink-800/60 px-4 py-3.5 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
          {/* Active jobs */}
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Active jobs</h2>
              <Link to="/jobs" className="text-sm font-medium text-brand-300 transition hover:text-brand-200">
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

          {/* Org, invite, PIN */}
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Invite code</p>
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

            {/* Computer use */}
            <Link
              to="/computer-use"
              className="flex items-center justify-between gap-4 rounded-xl border border-brand-400/25 bg-brand-500/10 p-5 backdrop-blur transition hover:border-brand-400/50 hover:bg-brand-500/15"
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

            <PinSetupCard />

            <div className="rounded-xl border border-white/10 bg-ink-800/60 p-5 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Linked accounts</p>
                <Link to="/team" className="text-xs font-medium text-brand-300 hover:text-brand-200">
                  View team →
                </Link>
              </div>
              {members === null ? (
                <p className="mt-3 text-sm text-gray-500">Loading…</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {members.slice(0, 5).map((m) => (
                    <li key={m.userId} className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600/30 text-[11px] font-semibold uppercase text-brand-200">
                        {(m.email ?? '?').slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                        {m.fullName || m.email}
                        {m.userId === user?.id && <span className="ml-1.5 text-xs text-brand-400">(you)</span>}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">{ROLE_LABELS[m.role]}</span>
                    </li>
                  ))}
                  {members.length > 5 && (
                    <li className="text-xs text-gray-500">+{members.length - 5} more</li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Recent memory */}
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Latest activity</h2>
            <Link to="/memory" className="text-sm font-medium text-brand-300 transition hover:text-brand-200">
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
      </div>
    </AppShell>
  );
}
