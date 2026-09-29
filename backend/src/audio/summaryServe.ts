/**
 * What of a clip's AI summary may be served right now.
 *
 * The summary (conversation brief, key moments, agreements…) and the stored
 * evidence log are derived from the transcript and the visual events. While
 * they are being rebuilt from a newer version — or the rebuild failed, or the
 * stored text contradicts the transcript — they are not served at all. The
 * surfaces show "Summary still processing" and the raw transcript, which is
 * always current. Never a stale or contradicting summary.
 */
import { summaryStateOf, type SummaryState } from './summaryFreshness.js';
import { summaryClaimContradictions } from './summaryValidation.js';

export type ServedSummaryState = SummaryState | 'quarantined';

export interface ServableSummary {
  state: ServedSummaryState;
  /** Stored conversation summary, or null when it must not be shown. */
  conversation: unknown | null;
  /** Stored evidence log, or null when it must not be shown. */
  evidenceLog: unknown | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function servableSummary(row: any): ServableSummary {
  const findings = row?.ai_findings && typeof row.ai_findings === 'object' ? row.ai_findings : {};
  const transcript = typeof row?.transcript_text === 'string' ? row.transcript_text : null;
  const quarantined =
    transcript != null &&
    Boolean(findings.conversation) &&
    summaryClaimContradictions(findings.conversation, transcript).length > 0;
  const state: ServedSummaryState = quarantined ? 'quarantined' : summaryStateOf(row ?? {});
  const hidden = state === 'quarantined' || state === 'updating' || state === 'failed';
  return {
    state,
    conversation: hidden ? null : (findings.conversation ?? null),
    evidenceLog: hidden ? null : (findings.evidenceLog ?? null),
  };
}

/** True while the surfaces should say "Summary still processing". */
export function summaryStillProcessing(state: ServedSummaryState | null | undefined): boolean {
  return state === 'updating' || state === 'quarantined';
}
