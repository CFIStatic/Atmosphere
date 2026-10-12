import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { clientIpKeyGenerator } from '../lib/clientIp.js';
import { HttpError } from '../lib/errors.js';
import { adminForPartyToken } from '../lib/scopedAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { claimInvitedPartiesForUser, normalizeInviteEmail } from '../shared/inviteeJobAccess.js';
import { jobProgressPath } from '../shared/jobProgressGrants.js';
import { authPhoneToE164, formatPhoneForDisplay, normalizePhoneE164 } from '../auth/phoneAuth.js';

/**
 * A subcontractor's invite link (Share > Subcontractor or crew), opened on
 * the office host at /invite/<token>. Same idea as the homeowner's
 * /progress/<token>, but the sub needs a real account: the job opens only
 * once someone signed in as the invited email claims it. The claim attaches
 * this email's live invites to their account; it never adds them to the
 * inviting company (no org_members row), so they see that one job and
 * nothing else of the company's.
 *
 * Token goes in the body (tokens can contain "/").
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const crewInviteRouter = Router();

crewInviteRouter.use(
  rateLimit({
    keyGenerator: clientIpKeyGenerator,
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests.', code: 'rate_limited' },
  }),
);

const TokenBody = z.object({ token: z.string().trim().min(8).max(400) });

/** What the sign-in page needs: who it was sent to, from which company, which job. */
export function crewInviteSummary(
  party: { email?: string | null; phone?: string | null },
  orgName: string | null | undefined,
  jobTitle: string | null | undefined,
): { recipientEmail: string | null; recipientPhone: string | null; orgName: string; jobTitle: string | null } {
  const recipientEmail = normalizeInviteEmail(party.email) || null;
  return {
    recipientEmail,
    recipientPhone: recipientEmail ? null : normalizePhoneE164(party.phone),
    orgName: orgName?.trim() || 'Your contractor',
    jobTitle: jobTitle?.trim() || null,
  };
}

/** The signed-in account may claim only an invite addressed to its own email or phone. */
export function assertMayClaimCrewInvite(
  party: { email?: string | null; phone?: string | null },
  userEmail: string | null | undefined,
  userPhone?: string | null,
): void {
  const invited = normalizeInviteEmail(party.email);
  const invitedPhone = invited ? null : normalizePhoneE164(party.phone);
  if (invitedPhone) {
    if (authPhoneToE164(userPhone) !== invitedPhone) {
      throw new HttpError(
        403,
        `This job was shared with ${formatPhoneForDisplay(invitedPhone)}. Sign in with that number.`,
        'invite_phone_mismatch',
      );
    }
    return;
  }
  if (!invited) {
    throw new HttpError(
      409,
      'This invite was not sent to an email. Ask your contractor to invite you by email.',
      'invite_no_email',
    );
  }
  const me = normalizeInviteEmail(userEmail);
  if (me !== invited) {
    throw new HttpError(403, `This job was shared with ${invited}. Sign in with that email.`, 'invite_email_mismatch');
  }
}

async function jobAndOrg(admin: any, party: { org_id: string; job_id: string }) {
  const [{ data: org }, { data: job }] = await Promise.all([
    admin.from('orgs').select('name').eq('id', party.org_id).maybeSingle(),
    admin.from('crm_jobs').select('id, title, deleted_at').eq('id', party.job_id).maybeSingle(),
  ]);
  if (!job || (job as any).deleted_at) {
    throw new HttpError(404, 'This job no longer exists.', 'job_deleted');
  }
  return { orgName: (org as any)?.name as string | undefined, jobTitle: (job as any)?.title as string | undefined };
}

/** POST /api/crew-invite/info — { token } → recipient email, company, job title. */
crewInviteRouter.post('/info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenBody.parse(req.body ?? {});
    const { party, admin } = await adminForPartyToken(token);
    const { orgName, jobTitle } = await jobAndOrg(admin.raw, party as any);
    res.json(crewInviteSummary(party as any, orgName, jobTitle));
  } catch (err) {
    next(err);
  }
});

/** POST /api/crew-invite/claim — signed in as the invited email → the job opens. */
crewInviteRouter.post('/claim', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = TokenBody.parse(req.body ?? {});
    const { party, admin } = await adminForPartyToken(token);
    assertMayClaimCrewInvite(party as any, req.user!.email, req.user!.phone);
    await jobAndOrg(admin.raw, party as any);
    await claimInvitedPartiesForUser(admin.raw, { id: req.user!.id, email: req.user!.email, phone: req.user!.phone });
    res.json({ ok: true, orgId: party.org_id, jobId: party.job_id, path: jobProgressPath(party.job_id) });
  } catch (err) {
    next(err);
  }
});
