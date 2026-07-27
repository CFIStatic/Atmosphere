/**
 * Thin API client for the Atmosphere backend.
 *
 * In development, requests go to a relative `/api/...` path which Vite proxies
 * to the backend (same-origin, so cookies work seamlessly). In production set
 * `VITE_API_BASE_URL` if the backend is served from a different origin.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface AuthUser {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  metadata: Record<string, unknown>;
}

export type MemberRole =
  | 'project_manager'
  | 'field_technician'
  | 'accountant'
  | 'office_manager'
  | 'sales';

export type WorkType = 'mitigation' | 'construction';

export interface Org {
  id: string;
  name: string;
  joinCode: string;
  createdAt?: string;
}

export interface Membership {
  role: MemberRole;
  workType: WorkType;
  status: string;
  org: Org | null;
}

export interface OrgMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  workType: WorkType;
  status: string;
}

/**
 * The credential carried by a password-recovery link. Supabase emits one of
 * three shapes depending on the email template and flow type; the backend
 * normalises whichever arrives into a session.
 */
export interface RecoveryCredential {
  tokenHash?: string;
  code?: string;
  accessToken?: string;
  refreshToken?: string;
}

/** A website the organization has connected for the AI to work in. */
export interface WebConnection {
  id: string;
  label: string;
  siteUrl: string;
  loginUrl: string | null;
  username: string;
  status: 'unverified' | 'verified' | 'failed';
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** One action the AI took during a run — the audit trail for a task. */
export interface WebRunStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  error?: string;
}

export type WebRunKind = 'pull' | 'push';
export type WebRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WebRun {
  id: string;
  connectionId: string;
  kind: WebRunKind;
  instruction: string;
  status: WebRunStatus;
  result: { summary: string; records: unknown[] } | null;
  steps: WebRunStep[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WebConnectionInput {
  label: string;
  siteUrl: string;
  loginUrl?: string;
  username: string;
  password: string;
}

/* ---------------------------------------------------------------------------
 * Verifier — the second agent, which re-opens the site after a run reports
 * success and checks the work is really there.
 * ------------------------------------------------------------------------- */

/** One checkable claim, derived from the task the user originally wrote. */
export interface Expectation {
  id: string;
  kind: 'record_exists' | 'field_value' | 'record_absent' | 'state_change' | 'reported_data_matches';
  description: string;
  where: string;
  identifiers: Record<string, string>;
  expected: Record<string, string>;
  critical: boolean;
}

export type Verdict = 'satisfied' | 'violated' | 'indeterminate';

/** What the verifier actually saw for one expectation, and where. */
export interface Finding {
  expectationId: string;
  verdict: Verdict;
  evidence: string;
  url: string;
  reasoning: string;
  repair?: {
    repairClass: 'create_missing' | 'correct_value' | 'needs_human';
    instruction: string;
    rationale: string;
  };
}

export interface VerifierStep {
  index: number;
  action: string;
  detail: string;
  url: string;
  phase: 'observe' | 'repair';
  error?: string;
}

export type VerificationStatus =
  | 'queued'
  | 'running'
  | 'verified'
  | 'repaired'
  | 'escalated'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export interface Verification {
  id: string;
  runId: string;
  connectionId: string;
  status: VerificationStatus;
  verdict: Verdict | null;
  expectations: Expectation[];
  findings: Finding[];
  steps: VerifierStep[];
  repairAttempts: number;
  summary: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type EscalationReason =
  | 'indeterminate'
  | 'unsafe_repair'
  | 'repair_exhausted'
  | 'repair_failed';

/** One answer a person can give. `action` is what the verifier does with it. */
export interface EscalationOption {
  id: string;
  label: string;
  detail: string;
  action: 'repair' | 'accept' | 'reject' | 'recheck';
}

export interface EscalationContext {
  reason?: EscalationReason;
  siteLabel?: string;
  runInstruction?: string;
  verdict?: Verdict;
  verifierSummary?: string;
  unsettled?: Array<{
    expectation: string;
    verdict: Verdict;
    evidence: string;
    url: string;
    reasoning: string;
    proposedFix: string | null;
    fixSafety: string | null;
  }>;
}

export interface Escalation {
  id: string;
  verificationId: string;
  runId: string;
  reason: EscalationReason;
  question: string;
  context: EscalationContext;
  options: EscalationOption[];
  status: 'open' | 'resolved' | 'dismissed';
  chosenOption: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include', // send/receive the httpOnly session cookies
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'Network error — is the backend running?', 'network_error');
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = (body.error as string) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, (body.code as string) ?? 'error');
  }

  return body as T;
}

export interface AuthResponse {
  user: AuthUser | null;
  needsEmailConfirmation?: boolean;
  message?: string;
}

export const api = {
  // ---- Auth ----
  signup: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: AuthUser }>('/api/auth/me', { method: 'GET' }),

  // ---- Password recovery ----
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (credential: RecoveryCredential, password: string) =>
    request<{ user: AuthUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ ...credential, password }),
    }),

  // ---- Device PIN ----
  pinStatus: () =>
    request<{ enrolled: boolean; lockedUntil?: string | null }>('/api/auth/pin/status', {
      method: 'GET',
    }),

  pinEnroll: (pin: string) =>
    request<{ ok: boolean }>('/api/auth/pin/enroll', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  pinUnlock: (pin: string) =>
    request<{ user: AuthUser }>('/api/auth/pin/unlock', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    }),

  pinDisable: () => request<{ ok: boolean }>('/api/auth/pin/disable', { method: 'POST' }),

  // ---- Organization / onboarding ----
  getMembership: () => request<{ membership: Membership | null }>('/api/org/me', { method: 'GET' }),

  createOrg: (name: string, role: MemberRole, workType: WorkType) =>
    request<{ org: Org }>('/api/org', {
      method: 'POST',
      body: JSON.stringify({ name, role, workType }),
    }),

  joinOrg: (joinCode: string, role: MemberRole, workType: WorkType) =>
    request<{ org: Org }>('/api/org/join', {
      method: 'POST',
      body: JSON.stringify({ joinCode, role, workType }),
    }),

  getMembers: () => request<{ members: OrgMember[] }>('/api/org/members', { method: 'GET' }),

  // ---- Web Access ----
  webAccessStatus: () =>
    request<{ enabled: boolean; capacityAvailable: boolean; maxSteps: number }>(
      '/api/web-access/status',
      { method: 'GET' },
    ),

  getWebConnections: () =>
    request<{ connections: WebConnection[] }>('/api/web-access/connections', { method: 'GET' }),

  createWebConnection: (input: WebConnectionInput) =>
    request<{ connection: WebConnection }>('/api/web-access/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateWebConnection: (id: string, input: Partial<WebConnectionInput>) =>
    request<{ connection: WebConnection }>(`/api/web-access/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteWebConnection: (id: string) =>
    request<{ ok: boolean }>(`/api/web-access/connections/${id}`, { method: 'DELETE' }),

  verifyWebConnection: (id: string) =>
    request<{ ok: boolean; reason?: string }>(`/api/web-access/connections/${id}/verify`, {
      method: 'POST',
    }),

  startWebRun: (input: {
    connectionId: string;
    kind: WebRunKind;
    instruction: string;
    data?: unknown;
  }) =>
    request<{ run: WebRun }>('/api/web-access/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getWebRuns: () => request<{ runs: WebRun[] }>('/api/web-access/runs', { method: 'GET' }),

  getWebRun: (id: string) => request<{ run: WebRun }>(`/api/web-access/runs/${id}`, { method: 'GET' }),

  // ---- Verifier ----
  verifierStatus: () =>
    request<{
      enabled: boolean;
      autoVerify: boolean;
      verifyPulls: boolean;
      maxRepairAttempts: number;
      pending: number;
      capacityAvailable: boolean;
    }>('/api/verifier/status', { method: 'GET' }),

  getVerifications: (runId?: string) =>
    request<{ verifications: Verification[] }>(
      `/api/verifier/verifications${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`,
      { method: 'GET' },
    ),

  getVerification: (id: string) =>
    request<{ verification: Verification }>(`/api/verifier/verifications/${id}`, { method: 'GET' }),

  verifyRun: (runId: string) =>
    request<{ verificationId: string }>(`/api/verifier/runs/${runId}/verify`, { method: 'POST' }),

  getEscalations: (includeResolved = false) =>
    request<{ escalations: Escalation[] }>(
      `/api/verifier/escalations${includeResolved ? '?status=all' : ''}`,
      { method: 'GET' },
    ),

  resolveEscalation: (id: string, optionId: string, note?: string) =>
    request<{ status: string; verificationId: string }>(
      `/api/verifier/escalations/${id}/resolve`,
      { method: 'POST', body: JSON.stringify({ optionId, note }) },
    ),
};

/** How each verification state reads in the UI. */
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  queued: 'Check queued',
  running: 'Checking…',
  verified: 'Verified',
  repaired: 'Fixed and verified',
  escalated: 'Needs your answer',
  rejected: 'Confirmed not done',
  failed: "Couldn't be checked",
  cancelled: 'Check cancelled',
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  satisfied: 'Found on the site',
  violated: 'Missing or wrong',
  indeterminate: 'Could not tell',
};

/** Human-readable labels for roles and work types (shared UI copy). */
export const ROLE_LABELS: Record<MemberRole, string> = {
  project_manager: 'Project Manager',
  field_technician: 'Field Technician',
  accountant: 'Accountant',
  office_manager: 'Office Manager',
  sales: 'Sales',
};

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  mitigation: 'Mitigation',
  construction: 'Construction',
};
