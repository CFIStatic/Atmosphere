/**
 * Which transcript an AI summary was built from.
 *
 * The conversation summary, the evidence log and the people log on a clip are
 * all derived from `transcript_text`. A re-transcription (the word-timing
 * backfill, a manual "Hear the mic" retry) replaces that text. Without a record
 * of what the summary read, the office sees a summary that describes a
 * different transcript from the one printed under it. The Tiffany clip on job
 * #12 said "only one line was spoken" above a raw transcript with five.
 *
 * This module is pure: hashing, and deciding whether a row's summary is fresh.
 * The queue that rebuilds stale summaries lives in summaryQueue.ts.
 */

import { createHash } from 'node:crypto';

export const SUMMARY_STATUSES = ['stale', 'queued', 'running', 'done', 'failed'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** What the office player shows next to the AI summary. */
export type SummaryState = 'fresh' | 'updating' | 'failed' | 'untracked' | 'none';

/** sha256 of the transcript exactly as stored. Null and empty hash the same. */
export function transcriptSha256(transcript: string | null | undefined): string {
  return createHash('sha256').update(typeof transcript === 'string' ? transcript : '').digest('hex');
}

/** The columns a transcript write sets so the summary is re-queued. */
export function staleSummaryPatch(): { summary_status: SummaryStatus; summary_error: null } {
  return { summary_status: 'stale', summary_error: null };
}

type FreshnessRow = {
  transcript_text?: string | null;
  summary_status?: string | null;
  summary_transcript_sha256?: string | null;
  ai_findings?: unknown;
};

function hasStoredSummary(findings: unknown): boolean {
  if (!findings || typeof findings !== 'object' || Array.isArray(findings)) return false;
  const f = findings as Record<string, unknown>;
  return Boolean(f.conversation || f.evidenceLog);
}

/** The hash the summary says it read, from the column or the stamp inside ai_findings.conversation. */
export function summarySourceHash(row: FreshnessRow): string | null {
  if (typeof row.summary_transcript_sha256 === 'string' && row.summary_transcript_sha256) {
    return row.summary_transcript_sha256;
  }
  const findings = row.ai_findings && typeof row.ai_findings === 'object' ? (row.ai_findings as Record<string, unknown>) : null;
  const conversation = findings?.conversation && typeof findings.conversation === 'object'
    ? (findings.conversation as Record<string, unknown>)
    : null;
  const stamped = conversation?.transcriptSha256;
  return typeof stamped === 'string' && stamped ? stamped : null;
}

/**
 * Is the stored summary built from the transcript on the row right now.
 *
 * - `none`: nothing is stored, the UI derives everything live from the transcript.
 * - `updating`: the status column says a rebuild is pending, or the stamped
 *   hash no longer matches the transcript.
 * - `failed`: every retry failed; the old summary is still shown.
 * - `untracked`: a summary from before provenance was recorded. The backfill
 *   decides whether it is older than the transcript.
 * - `fresh`: built from this exact transcript.
 */
export function summaryStateOf(row: FreshnessRow): SummaryState {
  const status = typeof row.summary_status === 'string' ? row.summary_status : null;
  if (status === 'stale' || status === 'queued' || status === 'running') return 'updating';
  if (!hasStoredSummary(row.ai_findings)) return status === 'failed' ? 'failed' : 'none';
  const source = summarySourceHash(row);
  if (source) {
    if (source !== transcriptSha256(row.transcript_text ?? null)) {
      return status === 'failed' ? 'failed' : 'updating';
    }
    return 'fresh';
  }
  if (status === 'failed') return 'failed';
  return 'untracked';
}

/** True when a stored summary is known not to match the live transcript. */
export function summaryIsStale(row: FreshnessRow): boolean {
  const state = summaryStateOf(row);
  return state === 'updating' || state === 'failed';
}
