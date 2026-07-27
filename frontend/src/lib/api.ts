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

  // ---- Mitigation estimator ----
  buildEstimate: (input: BuildEstimateInput) =>
    request<{ estimate: MitigationEstimate; priceListConnected: boolean }>(
      '/api/estimator/build',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  saveEstimate: (input: BuildEstimateInput) =>
    request<{ estimateId: string; jobId: string; estimate: MitigationEstimate }>(
      '/api/estimator/estimates',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  getEstimatorJobs: () =>
    request<{ jobs: EstimatorJob[] }>('/api/estimator/jobs', { method: 'GET' }),

  getDemoSources: () =>
    request<{ sources: BuildEstimateInput }>('/api/estimator/demo-sources', { method: 'GET' }),

  getCarriers: () =>
    request<{ carriers: Array<{ id: string; name: string }>; programs: Array<{ id: string; name: string }> }>(
      '/api/estimator/carriers',
      { method: 'GET' },
    ),

  getAgreements: () =>
    request<{ agreements: ProgramAgreementSummary[]; source: string }>('/api/estimator/agreements', {
      method: 'GET',
    }),

  getDeviations: (jobId: string) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/estimator/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'GET' },
    ),

  acceptDeviation: (jobId: string, deviation: Omit<SlaDeviation, 'proposed'>) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/estimator/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'POST', body: JSON.stringify(deviation) },
    ),

  removeDeviation: (jobId: string, ruleId: string) =>
    request<{ ok: boolean }>(
      `/api/estimator/jobs/${encodeURIComponent(jobId)}/deviations/${encodeURIComponent(ruleId)}`,
      { method: 'DELETE' },
    ),

  getStandards: () =>
    request<{
      editions: { s500: string; s520: string };
      note: string;
      references: Array<StandardReference & { formatted: string }>;
    }>('/api/estimator/standards', { method: 'GET' }),

  getEstimatorSettings: () =>
    request<{ settings: EstimatorSettings }>('/api/estimator/settings', { method: 'GET' }),

  saveEstimatorSettings: (settings: EstimatorSettings) =>
    request<{ settings: EstimatorSettings }>('/api/estimator/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  /** Export URL for an estimate. The browser downloads it directly (cookies ride along). */
  estimateExportUrl: (estimateId: string, format: 'csv' | 'xml' | 'scope') =>
    `${API_BASE}/api/estimator/estimates/${estimateId}/export?format=${format}`,

  // ---- Xactimate connection ----
  xactimateStatus: () => request<XactimateStatus>('/api/xactimate/status', { method: 'GET' }),

  xactimateConnect: (input: XactimateConnectInput) =>
    request<XactimateConnectResponse>('/api/xactimate/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  xactimateDisconnect: () =>
    request<{ ok: boolean }>('/api/xactimate/disconnect', { method: 'POST' }),

  xactimatePriceLists: () =>
    request<{ priceLists: PriceListSummary[]; selected: string | null }>(
      '/api/xactimate/price-lists',
      { method: 'GET' },
    ),

  xactimateSyncPriceList: (priceListId: string) =>
    request<{ priceListId: string; name: string; entryCount: number }>(
      '/api/xactimate/price-lists/sync',
      { method: 'POST', body: JSON.stringify({ priceListId }) },
    ),

  xactimateActivity: () =>
    request<{ activity: XactimateActivity[] }>('/api/xactimate/activity', { method: 'GET' }),

  xactimatePush: (estimate: MitigationEstimate, confirmedFindings: boolean) =>
    request<{ estimateId: string; url?: string; lineItemsWritten: number; warnings: string[] }>(
      '/api/xactimate/push',
      { method: 'POST', body: JSON.stringify({ estimate, confirmedFindings }) },
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



/* ------------------------------------------------------------------ *
 * Estimator types
 *
 * Mirrors backend/src/estimator/types.ts. Only the fields the UI actually
 * renders are declared — the payload carries more (the full assessment, every
 * scope item) and it round-trips untouched when an estimate is pushed.
 * ------------------------------------------------------------------ */

export interface BuildEstimateInput {
  jobId?: string;
  /** A human's correction to who the estimate is for. Always beats inference. */
  carrier?: { carrierId?: string; programId?: string };
  docusketch?: unknown;
  mica?: unknown;
  photos?: PhotoManifestEntry[];
  notes?: string;
  overrides?: Record<string, unknown>;
  settings?: EstimatorSettings;
}

export interface PhotoManifestEntry {
  filename?: string;
  capturedAt?: string;
  caption?: string;
  roomName?: string;
  uri?: string;
}

export interface EstimatorSettings {
  targetMargin?: number;
  overheadAndProfitRate?: number;
  oAndPEligible?: boolean;
  taxRate?: number;
  costMultiplier?: number;
  lineMarginFloor?: number;
  hoursPerMonitoringVisit?: number;
  techniciansOnSite?: number;
  category3CutHeightIn?: number;
  costOverrides?: Record<string, number>;
}

export interface EstimatorJob {
  id: string;
  name: string;
  claimNumber: string | null;
  status: string;
  createdAt: string;
}

export interface EstimateLineItem {
  id: string;
  code: string;
  category: string;
  description: string;
  roomName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  rcv: number;
  totalCost: number;
  justification: string;
  /** Registry ids of the IICRC requirements behind this line. */
  citations: string[];
  evidenceIds: string[];
  evidenceGap?: string;
  priceVerified: boolean;
}

/* ---- IICRC standards ---- */

/**
 * How firmly a citation is anchored. `convention` is the one that matters most
 * to render honestly — it marks a practice the industry attributes to the
 * standard that the standard itself leaves to judgement.
 */
export type CitationConfidence = 'clause' | 'chapter' | 'convention';

export interface StandardReference {
  id: string;
  standard: 'S500' | 'S520';
  edition: string;
  chapter: string;
  section?: string;
  title: string;
  requirement: string;
  application: string;
  confidence: CitationConfidence;
  caveat?: string;
}

export type ComplianceStatus = 'met' | 'unmet' | 'undetermined' | 'not_applicable';

/* ---- Carrier program terms ---- */

export type SlaStatus =
  | 'met'
  | 'violated'
  | 'deviation_documented'
  | 'approval_required'
  | 'not_applicable'
  | 'undetermined';

export interface SlaDeviation {
  ruleId: string;
  reason: string;
  evidenceIds: string[];
  authorizedBy?: string;
  authorizedAt?: string;
  proposed?: boolean;
}

export interface SlaCheck {
  ruleId: string;
  title: string;
  status: SlaStatus;
  severity: 'hard' | 'soft';
  detail: string;
  remedy?: string;
  revenueImpact?: number;
  deviation?: SlaDeviation;
  sourceRef?: string;
}

export interface CarrierIdentification {
  carrierId: string | null;
  carrierName: string | null;
  programId: string | null;
  programName: string | null;
  confidence: 'stated' | 'inferred' | 'unknown';
  basis: string[];
  alternatives: Array<{ carrierId: string; carrierName: string; basis: string }>;
}

export interface ProgramAgreementSummary {
  carrierId: string;
  carrierName: string;
  programId: string;
  programName: string;
  version: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  rules: Array<{ id: string; title: string; summary: string; severity: 'hard' | 'soft'; sourceRef?: string }>;
  source: { kind: string; reference?: string; retrievedAt: string; enteredBy?: string };
}

export interface SlaComplianceReport {
  identification: CarrierIdentification;
  agreement: ProgramAgreementSummary | null;
  checks: SlaCheck[];
  met: number;
  violated: number;
  deviations: number;
  proposedDeviations: SlaDeviation[];
  blocksSubmission: boolean;
  summary: string;
}

export interface ComplianceCheck {
  id: string;
  citation: string;
  title: string;
  status: ComplianceStatus;
  detail: string;
  remedy?: string;
  affectsEstimate?: boolean;
}

export interface ComplianceReport {
  checks: ComplianceCheck[];
  met: number;
  unmet: number;
  undetermined: number;
  citations: string[];
  summary: string;
}

export interface ProfitFinding {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  kind: string;
  title: string;
  detail: string;
  revenueImpact: number;
  marginImpact: number;
  actionRequired?: string;
  relatedCode?: string;
}

export interface ProfitabilitySummary {
  subtotal: number;
  overheadAndProfit: number;
  tax: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
  targetMargin: number;
  marginGap: number;
  findings: ProfitFinding[];
  recoverableRevenue: number;
}

export interface AssessedRoomSummary {
  id: string;
  name: string;
  level: string;
  geometry: { floorSF: number; wallSF: number; ceilingSF: number; perimeterLF: number; heightFt: number };
  affectedFloorFraction: number;
  ceilingAffected: boolean;
}

export interface LossAssessmentSummary {
  jobId: string;
  propertyAddress?: string;
  claimNumber?: string;
  carrier?: string;
  insuredName?: string;
  dateOfLoss?: string;
  cause: string;
  sourceCategory: 1 | 2 | 3;
  category: 1 | 2 | 3;
  class: 1 | 2 | 3 | 4;
  rooms: AssessedRoomSummary[];
  dryingDays: number;
  monitoringVisits: number;
  microbialGrowthPresent: boolean;
  sourcesUsed: string[];
  evidence: Array<{ id: string; kind: string; description: string; tags: string[] }>;
}

export interface MitigationEstimate {
  jobId: string;
  generatedAt: string;
  assessment: LossAssessmentSummary;
  lineItems: EstimateLineItem[];
  profitability: ProfitabilitySummary;
  /** The estimate read back against the IICRC standards. */
  compliance: ComplianceReport;
  /** The carrier program terms, and whether the estimate satisfies them. */
  sla: SlaComplianceReport;
  /** Every standard cited anywhere in this estimate, resolved. */
  references: StandardReference[];
  narrative: string;
  openQuestions: string[];
}

/* ---- Xactimate ---- */

export type ConsentScope =
  | 'read_profile'
  | 'read_price_list'
  | 'read_estimates'
  | 'write_estimate'
  | 'submit_estimate';

export interface XactimateStatus {
  connected: boolean;
  sessionActive: boolean;
  driver: 'mock' | 'api' | 'web';
  storageAvailable: boolean;
  webAutomationEnabled: boolean;
  username: string | null;
  scopes: ConsentScope[];
  storageMode: 'session' | 'stored';
  grantedAt: string | null;
  expiresAt: string | null;
  priceListId: string | null;
  availableScopes: Array<{ scope: ConsentScope; description: string; defaultGranted: boolean }>;
}

export interface XactimateConnectInput {
  username: string;
  password: string;
  mfaCode?: string;
  scopes: ConsentScope[];
  storageMode: 'session' | 'stored';
  consentDays: number;
  acknowledgedTerms: true;
}

export type XactimateConnectResponse =
  | { status: 'connected'; profile: { username: string; displayName?: string; companyName?: string }; scopes: ConsentScope[]; expiresAt: string }
  | { status: 'mfa_required'; challengeId: string; message: string };

export interface PriceListSummary {
  id: string;
  name: string;
  effectiveDate?: string;
}

export interface XactimateActivity {
  id: string;
  scope: string;
  action: string;
  detail: string;
  succeeded: boolean;
  at: string;
}

/** Shared currency formatting so every surface agrees to the cent. */
export const usd = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
