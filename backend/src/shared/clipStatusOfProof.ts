/**
 * The clip status every list reads: one proof row in, one clipProcessing result out.
 * Library, job file, and evidence report must pass this shape through so they
 * cannot each invent a status from a different subset of columns.
 */
import { servableSummary } from '../audio/summaryServe.js';
import { leaseIsHeld } from '../verification/lease.js';
import { clipProcessing, type ClipProcessing, type ClipProcessingInput } from './clipProcessing.js';

const NO_SPEECH_ERROR = /no usable audio|no speech/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function storedSummary(findings: unknown): boolean {
  if (!findings || typeof findings !== 'object' || Array.isArray(findings)) return false;
  const row = findings as Record<string, unknown>;
  return Boolean(row.conversation || row.evidenceLog);
}

function live(status: unknown, leaseUntil: unknown): boolean {
  const value = text(status).toLowerCase();
  if (value !== 'queued' && value !== 'running' && value !== 'pending') return false;
  return leaseIsHeld(typeof leaseUntil === 'string' ? leaseUntil : null);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function clipProcessingInputOfProof(proof: any): ClipProcessingInput {
  const row = proof ?? {};
  const summaryState = servableSummary(row).state;
  const transcriptStatus = text(row.transcript_status).toLowerCase();
  const transcriptError = text(row.transcript_error);
  const transcriptText = text(row.transcript_text);
  const noSpeech =
    (transcriptStatus === 'skipped' || transcriptStatus === 'done') &&
    !transcriptText &&
    NO_SPEECH_ERROR.test(transcriptError);
  const hasSummary = Boolean(text(row.ai_summary) || storedSummary(row.ai_findings));
  const analysisLive = live(row.analysis_status, row.analysis_lease_until);
  const narrationLive = live(row.narration_status, row.narration_lease_until);
  const transcriptLive = live(row.transcript_status, row.transcript_lease_until);
  const retrying = Boolean(
    (analysisLive && text(row.analysis_error)) ||
      (narrationLive && text(row.narration_error)) ||
      (transcriptLive && transcriptError && !noSpeech),
  );

  return {
    proofState: row.state ?? null,
    analysisStatus: row.analysis_status ?? null,
    transcriptStatus: row.transcript_status ?? null,
    narrationStatus: row.narration_status ?? null,
    summaryState,
    hasSummary,
    noSpeech,
    uploading: row.uploading === true,
    retrying,
    transcriptActive: transcriptLive,
    analysisActive: analysisLive,
    narrationActive: narrationLive,
    summaryActive: live(row.summary_status === 'stale' ? 'queued' : row.summary_status, row.summary_lease_until),
    budgetHold: row.ai_budget_hold === true,
  };
}

export function clipStatusOfProof(proof: any): ClipProcessing {
  return clipProcessing(clipProcessingInputOfProof(proof));
}
