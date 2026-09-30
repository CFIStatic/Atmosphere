/**
 * One clip-processing state for every surface.
 *
 * uploading     — bytes are still arriving ("Uploading")
 * uploaded      — the file is here and reading has not started
 *                 ("Waiting to process" when the proof is uploaded, "Recorded" otherwise)
 * transcribing  — speech-to-text is queued or running on a live lease ("Transcribing")
 * analyzing     — vision / narration is in progress on a live lease ("Analyzing"),
 *                 a failed step is being run again ("Retrying"), or a summary is
 *                 being built and none is stored yet ("Summary still processing")
 * ready         — the reading that exists is current ("Analyzed"), or the clip
 *                 was heard and had no speech ("No speech")
 * failed        — the reading or the summary failed, or integrity checks failed
 *                 ("Needs attention", "Summary unavailable", or "N checks failed")
 *
 * A stored summary is never "Summary still processing". That label is only for
 * a summary that does not exist yet while a summary job is still live.
 * A queued/running status whose lease has expired is not an active job: it
 * must not sit on Transcribing / Analyzing / Summary still processing.
 * `proof.state = checked` means integrity checks ran, not that vision is
 * still going. A finished analysis wins. Checked is Analyzing only before
 * vision is queued; a queued or running column counts only on a live lease.
 *
 * The office UI mirrors this function in frontend/src/lib/clipProcessing.ts.
 * The verifier dashboard mirrors it in clipProcessingOf() in verifier/index.html.
 * Keep the three decision tables identical.
 */

export const CLIP_PROCESSING_STATES = [
  'uploading',
  'uploaded',
  'transcribing',
  'analyzing',
  'ready',
  'failed',
] as const;

export type ClipProcessingState = (typeof CLIP_PROCESSING_STATES)[number];

export type ClipProcessingTone = 'neutral' | 'progress' | 'good' | 'bad';

export type ClipProcessingInput = {
  /** job_proofs.state: uploaded | checked | analysed | accepted | rejected */
  proofState?: string | null;
  analysisStatus?: string | null;
  transcriptStatus?: string | null;
  narrationStatus?: string | null;
  /** fresh | updating | quarantined | failed | untracked | none */
  summaryState?: string | null;
  /** A summary document is stored (ai_summary and/or conversation / evidence log). */
  hasSummary?: boolean | null;
  /** Transcript settled with no speech (skipped or empty because nothing was said). */
  noSpeech?: boolean | null;
  /** Bytes have not finished landing. */
  uploading?: boolean | null;
  /** A failed step is running again on a live lease. */
  retrying?: boolean | null;
  /**
   * False means that stage's queued/running/pending flag is stale (no live lease).
   * Omit to treat a busy status as live — callers that do not know about leases.
   */
  transcriptActive?: boolean | null;
  analysisActive?: boolean | null;
  narrationActive?: boolean | null;
  /** False means a summary rebuild flag is not backed by a live job. */
  summaryActive?: boolean | null;
  failedChecks?: number | null;
};

export type ClipProcessing = {
  state: ClipProcessingState;
  label: string;
  tone: ClipProcessingTone;
};

function norm(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function busy(value: string): boolean {
  return value === 'queued' || value === 'running' || value === 'pending';
}

/** A busy column counts only while its job is live. An omitted flag means "caller doesn't know". */
function stageLive(status: string, active: boolean | null | undefined): boolean {
  if (!busy(status)) return false;
  if (active === false) return false;
  return true;
}

export function clipProcessing(input: ClipProcessingInput = {}): ClipProcessing {
  const proof = norm(input.proofState);
  const analysis = norm(input.analysisStatus);
  const transcript = norm(input.transcriptStatus);
  const narration = norm(input.narrationStatus);
  const summary = norm(input.summaryState);
  const failedChecks = Number(input.failedChecks ?? 0);
  const hasSummary = input.hasSummary === true;
  const noSpeech = input.noSpeech === true;

  if (input.uploading) {
    return { state: 'uploading', label: 'Uploading', tone: 'progress' };
  }
  if (Number.isFinite(failedChecks) && failedChecks > 0) {
    return {
      state: 'failed',
      label: `${failedChecks} check${failedChecks === 1 ? '' : 's'} failed`,
      tone: 'bad',
    };
  }
  if (analysis === 'failed' || narration === 'failed' || summary === 'failed') {
    if (summary === 'failed' && analysis !== 'failed' && narration !== 'failed') {
      return { state: 'failed', label: 'Summary unavailable', tone: 'bad' };
    }
    return { state: 'failed', label: 'Needs attention', tone: 'bad' };
  }
  if (stageLive(transcript, input.transcriptActive)) {
    if (input.retrying) return { state: 'transcribing', label: 'Retrying', tone: 'progress' };
    return { state: 'transcribing', label: 'Transcribing', tone: 'progress' };
  }
  if (stageLive(analysis, input.analysisActive) || stageLive(narration, input.narrationActive)) {
    if (input.retrying) return { state: 'analyzing', label: 'Retrying', tone: 'progress' };
    return { state: 'analyzing', label: 'Analyzing', tone: 'progress' };
  }
  // Checked is filed before vision is queued. That gap is Analyzing.
  // A queued/running column was already decided above: a live lease is
  // Analyzing, and a dead lease must not stick there.
  const analysisSettled = analysis === 'done' || analysis === 'skipped';
  const narrationSettled = narration === 'done' || narration === 'skipped';
  if (
    proof === 'checked' &&
    !analysisSettled &&
    !narrationSettled &&
    !busy(analysis) &&
    !busy(narration)
  ) {
    return { state: 'analyzing', label: 'Analyzing', tone: 'progress' };
  }
  // A stored summary is never "still processing". A rebuild flag with no live
  // lease is not processing either — it must not stick after the worker is gone.
  const summaryLive = input.summaryActive !== false;
  if (!hasSummary && summaryLive && (summary === 'updating' || summary === 'quarantined')) {
    return { state: 'analyzing', label: 'Summary still processing', tone: 'progress' };
  }
  const read =
    analysis === 'done' ||
    narration === 'done' ||
    proof === 'analysed' ||
    proof === 'analyzed' ||
    proof === 'accepted' ||
    proof === 'rejected' ||
    summary === 'fresh' ||
    hasSummary;
  if (noSpeech && !read) return { state: 'ready', label: 'No speech', tone: 'good' };
  if (read || noSpeech) return { state: 'ready', label: 'Analyzed', tone: 'good' };
  if (proof === 'uploaded' || analysis === 'uploaded') {
    return { state: 'uploaded', label: 'Waiting to process', tone: 'neutral' };
  }
  return { state: 'uploaded', label: 'Recorded', tone: 'neutral' };
}
