/**
 * Durable outbox worker.
 *
 * Wave 2 stamped Postgres leases so a live replica could steal work. The
 * executor was still an in-process RetryQueue — a restart emptied it, and
 * two replicas could both enqueue the same row. This worker treats the
 * existing job/proof rows as the outbox: claim (CAS) then run. A crash
 * leaves the row leased; when lease_until passes, the next process claims
 * it and finishes. No extra broker.
 */

import { leaseOwnerId, leaseUntilIso, VERIFICATION_LEASE_MS } from '../verification/lease.js';

export interface OutboxRow {
  id: string;
}

export interface ClaimStore<R extends OutboxRow> {
  /** Rows that look free: eligible status and a missing/expired lease. */
  listClaimable(limit: number): Promise<R[]>;
  /**
   * Exclusive claim. Succeeds when the lease is missing, expired, or already
   * ours (heartbeat). Returns the row, or null when another worker holds it.
   */
  claim(id: string, owner: string, untilIso: string): Promise<R | null>;
}

export interface DurableOutboxWorkerOptions<R extends OutboxRow> {
  store: ClaimStore<R>;
  run: (row: R, attempt: number) => Promise<void>;
  onGaveUp?: (row: R, error: unknown) => void | Promise<void>;
  owner?: string;
  leaseMs?: number;
  pollIntervalMs?: number;
  /** Empty-queue poll cap (default 60s). Grows from pollIntervalMs while idle. */
  maxIdlePollMs?: number;
  /** Waits between attempts of the same claim. length + 1 = total attempts. */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  batchSize?: number;
}

export class DurableOutboxWorker<R extends OutboxRow> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private draining = false;
  private stopped = true;
  private emptyStreak = 0;
  private inFlight = new Set<string>();
  private readonly owner: string;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  /** Cap for empty-queue backoff (keeps Disk IO Budget from empty polls). */
  private readonly maxIdlePollMs: number;
  private readonly batchSize: number;
  private readonly delaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: DurableOutboxWorkerOptions<R>) {
    this.owner = opts.owner ?? leaseOwnerId();
    this.leaseMs = opts.leaseMs ?? VERIFICATION_LEASE_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    this.maxIdlePollMs = Math.max(this.pollIntervalMs, opts.maxIdlePollMs ?? 60_000);
    this.batchSize = Math.max(1, Math.min(opts.batchSize ?? 8, 25));
    this.delaysMs = opts.delaysMs ?? [2_000, 15_000, 60_000];
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  get pending(): number {
    return this.inFlight.size;
  }

  get ownerId(): string {
    return this.owner;
  }

  /** How many consecutive empty polls (for tests / metrics). */
  get idleStreak(): number {
    return this.emptyStreak;
  }

  start(): void {
    if (!this.stopped && this.timer) return;
    this.stopped = false;
    this.emptyStreak = 0;
    void this.arm(0);
  }

  stop(): void {
    this.stopped = true;
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  /** Immediate drain — used after an HTTP enqueue writes the outbox row. */
  poke(): void {
    this.emptyStreak = 0;
    if (this.stopped) return;
    void this.arm(0);
  }

  /** Next delay: base interval when busy; exponential backoff while the queue is empty. */
  private nextDelayMs(): number {
    if (this.emptyStreak <= 0) return this.pollIntervalMs;
    const grown = this.pollIntervalMs * 2 ** Math.min(this.emptyStreak, 4);
    return Math.min(grown, this.maxIdlePollMs);
  }

  private arm(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loop(), delayMs);
    this.timer.unref?.();
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    await this.tick();
    if (this.stopped) return;
    this.arm(this.nextDelayMs());
  }

  /**
   * One poll: list claimable rows, CAS each, run. Returns how many completed
   * (or gave up) in this pass. Held rows are skipped, not counted.
   */
  async tick(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let finished = 0;
    try {
      const candidates = await this.opts.store.listClaimable(this.batchSize);
      if (candidates.length === 0) this.emptyStreak += 1;
      else this.emptyStreak = 0;
      for (const row of candidates) {
        if (this.inFlight.has(row.id)) continue;
        const claimed = await this.opts.store.claim(
          row.id,
          this.owner,
          leaseUntilIso(this.now(), this.leaseMs),
        );
        if (!claimed) continue;
        this.inFlight.add(row.id);
        try {
          await this.runClaimed(claimed);
          finished += 1;
        } finally {
          this.inFlight.delete(row.id);
        }
      }
    } finally {
      this.draining = false;
    }
    return finished;
  }

  private async runClaimed(row: R): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.opts.store.claim(row.id, this.owner, leaseUntilIso(this.now(), this.leaseMs));
        await this.opts.run(row, attempt);
        return;
      } catch (error) {
        const delay = this.delaysMs[attempt - 1];
        if (delay === undefined) {
          try {
            await this.opts.onGaveUp?.(row, error);
          } catch {
            // Give-up writes a status row. If that write also fails, taking
            // the worker down would strand every job behind this one.
          }
          return;
        }
        await this.sleep(delay);
      }
    }
  }
}

/**
 * True when this owner may stamp the lease: missing, expired, or already ours.
 * Used by in-memory stores and by the PostgREST CAS fallback.
 */
export function leaseIsClaimable(
  leaseUntil: string | null | undefined,
  leaseOwner: string | null | undefined,
  owner: string,
  nowMs = Date.now(),
): boolean {
  if (!leaseUntil) return true;
  const until = Date.parse(leaseUntil);
  if (!Number.isFinite(until) || until <= nowMs) return true;
  return Boolean(leaseOwner && leaseOwner === owner);
}
