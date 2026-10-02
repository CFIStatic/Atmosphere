import type {
  AnalysisPeriod,
  AskPeriod,
  EvidencePeriod,
  ProductHealth,
  UploadPeriod,
} from './types';

/**
 * The product-health API returns null for a period with no rows in its
 * window: `uploads`, `analysis` and `ask` current/prior. That is the normal
 * state right after deploy, when capture_upload_attempts and ask_turn_events
 * are still empty. No rows means zero counts and no rate or latency, so
 * normalise to that instead of letting pages read fields off null.
 */
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const EMPTY_UPLOADS: UploadPeriod = {
  started: 0,
  completed: 0,
  failed: 0,
  abandoned: 0,
  inFlight: 0,
  retried: 0,
  retrying: 0,
  completionRatePct: null,
};
const EMPTY_ANALYSIS: AnalysisPeriod = {
  received: 0,
  analysed: 0,
  failed: 0,
  pending: 0,
  medianSeconds: null,
  p90Seconds: null,
};
const EMPTY_EVIDENCE: EvidencePeriod = {
  proofsAnalysed: 0,
  dailyReportsSent: 0,
  evidenceDownloads: 0,
  shareLinksCreated: 0,
  shareLinksOpened: null,
};
const EMPTY_ASK: AskPeriod = {
  turns: 0,
  answered: 0,
  errors: 0,
  refused: 0,
  stopped: 0,
  errorRatePct: null,
  medianMs: null,
  p90Ms: null,
  medianTtftMs: null,
};

const period = <T extends object>(v: unknown, empty: T): T =>
  v && typeof v === 'object' ? ({ ...empty, ...(v as Partial<T>) } as T) : { ...empty };

export function normalizeProductHealth(raw: unknown): ProductHealth {
  const d = obj(raw);
  const windows = obj(d.windows);
  const northStar = obj(d.northStar);
  const uploads = obj(d.uploads);
  const analysis = obj(d.analysis);
  const evidence = obj(d.evidence);
  const ask = obj(d.ask);
  const questions = obj(ask.questions);
  const lifetime = obj(evidence.lifetime);
  const win = (v: unknown) => ({ from: String(obj(v).from ?? ''), to: String(obj(v).to ?? '') });

  return {
    generatedAt: typeof d.generatedAt === 'string' ? d.generatedAt : '',
    weeks: Number(d.weeks ?? 0) || 0,
    windows: { current: win(windows.current), prior: win(windows.prior) },
    northStar: {
      weekly: arr(northStar.weekly),
      latest: (northStar.latest as ProductHealth['northStar']['latest']) ?? null,
      previous: (northStar.previous as ProductHealth['northStar']['previous']) ?? null,
    },
    uploads: {
      trackingSince: typeof uploads.trackingSince === 'string' ? uploads.trackingSince : null,
      current: period(uploads.current, EMPTY_UPLOADS),
      prior: period(uploads.prior, EMPTY_UPLOADS),
      topErrors: arr(uploads.topErrors),
    },
    analysis: {
      current: period(analysis.current, EMPTY_ANALYSIS),
      prior: period(analysis.prior, EMPTY_ANALYSIS),
      weekly: arr(analysis.weekly),
    },
    evidence: {
      current: period(evidence.current, EMPTY_EVIDENCE),
      prior: period(evidence.prior, EMPTY_EVIDENCE),
      lifetime: {
        shareLinks: Number(lifetime.shareLinks ?? 0) || 0,
        shareLinkOpens: Number(lifetime.shareLinkOpens ?? 0) || 0,
      },
    },
    ask: {
      trackingSince: typeof ask.trackingSince === 'string' ? ask.trackingSince : null,
      questions: {
        current: Number(questions.current ?? 0) || 0,
        prior: Number(questions.prior ?? 0) || 0,
        orgsCurrent: Number(questions.orgsCurrent ?? 0) || 0,
      },
      current: period(ask.current, EMPTY_ASK),
      prior: period(ask.prior, EMPTY_ASK),
      feedback: null,
    },
  };
}
