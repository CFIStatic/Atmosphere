/**
 * One-time backfill: re-queue AI summaries that are older than their transcript.
 *
 * Why: the word-timing backfill (PR #562, Sep 27) re-transcribed every live
 * clip with `enrich: false`, so transcript_text changed and the conversation
 * summary / evidence log built from the old text stayed on the row. The
 * Tiffany clip's summary said one line was spoken above five raw lines.
 *
 * What counts as older than the transcript:
 * - a summary that recorded its source (summary_transcript_sha256 or the
 *   stamp in ai_findings.conversation): the hash differs from the live transcript;
 * - a summary from before provenance existed: transcribed_at is later than the
 *   last time the summary is known to have been rebuilt
 *   (summary_generated_at, else narrated_at — narration completion rebuilt it).
 * A stored summary that states a different amount of speech than the
 * transcript is included first (summary_contradiction), whatever its stamps say.
 * Rows whose stored timeline repeats the dictation beats without a time are
 * included as well, so the rebuild also rewrites those analysis events.
 *
 * What it does: nothing without `apply`. With `apply`, it sets
 * summary_status = 'stale' (compare-and-set, never over a queued/running row).
 * The worker's analysis sweep then rebuilds each summary on the summary retry
 * queue. No model is called from here.
 *
 * Do not run this against production from a laptop; see the PR for the plan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { summarySourceHash, transcriptSha256 } from '../audio/summaryFreshness.js';
import { summaryClaimContradictions } from '../audio/summaryValidation.js';

const PAGE = 100;

export type StaleSummaryReason = 'summary_contradiction' | 'hash_mismatch' | 'transcript_newer' | 'untimed_timeline';

export type StaleSummaryRow = {
  id: string;
  transcript_text?: string | null;
  transcript_status?: string | null;
  transcribed_at?: string | null;
  narrated_at?: string | null;
  summary_status?: string | null;
  summary_transcript_sha256?: string | null;
  summary_generated_at?: string | null;
  ai_findings?: unknown;
};

function findingsOf(row: StaleSummaryRow): Record<string, unknown> {
  return row.ai_findings && typeof row.ai_findings === 'object' && !Array.isArray(row.ai_findings)
    ? (row.ai_findings as Record<string, unknown>)
    : {};
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function hasUntimedTimeline(findings: Record<string, unknown>): boolean {
  const timeline = findings.timeline;
  if (!Array.isArray(timeline)) return false;
  return timeline.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const start = (row as { startSeconds?: unknown }).startSeconds;
    return start == null || !Number.isFinite(Number(start));
  });
}

/** Why this row's summary needs rebuilding, or null when it does not. */
export function staleSummaryReason(row: StaleSummaryRow): StaleSummaryReason | null {
  if (row.summary_status === 'queued' || row.summary_status === 'running' || row.summary_status === 'stale') {
    return null; // already on its way
  }
  const findings = findingsOf(row);
  const settled = row.transcript_status === 'done' || row.transcript_status === 'skipped';
  const hasSummary = Boolean(findings.conversation || findings.evidenceLog);
  if (settled && hasSummary) {
    // A stored summary whose speech-count claims the transcript contradicts is
    // wrong regardless of provenance ("only one line" over five lines).
    const conversation = findings.conversation && typeof findings.conversation === 'object' ? findings.conversation : null;
    if (conversation && summaryClaimContradictions(conversation as never, row.transcript_text ?? null).length) {
      return 'summary_contradiction';
    }
    const source = summarySourceHash(row);
    if (source) {
      if (source !== transcriptSha256(row.transcript_text ?? null)) return 'hash_mismatch';
    } else {
      const heard = time(row.transcribed_at);
      const built = time(row.summary_generated_at) ?? time(row.narrated_at);
      if (heard != null && (built == null || heard > built)) return 'transcript_newer';
    }
  }
  if (hasUntimedTimeline(findings)) return 'untimed_timeline';
  return null;
}

export type StaleSummaryBackfillResult = {
  apply: boolean;
  checked: number;
  affected: Array<{ id: string; reason: StaleSummaryReason }>;
  marked: number;
};

const SELECT =
  'id, transcript_text, transcript_status, transcribed_at, narrated_at, ' +
  'summary_status, summary_transcript_sha256, summary_generated_at, ai_findings';

export async function backfillStaleSummaries(
  admin: SupabaseClient,
  opts?: { apply?: boolean; limit?: number; onRow?: (row: { id: string; reason: StaleSummaryReason }) => void },
): Promise<StaleSummaryBackfillResult> {
  const apply = Boolean(opts?.apply);
  const limit = opts?.limit != null && Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : null;
  const result: StaleSummaryBackfillResult = { apply, checked: 0, affected: [], marked: 0 };
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('job_proofs')
      .select(SELECT)
      .is('deleted_at', null)
      .order('received_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || 'Could not list clips.');
    const rows = (data ?? []) as unknown as StaleSummaryRow[];
    for (const row of rows) {
      result.checked += 1;
      const reason = staleSummaryReason(row);
      if (!reason) continue;
      if (limit != null && result.affected.length >= limit) continue;
      const hit = { id: String(row.id), reason };
      result.affected.push(hit);
      try {
        opts?.onRow?.(hit);
      } catch {
        /* a listener must not stop the scan */
      }
      if (!apply) continue;
      let update = admin.from('job_proofs').update({ summary_status: 'stale', summary_error: null }).eq('id', hit.id);
      update = row.summary_status == null
        ? update.is('summary_status', null)
        : update.eq('summary_status', row.summary_status);
      const { data: marked, error: markError } = await update.select('id').maybeSingle();
      if (!markError && marked) result.marked += 1;
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}
