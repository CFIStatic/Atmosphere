/**
 * Office mirror of backend/src/shared/clipProcessing.ts.
 * Keep the decision table identical. States:
 * uploaded, transcribing, analyzing, ready, failed.
 */

export const CLIP_PROCESSING_STATES = ['uploaded', 'transcribing', 'analyzing', 'ready', 'failed'] as const;

export type ClipProcessingState = (typeof CLIP_PROCESSING_STATES)[number];

export type ClipProcessingTone = 'neutral' | 'progress' | 'good' | 'bad';

export type ClipProcessingInput = {
  proofState?: string | null;
  analysisStatus?: string | null;
  transcriptStatus?: string | null;
  narrationStatus?: string | null;
  summaryState?: string | null;
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

export function clipProcessing(input: ClipProcessingInput = {}): ClipProcessing {
  const proof = norm(input.proofState);
  const analysis = norm(input.analysisStatus);
  const transcript = norm(input.transcriptStatus);
  const narration = norm(input.narrationStatus);
  const summary = norm(input.summaryState);
  const failedChecks = Number(input.failedChecks ?? 0);

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
  if (busy(transcript)) {
    return { state: 'transcribing', label: 'Transcribing', tone: 'progress' };
  }
  if (busy(analysis) || busy(narration) || proof === 'checked') {
    return { state: 'analyzing', label: 'Analyzing', tone: 'progress' };
  }
  if (summary === 'updating' || summary === 'quarantined') {
    return { state: 'analyzing', label: 'Summary still processing', tone: 'progress' };
  }
  const read =
    analysis === 'done' ||
    proof === 'analysed' ||
    proof === 'analyzed' ||
    proof === 'accepted' ||
    proof === 'rejected' ||
    summary === 'fresh';
  if (read) return { state: 'ready', label: 'Analyzed', tone: 'good' };
  if (proof === 'uploaded') return { state: 'uploaded', label: 'Waiting to process', tone: 'neutral' };
  return { state: 'uploaded', label: 'Recorded', tone: 'neutral' };
}
