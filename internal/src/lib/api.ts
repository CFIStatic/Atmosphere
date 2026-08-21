import type {
  AccountDetail,
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
    throw new ApiError(
      res.status,
      explicit || `Request failed (${res.status})`,
      typeof body.code === 'string' ? body.code : 'error',
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

  exportUrl: (range: RangeParams, dataset = 'all') =>
    `${API_BASE}/api/analytics/export?${rangeQuery(range)}&dataset=${dataset}`,
};

export function defaultRange(): RangeParams {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  return { from, to, months: 12 };
}
