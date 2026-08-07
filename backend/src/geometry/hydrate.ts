/**
 * Load property_twins rows into the in-memory store when Supabase admin
 * is configured. Lets the office twin viewer survive process restarts.
 */
import { createAdminClient } from '../lib/supabase.js';
import { getTwin, saveTwin } from './store.js';
import type { PropertyDigitalTwin } from './types.js';

const hydratedOrgs = new Set<string>();

export function resetTwinHydrationForTests(): void {
  hydratedOrgs.clear();
}

export async function hydrateTwinsForOrg(orgId: string): Promise<void> {
  if (hydratedOrgs.has(orgId)) return;
  const admin = createAdminClient();
  if (!admin) {
    hydratedOrgs.add(orgId);
    return;
  }
  const { data, error } = await admin
    .from('property_twins')
    .select('payload')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    if (!/does not exist|42P01/i.test(error.message)) {
      console.warn('[geometry.hydrate]', error.message);
    }
    hydratedOrgs.add(orgId);
    return;
  }
  for (const row of data ?? []) {
    const twin = (row as { payload?: PropertyDigitalTwin }).payload;
    if (!twin?.id) continue;
    if (!getTwin(twin.id)) {
      // saveTwin would re-persist; stamp into memory only via create path —
      // use saveTwin which upserts memory + soft persist (idempotent).
      saveTwin({ ...twin, orgId });
    }
  }
  hydratedOrgs.add(orgId);
}
