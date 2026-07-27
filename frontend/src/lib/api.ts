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

/* ---- Audit ledger ---------------------------------------------------- */

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AgentActorType = 'user' | 'system' | 'schedule' | 'agent';
export type AgentStepStatus = 'ok' | 'error' | 'pending';
export type AgentAccent = 'brand' | 'emerald' | 'amber' | 'sky' | 'rose';

export type AgentStepType =
  | 'status'
  | 'thought'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'observation'
  | 'navigation'
  | 'decision'
  | 'artifact'
  | 'usage'
  | 'error'
  | 'event';

/** An agent as the catalog describes it, independent of whether it has run. */
export interface AgentDefinition {
  key: string;
  name: string;
  blurb: string;
  accent: AgentAccent;
  /** 'ledger' — writes its own trace. 'bridge' — mirrored from its own table. */
  intake: 'ledger' | 'bridge';
  sourceTable?: string;
}

export interface AgentSummary extends AgentDefinition {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  steps: number;
  lastRunAt: string | null;
  avgDurationMs: number | null;
}

export interface AuditRun {
  id: string;
  agentKey: string;
  agent: AgentDefinition;
  agentLabel: string | null;
  actorType: AgentActorType;
  actorUserId: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  parentRunId: string | null;
  title: string;
  summary: string | null;
  status: AgentRunStatus;
  error: string | null;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  sourceTable: string | null;
  sourceId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string | null;
  /** Detail view only — omitted from the list to keep pages small. */
  input?: unknown;
  result?: unknown;
}

export interface AuditStep {
  id: string;
  seq: number;
  type: AgentStepType;
  action: string | null;
  detail: string | null;
  target: string | null;
  payload: unknown;
  status: AgentStepStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AuditStats {
  totalRuns: number;
  activeRuns: number;
  failedRuns: number;
  succeededRuns: number;
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  runs24h: number;
  agentsSeen: number;
  lastRunAt: string | null;
}

export interface AuditRunFilters {
  agent?: string;
  status?: AgentRunStatus;
  actorType?: AgentActorType;
  q?: string;
  from?: string;
  limit?: number;
  cursor?: string;
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

/* ------------------------------ Computer use ------------------------------ */

export type CaptureQuality = 'economical' | 'balanced' | 'detailed';

/** A computer with the agent running and connected. */
export interface ComputerAgent {
  id: string;
  name: string;
  platform: string;
  version: string;
  screen: { width: number; height: number };
  /** Resolution the model sees; null until the computer is configured. */
  capture: { width: number; height: number; scale: number } | null;
  capabilities: string[];
  connectedAt: string;
  busy: boolean;
}

export interface CredentialStatus {
  connected: boolean;
  /** 'organization' — entered here; 'server' — set as ANTHROPIC_API_KEY. */
  source: 'organization' | 'server' | null;
  hint: string | null;
  updatedAt: string | null;
}

export interface ComputerStatus {
  enabled: boolean;
  credential: CredentialStatus;
  agents: ComputerAgent[];
  models: { id: string; label: string }[];
  defaults: { model: string; quality: CaptureQuality };
  limits: { maxSteps: number; runTimeoutMs: number };
}

export type RunStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopped';

export interface ComputerRun {
  id: string;
  agentId: string;
  agentName: string;
  instruction: string;
  model: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
  error: string | null;
}

/** One entry in the live transcript streamed over SSE. */
export type RunEvent = { seq: number; at: string } & (
  | { type: 'status'; status: RunStatus; message?: string }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'action'; action: string; summary: string; ok: boolean; error?: string }
  | { type: 'screenshot'; image: string | null; width: number; height: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
);

/** The stream also carries periodic run summaries, which are not transcript entries. */
export type RunStreamMessage = RunEvent | { type: 'summary'; run: ComputerRun };

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

  // ---- Audit ----
  auditAgents: () => request<{ agents: AgentSummary[] }>('/api/audit/agents', { method: 'GET' }),

  auditStats: () => request<{ stats: AuditStats }>('/api/audit/stats', { method: 'GET' }),

  auditRuns: (filters: AuditRunFilters = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return request<{ runs: AuditRun[]; nextCursor: string | null }>(
      `/api/audit/runs${query ? `?${query}` : ''}`,
      { method: 'GET' },
    );
  },

  /**
   * One run and its trace. `afterSeq` fetches only steps past the ones already
   * held, so tailing a running agent stays cheap however long it runs.
   */
  auditRun: (id: string, afterSeq = 0) =>
    request<{ run: AuditRun; steps: AuditStep[]; moreSteps: boolean }>(
      `/api/audit/runs/${id}${afterSeq > 0 ? `?afterSeq=${afterSeq}` : ''}`,
      { method: 'GET' },
    ),

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
  // ---- Computer use ----
  computerStatus: () => request<ComputerStatus>('/api/computer/status', { method: 'GET' }),

  connectAnthropicKey: (apiKey: string) =>
    request<{ credential: CredentialStatus }>('/api/computer/credentials', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  disconnectAnthropicKey: () =>
    request<{ credential: CredentialStatus }>('/api/computer/credentials', { method: 'DELETE' }),

  createPairingCode: () =>
    request<{ code: string; expiresAt: string }>('/api/computer/agents/pair-code', {
      method: 'POST',
    }),

  getAgents: () => request<{ agents: ComputerAgent[] }>('/api/computer/agents', { method: 'GET' }),

  getAgentScreen: (agentId: string) =>
    request<{ image: string; width: number; height: number }>(
      `/api/computer/agents/${encodeURIComponent(agentId)}/screen`,
      { method: 'GET' },
    ),

  startRun: (input: {
    agentId: string;
    instruction: string;
    model?: string;
    quality?: CaptureQuality;
  }) =>
    request<{ run: ComputerRun }>('/api/computer/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getRuns: () => request<{ runs: ComputerRun[] }>('/api/computer/runs', { method: 'GET' }),

  stopRun: (runId: string) =>
    request<{ run: ComputerRun }>(`/api/computer/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    }),

  /** SSE URL for a run's transcript. `after` replays what the browser missed. */
  runEventsUrl: (runId: string, after = 0) =>
    `${API_BASE}/api/computer/runs/${encodeURIComponent(runId)}/events?after=${after}`,
};

/** Labels for the run states, kept next to the other shared UI copy. */
export const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const STEP_TYPE_LABELS: Record<AgentStepType, string> = {
  status: 'Status',
  thought: 'Reasoning',
  message: 'Message',
  tool_call: 'Action',
  tool_result: 'Result',
  observation: 'Observation',
  navigation: 'Navigation',
  decision: 'Decision',
  artifact: 'Artifact',
  usage: 'Usage',
  error: 'Error',
  event: 'Event',
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

/** Friendly labels for the platform string the agent reports. */
export const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export const QUALITY_LABELS: Record<CaptureQuality, string> = {
  economical: 'Economical — smallest screenshots, lowest cost',
  balanced: 'Balanced — about 1080p (recommended)',
  detailed: 'Detailed — highest resolution the model allows',
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
