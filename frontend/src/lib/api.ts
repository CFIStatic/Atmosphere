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

  // ---- Construction Estimator ----
  estimatorStatus: () => request<EstimatorStatus>('/api/estimator/status', { method: 'GET' }),

  saveEstimatorCredential: (provider: EstimatorProvider, input: EstimatorCredentialInput) =>
    request<{ credential: EstimatorCredential }>(`/api/estimator/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  deleteEstimatorCredential: (provider: EstimatorProvider) =>
    request<{ ok: boolean }>(`/api/estimator/credentials/${provider}`, { method: 'DELETE' }),

  testEstimatorCredential: (provider: EstimatorProvider) =>
    request<{ ok: boolean; connector: string }>(`/api/estimator/credentials/${provider}/test`, {
      method: 'POST',
    }),

  listScanProjects: (search?: string) =>
    request<{ projects: ScanProjectSummary[] }>(
      `/api/estimator/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      { method: 'GET' },
    ),

  startEstimatorRun: (scanProjectId: string, mitigationText?: string) =>
    request<{ run: EstimatorRun }>('/api/estimator/runs', {
      method: 'POST',
      body: JSON.stringify({ scanProjectId, mitigationText: mitigationText || undefined }),
    }),

  listEstimatorRuns: () =>
    request<{ runs: EstimatorRun[] }>('/api/estimator/runs', { method: 'GET' }),

  getEstimatorRun: (runId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}`, { method: 'GET' }),

  selectEstimatorJob: (runId: string, jobId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}/job`, {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  approveEstimatorRun: (runId: string) =>
    request<{ run: EstimatorRun }>(`/api/estimator/runs/${runId}/approve`, { method: 'POST' }),

  /** Download URL — the browser fetches it directly so the file streams. */
  estimatorExportUrl: (runId: string, format: 'csv' | 'xml') =>
    `${API_BASE}/api/estimator/runs/${runId}/export?format=${format}`,

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

/* ------------------------------------------------------------------ */
/* Construction Estimator types                                        */
/* ------------------------------------------------------------------ */

export type EstimatorProvider = 'docusketch' | 'dash' | 'xactimate';

export interface EstimatorCredential {
  provider: EstimatorProvider;
  label: string | null;
  fingerprint: string;
  baseUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EstimatorCredentialInput {
  label?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  accountId?: string;
  baseUrl?: string;
}

export interface EstimatorStatus {
  /** True when the server is serving fixtures instead of talking to vendors. */
  sandbox: boolean;
  modelAvailable: boolean;
  credentialStorageAvailable: boolean;
  canManageCredentials: boolean;
  maxPhotosPerRun: number;
  credentials: EstimatorCredential[];
}

export interface ScanProjectSummary {
  id: string;
  name: string;
  address?: string;
  claimNumber?: string;
  capturedAt?: string;
}

export type EstimatorRunStatus = 'running' | 'awaiting_review' | 'complete' | 'failed' | 'cancelled';

export type EstimatorRunStage =
  | 'queued'
  | 'connecting'
  | 'fetching_scan'
  | 'matching_job'
  | 'analyzing_photos'
  | 'reading_mitigation'
  | 'building_scope'
  | 'pricing'
  | 'awaiting_review'
  | 'exporting'
  | 'complete';

export interface EstimatorRunEvent {
  at: string;
  stage: EstimatorRunStage;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface MatchSignal {
  field: string;
  weight: number;
  score: number;
  detail: string;
}

export interface MatchCandidate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address?: string;
  lossDate?: string;
  score: number;
  signals: MatchSignal[];
}

export interface EstimateLineItem {
  roomId: string;
  roomName: string;
  code: string;
  category: string;
  selector: string;
  description: string;
  unit: string;
  quantity: number;
  quantityWithWaste: number;
  trade: string;
  rationale: string;
  confidence: number;
  evidence: string[];
  needsReview?: boolean;
}

export interface ConstructionEstimate {
  jobId: string;
  jobNumber?: string;
  claimNumber?: string;
  insuredName?: string;
  address: { street?: string; city?: string; state?: string; postalCode?: string };
  basis: 'scan' | 'mitigation' | 'both';
  lineItems: EstimateLineItem[];
  summary: {
    lineItemCount: number;
    roomCount: number;
    quantityByUnit: Record<string, number>;
    itemsNeedingReview: number;
    emptyRooms: string[];
  };
  warnings: string[];
  generatedAt: string;
}

export interface EstimatorRun {
  id: string;
  status: EstimatorRunStatus;
  stage: EstimatorRunStage;
  scanProjectId: string;
  crmJobId: string | null;
  matchScore: number | null;
  matchNeedsReview: boolean;
  matchCandidates: MatchCandidate[];
  matchReason: string | null;
  job: { jobNumber?: string; claimNumber?: string; insuredName?: string } | null;
  estimate: ConstructionEstimate | null;
  exportRef: string | null;
  error: string | null;
  events: EstimatorRunEvent[];
  createdAt: string;
  updatedAt: string;
}

/** Stage labels, in the order the pipeline runs them. */
export const ESTIMATOR_STAGE_LABELS: Record<EstimatorRunStage, string> = {
  queued: 'Queued',
  connecting: 'Connecting',
  fetching_scan: 'Reading the scan',
  matching_job: 'Finding the job',
  analyzing_photos: 'Reading the photos',
  reading_mitigation: 'Reading the mitigation estimate',
  building_scope: 'Building scope',
  pricing: 'Assembling the estimate',
  awaiting_review: 'Ready for review',
  exporting: 'Writing to Xactimate',
  complete: 'Complete',
};

export const PROVIDER_LABELS: Record<EstimatorProvider, string> = {
  docusketch: 'DocuSketch',
  dash: 'Dash (CRM)',
  xactimate: 'Xactimate',
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
