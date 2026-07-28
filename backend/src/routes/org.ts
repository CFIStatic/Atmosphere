import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { createOrgSchema, joinOrgSchema, updateMembershipSchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';

export const orgRouter = Router();

// Every org route requires an authenticated session.
orgRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

function serializeOrg(org: any) {
  if (!org) return null;
  return { id: org.id, name: org.name, joinCode: org.join_code, createdAt: org.created_at };
}

function serializeMembership(m: any) {
  if (!m) return null;
  const org = Array.isArray(m.orgs) ? m.orgs[0] : m.orgs;
  return {
    role: m.role,
    workType: m.work_type,
    status: m.status,
    org: org ? { id: org.id, name: org.name, joinCode: org.join_code } : null,
  };
}

function serializeMember(row: any) {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    userId: row.user_id,
    email: p?.email ?? null,
    fullName: p?.full_name ?? null,
    role: row.role,
    workType: row.work_type,
    status: row.status,
  };
}

/** Ensure the caller has a profile row carrying their email (for directories). */
async function ensureProfile(req: Request) {
  const supabase = createUserClient(req.accessToken!);
  await supabase
    .from('profiles')
    .upsert({ id: req.user!.id, email: req.user!.email }, { onConflict: 'id' });
  return supabase;
}

/**
 * GET /api/org/me
 * Returns the caller's membership (org + role + work type) or null if they have
 * not completed onboarding yet. The frontend uses null to route to onboarding.
 */
orgRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = await ensureProfile(req);
    const { data, error } = await supabase
      .from('org_members')
      .select('role, work_type, status, orgs(id, name, join_code)')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw new HttpError(500, error.message, 'org_me_failed');
    res.json({ membership: data?.[0] ? serializeMembership(data[0]) : null });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/org/me
 * Lets a member correct their own account type or kind of work after onboarding
 * — a technician promoted to project manager should not have to re-onboard.
 *
 * The write is scoped to `user_id = auth.uid()` here and again by the RLS policy
 * on `org_members`, so this can only ever rewrite the caller's own row.
 */
orgRouter.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role, workType } = updateMembershipSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('org_members')
      .update({ role, work_type: workType })
      .eq('user_id', req.user!.id)
      .select('role, work_type, status, orgs(id, name, join_code)')
      .limit(1);
    if (error) throw new HttpError(500, error.message, 'membership_update_failed');

    const updated = data?.[0];
    if (!updated) {
      throw new HttpError(404, 'You are not linked to an organization yet.', 'not_onboarded');
    }

    res.json({ membership: serializeMembership(updated) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/org
 * Create a new organization and join the caller to it as its first member.
 */
orgRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, role, workType } = createOrgSchema.parse(req.body);
    const supabase = await ensureProfile(req);
    const { data, error } = await supabase.rpc('create_org', {
      p_name: name,
      p_role: role,
      p_work_type: workType,
    });
    if (error) throw new HttpError(400, error.message, 'create_org_failed');
    res.status(201).json({ org: serializeOrg(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/org/join
 * Link the caller to an existing organization via its join code.
 */
orgRouter.post('/join', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { joinCode, role, workType } = joinOrgSchema.parse(req.body);
    const supabase = await ensureProfile(req);
    const { data, error } = await supabase.rpc('join_org', {
      p_code: joinCode,
      p_role: role,
      p_work_type: workType,
    });
    if (error) {
      const message = /invalid join code/i.test(error.message)
        ? 'That join code did not match any organization.'
        : error.message;
      throw new HttpError(400, message, 'join_org_failed');
    }
    res.status(200).json({ org: serializeOrg(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/org/members
 * List the members of the caller's organization (the "linked accounts").
 */
orgRouter.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data: mem, error: memErr } = await supabase
      .from('org_members')
      .select('org_id')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: true })
      .limit(1);
    if (memErr) throw new HttpError(500, memErr.message, 'members_failed');

    const orgId = mem?.[0]?.org_id;
    if (!orgId) {
      res.json({ members: [] });
      return;
    }

    const { data, error } = await supabase
      .from('org_members')
      .select('user_id, role, work_type, status, profiles(email, full_name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });
    if (error) throw new HttpError(500, error.message, 'members_failed');

    res.json({ members: (data ?? []).map(serializeMember) });
  } catch (err) {
    next(err);
  }
});
