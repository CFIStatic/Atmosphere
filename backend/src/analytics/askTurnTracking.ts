/**
 * Minimum Ask-turn tracking for Atmosphere Analytics.
 *
 * Per-turn timings used to go to the API log only. This writes one row to
 * ask_turn_events per turn: outcome, total latency, time to first token, and
 * model id. Never the question, the answer, a transcript, or a name.
 *
 * Best-effort: never awaited by the caller's response path, never throws.
 */
import { HttpError } from '../lib/errors.js';

export type AskTurnOutcome = 'answered' | 'error' | 'refused' | 'stopped';
export type AskTurnSurface = 'job' | 'progress_share';

type InsertClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 4xx = refused (budget, validation, access). Anything else = error. */
export function askOutcomeForError(err: unknown): { outcome: AskTurnOutcome; code: string } {
  if (err instanceof HttpError) {
    const code = (err.code || 'error').slice(0, 64);
    return { outcome: err.status >= 400 && err.status < 500 ? 'refused' : 'error', code };
  }
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
    return { outcome: 'stopped', code: 'aborted' };
  }
  return { outcome: 'error', code: 'unhandled' };
}

export function askTurnRow(input: {
  orgId: string;
  surface: AskTurnSurface;
  outcome: AskTurnOutcome;
  totalMs: number;
  ttftMs?: number | null;
  model?: string | null;
  errorCode?: string | null;
}): Record<string, unknown> {
  const ms = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) || value < 0
      ? null
      : Math.min(Math.round(value), 2_147_483_647);
  const model = (input.model ?? '').trim();
  return {
    org_id: input.orgId,
    surface: input.surface,
    outcome: input.outcome,
    error_code: input.errorCode ? input.errorCode.slice(0, 64) : null,
    total_ms: ms(input.totalMs) ?? 0,
    ttft_ms: ms(input.ttftMs ?? null),
    model: model ? model.slice(0, 80) : null,
  };
}

export function trackAskTurn(
  admin: unknown,
  input: Parameters<typeof askTurnRow>[0],
): void {
  try {
    const client = admin as InsertClient | null | undefined;
    if (!client || typeof client.from !== 'function') return;
    if (!UUID.test(input.orgId)) return;
    void Promise.resolve(client.from('ask_turn_events').insert(askTurnRow(input)))
      .then((res) => {
        if (res?.error && !/does not exist|42P01|PGRST205/i.test(res.error.message)) {
          console.warn('[analytics] ask tracking failed:', res.error.message);
        }
      })
      .catch(() => undefined);
  } catch {
    /* tracking must never break an answer */
  }
}
