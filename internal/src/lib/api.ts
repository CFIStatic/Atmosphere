import type {
  SafetyIncident,
  MotionClipsStaffResponse,
  AccessRequest,
  AccessRequestList,
  AccountDetail,
  AnalyticsAccess,
  AuthUser,
  ExperimentStats,
  MeteringPayload,
  TokenUsageAnalyticsPayload,
  AiReconciliationPayload,
  OverviewPayload,
  RangeParams,
  ReadyPayload,
  StaffChallengeResponse,
  StaffIdentity,
  StaffVerify,
  LegalHold,
  LegalHoldKind,
  LegalSubjectType,
  LegalProductionPackage,
  UserActivityEvent,
  ProductHealth,
  ContactDirectory,
  Campaign,
  CampaignAudience,
  CampaignDraft,
  CampaignSendingState,
  AudienceCount,
} from './types';
import { normalizeProductHealth } from './productHealth';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * The dev-only mock API (scripts/mock-api.mjs) stamps every response with
 * x-atmosphere-test-data: 1. The shell shows a TEST DATA ribbon when it sees
 * it. The production BFF never sends this header.
 */
let testDataSeen = false;
const testDataListeners = new Set<() => void>();
function noteTestData(res: Response) {
  if (!testDataSeen && res.headers?.get?.('x-atmosphere-test-data') === '1') {
    testDataSeen = true;
    testDataListeners.forEach((fn) => fn());
  }
}
export function isTestData(): boolean {
  return testDataSeen;
}
export function onTestData(fn: () => void): () => void {
  testDataListeners.add(fn);
  return () => testDataListeners.delete(fn);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError(
      0,
      'Atmosphere API is not reachable. Confirm the BFF is up and API_UPSTREAM points at it.',
      'network_error',
    );
  }

  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  noteTestData(res);

  if (!res.ok) {
    const explicit = typeof body.error === 'string' ? body.error.trim() : '';
    const gateway = res.status === 502 || res.status === 503 || res.status === 504;
    throw new ApiError(
      res.status,
      explicit ||
        (gateway
          ? 'Atmosphere API is not reachable. Set API_UPSTREAM on the Internal Growth Metrics Railway service to the Atmosphere APIs private HTTP URL.'
          : `Request failed (${res.status})`),
      typeof body.code === 'string' ? body.code : gateway ? 'backend_unreachable' : 'error',
    );
  }
  return body as T;
}

function rangeQuery({ from, to, months }: RangeParams): string {
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
    to.toISOString(),
  )}&months=${months}`;
}

export const api = {
  startSignIn: (input: StaffIdentity) =>
    request<StaffChallengeResponse>('/api/auth/internal-challenge', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  login: (input: StaffVerify) =>
    request<{ user: AuthUser }>('/api/auth/internal-login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  access: () => request<AnalyticsAccess>('/api/analytics/access'),

  accessRequests: () => request<AccessRequestList>('/api/analytics/access-requests'),

  approveAccessRequest: (id: string) =>
    request<{ request: AccessRequest; pendingCount: number }>(
      `/api/analytics/access-requests/${id}/approve`,
      { method: 'POST' },
    ),

  denyAccessRequest: (id: string) =>
    request<{ request: AccessRequest; pendingCount: number }>(
      `/api/analytics/access-requests/${id}/deny`,
      { method: 'POST' },
    ),

  approveAllAccessRequests: () =>
    request<{ approved: AccessRequest[]; pendingCount: number }>(
      '/api/analytics/access-requests/approve-all',
      { method: 'POST' },
    ),

  overview: (range: RangeParams) =>
    request<OverviewPayload>(`/api/analytics/overview?${rangeQuery(range)}`),

  experiments: (range: RangeParams) =>
    request<{ experiments: ExperimentStats[] }>(
      `/api/analytics/experiments?${rangeQuery(range)}`,
    ),

  metering: (range: RangeParams) =>
    request<MeteringPayload>(`/api/analytics/metering?${rangeQuery(range)}`),

  tokenUsage: (range: RangeParams) =>
    request<TokenUsageAnalyticsPayload>(`/api/analytics/token-usage?${rangeQuery(range)}`),

  aiReconciliation: (range: RangeParams) =>
    request<AiReconciliationPayload>(`/api/analytics/ai-reconciliation?${rangeQuery(range)}`),

  account: (orgId: string, range: RangeParams) =>
    request<AccountDetail>(`/api/analytics/accounts/${orgId}?${rangeQuery(range)}`),

  ready: () => request<ReadyPayload>('/api/ready'),

  legalHolds: () => request<{ holds: LegalHold[]; counts: { open: number; released: number } }>('/api/legal/holds'),

  createLegalHold: (input: {
    caseNumber: string;
    kind: LegalHoldKind;
    title: string;
    reason: string;
    counselName?: string;
    subjects: Array<{ subjectType: LegalSubjectType; subjectId: string }>;
  }) =>
    request<{ hold: LegalHold }>('/api/legal/holds', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  releaseLegalHold: (id: string, reason: string) =>
    request<{ hold: LegalHold }>(`/api/legal/holds/${id}/release`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  produceLegalHold: (id: string, note?: string) =>
    request<LegalProductionPackage>(`/api/legal/holds/${id}/produce`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  staffJobLegal: (jobId: string) => request<any>(`/api/legal/jobs/${jobId}`),

  legalActivity: (query?: { q?: string; orgId?: string; actorUserId?: string }) => {
    const params = new URLSearchParams();
    if (query?.q) params.set('q', query.q);
    if (query?.orgId) params.set('orgId', query.orgId);
    if (query?.actorUserId) params.set('actorUserId', query.actorUserId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ events: UserActivityEvent[]; count: number }>(`/api/legal/activity${suffix}`);
  },

  safetyStaffIncidents: (query?: {
    status?: 'open' | 'acknowledged' | 'dismissed' | 'all';
    severity?: 'watch' | 'critical';
    orgId?: string;
    jobId?: string;
  }) => {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (query?.severity) params.set('severity', query.severity);
    if (query?.orgId) params.set('orgId', query.orgId);
    if (query?.jobId) params.set('jobId', query.jobId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{
      incidents: SafetyIncident[];
      counts: { open: number; criticalOpen: number };
    }>(`/api/safety/staff/incidents${suffix}`);
  },

  ackSafetyStaffIncident: (id: string) =>
    request<{ incident: SafetyIncident }>(`/api/safety/staff/incidents/${id}/ack`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  motionClipsStaff: (query?: { motion?: string; orgId?: string; jobId?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.motion) params.set('motion', query.motion);
    if (query?.orgId) params.set('orgId', query.orgId);
    if (query?.jobId) params.set('jobId', query.jobId);
    if (query?.limit) params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<MotionClipsStaffResponse>(`/api/motion-clips/staff${suffix}`);
  },

  dismissSafetyStaffIncident: (id: string, input?: { reason?: string }) =>
    request<{ incident: SafetyIncident }>(`/api/safety/staff/incidents/${id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }),

    exportUrl: (range: RangeParams, dataset = 'all') =>
    `${API_BASE}/api/analytics/export?${rangeQuery(range)}&dataset=${dataset}`,

  productHealth: (weeks = 12): Promise<ProductHealth> =>
    request<unknown>(`/api/analytics/product-health?weeks=${weeks}`).then(normalizeProductHealth),

  contacts: (refresh = false) =>
    request<ContactDirectory>(`/api/analytics/contacts${refresh ? '?refresh=1' : ''}`),

  campaigns: () =>
    request<{ campaigns: Campaign[]; suppressed: number; sending: CampaignSendingState }>(
      '/api/analytics/campaigns',
    ),

  campaign: (id: string) =>
    request<{ campaign: Campaign; sending: CampaignSendingState }>(`/api/analytics/campaigns/${id}`),

  createCampaign: (draft: CampaignDraft) =>
    request<{ campaign: Campaign }>('/api/analytics/campaigns', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  updateCampaign: (id: string, draft: CampaignDraft) =>
    request<{ campaign: Campaign }>(`/api/analytics/campaigns/${id}`, {
      method: 'PUT',
      body: JSON.stringify(draft),
    }),

  deleteCampaign: (id: string) =>
    request<Record<string, never>>(`/api/analytics/campaigns/${id}`, { method: 'DELETE' }),

  audienceCount: (audience: CampaignAudience) =>
    request<AudienceCount>('/api/analytics/campaigns/audience', {
      method: 'POST',
      body: JSON.stringify({ audience }),
    }),

  sendCampaign: (id: string, confirmRecipientCount: number) =>
    request<{ campaign: Campaign; attempted: number; sent: number; failed: number; suppressed: number }>(
      `/api/analytics/campaigns/${id}/send`,
      { method: 'POST', body: JSON.stringify({ confirmRecipientCount }) },
    ),

  aiBudgets: () =>
    request<{
      budgets: Array<{
        orgId: string;
        orgName: string | null;
        state: string;
        paused: boolean;
        usedNanos: number;
        allowanceNanos: number;
        usedFraction: number;
        creditBalanceNanos: number;
        resetAt: string | null;
      }>;
    }>('/api/analytics/ai-budgets'),

  grantAiCredits: (orgId: string, dollars: number, note?: string) =>
    request<{ applied: boolean; balanceNanos: number }>(`/api/analytics/ai-budgets/${orgId}/credits`, {
      method: 'POST',
      body: JSON.stringify({ dollars, note }),
    }),
};

export function defaultRange(): RangeParams {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  return { from, to, months: 12 };
}

export type TokenUsageWindow = '30d' | 'all';

export function tokenUsageRange(window: TokenUsageWindow = '30d'): RangeParams {
  const to = new Date();
  const days = window === 'all' ? 3650 : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to, months: Math.max(1, Math.round(days / 30)) };
}
