/**
 * Load media_objects into the in-memory catalog when Supabase admin exists.
 */
import { createAdminClient } from '../lib/supabase.js';
import type { MediaObject } from './types.js';

const objectsRef: { map: Map<string, MediaObject> | null } = { map: null };
const hydratedOrgs = new Set<string>();

/** Called once from catalog.ts to share the Map without circular imports. */
export function bindMediaObjectMap(map: Map<string, MediaObject>): void {
  objectsRef.map = map;
}

export function resetMediaHydrationForTests(): void {
  hydratedOrgs.clear();
}

export async function hydrateMediaForOrg(orgId: string): Promise<void> {
  if (hydratedOrgs.has(orgId)) return;
  const map = objectsRef.map;
  const admin = createAdminClient();
  if (!admin || !map) {
    hydratedOrgs.add(orgId);
    return;
  }
  const { data, error } = await admin
    .from('media_objects')
    .select('*')
    .eq('org_id', orgId)
    .neq('state', 'deleted')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    if (!/does not exist|42P01/i.test(error.message)) {
      console.warn('[media.hydrate]', error.message);
    }
    hydratedOrgs.add(orgId);
    return;
  }
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const id = String(r.id);
    if (map.has(id)) continue;
    map.set(id, {
      id,
      orgId: String(r.org_id),
      kind: r.kind as MediaObject['kind'],
      durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
      byteSize: r.byte_size != null ? Number(r.byte_size) : null,
      contentHash: (r.content_hash as string) ?? null,
      contentType: (r.content_type as string) ?? null,
      hasAudio: r.has_audio == null ? null : Boolean(r.has_audio),
      backend: r.backend as MediaObject['backend'],
      bucket: String(r.bucket),
      objectKey: String(r.object_key),
      tier: r.tier as MediaObject['tier'],
      state: r.state as MediaObject['state'],
      refType: (r.ref_type as string) ?? null,
      refId: (r.ref_id as string) ?? null,
      retentionUntil: (r.retention_until as string) ?? null,
      legalHold: Boolean(r.legal_hold),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    });
  }
  hydratedOrgs.add(orgId);
}
