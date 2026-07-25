/**
 * Pure formatting helpers.
 *
 * Every currency figure and timestamp in the product goes through here so that
 * money is never rendered two different ways on two different screens — which
 * matters more than usual when the numbers are claim values people argue about.
 */

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const USD_PRECISE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(amount: number | null | undefined, precise = false): string {
  if (amount === null || amount === undefined) return '—';
  return precise ? USD_PRECISE.format(amount) : USD.format(amount);
}

/** Compact form for tiles: $1.2M, $48k. */
export function moneyCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(amount / 1_000)}k`;
  return USD.format(amount);
}

export function percent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return DATE.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return DATE_TIME.format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return TIME.format(new Date(iso));
}

/**
 * Short relative time — "4m", "3h", "2d". Deliberately terse: these appear in
 * dense feeds where "about 4 hours ago" would crowd out the content.
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const diffMs = now.getTime() - new Date(iso).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;

  const months = Math.round(days / 30);
  return future ? `in ${months}mo` : `${months}mo ago`;
}

/** "Expires in 42m" style countdown, or null once elapsed. */
export function timeUntil(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - now.getTime();
  if (diffMs <= 0) return null;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function titleCase(value: string): string {
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
