/**
 * The live loop's spending ceiling.
 *
 * Live observation is the one call in the system that a client fires on a
 * timer, which makes it the one call whose cost is not naturally bounded by a
 * person doing something. A camera left recording in a truck overnight is
 * ~4,000 calls nobody asked for; a bug in a retry loop is worse. So every
 * org gets a per-day allowance, counted here and refused politely past it —
 * the client already treats a refusal as "monitoring unavailable" and the
 * recording itself is never touched.
 *
 * In-memory on purpose. The ledger is a cost fuse, not an entitlement system:
 * approximate counting is fine, a restart resetting the day is fine, and two
 * server instances each allowing the cap merely doubles a ceiling that is
 * priced in cents. What would not be fine is a database write on every
 * eight-second tick from every camera — the meter must cost less than the
 * thing it meters.
 */

export class DailyBudget {
  #counts = new Map<string, { day: string; used: number }>();

  constructor(private readonly capPerDay: number) {}

  /** The UTC day a timestamp belongs to — the reset boundary. */
  static dayOf(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  /**
   * Spend one unit for this key. Returns what happened and what remains, so
   * the refusal can say "come back tomorrow" with a straight face.
   */
  spend(key: string, now: Date = new Date()): { allowed: boolean; remaining: number } {
    const day = DailyBudget.dayOf(now);
    const entry = this.#counts.get(key);

    if (!entry || entry.day !== day) {
      // A new day pays off yesterday's meter entirely — including the case
      // where the process slept through midnight mid-recording.
      this.#counts.set(key, { day, used: 1 });
      return { allowed: true, remaining: this.capPerDay - 1 };
    }

    if (entry.used >= this.capPerDay) {
      return { allowed: false, remaining: 0 };
    }

    entry.used += 1;
    return { allowed: true, remaining: this.capPerDay - entry.used };
  }

  /** For tests and status endpoints; never used to make decisions. */
  usedToday(key: string, now: Date = new Date()): number {
    const entry = this.#counts.get(key);
    return entry && entry.day === DailyBudget.dayOf(now) ? entry.used : 0;
  }
}
