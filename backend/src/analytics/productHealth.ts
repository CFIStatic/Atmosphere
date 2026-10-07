/**
 * Atmosphere Analytics product-health report.
 *
 * One RPC, `analytics_product_health`, SECURITY DEFINER and service_role
 * only. Call it through createStaffReportClient so the database re-checks the
 * caller's analytics_staff row (private.require_analytics). Every number is a
 * count or a duration over real rows; nothing is estimated or back-filled.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { translateAnalyticsRpcError } from '../lib/analytics.js';

export interface NorthStarWeek {
  weekStart: string;
  partial: boolean;
  payingSeats: number;
  payingOrgs: number;
  hoursPaying: number;
  hoursAll: number;
  films: number;
  hoursPerSeat: number | null;
}

export interface UploadPeriod {
  started: number;
  completed: number;
  failed: number;
  abandoned: number;
  inFlight: number;
  retried: number;
  retrying: number;
  /** completed / (started − in flight). Null when nothing has settled. */
  completionRatePct: number | null;
}

export interface AnalysisPeriod {
  received: number;
  /** Films whose FIRST analysis time is known (percentiles use these). */
  analysed: number;
  /** Analysed films whose first analysis time was overwritten before tracking began (Sep 21 batch). */
  firstTimeUnknown: number;
  failed: number;
  pending: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

export interface AnalysisWeek {
  weekStart: string;
  analysed: number;
  firstTimeUnknown: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

export interface EvidencePeriod {
  proofsAnalysed: number;
  dailyReportsSent: number;
  evidenceDownloads: number;
  shareLinksCreated: number;
  /** Links whose last open falls in the window. Null where history is not kept. */
  shareLinksOpened: number | null;
}

export interface AskPeriod {
  turns: number;
  answered: number;
  errors: number;
  refused: number;
  stopped: number;
  /** errors / turns. */
  errorRatePct: number | null;
  medianMs: number | null;
  p90Ms: number | null;
  medianTtftMs: number | null;
}

export interface ProductHealth {
  generatedAt: string;
  weeks: number;
  includeInternal: boolean;
  windows: {
    current: { from: string; to: string };
    prior: { from: string; to: string };
  };
  northStar: {
    weekly: NorthStarWeek[];
    /** Last complete week. */
    latest: NorthStarWeek | null;
    /** The complete week before `latest`. */
    previous: NorthStarWeek | null;
  };
  uploads: {
    trackingSince: string | null;
    current: UploadPeriod | null;
    prior: UploadPeriod | null;
    topErrors: Array<{ code: string; count: number }>;
  };
  analysis: {
    /** 'first_analysis': upload -> first analysis; re-analysis is ignored. */
    measuredTo: string;
    current: AnalysisPeriod | null;
    prior: AnalysisPeriod | null;
    weekly: AnalysisWeek[];
  };
  evidence: {
    current: EvidencePeriod;
    prior: EvidencePeriod;
    lifetime: { shareLinks: number; shareLinkOpens: number };
  };
  ask: {
    trackingSince: string | null;
    questions: { current: number; prior: number; orgsCurrent: number };
    current: AskPeriod | null;
    prior: AskPeriod | null;
    /** No in-product answer rating exists yet. Always null until one does. */
    feedback: null;
  };
}

type Raw = Record<string, unknown>;

const obj = (value: unknown): Raw =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function pct(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function mapWeek(raw: unknown): NorthStarWeek {
  const r = obj(raw);
  return {
    weekStart: str(r.week_start),
    partial: r.partial === true,
    payingSeats: num(r.paying_seats),
    payingOrgs: num(r.paying_orgs),
    hoursPaying: num(r.hours_paying),
    hoursAll: num(r.hours_all),
    films: num(r.films),
    hoursPerSeat: numOrNull(r.hours_per_seat),
  };
}

function mapUploads(raw: unknown): UploadPeriod | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  const started = num(r.started);
  const inFlight = num(r.in_flight);
  const completed = num(r.completed);
  return {
    started,
    completed,
    failed: num(r.failed),
    abandoned: num(r.abandoned),
    inFlight,
    retried: num(r.retried),
    retrying: num(r.retrying),
    completionRatePct: pct(completed, started - inFlight),
  };
}

function mapAnalysis(raw: unknown): AnalysisPeriod | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  return {
    received: num(r.received),
    analysed: num(r.analysed),
    firstTimeUnknown: num(r.first_time_unknown),
    failed: num(r.failed),
    pending: num(r.pending),
    medianSeconds: numOrNull(r.median_seconds),
    p90Seconds: numOrNull(r.p90_seconds),
  };
}

function mapEvidence(raw: unknown): EvidencePeriod {
  const r = obj(raw);
  return {
    proofsAnalysed: num(r.proofs_analysed),
    dailyReportsSent: num(r.daily_reports_sent),
    evidenceDownloads: num(r.evidence_downloads),
    shareLinksCreated: num(r.share_links_created),
    shareLinksOpened: numOrNull(r.share_links_opened),
  };
}

function mapAsk(raw: unknown): AskPeriod | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = obj(raw);
  const turns = num(r.turns);
  const errors = num(r.errors);
  return {
    turns,
    answered: num(r.answered),
    errors,
    refused: num(r.refused),
    stopped: num(r.stopped),
    errorRatePct: pct(errors, turns),
    medianMs: numOrNull(r.median_ms),
    p90Ms: numOrNull(r.p90_ms),
    medianTtftMs: numOrNull(r.median_ttft_ms),
  };
}

/** Translate the analytics_product_health JSONB payload. Exported for tests. */
export function mapProductHealth(data: unknown): ProductHealth {
  const d = obj(data);
  const windows = obj(d.windows);
  const cur = obj(windows.current);
  const prior = obj(windows.prior);
  const weekly = arr(obj(d.north_star).weekly).map(mapWeek);
  const complete = weekly.filter((week) => !week.partial);
  const uploads = obj(d.uploads);
  const analysis = obj(d.analysis);
  const evidence = obj(d.evidence);
  const lifetime = obj(evidence.lifetime);
  const ask = obj(d.ask);
  const questions = obj(ask.questions);

  return {
    generatedAt: str(d.generated_at),
    weeks: num(d.weeks),
    includeInternal: d.include_internal === true,
    windows: {
      current: { from: str(cur.from), to: str(cur.to) },
      prior: { from: str(prior.from), to: str(prior.to) },
    },
    northStar: {
      weekly,
      latest: complete.at(-1) ?? null,
      previous: complete.at(-2) ?? null,
    },
    uploads: {
      trackingSince: strOrNull(uploads.tracking_since),
      current: mapUploads(uploads.current),
      prior: mapUploads(uploads.prior),
      topErrors: arr(uploads.top_errors).map((row) => {
        const e = obj(row);
        return { code: str(e.code), count: num(e.count) };
      }),
    },
    analysis: {
      measuredTo: str(analysis.measured_to) || 'first_analysis',
      current: mapAnalysis(analysis.current),
      prior: mapAnalysis(analysis.prior),
      weekly: arr(analysis.weekly).map((row) => {
        const w = obj(row);
        return {
          weekStart: str(w.week_start),
          analysed: num(w.analysed),
          firstTimeUnknown: num(w.first_time_unknown),
          medianSeconds: numOrNull(w.median_seconds),
          p90Seconds: numOrNull(w.p90_seconds),
        };
      }),
    },
    evidence: {
      current: mapEvidence(evidence.current),
      prior: mapEvidence(evidence.prior),
      lifetime: {
        shareLinks: num(lifetime.share_links),
        shareLinkOpens: num(lifetime.share_link_opens),
      },
    },
    ask: {
      trackingSince: strOrNull(ask.tracking_since),
      questions: {
        current: num(questions.current),
        prior: num(questions.prior),
        orgsCurrent: num(questions.orgs_current),
      },
      current: mapAsk(ask.current),
      prior: mapAsk(ask.prior),
      feedback: null,
    },
  };
}

export async function getProductHealth(
  supabase: SupabaseClient,
  weeks: number,
  includeInternal = false,
): Promise<ProductHealth> {
  const { data, error } = await supabase.rpc('analytics_product_health', {
    p_weeks: weeks,
    p_include_internal: includeInternal,
  });
  if (error) throw translateAnalyticsRpcError(error, 'analytics_product_health_failed');
  return mapProductHealth(data);
}
