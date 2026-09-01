import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type PhysicalWorkRecord,
  type ProofResponse,
  type ProofDay,
  type ProofQuestion,
  type ProofVideoRecord,
  type WorkEpisodeListItem,
} from '../../lib/api';
import { bindMeasuredDuration, formatClipLength } from '../../lib/clipDuration';
import { SpinnerIcon } from '../icons';
import { PhysicalWorkPanel } from './PhysicalWorkPanel';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';

/**
 * Proof of work.
 *
 * Crews film the day (video + mic). This is where the office reads it —
 * integrity checks first, then what the assistant saw in each video.
 * Unknown is never a pass.
 */

/**
 * The verdict, worn on the day row. 'none' is deliberately the loud one:
 * a crew claimed a day and the footage shows nothing changed, which is the
 * sentence this feature exists to put in front of a project manager.
 */
/**
 * The opening-shot habit, in words. 'not_exterior' is stated plainly rather
 * than styled as a failure — the checks that gate money live elsewhere; this
 * is the filming habit the guide teaches, made visible so it improves.
 */
const OPENING_WORDS: Record<string, string> = {
  exterior: 'at the property',
  not_exterior: 'did not start outside',
  unclear: 'could not tell',
};

const MATERIAL_CHIP: Record<string, { word: string; style: string }> = {
  significant: { word: 'work changed', style: 'bg-success-50 text-success-600' },
  minor: { word: 'small change', style: 'bg-paper-200/60 text-ink-600' },
  none: { word: 'no visible change', style: 'bg-caution-50 text-caution-600' },
  unclear: { word: 'could not compare', style: 'bg-paper-200/60 text-ink-500' },
};

const VERDICT_DOT: Record<string, string> = {
  pass: 'bg-success-600',
  fail: 'bg-danger-600',
  unknown: 'bg-caution-600',
};

function recordForDay(
  episodes: WorkEpisodeListItem[],
  records: Record<string, PhysicalWorkRecord>,
  day: ProofDay,
): PhysicalWorkRecord | null {
  const episode = episodes.find((item) => item.partyId === day.partyId && item.workDate === day.workDate);
  return episode ? (records[episode.id] ?? null) : null;
}

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

export function ProofOfWork({
  jobId,
  heading = 'Proof of work',
  readOnly = false,
  initialData,
  videoFetcher,
}: {
  jobId?: string;
  heading?: string;
  readOnly?: boolean;
  initialData?: ProofResponse;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
}) {
  const [data, setData] = useState<ProofResponse | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ProofQuestion[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<WorkEpisodeListItem[]>([]);
  const [records, setRecords] = useState<Record<string, PhysicalWorkRecord>>({});
  const [freshNotice, setFreshNotice] = useState<string | null>(null);
  const knownVideoCount = useRef<number | null>(null);

  async function load(opts?: { silent?: boolean }) {
    if (initialData) {
      setData(initialData);
      knownVideoCount.current = initialData.videos?.length ?? initialData.counts?.videos ?? 0;
      return;
    }
    if (!jobId) return;
    try {
      const [proofs, qs, episodeList] = await Promise.all([
        api.jobProofs(jobId),
        readOnly
          ? Promise.resolve({ questions: [] as ProofQuestion[] })
          : api.proofQuestions(jobId).catch(() => ({ questions: [] as ProofQuestion[] })),
        api.jobEpisodes(jobId).catch(() => ({ episodes: [] as WorkEpisodeListItem[] })),
      ]);
      const nextCount = proofs.videos?.length ?? proofs.counts?.videos ?? 0;
      if (
        opts?.silent &&
        knownVideoCount.current != null &&
        nextCount > knownVideoCount.current
      ) {
        const added = nextCount - knownVideoCount.current;
        setFreshNotice(added === 1 ? 'New video filed on this job.' : `${added} new videos filed on this job.`);
      }
      knownVideoCount.current = nextCount;
      setData(proofs);
      setQuestions(qs.questions);
      setEpisodes(episodeList.episodes);
      setError(null);
    } catch (err) {
      if (!opts?.silent) {
        setError(err instanceof Error ? err.message : 'Could not load the proof record.');
        setData({
          days: [],
          videos: [],
          counts: { days: 0, videos: 0, payable: 0, contradicted: 0, awaitingAfter: 0, analysing: 0 },
          siteKnown: false,
        });
      }
    }
  }

  useEffect(() => {
    setData(null);
    setOpenDay(null);
    setRecords({});
    setFreshNotice(null);
    knownVideoCount.current = null;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, initialData]);

  useVisiblePolling(() => void load({ silent: true }), {
    enabled: Boolean(jobId) && !initialData,
    intervalMs: 12_000,
  });

  useEffect(() => {
    if (!openDay) return;
    const [partyId, workDate] = openDay.split('|');
    const episode = episodes.find((item) => item.partyId === partyId && item.workDate === workDate);
    if (!episode || records[episode.id]) return;
    void api
      .episodePhysicalWork(episode.id)
      .then((res) => setRecords((prev) => ({ ...prev, [episode.id]: res.record })))
      .catch(() => undefined);
  }, [openDay, episodes, records]);

  async function decide(day: ProofDay, decision: 'accepted' | 'rejected') {
    if (!jobId) return;
    try {
      await api.decideProofDay(jobId, day.workDate, { partyId: day.partyId, decision });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !jobId) return;
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

  async function reanalyse(day: ProofDay) {
    const id = jobId;
    if (!id) return;
    setBusy(`${day.partyId}|${day.workDate}`);
    try {
      await api.reanalyseProofDay(id, day.workDate, day.partyId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the videos.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl glass-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">{heading}</h2>
        {data && (
          <span className="flex flex-wrap gap-3 text-xs">
            {data.counts.payable > 0 && (
              <span className="text-success-600">{data.counts.payable} ready to pay</span>
            )}
            {data.counts.contradicted > 0 && (
              <span className="text-danger-600">{data.counts.contradicted} failed a check</span>
            )}
            {(data.counts.analysing ?? 0) > 0 && (
              <span className="text-ink-500">{data.counts.analysing} being read</span>
            )}
            {(data.counts.videos ?? data.videos?.length ?? 0) > 0 && (
              <span className="text-ink-500">
                {data.counts.videos ?? data.videos?.length} video
                {(data.counts.videos ?? data.videos?.length) === 1 ? '' : 's'} on file
              </span>
            )}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Every uploaded video is kept. The assistant reads the picture and the mic; you can ask the
        collection. The checks say whether the footage is of this job.
      </p>

      {/* Stated up front, not buried. Without a site location the strongest
          check cannot run at all, and every day will read as unproven. */}
      {data && !data.siteKnown && data.counts.days > 0 && (
        <p className="mt-3 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-xs text-caution-600">
          This job has no coordinates on file, so nothing can be checked against the site. Add the
          property address to turn the strongest check on.
        </p>
      )}

      {freshNotice && (
        <p role="status" className="mb-3 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">
          {freshNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {data === null ? (
        <p className="mt-3 text-sm text-ink-600">Loading…</p>
      ) : data.days.length === 0 && !(data.videos?.length) ? (
        <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
          Nothing filed yet. Crews upload from Field Capture — a video (picture + mic) is
          enough. The assistant will describe what happened.
        </p>
      ) : (
        <>
        <VideoCatalog videos={data.videos ?? []} videoFetcher={videoFetcher} />
        <ul className="mt-3 space-y-2">
          {data.days.map((day) => {
            const on = openDay === `${day.partyId}|${day.workDate}`;
            const workRecord = recordForDay(episodes, records, day);
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
                      {day.materialChange && MATERIAL_CHIP[day.materialChange] && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${MATERIAL_CHIP[day.materialChange].style}`}
                        >
                          {MATERIAL_CHIP[day.materialChange].word}
                        </span>
                      )}
                      <span className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                        {day.proofIds.length === 1
                          ? '1 video'
                          : day.proofIds.length > 1
                            ? `${day.proofIds.length} videos`
                            : 'no video'}
                      </span>
                      {day.accepted ? (
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-semibold text-success-600">
                          accepted
                        </span>
                      ) : day.rejected ? (
                        <span className="rounded-full bg-danger-50 px-2 py-0.5 text-[10px] font-semibold text-danger-600">
                          rejected
                        </span>
                      ) : day.contradicted ? (
                        <span className="rounded-full bg-caution-50 px-2 py-0.5 text-[10px] font-semibold text-caution-600">
                          failed a check
                        </span>
                      ) : day.aiSummary ? (
                        <span className="rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-semibold text-success-600">
                          work described
                        </span>
                      ) : day.analysisStatus === 'queued' || day.analysisStatus === 'running' ? (
                        <span className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[10px] font-semibold text-ink-600">
                          reading
                        </span>
                      ) : (
                        <span className="rounded-full bg-paper-200/60 px-2 py-0.5 text-[10px] font-semibold text-ink-500">
                          {day.payable ? 'ready to pay' : 'on file'}
                        </span>
                      )}
                    </span>
                  </span>
                </button>

                {on && (
                  <div className="border-t border-line/60 px-3 py-3">
                    <p className="text-[11px] font-medium text-ink-700">{day.payableBecause}</p>
                    {/* The states the old pipeline hid. A failed read is a
                        breakage with a retry, not a silence; a skipped one
                        says what was missing. */}
                    {day.analysisStatus === 'failed' && (
                      <p className="mt-1 rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-1.5 text-[11px] text-danger-600">
                        The assistant could not read this day
                        {day.analysisError ? ` — ${day.analysisError}` : ''}. Try it again below.
                      </p>
                    )}
                    {day.analysisStatus === 'skipped' && day.analysisError && (
                      <p className="mt-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-500">
                        Not analysed: {day.analysisError}
                      </p>
                    )}
                    {(day.analysisStatus === 'queued' || day.analysisStatus === 'running') && (
                      <p className="mt-1 text-[11px] text-ink-500">
                        The assistant is reading this day now — check back in a minute.
                      </p>
                    )}

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
                          What work was performed
                        </p>
                        {day.aiFindings?.kind === 'day_film' && (
                          <p className="mt-1 text-[11px] text-ink-500">
                            Read from this video.
                          </p>
                        )}
                        {day.aiFindings?.scopeCrossRef === false && day.aiFindings?.kind !== 'day_film' && (
                          <p className="mt-1 text-[11px] text-ink-500">
                            No work description on file — AI described what happened from the frames.
                          </p>
                        )}
                        {day.aiFindings?.scopeCrossRef === true && (
                          <p className="mt-1 text-[11px] text-ink-500">
                            Cross-referenced against the agreed work lines.
                          </p>
                        )}
                        <p className="mt-1 text-xs text-ink-800">{day.aiSummary}</p>
                        {(day.aiFindings?.workPerformed?.length || day.aiFindings?.changes?.length) ? (
                          <ul className="mt-1.5 space-y-0.5">
                            {(day.aiFindings.workPerformed?.length
                              ? day.aiFindings.workPerformed
                              : day.aiFindings.changes ?? []
                            ).map((c) => (
                              <li key={c} className="text-[11px] text-ink-600">
                                • {c}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {(day.reports?.before || day.reports?.after) && (
                          <div className="mt-2 space-y-2">
                            {(['before', 'after'] as const).map((half) => {
                              const report = day.reports?.[half];
                              if (!report) return null;
                              return (
                                <div key={half} className="rounded-lg bg-paper-100/60 px-2.5 py-2">
                                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-400">
                                    {half} video — narrated report
                                  </p>
                                  {report.status === 'done' && report.text ? (
                                    <>
                                      <p className="mt-1 text-[11.5px] leading-snug text-ink-700">
                                        {report.text}
                                      </p>
                                      {report.coverage.length > 0 && (
                                        <p className="mt-1 text-[10.5px] text-ink-500">
                                          Covered {report.coverage.filter((c) => c.seen).length} of{' '}
                                          {report.coverage.length} shot-list steps
                                          {report.coverage.some((c) => !c.seen) &&
                                            ` — missing: ${report.coverage
                                              .filter((c) => !c.seen)
                                              .map((c) => c.label.toLowerCase())
                                              .slice(0, 2)
                                              .join('; ')}${
                                              report.coverage.filter((c) => !c.seen).length > 2 ? '…' : ''
                                            }`}
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <p className="mt-1 text-[11px] text-ink-500">
                                      {report.status === 'queued' || report.status === 'running'
                                        ? 'Being written — the model is reading the clip now.'
                                        : report.status === 'failed'
                                          ? `Failed: ${report.error ?? 'the model reply was not usable.'}`
                                          : report.status === 'skipped'
                                            ? (report.error ?? 'Skipped.')
                                            : 'Not narrated.'}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {day.aiFindings?.opening && day.aiFindings.kind !== 'day_film' && (
                          <p className="mt-1 text-[11px] text-ink-500">
                            Opening shots — before: {OPENING_WORDS[day.aiFindings.opening.before]}
                            {' · '}after: {OPENING_WORDS[day.aiFindings.opening.after]}
                          </p>
                        )}
                        {day.aiFindings?.opening && day.aiFindings.kind === 'day_film' && (
                          <p className="mt-1 text-[11px] text-ink-500">
                            Opening shot: {OPENING_WORDS[day.aiFindings.opening.after]}
                          </p>
                        )}
                        {/* Per scope line. "Not visible" is given the same
                            weight as the other two on purpose: the camera not
                            covering the bathroom says nothing about the
                            bathroom, and somebody withholding a payment has to
                            be able to tell that apart from work not done. */}
                        {day.aiFindings?.scopeVerdicts?.length ? (
                          <ul className="mt-2 space-y-1 border-t border-line pt-2">
                            {day.aiFindings.scopeVerdicts.map((v) => (
                              <li key={v.title} className="flex items-start gap-2">
                                <span
                                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                    v.verdict === 'appears_complete'
                                      ? 'bg-success-600'
                                      : v.verdict === 'in_progress'
                                        ? 'bg-caution-600'
                                        : 'bg-ink-400'
                                  }`}
                                  aria-hidden="true"
                                />
                                <span className="min-w-0">
                                  <span className="block text-[11px] font-medium text-ink-800">
                                    {v.title}
                                    <span className="ml-1.5 font-normal text-ink-500">
                                      {v.verdict === 'appears_complete'
                                        ? 'looks finished'
                                        : v.verdict === 'in_progress'
                                          ? 'under way'
                                          : 'not in shot'}
                                    </span>
                                  </span>
                                  {v.because && (
                                    <span className="block text-[11px] text-ink-500">{v.because}</span>
                                  )}
                                </span>
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

                    {workRecord ? <PhysicalWorkPanel record={workRecord} /> : null}

                    {/* The videos themselves, side by side. A summary is a
                        convenience; the footage is the documentation, and
                        somebody deciding on a payment should be one click from
                        it rather than one tab away. */}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {day.proofIds.map((id, i) => (
                        <ProofVideo
                          key={id}
                          proofId={id}
                          label={
                            day.proofIds.length === 1
                              ? 'Video'
                              : `Video ${i + 1}`
                          }
                          videoFetcher={videoFetcher}
                        />
                      ))}
                    </div>

                    {!readOnly && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void reanalyse(day)}
                        disabled={busy === `${day.partyId}|${day.workDate}` || !(day.hasAfter || day.hasBefore)}
                        title={
                          day.hasAfter || day.hasBefore
                            ? undefined
                            : 'Nothing to read until a video is filed.'
                        }
                        className="flex items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700 disabled:opacity-40"
                      >
                        {busy === `${day.partyId}|${day.workDate}` && (
                          <SpinnerIcon className="animate-spin" width={11} height={11} />
                        )}
                        {day.analysisStatus === 'failed'
                          ? 'Try the AI again'
                          : day.aiSummary
                            ? 'Watch it again'
                            : 'Read this video'}
                      </button>
                      {!day.accepted && (
                        <>
                          <button
                            onClick={() => void decide(day, 'accepted')}
                            // Disabled rather than hidden: somebody should be
                            // able to see that accepting is possible and why it
                            // is not available yet.
                            disabled={
                              day.hasAfter && !day.hasBefore ? day.contradicted : !day.payable
                            }
                            title={
                              day.hasAfter && !day.hasBefore
                                ? day.contradicted
                                  ? day.payableBecause
                                  : 'Mark this day as reviewed after you have read the analysis.'
                                : day.payable
                                  ? undefined
                                  : day.payableBecause
                            }
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
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        </>
      )}

      {/* Asking the record. Forty jobs and eighty videos a day is nobody's
          afternoon; a question against the summaries is. */}
      {!readOnly && data && (data.days.length > 0 || (data.videos?.length ?? 0) > 0) && (
        <div className="mt-4 border-t border-line pt-3">
          <form onSubmit={ask} className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask the video collection — e.g. when was the subfloor first visible?"
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
            Answered from every clip on this job — what the assistant saw in the frames and, when
            the mic has been read, what was said. If it is not in them, the answer says so.
          </p>

          {questions.length > 0 && (
            <ol className="mt-3 space-y-2">
              {questions.slice(0, 6).map((q) => {
                const clipCount = (q.grounded_on ?? []).filter((id) => /^\d{4}-\d{2}-\d{2}/.test(id)).length;
                return (
                  <li key={q.id} className="rounded-lg border border-line px-3 py-2">
                    <p className="text-[11px] font-medium text-ink-700">{q.question}</p>
                    <p className="mt-0.5 text-xs text-ink-800">{q.answer}</p>
                    {/* Which days it drew on, so the answer can be checked rather
                        than trusted. */}
                    <p className="mt-1 text-[10.5px] text-ink-400">
                      From {clipCount} clip
                      {clipCount === 1 ? '' : 's'} on file ·{' '}
                      {new Date(q.created_at).toLocaleDateString()}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function statusWord(status: string | null, done: string): string {
  if (status === 'done') return done;
  if (status === 'queued' || status === 'running') return 'reading';
  if (status === 'failed') return 'failed';
  if (status === 'skipped') return 'skipped';
  return 'waiting';
}

function VideoCatalog({
  videos,
  videoFetcher,
}: {
  videos: ProofVideoRecord[];
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
}) {
  if (!videos.length) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line">
      <p className="border-b border-line bg-paper-50/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Every video on this job
      </p>
      <ul>
        {videos.map((video) => (
          <li key={video.id} className="border-b border-line/70 px-3 py-2 last:border-b-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink-800">
                  {new Date(`${video.workDate}T12:00:00Z`).toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                  <span className="ml-1.5 font-normal text-ink-500">
                    {video.company}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-ink-500">
                  {formatClipLength(video.durationSeconds)}
                  {' · '}
                  Picture: {statusWord(video.analysisStatus ?? video.narrationStatus, 'read')}
                  {' · '}
                  Mic: {statusWord(video.transcriptStatus, 'heard')}
                </p>
                {video.aiSummary && (
                  <p className="mt-0.5 text-[11px] text-ink-700">{video.aiSummary}</p>
                )}
                {video.heardOnMic && (
                  <p className="mt-0.5 text-[11px] text-ink-500">On the mic: {video.heardOnMic}</p>
                )}
              </div>
              <PlayClip proofId={video.id} videoFetcher={videoFetcher} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MeasuredVideo({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return bindMeasuredDuration(el);
  }, [src]);
  return <video ref={ref} src={src} controls playsInline preload="metadata" className={className} />;
}

/**
 * Compact play control for the catalog. Same on-demand signed URL as ProofVideo
 * — a job with thirty clips must not mint thirty links just to list them.
 */
function PlayClip({
  proofId,
  videoFetcher,
}: {
  proofId: string;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setLoading(true);
    try {
      const res = videoFetcher
        ? await videoFetcher(proofId)
        : await api.proofVideoUrl(proofId);
      setUrl(res.url);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (url) {
    return (
      <div className="basis-full sm:basis-64">
        <MeasuredVideo src={url} className="block max-h-40 w-full rounded-lg bg-black" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={loading || failed}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700 disabled:opacity-50"
    >
      {loading && <SpinnerIcon className="animate-spin" width={11} height={11} />}
      {failed ? 'Could not load' : loading ? 'Loading…' : 'Play'}
    </button>
  );
}

/**
 * The footage itself.
 *
 * Loaded on demand rather than on render: a job with three weeks of days would
 * otherwise mint sixty signed URLs to show two. The URL is short-lived by
 * design — these are the insides of somebody's house, and a link that works
 * forever is one that will end up forwarded.
 *
 * The poster is deliberately absent. A still frame chosen by the browser is
 * usually black, and a black rectangle reads as a broken video rather than one
 * that has not been asked for yet.
 */
function ProofVideo({
  proofId,
  label,
  videoFetcher,
}: {
  proofId: string;
  label: string;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setLoading(true);
    try {
      const res = videoFetcher
        ? await videoFetcher(proofId)
        : await api.proofVideoUrl(proofId);
      setUrl(res.url);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper-100">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {label}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-brand-600 hover:text-brand-700"
          >
            Full screen
          </a>
        )}
      </div>

      {url ? (
        <MeasuredVideo src={url} className="block max-h-64 w-full bg-black" />
      ) : (
        <button
          onClick={() => void open()}
          disabled={loading || failed}
          className="flex h-28 w-full items-center justify-center gap-2 text-xs text-ink-600 hover:text-ink-900 disabled:opacity-60"
        >
          {loading && <SpinnerIcon className="animate-spin" width={13} height={13} />}
          {failed ? 'Could not load this video' : loading ? 'Loading…' : `Play the ${label.toLowerCase()}`}
        </button>
      )}
    </div>
  );
}
