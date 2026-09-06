/**
 * Display helpers for nanodollar amounts (1e-9 USD) coming from the billing API.
 *
 * The backend never sends floats for money — everything is an integer count of
 * nanodollars, and 1 credit is 1 US dollar. These helpers only format for
 * display; no arithmetic that affects a balance happens in the browser.
 */

export const NANOS_PER_CREDIT = 1_000_000_000;

/** `$12.34`. Sub-cent amounts keep enough precision to stay meaningful. */
export function formatUsd(nanos: number, opts: { precise?: boolean } = {}): string {
  const dollars = nanos / NANOS_PER_CREDIT;

  if (opts.precise && dollars !== 0 && Math.abs(dollars) < 0.01) {
    // A single cached token can cost a fraction of a cent — rounding it to
    // "$0.00" in a usage table makes real spend look like nothing happened.
    return `$${dollars.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  }

  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Compact form for headline figures: `$1.2k`. */
export function formatUsdCompact(nanos: number): string {
  const dollars = nanos / NANOS_PER_CREDIT;
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`;
  }
  return formatUsd(nanos, { precise: true });
}

export const formatCents = (cents: number): string =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

/** `1.2M`, `847k`, `512` — token counts get large fast. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return count.toLocaleString('en-US');
}

/** Per-million-token rate as shown on the rate card. */
export const formatRate = (usdPerMTok: number): string =>
  `$${usdPerMTok % 1 === 0 ? usdPerMTok.toFixed(0) : usdPerMTok.toFixed(2).replace(/0$/, '')}`;

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** How much of an allowance has been consumed, clamped for the progress bar. */
export function usedPct(usedNanos: number, totalNanos: number): number {
  if (totalNanos <= 0) return 0;
  return Math.min(100, Math.max(0, (usedNanos / totalNanos) * 100));
}
