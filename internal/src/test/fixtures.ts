/**
 * TEST DATA for unit tests. Every address is @example.test and every
 * organization name is invented. Not imported by the app.
 */
import type { Campaign, ContactDirectory, ProductHealth } from '../lib/types';

export const testHealth: ProductHealth = {
  generatedAt: '2026-10-02T15:00:00.000Z',
  weeks: 4,
  windows: {
    current: { from: '2026-09-04T15:00:00.000Z', to: '2026-10-02T15:00:00.000Z' },
    prior: { from: '2026-08-07T15:00:00.000Z', to: '2026-09-04T15:00:00.000Z' },
  },
  northStar: {
    weekly: [
      { weekStart: '2026-09-07', partial: false, payingSeats: 40, payingOrgs: 9, hoursPaying: 60, hoursAll: 70, films: 120, hoursPerSeat: 1.5 },
      { weekStart: '2026-09-14', partial: false, payingSeats: 40, payingOrgs: 9, hoursPaying: 66, hoursAll: 75, films: 130, hoursPerSeat: 1.65 },
      { weekStart: '2026-09-21', partial: false, payingSeats: 42, payingOrgs: 10, hoursPaying: 84, hoursAll: 90, films: 150, hoursPerSeat: 2 },
      { weekStart: '2026-09-28', partial: true, payingSeats: 42, payingOrgs: 10, hoursPaying: 40, hoursAll: 44, films: 70, hoursPerSeat: 0.95 },
    ],
    latest: { weekStart: '2026-09-21', partial: false, payingSeats: 42, payingOrgs: 10, hoursPaying: 84, hoursAll: 90, films: 150, hoursPerSeat: 2 },
    previous: { weekStart: '2026-09-14', partial: false, payingSeats: 40, payingOrgs: 9, hoursPaying: 66, hoursAll: 75, films: 130, hoursPerSeat: 1.65 },
  },
  uploads: {
    trackingSince: '2026-09-01T00:00:00.000Z',
    current: { started: 420, completed: 396, failed: 8, abandoned: 4, inFlight: 12, retried: 31, retrying: 2, completionRatePct: 97.1 },
    prior: { started: 380, completed: 352, failed: 12, abandoned: 6, inFlight: 10, retried: 29, retrying: 1, completionRatePct: 95.1 },
    topErrors: [{ code: 'upload_part_missing', count: 5 }],
  },
  analysis: {
    current: { received: 396, analysed: 388, failed: 3, pending: 5, medianSeconds: 1104, p90Seconds: 2700 },
    prior: { received: 352, analysed: 340, failed: 5, pending: 7, medianSeconds: 1320, p90Seconds: 3100 },
    weekly: [],
  },
  evidence: {
    current: { proofsAnalysed: 388, dailyReportsSent: 140, evidenceDownloads: 61, shareLinksCreated: 44, shareLinksOpened: 30 },
    prior: { proofsAnalysed: 340, dailyReportsSent: 120, evidenceDownloads: 55, shareLinksCreated: 38, shareLinksOpened: null },
    lifetime: { shareLinks: 310, shareLinkOpens: 1240 },
  },
  ask: {
    trackingSince: '2026-09-01T00:00:00.000Z',
    questions: { current: 512, prior: 440, orgsCurrent: 11 },
    current: { turns: 530, answered: 512, errors: 6, refused: 9, stopped: 3, errorRatePct: 1.1, medianMs: 4200, p90Ms: 9800, medianTtftMs: 900 },
    prior: { turns: 450, answered: 430, errors: 9, refused: 8, stopped: 3, errorRatePct: 2, medianMs: 4800, p90Ms: 11200, medianTtftMs: 1100 },
    feedback: null,
  },
};

export const testDirectory: ContactDirectory = {
  fetchedAt: '2026-10-02T15:00:00.000Z',
  cached: false,
  suppressedCount: 1,
  sources: [
    { id: 'stripe', label: 'Stripe', enabled: true, reason: null, count: 3, truncated: false },
    { id: 'crm', label: 'CRM', enabled: false, reason: 'Coming soon. No CRM is connected.', count: null, truncated: false },
  ],
  contacts: [
    { email: 'avery.ops@example.test', name: 'Avery Test', company: 'Test Restoration Co', orgId: null, plan: 'scale', status: 'active', createdAt: '2026-01-10T00:00:00.000Z', sources: ['stripe'], suppressed: false },
    { email: 'blake@example.test', name: 'Blake Sample', company: 'Sample Builders', orgId: null, plan: 'starter', status: 'trialing', createdAt: '2026-08-02T00:00:00.000Z', sources: ['stripe'], suppressed: false },
    { email: '=cmd@example.test', name: '=HYPERLINK("x")', company: null, orgId: null, plan: null, status: 'canceled', createdAt: '2025-11-20T00:00:00.000Z', sources: ['stripe'], suppressed: true },
  ],
};

export const testCampaign: Campaign = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'TEST DATA Q4 update',
  subject: 'What is new in Atmosphere',
  bodyMarkdown: '## Hello\n\nA **test** campaign.',
  audience: { plans: ['scale'], statuses: [], sources: [] },
  status: 'draft',
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-02T15:00:00.000Z',
  sentAt: null,
  recipientCount: null,
  sentCount: null,
  failedCount: null,
  suppressedCount: null,
};

/** Production right after deploy: the new tracking tables have no rows yet. */
export function emptyTrackingPayload(): unknown {
  const raw = JSON.parse(JSON.stringify(testHealth));
  raw.uploads.current = null;
  raw.uploads.prior = null;
  raw.uploads.trackingSince = null;
  raw.uploads.topErrors = [];
  raw.ask.current = null;
  raw.ask.prior = null;
  raw.ask.trackingSince = null;
  raw.analysis.prior = null;
  return raw;
}
