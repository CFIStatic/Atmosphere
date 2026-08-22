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
  firstName: string;
  lastName: string;
  email: string;
}

export type StaffChallengeResponse =
  | { status: 'code'; challenge: string }
  | { status: 'pending' }
  | {
      status: 'enroll';
      challenge: string;
      otpauthUrl: string;
      qrDataUrl: string;
      secret: string;
      issuer: string;
    };

export interface StaffVerify {
  challenge: string;
  code: string;
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

export interface ProductInsight {
  id: string;
  kind: 'cut' | 'invest' | 'stickiness' | 'watch';
  priority: 'high' | 'medium' | 'low';
  title: string;
  rationale: string;
  action: string;
}

export interface ProductIntelligence {
  confidence: 'low' | 'medium' | 'high';
  confidenceNote: string;
  insights: ProductInsight[];
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
  productIntelligence: ProductIntelligence | null;
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
