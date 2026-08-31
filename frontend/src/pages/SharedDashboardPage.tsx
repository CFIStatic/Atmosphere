import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/AppShell';
import {
  api,
  type SharedJobSummary,
  type SharedJobRecord,
  type JobScopeItem,
  type ScopeState,
  type IntakeCaptureInvite,
} from '../lib/api';
import { JobFileAskChrome } from '../components/JobFileAskChrome';
import { ChevronLeftIcon, SpinnerIcon } from '../components/icons';
import { JobProgressDashboard } from '../components/shared/JobProgressDashboard';
import { ShareJobProgressPanel } from '../components/shared/ShareJobProgressPanel';
import { ScopeDocPanel } from '../components/shared/ScopeDocPanel';
import { JobReadinessPanel } from '../components/shared/JobReadinessPanel';
import { JobLegalHoldPortal } from '../components/shared/JobLegalHoldPortal';
import { EvidenceLocker } from '../components/shared/EvidenceLocker';
import { ProofOfWork } from '../components/shared/ProofOfWork';
import { JobFileActions } from '../components/shared/JobFileActions';
import { JOB_PARTY_TRADE_OPTIONS } from '../components/setup/verifierSetupOptions';
import { jobFilePath } from '../lib/jobFileAsk';
import { useFeatureTimer } from '../hooks/useFeatureTimer';

type HandoffState = {
  freshJob?: SharedJobSummary;
  freshRecord?: SharedJobRecord;
  freshInvites?: IntakeCaptureInvite[];
  justApproved?: boolean;
};

/**
 * One job, two companies, one record.
 *
 * A general contractor hires subs, and the money is lost in a narrow set of
 * places that are all the same failure underneath — the two sides were working
 * from different facts. "Who told you to demo that wall." "The super said it
 * was fine." "I was working off the old scope." Everything was said out loud,
 * on a phone, in a truck, and nothing survived it.
 *
 * So this is not a chat feature with a job attached. It is a record, with a
 * conversation attached, and three things carry the weight:
 *
 *   What NOT to do comes first. A scope list that only says what to do leaves
 *   "and nothing else" to be inferred, and it never is. Exclusions are rows
 *   with reasons, at the top of the screen, because whoever is reading this is
 *   reading it on a phone and the top of the screen is where they stop.
 *
 *   Acceptance is versioned. Publishing new facts lapses everybody's
 *   acceptance rather than carrying it silently forward, and the page says who
 *   that just affected — quietly invalidating four subs' sign-off is a thing
 *   somebody should be told they are doing.
 *
 *   Decisions happen before the work. A request sitting unanswered for a day
 *   is a blocker, not a to-do, because at that point the crew either goes home
 *   or does it anyway, and doing it anyway is the whole thing being prevented.
 */

const STATE_STYLE: Record<ScopeState, string> = {
  excluded: 'bg-danger-50 text-danger-600',
  proposed: 'bg-caution-50 text-caution-600',
  included: 'bg-paper-200/60 text-ink-700',
  approved: 'bg-success-50 text-success-600',
  declined: 'bg-paper-200/60 text-ink-500',
};

const STATE_WORD: Record<ScopeState, string> = {
  excluded: 'DO NOT',
  proposed: 'asked',
  included: 'in scope',
  approved: 'approved',
  declined: 'declined',
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? null
    : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'never';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function placeholderRecord(jobId: string, title: string, jobNumber: number | null = null): SharedJobRecord {
  return {
    job: { id: jobId, jobNumber, title, status: null, claimNumber: null },
    brief: null,
    revisions: [],
    currentRevision: null,
    parties: [],
    scope: [],
    money: { approved: 0, pending: 0, unpricedApprovals: 0 },
    messages: [],
    risks: [],
  };
}

export function SharedDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedJob = searchParams.get('job');
  const requestedTitle = searchParams.get('title');
  const requestedNumber = searchParams.get('number');
  const parsedNumber = requestedNumber != null && requestedNumber !== '' ? Number(requestedNumber) : null;
  const jobNumberHint = Number.isFinite(parsedNumber) ? parsedNumber : null;
  const handoff = (location.state as HandoffState | null) ?? null;
  const freshFromNav = handoff?.freshJob;
  const freshRecord = handoff?.freshRecord;
  const [justApproved, setJustApproved] = useState(Boolean(handoff?.justApproved));
  const [freshInvites, setFreshInvites] = useState<IntakeCaptureInvite[]>(
    () => handoff?.freshInvites ?? [],
  );
  useFeatureTimer('job_files');
  const openSeq = useRef(0);
  const recordIdRef = useRef<string | null>(freshRecord?.job.id ?? requestedJob ?? null);
  const seededId = requestedJob || freshFromNav?.jobId || freshRecord?.job.id || null;

  const [list, setList] = useState<SharedJobSummary[] | null>(() =>
    freshFromNav ? [freshFromNav] : null,
  );
  const [openId, setOpenId] = useState<string | null>(seededId);
  const [record, setRecord] = useState<SharedJobRecord | null>(() =>
    freshRecord ??
    (requestedJob
      ? placeholderRecord(requestedJob, requestedTitle || 'Job', jobNumberHint)
      : null),
  );
  const [error, setError] = useState<string | null>(null);
  const [readinessKey, setReadinessKey] = useState(0);
  const [shareFormOpen, setShareFormOpen] = useState(false);

  const stayOnRecord = Boolean(requestedJob || freshFromNav || freshRecord);

  useEffect(() => {
    recordIdRef.current = record?.job.id ?? null;
  }, [record]);

  useEffect(() => {
    if (!stayOnRecord) navigate('/verifier-library', { replace: true });
  }, [stayOnRecord, navigate]);

  function openShare() {
    setShareFormOpen(true);
  }

  function ensureListed(summary: SharedJobSummary) {
    setList((prev) => {
      const base = prev ?? [];
      if (base.some((j) => j.jobId === summary.jobId)) return base;
      return [summary, ...base];
    });
  }

  async function openJob(jobId: string, opts?: { syncUrl?: boolean }) {
    const seq = ++openSeq.current;
    setOpenId(jobId);
    setShareFormOpen(false);
    if (opts?.syncUrl !== false) {
      // Preserve intake handoff state — setSearchParams drops it otherwise.
      const next: Record<string, string> = jobId ? { job: jobId } : {};
      if (requestedTitle) next.title = requestedTitle;
      if (requestedNumber) next.number = requestedNumber;
      setSearchParams(next, {
        replace: true,
        state: location.state,
      });
    }
    setError(null);
    try {
      const next = await api.sharedJob(jobId);
      if (seq !== openSeq.current) return;
      setRecord(next);
      ensureListed({
        jobId,
        jobNumber: next.job.jobNumber ?? null,
        title: next.job.title,
        status: next.job.status ?? null,
        parties: next.parties?.length ?? 0,
        currentRevision: next.brief?.revision ?? next.currentRevision ?? null,
        behind: 0,
        awaiting: 0,
        exclusions: 0,
      });
    } catch (err) {
      if (seq !== openSeq.current) return;
      // Never wipe a just-created job file on a flaky GET — keep the handoff.
      if (recordIdRef.current === jobId) {
        // keep painted record; soft-fail
      } else {
        const listed = (list ?? []).find((j) => j.jobId === jobId);
        setRecord(
          placeholderRecord(
            jobId,
            listed?.title || requestedTitle || 'Job',
            listed?.jobNumber ?? jobNumberHint,
          ),
        );
        setError(null);
      }
    }
  }

  async function loadList() {
    try {
      const res = await api.sharedJobs();
      setList((prev) => {
        const incoming = res.jobs;
        if (!prev?.length) return incoming;
        // Keep a freshly opened intake job if the list query briefly omits it.
        const extras = prev.filter((j) => !incoming.some((i) => i.jobId === j.jobId));
        return extras.length ? [...extras, ...incoming] : incoming;
      });
      const preferred =
        requestedJob ||
        freshFromNav?.jobId ||
        freshRecord?.job.id ||
        (openId && res.jobs.some((j) => j.jobId === openId) && openId) ||
        res.jobs[0]?.jobId ||
        null;
      if (preferred) {
        // Refresh detail in background; syncUrl only when deep-linked.
        void openJob(preferred, {
          syncUrl: Boolean(requestedJob || freshFromNav || freshRecord),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the shared records.');
      setList((prev) => prev ?? []);
      const fallback = requestedJob || freshFromNav?.jobId || freshRecord?.job.id;
      if (fallback) void openJob(fallback, { syncUrl: Boolean(requestedJob) });
    }
  }

  useEffect(() => {
    if (!stayOnRecord) return;
    if (freshFromNav) ensureListed(freshFromNav);
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link from Dashboard job name or Approve & invite: /job-progress?job=<id>
  // When intake already seeded the file, loadList's refresh is enough — a
  // second openJob here raced and could leave the dashboard stuck on Loading.
  useEffect(() => {
    if (!requestedJob) return;
    if (freshFromNav?.jobId === requestedJob) ensureListed(freshFromNav);
    if (recordIdRef.current === requestedJob || freshRecord?.job.id === requestedJob) return;
    void openJob(requestedJob, { syncUrl: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedJob]);

  async function decide(item: JobScopeItem, decision: 'approved' | 'declined') {
    if (!record) return;
    const amount =
      decision === 'approved'
        ? Number(window.prompt(`Approve "${item.title}" for how much?`, String(item.amount ?? '')) ?? '')
        : null;
    if (decision === 'approved' && (!Number.isFinite(amount) || amount === null)) return;
    try {
      await api.decideJobScope(record.job.id, item.id, { decision, amount });
      await openJob(record.job.id);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that decision.');
    }
  }

  if (!stayOnRecord) return null;

  const jobId = record?.job.id ?? requestedJob ?? '';
  const back = (
    <button
      type="button"
      onClick={() => navigate('/field')}
      className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition hover:text-ink-800 lg:mb-4"
    >
      <ChevronLeftIcon width={16} height={16} />
      Overview
    </button>
  );

  const fileBody = (
    <>
      <PageHeader
        title={record?.job.title ?? 'Job'}
        description="What is happening on site, what has already been done, and what is still ahead."
        action={
          record ? (
            <JobFileActions
              jobId={record.job.id}
              title={record.job.title}
              onShare={openShare}
              onRenamed={(nextTitle) => {
                setRecord((prev) =>
                  prev ? { ...prev, job: { ...prev.job, title: nextTitle } } : prev,
                );
                setList((prev) =>
                  (prev ?? []).map((job) =>
                    job.jobId === record.job.id ? { ...job, title: nextTitle } : job,
                  ),
                );
                if (requestedJob === record.job.id) {
                  const next: Record<string, string> = { job: record.job.id, title: nextTitle };
                  if (requestedNumber) next.number = requestedNumber;
                  setSearchParams(next, { replace: true, state: location.state });
                }
              }}
              onDuplicated={({ jobId: nextId, title: nextTitle, summary }) => {
                ensureListed(summary);
                navigate(jobFilePath(nextId, { title: nextTitle }), {
                  state: { freshJob: summary },
                });
              }}
            />
          ) : undefined
        }
      />

      {justApproved && record && (
        <div
          role="status"
          className="mt-4 space-y-3 rounded-xl border border-success-200 bg-success-50/70 px-4 py-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-success-700">Job created</p>
              <p className="mt-0.5 text-sm text-ink-700">
                <span className="font-medium text-ink-900">{record.job.title}</span> is ready
                {freshInvites.length
                  ? freshInvites.every((i) => i.emailed || !i.email)
                    ? ' — Field Capture invites went out.'
                    : ' — some invites could not be emailed.'
                  : '.'}{' '}
                Footage will land on the Dashboard as they film.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-sm font-medium text-ink-500 hover:text-ink-800"
              onClick={() => {
                setJustApproved(false);
                setFreshInvites([]);
              }}
            >
              Dismiss
            </button>
          </div>
          {freshInvites.length > 0 && (
            <ul className="space-y-2 border-t border-success-200/70 pt-3">
              {freshInvites.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper-0/70 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900">{inv.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {inv.email ?? 'No email on file'}
                      {' · '}
                      {inv.emailed
                        ? 'Emailed'
                        : inv.email
                          ? 'Email did not send'
                          : 'Invite created'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {record ? (
        <>
          <div className="mt-4">
            <JobProgressDashboard
              jobId={record.job.id}
              record={record}
              showProofOfWork={false}
              initialProof={
                justApproved
                  ? {
                      days: [],
                      videos: [],
                      counts: { days: 0, videos: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
                      siteKnown: Boolean(record.brief?.facts?.['Site address']),
                    }
                  : undefined
              }
            />

            <div className="mt-4 space-y-4">
              <ProofOfWork jobId={record.job.id} heading="Videos and analysis" />
              <JobLegalHoldPortal jobId={record.job.id} jobTitle={record.job.title} />
              <EvidenceLocker jobId={record.job.id} />
            </div>

                <details className="mt-4 rounded-xl glass-card group">
                  <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-ink-900 marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-2">
                      Job setup — scope, crew &amp; documents
                      <span className="text-xs font-normal text-ink-500 group-open:hidden">Show</span>
                      <span className="hidden text-xs font-normal text-ink-500 group-open:inline">Hide</span>
                    </span>
                  </summary>
                  <div className="space-y-4 border-t border-line px-5 pb-5 pt-4">
                    <SharedFacts record={record} onPublished={() => void openJob(record.job.id)} />
                    <PartyList
                      record={record}
                      onChanged={() => {
                        void openJob(record.job.id);
                        void loadList();
                      }}
                    />
                    <JobReadinessPanel jobId={record.job.id} refreshKey={readinessKey} />
                    <ScopeDocPanel
                      jobId={record.job.id}
                      onChanged={() => {
                        void openJob(record.job.id);
                        setReadinessKey((k) => k + 1);
                      }}
                    />
                    <ScopeList record={record} onDecide={decide} onChanged={() => void openJob(record.job.id)} />
                    <Thread record={record} onPosted={() => void openJob(record.job.id)} />
                  </div>
                </details>
          </div>

        </>
      ) : (
        <p className="mt-6 text-sm text-ink-600">Loading…</p>
      )}
    </>
  );

  return (
    <JobFileAskChrome
      jobId={jobId}
      back={back}
      extra={
        shareFormOpen && record ? (
          <ShareJobProgressPanel
            jobId={record.job.id}
            creating
            modal
            onClose={() => setShareFormOpen(false)}
            onCreatingChange={setShareFormOpen}
          />
        ) : null
      }
    >
      {fileBody}
    </JobFileAskChrome>
  );
}

/**
 * The facts, and the act of changing them.
 *
 * Publishing is not an edit — it is a new revision that lapses everybody's
 * acceptance. The button says so before it is pressed, because the cost of
 * that action lands on other people.
 */
function SharedFacts({ record, onPublished }: { record: SharedJobRecord; onPublished: () => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [facts, setFacts] = useState(() =>
    Object.entries(record.brief?.facts ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
  );
  const [busy, setBusy] = useState(false);

  const affected = record.parties.filter((p) => !p.revoked_at).length;

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const parsed: Record<string, string> = {};
      for (const line of facts.split('\n')) {
        const at = line.indexOf(':');
        if (at < 1) continue;
        parsed[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
      await api.publishJobBrief(record.job.id, { facts: parsed, note: note || null });
      setEditing(false);
      setNote('');
      onPublished();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">
          Job facts
          {record.currentRevision !== null && (
            <span className="ml-2 text-xs font-normal text-ink-500">revision {record.currentRevision}</span>
          )}
        </h2>
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          {editing ? 'Cancel' : 'Publish a change'}
        </button>
      </div>

      {!editing ? (
        record.brief ? (
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {Object.entries(record.brief.facts ?? {}).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3 text-xs">
                <dt className="text-ink-500">{key}</dt>
                <dd className="text-right font-medium text-ink-800">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-ink-600">
            Nothing published yet. Until there is a revision, nobody can accept anything.
          </p>
        )
      ) : (
        <form onSubmit={publish} className="mt-3 space-y-2">
          <textarea
            rows={7}
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            placeholder={'Site address: 1408 Meridian Ave\nGate code: 4412\nPermit: BP-2026-8841'}
            className="w-full rounded-lg glass-field px-3 py-2 text-xs leading-relaxed text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed, in one line"
            className="w-full rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
          {/* Said before the button, not after. */}
          <p className="text-[11px] text-caution-600">
            Publishing lapses acceptance for {affected} compan{affected === 1 ? 'y' : 'ies'}. They
            will show as working from old facts until they accept the new revision.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
          >
            {busy && <SpinnerIcon className="animate-spin" width={12} height={12} />}
            Publish revision {(record.currentRevision ?? 0) + 1}
          </button>
        </form>
      )}
    </section>
  );
}

/** Who is on the job, whether they have accepted, and their link. */
function PartyList({ record, onChanged }: { record: SharedJobRecord; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState('');
  const [trade, setTrade] = useState('');
  const [token, setToken] = useState<{ company: string; token: string } | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    const res = await api.addJobParty(record.job.id, { company, trade: trade || null });
    // Shown once, here. It is the credential — there is nowhere else it can be
    // read from later, and that is the point.
    if (res.party.accessToken) setToken({ company, token: res.party.accessToken });
    setCompany('');
    setTrade('');
    setAdding(false);
    onChanged();
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Who is on this job</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          {adding ? 'Cancel' : 'Add a company'}
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
          <input
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            className="min-w-[10rem] flex-1 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
          <select
            required
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            className="min-w-[10rem] rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="" disabled>
              Trade
            </option>
            {JOB_PARTY_TRADE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900"
          >
            Add
          </button>
        </form>
      )}

      {token && (
        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs font-semibold text-brand-700">Link for {token.company}</p>
          <code className="mt-1 block break-all text-[11px] text-ink-700">
            /shared/{token.token}
          </code>
          <p className="mt-1 text-[11px] text-ink-500">
            Copy it now — it is not shown again. Anyone with it can read this job and accept the
            scope, so send it to the person, not to a group inbox.
          </p>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {record.parties.map((party) => (
          <li
            key={party.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-800">
                {party.company}
                {party.trade && <span className="ml-1.5 text-xs text-ink-500">{party.trade}</span>}
              </p>
              <p className="text-[11px] text-ink-500">{party.because}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* The two things a general contractor actually needs and could
                  not do: look at what the sub is looking at, and send the link
                  again when the first text never arrived. Without the second,
                  people add the company twice and split its acceptance and
                  proof history across two rows. */}
              {!party.revoked_at && (
                <PartyLink jobId={record.job.id} partyId={party.id} company={party.company} />
              )}
              <span className="text-[11px] text-ink-400">
                {party.last_seen_at ? `seen ${ago(party.last_seen_at)}` : 'never opened'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                  party.revoked_at
                    ? 'bg-paper-200/60 text-ink-500'
                    : party.clear
                      ? 'bg-success-50 text-success-600'
                      : 'bg-danger-50 text-danger-600'
                }`}
              >
                {party.revoked_at ? 'revoked' : party.clear ? 'clear to work' : 'not clear'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Scope, exclusions at the top. */
function ScopeList({
  record,
  onDecide,
  onChanged,
}: {
  record: SharedJobRecord;
  onDecide: (item: JobScopeItem, decision: 'approved' | 'declined') => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<ScopeState>('excluded');
  const [reason, setReason] = useState('');

  const rank: Record<ScopeState, number> = {
    excluded: 0,
    proposed: 1,
    included: 2,
    approved: 3,
    declined: 4,
  };
  const ordered = [...record.scope].sort(
    (a, b) => rank[a.state] - rank[b.state] || a.created_at.localeCompare(b.created_at),
  );

  async function add(event: FormEvent) {
    event.preventDefault();
    await api.addJobScope(record.job.id, {
      title,
      state,
      reason: reason || null,
    });
    setTitle('');
    setReason('');
    setAdding(false);
    onChanged();
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Scope</h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-ink-500">
            {money(record.money.approved)} approved
            {record.money.pending > 0 && ` · ${money(record.money.pending)} asked for`}
          </span>
          <button
            onClick={() => setAdding((v) => !v)}
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            {adding ? 'Cancel' : 'Add a line'}
          </button>
        </div>
      </div>

      {adding && (
        <form onSubmit={add} className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {(['excluded', 'included'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setState(s)}
                aria-pressed={state === s}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  state === s ? STATE_STYLE[s] : 'glass-card text-ink-600'
                }`}
              >
                {STATE_WORD[s]}
              </button>
            ))}
          </div>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={state === 'excluded' ? 'What must nobody touch?' : 'What is to be done?'}
            className="w-full rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
          {state === 'excluded' && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why — e.g. the owner is handling flooring themselves"
              className="w-full rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
          )}
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900"
          >
            Add
          </button>
        </form>
      )}

      {ordered.length === 0 ? (
        <p className="mt-3 text-sm text-ink-600">
          Nothing written down yet. Start with what nobody should touch — that is the line that
          costs money when it is only in somebody's head.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {ordered.map((item) => (
            <li key={item.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink-800">{item.title}</p>
                  {item.reason && <p className="text-[11px] text-ink-500">{item.reason}</p>}
                  {item.detail && <p className="mt-0.5 text-[11px] text-ink-600">{item.detail}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.amount !== null && (
                    <span className="text-xs tabular-nums text-ink-700">{money(item.amount)}</span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATE_STYLE[item.state]}`}
                  >
                    {STATE_WORD[item.state]}
                  </span>
                </div>
              </div>

              {item.state === 'proposed' && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => onDecide(item, 'approved')}
                    className="rounded-lg bg-success-600 px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    Approve with a number
                  </button>
                  <button
                    onClick={() => onDecide(item, 'declined')}
                    className="rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700"
                  >
                    Decline
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The thread. Append-only, which is why it settles arguments. */
function Thread({ record, onPosted }: { record: SharedJobRecord; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.postJobMessage(record.job.id, { body });
      setBody('');
      onPosted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <h2 className="text-base font-semibold text-ink-900">On the record</h2>
      <p className="mt-1 text-xs text-ink-500">
        Nothing here can be edited or deleted. Corrections are new messages — which is how a paper
        file works, and how every argument about one gets settled.
      </p>

      <form onSubmit={post} className="mt-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Say it here instead of on the phone"
          className="min-w-0 flex-1 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
        >
          Post
        </button>
      </form>

      {record.messages.length === 0 ? (
        <p className="mt-3 text-xs text-ink-500">Nothing yet.</p>
      ) : (
        <ol className="mt-3 max-h-[24rem] space-y-2.5 overflow-y-auto pr-1">
          {record.messages.map((message) => (
            <li key={message.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-ink-800">{message.author_label}</span>
                <span className="text-[11px] text-ink-400">{ago(message.created_at)}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-700">{message.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}


/**
 * Open, or copy, a company's link.
 *
 * "Open their view" is the honest label: this is not a preview mode, it is the
 * subcontractor's actual screen behind their actual token. Anything else would
 * let a general contractor sign off a scope on the sub's behalf without meaning
 * to, and an acceptance nobody made is worse than none.
 */
function PartyLink({
  jobId,
  partyId,
  company,
}: {
  jobId: string;
  partyId: string;
  company: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function go(open: boolean) {
    setBusy(true);
    try {
      const { path } = await api.jobPartyLink(jobId, partyId);
      if (open) {
        navigate(path);
        return;
      }
      const full = `${window.location.origin}${path}`;
      await navigator.clipboard?.writeText(full).catch(() => {
        // Clipboard is refused on insecure origins and in some embedded
        // frames. Showing the link beats failing silently.
        window.prompt(`Link for ${company}`, full);
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      <button
        onClick={() => void go(true)}
        disabled={busy}
        className="rounded-full glass-card px-2 py-0.5 text-[10.5px] font-medium text-ink-600 hover:text-ink-900 disabled:opacity-50"
      >
        Open their view
      </button>
      <button
        onClick={() => void go(false)}
        disabled={busy}
        className="rounded-full glass-card px-2 py-0.5 text-[10.5px] font-medium text-ink-600 hover:text-ink-900 disabled:opacity-50"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </span>
  );
}
