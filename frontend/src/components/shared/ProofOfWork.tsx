import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type ProofResponse,
  type ProofQuestion,
  type ProofVideoRecord,
} from '../../lib/api';
import { formatClipLength } from '../../lib/clipDuration';
import { JobFilePlayer, type JobFilePlayerCaptions } from './JobFilePlayer';
import { useVideoSeek } from '../../lib/videoSeek';
import type { AskSeekTarget } from '../../lib/askSeek';
import { SpinnerIcon } from '../icons';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { ShowDispute } from '../analysis/ShowDispute';
import { VerbatimTranscript } from '../analysis/VerbatimTranscript';

/**
 * Proof of work — light job-file Videos surface.
 *
 * One clip list: expand/Play shows the player and transcript (Copy) together.
 * Dense punch / playbook / Glance walls stay with the clip player / Ask —
 * not piled onto the job file. Evidence custody stays in EvidenceLocker.
 */

function matchSeekVideo(
  videos: ProofVideoRecord[],
  request: AskSeekTarget,
): ProofVideoRecord | undefined {
  if (request.proofId) {
    const exact = videos.find((video) => video.id === request.proofId);
    if (exact) return exact;
  }
  if (request.workDate) {
    const onDay = videos.filter((video) => video.workDate === request.workDate);
    if (request.phase) {
      const phase = onDay.find((video) => video.phase === request.phase);
      if (phase) return phase;
    }
    if (onDay[0]) return onDay[0];
  }
  return videos[0];
}

export function ProofOfWork({
  jobId,
  heading = 'Videos',
  readOnly = false,
  initialData,
  videoFetcher,
  showCollectionAsk = true,
}: {
  jobId?: string;
  heading?: string;
  readOnly?: boolean;
  initialData?: ProofResponse;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  /** Office job file already pins Ask — hide the second collection form. */
  showCollectionAsk?: boolean;
}) {
  const [data, setData] = useState<ProofResponse | null>(null);
  const [questions, setQuestions] = useState<ProofQuestion[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshNotice, setFreshNotice] = useState<string | null>(null);
  const knownVideoCount = useRef<number | null>(null);
  const { request: seekRequest } = useVideoSeek();
  const [seekProofId, setSeekProofId] = useState<string | null>(null);
  const [seekAt, setSeekAt] = useState<number | null>(null);
  const [seekNonce, setSeekNonce] = useState(0);
  function applyClipSeek(proofId: string, seconds: number | null | undefined) {
    setSeekProofId(proofId);
    if (seconds != null) setSeekAt(seconds);
    setSeekNonce((n) => n + 1);
  }

  async function load(opts?: { silent?: boolean }) {
    if (initialData) {
      setData(initialData);
      knownVideoCount.current = initialData.videos?.length ?? initialData.counts?.videos ?? 0;
      return;
    }
    if (!jobId) return;
    try {
      const [proofs, qs] = await Promise.all([
        api.jobProofs(jobId),
        readOnly
          ? Promise.resolve({ questions: [] as ProofQuestion[] })
          : api.proofQuestions(jobId).catch(() => ({ questions: [] as ProofQuestion[] })),
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
    if (!seekRequest || !data?.videos?.length) return;
    const video = matchSeekVideo(data.videos, seekRequest);
    if (!video) return;
    setSeekProofId(video.id);
    setSeekAt(seekRequest.atSeconds);
    setSeekNonce((n) => n + 1);
  }, [seekRequest, data]);

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

  return (
    <section className="rounded-xl glass-card p-5" data-job-section="videos" data-testid="proof-of-work">
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
        Every uploaded clip is kept. Expand a row to play and read the transcript — dense analysis
        stays with Ask, not piled onto this file.
      </p>

      {data && ((data.disputes?.length ?? 0) > 0) && (
        <div className="mt-3">
          <ShowDispute
            disputes={data.disputes ?? []}
            onSeek={(moment) => {
              if (moment.proofId) {
                applyClipSeek(moment.proofId, moment.seekSeconds);
              }
            }}
          />
        </div>
      )}

      {freshNotice && (
        <p role="status" className="mb-3 mt-3 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-700">
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
      ) : !(data.videos?.length) && data.days.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600">
          Nothing filed yet. Crews upload from Field Capture — a video (picture + mic) is
          enough. The assistant will describe what happened.
        </p>
      ) : (
        <VideoCatalog
          jobId={jobId}
          videos={data.videos ?? []}
          videoFetcher={videoFetcher}
          seekProofId={seekProofId}
          seekAt={seekAt}
          seekNonce={seekNonce}
        />
      )}

      {!readOnly && showCollectionAsk && data && ((data.videos?.length ?? 0) > 0 || data.days.length > 0) && (
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

function captionsForVideo(video: ProofVideoRecord | undefined | null): JobFilePlayerCaptions | null {
  if (!video) return null;
  const transcriptText =
    video.transcriptText ?? video.heardOnMic ?? video.conversation?.transcriptText ?? null;
  const segments = video.transcriptSegments ?? video.conversation?.transcriptSegments ?? null;
  const hasText = Boolean(String(transcriptText || '').trim()) || Boolean(segments?.length);
  const pending =
    video.transcriptStatus === 'queued' || video.transcriptStatus === 'running';
  if (!hasText) {
    return { transcriptText: null, segments: null, durationSeconds: video.durationSeconds, status: pending ? 'pending' : 'unavailable' };
  }
  return {
    transcriptText,
    segments,
    durationSeconds: video.durationSeconds,
  };
}

function HearMicButton({
  jobId,
  proofId,
  status,
}: {
  jobId: string;
  proofId: string;
  status: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setNote(null);
    try {
      await api.requeueProofTranscript(jobId, proofId);
      setNote('Queued — captions appear once the mic is read.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not queue the transcript.');
    } finally {
      setBusy(false);
    }
  }
  const pending = status === 'queued' || status === 'running';
  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || pending}
        data-testid="hear-the-mic"
        className="inline-flex items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700 disabled:opacity-50"
      >
        {busy && <SpinnerIcon className="animate-spin" width={11} height={11} />}
        {pending ? 'Hearing the mic…' : status === 'failed' || status === 'skipped' ? 'Hear the mic again' : 'Hear the mic'}
      </button>
      {note ? <p className="mt-1 max-w-[14rem] text-[10.5px] text-ink-500">{note}</p> : null}
    </div>
  );
}

function transcriptPlainText(video: ProofVideoRecord): string {
  const captions = captionsForVideo(video);
  if (captions?.segments?.length) {
    return captions.segments
      .map((row) => {
        const who = row.speakerLabel ? `${row.speakerLabel}: ` : '';
        return `${who}${row.text}`;
      })
      .join('\n');
  }
  return String(captions?.transcriptText || video.heardOnMic || '').trim();
}

function CopyTranscriptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      data-testid="copy-transcript"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          },
          () => {
            window.prompt('Copy transcript', text);
          },
        );
      }}
      className="rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function VideoCatalog({
  jobId,
  videos,
  videoFetcher,
  seekProofId,
  seekAt,
  seekNonce,
}: {
  jobId?: string;
  videos: ProofVideoRecord[];
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  seekProofId?: string | null;
  seekAt?: number | null;
  seekNonce?: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (seekProofId) setOpenId(seekProofId);
  }, [seekProofId, seekNonce]);

  if (!videos.length) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line" data-testid="job-video-list">
      <ul>
        {videos.map((video) => {
          const open = openId === video.id;
          const captions = captionsForVideo(video);
          const plain = transcriptPlainText(video);
          const hasTranscript = Boolean(plain);
          return (
            <li
              key={video.id}
              className="border-b border-line/70 last:border-b-0"
              data-testid="job-video-row"
              data-job-clip-date={video.workDate}
              data-open={open ? '1' : undefined}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setOpenId(open ? null : video.id)}
                  aria-expanded={open}
                >
                  <p className="text-xs font-medium text-ink-800">
                    {new Date(`${video.workDate}T12:00:00Z`).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    <span className="ml-1.5 font-normal text-ink-500">
                      {video.company || 'Field Capture'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    {formatClipLength(video.durationSeconds)}
                    {' · '}
                    Mic: {statusWord(video.transcriptStatus, 'heard')}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!open ? (
                    <button
                      type="button"
                      onClick={() => setOpenId(video.id)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700"
                    >
                      Play
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>

              {open ? (
                <div className="space-y-3 border-t border-line/70 bg-paper-50/40 px-3 py-3" data-testid="job-video-expansion">
                  <ClipPlayer
                    proofId={video.id}
                    videoFetcher={videoFetcher}
                    seekAt={seekProofId === video.id ? seekAt : null}
                    seekNonce={seekProofId === video.id ? seekNonce : 0}
                    autoOpen
                    captions={captions}
                    privacyRedactions={video.privacyRedactions?.ranges ?? null}
                    childPrivacyRedactions={video.childPrivacyRedactions?.ranges ?? null}
                  />
                  {video.privacyRedactions?.ranges?.length || video.childPrivacyRedactions?.ranges?.length ? (
                    <p
                      className="text-[10px] text-ink-400"
                      data-testid="privacy-redaction-review"
                      title={[
                        ...(video.privacyRedactions?.ranges ?? []).map(
                          (r) =>
                            `${Math.round(r.startSec)}s–${Math.round(r.endSec)}s · ${r.reason} (${Math.round(r.confidence * 100)}%)`,
                        ),
                        ...(video.childPrivacyRedactions?.ranges ?? []).map(
                          (r) =>
                            `${Math.round(r.startSec)}s–${Math.round(r.endSec)}s · child · ${r.reason} (${Math.round(r.confidence * 100)}%)`,
                        ),
                      ].join('\n')}
                    >
                      Privacy-protected ·{' '}
                      {(video.privacyRedactions?.ranges?.length ?? 0) +
                        (video.childPrivacyRedactions?.ranges?.length ?? 0)}{' '}
                      segment
                      {(video.privacyRedactions?.ranges?.length ?? 0) +
                        (video.childPrivacyRedactions?.ranges?.length ?? 0) ===
                      1
                        ? ''
                        : 's'}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {hasTranscript ? <CopyTranscriptButton text={plain} /> : null}
                    {jobId && video.transcriptStatus !== 'done' ? (
                      <HearMicButton jobId={jobId} proofId={video.id} status={video.transcriptStatus} />
                    ) : null}
                  </div>
                  {hasTranscript ? (
                    <div className="-mt-1">
                      <VerbatimTranscript
                        segments={captions?.segments}
                        transcriptText={captions?.transcriptText ?? video.heardOnMic}
                      />
                    </div>
                  ) : (
                    <p className="text-[12px] text-ink-500" data-testid="transcript-empty">
                      {video.transcriptStatus === 'queued' || video.transcriptStatus === 'running'
                        ? 'Hearing the mic…'
                        : video.transcriptStatus === 'skipped' || video.transcriptStatus === 'failed'
                          ? video.transcriptError || 'No transcript on this clip yet.'
                          : 'No transcript on this clip yet.'}
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MeasuredVideo({
  src,
  className,
  seekTo,
  seekNonce = 0,
  captions,
  privacyRedactions,
  childPrivacyRedactions,
  onTimeUpdate,
}: {
  src: string;
  className?: string;
  seekTo?: number | null;
  seekNonce?: number;
  captions?: JobFilePlayerCaptions | null;
  privacyRedactions?: import('../../lib/api').PrivacyRedactionRange[] | null;
  childPrivacyRedactions?: import('../../lib/api').ChildPrivacyRedactionRange[] | null;
  onTimeUpdate?: (seconds: number) => void;
}) {
  return (
    <JobFilePlayer
      src={src}
      className={className}
      seekTo={seekTo}
      seekNonce={seekNonce}
      captions={captions}
      knownDurationSeconds={captions?.durationSeconds}
      privacyRedactions={privacyRedactions}
      childPrivacyRedactions={childPrivacyRedactions}
      onTimeUpdate={onTimeUpdate}
    />
  );
}


function ClipPlayer({
  proofId,
  videoFetcher,
  seekAt,
  seekNonce,
  autoOpen = false,
  captions,
  privacyRedactions,
  childPrivacyRedactions,
  onTimeUpdate,
}: {
  proofId: string;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  seekAt?: number | null;
  seekNonce?: number;
  autoOpen?: boolean;
  captions?: JobFilePlayerCaptions | null;
  privacyRedactions?: import('../../lib/api').PrivacyRedactionRange[] | null;
  childPrivacyRedactions?: import('../../lib/api').ChildPrivacyRedactionRange[] | null;
  onTimeUpdate?: (seconds: number) => void;
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

  useEffect(() => {
    if (!autoOpen || url || loading || failed) return;
    void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, proofId]);

  if (url) {
    return (
      <MeasuredVideo
        src={url}
        seekTo={seekAt}
        seekNonce={seekNonce}
        captions={captions}
        privacyRedactions={privacyRedactions}
        childPrivacyRedactions={childPrivacyRedactions}
        onTimeUpdate={onTimeUpdate}
        className="block max-h-56 w-full rounded-lg bg-black"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={loading || failed}
      className="flex h-40 w-full items-center justify-center gap-2 rounded-lg border border-line bg-paper-100 text-xs text-ink-600 disabled:opacity-50"
    >
      {loading && <SpinnerIcon className="animate-spin" width={14} height={14} />}
      {failed ? 'Could not load' : loading ? 'Loading…' : 'Play'}
    </button>
  );
}
