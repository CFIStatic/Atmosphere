import { useEffect, useState, type FormEvent } from 'react';
import { api, type ProofResponse, type ProofDay, type ProofQuestion } from '../../lib/api';
import { SpinnerIcon } from '../icons';

/**
 * Proof of work.
 *
 * The sub films the site before they start and again when they finish, every
 * day. This is where the general contractor reads it — and, because money moves
 * against it, where the page has to be careful about what it claims.
 *
 * Three states, and keeping them apart is the whole design:
 *
 *   Contradicted   Something is provably wrong. Filmed two miles away, filed
 *                  against the wrong day, byte-identical to an earlier upload.
 *                  Red, and it stops a payment.
 *
 *   Unproven       Nothing is wrong; something could not be checked. No
 *                  location on the file, no capture time. Amber. It also stops
 *                  a payment, and saying so plainly is the point — calling this
 *                  "verified" would be the single most damaging thing this
 *                  feature could do.
 *
 *   Checks out     Both videos, everything checked, nothing failed. Only this
 *                  gets a green light, and even then a person still presses
 *                  Accept. The software's job is to tell them what is true,
 *                  not to release the money.
 *
 * The AI summary sits below the checks rather than above them on purpose. It
 * says what the footage shows; the checks say whether the footage is of this
 * job on this day. A beautiful summary of the wrong house is worse than none.
 */

const VERDICT_DOT: Record<string, string> = {
  pass: 'bg-success-600',
  fail: 'bg-danger-600',
  unknown: 'bg-caution-600',
};

function label(key: string): string {
  const bare = key.replace(/^(before|after)\./, '');
  const words: Record<string, string> = {
    on_site: 'Filmed on site',
    same_day: 'Filmed on the day claimed',
    uploaded_promptly: 'Uploaded promptly',
    long_enough: 'Long enough to show the work',
    not_a_reupload: 'Not a re-upload',
    ordered: 'After came after before',
  };
  const which = key.startsWith('before.') ? 'Before' : key.startsWith('after.') ? 'After' : '';
  return which ? `${which}: ${words[bare] ?? bare}` : (words[bare] ?? bare);
}

export function ProofOfWork({ jobId }: { jobId: string }) {
  const [data, setData] = useState<ProofResponse | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ProofQuestion[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [proofs, qs] = await Promise.all([
        api.jobProofs(jobId),
        api.proofQuestions(jobId).catch(() => ({ questions: [] as ProofQuestion[] })),
      ]);
      setData(proofs);
      setQuestions(qs.questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the proof record.');
      setData({ days: [], counts: { days: 0, payable: 0, contradicted: 0, awaitingAfter: 0 }, siteKnown: false });
    }
  }

  useEffect(() => {
    setData(null);
    setOpenDay(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function decide(day: ProofDay, decision: 'accepted' | 'rejected') {
    try {
      await api.decideProofDay(jobId, day.workDate, { partyId: day.partyId, decision });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      await api.askAboutProofs(jobId, question);
      setQuestion('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer that.');
    } finally {
      setAsking(false);
    }
  }

  async function watch(proofId: string) {
    try {
      const { url } = await api.proofVideoUrl(proofId);
      window.open(url, '_blank', 'noopener');
    } catch {
      setError('Could not open that video.');
    }
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">Proof of work</h2>
        {data && (
          <span className="flex flex-wrap gap-3 text-xs">
            {data.counts.payable > 0 && (
              <span className="text-success-600">{data.counts.payable} ready to pay</span>
            )}
            {data.counts.contradicted > 0 && (
              <span className="text-danger-600">{data.counts.contradicted} failed a check</span>
            )}
            {data.counts.awaitingAfter > 0 && (
              <span className="text-caution-600">{data.counts.awaitingAfter} missing an after</span>
            )}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Each crew films the site before they start and again when they finish. The checks below say
        whether the footage is of this job on this day; the summary says what it shows.
      </p>

      {/* Stated up front, not buried. Without a site location the strongest
          check cannot run at all, and every day will read as unproven. */}
      {data && !data.siteKnown && data.counts.days > 0 && (
        <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-600">
          This job has no coordinates on file, so nothing can be checked against the site. Add the
          property address to turn the strongest check on.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {data === null ? (
        <p className="mt-3 text-sm text-ink-600">Loading…</p>
      ) : data.days.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
          Nothing filed yet. Subs upload from the Atmosphere app using their job link — a video
          before they start and one when they finish, each day they are on site.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.days.map((day) => {
            const on = openDay === `${day.partyId}|${day.workDate}`;
            const tone = day.contradicted
              ? 'border-danger-200 bg-danger-50'
              : day.payable
                ? 'border-success-200 bg-success-50'
                : 'border-line';
            return (
              <li key={`${day.partyId}|${day.workDate}`} className={`rounded-lg border ${tone}`}>
                <button
                  onClick={() => setOpenDay(on ? null : `${day.partyId}|${day.workDate}`)}
                  aria-expanded={on}
                  className="block w-full px-3 py-2.5 text-left"
                >
                  <span className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">
                        {new Date(`${day.workDate}T12:00:00Z`).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        <span className="ml-2 text-xs font-normal text-ink-600">{day.company}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-600">{day.summary}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {/* Two badges, never merged. "Before + after are here" and
                          "this is safe to pay against" are different claims. */}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          day.hasBefore && day.hasAfter
                            ? 'bg-paper-200/60 text-ink-600'
                            : 'bg-caution-50 text-caution-600'
                        }`}
                      >
                        {day.hasBefore && day.hasAfter
                          ? 'before + after'
                          : day.hasBefore
                            ? 'before only'
                            : 'after only'}
                      </span>
                      {day.accepted ? (
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-semibold text-success-600">
                          accepted
                        </span>
                      ) : day.rejected ? (
                        <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-semibold text-danger-600">
                          rejected
                        </span>
                      ) : day.payable ? (
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-semibold text-success-600">
                          ready to pay
                        </span>
                      ) : (
                        <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[10px] font-semibold text-caution-600">
                          {day.contradicted ? 'failed a check' : 'not proven'}
                        </span>
                      )}
                    </span>
                  </span>
                </button>

                {on && (
                  <div className="border-t border-line/60 px-3 py-3">
                    <p className="text-[11px] font-medium text-ink-700">{day.payableBecause}</p>

                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {day.checks.map((check) => (
                        <li key={check.key} className="flex items-start gap-2">
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${VERDICT_DOT[check.verdict]}`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            <span className="block text-[11px] font-medium text-ink-700">
                              {label(check.key)}
                            </span>
                            <span className="block text-[11px] text-ink-500">{check.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>

                    {/* Below the checks, deliberately. A beautiful summary of
                        the wrong house is worse than no summary at all. */}
                    {day.aiSummary && (
                      <div className="mt-3 rounded-lg border border-line bg-paper-50/60 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                          What the footage shows
                        </p>
                        <p className="mt-1 text-xs text-ink-800">{day.aiSummary}</p>
                        {day.aiFindings?.changes?.length ? (
                          <ul className="mt-1.5 space-y-0.5">
                            {day.aiFindings.changes.map((c) => (
                              <li key={c} className="text-[11px] text-ink-600">
                                • {c}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {day.aiFindings?.concerns?.length ? (
                          <p className="mt-1.5 text-[11px] text-caution-600">
                            Worth a look: {day.aiFindings.concerns.join('; ')}
                          </p>
                        ) : null}
                        {/* What it could not settle, kept as prominent as what
                            it could. An empty list here is suspicious, not
                            reassuring. */}
                        {day.aiFindings?.cannotTell?.length ? (
                          <p className="mt-1.5 text-[11px] text-ink-500">
                            Not visible in the frames: {day.aiFindings.cannotTell.join('; ')}
                          </p>
                        ) : null}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {day.proofIds.map((id, i) => (
                        <button
                          key={id}
                          onClick={() => void watch(id)}
                          className="rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:text-ink-900"
                        >
                          Watch {i === 0 ? 'before' : 'after'}
                        </button>
                      ))}
                      {!day.accepted && (
                        <>
                          <button
                            onClick={() => void decide(day, 'accepted')}
                            // Disabled rather than hidden: somebody should be
                            // able to see that accepting is possible and why it
                            // is not available yet.
                            disabled={!day.payable}
                            title={day.payable ? undefined : day.payableBecause}
                            className="rounded-lg bg-success-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                          >
                            Accept the day
                          </button>
                          <button
                            onClick={() => void decide(day, 'rejected')}
                            className="rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Asking the record. Forty jobs and eighty videos a day is nobody's
          afternoon; a question against the summaries is. */}
      {data && data.days.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <form onSubmit={ask} className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about the videos — e.g. when was the subfloor first visible?"
              className="min-w-0 flex-1 rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-none focus:ring-2 focus:ring-brand-200"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50"
            >
              {asking && <SpinnerIcon className="animate-spin" width={12} height={12} />}
              Ask
            </button>
          </form>
          <p className="mt-1.5 text-[11px] text-ink-400">
            Answered only from what the videos were recorded as showing. If it is not in them, the
            answer says so rather than guessing.
          </p>

          {questions.length > 0 && (
            <ol className="mt-3 space-y-2">
              {questions.slice(0, 6).map((q) => (
                <li key={q.id} className="rounded-lg border border-line px-3 py-2">
                  <p className="text-[11px] font-medium text-ink-700">{q.question}</p>
                  <p className="mt-0.5 text-xs text-ink-800">{q.answer}</p>
                  {/* Which days it drew on, so the answer can be checked rather
                      than trusted. */}
                  <p className="mt-1 text-[10.5px] text-ink-400">
                    From {q.grounded_on?.length ?? 0} day
                    {(q.grounded_on?.length ?? 0) === 1 ? '' : 's'} of footage ·{' '}
                    {new Date(q.created_at).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
