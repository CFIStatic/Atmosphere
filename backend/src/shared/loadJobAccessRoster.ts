/**
 * Load everyone with access to one job file (the office "Who has access"
 * roster). Shared by the Access tab and the job file report.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { HttpError } from '../lib/errors.js';
import { presentJobAccessRoster, type JobAccessPerson } from './jobAccessRoster.js';

export async function loadJobAccessPeople(
  supabase: any,
  admin: any,
  orgId: string,
  jobId: string,
): Promise<JobAccessPerson[]> {
  const [sharesRes, partiesRes, grantsRes] = await Promise.all([
    supabase
      .from('verifier_shares')
      .select(
        'id, label, recipient_email, created_by, created_at, expires_at, revoked_at, last_opened_at, open_count, share_kind',
      )
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .eq('share_kind', 'progress')
      .order('created_at', { ascending: false }),
    supabase
      .from('job_parties')
      .select(
        'id, company, trade, contact_name, email, role, service_role, service_role_custom, created_by, created_at, invited_at, last_seen_at, revoked_at',
      )
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
    admin
      .from('job_progress_grants')
      .select('id, user_id, share_id, recipient_email, created_at, last_accessed_at, service_role')
      .eq('org_id', orgId)
      .eq('job_id', jobId),
  ]);

  if (sharesRes.error) throw new HttpError(500, sharesRes.error.message, 'shares_failed');
  if (partiesRes.error) throw new HttpError(500, partiesRes.error.message, 'parties_failed');
  let grants = (grantsRes.data ?? []) as any[];
  if (grantsRes.error) {
    const blob = `${grantsRes.error.message ?? ''} ${grantsRes.error.code ?? ''}`;
    if (/job_progress_grants|does not exist|schema cache|last_accessed_at/i.test(blob)) {
      // Retry without last_accessed_at if the column is not applied yet.
      const retry = await admin
        .from('job_progress_grants')
        .select('id, user_id, share_id, recipient_email, created_at')
        .eq('org_id', orgId)
        .eq('job_id', jobId);
      if (retry.error) {
        if (/job_progress_grants|does not exist|schema cache/i.test(
          `${retry.error.message ?? ''} ${retry.error.code ?? ''}`,
        )) {
          grants = [];
        } else {
          throw new HttpError(500, retry.error.message, 'grants_failed');
        }
      } else {
        grants = ((retry.data ?? []) as any[]).map((g) => ({ ...g, last_accessed_at: null }));
      }
    } else {
      throw new HttpError(500, grantsRes.error.message, 'grants_failed');
    }
  }

  const granterIds = [
    ...new Set(
      [
        ...((sharesRes.data ?? []) as any[]).map((s) => s.created_by),
        ...((partiesRes.data ?? []) as any[]).map((p) => p.created_by),
        ...grants.map((g) => g.user_id),
      ].filter(Boolean),
    ),
  ] as string[];

  let profiles: any[] = [];
  if (granterIds.length) {
    const { data: profileRows, error: profileError } = await admin
      .from('profiles')
      .select('id, full_name, email, service_role, service_role_custom')
      .in('id', granterIds);
    if (profileError) throw new HttpError(500, profileError.message, 'profiles_failed');
    profiles = (profileRows ?? []) as any[];
  }

  return presentJobAccessRoster({
    shares: (sharesRes.data ?? []) as any[],
    parties: (partiesRes.data ?? []) as any[],
    grants: grants as any[],
    profiles,
  });
}
