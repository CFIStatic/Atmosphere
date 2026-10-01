/**
 * Idempotent room-segment backfill for clips analyzed before room rows existed.
 *
 * Reads the analysis and transcript already stored. Makes no model calls.
 * A clip that already has room rows, including a user correction, is not
 * selected. A clip that segments to nothing still stores roomSegments: []
 * so the next boot does not pick it again.
 *
 * The deployed API runs this once from `scheduleClipRoomBackfill` about a
 * minute after boot, using the service's own env. PROOF_ROOM_BACKFILL_ON_BOOT=0
 * turns it off. The CLI script remains for a local dry run.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { unscopedAdminOrNull } from './scopedAdmin.js';
import { backfillClipRooms, type RoomBackfillResult } from '../shared/roomPersist.js';

export const ROOM_BACKFILL_BOOT_DELAY_MS = 60_000;
/** One boot pass. The next restart continues with whatever is still awaiting. */
export const ROOM_BACKFILL_BOOT_LIMIT = 200;

export function clipRoomBackfillOnBootEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROOF_ROOM_BACKFILL_ON_BOOT !== '0';
}

export type ClipRoomBackfillRun = (
  admin: SupabaseClient,
  opts?: { apply?: boolean; limit?: number },
) => Promise<RoomBackfillResult>;

export type ClipRoomBackfillBootOptions = {
  env?: NodeJS.ProcessEnv;
  delayMs?: number;
  limit?: number;
  getAdmin?: () => SupabaseClient | null;
  run?: ClipRoomBackfillRun;
  log?: (line: string) => void;
  /** Test seam. Production uses a one-shot timer and does not block startup. */
  setTimer?: (fire: () => Promise<void>, delayMs: number) => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

async function runBootBackfill(opts: ClipRoomBackfillBootOptions): Promise<void> {
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
      log('[room-backfill] skipped: no admin client');
      return;
    }
    const result = await (opts.run ?? backfillClipRooms)(admin, {
      apply: true,
      limit: opts.limit ?? ROOM_BACKFILL_BOOT_LIMIT,
    });
    log(
      `[room-backfill] ${JSON.stringify({
        scanned: result.scanned,
        written: result.written,
        skipped: result.skipped,
        failed: result.failed,
      })}`,
    );
  } catch (err) {
    log(`[room-backfill] aborted: ${reasonOf(err)}`);
  }
}

/**
 * Arm a one-shot backfill. Returns false when the env gate is off.
 * The timer callback catches every error and never rejects.
 */
export function scheduleClipRoomBackfill(opts?: ClipRoomBackfillBootOptions): boolean {
  if (!clipRoomBackfillOnBootEnabled(opts?.env ?? process.env)) return false;
  const delayMs = opts?.delayMs ?? ROOM_BACKFILL_BOOT_DELAY_MS;
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

export function stopClipRoomBackfill(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}
