/**
 * Publish-time check for an AI conversation summary.
 *
 * A summary may describe the talk, but how much talk there was is a fact of
 * the transcript. "The only speech is a single fragment", "no conversation",
 * or "three lines" must match the transcript's line count. A summary that
 * does not is regenerated, then quarantined (kept for audit, never shown).
 */

import { speechCountContradictions, transcriptLineCount } from '../shared/speechCount.js';

type SummaryLike = {
  summary?: string | null;
  executiveSummary?: string | null;
  details?: unknown[] | null;
  concerns?: unknown[] | null;
  unresolvedQuestions?: unknown[] | null;
  keyMoments?: unknown[] | null;
};

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const row = value as { text?: unknown; label?: unknown };
    return [row.text, row.label].filter((part) => typeof part === 'string').join(' ');
  }
  return '';
}

/** Every sentence of a summary that states an amount of speech. */
export function summaryClaimText(summary: SummaryLike | null | undefined): string[] {
  if (!summary) return [];
  const out = [summary.summary, summary.executiveSummary].map(textOf);
  for (const key of ['details', 'concerns', 'unresolvedQuestions', 'keyMoments'] as const) {
    for (const row of summary[key] ?? []) out.push(textOf(row));
  }
  return out.map((line) => line.trim()).filter(Boolean);
}

/**
 * Speech-amount claims in the summary that the transcript contradicts.
 * Empty when the transcript is empty and the summary says nothing was said,
 * or when there is nothing to check.
 */
export function summaryClaimContradictions(
  summary: SummaryLike | null | undefined,
  transcript: string | null | undefined,
): string[] {
  const count = transcriptLineCount(transcript);
  const out: string[] = [];
  for (const line of summaryClaimText(summary)) {
    for (const hit of speechCountContradictions(line, [count])) {
      out.push(`"${hit.text}" but the transcript has ${count} line${count === 1 ? '' : 's'}`);
    }
  }
  return [...new Set(out)];
}

export class SummaryContradictionError extends Error {
  readonly contradictions: string[];
  constructor(contradictions: string[]) {
    super(`AI summary contradicts the transcript: ${contradictions.slice(0, 3).join('; ') || 'speech count'}`);
    this.name = 'SummaryContradictionError';
    this.contradictions = contradictions;
  }
}
