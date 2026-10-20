import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type ProofResponse,
  type ProofQuestion,
  type ProofVideoRecord,
  type ClipSummaryFeedback,
  type ClipSummaryFeedbackReason,
} from '../../lib/api';
import { ClipSummaryRating } from './ClipSummaryRating';
import { formatClipLength } from '../../lib/clipDuration';
import {
  clipClock,
  clipDisplayTitle,
  clipMoments,
  momentClock,
  videoRowStatus,
  type LibraryClipMeta,
  type VideoRowTone,
} from '../../lib/jobVideoRows';
import { JobFilePlayer, type JobFilePlayerCaptions } from './JobFilePlayer';
import { useVideoSeek } from '../../lib/videoSeek';
import type { AskSeekTarget } from '../../lib/askSeek';
import { SpinnerIcon } from '../icons';
import { useVisiblePolling } from '../../hooks/useVisiblePolling';
import { VerbatimTranscript } from '../analysis/VerbatimTranscript';
import { SpeakerRenameControl, type ClipSpeaker } from '../analysis/SpeakerRenameControl';
import { expandMentionTokens } from '../../lib/mentions';
import { AskProseView } from '../AskProseView';
import { MentionText } from '../mentions/MentionText';
import { MentionTextarea } from '../mentions/MentionTextarea';
import { loadOrgMentions } from '../mentions/useOrgMentions';

/**
 * Proof of work — light job-file Videos surface.
 *
 * The job's video library: every recorded clip as a searchable, sortable grid.
 * Opening one shows the player, its moments, transcript (Copy) and Download.
 * Disputes, rooms and dense analysis stay with Ask and the job file report
 * (JobFileReport) — not piled onto the library.
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

/** jobProofs with two quick retries for a transient gateway error. */
async function jobProofsWithRetry(jobId: string, delaysMs: number[] = [800, 2000]) {
  let last: unknown;
  for (let i = 0; i <= delaysMs.length; i += 1) {
    try {
      return await api.jobProofs(jobId);
    } catch (err) {
      last = err;
      if (i < delaysMs.length) await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
  }
  throw last;
}

export function ProofOfWork({
  jobId,
  heading = 'Videos',
  readOnly = false,
  initialData,
  videoFetcher,
  showCollectionAsk = true,
  allowDownload = false,
  rateSummaries = false,
}: {
  jobId?: string;
  heading?: string;
  readOnly?: boolean;
  initialData?: ProofResponse;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  /** Office job file already pins Ask — hide the second collection form. */
  showCollectionAsk?: boolean;
  /** Office copy of the original file. Off for homeowners and guests. */
  allowDownload?: boolean;
  /** Show each clip's AI summary with thumbs up / down and Fix it. Office members only. */
  rateSummaries?: boolean;
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
        // A momentary 502/503 on first open used to paint "Nothing filed yet"
        // over a job full of clips. Retry briefly before giving up.
        opts?.silent ? api.jobProofs(jobId) : jobProofsWithRetry(jobId),
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
      // Never show an empty list because a request failed: keep what is on
      // screen (or Loading…) and let the 12-second refresh fill it in.
      if (!opts?.silent) {
        setError(
          err instanceof Error && !/not reachable|API_UPSTREAM/i.test(err.message)
            ? err.message
            : 'Could not load the videos just now. Retrying…',
        );
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
    const raw = question.trim();
    if (!raw || !jobId) return;
    setAsking(true);
    setError(null);
    try {
      const members = raw.includes('@') ? await loadOrgMentions(jobId) : [];
      await api.askAboutProofs(jobId, expandMentionTokens(raw, members));
      setQuestion('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer that.');
    } finally {
      setAsking(false);
    }
  }

  const allVideos = data?.videos ?? [];
  const totalSeconds = allVideos.reduce((sum, video) => sum + (video.durationSeconds ?? 0), 0);

  return (
    <section className="rounded-xl glass-card p-5" data-job-section="videos" data-testid="proof-of-work">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-ink-900">{heading}</h2>
        {allVideos.length > 0 && (
          <span className="text-xs text-ink-500" data-testid="job-video-count">
            {allVideos.length} video{allVideos.length === 1 ? '' : 's'} on file
            {totalSeconds > 0 ? ` · ${formatClipLength(totalSeconds)} in all` : ''}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Every video recorded on this job, kept in one place. Open one to watch it, read the
        transcript, or download it.
      </p>
      {data?.viewerScope?.role === 'subcontractor' && (
        <p className="mt-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-600" data-testid="sub-video-scope">
          You're on this job as {data.viewerScope.company ? `${data.viewerScope.company}, a subcontractor` : 'a subcontractor'}, so
          you see only the videos you recorded. To see every video, ask the contractor to add you under Share
          &gt; Homeowner.
        </p>
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
        <>
          <VideoCatalog
            jobId={jobId}
            videos={data.videos ?? []}
            videoFetcher={videoFetcher}
            allowDownload={allowDownload && Boolean(jobId)}
            rateSummaries={rateSummaries && Boolean(jobId)}
            seekProofId={seekProofId}
            seekAt={seekAt}
            seekNonce={seekNonce}
            onSeek={applyClipSeek}
          />
        </>
      )}

      {!readOnly && showCollectionAsk && data && ((data.videos?.length ?? 0) > 0 || data.days.length > 0) && (
        <div className="mt-4 border-t border-line pt-3">
          <form onSubmit={ask} className="flex items-end gap-2">
            <MentionTextarea
              value={question}
              onChange={setQuestion}
              rows={1}
              jobId={jobId}
              placeholder="Ask the video collection — e.g. when was the subfloor first visible?"
              className="min-h-9 w-full resize-none rounded-lg glass-field px-3 py-2 text-xs text-ink-900 outline-hidden focus:ring-2 focus:ring-brand-200"
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
                    <p className="text-[11px] font-medium text-ink-700">
                      <MentionText text={q.question} />
                    </p>
                    <div className="mt-0.5 text-xs text-ink-800">
                      <AskProseView text={q.answer ?? ''} />
                    </div>
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

function captionsForVideo(video: ProofVideoRecord | undefined | null): JobFilePlayerCaptions | null {
  if (!video) return null;
  const transcriptText =
    video.transcriptText ?? video.heardOnMic ?? video.conversation?.transcriptText ?? null;
  const segments = video.transcriptSegments ?? video.conversation?.transcriptSegments ?? null;
  const words = video.transcriptWords ?? null;
  const hasText =
    Boolean(String(transcriptText || '').trim()) || Boolean(segments?.length) || Boolean(words?.length);
  const pending =
    video.transcriptStatus === 'queued' || video.transcriptStatus === 'running';
  if (!hasText) {
    return { transcriptText: null, segments: null, durationSeconds: video.durationSeconds, status: pending ? 'pending' : 'unavailable' };
  }
  return {
    transcriptText,
    segments,
    words,
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
      {note ? <p className="mt-1 max-w-56 text-[10.5px] text-ink-500">{note}</p> : null}
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

const ROW_TONE: Record<VideoRowTone, string> = {
  good: 'bg-success-50 text-success-600',
  progress: 'bg-brand-50 text-brand-700',
  bad: 'bg-danger-50 text-danger-600',
  neutral: 'bg-paper-200/60 text-ink-600',
};

/**
 * Refetch when a clip is added or its reading finishes. Count alone stays
 * put while analysis writes the Dashboard title and poster onto an existing row.
 */
function libraryClipMetaKey(videos: ProofVideoRecord[]): string {
  return videos
    .map((video) =>
      [
        video.id,
        video.analysisStatus ?? '',
        video.narrationStatus ?? '',
        video.transcriptStatus ?? '',
      ].join(':'),
    )
    .join('|');
}

/**
 * Titles and poster stills from the Dashboard's library rows, so the Videos
 * tab names a clip exactly as the Dashboard does, for the contractor and for
 * anyone the job is shared with (the library answers job viewers too).
 */
function useLibraryClipMeta(jobId: string | undefined, videos: ProofVideoRecord[]) {
  const [meta, setMeta] = useState<Map<string, LibraryClipMeta>>(() => new Map());
  const refreshKey = libraryClipMetaKey(videos);
  useEffect(() => {
    if (!jobId || !refreshKey) return;
    let cancelled = false;
    void api
      .evidenceLibrary(jobId)
      .then((res) => {
        if (cancelled) return;
        const next = new Map<string, LibraryClipMeta>();
        for (const item of (res.items ?? []) as LibraryClipMeta[]) {
          if (item?.id && item.jobId === jobId) next.set(item.id, item);
        }
        setMeta(next);
      })
      .catch(() => {
        /* rows keep the Video · id fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);
  return meta;
}

interface ClipSummaryFeedbackState {
  byClip: Record<string, ClipSummaryFeedback>;
  rate: (
    proofId: string,
    rating: 1 | -1 | 0,
    extra?: { reason?: ClipSummaryFeedbackReason | null; correctedText?: string | null },
  ) => Promise<void>;
}

/** This person's ratings on the job's clip summaries, loaded once per job. */
function useClipSummaryFeedback(jobId: string | undefined): ClipSummaryFeedbackState {
  // Keyed by job so another job's ratings never show while this one loads.
  const [loaded, setLoaded] = useState<{ jobId: string; byClip: Record<string, ClipSummaryFeedback> } | null>(null);
  const byClip = loaded && loaded.jobId === jobId ? loaded.byClip : {};
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    void api
      .clipSummaryFeedback(jobId)
      .then((res) => {
        if (!cancelled) setLoaded({ jobId, byClip: res.feedback ?? {} });
      })
      .catch(() => {
        /* no ratings shown; rating still works */
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);
  return {
    byClip,
    async rate(proofId, rating, extra) {
      if (!jobId) return;
      const res = await api.rateClipSummary(jobId, proofId, rating, extra);
      setLoaded((prev) => {
        const next = { ...(prev && prev.jobId === jobId ? prev.byClip : {}) };
        if (res.feedback) next[proofId] = res.feedback;
        else delete next[proofId];
        return { jobId, byClip: next };
      });
    },
  };
}

function ClipSpeakerList({ jobId, proofId }: { jobId: string; proofId: string }) {
  const [speakers, setSpeakers] = useState<ClipSpeaker[]>([]);
  useEffect(() => {
    const load = (api as { clipSpeakers?: (job: string, proof: string) => Promise<{ speakers: ClipSpeaker[] }> }).clipSpeakers;
    if (!load) return;
    void load(jobId, proofId)
      .then((res) =>
        setSpeakers(
          (res.speakers ?? []).map((row) => ({
            speakerLabel: row.speakerLabel,
            confirmedName: row.confirmedName,
            role: row.role,
            roleStatus: row.roleStatus,
            quote: row.quote,
            tSec: row.tSec,
          })),
        ),
      )
      .catch(() => undefined);
  }, [jobId, proofId]);
  if (!speakers.length) return null;
  return (
    <div className="space-y-2" data-testid="clip-speakers">
      {speakers.map((speaker) => (
        <SpeakerRenameControl
          key={speaker.speakerLabel}
          speaker={speaker}
          onSave={(input) => {
            const save = (api as { correctClipSpeaker?: (job: string, proof: string, body: typeof input) => Promise<unknown> }).correctClipSpeaker;
            setSpeakers((rows) =>
              rows.map((row) =>
                row.speakerLabel === input.speakerLabel
                  ? {
                      ...row,
                      confirmedName: input.displayName ?? row.confirmedName,
                      role: input.role ?? row.role,
                      roleStatus: input.role ? 'corrected' : row.roleStatus,
                    }
                  : row,
              ),
            );
            if (save) void save(jobId, proofId, input).catch(() => undefined);
          }}
        />
      ))}
    </div>
  );
}

type VideoSort = 'newest' | 'oldest' | 'longest' | 'title';

const SORT_LABELS: Record<VideoSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  longest: 'Longest first',
  title: 'Title A–Z',
};

/** When the clip was filmed: the device clock when we have it, else the work day. */
function filmedAtMs(video: ProofVideoRecord): number {
  const captured = video.capturedAt ? Date.parse(video.capturedAt) : NaN;
  if (Number.isFinite(captured)) return captured;
  const day = Date.parse(`${video.workDate}T12:00:00Z`);
  return Number.isFinite(day) ? day : 0;
}

function filmedDay(video: ProofVideoRecord): string {
  const date = new Date(`${video.workDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return video.workDate;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

function filmedTime(video: ProofVideoRecord): string | null {
  if (!video.capturedAt) return null;
  const at = new Date(video.capturedAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function filmedBy(video: ProofVideoRecord): string {
  return String(video.person || video.company || '').trim();
}

interface LibraryRow {
  video: ProofVideoRecord;
  meta: LibraryClipMeta | null;
  title: string;
  day: string;
  time: string | null;
  by: string;
  at: number;
}

function DownloadVideoButton({ proofId }: { proofId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const { url } = await api.proofDownloadUrl(proofId);
      // The signed URL is an attachment, so the browser saves it in place.
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      data-testid="download-video"
      className="inline-flex items-center gap-1.5 rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700 disabled:opacity-50"
    >
      {busy && <SpinnerIcon className="animate-spin" width={11} height={11} />}
      {failed ? 'Could not download — try again' : 'Download'}
    </button>
  );
}

function VideoCatalog({
  jobId,
  videos,
  videoFetcher,
  allowDownload = false,
  rateSummaries = false,
  seekProofId,
  seekAt,
  seekNonce,
  onSeek,
}: {
  jobId?: string;
  videos: ProofVideoRecord[];
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  allowDownload?: boolean;
  rateSummaries?: boolean;
  seekProofId?: string | null;
  seekAt?: number | null;
  seekNonce?: number;
  /** Open a clip at a moment (jump-to-moment chips). */
  onSeek?: (proofId: string, seconds: number) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<VideoSort>('newest');
  const [who, setWho] = useState('');
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const scrollOnOpen = useRef(false);
  const library = useLibraryClipMeta(jobId, videos);
  const summaryFeedback = useClipSummaryFeedback(rateSummaries ? jobId : undefined);

  useEffect(() => {
    if (seekProofId) setOpenId(seekProofId);
  }, [seekProofId, seekNonce]);

  useEffect(() => {
    if (!openId || !scrollOnOpen.current) return;
    scrollOnOpen.current = false;
    viewerRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [openId]);

  if (!videos.length) return null;

  const rows: LibraryRow[] = videos.map((video) => {
    const meta = library.get(video.id) ?? null;
    return {
      video,
      meta,
      title: clipDisplayTitle(video, meta),
      day: filmedDay(video),
      time: filmedTime(video),
      by: filmedBy(video),
      at: filmedAtMs(video),
    };
  });
  const filmers = Array.from(new Set(rows.map((row) => row.by).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows
    .filter((row) => !who || row.by === who)
    .filter((row) => {
      if (!terms.length) return true;
      const haystack = [row.title, row.by, row.day, row.video.workDate].join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => {
      if (sort === 'oldest') return a.at - b.at;
      if (sort === 'longest') return (b.video.durationSeconds ?? 0) - (a.video.durationSeconds ?? 0);
      if (sort === 'title') return a.title.localeCompare(b.title);
      return b.at - a.at;
    });
  const openRow = rows.find((row) => row.video.id === openId) ?? null;
  const filtering = Boolean(terms.length || who);

  function openVideo(id: string) {
    scrollOnOpen.current = true;
    setOpenId(id);
  }

  return (
    <div className="mt-3" data-testid="job-video-library">
      {videos.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="job-video-toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, date or who filmed"
            aria-label="Search videos"
            className="min-w-48 flex-1 rounded-lg glass-field px-3 py-1.5 text-xs text-ink-900 outline-hidden focus:ring-2 focus:ring-brand-200"
          />
          {filmers.length > 1 ? (
            <select
              value={who}
              onChange={(event) => setWho(event.target.value)}
              aria-label="Filmed by"
              className="rounded-lg glass-field px-2.5 py-1.5 text-xs text-ink-800 outline-hidden"
            >
              <option value="">Everyone</option>
              {filmers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as VideoSort)}
            aria-label="Sort videos"
            className="rounded-lg glass-field px-2.5 py-1.5 text-xs text-ink-800 outline-hidden"
          >
            {(Object.keys(SORT_LABELS) as VideoSort[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {openRow ? (
        <div ref={viewerRef} className="mt-3 scroll-mt-4">
          <VideoViewer
            row={openRow}
            jobId={jobId}
            videoFetcher={videoFetcher}
            allowDownload={allowDownload}
            summaryFeedback={rateSummaries ? summaryFeedback : null}
            seekAt={seekProofId === openRow.video.id ? seekAt : null}
            seekNonce={seekProofId === openRow.video.id ? seekNonce : 0}
            onSeek={onSeek}
            onClose={() => setOpenId(null)}
          />
        </div>
      ) : null}

      {shown.length ? (
        <ul
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="job-video-list"
        >
          {shown.map((row) => {
            const { video, meta, title } = row;
            const status = videoRowStatus(video);
            const open = openId === video.id;
            return (
              <li
                key={video.id}
                data-testid="job-video-row"
                data-job-clip-date={video.workDate}
                data-open={open ? '1' : undefined}
              >
                <button
                  type="button"
                  onClick={() => openVideo(video.id)}
                  aria-label={`Play ${title}`}
                  aria-pressed={open}
                  className={`group block w-full overflow-hidden rounded-lg border text-left transition-colors ${
                    open ? 'border-brand-400 ring-2 ring-brand-200' : 'border-line hover:border-brand-300'
                  }`}
                >
                  <span
                    className="relative block aspect-video w-full overflow-hidden bg-paper-200"
                    data-testid="job-video-thumb"
                  >
                    {meta?.posterUrl ? (
                      <img
                        src={meta.posterUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-ink-400" aria-hidden>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </span>
                    )}
                    <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                      {clipClock(video.durationSeconds)}
                    </span>
                  </span>
                  <span className="block px-3 py-2.5">
                    <span
                      className="block truncate text-sm font-medium text-ink-900"
                      data-testid="job-video-title"
                    >
                      {title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                      {row.day}
                      {row.time ? ` · ${row.time}` : ''}
                      {row.by ? ` · ${row.by}` : ''}
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROW_TONE[status.tone]}`}
                        data-testid="job-video-status"
                      >
                        {status.label}
                      </span>
                      <span>{formatClipLength(video.durationSeconds)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg border border-line px-4 py-3 text-sm text-ink-600" data-testid="job-video-none">
          No videos match.{' '}
          {filtering ? (
            <button
              type="button"
              className="font-medium text-brand-700 underline-offset-2 hover:underline"
              onClick={() => {
                setQuery('');
                setWho('');
              }}
            >
              Show all
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}

function VideoViewer({
  row,
  jobId,
  videoFetcher,
  allowDownload,
  summaryFeedback,
  seekAt,
  seekNonce,
  onSeek,
  onClose,
}: {
  row: LibraryRow;
  jobId?: string;
  videoFetcher?: (proofId: string) => Promise<{ url: string }>;
  allowDownload: boolean;
  summaryFeedback?: ClipSummaryFeedbackState | null;
  seekAt?: number | null;
  seekNonce?: number;
  onSeek?: (proofId: string, seconds: number) => void;
  onClose: () => void;
}) {
  const { video, title } = row;
  const summary = video.aiSummary?.trim() || null;
  const captions = captionsForVideo(video);
  const plain = transcriptPlainText(video);
  const hasTranscript = Boolean(plain);
  const moments = clipMoments(video, 12);
  const status = videoRowStatus(video);
  const redactions =
    (video.privacyRedactions?.ranges?.length ?? 0) + (video.childPrivacyRedactions?.ranges?.length ?? 0);
  return (
    <div
      className="space-y-3 rounded-lg border border-line bg-paper-50/40 p-3"
      data-testid="job-video-expansion"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">{title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-500">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROW_TONE[status.tone]}`}>
              {status.label}
            </span>
            <span>
              {row.day}
              {row.time ? ` · ${row.time}` : ''}
            </span>
            <span aria-hidden>·</span>
            <span>{formatClipLength(video.durationSeconds)}</span>
            {row.by ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{row.by}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {allowDownload ? <DownloadVideoButton proofId={video.id} /> : null}
          {hasTranscript ? <CopyTranscriptButton text={plain} /> : null}
          {jobId && video.transcriptStatus !== 'done' ? (
            <HearMicButton jobId={jobId} proofId={video.id} status={video.transcriptStatus} />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-lg glass-card px-2.5 py-1 text-[11px] font-medium text-ink-700"
          >
            Close
          </button>
        </div>
      </div>
      <ClipPlayer
        key={video.id}
        proofId={video.id}
        videoFetcher={videoFetcher}
        seekAt={seekAt}
        seekNonce={seekNonce}
        autoOpen
        captions={captions}
        privacyRedactions={video.privacyRedactions?.ranges ?? null}
        childPrivacyRedactions={video.childPrivacyRedactions?.ranges ?? null}
      />
      {redactions ? (
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
          Privacy-protected · {redactions} segment{redactions === 1 ? '' : 's'}
        </p>
      ) : null}
      {summaryFeedback && summary ? (
        <ClipSummaryRating
          summary={summary}
          feedback={summaryFeedback.byClip[video.id] ?? null}
          onRate={(rating, extra) => summaryFeedback.rate(video.id, rating, extra)}
        />
      ) : null}
      {moments.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="job-video-moments">
          {moments.map((moment) => (
            <button
              key={moment.atSeconds}
              type="button"
              title={moment.text}
              aria-label={`Jump to ${momentClock(moment.atSeconds)}: ${moment.text}`}
              onClick={() => onSeek?.(video.id, moment.atSeconds)}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-line bg-paper-0/70 px-2 py-0.5 text-[11px] text-ink-700 hover:border-brand-300"
            >
              <span className="font-semibold tabular-nums text-brand-700">{momentClock(moment.atSeconds)}</span>
              <span className="truncate">{moment.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      {jobId ? <ClipSpeakerList jobId={jobId} proofId={video.id} /> : null}
      {hasTranscript ? (
        <VerbatimTranscript
          segments={captions?.segments}
          transcriptText={captions?.transcriptText ?? video.heardOnMic}
        />
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
  onPlaybackError,
  resumeAt,
  resumePlaying,
}: {
  src: string;
  className?: string;
  seekTo?: number | null;
  seekNonce?: number;
  captions?: JobFilePlayerCaptions | null;
  privacyRedactions?: import('../../lib/api').PrivacyRedactionRange[] | null;
  childPrivacyRedactions?: import('../../lib/api').ChildPrivacyRedactionRange[] | null;
  onTimeUpdate?: (seconds: number) => void;
  onPlaybackError?: (info: { currentTime: number; wasPlaying: boolean }) => void;
  resumeAt?: number | null;
  resumePlaying?: boolean;
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
      onPlaybackError={onPlaybackError}
      resumeAt={resumeAt}
      resumePlaying={resumePlaying}
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
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [resumePlaying, setResumePlaying] = useState(false);
  const refreshCount = useRef(0);

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
        resumeAt={resumeAt}
        resumePlaying={resumePlaying}
        onPlaybackError={(info) => {
          if (refreshCount.current >= 1) return;
          refreshCount.current += 1;
          setResumeAt(info.currentTime);
          setResumePlaying(info.wasPlaying);
          void open();
        }}
        className="block aspect-video max-h-[60vh] w-full rounded-lg bg-black object-contain"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={loading || failed}
      className="flex aspect-video max-h-[60vh] w-full items-center justify-center gap-2 rounded-lg border border-line bg-paper-100 text-xs text-ink-600 disabled:opacity-50"
    >
      {loading && <SpinnerIcon className="animate-spin" width={14} height={14} />}
      {failed ? 'Could not load' : loading ? 'Loading…' : 'Play'}
    </button>
  );
}
