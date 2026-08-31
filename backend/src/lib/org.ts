import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';

/**
 * Resolve the caller's primary organization membership.
 *
 * Shared by routes that need an org id without depending on removed estimator
 * stores. First membership by created_at wins (same rule as onboarding).
 */
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
      'Finish onboarding into an organization before continuing.',
      'not_onboarded',
    );
  }
  return orgId;
}
