import { useEffect, useState, type FormEvent } from 'react';
import { AppShell, EmptyState, PageHeader } from '../components/AppShell';
import {
  api,
  type SharedJobSummary,
  type SharedJobRecord,
  type JobScopeItem,
  type ScopeState,
} from '../lib/api';
import { SpinnerIcon } from '../components/icons';
import { ProofOfWork } from '../components/shared/ProofOfWork';

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

const LEVEL_STYLE = {
  blocker: 'border-danger-200 bg-danger-50 text-danger-600',
  warn: 'border-caution-200 bg-caution-50 text-caution-600',
  note: 'border-line text-ink-600',
} as const;

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

export function SharedDashboardPage() {
  const [list, setList] = useState<SharedJobSummary[] | null>(null);
  const [counts, setCounts] = useState({ jobs: 0, parties: 0, blockers: 0, awaiting: 0 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [record, setRecord] = useState<SharedJobRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadList() {
    try {
      const res = await api.sharedJobs();
      setList(res.jobs);
      setCounts(res.counts);
      if (!openId && res.jobs.length) void openJob(res.jobs[0].jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the shared records.');
      setList([]);
    }
  }

  async function openJob(jobId: string) {
    setOpenId(jobId);
    setLoading(true);
    try {
      setRecord(await api.sharedJob(jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that record.');
      setRecord(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operations Platform"
        title="Shared dashboard"
        description="One record per job, shared with the subs on it. What to do, what not to do, and every decision in writing — so nothing gets built on somebody's memory of a phone call."
      />

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger-600">
          {error}
        </p>
      )}

      {list === null ? (
        <p className="mt-6 text-sm text-ink-600">Loading…</p>
      ) : list.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No shared records yet"
            hint="Start one on a job with subs on it. Publish the facts, write down what is out of scope, and send each sub their link."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Shared jobs', value: counts.jobs, tone: '' },
              { label: 'Companies on them', value: counts.parties, tone: '' },
              { label: 'Working from old facts', value: counts.blockers, tone: 'danger' },
              { label: 'Waiting on you', value: counts.awaiting, tone: 'caution' },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl glass-card px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {tile.label}
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    tile.value > 0 && tile.tone === 'danger'
                      ? 'text-danger-600'
                      : tile.value > 0 && tile.tone === 'caution'
                        ? 'text-caution-600'
                        : 'text-ink-900'
                  }`}
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
            {/* The jobs, worst first. This page is checked, not browsed. */}
            <ul className="rounded-xl glass-card lg:sticky lg:top-6">
              {list.map((job) => {
                const on = openId === job.jobId;
                const trouble = job.behind + job.awaiting;
                return (
                  <li key={job.jobId} className="border-b border-line last:border-b-0">
                    <button
                      onClick={() => void openJob(job.jobId)}
                      aria-pressed={on}
                      className={`block w-full px-4 py-3 text-left transition ${
                        on ? 'bg-brand-600/10' : 'hover:bg-paper-200/40'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={`text-sm font-semibold ${on ? 'text-brand-600' : 'text-ink-900'}`}
                        >
                          {job.jobNumber !== null && (
                            <span className="tabular-nums text-ink-500">#{job.jobNumber} </span>
                          )}
                          {job.title}
                        </span>
                        {trouble > 0 && (
                          <span className="shrink-0 rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-semibold text-danger-600">
                            {trouble}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-500">
                        {job.parties} compan{job.parties === 1 ? 'y' : 'ies'}
                        {job.currentRevision !== null && ` · rev ${job.currentRevision}`}
                        {job.exclusions > 0 && ` · ${job.exclusions} exclusion${job.exclusions === 1 ? '' : 's'}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-4">
              {loading && !record ? (
                <p className="text-sm text-ink-600">Opening…</p>
              ) : !record ? (
                <p className="text-sm text-ink-600">Pick a job.</p>
              ) : (
                <>
                  {/* What is wrong, before anything else on the page. */}
                  {record.risks.length > 0 && (
                    <ul className="space-y-2">
                      {record.risks.map((risk) => (
                        <li
                          key={risk.key}
                          className={`rounded-lg border px-4 py-2.5 ${LEVEL_STYLE[risk.level]}`}
                        >
                          <p className="text-sm font-semibold">{risk.title}</p>
                          <p className="mt-0.5 text-xs opacity-90">{risk.action}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <SharedFacts record={record} onPublished={() => void openJob(record.job.id)} />

                  <PartyList
                    record={record}
                    onChanged={() => {
                      void openJob(record.job.id);
                      void loadList();
                    }}
                  />

                  <ScopeList record={record} onDecide={decide} onChanged={() => void openJob(record.job.id)} />

                  {/* Below the scope, because proof only means anything once
                      there is an agreed scope to be proof of. */}
                  <ProofOfWork jobId={record.job.id} />

                  <Thread record={record} onPosted={() => void openJob(record.job.id)} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
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
          <input
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="Trade"
            className="w-32 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
          />
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
