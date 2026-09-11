import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { todayISO } from '../lib/proofCapture';
import { jobShareApiPath, jobShareTokenFromRoute } from '../lib/jobSharePath';
import { exchangeShareToken, guestPathAfterExchange } from '../lib/shareExchange';
import { CaptureGuideSteps } from '../components/shared/CaptureGuideSteps';
import { fieldCaptureInviteOpenUrl } from '../lib/firstRun';
import type { CaptureGuide } from '../lib/api';

/**
 * The subcontractor's screen.
 *
 * Opened from a link in a text message, on a phone, standing in a doorway at
 * the end of a long day. That is the entire design brief and it rules out most
 * of what a web app normally does: no sign-in, no settings. One page with two
 * clear jobs after the invite opens (Accept is implicit):
 *
 *   1. Film the day — classic Field Capture (app.atmosphereteam.com)
 *   2. Open the job file — scope, brief, do-nots, and recordings
 *
 * Ordering is the design. A sub reads the top of the screen and starts working,
 * so jump links name both paths, then exclusions / scope (the job file), then
 * filming. Opening the invite (or filing a video) records the current revision
 * for the office — no Accept button.
 */

const shareApi = jobShareApiPath;

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
    credentials: 'include',
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
  const params = useParams();
  const [searchParams] = useSearchParams();
  const token = jobShareTokenFromRoute(params);
  const inviteEmail = (searchParams.get('email') ?? '').trim();
  const fieldCaptureHref = fieldCaptureInviteOpenUrl(token, inviteEmail || null);
  const [view, setView] = useState<ShareView | null>(null);
  const [days, setDays] = useState<ProofDay[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [record, proofs] = await Promise.all([
        call<ShareView>(shareApi(token)),
        call<{ days: ProofDay[] }>(shareApi(token, '/proof')).catch(() => ({ days: [] as ProofDay[] })),
      ]);
      setView(record);
      setDays(proofs.days);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This link is not valid.');
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void exchangeShareToken('job', token).then((ok) => {
      if (!ok || typeof window === 'undefined') return;
      const next = guestPathAfterExchange('job', window.location.search);
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState(window.history.state, '', next);
      }
    });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayISO();
  const todaysDay = days.find((d) => d.workDate === today);

  return (
    <div
      className="mx-auto min-h-screen max-w-2xl bg-paper-100 px-4 pb-16 pt-6"
      data-testid="invited-job"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600">What's happening</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900">
          {view?.job.title ?? 'Loading…'}
        </h1>
      </header>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {view && (
        <>
          {/* Dual path after implicit Accept: film AND the job file. */}
          <nav
            className="mt-4 grid grid-cols-2 gap-2"
            aria-label="Invite actions"
            data-testid="invite-actions"
          >
            <a
              href={fieldCaptureHref}
              className="rounded-xl border border-brand-300 bg-brand-50 px-3 py-3 text-center text-sm font-semibold text-ink-900"
            >
              Film the day
            </a>
            <a
              href="#job-file"
              className="rounded-xl border border-line bg-paper-0 px-3 py-3 text-center text-sm font-semibold text-ink-900"
            >
              Open job file
            </a>
          </nav>
          <p className="mt-2 text-xs text-ink-600">
            Opening this invite records the current scope for the office. Film in{' '}
            <a
              href={fieldCaptureHref}
              className="font-medium text-brand-600 hover:underline"
              data-testid="open-field-capture"
            >
              Field Capture
            </a>
            .
          </p>

          {/* Blockers only (e.g. proposed scope waiting on an answer). Opening
              the invite already records the current revision — no Accept button. */}
          {!view.clear && (
            <section className="mt-4 rounded-xl border border-caution-200 bg-caution-50 px-4 py-3">
              <p className="text-sm font-semibold text-caution-600">Not clear to work yet</p>
              <p className="mt-0.5 text-xs text-ink-700">{view.because}</p>
            </section>
          )}

          {/* Job file: scope / brief / recordings sold-path for subs (view + film). */}
          <section id="job-file" className="mt-5 scroll-mt-4" data-testid="job-file">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-900">Job file</h2>
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-500">
                Scope · brief · recordings
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-600">
              What to do, what not to do, site facts, and every day already on file.
            </p>

            {/* Exclusions first, always. Somebody reading this on a phone reads
                the top of the screen and starts working. */}
            <div className="mt-3">
              <h3 className="text-sm font-semibold text-ink-900">What to do — and not do</h3>
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
                    Nothing written down yet. Ask the office before you start anything.
                  </li>
                )}
              </ul>
            </div>

            {view.brief && (
              <div className="mt-4 rounded-xl border border-line bg-paper-0 p-4">
                <h3 className="text-sm font-semibold text-ink-900">Site facts</h3>
                <dl className="mt-2 space-y-1">
                  {Object.entries(view.brief.facts ?? {}).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3 text-xs">
                      <dt className="shrink-0 text-ink-500">{key}</dt>
                      <dd className="text-right text-ink-800">{value}</dd>
                    </div>
                  ))}
                </dl>
                {view.brief.note && (
                  <p className="mt-2 text-xs text-ink-700">{view.brief.note}</p>
                )}
              </div>
            )}

            {view.messages.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-ink-900">On the record</h3>
                <ol className="mt-2 space-y-2">
                  {view.messages.slice(0, 20).map((message) => (
                    <li key={message.id} className="rounded-lg border border-line bg-paper-0 px-3 py-2">
                      <p className="text-xs font-medium text-ink-700">{message.author_label}</p>
                      <p className="mt-0.5 text-sm text-ink-800">{message.body}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {days.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold text-ink-900">Recordings on file</h3>
                <ul className="mt-2 space-y-1.5">
                  {days.slice(0, 10).map((day) => (
                    <li key={day.workDate} className="flex items-baseline justify-between gap-2 rounded-lg border border-line bg-paper-0 px-3 py-2 text-xs">
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
              </div>
            )}
          </section>

          <ProofSection
            token={token}
            fieldCaptureHref={fieldCaptureHref}
            todaysDay={todaysDay}
          />
        </>
      )}
    </div>
  );
}

/**
 * What to film on this invite — recording happens in classic Field Capture.
 */
function ProofSection({
  token,
  fieldCaptureHref,
  todaysDay,
}: {
  token: string;
  fieldCaptureHref: string;
  todaysDay: ProofDay | undefined;
}) {
  const [guide, setGuide] = useState<CaptureGuide | null>(null);
  const guidePhase = todaysDay?.hasBefore ? 'after' : 'before';
  useEffect(() => {
    let cancelled = false;
    call<{ guide: CaptureGuide }>(`${shareApi(token, '/capture-guide')}?phase=${guidePhase}`)
      .then((res) => {
        if (!cancelled) setGuide(res.guide);
      })
      .catch(() => {
        if (!cancelled) setGuide(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, guidePhase]);

  const hasBefore = Boolean(todaysDay?.hasBefore);
  const hasAfter = Boolean(todaysDay?.hasAfter);

  return (
    <section
      id="film-today"
      className="mt-5 scroll-mt-4 rounded-xl border border-line bg-paper-0 p-4"
      data-testid="film-today"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">What to film</h2>
        <span className="flex gap-1.5 text-[10.5px] font-semibold">
          <span
            className={`rounded-full px-2 py-0.5 ${hasBefore ? 'bg-success-50 text-success-600' : 'bg-paper-200/60 text-ink-500'}`}
          >
            before{hasBefore ? ' ✓' : ''}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${hasAfter ? 'bg-success-50 text-success-600' : 'bg-paper-200/60 text-ink-500'}`}
          >
            after{hasAfter ? ' ✓' : ''}
          </span>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-600">
        Recording is in Field Capture — sign in or create an account, then film this job.
      </p>
      <a
        href={fieldCaptureHref}
        className="mt-3 flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-4 text-sm font-semibold text-ink-900"
      >
        Open in Field Capture
      </a>
      {guide && guide.steps.length > 0 ? (
        <CaptureGuideSteps
          steps={guide.steps}
          final={
            <a href={fieldCaptureHref} className="text-sm font-semibold text-brand-600 hover:underline">
              Film this in Field Capture
            </a>
          }
        />
      ) : null}
    </section>
  );
}
