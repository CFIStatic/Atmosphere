import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { toOrgProductRole } from '../lib/productRoles.js';
import {
  DEFAULT_COST_CODES,
  type AutomationSettings,
  type CostCode,
  type FinanceAccount,
  type FinanceAlert,
  type FinanceBrief,
  type FinanceConnection,
  type Finding,
  type JobCost,
  type JobMoney,
} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ABSENT_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

function isAbsent(error: { code?: string } | null): boolean {
  return Boolean(error?.code && ABSENT_CODES.has(error.code));
}

function fail(error: { message?: string; code?: string } | null, what: string): never {
  if (error && isAbsent(error)) {
    throw new HttpError(
      503,
      'The Financial Agent tables are not set up on this Supabase project yet. Apply supabase/migrations/20260728160000_financial_agent.sql, then try again.',
      'finance_not_configured',
    );
  }
  throw new HttpError(500, error?.message ?? `Could not ${what}.`, 'finance_store_failed');
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** CRM money is numeric dollars; Financial Agent works in integer cents. */
export function dollarsToCents(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.round(n * 100);
}

function credentialConfigured(ref: string | null): boolean {
  if (!ref) return false;
  return Boolean(process.env[`${config.integrations.credentialEnvPrefix}${ref}`] || process.env[ref]);
}

/* ------------------------------------------------------------------ *
 * Serialisers
 * ------------------------------------------------------------------ */

function serializeSettings(r: any): AutomationSettings {
  return {
    orgId: r.org_id,
    enabled: r.enabled,
    timezone: r.timezone,
    digestHour: r.digest_hour,
    arWarnDays: r.ar_warn_days,
    arCriticalDays: r.ar_critical_days,
    marginFloorPct: Number(r.margin_floor_pct),
    overBudgetPct: Number(r.over_budget_pct),
    unbilledCostWarnCents: Number(r.unbilled_cost_warn_cents),
    cashFloorCents: Number(r.cash_floor_cents),
    connectionStaleHours: r.connection_stale_hours,
    booksBalanceToleranceCents: Number(r.books_balance_tolerance_cents),
    defaultLaborRateCents: Number(r.default_labor_rate_cents),
    disabledRules: r.disabled_rules ?? [],
    updatedAt: r.updated_at,
  };
}

function serializeConnection(r: any): FinanceConnection {
  return {
    id: r.id,
    orgId: r.org_id,
    label: r.label,
    kind: r.kind,
    provider: r.provider,
    accessPath: r.access_path,
    accessMode: r.access_mode,
    config: r.config ?? {},
    credentialRef: r.credential_ref ?? null,
    credentialConfigured: credentialConfigured(r.credential_ref ?? null),
    webConnectionId: r.web_connection_id ?? null,
    computerMachineId: r.computer_machine_id ?? null,
    enabled: r.enabled,
    status: r.status,
    statusDetail: r.status_detail ?? null,
    lastSyncAt: r.last_sync_at ?? null,
    lastError: r.last_error ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeAccount(r: any): FinanceAccount {
  return {
    id: r.id,
    orgId: r.org_id,
    connectionId: r.connection_id ?? null,
    name: r.name,
    accountType: r.account_type,
    currency: r.currency,
    balanceCents: num(r.balance_cents),
    balanceAsOf: r.balance_as_of ?? null,
    externalId: r.external_id ?? null,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeCostCode(r: any): CostCode {
  return {
    id: r.id,
    orgId: r.org_id,
    code: r.code,
    label: r.label,
    category: r.category,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeJobCost(r: any): JobCost {
  return {
    id: r.id,
    orgId: r.org_id,
    jobId: r.job_id ?? null,
    pmProjectId: r.pm_project_id ?? null,
    costCodeId: r.cost_code_id ?? null,
    category: r.category,
    description: r.description ?? null,
    quantity: Number(r.quantity),
    unit: r.unit,
    unitCostCents: Number(r.unit_cost_cents),
    amountCents: Number(r.amount_cents),
    incurredOn: r.incurred_on,
    origin: r.origin,
    sourceTable: r.source_table ?? null,
    sourceId: r.source_id ?? null,
    agentRunId: r.agent_run_id ?? null,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeAlert(r: any): FinanceAlert {
  return {
    id: r.id,
    orgId: r.org_id,
    ruleKey: r.rule_key,
    fingerprint: r.fingerprint,
    severity: r.severity,
    category: r.category,
    title: r.title,
    detail: r.detail ?? null,
    suggestedAction: r.suggested_action ?? null,
    jobId: r.job_id ?? null,
    pmProjectId: r.pm_project_id ?? null,
    connectionId: r.connection_id ?? null,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    facts: r.facts ?? {},
    status: r.status,
    occurrences: r.occurrences,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    snoozedUntil: r.snoozed_until ?? null,
    resolvedAt: r.resolved_at ?? null,
    resolvedBy: r.resolved_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function serializeBrief(r: any): FinanceBrief {
  return {
    id: r.id,
    orgId: r.org_id,
    forDate: r.for_date,
    kind: r.kind,
    headline: r.headline ?? null,
    body: r.body,
    modelId: r.model_id ?? null,
    agentRunId: r.agent_run_id ?? null,
    facts: r.facts ?? {},
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  };
}

function serializeJobMoney(r: any): JobMoney {
  const invoiced = dollarsToCents(r.invoiced_amount) ?? 0;
  const paid = dollarsToCents(r.paid_amount) ?? 0;
  const contract = dollarsToCents(r.contract_amount);
  return {
    id: r.id,
    orgId: r.org_id,
    jobNumber: num(r.job_number),
    title: r.title,
    status: r.status,
    workType: r.work_type,
    contractCents: contract,
    invoicedCents: invoiced,
    paidCents: paid,
    openArCents: Math.max(0, invoiced - paid),
    agingAnchor: r.loss_date ?? r.scheduled_start ?? r.created_at ?? null,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------------ *
 * Caller context
 * ------------------------------------------------------------------ */

export interface OrgContext {
  orgId: string;
  role: string;
  canManage: boolean;
}

function canManageFinance(role: string): boolean {
  const seat = toOrgProductRole(role);
  return seat === 'global_admin' || seat === 'employee';
}

/**
 * The caller's organization and whether they may change the books plan.
 *
 * `canManage` shapes the UI and returns a clean 403 — it is not the boundary.
 * RLS policies in the migration are.
 */
export async function resolveOrgContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<OrgContext> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role, orgs!inner(created_by)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) fail(error, 'resolve organization');

  const row = data?.[0] as any;
  if (!row) {
    throw new HttpError(
      409,
      'Finish onboarding — you need to be linked to an organization first.',
      'finance_no_org',
    );
  }
  const createdBy = row.orgs?.created_by ?? null;
  const canManage = canManageFinance(row.role) || createdBy === userId;
  return { orgId: row.org_id, role: row.role, canManage };
}

export function assertCanManage(org: OrgContext): void {
  if (!org.canManage) {
    throw new HttpError(
      403,
      'Your role cannot manage the Financial Agent. Ask a Global Admin or Employee, or the organization owner.',
      'finance_forbidden',
    );
  }
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = (orgId: string): AutomationSettings => ({
  orgId,
  enabled: true,
  timezone: 'America/New_York',
  digestHour: 7,
  arWarnDays: 30,
  arCriticalDays: 45,
  marginFloorPct: 15,
  overBudgetPct: 100,
  unbilledCostWarnCents: 500_000,
  cashFloorCents: 1_000_000,
  connectionStaleHours: 48,
  booksBalanceToleranceCents: 10_000,
  defaultLaborRateCents: 6_500,
  disabledRules: [],
  updatedAt: new Date(0).toISOString(),
});

export async function getSettings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<AutomationSettings> {
  const { data, error } = await supabase
    .from('finance_automation_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    if (isAbsent(error)) return DEFAULT_SETTINGS(orgId);
    fail(error, 'load finance settings');
  }
  if (!data) return DEFAULT_SETTINGS(orgId);
  return serializeSettings(data);
}

export async function upsertSettings(
  supabase: SupabaseClient,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<AutomationSettings> {
  const row: Record<string, unknown> = { org_id: orgId };
  const map: Record<string, string> = {
    enabled: 'enabled',
    timezone: 'timezone',
    digestHour: 'digest_hour',
    arWarnDays: 'ar_warn_days',
    arCriticalDays: 'ar_critical_days',
    marginFloorPct: 'margin_floor_pct',
    overBudgetPct: 'over_budget_pct',
    unbilledCostWarnCents: 'unbilled_cost_warn_cents',
    cashFloorCents: 'cash_floor_cents',
    connectionStaleHours: 'connection_stale_hours',
    booksBalanceToleranceCents: 'books_balance_tolerance_cents',
    defaultLaborRateCents: 'default_labor_rate_cents',
    disabledRules: 'disabled_rules',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }

  const { data, error } = await supabase
    .from('finance_automation_settings')
    .upsert(row, { onConflict: 'org_id' })
    .select('*')
    .single();
  if (error) fail(error, 'save finance settings');
  return serializeSettings(data);
}

/* ------------------------------------------------------------------ *
 * Connections / accounts / cost codes / job costs
 * ------------------------------------------------------------------ */

export async function listConnections(
  supabase: SupabaseClient,
  orgId: string,
): Promise<FinanceConnection[]> {
  const { data, error } = await supabase
    .from('finance_connections')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'list connections');
  return (data ?? []).map(serializeConnection);
}

export async function createConnection(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<FinanceConnection> {
  const { data, error } = await supabase
    .from('finance_connections')
    .insert({
      org_id: orgId,
      label: input.label,
      kind: input.kind,
      provider: input.provider,
      access_path: input.accessPath ?? 'api',
      access_mode: input.accessMode ?? 'read_only',
      config: input.config ?? {},
      credential_ref: input.credentialRef ?? null,
      web_connection_id: input.webConnectionId ?? null,
      computer_machine_id: input.computerMachineId ?? null,
      enabled: input.enabled ?? true,
      status: 'pending',
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) fail(error, 'create connection');
  return serializeConnection(data);
}

export async function updateConnection(
  supabase: SupabaseClient,
  id: string,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<FinanceConnection> {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    label: 'label',
    kind: 'kind',
    provider: 'provider',
    accessPath: 'access_path',
    accessMode: 'access_mode',
    config: 'config',
    credentialRef: 'credential_ref',
    webConnectionId: 'web_connection_id',
    computerMachineId: 'computer_machine_id',
    enabled: 'enabled',
    status: 'status',
    statusDetail: 'status_detail',
    lastSyncAt: 'last_sync_at',
    lastError: 'last_error',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }
  const { data, error } = await supabase
    .from('finance_connections')
    .update(row)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) fail(error, 'update connection');
  return serializeConnection(data);
}

export async function listAccounts(
  supabase: SupabaseClient,
  orgId: string,
): Promise<FinanceAccount[]> {
  const { data, error } = await supabase
    .from('finance_accounts')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) fail(error, 'list accounts');
  return (data ?? []).map(serializeAccount);
}

export async function createAccount(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<FinanceAccount> {
  const { data, error } = await supabase
    .from('finance_accounts')
    .insert({
      org_id: orgId,
      connection_id: input.connectionId ?? null,
      name: input.name,
      account_type: input.accountType,
      currency: input.currency ?? 'USD',
      balance_cents: input.balanceCents ?? null,
      balance_as_of: input.balanceCents != null ? new Date().toISOString() : null,
      external_id: input.externalId ?? null,
      is_active: input.isActive ?? true,
    })
    .select('*')
    .single();
  if (error) fail(error, 'create account');
  return serializeAccount(data);
}

export async function upsertAccountBalance(
  supabase: SupabaseClient,
  orgId: string,
  connectionId: string,
  externalId: string,
  name: string,
  accountType: string,
  balanceCents: number,
): Promise<void> {
  const { data: existing } = await supabase
    .from('finance_accounts')
    .select('id')
    .eq('org_id', orgId)
    .eq('connection_id', connectionId)
    .eq('external_id', externalId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('finance_accounts')
      .update({
        name,
        account_type: accountType,
        balance_cents: balanceCents,
        balance_as_of: new Date().toISOString(),
        is_active: true,
      })
      .eq('id', existing.id);
    return;
  }

  await supabase.from('finance_accounts').insert({
    org_id: orgId,
    connection_id: connectionId,
    name,
    account_type: accountType,
    balance_cents: balanceCents,
    balance_as_of: new Date().toISOString(),
    external_id: externalId,
    is_active: true,
  });
}

export async function listCostCodes(
  supabase: SupabaseClient,
  orgId: string,
): Promise<CostCode[]> {
  const { data, error } = await supabase
    .from('finance_cost_codes')
    .select('*')
    .eq('org_id', orgId)
    .order('code', { ascending: true });
  if (error) fail(error, 'list cost codes');
  return (data ?? []).map(serializeCostCode);
}

export async function ensureDefaultCostCodes(
  supabase: SupabaseClient,
  orgId: string,
): Promise<CostCode[]> {
  const existing = await listCostCodes(supabase, orgId);
  if (existing.length > 0) return existing;

  const rows = DEFAULT_COST_CODES.map((c) => ({
    org_id: orgId,
    code: c.code,
    label: c.label,
    category: c.category,
    is_active: true,
  }));
  const { data, error } = await supabase.from('finance_cost_codes').insert(rows).select('*');
  if (error) {
    // Race: another caller seeded first — re-read.
    if (error.code === '23505') return listCostCodes(supabase, orgId);
    fail(error, 'seed cost codes');
  }
  return (data ?? []).map(serializeCostCode);
}

export async function createCostCode(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
): Promise<CostCode> {
  const { data, error } = await supabase
    .from('finance_cost_codes')
    .insert({
      org_id: orgId,
      code: input.code,
      label: input.label,
      category: input.category ?? 'other',
      is_active: input.isActive ?? true,
    })
    .select('*')
    .single();
  if (error) fail(error, 'create cost code');
  return serializeCostCode(data);
}

export async function listJobCosts(
  supabase: SupabaseClient,
  orgId: string,
  opts: { jobId?: string; status?: string; limit?: number } = {},
): Promise<JobCost[]> {
  let q = supabase
    .from('finance_job_costs')
    .select('*')
    .eq('org_id', orgId)
    .order('incurred_on', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.jobId) q = q.eq('job_id', opts.jobId);
  if (opts.status) q = q.eq('status', opts.status);
  else q = q.neq('status', 'voided');

  const { data, error } = await q;
  if (error) fail(error, 'list job costs');
  return (data ?? []).map(serializeJobCost);
}

export async function createJobCost(
  supabase: SupabaseClient,
  orgId: string,
  input: Record<string, unknown>,
  userId: string,
): Promise<JobCost> {
  const quantity = Number(input.quantity ?? 1);
  const unitCostCents = Number(input.unitCostCents);
  const amountCents =
    input.amountCents !== undefined
      ? Number(input.amountCents)
      : Math.round(quantity * unitCostCents);

  const { data, error } = await supabase
    .from('finance_job_costs')
    .insert({
      org_id: orgId,
      job_id: input.jobId ?? null,
      pm_project_id: input.pmProjectId ?? null,
      cost_code_id: input.costCodeId ?? null,
      category: input.category,
      description: input.description ?? null,
      quantity,
      unit: input.unit ?? 'EA',
      unit_cost_cents: unitCostCents,
      amount_cents: amountCents,
      incurred_on: input.incurredOn ?? new Date().toISOString().slice(0, 10),
      origin: input.origin ?? 'manual',
      status: input.status ?? 'posted',
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) fail(error, 'create job cost');
  return serializeJobCost(data);
}

export async function updateJobCost(
  supabase: SupabaseClient,
  id: string,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<JobCost> {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    costCodeId: 'cost_code_id',
    category: 'category',
    description: 'description',
    quantity: 'quantity',
    unit: 'unit',
    unitCostCents: 'unit_cost_cents',
    amountCents: 'amount_cents',
    incurredOn: 'incurred_on',
    status: 'status',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }

  if (row.quantity !== undefined || row.unit_cost_cents !== undefined) {
    const current = await supabase
      .from('finance_job_costs')
      .select('quantity, unit_cost_cents, amount_cents')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();
    if (current.error) fail(current.error, 'load job cost');
    const qty = Number(row.quantity ?? current.data.quantity);
    const unit = Number(row.unit_cost_cents ?? current.data.unit_cost_cents);
    if (row.amount_cents === undefined) row.amount_cents = Math.round(qty * unit);
  }

  const { data, error } = await supabase
    .from('finance_job_costs')
    .update(row)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) fail(error, 'update job cost');
  return serializeJobCost(data);
}

/* ------------------------------------------------------------------ *
 * Jobs (CRM) + work log labor estimate
 * ------------------------------------------------------------------ */

export async function listJobMoney(
  supabase: SupabaseClient,
  orgId: string,
): Promise<JobMoney[]> {
  const { data, error } = await supabase
    .from('crm_jobs')
    .select(
      'id, org_id, job_number, title, status, work_type, contract_amount, invoiced_amount, paid_amount, loss_date, scheduled_start, created_at',
    )
    .eq('org_id', orgId)
    .neq('status', 'cancelled')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    // CRM may not be installed on every project — degrade to empty.
    if (isAbsent(error)) return [];
    fail(error, 'list jobs');
  }
  return (data ?? []).map(serializeJobMoney);
}

/** Minutes logged per job from work_logs, for implied labor cost. */
export async function workLogMinutesByJob(
  supabase: SupabaseClient,
  orgId: string,
  jobIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobIds.length === 0) return out;

  const { data, error } = await supabase
    .from('work_logs')
    .select('job_id, minutes')
    .eq('org_id', orgId)
    .in('job_id', jobIds);

  if (error) {
    if (!isAbsent(error)) console.warn('[finance] work_logs unavailable:', error.message);
    return out;
  }
  for (const row of data ?? []) {
    if (!row.job_id) continue;
    out.set(row.job_id, (out.get(row.job_id) ?? 0) + Number(row.minutes ?? 0));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

export async function listAlerts(
  supabase: SupabaseClient,
  orgId: string,
  opts: { limit?: number; status?: string } = {},
): Promise<FinanceAlert[]> {
  let q = supabase
    .from('finance_alerts')
    .select('*')
    .eq('org_id', orgId)
    .order('last_seen_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status) q = q.eq('status', opts.status);

  const { data, error } = await q;
  if (error) fail(error, 'list alerts');
  return (data ?? []).map(serializeAlert);
}

export async function listAlertsForReconcile(
  supabase: SupabaseClient,
  orgId: string,
): Promise<FinanceAlert[]> {
  const { data, error } = await supabase
    .from('finance_alerts')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['open', 'acknowledged', 'snoozed']);
  if (error) fail(error, 'list alerts for reconcile');
  return (data ?? []).map(serializeAlert);
}

export async function upsertAlerts(
  supabase: SupabaseClient,
  orgId: string,
  findings: Finding[],
  now: Date,
): Promise<{ opened: number; updated: number }> {
  let opened = 0;
  let updated = 0;
  for (const f of findings) {
    const { data: existing } = await supabase
      .from('finance_alerts')
      .select('id, occurrences, status')
      .eq('org_id', orgId)
      .eq('fingerprint', f.fingerprint)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('finance_alerts')
        .update({
          severity: f.severity,
          category: f.category,
          title: f.title,
          detail: f.detail,
          suggested_action: f.suggestedAction,
          job_id: f.jobId ?? null,
          pm_project_id: f.pmProjectId ?? null,
          connection_id: f.connectionId ?? null,
          entity_type: f.entityType ?? null,
          entity_id: f.entityId ?? null,
          facts: f.facts ?? {},
          last_seen_at: now.toISOString(),
          occurrences: Number(existing.occurrences ?? 1) + 1,
          // Re-open if it had been resolved by a prior clear and the problem returned.
          status: existing.status === 'resolved' || existing.status === 'dismissed' ? 'open' : existing.status,
          resolved_at: null,
          resolved_by: null,
        })
        .eq('id', existing.id);
      if (!error) updated += 1;
    } else {
      const { error } = await supabase.from('finance_alerts').insert({
        org_id: orgId,
        rule_key: f.ruleKey,
        fingerprint: f.fingerprint,
        severity: f.severity,
        category: f.category,
        title: f.title,
        detail: f.detail,
        suggested_action: f.suggestedAction,
        job_id: f.jobId ?? null,
        pm_project_id: f.pmProjectId ?? null,
        connection_id: f.connectionId ?? null,
        entity_type: f.entityType ?? null,
        entity_id: f.entityId ?? null,
        facts: f.facts ?? {},
        status: 'open',
        first_seen_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      });
      if (!error) opened += 1;
    }
  }
  return { opened, updated };
}

export async function clearAlerts(
  supabase: SupabaseClient,
  orgId: string,
  fingerprintsStillOpen: Set<string>,
  now: Date,
  userId?: string | null,
): Promise<number> {
  const open = await listAlertsForReconcile(supabase, orgId);
  let cleared = 0;
  for (const alert of open) {
    if (fingerprintsStillOpen.has(alert.fingerprint)) continue;
    if (alert.status === 'snoozed' && alert.snoozedUntil && new Date(alert.snoozedUntil) > now) {
      continue;
    }
    const { error } = await supabase
      .from('finance_alerts')
      .update({
        status: 'resolved',
        resolved_at: now.toISOString(),
        resolved_by: userId ?? null,
      })
      .eq('id', alert.id);
    if (!error) cleared += 1;
  }
  return cleared;
}

export async function actOnAlert(
  supabase: SupabaseClient,
  id: string,
  orgId: string,
  status: string,
  userId: string,
  snoozeHours?: number,
): Promise<FinanceAlert> {
  const row: Record<string, unknown> = { status };
  if (status === 'snoozed') {
    const hours = snoozeHours ?? 24;
    row.snoozed_until = new Date(Date.now() + hours * 3600_000).toISOString();
  }
  if (status === 'resolved' || status === 'dismissed') {
    row.resolved_at = new Date().toISOString();
    row.resolved_by = userId;
  }
  const { data, error } = await supabase
    .from('finance_alerts')
    .update(row)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) fail(error, 'update alert');
  return serializeAlert(data);
}

/* ------------------------------------------------------------------ *
 * Briefs
 * ------------------------------------------------------------------ */

export async function getBrief(
  supabase: SupabaseClient,
  orgId: string,
  forDate: string,
  kind = 'morning',
): Promise<FinanceBrief | null> {
  const { data, error } = await supabase
    .from('finance_briefs')
    .select('*')
    .eq('org_id', orgId)
    .eq('for_date', forDate)
    .eq('kind', kind)
    .maybeSingle();
  if (error) {
    if (isAbsent(error)) return null;
    fail(error, 'load brief');
  }
  return data ? serializeBrief(data) : null;
}

export async function createBrief(
  supabase: SupabaseClient,
  orgId: string,
  input: {
    forDate: string;
    kind?: string;
    headline: string | null;
    body: string;
    modelId?: string | null;
    agentRunId?: string | null;
    facts: Record<string, unknown>;
    createdBy?: string | null;
  },
): Promise<FinanceBrief> {
  const { data, error } = await supabase
    .from('finance_briefs')
    .upsert(
      {
        org_id: orgId,
        for_date: input.forDate,
        kind: input.kind ?? 'morning',
        headline: input.headline,
        body: input.body,
        model_id: input.modelId ?? null,
        agent_run_id: input.agentRunId ?? null,
        facts: input.facts,
        created_by: input.createdBy ?? null,
      },
      { onConflict: 'org_id,for_date,kind' },
    )
    .select('*')
    .single();
  if (error) fail(error, 'save brief');
  return serializeBrief(data);
}
