import { useEffect, useState } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import {
  api,
  type SalesWorkResponse,
  type SalesWorkDetail,
  type WorkTone,
  type WorkSource,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';

/**
 * What the company is doing on the work you sold.
 *
 * A salesperson hands a job to operations and then goes dark on it. The
 * customer calls two weeks later asking how it is going, and the honest answer
 * is "let me find out" — which is the moment the relationship they spent months
 * building starts costing them.
 *
 * Everything needed to answer that call is already recorded — in three
 * different places. Sales' own job row, the Operations project board (phase,
 * milestones, the alerts the project agent raises), and the Field app (moisture
 * readings, equipment on and off site). This page is where the three meet.
 *
 * The two halves were never introduced: pm_projects was built on its own branch
 * and deliberately avoided foreign keys back to the Sales tables. So a
 * salesperson could not see the work even in principle. The pairing now runs
 * off an explicit link where one exists and a shared claim number where it does
 * not, and the page says which — "linked" and "same claim number" are different
 * levels of confidence and the person about to email a customer should know
 * which they have.
 *
 * Read-only about the work, deliberately: somebody watching delivery from the
 * outside is the wrong person to move a schedule from a summary screen.
 *
 * Not read-only about the relationship, which is the point. A drafted update is
 * composed from what is actually recorded and put in front of the salesperson
 * with everything filled in. Nothing is delivered until they press send — the
 * automation stops at composing, because the failure mode of an automatic send
 * is telling somebody their house is dry when a reading says otherwise.
 *
 * The organising idea is that progress is not the news. A job moving along
 * needs nobody's attention; a job that has gone quiet is the one the customer
 * is about to ring about, and that is what this page puts first.
 */

/** Where a line came from. Field lines carry the most weight with a customer. */
const SOURCE_LABEL: Record<WorkSource, string> = {
  sales: 'Sales',
  operations: 'Operations',
  field: 'Field',
};

const TONE_DOT: Record<WorkTone, string> = {
  progress: 'bg-success-600',
  money: 'bg-brand-600',
  crew: 'bg-ink-400',
  attention: 'bg-caution-600',
  other: 'bg-ink-400',
};

/** Statuses coloured, because "on hold" and "on site" should not look alike. */
const STATUS_STYLE: Record<string, string> = {
  in_progress: 'bg-success-50 text-success-600',
  scheduled: 'bg-brand-50 text-brand-700',
  on_hold: 'bg-caution-50 text-caution-600',
  cancelled: 'bg-danger-50 text-danger-600',
  complete: 'bg-paper-200/60 text-ink-700',
  invoiced: 'bg-brand-50 text-brand-700',
  paid: 'bg-success-50 text-success-600',
  draft: 'bg-paper-200/60 text-ink-500',
};

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'never';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const money = (n: number | null) =>
  n === null || n === undefined
    ? null
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'attention' }) {
  return (
    <div className="rounded-xl glass-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'attention' && value > 0 ? 'text-caution-600' : 'text-ink-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function SalesWorkPage() {
  const [data, setData] = useState<SalesWorkResponse | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, SalesWorkDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    api
      .salesWork(scope)
      .then((res) => {
        if (live) setData(res);
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not load what is happening.');
        setData({ scope, jobs: [], latest: [], counts: { open: 0, onSite: 0, quiet: 0, awaitingPayment: 0 } });
      });
    return () => {
      live = false;
    };
  }, [scope]);

  async function open(jobId: string) {
    const next = openId === jobId ? null : jobId;
    setOpenId(next);
    if (!next || detail[next]) return;
    setLoadingDetail(true);
    try {
      const res = await api.salesWorkJob(next);
      setDetail((prev) => ({ ...prev, [next]: res }));
    } catch {
      // The row stays expanded with what the list already knows, which is more
      // useful than collapsing it and looking like the click did nothing.
    } finally {
      setLoadingDetail(false);
    }
  }

  const jobs = data?.jobs ?? [];
  // Quiet jobs first, then everything else newest-first. The whole point of the
  // page is that the job nobody has touched outranks the one going fine.
  const ordered = [...jobs].sort((a, b) => {
    if (a.quiet !== b.quiet) return a.quiet ? -1 : 1;
    return (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? '');
  });

  return (
    <AppShell>
      <PageHeader
        eyebrow="Sales Platform"
        title="What's happening"
        description="The work your customers have in progress, and the latest on each — so the next time one of them asks, you already know."
        action={
          <div className="flex rounded-lg glass-card p-1 text-sm">
            {(['mine', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  scope === s ? 'bg-brand-600 text-ink-900' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                {s === 'mine' ? 'My customers' : 'Everyone'}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {data === null ? (
        <p className="mt-6 text-sm text-ink-600">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={scope === 'mine' ? 'No jobs on your customers yet' : 'No jobs yet'}
            hint={
              scope === 'mine'
                ? 'Work shows up here once a job is opened against an account you own. Switch to Everyone to watch the whole company.'
                : 'Once operations opens a job, everything the crews record on it appears here.'
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Open jobs" value={data.counts.open} />
            <Tile label="Crew on site" value={data.counts.onSite} />
            <Tile label="Gone quiet" value={data.counts.quiet} tone="attention" />
            <Tile label="Awaiting payment" value={data.counts.awaitingPayment} />
          </div>

          {data.counts.quiet > 0 && (
            <p className="mt-4 rounded-lg border border-caution-200 bg-caution-50 px-4 py-3 text-sm text-caution-600">
              {data.counts.quiet === 1 ? 'One job has' : `${data.counts.quiet} jobs have`} had no
              update in a while. Worth a call before the customer makes it.
            </p>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
            {/* The jobs. Expanding one shows its own timeline rather than
                navigating away, because the question is usually "and what
                about this one" — a page transition each time makes comparing
                two jobs a chore. */}
            <ul className="space-y-2">
              {ordered.map((job) => {
                const on = openId === job.id;
                const info = detail[job.id];
                return (
                  <li key={job.id} className="rounded-xl glass-card">
                    <button
                      onClick={() => void open(job.id)}
                      aria-expanded={on}
                      className="block w-full p-4 text-left"
                    >
                      <span className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink-900">
                            {job.customer ?? 'No customer on this job'}
                          </span>
                          <span className="mt-0.5 block text-xs text-ink-600">
                            {job.jobNumber !== null && (
                              <span className="tabular-nums text-ink-500">#{job.jobNumber} · </span>
                            )}
                            {job.title}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {job.quiet && (
                            <span
                              title={`Nothing recorded for ${job.daysQuiet} days`}
                              className="rounded-full bg-caution-50 px-2 py-0.5 text-[10.5px] font-semibold text-caution-600"
                            >
                              quiet {job.daysQuiet}d
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                              STATUS_STYLE[job.status] ?? 'bg-paper-200/60 text-ink-600'
                            }`}
                          >
                            {job.statusLabel}
                          </span>
                        </span>
                      </span>

                      {/* The single most useful line: the last thing that
                          actually happened, in words that can be repeated. */}
                      <span className="mt-2 flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-ink-700">
                          {job.lastEventText ?? 'Nothing recorded yet'}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-400">
                          {ago(job.lastEventAt)}
                        </span>
                      </span>
                    </button>

                    {on && (
                      <div className="border-t border-line px-4 py-3">
                        {!info && loadingDetail ? (
                          <p className="flex items-center gap-2 text-xs text-ink-500">
                            <SpinnerIcon className="animate-spin" width={13} height={13} />
                            Loading the timeline…
                          </p>
                        ) : !info ? (
                          <p className="text-xs text-ink-500">Could not load this job's timeline.</p>
                        ) : (
                          <>
                            {/* The Operations and Field picture, when the two
                                sides of this job have found each other. */}
                            {info.delivery ? (
                              <div className="rounded-lg border border-line p-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <span className="text-xs font-semibold text-ink-900">
                                    {info.delivery.headline}
                                  </span>
                                  <span className="text-[11px] text-ink-400">
                                    {info.delivery.projectNumber ?? 'Operations'}
                                    {/* Which is a claim about how confident the
                                        pairing is, and somebody about to email
                                        a customer should be able to see it. */}
                                    {info.delivery.matchedBy === 'claim-number' && (
                                      <span
                                        title="Paired by matching claim number rather than an explicit link."
                                        className="ml-1.5 rounded-full bg-caution-50 px-1.5 py-0.5 text-[10px] font-semibold text-caution-600"
                                      >
                                        matched on claim #
                                      </span>
                                    )}
                                  </span>
                                </div>

                                {info.delivery.drying.length > 0 && (
                                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                                    {info.delivery.drying.map((area) => {
                                      const judged =
                                        area.latestPct !== null && area.goalPct !== null;
                                      const dry = judged && area.latestPct! <= area.goalPct!;
                                      return (
                                        <li
                                          key={area.label}
                                          className="flex items-baseline justify-between gap-2 text-[11px]"
                                        >
                                          <span className="text-ink-700">{area.label}</span>
                                          <span
                                            className={
                                              !judged
                                                ? 'text-ink-400'
                                                : dry
                                                  ? 'text-success-600'
                                                  : 'text-caution-600'
                                            }
                                          >
                                            {area.latestPct === null
                                              ? 'no reading yet'
                                              : `${area.latestPct}%${
                                                  area.goalPct !== null
                                                    ? ` / ${area.goalPct}% goal`
                                                    : ''
                                                }`}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            ) : (
                              // Saying so beats a thin page somebody reads as
                              // "nothing is happening".
                              <p className="rounded-lg border border-line px-3 py-2 text-[11px] text-ink-500">
                                No Operations project is paired with this job, so there is no phase
                                or drying data here yet. Pairing happens automatically once both
                                sides carry the same claim number.
                              </p>
                            )}

                            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-600">
                              {info.crew.length > 0 && (
                                <span>
                                  <span className="text-ink-500">On it: </span>
                                  {info.crew.map((c) => c.name).join(', ')}
                                </span>
                              )}
                              {job.contractAmount !== null && (
                                <span>
                                  <span className="text-ink-500">Contract: </span>
                                  {money(job.contractAmount)}
                                </span>
                              )}
                              {info.job.scheduledEnd && (
                                <span>
                                  <span className="text-ink-500">Due: </span>
                                  {new Date(info.job.scheduledEnd).toLocaleDateString()}
                                </span>
                              )}
                            </div>

                            {info.timeline.length === 0 ? (
                              <p className="mt-3 text-xs text-ink-500">
                                Nothing has been recorded on this job yet.
                              </p>
                            ) : (
                              <ol className="mt-3 space-y-2">
                                {info.timeline.slice(0, 12).map((entry) => (
                                  <li key={entry.id} className="flex gap-2.5">
                                    <span
                                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[entry.tone]}`}
                                      aria-hidden="true"
                                    />
                                    <span className="min-w-0">
                                      <span className="block text-xs text-ink-800">{entry.text}</span>
                                      <span className="block text-[11px] text-ink-400">
                                        {SOURCE_LABEL[entry.source] ?? 'Sales'} · {ago(entry.at)}
                                        {entry.by ? ` · ${entry.by}` : ''}
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ol>
                            )}

                            <UpdateComposer job={job} info={info} />
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* One merged stream. "What has happened since I last looked" is a
                different question from "how is job 412 going", and answering
                only the second would mean opening every job to find out. */}
            <aside className="rounded-xl glass-card p-4 lg:sticky lg:top-6">
              <h2 className="text-sm font-semibold text-ink-900">Latest across your jobs</h2>
              {data.latest.length === 0 ? (
                <p className="mt-2 text-xs text-ink-500">Nothing recorded yet.</p>
              ) : (
                <ol className="mt-3 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                  {data.latest.map((entry) => (
                    <li key={entry.id} className="flex gap-2.5">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[entry.tone]}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-ink-800">{entry.text}</p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {entry.jobId ? (
                            <button
                              onClick={() => void open(entry.jobId!)}
                              className="text-brand-600 hover:text-brand-700"
                            >
                              {entry.customer ?? entry.jobTitle ?? 'This job'}
                            </button>
                          ) : (
                            (entry.customer ?? 'Unassigned')
                          )}
                          {' · '}
                          {ago(entry.at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-[11px] text-ink-400">
                Recorded by the crews and the office as the work happens. Nothing here can be
                changed from this page.
              </p>
            </aside>
          </div>
        </>
      )}
    </AppShell>
  );
}

/**
 * The update, drafted for you.
 *
 * This is where "stay in the loop" turns into "keep the relationship". The
 * subject and body arrive filled in from what the crews actually recorded, so
 * the salesperson's job is to read it, change what they want, and send —
 * rather than to compose a progress report about work they cannot see.
 *
 * Two things it will not do. It will not send without a preview first: the
 * preview runs the same screening as the send, so "this person unsubscribed"
 * is known before anybody presses the button rather than after. And it will
 * not send to more than one person at a time — a bulk "update everyone" on a
 * page somebody opens between calls is how four hundred customers get mailed
 * about work on another house.
 */
function UpdateComposer({
  job,
  info,
}: {
  job: { id: string; customer: string | null };
  info: SalesWorkDetail;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(info.recipients[0]?.email ?? info.delivery?.customerEmail ?? '');
  const [subject, setSubject] = useState(info.suggestedUpdate.subject);
  const [body, setBody] = useState(info.suggestedUpdate.body);
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<{
    wouldSend: number;
    blocked: Array<{ email: string; reason: string }>;
    warnings?: string[];
  } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setResult(null);
    try {
      const res = await api.sendJobUpdate(job.id, { to, subject, body });
      setPreview({ wouldSend: res.wouldSend ?? 0, blocked: res.blocked, warnings: res.warnings });
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Could not check that.');
    } finally {
      setChecking(false);
    }
  }

  async function send() {
    setChecking(true);
    try {
      const res = await api.sendJobUpdate(job.id, { to, subject, body, confirm: true });
      setResult(
        res.sent
          ? `Sent to ${to}${res.from ? ` from ${res.from}` : ''}.`
          : (res.blocked[0]?.reason ?? res.error ?? 'Nothing was sent.'),
      );
      setPreview(null);
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setChecking(false);
    }
  }

  const alreadySent = info.sends.filter((s) => s.state === 'sent');

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700"
        >
          {open ? 'Hide the update' : 'Send an update'}
        </button>
        {/* What has already gone out about this job, so nobody sends the same
            news twice from two different screens. */}
        {alreadySent.length > 0 && (
          <span className="text-[11px] text-ink-400">
            {alreadySent.length} update{alreadySent.length === 1 ? '' : 's'} sent · last{' '}
            {ago(alreadySent[0].at)}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            {info.recipients.map((r) => (
              <button
                key={r.email}
                onClick={() => setTo(r.email)}
                aria-pressed={to === r.email}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  to === r.email ? 'bg-brand-600 text-ink-900' : 'glass-card text-ink-600'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="who it goes to"
            className="w-full rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
          <textarea
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg glass-field px-3 py-2 text-xs leading-relaxed text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />

          <p className="text-[11px] text-ink-400">
            Your postal address and a working unsubscribe link are added automatically. Both are
            required by law on a message like this.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void check()}
              disabled={checking || !to}
              className="flex items-center gap-1.5 rounded-lg glass-card px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:text-ink-900 disabled:opacity-50"
            >
              {checking && <SpinnerIcon className="animate-spin" width={12} height={12} />}
              Check it first
            </button>
            {/* Deliberately only reachable after a check: the preview runs the
                same screening the send does, so an unsubscribe is known before
                the button is pressed rather than after. */}
            {preview && preview.wouldSend > 0 && (
              <button
                onClick={() => void send()}
                disabled={checking}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-brand-700 disabled:opacity-50"
              >
                Send it
              </button>
            )}
          </div>

          {preview && (
            <div className="rounded-lg border border-line px-3 py-2 text-[11px]">
              {preview.wouldSend > 0 ? (
                <p className="text-success-600">Clear to send to {to}.</p>
              ) : (
                <p className="text-caution-600">
                  Will not send —{' '}
                  {preview.blocked[0]?.reason.replace(/_/g, ' ') ?? 'blocked'}
                  {preview.blocked[0]?.reason === 'unsubscribed' && '. Worth a phone call instead.'}
                </p>
              )}
              {preview.warnings?.map((w) => (
                <p key={w} className="mt-1 text-caution-600">
                  {w}
                </p>
              ))}
            </div>
          )}

          {result && <p className="text-[11px] text-ink-700">{result}</p>}
        </div>
      )}
    </div>
  );
}
