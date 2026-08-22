/**
 * Legal video vault.
 *
 * Every accepted clip is catalogued here with the object-storage key the
 * product already uses. User delete stamps user_deleted_at. It never removes
 * the row or asks the driver to delete bytes.
 */
import { HttpError } from '../lib/errors.js';
import type { MediaObject } from '../media/types.js';
import {
  createVaultEntry,
  getVaultBySource,
  loadVault,
  loadVaultById,
  markVaultDeleted,
  persistVault,
} from './store.js';
import type { LegalVaultEntry, VaultMediaInput } from './types.js';

export async function vaultMedia(input: VaultMediaInput): Promise<LegalVaultEntry> {
  const existing = getVaultBySource(input.sourceKind, input.sourceId);
  if (existing) return existing;
  const entry = createVaultEntry(input);
  try {
    await persistVault(entry);
  } catch (err) {
    console.warn('[legal] vault persist failed:', err instanceof Error ? err.message : err);
  }
  return entry;
}

export async function vaultFromMediaObject(
  media: MediaObject,
  extra?: { jobId?: string | null; actorUserId?: string | null },
): Promise<LegalVaultEntry> {
  return vaultMedia({
    orgId: media.orgId,
    sourceKind: 'media_object',
    sourceId: media.id,
    jobId: extra?.jobId ?? (media.refType === 'job' || media.refType === 'crm_job' ? media.refId : null),
    actorUserId: extra?.actorUserId ?? null,
    storageBackend: media.backend,
    storageBucket: media.bucket,
    storageKey: media.objectKey,
    contentHash: media.contentHash,
    byteSize: media.byteSize,
    durationSeconds: media.durationSeconds,
    contentType: media.contentType,
    receivedAt: media.updatedAt,
    metadata: {
      kind: media.kind,
      refType: media.refType ?? null,
      refId: media.refId ?? null,
    },
  });
}

export async function vaultFromProof(proof: {
  id: string;
  org_id: string;
  job_id?: string | null;
  storage_path: string;
  content_hash?: string | null;
  byte_size?: number | null;
  duration_seconds?: number | null;
  captured_at?: string | null;
  received_at?: string | null;
  party_id?: string | null;
  work_date?: string | null;
  phase?: string | null;
}, actorUserId?: string | null): Promise<LegalVaultEntry> {
  return vaultMedia({
    orgId: proof.org_id,
    sourceKind: 'job_proof',
    sourceId: proof.id,
    jobId: proof.job_id ?? null,
    actorUserId: actorUserId ?? null,
    storageBackend: 'supabase',
    storageBucket: 'job-proofs',
    storageKey: proof.storage_path,
    contentHash: proof.content_hash ?? null,
    byteSize: proof.byte_size ?? null,
    durationSeconds: proof.duration_seconds == null ? null : Number(proof.duration_seconds),
    contentType: 'video/mp4',
    capturedAt: proof.captured_at ?? null,
    receivedAt: proof.received_at ?? undefined,
    metadata: {
      partyId: proof.party_id ?? null,
      workDate: proof.work_date ?? null,
      phase: proof.phase ?? null,
    },
  });
}

export async function markSourceDeleted(
  sourceKind: LegalVaultEntry['sourceKind'],
  sourceId: string,
): Promise<LegalVaultEntry | null> {
  const entry = markVaultDeleted(sourceKind, sourceId);
  if (entry) {
    try {
      await persistVault(entry);
    } catch (err) {
      console.warn('[legal] vault delete stamp failed:', err instanceof Error ? err.message : err);
    }
  }
  return entry;
}

export function canPurgeBytes(entry: LegalVaultEntry | null, onHold: boolean): boolean {
  if (!entry) return !onHold;
  return false;
}

export async function requireVault(id: string): Promise<LegalVaultEntry> {
  const entry = (await loadVaultById(id)) ?? getVaultBySource('job_proof', id) ?? getVaultBySource('media_object', id);
  if (!entry) throw new HttpError(404, 'Vaulted video not found', 'vault_not_found');
  return entry;
}

export async function listVaultedVideos(): Promise<LegalVaultEntry[]> {
  return loadVault();
}
