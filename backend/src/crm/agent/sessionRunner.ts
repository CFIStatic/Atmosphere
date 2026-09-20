/**
 * Shared CRM login-session runner.
 *
 * Decrypts org credentials, calls the system adapter, updates status.
 * Browser automation for true username/password portals is stubbed:
 * adapters return mode "agent_session" and we record a succeeded queue
 * row with an honest summary so Ask/tools know the login is on file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../lib/logger.js';
import {
  loadDecryptedCrmCredentials,
  updateCrmCredentialStatus,
} from '../credentialsStore.js';
import type { CrmAgentJobKind, CrmAgentSystem } from '../types.js';
import { getCrmAdapter } from './adapters/index.js';

export async function enqueueCrmAgentJob(
  admin: SupabaseClient,
  input: {
    orgId: string;
    userId: string;
    system: CrmAgentSystem;
    kind: CrmAgentJobKind;
    requestSummary?: Record<string, unknown>;
  },
): Promise<{ jobId: string | null }> {
  const { data, error } = await admin
    .from('crm_agent_jobs')
    .insert({
      org_id: input.orgId,
      system: input.system,
      kind: input.kind,
      status: 'queued',
      request_summary: input.requestSummary ?? {},
      created_by: input.userId,
    })
    .select('id')
    .single();
  if (error) {
    logger.warn('crm_agent_job_enqueue_failed', {
      orgId: input.orgId,
      system: input.system,
      kind: input.kind,
      detail: error.message,
    });
    return { jobId: null };
  }
  return { jobId: data?.id ? String(data.id) : null };
}

export async function runCrmAgentJob(
  admin: SupabaseClient,
  input: {
    orgId: string;
    system: CrmAgentSystem;
    kind: CrmAgentJobKind;
    jobId?: string | null;
    query?: string;
  },
): Promise<{
  ok: boolean;
  summary: string;
  mode?: string;
  hits?: unknown[];
}> {
  const jobId = input.jobId ?? null;
  if (jobId) {
    await admin
      .from('crm_agent_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('org_id', input.orgId);
  }

  const creds = await loadDecryptedCrmCredentials(admin, input.orgId, input.system);
  if (!creds) {
    const summary = 'No CRM credentials on file for this system.';
    await finishJob(admin, jobId, input.orgId, false, summary);
    return { ok: false, summary };
  }

  const adapter = getCrmAdapter(input.system);

  try {
    if (input.kind === 'verify_login') {
      const result = await adapter.verifyLogin(creds);
      const status = result.ok ? (result.mode === 'api' ? 'connected' : 'pending_verify') : 'error';
      await updateCrmCredentialStatus(admin, input.orgId, input.system, {
        status: result.ok ? 'connected' : 'error',
        lastError: result.ok ? null : result.detail ?? 'Verify failed',
        lastVerifiedAt: result.ok && result.mode === 'api' ? new Date().toISOString() : null,
        lastAgentJobId: jobId,
      });
      // pending_verify still shows as Connected in UI (credentials on file);
      // status field carries the nuance.
      if (result.ok && result.mode !== 'api') {
        await updateCrmCredentialStatus(admin, input.orgId, input.system, {
          status: 'connected',
          lastError: result.detail ?? null,
          lastAgentJobId: jobId,
        });
      } else if (!result.ok) {
        await updateCrmCredentialStatus(admin, input.orgId, input.system, {
          status,
          lastError: result.detail ?? 'Verify failed',
          lastAgentJobId: jobId,
        });
      }
      const summary = result.detail ?? (result.ok ? 'Login verified.' : 'Login failed.');
      await finishJob(admin, jobId, input.orgId, result.ok, summary, {
        mode: result.mode,
        accountLabel: result.accountLabel ?? creds.username,
      });
      // Drop password from memory reference (best-effort).
      creds.password = '';
      return { ok: result.ok, summary, mode: result.mode };
    }

    if (input.kind === 'search' && adapter.search) {
      const result = await adapter.search(creds, input.query ?? '');
      creds.password = '';
      const summary = result.softFail
        ? result.softFail
        : `Found ${result.hits.length} hit(s) in ${adapter.label}.`;
      await finishJob(admin, jobId, input.orgId, true, summary, {
        hitCount: result.hits.length,
      });
      return { ok: true, summary, hits: result.hits };
    }

    if (input.kind === 'pull' && adapter.pullSample) {
      const result = await adapter.pullSample(creds);
      creds.password = '';
      const summary = result.softFail ?? `Pulled ${result.count} sample record(s) from ${adapter.label}.`;
      await finishJob(admin, jobId, input.orgId, !result.softFail, summary, {
        count: result.count,
      });
      return { ok: !result.softFail, summary };
    }

    // push_update and unknown kinds: honest stub
    const summary = `${adapter.label} ${input.kind} queued for agent session (stub).`;
    creds.password = '';
    await finishJob(admin, jobId, input.orgId, true, summary, { stub: true });
    return { ok: true, summary, mode: 'stub' };
  } catch (err) {
    const summary = err instanceof Error ? err.message : 'Agent job failed';
    // Ensure we never echo a password if it appeared in an error string.
    const safe = summary.replace(creds.password, '[redacted]');
    creds.password = '';
    await updateCrmCredentialStatus(admin, input.orgId, input.system, {
      status: 'error',
      lastError: safe.slice(0, 500),
      lastAgentJobId: jobId,
    });
    await finishJob(admin, jobId, input.orgId, false, safe);
    logger.warn('crm_agent_job_failed', {
      orgId: input.orgId,
      system: input.system,
      kind: input.kind,
      detail: safe,
    });
    return { ok: false, summary: safe };
  }
}

async function finishJob(
  admin: SupabaseClient,
  jobId: string | null,
  orgId: string,
  ok: boolean,
  summary: string,
  resultSummary?: Record<string, unknown>,
) {
  if (!jobId) return;
  await admin
    .from('crm_agent_jobs')
    .update({
      status: ok ? 'succeeded' : 'failed',
      finished_at: new Date().toISOString(),
      error: ok ? null : summary.slice(0, 1000),
      result_summary: { summary, ...(resultSummary ?? {}) },
    })
    .eq('id', jobId)
    .eq('org_id', orgId);
}

/**
 * Connect path helper: enqueue verify + run inline (best-effort).
 * Inline run keeps Connect CRM snappy without a separate worker process.
 */
export async function verifyCrmLoginInline(
  admin: SupabaseClient,
  input: { orgId: string; userId: string; system: CrmAgentSystem },
) {
  const { jobId } = await enqueueCrmAgentJob(admin, {
    orgId: input.orgId,
    userId: input.userId,
    system: input.system,
    kind: 'verify_login',
  });
  return runCrmAgentJob(admin, {
    orgId: input.orgId,
    system: input.system,
    kind: 'verify_login',
    jobId,
  });
}
