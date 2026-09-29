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
  /** Visual events: the narration's timed entries and the extracted actions. */
  narration?: unknown;
  actions?: unknown;
};

/**
 * The clip's visual events in a canonical, order-stable form: every timed
 * narration entry and every extracted action as `[seconds, text]`. The
 * summary, evidence log and people log are built from these plus the
 * transcript, so together they are the clip's one evidence record version.
 */
export function visualEventsOf(row: Pick<FreshnessRow, 'narration' | 'actions'>): Array<[number | null, string]> {
  const out: Array<[number | null, string]> = [];
  const push = (at: unknown, text: unknown) => {
    const words = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!words) return;
    const n = Number(at);
    out.push([at == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10, words]);
  };
  const narration = row.narration && typeof row.narration === 'object' ? (row.narration as Record<string, unknown>) : null;
  for (const entry of Array.isArray(narration?.entries) ? (narration!.entries as unknown[]) : []) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    push(e.atSeconds ?? e.tSec ?? e.startSeconds, e.text ?? e.summary ?? e.note);
  }
  for (const action of Array.isArray(row.actions) ? (row.actions as unknown[]) : []) {
    if (!action || typeof action !== 'object') continue;
    const a = action as Record<string, unknown>;
    push(a.atSeconds ?? a.tSec ?? a.startSeconds, a.text ?? a.label ?? a.summary ?? a.action);
  }
  return out;
}

/** sha256 of the visual events. A new reading of the frames changes it. */
export function eventsSha256(row: Pick<FreshnessRow, 'narration' | 'actions'>): string {
  return createHash('sha256').update(JSON.stringify(visualEventsOf(row))).digest('hex');
}

/** The events hash a summary says it read (stamped inside ai_findings.conversation). */
export function summaryEventsHash(row: FreshnessRow): string | null {
  const findings = row.ai_findings && typeof row.ai_findings === 'object' ? (row.ai_findings as Record<string, unknown>) : null;
  const conversation = findings?.conversation && typeof findings.conversation === 'object'
    ? (findings.conversation as Record<string, unknown>)
    : null;
  const stamped = conversation?.eventsSha256;
  return typeof stamped === 'string' && stamped ? stamped : null;
}

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
 *   hash no longer matches the transcript (or the stamped visual events).
 * - `failed`: every retry failed; the old summary is still shown. A matching
 *   stamp is not freshness — quarantine writes provenance, and often an
 *   evidence log, before the row is marked failed.
 * - `untracked`: a summary from before provenance was recorded. The backfill
 *   decides whether it is older than the transcript.
 * - `fresh`: built from this exact transcript and not a failed rebuild.
 */
export function summaryStateOf(row: FreshnessRow): SummaryState {
  const status = typeof row.summary_status === 'string' ? row.summary_status : null;
  if (status === 'stale' || status === 'queued' || status === 'running') return 'updating';
  // Failed is its own state even when the stamp still matches the transcript.
  if (status === 'failed') return 'failed';
  if (!hasStoredSummary(row.ai_findings)) return 'none';
  const source = summarySourceHash(row);
  if (source) {
    if (source !== transcriptSha256(row.transcript_text ?? null)) return 'updating';
    // Events are part of the same evidence record: a summary stamped with the
    // frames it read is stale once they change. Rows stamped before events were
    // versioned (no stamp) are judged on the transcript alone. Callers that did
    // not load narration/actions skip the check rather than guess.
    const events = summaryEventsHash(row);
    if (events && ('narration' in row || 'actions' in row) && events !== eventsSha256(row)) return 'updating';
    return 'fresh';
  }
  return 'untracked';
}

/** True when the office should not treat the stored summary as current. */
export function summaryIsStale(row: FreshnessRow): boolean {
  const state = summaryStateOf(row);
  return state === 'updating' || state === 'failed';
}
