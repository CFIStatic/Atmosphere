import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import { createUserClient } from '../lib/supabase.js';

/**
 * Billing and Usage belong to the organization's owner: the account that
 * created it (orgs.created_by). Other Global Admins, office managers,
 * employees, homeowners and subcontractors are refused with 403.
 */
export const BILLING_OWNER_ONLY = 'Only the account owner can open Billing and Usage.';

/** True when this user created (owns) the organization. */
export function isOrgOwnerRow(org: { created_by?: string | null } | null | undefined, userId: string | null | undefined): boolean {
  return Boolean(org?.created_by && userId && org.created_by === userId);
}

type OwnerLoader = (req: Request, orgId: string) => Promise<string | null>;
let ownerLoaderForTests: OwnerLoader | null = null;
/** Tests only: answer the owner lookup without a database. */
export function setOrgOwnerLoaderForTests(loader: OwnerLoader | null): void {
  ownerLoaderForTests = loader;
}

export async function loadOrgOwnerId(req: Request, orgId: string): Promise<string | null> {
  if (ownerLoaderForTests) return ownerLoaderForTests(req, orgId);
  const client = unscopedAdminOrNull() ?? createUserClient(req.accessToken!);
  const { data } = await client.from('orgs').select('created_by').eq('id', orgId).maybeSingle();
  return ((data as { created_by?: string | null } | null)?.created_by as string | null) ?? null;
}

/** Must run after requireAuth + requireOrg. */
export async function requireOrgOwner(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.orgId ? await loadOrgOwnerId(req, req.orgId) : null;
    if (!isOrgOwnerRow({ created_by: ownerId }, req.user?.id)) {
      throw forbidden(BILLING_OWNER_ONLY, 'billing_owner_only');
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Same gate, letting a few paths through (e.g. the onboarding status every member's app reads). */
export function requireOrgOwnerExcept(open: ReadonlyArray<{ method: string; path: string }>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (open.some((o) => o.method === req.method && o.path === req.path)) return next();
    return void requireOrgOwner(req, res, next);
  };
}

/** The one billing path every member's app reads: the onboarding/paywall status (stripped for non-owners). */
export const BILLING_OPEN_TO_MEMBERS: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET', path: '/onboarding' },
];
