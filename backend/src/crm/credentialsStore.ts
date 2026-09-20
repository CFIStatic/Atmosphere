/**
 * Org-scoped CRM agent credential CRUD. Service-role only.
 * Never returns or logs plaintext passwords.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { openCrmPassword, sealCrmPassword } from '../lib/crmCredentialCrypto.js';
import { logger } from '../lib/logger.js';
import {
  CRM_AGENT_SYSTEMS,
  type CrmAgentSystem,
  type CrmCredentialPublic,
  type CrmCredentialStatus,
  type CrmLoginCredentials,
} from './types.js';

type CredRow = {
  org_id: string;
  system: string;
  username: string;
  password_cipher: string;
  password_iv: string;
  password_tag: string;
  notes: string | null;
  status: string;
  last_verified_at: string | null;
  last_error: string | null;
  last_agent_job_id: string | null;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
};

function isSystem(value: string): value is CrmAgentSystem {
  return (CRM_AGENT_SYSTEMS as readonly string[]).includes(value);
}

function toPublic(row: CredRow | null | undefined, system: CrmAgentSystem): CrmCredentialPublic {
  if (!row) {
    return {
      system,
      connected: false,
      username: null,
      notes: null,
      status: null,
      lastVerifiedAt: null,
      lastError: null,
      connectedAt: null,
    };
  }
  return {
    system,
    connected: true,
    username: row.username,
    notes: row.notes,
    status: (row.status as CrmCredentialStatus) || 'connected',
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    connectedAt: row.connected_at,
  };
}

export async function listCrmCredentialStatus(
  admin: SupabaseClient,
  orgId: string,
): Promise<CrmCredentialPublic[]> {
  const { data, error } = await admin
    .from('crm_agent_credentials')
    .select(
      'org_id, system, username, notes, status, last_verified_at, last_error, connected_at, connected_by, updated_at, password_cipher, password_iv, password_tag, last_agent_job_id',
    )
    .eq('org_id', orgId);
  if (error) {
    // Table missing (migration pending) → empty disconnected list, not a hard fail.
    logger.warn('crm_credentials_list_failed', { orgId, detail: error.message });
    return CRM_AGENT_SYSTEMS.map((system) => toPublic(null, system));
  }
  const bySystem = new Map<string, CredRow>();
  for (const row of (data ?? []) as CredRow[]) {
    if (isSystem(row.system)) bySystem.set(row.system, row);
  }
  return CRM_AGENT_SYSTEMS.map((system) => toPublic(bySystem.get(system), system));
}

export async function saveCrmCredentials(
  admin: SupabaseClient,
  input: {
    orgId: string;
    userId: string;
    system: CrmAgentSystem;
    username: string;
    password: string;
    notes?: string | null;
    status?: CrmCredentialStatus;
  },
): Promise<CrmCredentialPublic> {
  const sealed = sealCrmPassword(input.password);
  const now = new Date().toISOString();
  const row = {
    org_id: input.orgId,
    system: input.system,
    username: input.username.trim(),
    password_cipher: sealed.cipher,
    password_iv: sealed.iv,
    password_tag: sealed.tag,
    notes: input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null,
    status: input.status ?? 'pending_verify',
    last_error: null,
    connected_by: input.userId,
    connected_at: now,
    updated_at: now,
  };
  const { data, error } = await admin
    .from('crm_agent_credentials')
    .upsert(row, { onConflict: 'org_id,system' })
    .select(
      'org_id, system, username, notes, status, last_verified_at, last_error, connected_at, connected_by, updated_at, password_cipher, password_iv, password_tag, last_agent_job_id',
    )
    .single();
  if (error) {
    logger.warn('crm_credentials_save_failed', { orgId: input.orgId, system: input.system, detail: error.message });
    throw Object.assign(new Error('Could not save CRM credentials'), {
      status: 500,
      code: 'crm_credentials_save_failed',
    });
  }
  logger.info('crm_credentials_saved', {
    orgId: input.orgId,
    system: input.system,
    username: input.username.trim(),
    // Never log password or ciphertext.
  });
  return toPublic(data as CredRow, input.system);
}

export async function deleteCrmCredentials(
  admin: SupabaseClient,
  orgId: string,
  system: CrmAgentSystem,
): Promise<void> {
  const { error } = await admin
    .from('crm_agent_credentials')
    .delete()
    .eq('org_id', orgId)
    .eq('system', system);
  if (error) {
    logger.warn('crm_credentials_delete_failed', { orgId, system, detail: error.message });
    throw Object.assign(new Error('Could not disconnect CRM'), {
      status: 500,
      code: 'crm_credentials_delete_failed',
    });
  }
  logger.info('crm_credentials_deleted', { orgId, system });
}

export async function loadDecryptedCrmCredentials(
  admin: SupabaseClient,
  orgId: string,
  system: CrmAgentSystem,
): Promise<CrmLoginCredentials | null> {
  const { data, error } = await admin
    .from('crm_agent_credentials')
    .select('username, password_cipher, password_iv, password_tag, notes')
    .eq('org_id', orgId)
    .eq('system', system)
    .maybeSingle();
  if (error || !data) return null;
  try {
    const password = openCrmPassword({
      cipher: String(data.password_cipher),
      iv: String(data.password_iv),
      tag: String(data.password_tag),
    });
    return {
      username: String(data.username),
      password,
      notes: data.notes ? String(data.notes) : null,
    };
  } catch (err) {
    logger.warn('crm_credentials_decrypt_failed', {
      orgId,
      system,
      detail: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function updateCrmCredentialStatus(
  admin: SupabaseClient,
  orgId: string,
  system: CrmAgentSystem,
  patch: {
    status: CrmCredentialStatus;
    lastError?: string | null;
    lastVerifiedAt?: string | null;
    lastAgentJobId?: string | null;
  },
): Promise<void> {
  const { error } = await admin
    .from('crm_agent_credentials')
    .update({
      status: patch.status,
      last_error: patch.lastError ?? null,
      last_verified_at: patch.lastVerifiedAt ?? undefined,
      last_agent_job_id: patch.lastAgentJobId ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('system', system);
  if (error) {
    logger.warn('crm_credentials_status_failed', { orgId, system, detail: error.message });
  }
}
