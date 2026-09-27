/**
 * Idempotent backfill of office-playable copies for filed videos.
 *
 * Each live `job_proofs` object that is not already a faststart H.264/AAC MP4
 * gets a sibling `*.play.mp4` in the `job-proofs` bucket. A clip that already
 * has that sibling, or whose original is already web-ready, is left alone.
 * Clips are handled one at a time. Safe to re-run; a second pass is a storage
 * listing (and, for a faststart MP4 with no sibling, a short header read).
 *
 * The deployed API runs this once from `schedulePlayableProofBackfill` about
 * a minute after boot, because the Railway box does not have a way to invoke
 * the CLI with a service key. The script is a thin wrapper around the same
 * function for an operator who does have the key.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ensurePlayableDerivative,
  playableDerivativePath,
  PROOF_PLAYABLE_BUCKET,
  type ProofPlayableRunner,
} from './proofPlayableUrl.js';
import { unscopedAdminOrNull } from './scopedAdmin.js';

const PAGE = 100;
/** Files smaller than this are broken stubs, not videos worth transcoding. */
const STUB_BYTES = 1024;

export const PLAYABLE_BACKFILL_BOOT_DELAY_MS = 60_000;

export type PlayableBackfillFailure = { id: string; reason: string };

export type PlayableBackfillClip = {
  id: string;
  outcome: 'built' | 'alreadyPlayable' | 'skipped' | 'failed';
  reason?: string;
  path?: string;
};

export type PlayableBackfillResult = {
  checked: number;
  built: number;
  alreadyPlayable: number;
  skipped: number;
  failed: number;
  failures: PlayableBackfillFailure[];
};

export type PlayableBackfillOptions = {
  /** Stop after this many rows have been checked. Omit to scan every live proof. */
  limit?: number;
  /** Classify rows without transcoding. */
  dryRun?: boolean;
  runner?: ProofPlayableRunner;
  ffmpegPath?: string;
  bucket?: string;
  onClip?: (clip: PlayableBackfillClip) => void;
};

type ProofRow = {
  id: string;
  storage_path: string | null;
  byte_size?: number | string | null;
};

function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function numericSize(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function metadataSize(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as { size?: unknown; contentLength?: unknown };
  return numericSize(meta.size) ?? numericSize(meta.contentLength);
}

function stubReason(bytes: number): string {
  const shown = Number.isInteger(bytes) ? String(bytes) : String(Math.floor(bytes));
  return `file is ${shown} bytes (under 1 KB)`;
}

function resolveLimit(limit: number | undefined): number | null {
  if (limit == null || !Number.isFinite(limit)) return null;
  return Math.max(0, Math.floor(limit));
}

async function findStorageObject(
  admin: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<{ size: number | null } | null> {
  const parts = objectPath.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  try {
    const { data, error } = await admin.storage.from(bucket).list(parts.join('/'), {
      limit: 100,
      search: name,
    });
    if (error || !data) return null;
    const row = data.find((item) => item.name === name);
    if (!row) return null;
    return { size: metadataSize(row.metadata) };
  } catch {
    return null;
  }
}

/**
 * Walk live proofs and build any missing `.play.mp4`. One clip at a time.
 * Returns counts plus a per-id failure list. Does not throw for a single bad
 * clip; a query failure still rejects so the caller can log and continue.
 */
export async function backfillPlayableProofs(
  admin: SupabaseClient,
  opts?: PlayableBackfillOptions,
): Promise<PlayableBackfillResult> {
  const bucket = opts?.bucket ?? PROOF_PLAYABLE_BUCKET;
  const limit = resolveLimit(opts?.limit);
  const result: PlayableBackfillResult = {
    checked: 0,
    built: 0,
    alreadyPlayable: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  if (limit === 0) return result;

  const emit = (clip: PlayableBackfillClip) => {
    try {
      opts?.onClip?.(clip);
    } catch {
      /* a listener must not abort the scan */
    }
  };

  let from = 0;
  for (;;) {
    if (limit != null && result.checked >= limit) break;
    const { data, error } = await admin
      .from('job_proofs')
      .select('id, storage_path, byte_size')
      .is('deleted_at', null)
      .order('received_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || 'Could not list job proofs.');
    const rows = (data ?? []) as ProofRow[];
    if (!rows.length) break;

    for (const row of rows) {
      if (limit != null && result.checked >= limit) break;
      result.checked += 1;
      await settleOne(admin, row, bucket, opts, result, emit);
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return result;
}

async function settleOne(
  admin: SupabaseClient,
  row: ProofRow,
  bucket: string,
  opts: PlayableBackfillOptions | undefined,
  result: PlayableBackfillResult,
  emit: (clip: PlayableBackfillClip) => void,
): Promise<void> {
  const id = String(row.id);
  const storagePath = String(row.storage_path ?? '').trim();
  try {
    const deriv = storagePath ? playableDerivativePath(storagePath) : null;
    if (!storagePath || !deriv) {
      result.skipped += 1;
      emit({ id, outcome: 'skipped', path: storagePath || undefined });
      return;
    }

    const declared = numericSize(row.byte_size);
    const size =
      declared ??
      (await findStorageObject(admin, bucket, storagePath))?.size ??
      null;
    if (size != null && size < STUB_BYTES) {
      const reason = stubReason(size);
      result.skipped += 1;
      emit({ id, outcome: 'skipped', reason, path: storagePath });
      return;
    }

    if (await findStorageObject(admin, bucket, deriv)) {
      result.alreadyPlayable += 1;
      emit({ id, outcome: 'alreadyPlayable', path: deriv });
      return;
    }

    if (opts?.dryRun) {
      result.skipped += 1;
      emit({ id, outcome: 'skipped', reason: 'dry-run', path: storagePath });
      return;
    }

    const playPath = await ensurePlayableDerivative({
      admin,
      storagePath,
      bucket,
      runner: opts?.runner,
      ffmpegPath: opts?.ffmpegPath,
    });
    if (playPath === storagePath) {
      result.alreadyPlayable += 1;
      emit({ id, outcome: 'alreadyPlayable', path: storagePath });
      return;
    }
    result.built += 1;
    emit({ id, outcome: 'built', path: playPath });
  } catch (err) {
    const reason = reasonOf(err);
    result.failed += 1;
    result.failures.push({ id, reason });
    emit({ id, outcome: 'failed', reason, path: storagePath || undefined });
  }
}

/** On unless PROOF_PLAYABLE_BACKFILL_ON_BOOT is exactly `0`. */
export function playableBackfillOnBootEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROOF_PLAYABLE_BACKFILL_ON_BOOT !== '0';
}

export type PlayableBackfillRun = (
  admin: SupabaseClient,
  opts?: PlayableBackfillOptions,
) => Promise<PlayableBackfillResult>;

export type PlayableBackfillBootOptions = {
  env?: NodeJS.ProcessEnv;
  delayMs?: number;
  getAdmin?: () => SupabaseClient | null;
  run?: PlayableBackfillRun;
  log?: (line: string) => void;
  /** Test seam. Production uses a one-shot timer and does not block startup. */
  setTimer?: (fire: () => Promise<void>, delayMs: number) => void;
};

let timer: ReturnType<typeof setTimeout> | null = null;

async function runBootBackfill(opts: PlayableBackfillBootOptions): Promise<void> {
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
      log('[playable-backfill] skipped: no admin client');
      return;
    }
    const result = await (opts.run ?? backfillPlayableProofs)(admin, {
      onClip(event) {
        if (event.outcome === 'built') {
          log(`[playable-backfill] playable ${event.id}`);
        } else if (event.outcome === 'failed') {
          log(`[playable-backfill] failed ${event.id}: ${event.reason ?? 'unknown error'}`);
        } else if (event.outcome === 'skipped' && event.reason) {
          log(`[playable-backfill] skipped ${event.id}: ${event.reason}`);
        }
      },
    });
    log(
      `[playable-backfill] ${JSON.stringify({
        checked: result.checked,
        built: result.built,
        alreadyPlayable: result.alreadyPlayable,
        skipped: result.skipped,
        failed: result.failed,
        failures: result.failures,
      })}`,
    );
  } catch (err) {
    log(`[playable-backfill] aborted: ${reasonOf(err)}`);
  }
}

/**
 * Arm a one-shot backfill. Returns false when the env gate is off.
 * The timer callback catches every error and never rejects.
 */
export function schedulePlayableProofBackfill(opts?: PlayableBackfillBootOptions): boolean {
  if (!playableBackfillOnBootEnabled(opts?.env ?? process.env)) return false;
  const delayMs = opts?.delayMs ?? PLAYABLE_BACKFILL_BOOT_DELAY_MS;
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

export function stopPlayableProofBackfill(): void {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
}
