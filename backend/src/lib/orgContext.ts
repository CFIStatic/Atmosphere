import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from './supabase.js';
import { HttpError } from './errors.js';

/**
 * Resolves the organization the caller is acting for.
 *
 * Every CRM row is stamped with an org_id the server derives here — never one
 * the client sends. That is what makes "which company's data is this?" a
 * question about the session rather than about the request body.
 *
 * RLS would still refuse a write addressed to another org, so this is the
 * second of two locks rather than the only one. It exists because a clear 403
 * beats a policy violation surfacing as an opaque database error.
 */

export interface OrgContext {
  orgId: string;
  userId: string;
  role: string;
  supabase: SupabaseClient;
}

/**
 * Per-request cache. A single route can call this several times (validate a
 * parent record, then write a child); the membership does not change mid-request
 * and the lookup is a network round-trip, so we do it once.
 */
const CACHE_KEY = Symbol.for('atmosphere.orgContext');

interface CachedRequest extends Request {
  [CACHE_KEY]?: OrgContext;
}

export async function requireOrgContext(req: Request): Promise<OrgContext> {
  const cached = (req as CachedRequest)[CACHE_KEY];
  if (cached) return cached;

  const supabase = createUserClient(req.accessToken!);
  const userId = req.user!.id;

  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw new HttpError(500, error.message, 'org_lookup_failed');

  const orgId = data?.[0]?.org_id as string | undefined;
  if (!orgId) {
    // Not an auth failure — the session is fine, the user just has not finished
    // onboarding. A distinct code lets the frontend route to the wizard instead
    // of bouncing them to the login screen.
    throw new HttpError(403, 'Join or create an organization first.', 'no_organization');
  }

  const role = String(data?.[0]?.role ?? 'member');
  const ctx: OrgContext = { orgId, userId, role, supabase };
  (req as CachedRequest)[CACHE_KEY] = ctx;
  return ctx;
}

/**
 * The same context, refused unless the caller holds one of these roles.
 *
 * Kept separate from requireOrgContext so the common path stays a single
 * lookup and callers opt into the stricter check explicitly. Used for actions
 * that reach outside the tenant — spending against a vendor credential,
 * testing one — where "any member of the org" is the wrong bar.
 */
export async function requireOrgRole(req: Request, roles: string[]): Promise<OrgContext> {
  const ctx = await requireOrgContext(req);
  if (!roles.includes(ctx.role)) {
    throw new HttpError(
      403,
      'That needs an owner or admin on this organization.',
      'insufficient_role',
    );
  }
  return ctx;
}
