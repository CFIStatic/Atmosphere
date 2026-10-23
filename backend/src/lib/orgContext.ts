import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from './supabase.js';
import { HttpError } from './errors.js';
import {
  effectivePermissionRole,
  isAdminPermission,
  productRoleForPermission,
  toOrgProductRole,
  type PermissionRole,
} from './productRoles.js';

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
  /**
   * Effective role for capability checks: 'global_admin' when the permission
   * role is owner or admin, otherwise 'employee'. Existing `isGlobalAdmin(ctx.role)`
   * checks therefore follow the permission role, not the billing seat.
   */
  role: string;
  /** org_members.role as stored (billing meaning; legacy). */
  dbRole: string;
  /** Normalized: global_admin (owner/admin) | employee (member/viewer). */
  productRole: 'global_admin' | 'employee';
  /** owner | admin | member | viewer */
  permissionRole: PermissionRole;
  supabase: SupabaseClient;
}

/**
 * A viewer may read everything their membership can see but change nothing.
 * Writes they still need: their own profile/preferences, leaving, deleting
 * their account, and sign-in housekeeping.
 */
const VIEWER_WRITE_ALLOWLIST: RegExp[] = [
  /^\/api\/org\/me(\/|$)/,
  /^\/api\/org\/join(\/|$)/,
  /^\/api\/org\/leave(\/|$)/,
  /^\/api\/account(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/profile(\/|$)/,
  /^\/api\/me(\/|$)/,
];
export function isViewerBlockedWrite(req: Pick<Request, 'method'> & { originalUrl?: string; url?: string }): boolean {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  return !VIEWER_WRITE_ALLOWLIST.some((re) => re.test(path));
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

  let result = await supabase
    .from('org_members')
    .select('org_id, role, permission_role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (result.error && /column .* does not exist|permission_role/i.test(result.error.message)) {
    // Migration 20261023150000 not applied yet: the old role meaning applies.
    result = (await supabase
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)) as typeof result;
  }
  const { data, error } = result;

  if (error) throw new HttpError(500, error.message, 'org_lookup_failed');

  const row = (data?.[0] ?? null) as {
    org_id?: string;
    role?: string;
    permission_role?: string | null;
  } | null;
  const orgId = row?.org_id as string | undefined;
  if (!orgId) {
    // Not an auth failure — the session is fine, the user just has not finished
    // onboarding. A distinct code lets the frontend route to the wizard instead
    // of bouncing them to the login screen.
    throw new HttpError(403, 'Join or create an organization first.', 'no_organization');
  }

  const dbRole = String(row?.role ?? 'employee');
  const permissionRole = effectivePermissionRole({ permission_role: row?.permission_role, role: dbRole });
  const productRole = productRoleForPermission(permissionRole);
  if (permissionRole === 'viewer' && isViewerBlockedWrite(req)) {
    throw new HttpError(403, 'Viewers have read-only access. Ask an admin to change your role.', 'viewer_read_only');
  }
  const ctx: OrgContext = {
    orgId,
    userId,
    role: productRole,
    dbRole,
    productRole,
    permissionRole,
    supabase,
  };
  (req as CachedRequest)[CACHE_KEY] = ctx;
  return ctx;
}

/**
 * The same context, refused unless the caller holds one of these roles.
 *
 * Roles are compared after normalizing legacy member_role values onto the
 * product seats (global_admin / employee). Pass product role names, or legacy
 * aliases — both work. Historical `owner` / `admin` strings map to Global Admin.
 */
export async function requireOrgRole(req: Request, roles: string[]): Promise<OrgContext> {
  const ctx = await requireOrgContext(req);
  const allowed = new Set(
    roles.map((r) => toOrgProductRole(r === 'owner' || r === 'admin' ? 'global_admin' : r)),
  );
  if (!allowed.has(ctx.productRole)) {
    throw new HttpError(
      403,
      'That needs an admin on this organization.',
      'insufficient_role',
    );
  }
  return ctx;
}

/** Org actions for the owner and admins (permission role), not members or viewers.  Billing stays the owner's (requireOrgOwner). */
export async function requireGlobalAdmin(req: Request): Promise<OrgContext> {
  const ctx = await requireOrgContext(req);
  // A context set upstream (tests, internal callers) may predate permissionRole:
  // fall back to the effective role, which already follows the permission role.
  const permission = ctx.permissionRole ?? effectivePermissionRole({ role: ctx.role });
  if (!isAdminPermission(permission)) {
    throw new HttpError(
      403,
      'That needs an admin on this organization.',
      'insufficient_role',
    );
  }
  return ctx;
}
