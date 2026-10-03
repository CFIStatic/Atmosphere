/**
 * A provider call that was billed even though its reply was not used.
 *
 * Gemini and Anthropic charge for a response the moment they return it. When
 * the reply then fails our JSON/schema check (for example a confidence of 85
 * where the schema wants 0–1), or when a low-confidence reading is replaced by
 * an escalation, the tokens were still paid for. Before this, those calls
 * threw or were overwritten before `recordAiCost` ran, so the org's ledger
 * never saw them. Production example: four Jettx clips failed
 * `analyze_frames` with zod `too_big` four times each, all unmetered.
 *
 * Callers record every billed call with `recordAiCost` and only then rethrow.
 */

import type { MeasuredUsage } from '../../lib/anthropic.js';

export interface BilledCall {
  provider: string;
  modelName: string;
  /** Provider-reported usage with the raw usage object. */
  usage: MeasuredUsage;
  estimatedCostUsd: number;
  providerRequestId: string | null;
  /** Why the reply was not used: 'unusable_reply' | 'replaced_by_escalation'. */
  reason: string;
}

export class BilledReplyError extends Error {
  readonly billed: BilledCall[];
  override readonly cause: unknown;

  constructor(cause: unknown, billed: BilledCall[]) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = cause instanceof Error ? cause.name : 'BilledReplyError';
    this.cause = cause;
    this.billed = billed;
    // Keep zod / validation issues readable for the step's last_error.
    if (cause instanceof Error && cause.stack) this.stack = cause.stack;
  }
}

/** Billed calls carried by an error, or none. */
export function billedCallsOf(err: unknown): BilledCall[] {
  return err instanceof BilledReplyError ? err.billed : [];
}

/** Run `parse`; if it throws, rethrow as a BilledReplyError carrying `billed`. */
export function parseBilled<T>(parse: () => T, billed: Omit<BilledCall, 'reason'>): T {
  try {
    return parse();
  } catch (err) {
    throw new BilledReplyError(err, [{ ...billed, reason: 'unusable_reply' }]);
  }
}
