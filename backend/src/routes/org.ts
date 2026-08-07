import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { z } from 'zod';
import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { sendSystemMail } from '../lib/systemMail.js';
import { invitesAnsweredBy, inviteEmail } from '../org/invites.js';
import { MEMBER_ROLES } from '../lib/validation.js';
import {
  createOrgSchema,
  joinOrgSchema,
  updateMembershipSchema,
  updateOrgProfileSchema,
} from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';

export const orgRouter = Router();

// Every org route requires an authenticated session.
orgRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

function serializeOrg(org: any) {
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    joinCode: org.join_code,
    createdAt: org.created_at,
    contractorType: org.contractor_type ?? null,
  };
}

function serializeMembership(m: any) {
  if (!m) return null;
  const org = Array.isArray(m.orgs) ? m.orgs[0] : m.orgs;
  return {
    role: m.role,
    workType: m.work_type,
    usageIntents: Array.isArray(m.usage_intents) ? m.usage_intents : [],
    status: m.status,
    org: org
      ? {
          id: org.id,
          name: org.name,
          joinCode: org.join_code,
          contractorType: org.contractor_type ?? null,
        }
      : null,
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
    usageIntents: Array.isArray(row.usage_intents) ? row.usage_intents : [],
    status: row.status,
  };
}

const MEMBERSHIP_SELECT =
  'role, work_type, usage_intents, status, orgs(id, name, join_code, contractor_type)';

/** Pre-questionnaire columns — used if the new migration is not applied yet. */
const MEMBERSHIP_SELECT_LEGACY =
  'role, work_type, status, orgs(id, name, join_code)';

function isMissingColumnError(message: string | undefined): boolean {
  if (!message) return false;
  return /usage_intents|contractor_type|column .* does not exist/i.test(message);
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
 * Persist the caller's onboarding answers that live on org_members. create_org /
 * join_org still only take role + work_type; usage intents are written right
 * after those RPCs succeed.
 */
async function saveUsageIntents(
  supabase: ReturnType<typeof createUserClient>,
  userId: string,
  usageIntents: string[],
) {
  const { error } = await supabase
    .from('org_members')
    .update({ usage_intents: usageIntents })
    .eq('user_id', userId);
  if (error) {
    // Hosting before the questionnaire migration should still let create/join
    // succeed — the answers are nice-to-have until the columns exist.
    if (isMissingColumnError(error.message)) return;
    throw new HttpError(500, error.message, 'usage_intents_failed');
  }
}

async function loadMembership(
  supabase: ReturnType<typeof createUserClient>,
  userId: string,
) {
  const primary = await supabase
    .from('org_members')
    .select(MEMBERSHIP_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (!primary.error) return primary;

  if (!isMissingColumnError(primary.error.message)) return primary;

  return supabase
    .from('org_members')
    .select(MEMBERSHIP_SELECT_LEGACY)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
}

/**
 * GET /api/org/me
 * Returns the caller's membership (org + role + work type) or null if they have
 * not completed onboarding yet. The frontend uses null to route to onboarding.
 */
orgRouter.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = await ensureProfile(req);
    const { data, error } = await loadMembership(supabase, req.user!.id);
    if (error) throw new HttpError(500, error.message, 'org_me_failed');
    res.json({ membership: data?.[0] ? serializeMembership(data[0]) : null });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/org/me
 * Lets a member correct their own account type, kind of work, or usage intents
 * after onboarding — a technician promoted to project manager should not have
 * to re-onboard.
 *
 * The write is scoped to `user_id = auth.uid()` here and again by the RLS policy
 * on `org_members`, so this can only ever rewrite the caller's own row.
 */
orgRouter.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role, workType, usageIntents } = updateMembershipSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    let result: { data: any[] | null; error: { message: string } | null } = await supabase
      .from('org_members')
      .update({ role, work_type: workType, usage_intents: usageIntents })
      .eq('user_id', req.user!.id)
      .select(MEMBERSHIP_SELECT)
      .limit(1);

    if (result.error && isMissingColumnError(result.error.message)) {
      result = await supabase
        .from('org_members')
        .update({ role, work_type: workType })
        .eq('user_id', req.user!.id)
        .select(MEMBERSHIP_SELECT_LEGACY)
        .limit(1);
    }

    if (result.error) throw new HttpError(500, result.error.message, 'membership_update_failed');

    const updated = result.data?.[0];
    if (!updated) {
      throw new HttpError(404, 'You are not linked to an organization yet.', 'not_onboarded');
    }

    res.json({ membership: serializeMembership(updated) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/org
 * Update org-level onboarding answers (contractor type). Goes through the
 * set_org_contractor_type SECURITY DEFINER helper because orgs has no UPDATE
 * policy for members.
 */
orgRouter.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contractorType } = updateOrgProfileSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase.rpc('set_org_contractor_type', {
      p_contractor_type: contractorType,
    });
    if (error) {
      const message = /could not find|does not exist|schema cache/i.test(error.message)
        ? 'Apply the onboarding questionnaire migration before changing company type.'
        : /cannot change contractor type/i.test(error.message)
          ? 'Only the organization creator can change the contractor type once it is set.'
          : error.message;
      throw new HttpError(400, message, 'org_profile_update_failed');
    }
    res.json({ org: serializeOrg(data) });
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
    const { name, role, workType, contractorType, usageIntents } = createOrgSchema.parse(req.body);
    const supabase = await ensureProfile(req);
    const { data, error } = await supabase.rpc('create_org', {
      p_name: name,
      p_role: role,
      p_work_type: workType,
    });
    if (error) throw new HttpError(400, error.message, 'create_org_failed');

    const { data: orgWithType, error: typeError } = await supabase.rpc('set_org_contractor_type', {
      p_contractor_type: contractorType,
    });
    // Soft-fail when the questionnaire migration has not been applied yet so
    // hosting still lets new orgs finish onboarding.
    if (typeError && !/could not find|does not exist|schema cache|contractor_type/i.test(typeError.message)) {
      throw new HttpError(400, typeError.message, 'contractor_type_failed');
    }

    await saveUsageIntents(supabase, req.user!.id, usageIntents);

    res.status(201).json({ org: serializeOrg(orgWithType ?? data) });
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
    const { joinCode, role, workType, usageIntents } = joinOrgSchema.parse(req.body);
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

    await saveUsageIntents(supabase, req.user!.id, usageIntents);

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

    let result: { data: any[] | null; error: { message: string } | null } = await supabase
      .from('org_members')
      .select('user_id, role, work_type, usage_intents, status, profiles(email, full_name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (result.error && isMissingColumnError(result.error.message)) {
      result = await supabase
        .from('org_members')
        .select('user_id, role, work_type, status, profiles(email, full_name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: true });
    }

    if (result.error) throw new HttpError(500, result.error.message, 'members_failed');

    res.json({ members: (result.data ?? []).map(serializeMember) });
  } catch (err) {
    next(err);
  }
});

/* ---- Invitations ---------------------------------------------------------- */

/** The caller's org, with the fields inviting needs. */
async function orgForInvites(supabase: any, userId: string) {
  const { data } = await supabase
    .from('org_members')
    .select('org_id, orgs(id, name, join_code)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  const row = (data ?? [])[0] as any;
  if (!row?.org_id) throw new HttpError(404, 'You are not in an organization yet.', 'no_org');
  return { orgId: row.org_id as string, name: row.orgs?.name as string, joinCode: row.orgs?.join_code as string };
}

/**
 * GET /api/org/invites
 * Who has been asked, and where each invitation stands.
 *
 * Reconciliation happens here, lazily. Joining goes through the code and the
 * join flow has no idea an invite row exists, so pending invites whose address
 * now belongs to a member are marked joined on read. Lazy because this list is
 * read from exactly one screen, and a trigger on org_members would couple the
 * join path to a bookkeeping table it should not know about.
 */
orgRouter.get('/invites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { orgId } = await orgForInvites(supabase, req.user!.id);

    const [{ data: inviteRows }, { data: memberRows }] = await Promise.all([
      supabase
        .from('org_invites')
        .select('id, email, role, note, status, created_at, joined_at, revoked_at, invited_by')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('org_members').select('user_id, profiles(email)').eq('org_id', orgId),
    ]);

    const invites = (inviteRows ?? []) as any[];
    const memberEmails = ((memberRows ?? []) as any[])
      .map((m) => m.profiles?.email)
      .filter(Boolean) as string[];

    const answered = invitesAnsweredBy(invites, memberEmails);
    if (answered.length) {
      await supabase
        .from('org_invites')
        .update({ status: 'joined', joined_at: new Date().toISOString() })
        .in('id', answered);
      for (const invite of invites) {
        if (answered.includes(invite.id)) invite.status = 'joined';
      }
    }

    res.json({
      invites: invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        note: invite.note,
        status: invite.status,
        createdAt: invite.created_at,
        joinedAt: invite.joined_at,
        revokedAt: invite.revoked_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const createInviteSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(MEMBER_ROLES).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST /api/org/invites
 * Ask somebody to join, and email them the code if a mailbox is connected.
 *
 * Any member may invite, deliberately: the join code is already visible to
 * every member in settings, so an invite grants nothing the inviter could not
 * hand over by reading their own screen. Gating it would be theatre.
 *
 * The email is best-effort. No connected mailbox is the common case on day
 * one, and the response says so plainly so the UI can hand over the code to
 * send some other way — a failed invite email must not read as a failed
 * invite.
 */
orgRouter.post('/invites', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createInviteSchema.parse(req.body ?? {});
    const supabase = createUserClient(req.accessToken!);
    const { orgId, name, joinCode } = await orgForInvites(supabase, req.user!.id);
    const email = input.email.trim().toLowerCase();

    const { data: invite, error } = await supabase
      .from('org_invites')
      .insert({
        org_id: orgId,
        email,
        role: input.role ?? 'field_technician',
        note: input.note ?? null,
        invited_by: req.user!.id,
      })
      .select('id, email, role, status, created_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new HttpError(409, 'That address already has a live invitation.', 'duplicate_invite');
      }
      throw new HttpError(400, error.message, 'invite_failed');
    }

    // Global erasure tombstones outrank a workplace invitation like they
    // outrank everything else: somebody who asked to be forgotten does not get
    // email from this platform, full stop. The invite itself stands — the code
    // can be handed over in person — and the reason is kept generic on purpose,
    // because "this address is on an erasure list" is itself a disclosure.
    let emailed = false;
    const admin = createAdminClient();
    let erased = false;
    if (admin) {
      const { data } = await admin.from('network_erasures').select('email').eq('email', email).maybeSingle();
      erased = Boolean(data);
    }

    if (!erased) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', req.user!.id)
        .maybeSingle();
      const mail = inviteEmail({
        orgName: name,
        inviterName: (profile as any)?.full_name ?? (profile as any)?.email ?? null,
        joinCode,
        origin: config.frontendOrigins?.[0] ?? null,
        note: input.note ?? null,
      });
      // Atmosphere sends — not the org's connected Gmail/Microsoft.
      const result = await sendSystemMail({
        to: email,
        subject: mail.subject,
        text: mail.text,
      });
      emailed = result.ok;
    }

    res.status(201).json({
      invite: {
        id: (invite as any).id,
        email: (invite as any).email,
        role: (invite as any).role,
        status: (invite as any).status,
        createdAt: (invite as any).created_at,
      },
      emailed,
      // Handed back so the screen can offer "copy the code" the moment the
      // email could not go — not as a fallback the person has to hunt for.
      joinCode,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/org/invites/:id/revoke — withdraw a pending invitation. */
orgRouter.post('/invites/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { orgId } = await orgForInvites(supabase, req.user!.id);

    const { data, error } = await supabase
      .from('org_invites')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) throw new HttpError(400, error.message, 'revoke_failed');
    if (!data) {
      throw new HttpError(409, 'That invitation is not pending — it was already answered or withdrawn.', 'not_pending');
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
