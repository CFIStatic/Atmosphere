import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SpinnerIcon } from '../components/icons';
import { readCapture, todayISO } from '../lib/proofCapture';

/**
 * The subcontractor's screen.
 *
 * Opened from a link in a text message, on a phone, standing in a doorway at
 * the end of a long day. That is the entire design brief and it rules out most
 * of what a web app normally does: no sign-in, no navigation, no settings. One
 * page, three things on it, and the first thing visible is what they must not
 * touch.
 *
 * Ordering is the design. A sub reads the top of the screen and starts working,
 * so the top of the screen is the exclusions — then anything waiting on an
 * answer, then the ordinary scope. Filming comes last because it is the thing
 * they came here to do and will scroll to find; the scope is the thing they
 * would not have read otherwise.
 *
 * Nothing here can be edited afterwards. Accepting a revision, filing a video,
 * asking a question — each is an entry in a record, which is the point of the
 * whole feature and worth the cost of not being able to take it back.
 */

const API = '/api/job-share';

interface ScopeItem {
  id: string;
  state: 'included' | 'excluded' | 'proposed' | 'approved' | 'declined';
  title: string;
  detail: string | null;
  amount: number | null;
  reason: string | null;
}

interface ShareView {
  you: { company: string; trade: string | null; role: string };
  job: { jobNumber: number | null; title: string; claimNumber: string | null; scheduledStart: string | null };
  brief: { revision: number; facts: Record<string, string>; note: string | null } | null;
  currentRevision: number | null;
  acknowledgedRevision: number | null;
  clear: boolean;
  because: string;
  scope: ScopeItem[];
  messages: Array<{ id: string; author_label: string; body: string; created_at: string }>;
}

interface ProofDay {
  workDate: string;
  hasBefore: boolean;
  hasAfter: boolean;
  summary: string;
  problems: string[];
  accepted: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? 'Something went wrong.');
  return body as T;
}

const STATE_STYLE: Record<string, string> = {
  excluded: 'border-danger-200 bg-danger-50',
  proposed: 'border-caution-200 bg-caution-50',
  included: 'border-line',
  approved: 'border-success-200 bg-success-50',
  declined: 'border-line opacity-60',
};

export function JobSharePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<ShareView | null>(null);
  const [days, setDays] = useState<ProofDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [extra, setExtra] = useState('');

  const load = useCallback(async () => {
    try {
      const [record, proofs] = await Promise.all([
        call<ShareView>(`${API}/${token}`),
        call<{ days: ProofDay[] }>(`${API}/${token}/proof`).catch(() => ({ days: [] as ProofDay[] })),
      ]);
      setView(record);
      setDays(proofs.days);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This link is not valid.');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    if (!view?.currentRevision || !name.trim()) return;
    setBusy('accept');
    try {
      await call(`${API}/${token}/accept`, {
        method: 'POST',
        body: JSON.stringify({ name, revision: view.currentRevision }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    } finally {
      setBusy(null);
    }
  }

  async function ask() {
    if (!question.trim()) return;
    setBusy('ask');
    try {
      await call(`${API}/${token}/ask`, {
        method: 'POST',
        body: JSON.stringify({
          body: question,
          asScopeItem: extra.trim() || undefined,
        }),
      });
      setQuestion('');
      setExtra('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setBusy(null);
    }
  }

  const today = todayISO();
  const todaysDay = days.find((d) => d.workDate === today);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-paper-100 px-4 pb-16 pt-6">
      <header>
        {/* Only when somebody arrived from the console. A subcontractor
            following a link from a text message has nothing to go back to, and
            a dead back button on their screen is a support call. */}
        {window.history.length > 1 && (
          <button
            onClick={() => navigate(-1)}
            className="mb-3 text-xs font-medium text-ink-500 hover:text-ink-800"
          >
            ← Back to the dashboard
          </button>
        )}
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Job record</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900">
          {view?.job.title ?? 'Loading…'}
        </h1>
        {view && (
          <p className="mt-1 text-sm text-ink-600">
            {view.you.company}
            {view.you.trade ? ` · ${view.you.trade}` : ''}
            {view.job.jobNumber !== null ? ` · job #${view.job.jobNumber}` : ''}
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {view && (
        <>
          {/* Where they stand, in one sentence, before anything else. */}
          <section
            className={`mt-4 rounded-xl border px-4 py-3 ${
              view.clear ? 'border-success-200 bg-success-50' : 'border-caution-200 bg-caution-50'
            }`}
          >
            <p className={`text-sm font-semibold ${view.clear ? 'text-success-600' : 'text-caution-600'}`}>
              {view.clear ? 'You are clear to work' : 'Not clear to work yet'}
            </p>
            <p className="mt-0.5 text-xs text-ink-700">{view.because}</p>

            {view.currentRevision !== null && view.acknowledgedRevision !== view.currentRevision && (
              <div className="mt-3">
                <p className="text-xs text-ink-700">
                  Read the scope below, then put your name to it. This records that you have seen
                  revision {view.currentRevision}.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-paper-0 px-3 py-2 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <button
                    onClick={() => void accept()}
                    disabled={busy === 'accept' || !name.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 disabled:opacity-50"
                  >
                    {busy === 'accept' && <SpinnerIcon className="animate-spin" width={13} height={13} />}
                    Accept
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Exclusions first, always. Somebody reading this on a phone reads
              the top of the screen and starts working. */}
          <section className="mt-5">
            <h2 className="text-base font-semibold text-ink-900">What to do — and not do</h2>
            <ul className="mt-2 space-y-2">
              {view.scope.map((item) => (
                <li key={item.id} className={`rounded-lg border px-3 py-2.5 ${STATE_STYLE[item.state]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-ink-900">
                      {item.state === 'excluded' && (
                        <span className="mr-1.5 font-bold text-danger-600">DO NOT</span>
                      )}
                      {item.title}
                    </p>
                    {item.amount !== null && (
                      <span className="shrink-0 text-xs tabular-nums text-ink-700">
                        ${item.amount.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {item.reason && <p className="mt-0.5 text-xs text-ink-600">{item.reason}</p>}
                  {item.detail && <p className="mt-0.5 text-xs text-ink-600">{item.detail}</p>}
                  {item.state === 'proposed' && (
                    <p className="mt-1 text-xs font-medium text-caution-600">
                      Asked — do not start this until it comes back approved.
                    </p>
                  )}
                </li>
              ))}
              {view.scope.length === 0 && (
                <li className="rounded-lg border border-line px-3 py-2.5 text-sm text-ink-600">
                  Nothing written down yet. Ask below before you start anything.
                </li>
              )}
            </ul>
          </section>

          {view.brief && (
            <section className="mt-5 rounded-xl border border-line bg-paper-0 p-4">
              <h2 className="text-base font-semibold text-ink-900">Site facts</h2>
              <dl className="mt-2 space-y-1">
                {Object.entries(view.brief.facts ?? {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 text-xs">
                    <dt className="shrink-0 text-ink-500">{key}</dt>
                    <dd className="text-right text-ink-800">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <ProofSection
            token={token}
            today={today}
            todaysDay={todaysDay}
            days={days}
            onDone={load}
          />

          {/* Asking, which is the whole point of having this in their hand.
              Ten seconds to raise it beats a phone call nobody answers. */}
          <section className="mt-5 rounded-xl border border-line bg-paper-0 p-4">
            <h2 className="text-base font-semibold text-ink-900">Ask before you do it</h2>
            <p className="mt-0.5 text-xs text-ink-600">
              Anything you are unsure about, or extra work you have found. It goes on the record and
              the office sees it straight away.
            </p>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Found rot under the north valley — six sheets. Photos to follow."
              className="mt-2 w-full rounded-lg border border-line bg-paper-100 px-3 py-2 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="If it is extra work, name it here — e.g. Replace 6 sheets of decking"
              className="mt-2 w-full rounded-lg border border-line bg-paper-100 px-3 py-2 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button
              onClick={() => void ask()}
              disabled={busy === 'ask' || !question.trim()}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 disabled:opacity-50"
            >
              {busy === 'ask' && <SpinnerIcon className="animate-spin" width={13} height={13} />}
              Send it
            </button>
          </section>

          {view.messages.length > 0 && (
            <section className="mt-5">
              <h2 className="text-base font-semibold text-ink-900">On the record</h2>
              <ol className="mt-2 space-y-2">
                {view.messages.slice(0, 20).map((message) => (
                  <li key={message.id} className="rounded-lg border border-line bg-paper-0 px-3 py-2">
                    <p className="text-xs font-medium text-ink-700">{message.author_label}</p>
                    <p className="mt-0.5 text-sm text-ink-800">{message.body}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <AtmospherePitch company={view.you.company} />
        </>
      )}
    </div>
  );
}

/**
 * The lure.
 *
 * A sub lands on this page because a GC sent them here, and everything above
 * quietly demonstrates the product: a scope that cannot be argued about, a
 * record that pays. This is the one place the page speaks for itself — after
 * the work is done, at the bottom, in the sub's own terms. Their pain is that
 * every builder runs a different system and their history resets with each
 * one; the pitch is that the record they just added to could be theirs.
 *
 * Deliberately not a banner, not a popup, and never between the crew and the
 * upload button. A lure that gets in the way of the day's work would cost the
 * GC's trust — and the GC is who brought us here.
 */
function AtmospherePitch({ company }: { company: string }) {
  return (
    <footer className="mt-8 rounded-xl border border-brand-200 bg-brand-600/5 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
        Powered by Atmosphere
      </p>
      <p className="mt-1.5 text-sm font-semibold text-ink-900">
        This record works for {company} too.
      </p>
      <p className="mt-1 text-xs text-ink-600">
        Every video you file and every scope you sign lives in a builder's account today. With your
        own Atmosphere account, your proof-of-work follows you — every job, every builder, one
        history that shows how you work. Free for subcontractors.
      </p>
      <a
        href="/login?mode=signup&src=job-share"
        className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-brand-700"
      >
        Get your own record
      </a>
    </footer>
  );
}

/**
 * Filming the day.
 *
 * The upload is three steps and the crew sees one button. Ask for somewhere to
 * put the file, put it there directly, then post what the phone knows about how
 * it was filmed. The video never touches the API — a hundred megabytes through
 * an Express route on a truck's signal is a request that times out.
 *
 * Failures are told immediately, in words that say what to do. "Filmed 2.1
 * miles from the site" at 4pm while the crew is still there is actionable;
 * the same sentence on Friday about Tuesday is an argument.
 */
function ProofSection({
  token,
  today,
  todaysDay,
  days,
  onDone,
}: {
  token: string;
  today: string;
  todaysDay: ProofDay | undefined;
  days: ProofDay[];
  onDone: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState<'before' | 'after' | null>(null);
  const [step, setStep] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [guide, setGuide] = useState<{
    phase: string;
    targetSeconds: number;
    steps: Array<{ kind: string; instruction: string; why: string }>;
  } | null>(null);
  const beforeInput = useRef<HTMLInputElement>(null);
  const afterInput = useRef<HTMLInputElement>(null);

  // The shot list for whichever half of the day comes next. Fetched fresh when
  // the phase flips, because the after's wording is different work.
  const guidePhase = todaysDay?.hasBefore ? 'after' : 'before';
  useEffect(() => {
    let cancelled = false;
    call<{ guide: typeof guide }>(`${API}/${token}/capture-guide?phase=${guidePhase}`)
      .then((res) => {
        if (!cancelled) setGuide(res.guide);
      })
      .catch(() => {
        // No guide is a quieter page, not a broken one — the buttons still work.
        if (!cancelled) setGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, guidePhase]);

  async function upload(file: File, phase: 'before' | 'after') {
    setUploading(phase);
    setProblems([]);
    setDone(null);
    try {
      setStep('Reading the video…');
      const facts = await readCapture(file);

      setStep('Getting somewhere to put it…');
      const extension = (file.name.split('.').pop() ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
      const slot = await call<{ path: string; token: string }>(`${API}/${token}/proof/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ workDate: today, phase, extension: extension || 'mp4' }),
      });

      setStep('Uploading…');
      // Straight to storage with the one-time token, not through the API.
      const put = await fetch(
        `/storage/v1/object/upload/sign/job-proofs/${slot.path}?token=${encodeURIComponent(slot.token)}`,
        { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'video/mp4' } },
      );
      if (!put.ok) throw new Error('The upload did not go through. Try again on a better signal.');

      setStep('Filing it…');
      const result = await call<{ problems: string[] }>(`${API}/${token}/proof`, {
        method: 'POST',
        body: JSON.stringify({
          workDate: today,
          phase,
          storagePath: slot.path,
          byteSize: file.size,
          durationSeconds: facts.durationSeconds ?? undefined,
          contentHash: facts.contentHash ?? undefined,
          capturedAt: facts.capturedAt,
          lat: facts.lat ?? undefined,
          lon: facts.lon ?? undefined,
          accuracyM: facts.accuracyM ?? undefined,
          frames: facts.frames,
        }),
      });

      setProblems(result.problems ?? []);
      setDone(
        result.problems?.length
          ? null
          : phase === 'before'
            ? 'Before video filed. Film again when you finish.'
            : 'After video filed. The office can see the day now.',
      );
      await onDone();
    } catch (err) {
      setProblems([err instanceof Error ? err.message : 'That did not go through.']);
    } finally {
      setUploading(null);
      setStep('');
    }
  }

  const Button = ({ phase, filed }: { phase: 'before' | 'after'; filed: boolean }) => {
    const input = phase === 'before' ? beforeInput : afterInput;
    return (
      <div className="flex-1">
        <input
          ref={input}
          type="file"
          accept="video/*"
          // The attribute that makes a phone open the camera rather than the
          // photo library. It is the difference between filming now and
          // uploading something from last week.
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file, phase);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => input.current?.click()}
          disabled={uploading !== null}
          className={`w-full rounded-xl px-4 py-4 text-sm font-semibold transition disabled:opacity-50 ${
            filed
              ? 'border border-success-200 bg-success-50 text-success-600'
              : 'bg-brand-600 text-ink-900'
          }`}
        >
          {uploading === phase ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerIcon className="animate-spin" width={15} height={15} />
              {step}
            </span>
          ) : filed ? (
            `${phase === 'before' ? 'Before' : 'After'} filed — refilm`
          ) : (
            `Film ${phase === 'before' ? 'before you start' : 'when you finish'}`
          )}
        </button>
      </div>
    );
  };

  return (
    <section className="mt-5 rounded-xl border border-line bg-paper-0 p-4">
      <h2 className="text-base font-semibold text-ink-900">Today's video</h2>
      <p className="mt-0.5 text-xs text-ink-600">
        One before you start, one when you finish. Walk the areas you worked on. Keep location
        turned on — it is what proves the footage is this site.
      </p>

      {guide && guide.steps.length > 0 && (
        <div className="mt-3 rounded-lg border border-brand-200 bg-brand-600/5 p-3">
          <p className="text-xs font-semibold text-ink-900">
            Film it like this{' '}
            <span className="font-normal text-ink-500">
              — the {guidePhase} video, about {Math.round(guide.targetSeconds / 60) || 1} min
            </span>
          </p>
          <ol className="mt-2 space-y-2">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    s.kind === 'anchor' ? 'bg-brand-600 text-white' : 'bg-paper-200 text-ink-600'
                  }`}
                >
                  {i + 1}
                </span>
                <span>
                  <span className={s.kind === 'anchor' ? 'font-semibold text-ink-900' : 'text-ink-800'}>
                    {s.kind === 'anchor' && <span className="text-brand-600">Start here: </span>}
                    {s.instruction}
                  </span>
                  <span className="block text-[11px] text-ink-500">{s.why}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button phase="before" filed={Boolean(todaysDay?.hasBefore)} />
        <Button phase="after" filed={Boolean(todaysDay?.hasAfter)} />
      </div>

      {/* Told now, while they are still standing on the site. */}
      {problems.length > 0 && (
        <div className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2">
          <p className="text-xs font-semibold text-danger-600">This will not count as proof:</p>
          <ul className="mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={p} className="text-xs text-danger-600">
                • {p}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-600">Film it again and it will replace this one.</p>
        </div>
      )}

      {done && (
        <p className="mt-3 rounded-lg border border-success-200 bg-success-50 px-3 py-2 text-xs text-success-600">
          {done}
        </p>
      )}

      {/* The moment the day's proof exists is the one moment the pitch is
          about something real that just happened — so it appears here, once,
          and only after the work is filed. */}
      {done?.startsWith('After') && (
        <p className="mt-2 text-[11px] text-ink-500">
          That video is your record as much as the job's.{' '}
          <a href="/login?mode=signup&src=proof-filed" className="font-medium text-brand-600 hover:underline">
            Keep every day's proof in your own Atmosphere account
          </a>
          {' '}— free for subs.
        </p>
      )}

      {days.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {days.slice(0, 10).map((day) => (
            <li key={day.workDate} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-ink-700">
                {new Date(`${day.workDate}T12:00:00Z`).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className={day.problems.length ? 'text-danger-600' : 'text-ink-500'}>
                {day.problems.length ? day.problems[0] : day.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
