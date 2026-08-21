import { demoAccountDetail, demoExperiments, demoMetering, demoOverview, demoReady } from './demo';
import { isDemoMode } from './demoMode';
import type {
  AccountDetail,
  AnalyticsAccess,
  AuthUser,
  ExperimentStats,
  MeteringPayload,
  OverviewPayload,
  RangeParams,
  ReadyPayload,
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
      'Atmosphere API is not running. Start it with `cd backend && npm run dev`.',
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

export const DEMO_USER: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'jack@jettx.ai',
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const api = {
  login: (email: string, password: string) =>
    request<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: AuthUser }>('/api/auth/me'),

  access: () => request<AnalyticsAccess>('/api/analytics/access'),

  overview: (range: RangeParams) =>
    isDemoMode()
      ? Promise.resolve(demoOverview)
      : request<OverviewPayload>(`/api/analytics/overview?${rangeQuery(range)}`),

  experiments: (range: RangeParams) =>
    isDemoMode()
      ? Promise.resolve({ experiments: demoExperiments })
      : request<{ experiments: ExperimentStats[] }>(
          `/api/analytics/experiments?${rangeQuery(range)}`,
        ),

  metering: (range: RangeParams) =>
    isDemoMode()
      ? Promise.resolve(demoMetering)
      : request<MeteringPayload>(`/api/analytics/metering?${rangeQuery(range)}`),

  account: (orgId: string, range: RangeParams) =>
    isDemoMode()
      ? Promise.resolve(demoAccountDetail(orgId)).then((detail) => {
          if (!detail) throw new ApiError(404, 'Organization not found', 'org_not_found');
          return detail;
        })
      : request<AccountDetail>(`/api/analytics/accounts/${orgId}?${rangeQuery(range)}`),

  ready: () =>
    isDemoMode()
      ? Promise.resolve(demoReady)
      : request<ReadyPayload>('/api/ready'),

  exportUrl: (range: RangeParams, dataset = 'all') =>
    `${API_BASE}/api/analytics/export?${rangeQuery(range)}&dataset=${dataset}`,
};

export function defaultRange(): RangeParams {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  return { from, to, months: 12 };
}
