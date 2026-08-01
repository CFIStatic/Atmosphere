/**
 * Domain types for the Financial Agent.
 *
 * Mirror the `finance_*` tables in
 * `supabase/migrations/20260728160000_financial_agent.sql`, in camelCase —
 * the serialisation boundary is the store.
 */

export const FINANCE_CONNECTION_KINDS = ['bank', 'accounting'] as const;
export type FinanceConnectionKind = (typeof FINANCE_CONNECTION_KINDS)[number];

export const FINANCE_PROVIDERS = [
  'quickbooks',
  'xero',
  'wave',
  'freshbooks',
  'sage',
  'generic_accounting',
  'plaid',
  'bank_portal',
  'manual',
] as const;
export type FinanceProvider = (typeof FINANCE_PROVIDERS)[number];

export const FINANCE_ACCESS_PATHS = ['api', 'web_access', 'computer_use', 'csv', 'manual'] as const;
export type FinanceAccessPath = (typeof FINANCE_ACCESS_PATHS)[number];

export const FINANCE_ACCESS_MODES = ['read_only', 'draft_writes'] as const;
export type FinanceAccessMode = (typeof FINANCE_ACCESS_MODES)[number];

export const FINANCE_CONNECTION_STATUSES = ['pending', 'connected', 'error', 'disabled'] as const;
export type FinanceConnectionStatus = (typeof FINANCE_CONNECTION_STATUSES)[number];

export const FINANCE_ACCOUNT_TYPES = [
  'checking',
  'savings',
  'credit_card',
  'other_bank',
  'accounts_receivable',
  'accounts_payable',
  'income',
  'expense',
  'equity',
  'other',
] as const;
export type FinanceAccountType = (typeof FINANCE_ACCOUNT_TYPES)[number];

export const COST_CATEGORIES = ['labor', 'materials', 'equipment', 'subcontract', 'other'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_ORIGINS = ['manual', 'work_log', 'equipment', 'import', 'agent'] as const;
export type CostOrigin = (typeof COST_ORIGINS)[number];

export const COST_STATUSES = ['draft', 'posted', 'voided'] as const;
export type CostStatus = (typeof COST_STATUSES)[number];

export const ALERT_SEVERITIES = ['info', 'warn', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_CATEGORIES = ['cash', 'ar', 'job_cost', 'connection', 'books', 'general'] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'snoozed', 'resolved', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export interface AutomationSettings {
  orgId: string;
  enabled: boolean;
  timezone: string;
  digestHour: number;
  arWarnDays: number;
  arCriticalDays: number;
  marginFloorPct: number;
  overBudgetPct: number;
  unbilledCostWarnCents: number;
  cashFloorCents: number;
  connectionStaleHours: number;
  booksBalanceToleranceCents: number;
  defaultLaborRateCents: number;
  disabledRules: string[];
  updatedAt: string;
}

export interface FinanceConnection {
  id: string;
  orgId: string;
  label: string;
  kind: FinanceConnectionKind;
  provider: FinanceProvider;
  accessPath: FinanceAccessPath;
  accessMode: FinanceAccessMode;
  config: Record<string, unknown>;
  credentialRef: string | null;
  credentialConfigured: boolean;
  webConnectionId: string | null;
  computerMachineId: string | null;
  enabled: boolean;
  status: FinanceConnectionStatus;
  statusDetail: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceAccount {
  id: string;
  orgId: string;
  connectionId: string | null;
  name: string;
  accountType: FinanceAccountType;
  currency: string;
  balanceCents: number | null;
  balanceAsOf: string | null;
  externalId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CostCode {
  id: string;
  orgId: string;
  code: string;
  label: string;
  category: CostCategory;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobCost {
  id: string;
  orgId: string;
  jobId: string | null;
  pmProjectId: string | null;
  costCodeId: string | null;
  category: CostCategory;
  description: string | null;
  quantity: number;
  unit: string;
  unitCostCents: number;
  amountCents: number;
  incurredOn: string;
  origin: CostOrigin;
  sourceTable: string | null;
  sourceId: string | null;
  agentRunId: string | null;
  status: CostStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceAlert {
  id: string;
  orgId: string;
  ruleKey: string;
  fingerprint: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string | null;
  suggestedAction: string | null;
  jobId: string | null;
  pmProjectId: string | null;
  connectionId: string | null;
  entityType: string | null;
  entityId: string | null;
  facts: Record<string, unknown>;
  status: AlertStatus;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  job?: { id: string; jobNumber: number | null; title: string } | null;
  connection?: { id: string; label: string; provider: string } | null;
}

export interface FinanceBrief {
  id: string;
  orgId: string;
  forDate: string;
  kind: 'morning' | 'weekly' | 'ad_hoc';
  headline: string | null;
  body: string;
  modelId: string | null;
  agentRunId: string | null;
  facts: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

/** A CRM job reduced to the money fields the engine needs. */
export interface JobMoney {
  id: string;
  orgId: string;
  jobNumber: number | null;
  title: string;
  status: string;
  workType: string;
  contractCents: number | null;
  invoicedCents: number;
  paidCents: number;
  /** Open AR = invoiced − paid, floored at 0. */
  openArCents: number;
  /** Proxy for aging: loss date, else scheduled start, else created. */
  agingAnchor: string | null;
  createdAt: string;
}

export interface JobCostRollup {
  jobId: string;
  title: string;
  jobNumber: number | null;
  contractCents: number | null;
  invoicedCents: number;
  paidCents: number;
  openArCents: number;
  costCents: number;
  laborCents: number;
  materialsCents: number;
  equipmentCents: number;
  subcontractCents: number;
  otherCents: number;
  /** contract − cost, null when no contract. */
  marginCents: number | null;
  marginPct: number | null;
  agingDays: number | null;
}

export interface Finding {
  ruleKey: string;
  fingerprint: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  suggestedAction: string;
  jobId?: string | null;
  pmProjectId?: string | null;
  connectionId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  facts?: Record<string, unknown>;
}

export interface Rule {
  key: string;
  label: string;
  description: string;
  category: AlertCategory;
  evaluate: (snapshot: FinanceSnapshot) => Finding[];
}

export interface FinanceSnapshot {
  orgId: string;
  now: Date;
  settings: AutomationSettings;
  connections: FinanceConnection[];
  accounts: FinanceAccount[];
  jobs: JobMoney[];
  rollups: JobCostRollup[];
  costCodes: CostCode[];
}

export interface EngineResult {
  orgId: string;
  ranAt: string;
  durationMs: number;
  jobsEvaluated: number;
  rulesEvaluated: number;
  findings: number;
  alertsOpened: number;
  alertsUpdated: number;
  alertsCleared: number;
  rulesSkipped: string[];
  warnings: string[];
  runId: string | null;
  cashCents: number;
  openArCents: number;
  totalCostCents: number;
}

export const DEFAULT_COST_CODES: { code: string; label: string; category: CostCategory }[] = [
  { code: 'LAB', label: 'Labor', category: 'labor' },
  { code: 'MAT', label: 'Materials', category: 'materials' },
  { code: 'EQP', label: 'Equipment', category: 'equipment' },
  { code: 'SUB', label: 'Subcontract', category: 'subcontract' },
  { code: 'OTH', label: 'Other', category: 'other' },
];

export const PROVIDER_LABELS: Record<FinanceProvider, string> = {
  quickbooks: 'QuickBooks / Intuit',
  xero: 'Xero',
  wave: 'Wave',
  freshbooks: 'FreshBooks',
  sage: 'Sage',
  generic_accounting: 'Other accounting software',
  plaid: 'Bank (Plaid)',
  bank_portal: 'Bank portal',
  manual: 'Manual / CSV',
};
