/**
 * Idempotent re-transcription of live clips that have prose but no word clock.
 *
 * `transcript_text` is left in place for Ask and search. A finished run writes
 * `transcript_words` (an empty array when the provider returned none), so the
 * next boot skips that row. A failed row stays null and is tried again on a
 * later boot. One clip at a time, with a pause between Whisper calls.
 *
 * The deployed API runs this once from `scheduleTimedTranscriptBackfill` about
 * a minute after boot. PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT=0 turns it off.
 * Do not invoke it from a laptop against production.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { transcribeProofVideo } from '../audio/proofTranscript.js';
import { unscopedAdminOrNull } from './scopedAdmin.js';

const PAGE = 100;
export const TIMED_TRANSCRIPT_BACKFILL_BOOT_DELAY_MS = 60_000;
/** Pause between clips so a boot does not burst the transcription provider. */
export const TIMED_TRANSCRIPT_BACKFILL_GAP_MS = 2_000;

export type TimedTranscriptBackfillFailure = { id: string; reason: string };

export type TimedTranscriptBackfillClip = {
  id: string;
  outcome: 'done' | 'failed';
  reason?: string;
};

export type TimedTranscriptBackfillResult = {
  checked: number;
  done: number;
  failed: number;
  failures: TimedTranscriptBackfillFailure[];
};

export type TimedTranscriptBackfillOptions = {
  /** Stop after this many rows have been checked. Omit to scan every match. */
  limit?: number;
  gapMs?: number;
  transcribe?: (admin: SupabaseClient, proofId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  onClip?: (clip: TimedTranscriptBackfillClip) => void;
};

type IdRow = { id: string };

function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function resolveLimit(limit: number | undefined): number | null {
  if (limit == null || !Number.isFinite(limit)) return null;
  return Math.max(0, Math.floor(limit));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function listUntimed(admin: SupabaseClient, limit: number | null): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  for (;;) {
    if (limit != null && ids.length >= limit) break;
    const { data, error } = await admin
      .from('job_proofs')
      .select('id')
      .is('deleted_at', null)
      .eq('transcript_status', 'done')
      .is('transcript_words', null)
      .not('transcript_text', 'is', null)
      .order('received_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || 'Could not list untimed proofs.');
    const rows = (data ?? []) as IdRow[];
    if (!rows.length) break;
    for (const row of rows) {
      if (limit != null && ids.length >= limit) break;
      ids.push(String(row.id));
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return ids;
}

async function restoreDone(admin: SupabaseClient, id: string): Promise<void> {
  try {
    await admin
      .from('job_proofs')
      .update({ transcript_status: 'done', transcript_lease_until: null })
      .eq('id', id);
  } catch {
    /* the next boot still sees null words and tries again */
  }
}

/**
 * Re-transcribe live proofs whose word timings were never stored.
 * One clip at a time. A single failure does not stop the scan.
 */
export async function backfillTimedTranscripts(
  admin: SupabaseClient,
  opts?: TimedTranscriptBackfillOptions,
): Promise<TimedTranscriptBackfillResult> {
  const limit = resolveLimit(opts?.limit);
  const result: TimedTranscriptBackfillResult = { checked: 0, done: 0, failed: 0, failures: [] };
  if (limit === 0) return result;

  const ids = await listUntimed(admin, limit);
  const transcribe =
    opts?.transcribe ??
    ((client, proofId) =>
      transcribeProofVideo(client, proofId, { enrich: false, preserveExistingOnEmpty: true }));
  const sleep = opts?.sleep ?? defaultSleep;
  const gapMs = opts?.gapMs ?? TIMED_TRANSCRIPT_BACKFILL_GAP_MS;

  const emit = (clip: TimedTranscriptBackfillClip) => {
    try {
      opts?.onClip?.(clip);
    } catch {
      /* a listener must not abort the scan */
    }
  };

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i]!;
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    result.checked += 1;
    try {
      await transcribe(admin, id);
      result.done += 1;
      emit({ id, outcome: 'done' });
    } catch (err) {
      const reason = reasonOf(err);
      result.failed += 1;
      result.failures.push({ id, reason });
      await restoreDone(admin, id);
      emit({ id, outcome: 'failed', reason });
    }
  }

  return result;
}

/** On unless PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT is exactly `0`. */
export function timedTranscriptBackfillOnBootEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROOF_TIMED_TRANSCRIPT_BACKFILL_ON_BOOT !== '0';
}

export type TimedTranscriptBackfillRun = (
  admin: SupabaseClient,
  opts?: TimedTranscriptBackfillOptions,
) => Promise<TimedTranscriptBackfillResult>;

export type TimedTranscriptBackfillBootOptions = {
  env?: NodeJS.ProcessEnv;
  delayMs?: number;
  getAdmin?: () => SupabaseClient | null;
  run?: TimedTranscriptBackfillRun;
  log?: (line: string) => void;
  /** Test seam. Production uses a one-shot timer and does not block startup. */
  setTimer?: (fire: () => Promise<void>, delayMs: number) => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

async function runBootBackfill(opts: TimedTranscriptBackfillBootOptions): Promise<void> {
  const log = (line: string) => {
    try {
      (opts.log ?? console.log)(line);
    } catch {
      /* a broken logger must not crash the process */
    }
  };
  try {
    const admin = (opts.getAdmin ?? unscopedAdminOrNull)();
    if (!admin) {
      log('[timed-transcript-backfill] skipped: no admin client');
      return;
    }
    const result = await (opts.run ?? backfillTimedTranscripts)(admin, {
      onClip(event) {
        if (event.outcome === 'failed') {
          log(`[timed-transcript-backfill] failed ${event.id}: ${event.reason ?? 'unknown error'}`);
        }
      },
    });
    log(
      `[timed-transcript-backfill] ${JSON.stringify({
        checked: result.checked,
        done: result.done,
        failed: result.failed,
        failures: result.failures,
      })}`,
    );
  } catch (err) {
    log(`[timed-transcript-backfill] aborted: ${reasonOf(err)}`);
  }
}

/**
 * Arm a one-shot backfill. Returns false when the env gate is off.
 * The timer callback catches every error and never rejects.
 */
export function scheduleTimedTranscriptBackfill(opts?: TimedTranscriptBackfillBootOptions): boolean {
  if (!timedTranscriptBackfillOnBootEnabled(opts?.env ?? process.env)) return false;
  const delayMs = opts?.delayMs ?? TIMED_TRANSCRIPT_BACKFILL_BOOT_DELAY_MS;
  const fire = () => runBootBackfill(opts ?? {});
  if (opts?.setTimer) {
    opts.setTimer(fire, delayMs);
    return true;
  }
  if (timer) return true;
  timer = setTimeout(() => {
    timer = null;
    void fire();
  }, delayMs);
  timer.unref?.();
  return true;
}

export function stopTimedTranscriptBackfill(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}
