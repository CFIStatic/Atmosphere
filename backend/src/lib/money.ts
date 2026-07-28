/**
 * Money handling for Atmosphere billing.
 *
 * Every monetary amount in this system is an integer count of **nanodollars**
 * (1e-9 USD). Two reasons it is not cents and not a float:
 *
 *  - Floats lose money. `0.1 + 0.2 !== 0.3`, and a billing ledger that does not
 *    reconcile to the penny is worthless.
 *  - Cents are too coarse. A single cached-read token on the cheapest model
 *    costs 200 nanodollars; rounded to cents that is zero, so a customer could
 *    run unlimited cache reads for free.
 *
 * A nanodollar amount stays exact in a JS `number` up to Number.MAX_SAFE_INTEGER
 * (~$9,007,199 at nanodollar precision), which is far beyond any single event or
 * balance this system handles. Amounts crossing the wire are strings where the
 * database returns them as such; `toNanos` normalises both forms.
 */

/** One credit is one US dollar. */
export const NANOS_PER_CREDIT = 1_000_000_000;
export const NANOS_PER_CENT = 10_000_000;

/** Largest amount we will accept anywhere, as a guard against overflow abuse. */
const MAX_NANOS = Number.MAX_SAFE_INTEGER;

/**
 * Coerce a nanodollar amount coming from Postgres (which serialises bigint as a
 * string) or from JSON into a safe integer. Anything non-finite, negative where
 * it must not be, or beyond the safe-integer range is rejected rather than
 * silently truncated.
 */
export function toNanos(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (Math.abs(n) > MAX_NANOS) {
    throw new RangeError('Monetary amount exceeds safe integer precision');
  }
  return Math.round(n);
}

export const centsToNanos = (cents: number): number => Math.round(cents) * NANOS_PER_CENT;
export const nanosToCents = (nanos: number): number => Math.round(nanos / NANOS_PER_CENT);
export const creditsToNanos = (credits: number): number => Math.round(credits * NANOS_PER_CREDIT);

/** Display helper — `$12.34`, or more decimals for sub-cent amounts. */
export function formatUsd(nanos: number): string {
  const dollars = nanos / NANOS_PER_CREDIT;
  if (dollars !== 0 && Math.abs(dollars) < 0.01) {
    return `$${dollars.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  }
  return `$${dollars.toFixed(2)}`;
}
