import type {
  AccessRequest,
  AccessRequestList,
  AccountDetail,
  AutoHoldDesk,
  AutoHoldSweep,
  AnalyticsAccess,
  AuthUser,
  ExperimentStats,
  MeteringPayload,
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
} from './types';

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

  if (!res.ok) {
    const explicit = typeof body.error === 'string' ? body.error.trim() : '';
    const gateway = res.status === 502 || res.status === 503 || res.status === 504;
    throw new ApiError(
      res.status,
      explicit ||
        (gateway
          ? 'Atmosphere API is not reachable. Set API_UPSTREAM on Internal Growth Metrics to the Atmosphere APIs private HTTP URL.'
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

  /** What the preservation rules see right now, and what they already froze. */
  autoHolds: (jobId?: string) =>
    request<AutoHoldDesk>(`/api/legal/auto-holds${jobId ? `?jobId=${jobId}` : ''}`),

  /** Run the rules. `apply: false` is the dry run. */
  sweepAutoHolds: (input?: { jobId?: string; apply?: boolean }) =>
    request<AutoHoldSweep>('/api/legal/auto-holds/sweep', {
      method: 'POST',
      body: JSON.stringify({ apply: input?.apply ?? true, ...(input?.jobId ? { jobId: input.jobId } : {}) }),
    }),

  legalActivity: (query?: { q?: string; orgId?: string; actorUserId?: string }) => {
    const params = new URLSearchParams();
    if (query?.q) params.set('q', query.q);
    if (query?.orgId) params.set('orgId', query.orgId);
    if (query?.actorUserId) params.set('actorUserId', query.actorUserId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ events: UserActivityEvent[]; count: number }>(`/api/legal/activity${suffix}`);
  },

  exportUrl: (range: RangeParams, dataset = 'all') =>
    `${API_BASE}/api/analytics/export?${rangeQuery(range)}&dataset=${dataset}`,
};

export function defaultRange(): RangeParams {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  return { from, to, months: 12 };
}
