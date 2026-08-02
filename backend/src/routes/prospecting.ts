import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { billingError } from '../lib/billing.js';
import { config } from '../config.js';
import { buildContactProvider, buildProviderChain, ProviderError } from '../prospecting/index.js';
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
  /** Idempotency: a retried reveal must not bill twice. */
  requestId: z.string().trim().min(8).max(120),
});

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
  const { data } = await supabase
    .from('crm_suppressions')
    .select('kind, value')
    .eq('org_id', orgId);
  const emails = new Set<string>();
  const phones = new Set<string>();
  const domains = new Set<string>();
  for (const row of data ?? []) {
    const value = String(row.value ?? '').toLowerCase();
    if (row.kind === 'email') emails.add(value);
    else if (row.kind === 'phone') phones.add(value.replace(/\D/g, ''));
    else domains.add(value);
  }
  return { emails, phones, domains };
}

/**
 * GET /api/prospecting/status
 * What the UI needs to know before it shows anything: which vendor is
 * answering, whether the data is synthetic, and what a reveal costs.
 */
prospectingRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = buildContactProvider();
    res.json({
      provider: provider.name,
      sandbox: provider.sandbox,
      revealPriceNanos: config.prospecting.revealPriceNanos,
    });
  } catch (err) {
    next(err);
  }
});

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
      const { providerPersonId, requestId } = revealSchema.parse(req.body ?? {});
      const provider = buildContactProvider();

      // Already bought? Hand back what we hold. Charging twice for the same
      // person is the single most corrosive thing a tool like this can do.
      const { data: existing } = await supabase
        .from('crm_prospects')
        .select('*')
        .eq('org_id', orgId)
        .eq('provider_person_id', providerPersonId)
        .maybeSingle();

      if (existing?.revealed_at) {
        res.json({ prospect: camel(existing), charged: false, reason: 'already_revealed' });
        return;
      }

      const suppression = await loadSuppressions(supabase, orgId);

      // Find the person again so the saved row carries their identity even if
      // the vendor holds no contact details for them.
      const found = await provider.search({ q: undefined, limit: 100 });
      const match =
        found.matches.find((m) => m.providerPersonId === providerPersonId) ?? null;

      const domain = (match?.companyDomain ?? existing?.company_domain ?? '').toLowerCase();
      if (domain && suppression.domains.has(domain)) {
        throw new HttpError(
          409,
          'That company is on your do-not-contact list.',
          'suppressed',
        );
      }

      // The waterfall: every configured vendor in turn, then pattern
      // inference against the company domain, everything verified before it
      // is returned. A run that finds nothing charges nothing.
      const knownAddresses = await loadKnownAddresses(supabase, orgId);
      const contact = await runWaterfall(buildProviderChain(), {
        providerPersonId,
        fullName: match?.fullName ?? existing?.full_name ?? '',
        companyDomain: match?.companyDomain ?? existing?.company_domain ?? null,
        knownAddresses,
      });

      if (!contact) {
        throw new HttpError(
          404,
          'No working contact details found for that person — nothing was charged.',
          'no_contact_data',
        );
      }

      if (
        (contact.email && suppression.emails.has(contact.email.toLowerCase())) ||
        (contact.phone && suppression.phones.has(contact.phone.replace(/\D/g, '')))
      ) {
        throw new HttpError(
          409,
          'That contact is on your do-not-contact list — nothing was charged.',
          'suppressed',
        );
      }

      // Charge before writing the details. If the charge fails the customer
      // keeps their credits and we keep no data we were not paid for.
      const price = config.prospecting.revealPriceNanos;
      const { data: receipt, error: chargeError } = await supabase.rpc('charge_feature_credits', {
        p_org: orgId,
        p_feature: 'contact_reveal',
        p_amount_nanos: price,
        p_request_id: requestId,
        p_description: `Contact reveal — ${match?.fullName ?? providerPersonId}`,
        p_cost_nanos: contact.costNanos,
      });
      if (chargeError) throw billingError(chargeError);

      const row = {
        org_id: orgId,
        full_name: match?.fullName ?? existing?.full_name ?? 'Unknown',
        title: match?.title ?? existing?.title ?? null,
        company_name: match?.companyName ?? existing?.company_name ?? null,
        company_domain: match?.companyDomain ?? existing?.company_domain ?? null,
        location: match?.location ?? existing?.location ?? null,
        linkedin_url: match?.linkedinUrl ?? existing?.linkedin_url ?? null,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
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

      if (saved.error) throw new HttpError(400, saved.error.message, 'prospect_save_failed');

      res.status(201).json({
        prospect: camel(saved.data),
        charged: true,
        receipt: receipt ?? null,
        // How it was found and how sure we are — the customer is entitled to
        // know whether they are looking at a vendor match or a verified guess.
        source: contact.source,
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

    const [firstName, ...rest] = String(prospect.full_name ?? '').split(' ');

    const { data: contact, error: contactErr } = await supabase
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

/** Vendor failures arrive as ProviderError and carry their own status. */
prospectingRouter.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof ProviderError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  next(err);
});
