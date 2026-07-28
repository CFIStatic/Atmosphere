import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import type { ConsentAuditEntry, ConsentGrant, ConsentScope, CredentialStorageMode } from './xactimate/consent.js';
import type { SealedCredential } from './xactimate/credentials.js';
import type { PriceList } from './catalog/priceList.js';
import type { ProgramAgreement, SlaDeviation } from './carrier/types.js';
import type { MitigationEstimate } from './types.js';
import type { DryingReport } from './planning/dryingProgress.js';

/**
 * Persistence for the estimator.
 *
 * Every read and write goes through the caller's own Supabase client, so Row
 * Level Security decides what is visible — the same contract the rest of this
 * backend holds to. The service-role key is never used here; an estimate is
 * claim data, and cross-org visibility has to be impossible at the database
 * layer rather than merely absent from the queries.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Postgres/PostgREST codes meaning "the table isn't there". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202']);

/**
 * Translate a Supabase error into something a user can act on.
 *
 * The missing-table case is called out specifically because it has exactly one
 * cause — the migration has not been applied — and a generic 500 would send
 * someone hunting through logs for it.
 */
function fail(error: { code?: string; message: string }, action: string): never {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) {
    throw new HttpError(
      503,
      'The estimator tables are not set up on this Supabase project yet. Apply supabase/migrations/0001_mitigation_estimator.sql, then try again.',
      'estimator_schema_missing',
    );
  }
  throw new HttpError(500, `${action}: ${error.message}`, 'estimator_store_failed');
}

/* ------------------------------------------------------------------ *
 * Jobs and estimates
 * ------------------------------------------------------------------ */

export interface JobRecord {
  id: string;
  orgId: string;
  name: string;
  claimNumber: string | null;
  status: string;
  createdAt: string;
}

export interface EstimateRecord {
  id: string;
  jobId: string;
  createdAt: string;
  subtotal: number;
  total: number;
  grossMargin: number;
  recoverableRevenue: number;
  estimate: MitigationEstimate;
}

export async function listJobs(supabase: SupabaseClient, orgId: string): Promise<JobRecord[]> {
  const { data, error } = await supabase
    .from('estimator_jobs')
    .select('id, org_id, name, claim_number, status, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) fail(error, 'Could not list estimating jobs');

  return (data ?? []).map((row: any) => ({
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    claimNumber: row.claim_number,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function saveEstimate(
  supabase: SupabaseClient,
  input: { orgId: string; userId: string; name: string; estimate: MitigationEstimate },
): Promise<EstimateRecord> {
  const { estimate } = input;

  const { data: job, error: jobError } = await supabase
    .from('estimator_jobs')
    .upsert(
      {
        org_id: input.orgId,
        created_by: input.userId,
        external_job_id: estimate.jobId,
        name: input.name,
        claim_number: estimate.assessment.claimNumber ?? null,
        status: 'draft',
      },
      { onConflict: 'org_id,external_job_id' },
    )
    .select('id')
    .single();
  if (jobError) fail(jobError, 'Could not save the job');

  const { data, error } = await supabase
    .from('estimator_estimates')
    .insert({
      job_id: job.id,
      org_id: input.orgId,
      created_by: input.userId,
      payload: estimate,
      subtotal: estimate.profitability.subtotal,
      total: estimate.profitability.total,
      gross_margin: estimate.profitability.grossMargin,
      recoverable_revenue: estimate.profitability.recoverableRevenue,
    })
    .select('id, job_id, created_at')
    .single();
  if (error) fail(error, 'Could not save the estimate');

  return {
    id: data.id,
    jobId: data.job_id,
    createdAt: data.created_at,
    subtotal: estimate.profitability.subtotal,
    total: estimate.profitability.total,
    grossMargin: estimate.profitability.grossMargin,
    recoverableRevenue: estimate.profitability.recoverableRevenue,
    estimate,
  };
}

export async function getEstimate(
  supabase: SupabaseClient,
  estimateId: string,
): Promise<EstimateRecord | null> {
  const { data, error } = await supabase
    .from('estimator_estimates')
    .select('id, job_id, created_at, subtotal, total, gross_margin, recoverable_revenue, payload')
    .eq('id', estimateId)
    .maybeSingle();
  if (error) fail(error, 'Could not load the estimate');
  if (!data) return null;

  return {
    id: data.id,
    jobId: data.job_id,
    createdAt: data.created_at,
    subtotal: Number(data.subtotal),
    total: Number(data.total),
    grossMargin: Number(data.gross_margin),
    recoverableRevenue: Number(data.recoverable_revenue),
    estimate: data.payload as MitigationEstimate,
  };
}

/* ------------------------------------------------------------------ *
 * Xactimate connection
 * ------------------------------------------------------------------ */

export interface ConnectionRecord {
  grant: ConsentGrant;
  sealedCredential: SealedCredential | null;
  priceListId: string | null;
}

export async function saveConnection(
  supabase: SupabaseClient,
  grant: ConsentGrant,
  sealedCredential: SealedCredential | null,
): Promise<void> {
  const { error } = await supabase.from('xactimate_connections').upsert(
    {
      user_id: grant.userId,
      org_id: grant.orgId,
      consent_id: grant.id,
      xactimate_username: grant.xactimateUsername,
      scopes: grant.scopes,
      storage_mode: grant.storageMode,
      granted_at: grant.grantedAt,
      expires_at: grant.expiresAt,
      revoked_at: null,
      granted_ip: grant.grantedFromIp,
      granted_user_agent: grant.grantedUserAgent,
      // Null unless the user explicitly chose at-rest storage. Session-only
      // connections leave this column empty forever, which is the point.
      sealed_credential: sealedCredential,
    },
    { onConflict: 'user_id' },
  );
  if (error) fail(error, 'Could not save the Xactimate connection');
}

export async function getConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConnectionRecord | null> {
  const { data, error } = await supabase
    .from('xactimate_connections')
    .select(
      'consent_id, org_id, xactimate_username, scopes, storage_mode, granted_at, expires_at, revoked_at, granted_ip, granted_user_agent, sealed_credential, price_list_id',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail(error, 'Could not load the Xactimate connection');
  if (!data) return null;

  return {
    grant: {
      id: data.consent_id,
      userId,
      orgId: data.org_id,
      scopes: (data.scopes ?? []) as ConsentScope[],
      grantedAt: data.granted_at,
      expiresAt: data.expires_at,
      revokedAt: data.revoked_at,
      grantedFromIp: data.granted_ip,
      grantedUserAgent: data.granted_user_agent,
      xactimateUsername: data.xactimate_username,
      storageMode: data.storage_mode as CredentialStorageMode,
    },
    sealedCredential: (data.sealed_credential as SealedCredential | null) ?? null,
    priceListId: data.price_list_id ?? null,
  };
}

/**
 * Revoke a connection.
 *
 * The stored credential is nulled in the same statement that sets `revoked_at`,
 * so there is no window in which a revoked grant still has a usable password
 * behind it. "Disconnect" that leaves the secret on disk is not a disconnect.
 */
export async function revokeConnection(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from('xactimate_connections')
    .update({ revoked_at: new Date().toISOString(), sealed_credential: null })
    .eq('user_id', userId);
  if (error) fail(error, 'Could not revoke the Xactimate connection');
}

export async function recordAudit(
  supabase: SupabaseClient,
  entries: ConsentAuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase.from('xactimate_audit').insert(
    entries.map((entry) => ({
      id: entry.id,
      consent_id: entry.consentId,
      user_id: entry.userId,
      scope: entry.scope,
      action: entry.action,
      detail: entry.detail,
      succeeded: entry.succeeded,
      at: entry.at,
    })),
  );
  // An audit write must never break the operation it is describing, but a
  // silent failure would leave a hole in the record — so it is logged loudly.
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[xactimate] failed to write audit entries:', error.message);
  }
}

export async function listAudit(
  supabase: SupabaseClient,
  userId: string,
  limit = 50,
): Promise<ConsentAuditEntry[]> {
  const { data, error } = await supabase
    .from('xactimate_audit')
    .select('id, consent_id, user_id, scope, action, detail, succeeded, at')
    .eq('user_id', userId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'Could not load the Xactimate activity log');

  return (data ?? []).map((row: any) => ({
    id: row.id,
    consentId: row.consent_id,
    userId: row.user_id,
    scope: row.scope,
    action: row.action,
    detail: row.detail,
    succeeded: row.succeeded,
    at: row.at,
  }));
}

/* ------------------------------------------------------------------ *
 * Price lists and settings
 * ------------------------------------------------------------------ */

export async function savePriceList(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  priceList: PriceList,
): Promise<void> {
  const { error } = await supabase.from('xactimate_price_lists').upsert(
    {
      org_id: orgId,
      price_list_id: priceList.id,
      name: priceList.name,
      effective_date: priceList.effectiveDate ?? null,
      entries: priceList.entries,
      synced_by: userId,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,price_list_id' },
  );
  if (error) fail(error, 'Could not save the price list');

  const { error: linkError } = await supabase
    .from('xactimate_connections')
    .update({ price_list_id: priceList.id })
    .eq('user_id', userId);
  if (linkError) fail(linkError, 'Could not select the price list');
}

export async function getPriceList(
  supabase: SupabaseClient,
  orgId: string,
  priceListId: string,
): Promise<PriceList | null> {
  const { data, error } = await supabase
    .from('xactimate_price_lists')
    .select('price_list_id, name, effective_date, entries')
    .eq('org_id', orgId)
    .eq('price_list_id', priceListId)
    .maybeSingle();
  if (error) fail(error, 'Could not load the price list');
  if (!data) return null;

  return {
    id: data.price_list_id,
    name: data.name,
    effectiveDate: data.effective_date ?? undefined,
    entries: (data.entries ?? []) as PriceList['entries'],
  };
}

export interface StoredSettings {
  targetMargin?: number;
  overheadAndProfitRate?: number;
  oAndPEligible?: boolean;
  taxRate?: number;
  costMultiplier?: number;
  lineMarginFloor?: number;
  hoursPerMonitoringVisit?: number;
  techniciansOnSite?: number;
  category3CutHeightIn?: number;
  /** Force plan cut height in inches (e.g. 24 for a standard 2-ft flood cut). */
  planCutHeightIn?: number;
  /** How equipment days are billed when deriving scope from the plan. */
  equipmentBillingMode?: 'as_logged' | 'recommended' | 'max';
  costOverrides?: Record<string, number>;
  /**
   * Human-approved knowledge-key → account Xactimate code bindings.
   * Locked after reviewing a fuzzy reconcile so the next build uses the
   * approved selector instead of re-guessing from descriptions.
   */
  catalogRemaps?: Record<string, string>;
  /**
   * Per-build / org defaults for code overrides (knowledge key or scope id → code).
   */
  codeOverrides?: Record<string, string>;
  /**
   * Drying reports keyed by external job id. Stored in settings JSON so visits
   * can be appended without a dedicated table / migration.
   */
  dryingReports?: Record<string, DryingReport[]>;
  /**
   * Last-known source snapshot per external job id — lets capture sync
   * auto-rebuild estimates when MICA Dash / Outlook land new visits.
   */
  jobSources?: Record<string, JobSourceSnapshot>;
  /**
   * Capture agent cursors + last pass summary (written by the background agent).
   */
  captureAgent?: {
    lastRunAt?: string;
    lastVisitAtByJob?: Record<string, string>;
    lastPassSummary?: {
      jobsConsidered: number;
      jobsUpdated: number;
      visitsImported: number;
      estimatesSaved: number;
      errorCount: number;
      ranAt: string;
    };
  };
}

/** Baseline sources persisted with a job so capture sync can rebuild alone. */
export interface JobSourceSnapshot {
  jobId: string;
  docusketch?: unknown;
  mica?: unknown;
  photos?: Array<{
    filename?: string;
    capturedAt?: string;
    caption?: string;
    roomName?: string;
    uri?: string;
  }>;
  notes?: string;
  claimNumber?: string;
  updatedAt: string;
}

export async function getSettings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<StoredSettings> {
  const { data, error } = await supabase
    .from('estimator_settings')
    .select('settings')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) fail(error, 'Could not load estimator settings');
  return (data?.settings as StoredSettings) ?? {};
}

export async function saveSettings(
  supabase: SupabaseClient,
  orgId: string,
  settings: StoredSettings,
): Promise<StoredSettings> {
  const merged = { ...(await getSettings(supabase, orgId)), ...settings };
  const { error } = await supabase
    .from('estimator_settings')
    .upsert({ org_id: orgId, settings: merged, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) fail(error, 'Could not save estimator settings');
  return merged;
}

/* ------------------------------------------------------------------ *
 * Drying reports (per job, in estimator_settings.settings.dryingReports)
 * ------------------------------------------------------------------ */

/**
 * Append a drying report for a job.
 *
 * Reports live under `settings.dryingReports[externalJobId]` so visits can be
 * recorded without a dedicated table. Callers pass the job's external id (the
 * same id used on estimates), not the internal UUID.
 */
export async function saveDryingReport(
  supabase: SupabaseClient,
  orgId: string,
  jobExternalId: string,
  report: DryingReport,
): Promise<DryingReport[]> {
  const settings = await getSettings(supabase, orgId);
  const byJob = { ...(settings.dryingReports ?? {}) };
  const existing = [...(byJob[jobExternalId] ?? [])];
  const idx = existing.findIndex((r) => r.id === report.id);
  if (idx >= 0) existing[idx] = report;
  else existing.push(report);
  existing.sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  byJob[jobExternalId] = existing;
  await saveSettings(supabase, orgId, { ...settings, dryingReports: byJob });
  return existing;
}

export async function listDryingReports(
  supabase: SupabaseClient,
  orgId: string,
  jobExternalId: string,
): Promise<DryingReport[]> {
  const settings = await getSettings(supabase, orgId);
  return [...(settings.dryingReports?.[jobExternalId] ?? [])].sort(
    (a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt),
  );
}

export async function saveJobSources(
  supabase: SupabaseClient,
  orgId: string,
  jobExternalId: string,
  snapshot: JobSourceSnapshot,
): Promise<JobSourceSnapshot> {
  const settings = await getSettings(supabase, orgId);
  const byJob = { ...(settings.jobSources ?? {}) };
  byJob[jobExternalId] = { ...snapshot, jobId: jobExternalId };
  await saveSettings(supabase, orgId, { ...settings, jobSources: byJob });
  return byJob[jobExternalId];
}

export async function getJobSources(
  supabase: SupabaseClient,
  orgId: string,
  jobExternalId: string,
): Promise<JobSourceSnapshot | null> {
  const settings = await getSettings(supabase, orgId);
  return settings.jobSources?.[jobExternalId] ?? null;
}

/* ------------------------------------------------------------------ *
 * Org resolution
 * ------------------------------------------------------------------ */

/** The caller's org. Everything the estimator stores is scoped to it. */
export async function resolveOrgId(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new HttpError(500, error.message, 'org_lookup_failed');

  const orgId = data?.[0]?.org_id;
  if (!orgId) {
    throw new HttpError(
      400,
      'Finish onboarding into an organization before using the estimator.',
      'not_onboarded',
    );
  }
  return orgId;
}

/* ------------------------------------------------------------------ *
 * Carrier program agreements
 * ------------------------------------------------------------------ */

/**
 * Agreements are org-scoped, not user-scoped.
 *
 * A franchise signs one agreement per carrier program and every estimator in the
 * office works to it. Letting each user keep a private copy would produce
 * estimates from the same office that disagree about what the carrier pays,
 * which is exactly the failure the terms exist to prevent.
 */
export async function saveAgreement(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  agreement: ProgramAgreement,
): Promise<void> {
  const { error } = await supabase.from('carrier_agreements').upsert(
    {
      org_id: orgId,
      carrier_id: agreement.carrierId,
      program_id: agreement.programId,
      carrier_name: agreement.carrierName,
      program_name: agreement.programName,
      version: agreement.version,
      effective_from: agreement.effectiveFrom ?? null,
      effective_to: agreement.effectiveTo ?? null,
      rules: agreement.rules,
      source: agreement.source,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,carrier_id,program_id' },
  );
  if (error) fail(error, 'Could not save the program agreement');
}

function toAgreement(row: any): ProgramAgreement {
  return {
    carrierId: row.carrier_id,
    carrierName: row.carrier_name,
    programId: row.program_id,
    programName: row.program_name,
    version: row.version,
    effectiveFrom: row.effective_from ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    rules: (row.rules ?? []) as ProgramAgreement['rules'],
    source: row.source as ProgramAgreement['source'],
  };
}

export async function getAgreement(
  supabase: SupabaseClient,
  orgId: string,
  carrierId: string,
  programId?: string | null,
): Promise<ProgramAgreement | null> {
  let query = supabase
    .from('carrier_agreements')
    .select('*')
    .eq('org_id', orgId)
    .eq('carrier_id', carrierId);

  // A program-specific agreement is preferred; a carrier-wide one is the
  // fallback. Picking the wrong way round would apply generic terms to a job
  // the network negotiated separately.
  if (programId) query = query.eq('program_id', programId);

  const { data, error } = await query.limit(1);
  if (error) fail(error, 'Could not load the program agreement');
  if (data?.[0]) return toAgreement(data[0]);

  if (programId) return getAgreement(supabase, orgId, carrierId, null);
  return null;
}

export async function listAgreements(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ProgramAgreement[]> {
  const { data, error } = await supabase
    .from('carrier_agreements')
    .select('*')
    .eq('org_id', orgId)
    .order('carrier_name', { ascending: true });
  if (error) fail(error, 'Could not list program agreements');
  return (data ?? []).map(toAgreement);
}

export async function deleteAgreement(
  supabase: SupabaseClient,
  orgId: string,
  carrierId: string,
  programId: string,
): Promise<void> {
  const { error } = await supabase
    .from('carrier_agreements')
    .delete()
    .eq('org_id', orgId)
    .eq('carrier_id', carrierId)
    .eq('program_id', programId);
  if (error) fail(error, 'Could not remove the program agreement');
}

/* ------------------------------------------------------------------ *
 * Deviations
 * ------------------------------------------------------------------ */

/**
 * A deviation is a decision someone made about one job, so it is stored against
 * the job and carries who accepted it. `proposed` is never persisted — a
 * proposal is the agent's suggestion, and only a human turning it into an
 * accepted deviation makes it real.
 */
export async function saveDeviation(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  jobId: string,
  deviation: SlaDeviation,
): Promise<void> {
  if (!deviation.reason?.trim() || deviation.evidenceIds.length === 0) {
    throw new HttpError(
      400,
      'A deviation needs a written reason and at least one piece of evidence from the job. A reason with nothing behind it is an assertion, not documentation.',
      'deviation_undocumented',
    );
  }

  const { error } = await supabase.from('carrier_deviations').upsert(
    {
      org_id: orgId,
      external_job_id: jobId,
      rule_id: deviation.ruleId,
      reason: deviation.reason.trim(),
      evidence_ids: deviation.evidenceIds,
      authorized_by: deviation.authorizedBy ?? null,
      authorized_at: deviation.authorizedAt ?? new Date().toISOString(),
      accepted_by: userId,
    },
    { onConflict: 'org_id,external_job_id,rule_id' },
  );
  if (error) fail(error, 'Could not record the deviation');
}

export async function listDeviations(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string,
): Promise<SlaDeviation[]> {
  const { data, error } = await supabase
    .from('carrier_deviations')
    .select('rule_id, reason, evidence_ids, authorized_by, authorized_at')
    .eq('org_id', orgId)
    .eq('external_job_id', jobId);
  if (error) fail(error, 'Could not load the job\'s deviations');

  return (data ?? []).map((row: any) => ({
    ruleId: row.rule_id,
    reason: row.reason,
    evidenceIds: row.evidence_ids ?? [],
    authorizedBy: row.authorized_by ?? undefined,
    authorizedAt: row.authorized_at ?? undefined,
  }));
}

export async function deleteDeviation(
  supabase: SupabaseClient,
  orgId: string,
  jobId: string,
  ruleId: string,
): Promise<void> {
  const { error } = await supabase
    .from('carrier_deviations')
    .delete()
    .eq('org_id', orgId)
    .eq('external_job_id', jobId)
    .eq('rule_id', ruleId);
  if (error) fail(error, 'Could not remove the deviation');
}
