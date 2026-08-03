/**
 * A small in-process queue with retries.
 *
 * Built for the proof-analysis pipeline, and deliberately no bigger than that
 * job needs. A vision call does not belong inside the subcontractor's upload
 * request — a twenty-second model read on a truck's signal is a timed-out POST
 * — so uploads enqueue and return, and this drains in the background.
 *
 * What it promises, in order of importance:
 *
 *   Failures are handed back, never swallowed. The whole reason this exists is
 *   that the old inline call ate its errors, which made "the model was down"
 *   indistinguishable from "nobody asked". Terminal failures reach `onGaveUp`
 *   so the caller can write them somewhere a person will see.
 *
 *   One run per key at a time. Uploads can arrive twice (a retry on a bad
 *   signal does exactly that) and analysing the same day concurrently would
 *   have two writers racing on one row.
 *
 *   Sequential, not parallel. The consumer is a metered model API; two crews
 *   finishing at once should queue behind each other, not double the burst.
 *
 * Not persistent, on purpose. A restart loses whatever was waiting — and the
 * rows already record `queued`/`failed`, so what was lost is visible in the
 * database and re-kickable from the dashboard. Persistence would mean a jobs
 * table, a poller and a heartbeat, which is a lot of machinery to avoid a
 * button that already exists.
 */

export interface QueueJob {
  /** Dedupe identity. Two jobs with the same key are the same work. */
  key: string;
}

export class RetryQueue<J extends QueueJob> {
  private waiting: J[] = [];
  private inFlight = new Set<string>();
  private draining = false;

  constructor(
    private readonly opts: {
      /** Do the work. A throw means "retry me"; a return means done. */
      run: (job: J, attempt: number) => Promise<void>;
      /** Called once when every attempt is spent. This is where failures land. */
      onGaveUp?: (job: J, error: unknown) => void | Promise<void>;
      /** Waits between attempts. length + 1 = total attempts. */
      delaysMs?: number[];
      /** Injectable so tests do not actually sleep. */
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  /**
   * Add work. Returns false when the same key is already waiting or running —
   * the caller treats that as success, because the work will happen.
   */
  enqueue(job: J): boolean {
    if (this.inFlight.has(job.key)) return false;
    this.inFlight.add(job.key);
    this.waiting.push(job);
    void this.drain();
    return true;
  }

  /** Waiting plus running. For tests and health checks, not for control flow. */
  get pending(): number {
    return this.inFlight.size;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.waiting.length > 0) {
        const job = this.waiting.shift()!;
        const delays = this.opts.delaysMs ?? [2_000, 15_000, 60_000];
        const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

        for (let attempt = 1; ; attempt += 1) {
          try {
            await this.opts.run(job, attempt);
            break;
          } catch (error) {
            const delay = delays[attempt - 1];
            if (delay === undefined) {
              try {
                await this.opts.onGaveUp?.(job, error);
              } catch {
                // The give-up hook writes a status row; if that write also
                // fails there is nothing left to tell, and taking the queue
                // down with it would strand every job behind this one.
              }
              break;
            }
            await sleep(delay);
          }
        }

        // Released after the work settles, not when it starts: an enqueue for
        // this key mid-run is the same work and must not run twice.
        this.inFlight.delete(job.key);
      }
    } finally {
      this.draining = false;
    }
  }
}
