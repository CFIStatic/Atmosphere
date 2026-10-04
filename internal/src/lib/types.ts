export type AnalyticsScope = 'investor' | 'internal';

export interface AnalyticsAccess {
  scope: AnalyticsScope | null;
  displayName: string | null;
  pendingAccessRequests?: number;
}

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequest {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: AccessRequestStatus;
  requestedAt: string;
  lastRequestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  userId: string | null;
}

export interface AccessRequestList {
  requests: AccessRequest[];
  pendingCount: number;
}

export interface StaffIdentity {
  firstName?: string;
  lastName?: string;
  email: string;
}

export type StaffChallengeResponse =
  | { status: 'ready' }
  | { status: 'pending' }
  | { status: 'setup' };

export interface StaffVerify {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: string;
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
    annualContractedArrCents: number;
    mrrGrowthMomPct: number | null;
    netNewMrrCents: number;
    collectedInRangeCents: number;
    trailing12mRevenueCents: number;
    avgMonthlySpendPerAccountCents: number | null;
    arpaMrrCents: number | null;
    trialPipelineMrrCents: number;
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
  mrrCents: number;
  arrCents: number;
  revenueCents: number;
  trackedHours: number;
}

export interface FeatureRow {
  featureKey: string;
  label: string;
  area: string;
  sessions: number;
  activeHours: number;
  users: number;
  orgs: number;
  sharePct: number;
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
}

export interface ExperimentStats {
  experimentKey: string;
  name: string;
  status: string;
  description: string | null;
  variants: Array<{
    variantKey: string;
    label: string;
    weight: number;
    assignments: number;
    exposures: number;
    conversions: number;
    events: number;
  }>;
}

export interface AccountMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  workType: string | null;
  status: string;
  createdAt: string;
}

export interface AccountJob {
  id: string;
  title: string;
  status: string;
  workType: string | null;
  jobNumber: number | null;
  createdAt: string;
}

export interface AccountOrgFeature {
  featureKey: string;
  label: string;
  activeHours: number;
  sessions: number;
}

export interface AccountDetail {
  account: AccountRow;
  members: AccountMember[];
  jobs: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    recent: AccountJob[];
  };
  features: AccountOrgFeature[];
}


export interface TokenUsageTotals {
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  priceNanos: number;
  costNanos: number;
  distinctOrgs: number;
  distinctUsers: number;
  distinctModels: number;
}

export interface TokenUsageWindowInfo {
  from: string;
  to: string;
  /** e.g. "Rolling 30 days (UTC)" — the same window Settings › Billing shows for "Last 30 days". */
  label: string;
  timeZone: string;
}

export interface TokenUsageHealth {
  /** Rows stored at $0 with tokens, priced here by the shared rule. */
  repricedEvents: number;
  /** Rows with tokens whose model has no price on the rate card. Should be 0. */
  unpricedEvents: number;
  unpricedModels: Array<{ model: string; events: number }>;
  ok: boolean;
}

export interface TokenUsageAnalyticsPayload {
  range?: { from: string; to: string };
  window?: TokenUsageWindowInfo;
  pricing?: { rule: string; rateCardVerifiedAt: string };
  health?: TokenUsageHealth;
  totals?: TokenUsageTotals;
  byCustomer?: Array<{
    orgId: string;
    orgName: string;
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    priceNanos: number;
    distinctUsers: number;
    distinctModels: number;
  }>;
  byUser?: Array<{
    userId: string;
    userName: string;
    email: string | null;
    orgId: string;
    orgName: string;
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    priceNanos: number;
  }>;
  byModel?: Array<{
    model: string;
    eventCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    totalTokens: number;
    priceNanos: number;
    distinctOrgs: number;
    distinctUsers: number;
  }>;
  byFeature?: Array<{
    feature: string;
    eventCount: number;
    totalTokens: number;
    priceNanos: number;
  }>;
}

export interface MeteringPayload {
  totals?: {
    eventCount: number;
    aiCostNanos: number;
    computeUnits: number;
    distinctOrgs: number;
  };
  byCustomer?: Array<{
    orgId: string;
    orgName: string;
    eventCount: number;
    aiCostNanos: number;
    computeUnits: number;
    distinctJobs: number;
  }>;
  byWorkflow?: Array<{ workflowId: string; eventCount: number; aiCostNanos: number }>;
  byModel?: Array<{
    provider: string;
    model: string;
    eventCount: number;
    aiCostNanos: number;
  }>;
}

export interface ReadyPayload {
  status: string;
  service: string;
  time: string;
  checks?: Record<string, { ok: boolean; detail?: string; skipped?: boolean }>;
}

export interface RangeParams {
  from: Date;
  to: Date;
  months: number;
}

export type LegalHoldKind = 'subpoena' | 'lawsuit' | 'preservation' | 'investigation' | 'other';
export type LegalHoldStatus = 'open' | 'released';
export type LegalSubjectType = 'org' | 'user' | 'job' | 'proof' | 'media';

export interface LegalHoldSubject {
  id: string;
  holdId: string;
  subjectType: LegalSubjectType;
  subjectId: string;
  createdAt: string;
}

export interface LegalHold {
  id: string;
  caseNumber: string;
  kind: LegalHoldKind;
  title: string;
  reason: string;
  counselName: string | null;
  receivedAt: string;
  dueAt: string | null;
  status: LegalHoldStatus;
  createdBy: string | null;
  createdAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  subjects: LegalHoldSubject[];
}

export interface UserActivityEvent {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  orgId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  path: string | null;
  status: number | null;
}

export interface LegalProductionPackage {
  production: { id: string; itemCount: number; activityCount: number; createdAt: string };
  videos: Array<{
    id: string;
    sourceKind: string;
    sourceId: string;
    userDeleted: boolean;
    downloadUrl: string | null;
    contentHash: string | null;
  }>;
  activity: UserActivityEvent[];
}


export interface MotionClipStaffItem {
  startSec: number;
  endSec: number;
  action: string;
  motion: string;
  description: string;
  toolLabel: string | null;
  objectLabel: string | null;
  materialLabel: string | null;
  room: string | null;
  confidence: number;
  source: string;
  durationInferred: boolean;
  proofId: string;
  jobId: string;
  orgId: string;
  workDate: string | null;
  phase: string | null;
  jobTitle?: string | null;
  company?: string | null;
}

export interface MotionTypeBucket {
  motion: string;
  action: string | null;
  count: number;
  clips: MotionClipStaffItem[];
}

export interface MotionClipsStaffResponse {
  motion: string | null;
  orgId: string | null;
  totalClips: number;
  types: Array<{ motion: string; action: string | null; count: number }>;
  buckets: MotionTypeBucket[];
  knownTypes?: Array<{ motion: string; action: string }>;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Atmosphere Analytics: product health (/api/analytics/product-health)

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
  completionRatePct: number | null;
}

export interface AnalysisPeriod {
  received: number;
  analysed: number;
  failed: number;
  pending: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

export interface EvidencePeriod {
  proofsAnalysed: number;
  dailyReportsSent: number;
  evidenceDownloads: number;
  shareLinksCreated: number;
  shareLinksOpened: number | null;
}

export interface AskPeriod {
  turns: number;
  answered: number;
  errors: number;
  refused: number;
  stopped: number;
  errorRatePct: number | null;
  medianMs: number | null;
  p90Ms: number | null;
  medianTtftMs: number | null;
}

export interface ProductHealth {
  generatedAt: string;
  weeks: number;
  windows: {
    current: { from: string; to: string };
    prior: { from: string; to: string };
  };
  northStar: {
    weekly: NorthStarWeek[];
    latest: NorthStarWeek | null;
    previous: NorthStarWeek | null;
  };
  uploads: {
    trackingSince: string | null;
    current: UploadPeriod;
    prior: UploadPeriod;
    topErrors: Array<{ code: string; count: number }>;
  };
  analysis: {
    current: AnalysisPeriod;
    prior: AnalysisPeriod;
    weekly: Array<{ weekStart: string; analysed: number; medianSeconds: number | null; p90Seconds: number | null }>;
  };
  evidence: {
    current: EvidencePeriod;
    prior: EvidencePeriod;
    lifetime: { shareLinks: number; shareLinkOpens: number };
  };
  ask: {
    trackingSince: string | null;
    questions: { current: number; prior: number; orgsCurrent: number };
    current: AskPeriod;
    prior: AskPeriod;
    feedback: null;
  };
}

// ---------------------------------------------------------------------------
// Contacts and campaigns (/api/analytics/contacts, /api/analytics/campaigns)

export type ContactSourceId = 'stripe' | 'crm';
export type ContactStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';

export interface Contact {
  email: string;
  name: string | null;
  company: string | null;
  orgId: string | null;
  plan: string | null;
  status: ContactStatus;
  createdAt: string | null;
  sources: ContactSourceId[];
  suppressed: boolean;
}

export interface ContactSourceInfo {
  id: ContactSourceId;
  label: string;
  enabled: boolean;
  reason: string | null;
  count: number | null;
  truncated: boolean;
}

export interface ContactDirectory {
  contacts: Contact[];
  sources: ContactSourceInfo[];
  fetchedAt: string;
  cached: boolean;
  suppressedCount: number;
}

export interface CampaignAudience {
  plans: string[];
  statuses: ContactStatus[];
  sources: ContactSourceId[];
}

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  bodyMarkdown: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  recipientCount: number | null;
  sentCount: number | null;
  failedCount: number | null;
  suppressedCount: number | null;
}

export interface CampaignSendingState {
  enabled: boolean;
  reason: string | null;
  code: string | null;
}

export interface CampaignDraft {
  name: string;
  subject: string;
  bodyMarkdown: string;
  audience: CampaignAudience;
}

export interface AudienceCount {
  matched: number;
  suppressed: number;
  recipients: number;
  fetchedAt: string;
}

export interface AiReconciliationDay {
  day: string;
  oursUsd: number;
  theirsUsd: number | null;
  varianceUsd: number | null;
  variancePct: number | null;
  flagged: boolean;
  pending: boolean;
}

export interface AiReconciliationProvider {
  provider: 'anthropic' | 'google' | 'openai' | 'tavily';
  label: string;
  status: 'connected' | 'not_connected' | 'error' | 'unsupported';
  requires: string[];
  source: string;
  note: string | null;
  error: string | null;
  days: AiReconciliationDay[];
  totals: {
    oursUsd: number;
    theirsUsd: number | null;
    varianceUsd: number | null;
    variancePct: number | null;
    flagged: boolean;
  };
}

export interface AiReconciliationPayload {
  generatedAt: string;
  window: { from: string; to: string; timeZone: string };
  thresholdPct: number;
  flaggedCount: number;
  providers: AiReconciliationProvider[];
}
