/**
 * Write-through persistence for property twins into estimator_runs-compatible
 * jsonb is deferred; for now we store a compact twin snapshot table via
 * raw upsert when `property_twins` exists, else no-op.
 *
 * Migration optional: if the table is missing, admin upsert fails softly.
 */
import { createAdminClient } from '../lib/supabase.js';
import type { PropertyDigitalTwin } from './types.js';

export async function persistTwin(twin: PropertyDigitalTwin): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.from('property_twins').upsert(
    {
      id: twin.id,
      org_id: twin.orgId,
      job_id: twin.jobId,
      label: twin.label,
      status: twin.status,
      primary_source: twin.primarySource,
      payload: twin,
      updated_at: twin.updatedAt,
      created_at: twin.createdAt,
    },
    { onConflict: 'id' },
  );
  if (error) {
    // Table may not exist until migration is applied — soft fail.
    if (!/does not exist|42P01/i.test(error.message)) {
      console.warn('[geometry.persist]', error.message);
    }
  }
}
