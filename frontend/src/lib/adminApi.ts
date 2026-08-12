/**
 * Client for the internal /admin support portal API.
 */

export type PlatformStaffScope = 'support' | 'admin' | 'ops';

export interface PlatformAccess {
  scope: PlatformStaffScope | null;
  displayName: string | null;
}

export interface AdminOrgSummary {
  id: string;
  name: string;
  joinCode: string;
  createdAt: string;
  createdBy: string | null;
  contractorType: string | null;
  memberCount: number;
  planCode: string | null;
  billingStatus: string | null;
  seats: number | null;
  billingInterval: string | null;
}

export interface AdminMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  status: string;
  workType: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  bannedUntil: string | null;
}

export interface AdminOrgDetail extends AdminOrgSummary {
  members: AdminMember[];
  jobBriefCount: number;
  jobProofCount: number;
  inviteCount: number;
  stripeCustomerId: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  fullName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  memberships: Array<{
    orgId: string;
    orgName: string;
    role: string;
    status: string;
  }>;
  platformScope: PlatformStaffScope | null;
}

export interface AuditEntry {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  orgId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface InfraSnapshot {
  time: string;
  environment: string;
  checks: Record<string, { ok: boolean; detail?: string; skipped?: boolean }>;
  counts: Record<string, number | null>;
  configFlags: Record<string, boolean>;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class AdminError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = 'error') {
    super(message);
    this.name = 'AdminError';
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
    throw new AdminError(0, 'Network error — is the backend running?', 'network_error');
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    throw new AdminError(
      res.status,
      (body.error as string) ?? `Request failed (${res.status})`,
      (body.code as string) ?? 'error',
    );
  }
  return body as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const adminApi = {
  access: () => request<PlatformAccess>('/api/admin/access'),

  listOrgs: (opts: { q?: string; limit?: number; offset?: number } = {}) =>
    request<{ orgs: AdminOrgSummary[]; total: number }>(`/api/admin/orgs${qs(opts)}`),

  getOrg: (orgId: string) =>
    request<{ org: AdminOrgDetail }>(`/api/admin/orgs/${orgId}`),

  listUsers: (opts: { q?: string; limit?: number; page?: number } = {}) =>
    request<{ users: AdminUserSummary[]; total: number }>(`/api/admin/users${qs(opts)}`),

  getUser: (userId: string) =>
    request<{ user: AdminUserSummary }>(`/api/admin/users/${userId}`),

  resetPassword: (userId: string, mode: 'email' | 'link' = 'email') =>
    request<{ ok: boolean; mode: string; email: string; actionLink?: string }>(
      `/api/admin/users/${userId}/reset-password`,
      { method: 'POST', body: JSON.stringify({ mode }) },
    ),

  setBanned: (userId: string, banned: boolean) =>
    request<{ ok: boolean; banned: boolean }>(`/api/admin/users/${userId}/ban`, {
      method: 'POST',
      body: JSON.stringify({ banned }),
    }),

  listAudit: (opts: { limit?: number; offset?: number; orgId?: string } = {}) =>
    request<{ entries: AuditEntry[]; total: number }>(`/api/admin/audit${qs(opts)}`),

  infrastructure: () => request<InfraSnapshot>('/api/admin/infrastructure'),

  databaseTables: () => request<{ tables: string[] }>('/api/admin/database/tables'),

  browseTable: (
    table: string,
    opts: { limit?: number; offset?: number; orgId?: string } = {},
  ) =>
    request<{ table: string; rows: Record<string, unknown>[]; total: number }>(
      `/api/admin/database/${encodeURIComponent(table)}${qs(opts)}`,
    ),
};

export function scopeAtLeast(
  scope: PlatformStaffScope | null | undefined,
  min: PlatformStaffScope,
): boolean {
  if (!scope) return false;
  const rank = { support: 1, admin: 2, ops: 3 } as const;
  return rank[scope] >= rank[min];
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
