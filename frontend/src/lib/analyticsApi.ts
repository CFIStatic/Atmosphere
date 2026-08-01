/**
 * Client for the growth-analytics API.
 *
 * Mirrors the backend's serialised shapes. Money crosses the wire in CENTS and
 * is only turned into dollars at the point of display — floats are not a
 * currency type, and rounding once, late, keeps the totals on screen equal to
 * the totals in the spreadsheet.
 */

export type AnalyticsScope = 'investor' | 'internal';

export interface AnalyticsAccess {
  scope: AnalyticsScope | null;
  displayName: string | null;
}

export interface SummaryPayload {
  scope: AnalyticsScope;
  range: { from: string; to: string; days: number };
  customers: {
    orgsTotal: number;
    orgsNew: number;
    orgsPaying: number;
    orgsActive: number;
    orgsGrowthMomPct: number | null;
  };
  users: {
    usersTotal: number;
    usersNew: number;
    usersActive: number;
    usersGrowthMomPct: number | null;
  };
  seats: {
    seatsLicensed: number;
    seatsFilled: number;
    seatUtilizationPct: number | null;
    seatsGrowthMomPct: number | null;
  };
  revenue: {
    mrrCents: number;
    arrCents: number;
    annualContractedMrrCents: number;
    annualContractedArrCents: number;
    monthlyBilledMrrCents: number;
    trialPipelineMrrCents: number;
    mrrGrowthMomPct: number | null;
    netNewMrrCents: number;
    collectedInRangeCents: number;
    subscriptionRevenueCents: number;
    creditRevenueCents: number;
    trailing12mRevenueCents: number;
    avgMonthlySpendPerAccountCents: number | null;
    avgMonthlySpendPerSeatCents: number | null;
    arpaMrrCents: number | null;
  };
  engagement: {
    trackedHours: number;
    sessions: number;
    featuresUsed: number;
    featuresTracked: number;
    aiRequests: number;
  };
  unitEconomics?: {
    billedUsageCents: number;
    modelCostCents: number;
    grossMarginCents: number;
    grossMarginPct: number | null;
  };
}

export interface MonthlyRow {
  month: string;
  newOrgs: number;
  totalOrgs: number;
  payingOrgs: number;
  activeOrgs: number;
  churnedOrgs: number;
  newUsers: number;
  totalUsers: number;
  activeUsers: number;
  seats: number;
  mrrCents: number;
  arrCents: number;
  revenueCents: number;
  subscriptionRevenueCents: number;
  creditRevenueCents: number;
  arpaCents: number | null;
  mrrGrowthPct: number | null;
  userGrowthPct: number | null;
  seatGrowthPct: number | null;
  trackedHours: number;
}

export interface FeatureRow {
  featureKey: string;
  label: string;
  area: string;
  sessions: number;
  activeMs: number;
  activeHours: number;
  users: number;
  orgs: number;
  avgSessionMinutes: number;
  sharePct: number;
  timeRank: number;
  aiRequests: number;
  lastUsedAt: string | null;
}

export interface AccountRow {
  orgId: string;
  orgName: string;
  createdAt: string;
  planCode: string;
  planName: string;
  billingInterval: string;
  status: string;
  seats: number;
  members: number;
  mrrCents: number;
  arrCents: number;
  revenueInRangeCents: number;
  creditSpendCents: number;
  activeHours: number;
  topFeature: string | null;
  lastActiveAt: string | null;
}

export interface PlanMixRow {
  planCode: string;
  planName: string;
  billingInterval: string;
  orgs: number;
  seats: number;
  mrrCents: number;
  arrCents: number;
  mrrSharePct: number | null;
}

export interface RetentionRow {
  cohortMonth: string;
  cohortSize: number;
  monthOffset: number;
  activeOrgs: number;
  retentionPct: number | null;
}

export interface OverviewPayload {
  scope: AnalyticsScope;
  generatedAt: string;
  range: { from: string; to: string };
  summary: SummaryPayload;
  monthly: MonthlyRow[];
  features: FeatureRow[];
  planMix: PlanMixRow[];
  retention: RetentionRow[];
  accounts: AccountRow[] | null;
  /** Internal only — cut / invest / stickiness advice from product usage. */
  productIntelligence: ProductIntelligence | null;
}

export type InsightKind = 'cut' | 'invest' | 'stickiness' | 'watch';
export type InsightPriority = 'high' | 'medium' | 'low';
export type InsightConfidence = 'low' | 'medium' | 'high';

export interface AreaUsage {
  area: string;
  activeHours: number;
  sharePct: number;
  featuresUsed: number;
  featuresTracked: number;
  sessions: number;
  peakUsers: number;
}

export interface ProductInsight {
  id: string;
  kind: InsightKind;
  priority: InsightPriority;
  title: string;
  rationale: string;
  action: string;
  featureKeys: string[];
  area: string | null;
  metrics: Record<string, number | string | null>;
}

export interface ProductIntelligence {
  confidence: InsightConfidence;
  confidenceNote: string;
  areas: AreaUsage[];
  hottest: FeatureRow[];
  coldest: FeatureRow[];
  insights: ProductInsight[];
}

export type ExportDataset =
  | 'all'
  | 'summary'
  | 'monthly'
  | 'features'
  | 'plans'
  | 'retention'
  | 'accounts';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class AnalyticsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'AnalyticsError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    throw new AnalyticsError(0, 'Network error — is the backend running?', 'network_error');
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new AnalyticsError(
      res.status,
      (body.error as string) ?? `Request failed (${res.status})`,
      (body.code as string) ?? 'error',
    );
  }
  return body as T;
}

export interface RangeParams {
  from: Date;
  to: Date;
  months: number;
}

function rangeQuery({ from, to, months }: RangeParams): string {
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
    to.toISOString(),
  )}&months=${months}`;
}

export const analyticsApi = {
  access: () => request<AnalyticsAccess>('/api/analytics/access'),

  overview: (range: RangeParams) =>
    request<OverviewPayload>(`/api/analytics/overview?${rangeQuery(range)}`),

  /** Absolute URL for an Excel download — used as an anchor href, so the browser
   *  handles the file save and cookies ride along automatically. */
  exportUrl: (range: RangeParams, dataset: ExportDataset = 'all') =>
    `${API_BASE}/api/analytics/export?${rangeQuery(range)}&dataset=${dataset}`,
};

/** Fire-and-forget feature timing. Failures are never surfaced to the user. */
export async function sendHeartbeat(body: {
  featureKey: string;
  sessionId: string | null;
  deltaMs: number;
  interactions: number;
}): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/telemetry/feature`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true, // survives the page being closed mid-flight
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { sessionId: string | null };
    return json.sessionId;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Display formatting
 * ------------------------------------------------------------------------ */

/** $1,234.56 — for precise figures in tables. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** $1.2M / $218.5k / $842 — for headline tiles and axis ticks. */
export function moneyCompact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `$${dollars.toFixed(0)}`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US');
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Signed, for month-over-month deltas. */
export function signedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function hours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 1000) return `${Math.round(value).toLocaleString('en-US')} h`;
  if (value >= 10) return `${value.toFixed(0)} h`;
  if (value > 0 && value < 0.1) return '<0.1 h';
  return `${value.toFixed(1)} h`;
}

/** "Mar 2026" from a yyyy-mm-dd month key, without tripping over time zones. */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function shortMonthLabel(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short' }) + (Number(m) === 1 ? ` ’${year.slice(2)}` : '');
}

export function dateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
