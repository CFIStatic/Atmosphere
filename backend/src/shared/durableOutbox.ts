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
  /** Waits between attempts of the same claim. length + 1 = total attempts. */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  batchSize?: number;
}

export class DurableOutboxWorker<R extends OutboxRow> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private inFlight = new Set<string>();
  private readonly owner: string;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly delaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: DurableOutboxWorkerOptions<R>) {
    this.owner = opts.owner ?? leaseOwnerId();
    this.leaseMs = opts.leaseMs ?? VERIFICATION_LEASE_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
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

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Immediate drain — used after an HTTP enqueue writes the outbox row. */
  poke(): void {
    void this.tick();
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
