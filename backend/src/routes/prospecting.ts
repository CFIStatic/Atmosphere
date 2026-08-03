import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext, requireOrgRole } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { billingError } from '../lib/billing.js';
import { config } from '../config.js';
import {
  buildContactProvider,
  buildProviderChain,
  integrationStatus,
  ProviderError,
} from '../prospecting/index.js';
import { buildMailboxVerifier } from '../prospecting/verifiers/index.js';
import { buildSourceChain } from '../prospecting/sources/index.js';
import { diagnose } from '../prospecting/diagnose.js';
import { buildProfile, type ProfileFact } from '../prospecting/profiler/index.js';
import { createAdminClient } from '../lib/supabase.js';
import { runWaterfall } from '../prospecting/waterfall.js';
import type { KnownAddress } from '../prospecting/patterns.js';

/**
 * Prospecting — finding the people who hand out restoration work.
 *
 * The shape of this router is the business model. Searching is free and
 * returns people without their contact details; revealing one person's email
 * and phone is a fixed credit charge. Everything expensive happens in exactly
 * one handler, and that handler refuses to charge in four situations:
 *
 *   - the person is on the org's suppression list,
 *   - the org already holds this contact (a CRM match — never sell someone
 *     back their own data),
 *   - this prospect was revealed before (serve the saved row again, free),
 *   - the vendor turns out to hold nothing.
 *
 * The charge itself goes through `charge_feature_credits`, which draws down
 * the same credit lots as token usage and writes the same ledger rows, so a
 * reveal appears on the invoice beside everything else the platform did.
 */
export const prospectingRouter = Router();

prospectingRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

// Vendor calls cost money and rate limits are theirs, not ours; this keeps a
// runaway client from spending an org's credits or our quota in a loop.
const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Give it a minute.', code: 'rate_limited' },
});

// Credential tests call out to vendors, so they are throttled harder than
// anything else here: a loop over this endpoint is a loop over their API.
const integrationsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many credential checks. Give it a minute.', code: 'rate_limited' },
});

const revealLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reveals at once. Give it a minute.', code: 'rate_limited' },
});

const text = (max: number) => z.string().trim().max(max).optional();

const searchSchema = z.object({
  q: text(200),
  location: text(120),
  companyDomain: text(200),
  industry: text(120),
  titles: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const revealSchema = z.object({
  providerPersonId: z.string().trim().min(1, 'Which person?').max(200),
});
// Note what is absent: an idempotency key. It used to be supplied by the
// caller, which meant the party being billed chose the only thing telling two
// purchases apart — reuse one key and every later reveal was free. The key is
// now derived from (org, person) inside the handler.

const importSchema = z.object({
  prospectId: z.string().uuid(),
  title: z.string().trim().min(2).max(200).optional(),
  estimatedValue: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

const suppressionSchema = z.object({
  kind: z.enum(['email', 'phone', 'domain']),
  value: z.string().trim().min(1).max(320),
  reason: text(500),
});

function camel(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

/**
 * Addresses this org already holds at any domain, which is what pattern
 * inference learns a company's convention from. It is their own data teaching
 * the tool about their own customers — nothing crosses an org boundary,
 * because RLS would not permit it even if the query tried.
 */
async function loadKnownAddresses(supabase: any, orgId: string): Promise<KnownAddress[]> {
  const [contacts, prospects] = await Promise.all([
    supabase
      .from('crm_contacts')
      .select('first_name, last_name, email')
      .eq('org_id', orgId)
      .not('email', 'is', null)
      .limit(500),
    supabase
      .from('crm_prospects')
      .select('full_name, email')
      .eq('org_id', orgId)
      .not('email', 'is', null)
      .limit(500),
  ]);

  const out: KnownAddress[] = [];
  for (const c of contacts.data ?? []) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
    if (name && c.email) out.push({ email: c.email, fullName: name });
  }
  for (const p of prospects.data ?? []) {
    if (p.full_name && p.email) out.push({ email: p.email, fullName: p.full_name });
  }
  return out;
}

/** Everything the org has said never to contact, in one cheap lookup. */
async function loadSuppressions(supabase: any, orgId: string) {
  const { data, error } = await supabase
    .from('crm_suppressions')
    .select('kind, value')
    .eq('org_id', orgId);
  // Fail closed. An unreadable suppression list must stop a reveal, never
  // quietly permit one: the whole point of the list is that it is obeyed.
  if (error) {
    throw new HttpError(
      503,
      'Could not read your do-not-contact list, so nothing was contacted.',
      'suppression_unavailable',
    );
  }
  const emails = new Set<string>();
  const phones = new Set<string>();
  const domains = new Set<string>();
  for (const row of data ?? []) {
    const value = String(row.value ?? '').toLowerCase();
    if (row.kind === 'email') emails.add(value);
    else if (row.kind === 'phone') phones.add(digits(value));
    else domains.add(value);
  }
  return { emails, phones, domains };
}

/**
 * The last ten digits, which is what makes two writings of one number equal.
 *
 * Plain digit-stripping was not enough once numbers started being normalised
 * to E.164: '(512) 555-0110' becomes '5125550110' and '+15125550110' becomes
 * '15125550110', and comparing those as strings meant a suppressed number
 * stored in one form silently failed to block the same number in the other.
 */
const digits = (value: string) => value.replace(/\D/g, '').slice(-10);

/**
 * Is any part of this contact on the list? Checked against email, landline
 * AND mobile — an earlier version omitted the mobile, which is the number the
 * UI shows first, so a suppressed person could still be called.
 */
function suppressionHit(
  suppression: { emails: Set<string>; phones: Set<string>; domains: Set<string> },
  contact: { email?: string | null; phone?: string | null; mobile?: string | null; domain?: string | null },
): boolean {
  if (contact.domain && suppression.domains.has(contact.domain.toLowerCase())) return true;
  if (contact.email && suppression.emails.has(contact.email.toLowerCase())) return true;
  for (const number of [contact.phone, contact.mobile]) {
    if (number && suppression.phones.has(digits(number))) return true;
  }
  return false;
}

/**
 * Does this org already hold this person as a contact?
 *
 * The header of this file promises we never sell someone back their own data.
 * Until now that promise was kept by the search endpoint annotating a match and
 * the UI greying out a button — which is a hint, not a rule, and a hint does
 * not survive a direct API call. This is the rule.
 *
 * The match is deliberately narrow. Name alone is not identity: there is more
 * than one Marcia Delgado, and refusing to sell the second one because the
 * first is in the CRM would be worse than the duplicate charge it prevents. So
 * the employer has to agree too, by email domain or by company name.
 *
 * A contact holding no email and no phone is not a match either — there is
 * nothing to hand back, and buying the details is exactly what the customer is
 * trying to do.
 */
async function findKnownContact(
  supabase: any,
  orgId: string,
  fullName: string,
  companyDomain: string | null,
  companyName: string | null,
): Promise<Record<string, any> | null> {
  const wanted = fullName.trim().toLowerCase().replace(/\s+/g, ' ');
  const first = wanted.split(' ')[0];
  if (!first) return null;

  const { data, error } = await supabase
    .from('crm_contacts')
    .select('id, first_name, last_name, email, phone, mobile, company_name')
    .eq('org_id', orgId)
    .ilike('first_name', first)
    .limit(50);
  // Fail closed, for the same reason the suppression read does: if we cannot
  // tell whether they already own this person, do not sell them.
  if (error) {
    throw new HttpError(
      503,
      'Could not check your existing contacts, so nothing was charged.',
      'crm_precheck_failed',
    );
  }

  const domain = (companyDomain ?? '').toLowerCase();
  const company = (companyName ?? '').trim().toLowerCase();

  return (
    (data ?? []).find((c: any) => {
      const full = [c.first_name, c.last_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (full !== wanted) return false;
      if (!c.email && !c.phone && !c.mobile) return false;

      const emailDomain = c.email ? String(c.email).toLowerCase().split('@')[1] ?? '' : '';
      const theirCompany = String(c.company_name ?? '').trim().toLowerCase();
      return (
        (Boolean(domain) && emailDomain === domain) ||
        (Boolean(company) && theirCompany === company)
      );
    }) ?? null
  );
}

/**
 * GET /api/prospecting/status
 * What the UI needs to know before it shows anything: which vendor is
 * answering, whether the data is synthetic, and what a reveal costs.
 */
prospectingRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = buildContactProvider();
    const verifier = buildMailboxVerifier();
    res.json({
      provider: provider.name,
      sandbox: provider.sandbox,
      revealPriceNanos: config.prospecting.revealPriceNanos,
      // What is actually confirming addresses, so the UI can stop claiming
      // "verified" in a deployment where nothing verifies anything.
      verifier: verifier?.name ?? null,
      sellUnverified: config.prospecting.sellUnverified,
      sources: buildProviderChain().map((p) => p.name),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/prospecting/integrations?test=1
 * What is plugged in and whether it works. With `test`, makes a real
 * credential call against each — the difference between listing environment
 * variables and telling an operator the truth.
 */
prospectingRouter.get(
  '/integrations',
  integrationsLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Live credential checks reach out to vendors, so they are an
      // owner/admin action rather than something any member can trigger.
      await requireOrgRole(req, ['owner', 'admin']);
      const items = await integrationStatus(req.query.test === '1');
      res.json({
        items,
        mode: config.prospecting.mode,
        sellUnverified: config.prospecting.sellUnverified,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/prospecting/search
 * Free. Returns people without contact details, each annotated with what we
 * already know about them — whether they are suppressed, and whether the CRM
 * already holds them — so the UI can stop a pointless purchase before it
 * happens rather than refunding one afterwards.
 */
prospectingRouter.post(
  '/search',
  searchLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const query = searchSchema.parse(req.body ?? {});
      const provider = buildContactProvider();

      const result = await provider.search(query);
      const suppression = await loadSuppressions(supabase, orgId);

      // One round trip for the whole page of matches rather than one each.
      const domains = [...new Set(result.matches.map((m) => m.companyDomain).filter(Boolean))];
      const names = result.matches.map((m) => m.fullName);

      const [{ data: knownContacts }, { data: knownProspects }] = await Promise.all([
        supabase
          .from('crm_contacts')
          .select('id, first_name, last_name, email, company_name')
          .eq('org_id', orgId)
          .limit(500),
        supabase
          .from('crm_prospects')
          .select('id, provider_person_id, revealed_at, status')
          .eq('org_id', orgId)
          .in('provider_person_id', result.matches.map((m) => m.providerPersonId).slice(0, 100)),
      ]);

      const contactByName = new Map<string, any>();
      for (const c of knownContacts ?? []) {
        const full = [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase();
        if (full) contactByName.set(full, c);
      }
      const savedByPersonId = new Map<string, any>();
      for (const p of knownProspects ?? []) savedByPersonId.set(p.provider_person_id, p);

      const matches = result.matches.map((m) => {
        const saved = savedByPersonId.get(m.providerPersonId) ?? null;
        const known = contactByName.get(m.fullName.toLowerCase()) ?? null;
        const domain = (m.companyDomain ?? '').toLowerCase();
        return {
          ...m,
          /** Already in the CRM — revealing would be selling them their own data. */
          knownContactId: known?.id ?? null,
          /** Already saved (and possibly already paid for). */
          prospectId: saved?.id ?? null,
          revealed: Boolean(saved?.revealed_at),
          suppressed: domain ? suppression.domains.has(domain) : false,
        };
      });

      void names;
      void domains;

      res.json({
        matches,
        total: result.total,
        provider: provider.name,
        sandbox: provider.sandbox,
        revealPriceNanos: config.prospecting.revealPriceNanos,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/prospecting/reveal
 * The only endpoint that spends money. Saves the person first so a charge can
 * always be traced to a row, then charges, then writes the contact details.
 */
prospectingRouter.post(
  '/reveal',
  revealLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const { providerPersonId } = revealSchema.parse(req.body ?? {});
      const provider = buildContactProvider();

      // Already bought? Hand back what we hold. Charging twice for the same
      // person is the single most corrosive thing a tool like this can do.
      const { data: existing, error: existingError } = await supabase
        .from('crm_prospects')
        .select('*')
        .eq('org_id', orgId)
        .eq('provider_person_id', providerPersonId)
        .maybeSingle();
      // Fail closed: if we cannot tell whether this was already bought, do not
      // buy it again on the customer's behalf.
      if (existingError) {
        throw new HttpError(
          503,
          'Could not check whether you already have this contact.',
          'reveal_precheck_failed',
        );
      }

      if (existing?.revealed_at) {
        // Suppression applies to use, not just to purchase: a person added to
        // the list after they were bought must stop being handed out.
        const suppressionNow = await loadSuppressions(supabase, orgId);
        if (
          suppressionHit(suppressionNow, {
            email: existing.email,
            phone: existing.phone,
            mobile: existing.mobile,
            domain: existing.company_domain,
          })
        ) {
          throw new HttpError(
            409,
            'That contact is on your do-not-contact list.',
            'suppressed',
          );
        }
        res.json({ prospect: camel(existing), charged: false, reason: 'already_revealed' });
        return;
      }

      const suppression = await loadSuppressions(supabase, orgId);

      // Identity, resolved BEFORE anything is spent or probed. The saved row
      // first (free), then the provider by id. An unfiltered re-search cannot
      // be relied on to contain the person, and getting this wrong meant the
      // suppression check below silently had nothing to check.
      const match =
        (await provider.getPerson(providerPersonId)) ??
        (existing
          ? {
              providerPersonId,
              fullName: existing.full_name,
              title: existing.title,
              companyName: existing.company_name,
              companyDomain: existing.company_domain,
              location: existing.location,
              linkedinUrl: existing.linkedin_url,
              confidence: existing.confidence,
              hasEmail: false,
              hasPhone: false,
            }
          : null);

      if (!match) {
        throw new HttpError(
          404,
          'That person is no longer available from the provider.',
          'person_not_found',
        );
      }

      // Suppression is evaluated before the waterfall runs, so a suppressed
      // person is never looked up at a vendor and their employer's mail server
      // is never probed on their behalf.
      if (suppressionHit(suppression, { domain: match.companyDomain })) {
        throw new HttpError(
          409,
          'That company is on your do-not-contact list — nothing was charged.',
          'suppressed',
        );
      }

      // Never sell someone back their own data — enforced here, not just
      // hinted at by the search endpoint, because the hint lives in a response
      // the caller is free to ignore.
      const owned = await findKnownContact(
        supabase,
        orgId,
        match.fullName,
        match.companyDomain,
        match.companyName,
      );
      if (owned) {
        throw new HttpError(
          409,
          `${match.fullName} is already in your contacts — nothing was charged.`,
          'already_in_crm',
        );
      }

      // The waterfall: every configured vendor in turn, then pattern
      // inference against the company domain, everything verified before it
      // is returned. A run that finds nothing charges nothing.
      const knownAddresses = await loadKnownAddresses(supabase, orgId);
      const contact = await runWaterfall(buildProviderChain(), {
        providerPersonId,
        fullName: match.fullName,
        companyDomain: match.companyDomain,
        knownAddresses,
        // The free sources go first inside the waterfall. Passing the admin
        // client is what lets the shared network be read at all: the pool is
        // deliberately not tenant-readable, because a direct SELECT over it
        // would hand a customer the database this product sells.
        sources: buildSourceChain(createAdminClient(), orgId),
      });

      if (!contact) {
        throw new HttpError(
          404,
          'No working contact details found for that person — nothing was charged.',
          'no_contact_data',
        );
      }

      if (
        suppressionHit(suppression, {
          email: contact.email,
          phone: contact.phone,
          mobile: contact.mobile,
        })
      ) {
        throw new HttpError(
          409,
          'That contact is on your do-not-contact list — nothing was charged.',
          'suppressed',
        );
      }

      // Charge before writing the details. If the charge fails the customer
      // keeps their credits and we keep no data we were not paid for.
      // The idempotency key is derived, never accepted. Bound to the org and
      // the person, a retry of THIS reveal replays free while a different
      // reveal cannot masquerade as one. The price is looked up in the
      // database by feature name for the same reason.
      const chargeKey = `reveal:${orgId}:${providerPersonId}`;
      const { data: receipt, error: chargeError } = await supabase.rpc('charge_feature_credits', {
        p_org: orgId,
        p_feature: 'contact_reveal',
        p_request_id: chargeKey,
        p_description: `Contact reveal — ${match.fullName}`,
        p_cost_nanos: contact.costNanos,
      });
      if (chargeError) throw billingError(chargeError);

      const price = Number((receipt as any)?.price_nanos ?? 0);
      const alreadyPaid = Boolean((receipt as any)?.duplicate);

      const row = {
        org_id: orgId,
        full_name: match.fullName,
        title: match.title,
        company_name: match.companyName,
        company_domain: match.companyDomain,
        location: match.location,
        linkedin_url: match.linkedinUrl,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        // The labelled record. The two flat columns above stay in step for
        // anything already reading them, but this is what says which number
        // is a desk line and which is somebody's private cell.
        phones: contact.phones,
        provider: contact.source,
        provider_person_id: providerPersonId,
        confidence: contact.confidence,
        status: 'saved' as const,
        revealed_at: new Date().toISOString(),
        revealed_by: userId,
        reveal_cost_nanos: price,
        created_by: userId,
      };

      const saved = existing
        ? await supabase.from('crm_prospects').update(row).eq('id', existing.id).select('*').single()
        : await supabase.from('crm_prospects').insert(row).select('*').single();

      if (saved.error) {
        // The credit is already spent by the time we get here. Saying "save
        // failed" and stopping would leave someone believing they had been
        // charged for nothing, so say what is actually true: the money is
        // recorded, and the retry is free because the idempotency key is
        // (org, person) — the replay returns this same receipt rather than
        // billing a second time.
        throw new HttpError(
          500,
          'We found their details and the charge is recorded, but saving them failed. Try again — the retry costs nothing.',
          'prospect_save_failed',
        );
      }

      res.status(201).json({
        prospect: camel(saved.data),
        charged: !alreadyPaid,
        receipt: receipt ?? null,
        // How it was found and how sure we are — the customer is entitled to
        // know whether they are looking at a vendor match or a verified guess.
        source: contact.source,
        phones: contact.phones,
        verification: contact.verification
          ? {
              verdict: contact.verification.verdict,
              score: contact.verification.score,
              reason: contact.verification.reason,
              catchAll: contact.verification.catchAll,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/prospecting/prospects — everyone this org has saved. */
prospectingRouter.get('/prospects', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('crm_prospects')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new HttpError(500, error.message, 'prospects_failed');
    res.json({ items: (data ?? []).map((r: any) => camel(r)) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/prospecting/import
 * Turns a revealed prospect into a contact and a lead, so the pipeline picks
 * up where prospecting left off without anyone retyping a phone number.
 */
prospectingRouter.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = importSchema.parse(req.body ?? {});

    const { data: prospect, error: readErr } = await supabase
      .from('crm_prospects')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', input.prospectId)
      .maybeSingle();
    if (readErr) throw new HttpError(500, readErr.message, 'prospect_read_failed');
    if (!prospect) throw new HttpError(404, 'Prospect not found.', 'not_found');
    if (prospect.lead_id) {
      throw new HttpError(409, 'That prospect is already on the pipeline.', 'already_imported');
    }
    if (!prospect.revealed_at) {
      throw new HttpError(
        400,
        'Reveal their contact details before adding them to the pipeline.',
        'not_revealed',
      );
    }

    const suppression = await loadSuppressions(supabase, orgId);
    if (
      suppressionHit(suppression, {
        email: prospect.email,
        phone: prospect.phone,
        mobile: prospect.mobile,
        domain: prospect.company_domain,
      })
    ) {
      throw new HttpError(
        409,
        'That contact is on your do-not-contact list and cannot be added.',
        'suppressed',
      );
    }

    const [firstName, ...rest] = String(prospect.full_name ?? '').split(' ');

    // Reuse the contact if this person is already in the CRM rather than
    // creating a second copy of them. Importing the same human twice — from
    // two vendor records, or after someone typed them in by hand — is the
    // ordinary way a CRM fills up with duplicate people, and de-duplicating
    // them later is a job nobody does.
    const { data: matches, error: lookupErr } = prospect.email
      ? await supabase
          .from('crm_contacts')
          .select('*')
          .eq('org_id', orgId)
          .ilike('email', String(prospect.email))
          .limit(1)
      : { data: null, error: null };
    if (lookupErr) throw new HttpError(500, lookupErr.message, 'contact_lookup_failed');

    let contact = (matches ?? [])[0] ?? null;

    if (contact) {
      // They already exist, so fill in only what their record is missing. The
      // reveal was paid for; leaving a blank phone next to a number we now
      // hold would waste it. Nothing already on the record is overwritten.
      const patch: Record<string, any> = {};
      if (!contact.phone && prospect.phone) patch.phone = prospect.phone;
      if (!contact.mobile && prospect.mobile) patch.mobile = prospect.mobile;
      if (!contact.title && prospect.title) patch.title = prospect.title;
      if (!contact.company_name && prospect.company_name) {
        patch.company_name = prospect.company_name;
      }
      if (Object.keys(patch).length) {
        const { data: updated } = await supabase
          .from('crm_contacts')
          .update(patch)
          .eq('id', contact.id)
          .select('*')
          .single();
        if (updated) contact = updated;
      }
    } else {
      const { data: created, error: contactErr } = await supabase
        .from('crm_contacts')
        .insert({
          org_id: orgId,
          created_by: userId,
          first_name: firstName || null,
          last_name: rest.join(' ') || null,
          company_name: prospect.company_name,
          title: prospect.title,
          email: prospect.email,
          phone: prospect.phone,
          mobile: prospect.mobile,
        })
        .select('*')
        .single();
      if (contactErr) throw new HttpError(400, contactErr.message, 'contact_create_failed');
      contact = created;
    }

    const { data: lead, error: leadErr } = await supabase
      .from('crm_leads')
      .insert({
        org_id: orgId,
        created_by: userId,
        contact_id: contact.id,
        title: input.title ?? `${prospect.full_name} — ${prospect.company_name ?? 'new prospect'}`,
        source: 'marketing',
        status: 'new',
        estimated_value: input.estimatedValue ?? null,
        description: prospect.title
          ? `${prospect.title}${prospect.company_name ? ` at ${prospect.company_name}` : ''}.`
          : null,
      })
      .select('*')
      .single();
    if (leadErr) throw new HttpError(400, leadErr.message, 'lead_create_failed');

    await supabase
      .from('crm_prospects')
      .update({ contact_id: contact.id, lead_id: lead.id, status: 'converted' })
      .eq('id', prospect.id);

    res.status(201).json({ contact: camel(contact), lead: camel(lead) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/prospecting/prospects/:id
 * Erasure. A contact-data product without a delete button is not one anybody
 * should run: a person who asks to be removed must actually be removable, and
 * suppressing them at the same time is what stops the next search re-adding
 * them.
 */
prospectingRouter.delete(
  '/prospects/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const suppress = req.query.suppress !== 'false';

      const { data: prospect, error: readErr } = await supabase
        .from('crm_prospects')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (readErr) throw new HttpError(500, readErr.message, 'prospect_read_failed');
      if (!prospect) throw new HttpError(404, 'Prospect not found.', 'not_found');

      // Suppress before deleting, or the row comes straight back on the next
      // search and the erasure means nothing.
      if (suppress) {
        const rows = [
          prospect.email ? { kind: 'email', value: String(prospect.email).toLowerCase() } : null,
          prospect.phone ? { kind: 'phone', value: String(prospect.phone).toLowerCase() } : null,
          prospect.mobile ? { kind: 'phone', value: String(prospect.mobile).toLowerCase() } : null,
        ].filter(Boolean) as Array<{ kind: string; value: string }>;

        if (rows.length) {
          await supabase.from('crm_suppressions').upsert(
            rows.map((r) => ({
              org_id: orgId,
              created_by: userId,
              kind: r.kind,
              value: r.value,
              reason: 'Erased at request',
            })),
            { onConflict: 'org_id,kind,value' },
          );
        }
      }

      // Erasure has to reach the shared pool too, or "remove me" means "remove
      // me from this one organization while every other customer keeps buying
      // me". The tombstone is global and permanent, so a different org syncing
      // its CRM tomorrow cannot quietly undo it.
      let erasedFromNetwork = false;
      if (suppress && prospect.email && config.prospecting.networkEnabled) {
        const admin = createAdminClient();
        if (admin) {
          const { error: eraseError } = await admin.rpc('network_erase', {
            p_email: String(prospect.email).toLowerCase(),
            p_reason: 'Erased at request',
          });
          erasedFromNetwork = !eraseError;
        }
      }

      const { error } = await supabase
        .from('crm_prospects')
        .delete()
        .eq('org_id', orgId)
        .eq('id', req.params.id);
      if (error) throw new HttpError(400, error.message, 'prospect_delete_failed');

      res.json({ ok: true, suppressed: suppress, erasedFromNetwork });
    } catch (err) {
      next(err);
    }
  },
);

/** GET/POST/DELETE suppression — do-not-contact, per organization. */
prospectingRouter.get('/suppressions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('crm_suppressions')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message, 'suppressions_failed');
    res.json({ items: (data ?? []).map((r: any) => camel(r)) });
  } catch (err) {
    next(err);
  }
});

prospectingRouter.post('/suppressions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = suppressionSchema.parse(req.body ?? {});
    const { data, error } = await supabase
      .from('crm_suppressions')
      .upsert(
        {
          org_id: orgId,
          created_by: userId,
          kind: input.kind,
          value: input.value.toLowerCase(),
          reason: input.reason ?? null,
        },
        { onConflict: 'org_id,kind,value' },
      )
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'suppression_failed');
    res.status(201).json({ item: camel(data) });
  } catch (err) {
    next(err);
  }
});

prospectingRouter.delete(
  '/suppressions/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { error } = await supabase
        .from('crm_suppressions')
        .delete()
        .eq('org_id', orgId)
        .eq('id', req.params.id);
      if (error) throw new HttpError(400, error.message, 'suppression_delete_failed');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);


const diagnoseSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  companyDomain: z.string().trim().min(3).max(200),
});

/**
 * POST /api/prospecting/diagnose
 *
 * Runs the whole pipeline against a name and company you choose, and reports
 * what each stage did. Charges nothing and writes nothing.
 *
 * Addresses come back masked, because this runs exactly the machinery a reveal
 * runs — returning them in full would be an unbilled reveal with extra steps.
 * A masked address is still enough to recognise one you already know, which is
 * the point: run it against yourself and you can tell at a glance whether the
 * pipeline found the right answer.
 */
prospectingRouter.post(
  '/diagnose',
  integrationsLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // It spends vendor calls and reveals how the machinery behaves, so it is
      // an operator's tool rather than something any member can run in a loop.
      const { orgId, supabase } = await requireOrgRole(req, ['owner', 'admin']);
      const { fullName, companyDomain } = diagnoseSchema.parse(req.body ?? {});

      const known = await loadKnownAddresses(supabase, orgId);
      const result = await diagnose(
        fullName,
        companyDomain,
        buildSourceChain(createAdminClient(), orgId),
        known,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  companyDomain: z.string().trim().min(3).max(200),
});

/**
 * POST /api/prospecting/profile
 *
 * Professional context on one person before a sales call: their role, how long
 * they have been in it, what their employer does and what it has announced —
 * every item carrying the page it came from.
 *
 * Scope is the point. It reads a company's own public business pages, which is
 * material published for the express purpose of being found by people who want
 * to do business with them. It does not assemble a picture of somebody's
 * private life, and the categories it refuses are listed in the response so
 * the boundary is visible on the screen rather than only in the code.
 */
prospectingRouter.post(
  '/profile',
  searchLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { fullName, companyDomain } = profileSchema.parse(req.body ?? {});

      if (!config.prospecting.profilerEnabled) {
        throw new HttpError(503, 'The profiler is switched off.', 'profiler_disabled');
      }

      // What the org already knows about them beats anything on a website: a
      // colleague's note from a call last March is better context than a bio.
      const crmFacts: ProfileFact[] = [];
      const [firstName, ...rest] = fullName.trim().split(/\s+/);
      const { data: known } = await supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, title, company_name')
        .eq('org_id', orgId)
        .ilike('first_name', firstName)
        .limit(20);

      const lastName = rest.join(' ').toLowerCase();
      const match = (known ?? []).find(
        (c: any) => String(c.last_name ?? '').toLowerCase() === lastName,
      );
      if (match?.title) {
        crmFacts.push({
          label: 'Title',
          value: match.title,
          sourceUrl: `/customers?contact=${match.id}`,
          sourceKind: 'crm',
        });
      }

      const profile = await buildProfile(fullName, companyDomain, crmFacts);
      res.json(profile);
    } catch (err) {
      next(err);
    }
  },
);

/* ---- The shared contact network ----------------------------------------- */

const contributionSchema = z.object({ contributing: z.boolean() });

/**
 * GET /api/prospecting/network
 * Whether this org contributes to the shared pool, and what that means.
 */
prospectingRouter.get('/network', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('network_contribution_settings')
      .select('contributing, decided_at')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'network_settings_failed');

    // Absent row means never decided, which is the same as off — the default
    // is the consent decision, so it is reported as such rather than as null.
    res.json({
      contributing: Boolean(data?.contributing),
      decidedAt: data?.decided_at ?? null,
      enabled: config.prospecting.networkEnabled,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/prospecting/network
 * Opt in or out. Opting out withdraws everything this org ever contributed —
 * an opt-out that left the rows in the pool would not be one.
 */
prospectingRouter.put('/network', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgRole(req, ['owner', 'admin']);
    const { contributing } = contributionSchema.parse(req.body ?? {});

    const { error } = await supabase.from('network_contribution_settings').upsert(
      {
        org_id: orgId,
        contributing,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id' },
    );
    if (error) throw new HttpError(400, error.message, 'network_settings_failed');

    let withdrawn = 0;
    if (!contributing) {
      const admin = createAdminClient();
      if (!admin) {
        // Recording the opt-out but failing to act on it would leave the org
        // believing their data was withdrawn when it was not.
        throw new HttpError(
          503,
          'Opt-out recorded but the pool could not be reached. Contact support so your contributions are withdrawn.',
          'network_withdraw_failed',
        );
      }
      const { data, error: withdrawError } = await admin.rpc('network_withdraw', {
        p_org: orgId,
      });
      if (withdrawError) {
        throw new HttpError(503, 'Could not withdraw your contributions.', 'network_withdraw_failed');
      }
      withdrawn = Number(data ?? 0);
    }

    res.json({ contributing, withdrawn });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/prospecting/network/contribute
 * Push this org's business contacts into the shared pool.
 *
 * Every guard that matters lives in SQL: the opt-in check, the business-address
 * constraint, and the erasure tombstones. This handler is a loop, deliberately,
 * so that no future caller can contribute by taking a different code path.
 */
prospectingRouter.post(
  '/network/contribute',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgRole(req, ['owner', 'admin']);

      const admin = createAdminClient();
      if (!admin) throw new HttpError(503, 'The shared network is unavailable.', 'network_unavailable');

      const { data: contacts, error } = await supabase
        .from('crm_contacts')
        .select('first_name, last_name, email, phone, mobile, title, company_name')
        .eq('org_id', orgId)
        .not('email', 'is', null)
        .limit(1000);
      if (error) throw new HttpError(500, error.message, 'contacts_read_failed');

      let contributed = 0;
      for (const c of contacts ?? []) {
        const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
        if (!fullName || !c.email) continue;
        const { data: ok } = await admin.rpc('network_contribute', {
          p_org: orgId,
          p_email: c.email,
          p_full_name: fullName,
          p_title: c.title ?? null,
          p_company: c.company_name ?? null,
          p_phone: c.phone ?? null,
          p_mobile: c.mobile ?? null,
        });
        if (ok) contributed += 1;
      }

      res.json({ contributed, considered: contacts?.length ?? 0 });
    } catch (err) {
      next(err);
    }
  },
);

// Registered last on purpose. Express walks the stack forward from wherever
// next(err) was called, so an error handler sitting above a route never sees
// that route's failures — which is exactly what happened when the network
// endpoints were appended below it.
/** Vendor failures arrive as ProviderError and carry their own status. */
prospectingRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof ProviderError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  next(err);
});
