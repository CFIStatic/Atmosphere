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

  getUsageEvents: (limit = 50) =>
    request<{ events: UsageEvent[] }>(`/api/usage/events?limit=${limit}`, { method: 'GET' }),

  getUsageDaily: (days = 30) =>
    request<{ days: UsageDay[] }>(`/api/usage/daily?days=${days}`, { method: 'GET' }),

  // ---- Model calls (metered server-side) ----

  /** Exact pre-flight token count from the provider's tokenizer. */
  countTokens: (input: { model?: string; messages: ChatMessage[]; system?: string }) =>
    request<{ model: string; inputTokens: number; inputPriceNanos: number }>(
      '/api/ai/count-tokens',
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
  }) => request<CompletionResult>('/api/ai/messages', { method: 'POST', body: JSON.stringify(input) }),
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
