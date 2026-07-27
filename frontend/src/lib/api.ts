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

  // ---- Billing ----
  getCatalog: () => request<Catalog>('/api/billing/catalog', { method: 'GET' }),

  getBillingOverview: () => request<BillingOverview>('/api/billing/overview', { method: 'GET' }),

  setPlan: (planCode: PlanCode, billingInterval: BillingInterval = 'monthly', seats = 1) =>
    request<SetPlanResult>('/api/billing/plan', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingInterval, seats }),
    }),

  updateBillingSettings: (patch: BillingSettingsPatch) =>
    request<{ settings: BillingSettings }>('/api/billing/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  getLedger: (limit = 50) =>
    request<{ entries: LedgerEntry[] }>(`/api/billing/ledger?limit=${limit}`, { method: 'GET' }),

  getPurchases: () => request<{ purchases: Purchase[] }>('/api/billing/purchases', { method: 'GET' }),

  startPurchase: (input: { packCode?: string; amountCents?: number }) =>
    request<{ purchase: Purchase; checkoutUrl: string | null; requiresConfirmation: boolean }>(
      '/api/billing/purchases',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** Hosted Stripe Checkout for a paid plan. */
  startSubscriptionCheckout: (
    planCode: PlanCode,
    billingInterval: BillingInterval = 'monthly',
    seats = 1,
  ) =>
    request<{ checkoutUrl: string | null }>('/api/billing/checkout/subscription', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingInterval, seats }),
    }),

  /** Stripe's hosted portal: cards, invoices and cancellation. */
  openBillingPortal: () =>
    request<{ portalUrl: string }>('/api/billing/portal', { method: 'POST' }),

  getPayments: (limit = 50) =>
    request<{ payments: Payment[] }>(`/api/billing/payments?limit=${limit}`, { method: 'GET' }),

  confirmPurchase: (purchaseId: string) =>
    request<{ purchaseId: string; status: string; creditedNanos: number; balance: CreditBalance }>(
      `/api/billing/purchases/${purchaseId}/confirm`,
      { method: 'POST' },
    ),

  // ---- Usage ----
  quoteUsage: (input: UsageTokens) =>
    request<UsageQuote>('/api/usage/quote', { method: 'POST', body: JSON.stringify(input) }),

  recordUsage: (input: UsageTokens & { requestId: string; feature?: string }) =>
    request<RecordUsageResult>('/api/usage/record', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---- Project Manager Agent ----
  pmOverview: () => request<PmOverview>('/api/pm/overview', { method: 'GET' }),

  pmProject: (id: string) => request<PmProjectDetail>(`/api/pm/projects/${id}`, { method: 'GET' }),

  pmCreateProject: (input: Record<string, unknown>) =>
    request<{ project: PmProject; seeded: PmSeedResult }>('/api/pm/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmUpdateProject: (id: string, patch: Record<string, unknown>) =>
    request<{ project: PmProject }>(`/api/pm/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmRun: (projectId?: string) =>
    request<{ result: PmEngineResult }>('/api/pm/run', {
      method: 'POST',
      body: JSON.stringify(projectId ? { projectId } : {}),
    }),

  pmAlertAction: (id: string, status: string, snoozeHours?: number) =>
    request<{ alert: PmAlert }>(`/api/pm/alerts/${id}`, {
      method: 'POST',
      body: JSON.stringify(snoozeHours ? { status, snoozeHours } : { status }),
    }),

  pmCreateTask: (projectId: string, input: Record<string, unknown>) =>
    request<{ task: PmTask }>(`/api/pm/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmUpdateTask: (id: string, patch: Record<string, unknown>) =>
    request<{ task: PmTask }>(`/api/pm/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmCreateArea: (projectId: string, input: Record<string, unknown>) =>
    request<{ area: PmDryingArea }>(`/api/pm/projects/${projectId}/areas`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmCreateReadings: (projectId: string, readings: Record<string, unknown>[]) =>
    request<{ readings: PmReading[] }>(`/api/pm/projects/${projectId}/readings`, {
      method: 'POST',
      body: JSON.stringify({ readings }),
    }),

  pmUpdateDocument: (id: string, patch: Record<string, unknown>) =>
    request<{ document: PmDocument }>(`/api/pm/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  pmEquipment: () =>
    request<{ equipment: PmEquipment[]; placements: PmPlacement[] }>('/api/pm/equipment', {
      method: 'GET',
    }),

  pmPlaceEquipment: (projectId: string, input: Record<string, unknown>) =>
    request<{ placement: PmPlacement }>(`/api/pm/projects/${projectId}/equipment`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmRemovePlacement: (id: string) =>
    request<{ placement: PmPlacement }>(`/api/pm/placements/${id}/remove`, { method: 'POST' }),

  pmAssignCrew: (projectId: string, input: Record<string, unknown>) =>
    request<{ assignment: PmAssignment }>(`/api/pm/projects/${projectId}/crew`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  pmBrief: (refresh = false) =>
    request<{ brief: PmBrief; writingEnabled: boolean }>(
      `/api/pm/brief${refresh ? '?refresh=true' : ''}`,
      { method: 'GET' },
    ),

  pmDraftUpdate: (projectId: string, audience: string, instruction?: string) =>
    request<{ update: PmUpdate }>(`/api/pm/projects/${projectId}/updates`, {
      method: 'POST',
      body: JSON.stringify(instruction ? { audience, instruction } : { audience }),
    }),

  pmUpdateDraft: (id: string, status: string) =>
    request<{ update: PmUpdate }>(`/api/pm/updates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  pmSettings: () => request<PmSettingsResponse>('/api/pm/settings', { method: 'GET' }),

  pmUpdateSettings: (patch: Record<string, unknown>) =>
    request<{ settings: PmSettings }>('/api/pm/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

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
  // ---- Mitigation estimator ----
  buildEstimate: (input: BuildEstimateInput) =>
    request<{ estimate: MitigationEstimate; priceListConnected: boolean }>(
      '/api/mitigation/build',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  saveEstimate: (input: BuildEstimateInput) =>
    request<{ estimateId: string; jobId: string; estimate: MitigationEstimate }>(
      '/api/mitigation/estimates',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  getEstimatorJobs: () =>
    request<{ jobs: EstimatorJob[] }>('/api/mitigation/jobs', { method: 'GET' }),

  getDemoSources: () =>
    request<{ sources: BuildEstimateInput }>('/api/mitigation/demo-sources', { method: 'GET' }),

  getCarriers: () =>
    request<{ carriers: Array<{ id: string; name: string }>; programs: Array<{ id: string; name: string }> }>(
      '/api/mitigation/carriers',
      { method: 'GET' },
    ),

  getAgreements: () =>
    request<{ agreements: ProgramAgreementSummary[]; source: string }>('/api/mitigation/agreements', {
      method: 'GET',
    }),

  getDeviations: (jobId: string) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'GET' },
    ),

  acceptDeviation: (jobId: string, deviation: Omit<SlaDeviation, 'proposed'>) =>
    request<{ deviations: SlaDeviation[] }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations`,
      { method: 'POST', body: JSON.stringify(deviation) },
    ),

  removeDeviation: (jobId: string, ruleId: string) =>
    request<{ ok: boolean }>(
      `/api/mitigation/jobs/${encodeURIComponent(jobId)}/deviations/${encodeURIComponent(ruleId)}`,
      { method: 'DELETE' },
    ),

  getStandards: () =>
    request<{
      editions: { s500: string; s520: string };
      note: string;
      references: Array<StandardReference & { formatted: string }>;
    }>('/api/mitigation/standards', { method: 'GET' }),

  getEstimatorSettings: () =>
    request<{ settings: EstimatorSettings }>('/api/mitigation/settings', { method: 'GET' }),

  saveEstimatorSettings: (settings: EstimatorSettings) =>
    request<{ settings: EstimatorSettings }>('/api/mitigation/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  /** Export URL for an estimate. The browser downloads it directly (cookies ride along). */
  estimateExportUrl: (estimateId: string, format: 'csv' | 'xml' | 'scope') =>
    `${API_BASE}/api/mitigation/estimates/${estimateId}/export?format=${format}`,

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

  getUsageEvents: (limit = 50) =>
    request<{ events: UsageEvent[] }>(`/api/usage/events?limit=${limit}`, { method: 'GET' }),

  getUsageDaily: (days = 30) =>
    request<{ days: UsageDay[] }>(`/api/usage/daily?days=${days}`, { method: 'GET' }),

  // ---- Model calls (metered server-side) ----

  /** Exact pre-flight token count from the provider's tokenizer. */
  countTokens: (input: { model?: string; messages: ChatMessage[]; system?: string }) =>
    request<{ model: string; inputTokens: number; inputPriceNanos: number }>(
      '/api/model/count-tokens',
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /**
   * Run a model call. Usage is metered from the provider's response, never from
   * anything this client reports, so the returned charge is authoritative.
   */
  sendMessages: (input: {
    model?: string;
    messages: ChatMessage[];
    system?: string;
    maxTokens?: number;
    thinking?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    feature?: string;
    requestId?: string;
  }) => request<CompletionResult>('/api/model/messages', { method: 'POST', body: JSON.stringify(input) }),
  getRuns: () => request<{ runs: ComputerRun[] }>('/api/computer/runs', { method: 'GET' }),

  stopRun: (runId: string) =>
    request<{ run: ComputerRun }>(`/api/computer/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    }),

  /** SSE URL for a run's transcript. `after` replays what the browser missed. */
  runEventsUrl: (runId: string, after = 0) =>
    `${API_BASE}/api/computer/runs/${encodeURIComponent(runId)}/events?after=${after}`,
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export interface MeasuredUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface CompletionResult {
  id: string;
  model: string;
  stopReason: string | null;
  content: unknown[];
  usage: MeasuredUsage;
  billing: {
    /** Worst-case amount reserved before the call ran. */
    authorizedNanos: number;
    /** What was actually charged, from the provider's usage totals. */
    chargedNanos: number;
    duplicate: boolean;
    balance: CreditBalance;
  };
}

/* ------------------------------------------------------------ billing types */

export type PlanCode = 'free' | 'pro' | 'max_5x' | 'max_20x' | 'team' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';

export interface Plan {
  code: PlanCode;
  name: string;
  tagline: string | null;
  monthlyPriceCents: number;
  annualPriceCents: number | null;
  includedCreditsNanos: number;
  perSeat: boolean;
  minSeats: number;
  rateMultiplier: number;
  features: string[];
  isContactSales: boolean;
}

export interface CreditPack {
  code: string;
  name: string;
  priceCents: number;
  creditsNanos: number;
  bonusNanos: number;
}

/**
 * Sell prices only. The cost basis and markup live in a private schema the
 * browser can never read.
 */
export interface ModelRate {
  modelId: string;
  displayName: string;
  family: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  batchDiscountPct: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface Catalog {
  plans: Plan[];
  packs: CreditPack[];
  rateCard: ModelRate[];
  /** `stripe` whenever a Stripe key is configured server-side. */
  paymentProvider: 'stripe' | 'dev' | 'manual';
}

export interface CreditBalance {
  totalNanos: number;
  planNanos: number;
  purchasedNanos: number;
  promoNanos: number;
  nextExpiry: string | null;
}

export interface BillingSettings {
  autoReloadEnabled: boolean;
  autoReloadThresholdNanos: number;
  autoReloadAmountNanos: number;
  /** `null` means no cap. */
  monthlySpendLimitNanos: number | null;
}

export type BillingSettingsPatch = Partial<BillingSettings>;

export interface BillingOverview {
  subscription: {
    planCode: PlanCode;
    planName: string;
    billingInterval: BillingInterval;
    seats: number;
    status: string;
    periodStart: string;
    periodEnd: string;
    cancelAtPeriodEnd: boolean;
    monthlyPriceCents: number;
    includedCreditsNanos: number;
    rateMultiplier: number;
  };
  settings: BillingSettings;
  balance: CreditBalance;
  periodUsage: {
    events: number;
    priceNanos: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  };
  usageByModel: {
    modelId: string;
    displayName: string;
    events: number;
    inputTokens: number;
    outputTokens: number;
    priceNanos: number;
  }[];
  /** False for roles that may view billing but not change it. */
  canManage: boolean;
}

export interface SetPlanResult {
  plan: string;
  changed: boolean;
  effectiveAt: string | null;
  cancelAtPeriodEnd: boolean;
  grantedNanos: number;
  balance: CreditBalance;
}

export interface LedgerEntry {
  id: string;
  entryType: 'plan_grant' | 'purchase' | 'usage' | 'refund' | 'expiration' | 'adjustment';
  bucket: 'plan' | 'purchased' | 'promotional' | null;
  /** Signed: positive adds credits, negative consumes them. */
  amountNanos: number;
  description: string | null;
  createdAt: string;
}

export interface Purchase {
  id: string;
  packCode: string | null;
  creditsNanos: number;
  bonusNanos: number;
  amountCents: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  provider: string;
  isAutoReload?: boolean;
  createdAt?: string;
  completedAt?: string | null;
}

/**
 * One row of the in-product payment history. `receiptUrl` and `invoicePdfUrl`
 * come from Stripe, so a customer can always retrieve proof of payment.
 */
export interface Payment {
  id: string;
  kind: 'subscription' | 'credits' | 'refund';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amountCents: number;
  currency: string;
  description: string | null;
  receiptUrl: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  receiptEmail: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  failureReason: string | null;
  createdAt: string;
}

export const PAYMENT_KIND_LABELS: Record<Payment['kind'], string> = {
  subscription: 'Subscription',
  credits: 'Usage credits',
  refund: 'Refund',
};

/* -------------------------------------------------------------- usage types */

export interface UsageTokens {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
  isBatch?: boolean;
}

export interface UsageBreakdown {
  input: { tokens: number; priceNanos: number };
  output: { tokens: number; priceNanos: number };
  cacheWrite5m: { tokens: number; priceNanos: number };
  cacheWrite1h: { tokens: number; priceNanos: number };
  cacheRead: { tokens: number; priceNanos: number };
}

export interface UsageQuote {
  modelId: string;
  isBatch: boolean;
  priceNanos: number;
  breakdown: UsageBreakdown;
}

export interface RecordUsageResult {
  eventId: string;
  priceNanos: number;
  /** True when this request id had already been billed. */
  duplicate: boolean;
  breakdown: UsageBreakdown;
  balance: CreditBalance;
}

export interface UsageEvent {
  id: string;
  modelId: string;
  feature: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  isBatch: boolean;
  priceNanos: number;
  createdAt: string;
}

export interface UsageDay {
  day: string;
  modelId: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  priceNanos: number;
}

export const PLAN_ORDER: PlanCode[] = ['free', 'pro', 'max_5x', 'max_20x', 'team', 'enterprise'];

export const LEDGER_LABELS: Record<LedgerEntry['entryType'], string> = {
  plan_grant: 'Plan credits',
  purchase: 'Credit purchase',
  usage: 'Usage',
  refund: 'Refund',
  expiration: 'Expired',
  adjustment: 'Adjustment',
};


/* ------------------------------------------------------------------ *
 * Project Manager Agent types
 * ------------------------------------------------------------------ */

export type PmPhase =
  | 'intake'
  | 'inspection'
  | 'approval'
  | 'scheduled'
  | 'mitigation'
  | 'drying'
  | 'drying_complete'
  | 'permitting'
  | 'production'
  | 'punch_list'
  | 'final_review'
  | 'invoicing'
  | 'paid';

export interface PmProject {
  id: string;
  orgId: string;
  projectNumber: string;
  name: string;
  description: string | null;
  workType: WorkType;
  lossType: string | null;
  status: 'active' | 'on_hold' | 'closed' | 'cancelled';
  phase: PmPhase;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  pmUserId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  carrier: string | null;
  claimNumber: string | null;
  adjusterName: string | null;
  scheduledStartAt: string | null;
  targetCompletionAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PmHealth {
  score: number;
  band: 'good' | 'watch' | 'at_risk' | 'critical';
  reasons: { weight: number; text: string }[];
}

export interface PmTask {
  id: string;
  projectId: string;
  title: string;
  details: string | null;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  assignedTo: string | null;
  dueAt: string | null;
  source: 'manual' | 'playbook' | 'agent';
  originKey: string | null;
  blockedReason: string | null;
  completedAt: string | null;
}

export interface PmAlert {
  id: string;
  projectId: string | null;
  ruleKey: string;
  severity: 'info' | 'warn' | 'critical';
  category: string;
  title: string;
  detail: string | null;
  suggestedAction: string | null;
  status: 'open' | 'acknowledged' | 'snoozed' | 'resolved' | 'dismissed';
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  facts: Record<string, unknown>;
  project?: { id: string; projectNumber: string; name: string } | null;
}

export interface PmDryingArea {
  id: string;
  projectId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  waterClass: number | null;
  affectedSqft: number | null;
  affectedCuft: number | null;
  driedAt: string | null;
  signedOffAt: string | null;
}

export interface PmReading {
  id: string;
  areaId: string | null;
  kind: string;
  moisturePct: number | null;
  temperatureF: number | null;
  humidityPct: number | null;
  gpp: number | null;
  note: string | null;
  takenAt: string;
}

export interface PmDocument {
  id: string;
  projectId: string;
  requirementKey: string;
  label: string;
  kind: string;
  status: 'missing' | 'provided' | 'waived' | 'rejected';
  isBlocking: boolean;
  requiredByPhase: string | null;
  note: string | null;
  externalRef: string | null;
}

export interface PmMilestone {
  id: string;
  label: string;
  kind: string;
  dueAt: string;
  completedAt: string | null;
  note: string | null;
}

export interface PmEquipment {
  id: string;
  assetTag: string;
  kind: string;
  makeModel: string | null;
  capacityPintsDay: number | null;
  capacityCfm: number | null;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  dailyRateCents: number | null;
}

export interface PmPlacement {
  id: string;
  projectId: string;
  equipmentId: string;
  areaLabel: string | null;
  placedAt: string;
  removedAt: string | null;
  equipment?: {
    assetTag: string;
    kind: string;
    capacityPintsDay: number | null;
    capacityCfm: number | null;
  } | null;
}

export interface PmAssignment {
  id: string;
  projectId: string;
  userId: string;
  roleOnProject: string;
  allocationPct: number;
  releasedAt: string | null;
}

export interface PmUpdate {
  id: string;
  projectId: string;
  audience: 'customer' | 'adjuster' | 'team';
  channel: string;
  status: 'draft' | 'approved' | 'sent' | 'discarded';
  subject: string | null;
  body: string;
  origin: 'agent' | 'manual';
  modelId: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface PmBrief {
  id: string;
  forDate: string;
  kind: string;
  headline: string | null;
  body: string;
  modelId: string | null;
  facts: Record<string, unknown>;
  createdAt: string;
}

export interface PmSettings {
  orgId: string;
  enabled: boolean;
  timezone: string;
  digestHour: number;
  readingIntervalHours: number;
  dryingStallDays: number;
  dryingProgressMinPct: number;
  equipmentIdleHours: number;
  staleProjectDays: number;
  milestoneLeadDays: number;
  maxProjectsPerCrew: number;
  disabledRules: string[];
  autoCreateTasks: boolean;
}

export interface PmRule {
  key: string;
  label: string;
  description: string;
  category: string;
  scope: string;
}

export interface PmSettingsResponse {
  settings: PmSettings;
  rules: PmRule[];
  canManage: boolean;
  writingEnabled: boolean;
}

export interface PmCrewLoad {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string;
  projectCount: number;
  allocationPct: number;
  openTaskCount: number;
  overdueTaskCount: number;
  projectNumbers: string[];
}

export interface PmProjectSummary {
  project: PmProject;
  health: PmHealth;
  openTasks: number;
  overdueTasks: number;
  crewCount: number;
  daysSinceActivity: number;
  drying: {
    openAreas: number;
    areasAtGoal: number;
    areasOverdue: number;
    areasStalled: number;
    daysDrying: number;
    allAreasAtGoal: boolean;
  } | null;
  documentation: { completionPct: number; invoiceReady: boolean; blocking: number };
}

export interface PmOverview {
  settings: PmSettings;
  role: MemberRole;
  canManage: boolean;
  writingEnabled: boolean;
  counts: { projects: number; critical: number; warn: number; mine: number };
  alerts: PmAlert[];
  projects: PmProjectSummary[];
  crew: PmCrewLoad[];
  members: { userId: string; email: string | null; fullName: string | null; role: string }[];
}

export interface PmAreaAnalysis {
  areaId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  state: 'drying' | 'stalled' | 'wetter' | 'goal_met' | 'signed_off' | 'no_readings';
  latestMoisturePct: number | null;
  latestReadingAt: string | null;
  hoursSinceReading: number | null;
  readingOverdue: boolean;
  remainingPct: number | null;
  projectedDaysToGoal: number | null;
  daysDrying: number;
  trend: {
    daily: { takenAt: string; moisturePct: number }[];
    totalDropPct: number | null;
    lastDropPct: number | null;
    flatDays: number;
  };
}

export interface PmProjectDetail {
  project: PmProject;
  tasks: PmTask[];
  assignments: PmAssignment[];
  areas: PmDryingArea[];
  readings: PmReading[];
  placements: PmPlacement[];
  documents: PmDocument[];
  milestones: PmMilestone[];
  alerts: PmAlert[];
  updates: PmUpdate[];
  analysis: {
    drying: {
      isDrying: boolean;
      areas: PmAreaAnalysis[];
      openAreas: number;
      areasAtGoal: number;
      areasOverdue: number;
      areasStalled: number;
      daysDrying: number;
      allAreasAtGoal: boolean;
      equipmentStillOnDriedProject: boolean;
      ambient: { temperatureF: number; humidityPct: number; gpp: number; dewPointF: number } | null;
      outside: { temperatureF: number; humidityPct: number; gpp: number } | null;
      equipment: {
        airMoversOnSite: number;
        airMoversRequired: number;
        dehuPintsOnSite: number;
        dehuPintsRequired: number;
        sufficient: boolean | null;
        shortfallNote: string | null;
      };
    };
    schedule: {
      overdueTasks: PmTask[];
      dueTodayTasks: PmTask[];
      blockedTasks: PmTask[];
      hasNoNextStep: boolean;
      daysSinceActivity: number;
      overrunDays: number | null;
      daysUntilTarget: number | null;
    };
    compliance: {
      missingBlocking: PmDocument[];
      overdueBlocking: PmDocument[];
      completionPct: number;
      invoiceReady: boolean;
      blockingInvoiceNow: boolean;
      milestones: {
        milestone: PmMilestone;
        state: 'done' | 'overdue' | 'due_soon' | 'upcoming';
        daysOverdue: number;
      }[];
    };
    health: PmHealth;
  };
  phases: PmPhase[];
  playbook: { phase: string; label: string; intent: string } | null;
  canManage: boolean;
}

export interface PmSeedResult {
  documents: number;
  milestones: number;
  tasks: number;
}

export interface PmEngineResult {
  ranAt: string;
  durationMs: number;
  projectsEvaluated: number;
  rulesEvaluated: number;
  findings: number;
  alertsOpened: number;
  alertsUpdated: number;
  alertsCleared: number;
  tasksCreated: number;
  rulesSkipped: string[];
  warnings: string[];
}

/** Human-readable phase labels, shared by the PM screens. */
export const PM_PHASE_LABELS: Record<PmPhase, string> = {
  intake: 'Intake',
  inspection: 'Inspection',
  approval: 'Approval',
  scheduled: 'Scheduled',
  mitigation: 'Mitigation',
  drying: 'Drying',
  drying_complete: 'Dry-out complete',
  permitting: 'Permitting',
  production: 'Production',
  punch_list: 'Punch list',
  final_review: 'Final review',
  invoicing: 'Invoicing',
  paid: 'Paid',
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
