import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { adminForPartyToken, unscopedAdmin } from '../lib/scopedAdmin.js';
import { listTombstonedJobIds } from '../lib/jobFileDelete.js';
import { HttpError } from '../lib/errors.js';
import { sendSystemMail, systemMailConfigured } from '../lib/systemMail.js';
import { recordAccess } from './proofOfWork.js';
import {
  normalizeContact,
  displayContact,
  maskContact,
  mintCode,
  hashCode,
  checkCode,
  mintSessionToken,
  hashSessionToken,
  groupByGeneralContractor,
  dueToday,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  type ClaimedJobRow,
} from '../verifier/subIdentity.js';

/**
 * The subcontractor's own door.
 *
 * A general contractor requires their subs to use this, so the sub ends up
 * with invitations from several GCs across several jobs — every one of them a
 * link in a text message. The token stays the credential for the first open,
 * because a sub who has to sign up before they can read the scope simply does
 * not, and the GC's whole rollout dies there. But once a sub has proved they
 * control a phone or an inbox, every link they claim with it collects into
 * one screen.
 *
 * The isolation is the load-bearing part. A sub's list spans organizations,
 * so no org-scoped policy could serve it — it is read through the service
 * role against a session the sub holds, and every query below is pinned to
 * the one identity that session resolves to. A general contractor can see who
 * claimed the invitations they sent, which is theirs to know; nothing here
 * lets them see that the same crew also works for their competitor.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const fieldIdentityRouter = Router();

// Claiming is the one unauthenticated write in this file, so it is the one
// that gets the tightest limit. Per-IP rather than per-contact: a per-contact
// limit is trivially evaded and would let an attacker lock a real sub out of
// their own jobs by burning their attempts for them.
const claimLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes.', code: 'rate_limited' },
});

const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.', code: 'rate_limited' },
});

function admin() {
  return unscopedAdmin();
}

/* ------------------------------------------------------------------ *
 * Starting a claim
 * ------------------------------------------------------------------ */

const startSchema = z.object({
  token: z.string().min(8).max(200),
  contact: z.string().min(3).max(254),
});

/**
 * POST /api/field/claim/start
 *
 * "This link is mine, and here is where to reach me." Sends a code.
 *
 * The response is the same whether or not delivery worked, and says so
 * explicitly in `delivered`. Pretending a code was sent when the server has
 * no mail configured would leave a sub typing digits that will never arrive.
 */
fieldIdentityRouter.post(
  '/claim/start',
  claimLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = startSchema.parse(req.body);
      const contact = normalizeContact(input.contact);
      if (!contact) {
        throw new HttpError(400, 'That does not look like a phone number or an email address.', 'bad_contact');
      }

      const { party } = await adminForPartyToken(input.token);
      const db = admin();

      // A link already claimed by somebody else does not get quietly
      // re-claimed: whoever holds the token would silently take over the
      // other person's record of having seen it.
      const { data: existing } = await db
        .from('job_party_claims')
        .select('id, identity_id, field_identities!inner (channel, address)')
        .eq('party_id', (party as any).id)
        .maybeSingle();

      if (existing) {
        const held = (existing as any).field_identities;
        const sameContact = held?.channel === contact.channel && held?.address === contact.address;
        if (!sameContact) {
          throw new HttpError(
            409,
            'This invitation is already signed in to a different phone or email. Ask the general contractor to send a new link.',
            'already_claimed',
          );
        }
      }

      const code = mintCode();
      const { error } = await db.from('field_identity_codes').insert({
        channel: contact.channel,
        address: contact.address,
        code_hash: hashCode(code),
        party_id: (party as any).id,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      });
      if (error) throw new HttpError(500, 'Could not start the sign-in.', 'code_failed');

      const delivered = await deliverCode(db, {
        contact,
        code,
        orgId: (party as any).org_id,
        company: (party as any).company,
      });

      res.json({
        sentTo: maskContact(contact),
        channel: contact.channel,
        delivered: delivered.ok,
        // Honest about why nothing arrived, so the sub is not left waiting on
        // a message the server was never able to send.
        deliveryNote: delivered.ok ? null : delivered.why,
      });
    } catch (err) {
      next(err);
    }
  },
);

async function deliverCode(
  db: any,
  input: {
    contact: { channel: 'sms' | 'email'; address: string };
    code: string;
    orgId: string;
    company: string;
  },
): Promise<{ ok: true } | { ok: false; why: string }> {
  if (input.contact.channel === 'sms') {
    // No SMS provider is wired on this server yet. Said plainly rather than
    // dressed up: a sub staring at a code field deserves to know it is not
    // coming, and the email path still works today.
    return { ok: false, why: 'Text messages are not switched on yet — use an email address instead.' };
  }

  if (!systemMailConfigured()) {
    return { ok: false, why: 'Atmosphere mail is not configured yet — ask the office for your link.' };
  }

  const { data: org } = await db.from('orgs').select('name').eq('id', input.orgId).maybeSingle();
  const orgName = (org as any)?.name ?? 'your general contractor';

  return sendSystemMail({
    to: input.contact.address,
    subject: `${input.code} is your Atmosphere code`,
    text: [
      `${input.code}`,
      '',
      `Use this code to sign in and see every job ${orgName} has invited ${input.company} to on Atmosphere.`,
      '',
      'It expires in ten minutes. If you did not ask for it, nothing has happened and you can ignore this.',
    ].join('\n'),
  });
}

/* ------------------------------------------------------------------ *
 * Finishing a claim
 * ------------------------------------------------------------------ */

const verifySchema = z.object({
  token: z.string().min(8).max(200),
  contact: z.string().min(3).max(254),
  code: z.string().min(4).max(10),
});

/**
 * POST /api/field/claim/verify
 *
 * The code is right: attach this invitation to the identity, mint the
 * session, and hand back everything the sub now has across every GC.
 */
fieldIdentityRouter.post(
  '/claim/verify',
  claimLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = verifySchema.parse(req.body);
      const contact = normalizeContact(input.contact);
      if (!contact) throw new HttpError(400, 'That contact is not valid.', 'bad_contact');

      const { party } = await adminForPartyToken(input.token);
      const db = admin();

      const { data: row } = await db
        .from('field_identity_codes')
        .select('id, code_hash, attempts, expires_at, consumed_at')
        .eq('party_id', (party as any).id)
        .eq('address', contact.address)
        .is('consumed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!row) throw new HttpError(400, 'Ask for a new code.', 'no_code');

      const check = checkCode(row as any, input.code, new Date());
      if (!check.ok) {
        // A wrong guess costs an attempt; a dead code does not, because
        // there is nothing left to protect and the counter would only
        // confuse the next legitimate try.
        if (check.reason === 'wrong') {
          await db
            .from('field_identity_codes')
            .update({ attempts: (row as any).attempts + 1 })
            .eq('id', (row as any).id);
        }
        throw new HttpError(400, messageForCodeFailure(check.reason), check.reason);
      }

      await db
        .from('field_identity_codes')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', (row as any).id);

      // Identity is the verified channel and nothing else. The company name
      // is stored for display and is never matched on — two GCs both typing
      // "Mike's Drywall" is not evidence they mean the same business.
      const displayName = (party as any).contact_name ?? (party as any).company ?? null;
      const { data: identity, error: identityError } = await db
        .from('field_identities')
        .upsert(
          {
            channel: contact.channel,
            address: contact.address,
            display_name: displayName,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'channel,address' },
        )
        .select('id, display_name')
        .single();
      if (identityError || !identity) throw new HttpError(500, 'Could not complete sign-in.', 'identity_failed');

      const { error: claimError } = await db.from('job_party_claims').upsert(
        {
          org_id: (party as any).org_id,
          party_id: (party as any).id,
          identity_id: (identity as any).id,
        },
        { onConflict: 'party_id' },
      );
      if (claimError) throw new HttpError(500, 'Could not attach this job.', 'claim_failed');

      const token = mintSessionToken();
      const { error: sessionError } = await db.from('field_sessions').insert({
        identity_id: (identity as any).id,
        token_hash: hashSessionToken(token),
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      });
      if (sessionError) throw new HttpError(500, 'Could not complete sign-in.', 'session_failed');

      // The GC's custody log gets the fact, because "did they ever open it"
      // is exactly the question a dispute asks.
      await recordAccess(db, {
        orgId: (party as any).org_id,
        jobId: (party as any).job_id,
        action: 'party_claimed',
        partyId: (party as any).id,
        actorLabel: (party as any).company,
        actorRole: 'subcontractor',
        detail: `Signed in and claimed this invitation by ${contact.channel === 'sms' ? 'phone' : 'email'} (${maskContact(contact)})`,
      }).catch(() => undefined);

      const list = await listForIdentity(db, (identity as any).id);
      res.json({
        session: token,
        identity: {
          displayName: (identity as any).display_name,
          contact: displayContact(contact),
          channel: contact.channel,
        },
        ...list,
      });
    } catch (err) {
      next(err);
    }
  },
);

function messageForCodeFailure(reason: 'expired' | 'consumed' | 'exhausted' | 'wrong'): string {
  switch (reason) {
    case 'expired':
      return 'That code has expired. Ask for a new one.';
    case 'consumed':
      return 'That code has already been used. Ask for a new one.';
    case 'exhausted':
      return 'Too many wrong tries on that code. Ask for a new one.';
    case 'wrong':
      return 'That code is not right.';
  }
}

/* ------------------------------------------------------------------ *
 * The sub's list
 * ------------------------------------------------------------------ */

/**
 * Every job this identity has claimed, across every general contractor.
 *
 * Pinned to one identity id, always. This function is the only place a
 * cross-organization read happens in the whole codebase, which is why it
 * takes an identity rather than a filter — there is no way to call it that
 * accidentally spans two people.
 */
async function listForIdentity(db: any, identityId: string) {
  const { data: claims, error } = await db
    .from('job_party_claims')
    .select(
      `party_id,
       org_id,
       job_parties!inner (id, access_token, trade, revoked_at, job_id),
       orgs!inner (id, name)`,
    )
    .eq('identity_id', identityId)
    .order('claimed_at', { ascending: false });

  if (error) throw new HttpError(500, 'Could not load your jobs.', 'list_failed');
  const rows = (claims ?? []) as any[];
  if (!rows.length) return { generalContractors: [], today: [] };

  const jobIds = [...new Set(rows.map((r) => r.job_parties.job_id))];
  const { data: jobs } = await db
    .from('crm_jobs')
    .select('id, title, job_number, status, scheduled_start, property_id')
    .in('id', jobIds)
    .is('deleted_at', null);

  const tombstoned = new Set<string>();
  for (const orgId of new Set(rows.map((r) => r.org_id).filter(Boolean) as string[])) {
    for (const id of await listTombstonedJobIds(db, orgId)) tombstoned.add(id);
  }

  const propertyIds = [
    ...new Set(((jobs ?? []) as any[]).map((j) => j.property_id).filter(Boolean)),
  ];
  const { data: properties } = propertyIds.length
    ? await db.from('crm_properties').select('id, address_line1, city').in('id', propertyIds)
    : { data: [] as any[] };

  const jobById = new Map(
    ((jobs ?? []) as any[]).filter((j) => !tombstoned.has(j.id as string)).map((j) => [j.id, j]),
  );
  const propertyById = new Map(((properties ?? []) as any[]).map((p) => [p.id, p]));

  const claimed: ClaimedJobRow[] = rows
    .map((r) => {
      const job = jobById.get(r.job_parties.job_id);
      if (!job) return null;
      const property = job.property_id ? propertyById.get(job.property_id) : null;
      return {
        partyId: r.party_id,
        accessToken: r.job_parties.access_token,
        orgId: r.org_id,
        orgName: r.orgs?.name ?? 'A general contractor',
        jobId: job.id,
        jobTitle: job.title,
        jobNumber: job.job_number ?? null,
        address: property ? [property.address_line1, property.city].filter(Boolean).join(', ') : null,
        scheduledStart: job.scheduled_start ?? null,
        status: job.status ?? null,
        trade: r.job_parties.trade ?? null,
        revoked: Boolean(r.job_parties.revoked_at),
      } satisfies ClaimedJobRow;
    })
    .filter((r): r is ClaimedJobRow => r !== null);

  return {
    generalContractors: groupByGeneralContractor(claimed),
    today: dueToday(claimed, new Date()),
  };
}

async function identityForSession(db: any, header: string | undefined) {
  const token = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Sign in to see your jobs.', 'no_session');

  const { data } = await db
    .from('field_sessions')
    .select('id, identity_id, expires_at, revoked_at, field_identities!inner (id, display_name, channel, address)')
    .eq('token_hash', hashSessionToken(token))
    .maybeSingle();

  if (!data) throw new HttpError(401, 'Sign in again.', 'bad_session');
  if ((data as any).revoked_at) throw new HttpError(401, 'This device was signed out.', 'revoked_session');
  if (new Date((data as any).expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'Sign in again.', 'expired_session');
  }

  await db
    .from('field_sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', (data as any).id);

  return { sessionId: (data as any).id, identity: (data as any).field_identities };
}

/**
 * GET /api/field/jobs
 *
 * One screen, every general contractor. This is the whole point of the
 * feature: the sub standing in front of a house at 7am gets an answer without
 * scrolling eighteen text messages looking for the right link.
 */
fieldIdentityRouter.get(
  '/jobs',
  sessionLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = admin();
      const { identity } = await identityForSession(db, req.headers.authorization);
      const list = await listForIdentity(db, identity.id);
      res.json({
        identity: {
          displayName: identity.display_name,
          contact: displayContact({ channel: identity.channel, address: identity.address }),
          channel: identity.channel,
        },
        ...list,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/field/signout — revoke this device, leaving the claims intact. */
fieldIdentityRouter.post(
  '/signout',
  sessionLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = admin();
      const { sessionId } = await identityForSession(db, req.headers.authorization);
      await db
        .from('field_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', sessionId);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
