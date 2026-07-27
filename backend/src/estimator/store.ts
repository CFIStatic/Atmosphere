import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import type { ConsentAuditEntry, ConsentGrant, ConsentScope, CredentialStorageMode } from './xactimate/consent.js';
import type { SealedCredential } from './xactimate/credentials.js';
import type { PriceList } from './catalog/priceList.js';
import type { MitigationEstimate } from './types.js';

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
  costOverrides?: Record<string, number>;
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
