/**
 * Office mirror of backend/src/shared/clipProcessing.ts.
 * Keep the decision table identical. States:
 * uploading, uploaded, transcribing, analyzing, ready, failed.
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
  proofState?: string | null;
  analysisStatus?: string | null;
  transcriptStatus?: string | null;
  narrationStatus?: string | null;
  summaryState?: string | null;
  hasSummary?: boolean | null;
  noSpeech?: boolean | null;
  uploading?: boolean | null;
  retrying?: boolean | null;
  transcriptActive?: boolean | null;
  analysisActive?: boolean | null;
  narrationActive?: boolean | null;
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
