import type { NextFunction, Request, Response } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { HttpError, forbidden } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      orgId?: string;
    }
  }
}

/**
 * Resolves the caller's organization and attaches it as `req.orgId`.
 *
 * The organization is never taken from the request body. It is looked up from
 * the caller's own membership under their JWT, so a client cannot bill, top up
 * or inspect an organization it does not belong to by passing a different id —
 * and Row Level Security backs that up a second time on every query.
 *
 * Must run after `requireAuth`.
 */
export async function requireOrg(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw new HttpError(500, error.message, 'org_lookup_failed');

    const orgId = data?.[0]?.org_id as string | undefined;
    if (!orgId) {
      throw forbidden('Finish onboarding into an organization first.', 'not_onboarded');
    }

    req.orgId = orgId;
    next();
  } catch (err) {
    next(err);
  }
}
