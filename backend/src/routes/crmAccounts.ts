import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import {
  ancestorsOf,
  subtreeOf,
  reparentProblem,
  mergeProblem,
  findDuplicates,
  describeLink,
  type AccountNode,
} from '../crm/accounts.js';

/**
 * Account structure: hierarchy, relationships, people, and merges.
 *
 * Everything here operates on the shape of the customer list rather than on one
 * customer, which is why it is its own router — and why the two destructive
 * operations both preview before they commit. A reparent that makes a loop and
 * a merge that fuses two real customers are the two ways this feature ruins a
 * database, and both are one click away from something somebody legitimately
 * wants to do.
 */
export const crmAccountsRouter = Router();
crmAccountsRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACCOUNT_SELECT =
  'id, name, type, parent_account_id, merged_into_id, merged_at, city, region, ' +
  'postal_code, phone, email, website, is_archived, created_at';

/** Every account in the org, as the pure functions want them. */
async function allAccounts(supabase: any, orgId: string): Promise<AccountNode[]> {
  const { data } = await supabase
    .from('crm_accounts')
    .select('id, name, type, parent_account_id, merged_into_id')
    .eq('org_id', orgId)
    .limit(5000);
  return ((data ?? []) as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    parentAccountId: a.parent_account_id,
    mergedIntoId: a.merged_into_id,
  }));
}

/**
 * GET /api/crm/accounts/:id/structure
 * One account with everything it is attached to.
 */
crmAccountsRouter.get('/:id/structure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data: account, error } = await supabase
      .from('crm_accounts')
      .select(ACCOUNT_SELECT)
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'account_failed');
    if (!account) throw new HttpError(404, 'No such account.', 'account_not_found');

    const nodes = await allAccounts(supabase, orgId);
    const subtree = subtreeOf(req.params.id, nodes);
    const subtreeIds = subtree.map((s) => s.id);

    const [links, roles, rollup, merges] = await Promise.all([
      supabase
        .from('crm_account_links')
        .select('id, from_account_id, to_account_id, kind, note, started_on, ended_on')
        .eq('org_id', orgId)
        .or(`from_account_id.eq.${req.params.id},to_account_id.eq.${req.params.id}`),
      supabase
        .from('crm_contact_roles')
        .select('id, contact_id, account_id, role, is_primary, started_on, ended_on')
        .eq('org_id', orgId)
        .in('account_id', subtreeIds),
      // Rolled up across the whole subtree, because a management company's own
      // row is empty — the relationship is worth what sits under it.
      supabase
        .from('crm_jobs')
        .select('id, status, contract_amount, invoiced_amount, paid_amount, account_id')
        .eq('org_id', orgId)
        .in('account_id', subtreeIds),
      supabase
        .from('crm_account_merges')
        .select('id, loser_id, moved, merged_at')
        .eq('org_id', orgId)
        .eq('winner_id', req.params.id)
        .order('merged_at', { ascending: false })
        .limit(20),
    ]);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const linkRows = ((links.data ?? []) as any[]).map((link) => {
      const outgoing = link.from_account_id === req.params.id;
      const otherId = outgoing ? link.to_account_id : link.from_account_id;
      const other = byId.get(otherId);
      return {
        id: link.id,
        otherId,
        otherName: other?.name ?? 'Unknown account',
        kind: link.kind,
        direction: outgoing ? ('from' as const) : ('to' as const),
        reads: describeLink(link.kind, outgoing ? 'from' : 'to', other?.name ?? 'that account'),
        note: link.note,
        startedOn: link.started_on,
        endedOn: link.ended_on,
      };
    });

    const contactIds = [...new Set(((roles.data ?? []) as any[]).map((r) => r.contact_id))];
    const { data: contacts } = contactIds.length
      ? await supabase
          .from('crm_contacts')
          .select('id, first_name, last_name, title, email, phone')
          .in('id', contactIds)
      : { data: [] };
    const contactById = new Map(((contacts ?? []) as any[]).map((c) => [c.id, c]));

    const jobs = (rollup.data ?? []) as any[];
    const openStatuses = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

    res.json({
      account: {
        id: (account as any).id,
        name: (account as any).name,
        type: (account as any).type,
        parentAccountId: (account as any).parent_account_id,
        mergedIntoId: (account as any).merged_into_id,
        city: (account as any).city,
        region: (account as any).region,
      },
      // Nearest first, so the UI reads it as a breadcrumb without reversing.
      ancestors: ancestorsOf(req.params.id, nodes).map((a) => ({ id: a.id, name: a.name })),
      children: nodes
        .filter((n) => n.parentAccountId === req.params.id && !n.mergedIntoId)
        .map((n) => ({ id: n.id, name: n.name, type: n.type })),
      subtreeSize: subtree.length,
      links: linkRows,
      people: ((roles.data ?? []) as any[]).map((role) => {
        const contact = contactById.get(role.contact_id);
        return {
          id: role.id,
          contactId: role.contact_id,
          accountId: role.account_id,
          name: contact
            ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Contact'
            : 'Contact',
          title: contact?.title ?? null,
          email: contact?.email ?? null,
          role: role.role,
          isPrimary: role.is_primary,
          endedOn: role.ended_on,
        };
      }),
      rollup: {
        accounts: subtree.length,
        jobs: jobs.length,
        openJobs: jobs.filter((j) => openStatuses.has(j.status)).length,
        contractTotal: jobs.reduce((n, j) => n + Number(j.contract_amount ?? 0), 0),
        invoicedTotal: jobs.reduce((n, j) => n + Number(j.invoiced_amount ?? 0), 0),
        paidTotal: jobs.reduce((n, j) => n + Number(j.paid_amount ?? 0), 0),
        // Told apart on purpose: a parent with nothing of its own and a lot
        // underneath is the normal shape, and reporting zero for it is the bug
        // this whole feature exists to fix.
        ownJobs: jobs.filter((j) => j.account_id === req.params.id).length,
      },
      mergedIn: ((merges.data ?? []) as any[]).map((m) => ({
        id: m.id,
        loserId: m.loser_id,
        loserName: byId.get(m.loser_id)?.name ?? 'a duplicate',
        moved: m.moved,
        mergedAt: m.merged_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/crm/accounts/:id/parent — move an account in the tree. */
crmAccountsRouter.patch('/:id/parent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const input = z
      .object({ parentAccountId: z.string().uuid().nullable() })
      .parse(req.body ?? {});

    const nodes = await allAccounts(supabase, orgId);
    // Checked here so the refusal is a sentence rather than a constraint
    // violation. The trigger checks it again, because this one is advisory.
    const problem = reparentProblem(req.params.id, input.parentAccountId, nodes);
    if (problem) throw new HttpError(409, problem, 'reparent_refused');

    const { error } = await supabase
      .from('crm_accounts')
      .update({ parent_account_id: input.parentAccountId })
      .eq('org_id', orgId)
      .eq('id', req.params.id);
    if (error) throw new HttpError(400, error.message, 'reparent_failed');

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const linkSchema = z.object({
  toAccountId: z.string().uuid(),
  kind: z.enum(['insures', 'manages', 'owns', 'subcontracts_to', 'refers', 'vendor_to', 'related']),
  note: z.string().trim().max(500).nullable().optional(),
  startedOn: z.string().date().nullable().optional(),
});

crmAccountsRouter.post('/:id/links', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = linkSchema.parse(req.body ?? {});
    if (input.toAccountId === req.params.id) {
      throw new HttpError(400, 'An account cannot be linked to itself.', 'self_link');
    }

    const { data, error } = await supabase
      .from('crm_account_links')
      .insert({
        org_id: orgId,
        from_account_id: req.params.id,
        to_account_id: input.toAccountId,
        kind: input.kind,
        note: input.note ?? null,
        started_on: input.startedOn ?? null,
        created_by: userId,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new HttpError(409, 'That link already exists.', 'duplicate_link');
      }
      throw new HttpError(400, error.message, 'link_failed');
    }
    res.status(201).json({ id: (data as any).id });
  } catch (err) {
    next(err);
  }
});

/** Ending a link rather than deleting it: last year's carrier is still a fact. */
crmAccountsRouter.post('/links/:linkId/end', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { error } = await supabase
      .from('crm_account_links')
      .update({ ended_on: new Date().toISOString().slice(0, 10) })
      .eq('org_id', orgId)
      .eq('id', req.params.linkId);
    if (error) throw new HttpError(400, error.message, 'end_link_failed');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/crm/accounts/:id/people — put a contact at this account. */
crmAccountsRouter.post('/:id/people', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const input = z
      .object({
        contactId: z.string().uuid(),
        role: z.string().trim().min(2).max(80).default('contact'),
        isPrimary: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const { error } = await supabase.from('crm_contact_roles').insert({
      org_id: orgId,
      contact_id: input.contactId,
      account_id: req.params.id,
      role: input.role,
      is_primary: input.isPrimary ?? false,
    });
    if (error) {
      if (error.code === '23505') {
        throw new HttpError(409, 'That person already holds that role here.', 'duplicate_role');
      }
      throw new HttpError(400, error.message, 'role_failed');
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/crm/accounts/duplicates
 * Pairs that look like the same company.
 *
 * Suggestions only. Nothing merges automatically off a name comparison — "Cedar
 * Ridge" and "Cedar Grove" are two streets apart and two different customers,
 * and fusing them has no undo.
 */
crmAccountsRouter.get('/duplicates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data } = await supabase
      .from('crm_accounts')
      .select('id, name, type, parent_account_id, merged_into_id, created_at')
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .limit(2000);

    const rows = (data ?? []) as any[];
    // "Attached" decides which record people have actually been using, which is
    // the only signal that reliably picks the right survivor.
    const [jobs, contacts] = await Promise.all([
      supabase.from('crm_jobs').select('account_id').eq('org_id', orgId).limit(10_000),
      supabase.from('crm_contacts').select('account_id').eq('org_id', orgId).limit(10_000),
    ]);
    const attached = new Map<string, number>();
    for (const row of [...((jobs.data ?? []) as any[]), ...((contacts.data ?? []) as any[])]) {
      if (!row.account_id) continue;
      attached.set(row.account_id, (attached.get(row.account_id) ?? 0) + 1);
    }

    const pairs = findDuplicates(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        parentAccountId: r.parent_account_id,
        mergedIntoId: r.merged_into_id,
        createdAt: r.created_at,
        attached: attached.get(r.id) ?? 0,
      })),
    );

    res.json({
      pairs: pairs.map((pair) => ({
        score: Math.round(pair.score * 100),
        suggestedWinner: pair.suggestedWinner,
        a: { id: pair.a.id, name: pair.a.name, attached: attached.get(pair.a.id) ?? 0 },
        b: { id: pair.b.id, name: pair.b.name, attached: attached.get(pair.b.id) ?? 0 },
      })),
    });
  } catch (err) {
    next(err);
  }
});

const MOVED_TABLES: Array<{ table: string; column: string; key: keyof MergeCounts }> = [
  { table: 'crm_contacts', column: 'account_id', key: 'contacts' },
  { table: 'crm_jobs', column: 'account_id', key: 'jobs' },
  { table: 'crm_leads', column: 'account_id', key: 'leads' },
  { table: 'crm_properties', column: 'account_id', key: 'properties' },
  { table: 'crm_activities', column: 'account_id', key: 'activities' },
];

interface MergeCounts {
  contacts: number;
  jobs: number;
  leads: number;
  properties: number;
  activities: number;
  childAccounts: number;
}

/**
 * POST /api/crm/accounts/merge
 * Fold one account into another.
 *
 * Two-step by construction: without `confirm` it reports exactly what would
 * move and changes nothing. This is not a courtesy — a merge repoints hundreds
 * of records and there is no one-click way back, so the count has to be visible
 * before the button rather than after.
 *
 * The loser is never deleted. It stays as a tombstone pointing at the winner,
 * so a bookmark, an export or a stale integration id still resolves to the
 * right customer instead of vanishing.
 */
crmAccountsRouter.post('/merge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = z
      .object({
        winnerId: z.string().uuid(),
        loserId: z.string().uuid(),
        confirm: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const nodes = await allAccounts(supabase, orgId);
    const problem = mergeProblem(input.winnerId, input.loserId, nodes);
    if (problem) throw new HttpError(409, problem, 'merge_refused');

    const counts: MergeCounts = {
      contacts: 0,
      jobs: 0,
      leads: 0,
      properties: 0,
      activities: 0,
      childAccounts: nodes.filter((n) => n.parentAccountId === input.loserId).length,
    };

    for (const target of MOVED_TABLES) {
      const { count } = await supabase
        .from(target.table)
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq(target.column, input.loserId);
      counts[target.key] = count ?? 0;
    }

    const winner = nodes.find((n) => n.id === input.winnerId)!;
    const loser = nodes.find((n) => n.id === input.loserId)!;

    if (!input.confirm) {
      res.json({
        dryRun: true,
        winner: { id: winner.id, name: winner.name },
        loser: { id: loser.id, name: loser.name },
        moved: counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      });
      return;
    }

    // Repoint everything, then tombstone. In that order: a failure part way
    // through leaves records on a live account rather than orphaned behind a
    // tombstone nobody can see.
    for (const target of MOVED_TABLES) {
      const { error } = await supabase
        .from(target.table)
        .update({ [target.column]: input.winnerId })
        .eq('org_id', orgId)
        .eq(target.column, input.loserId);
      if (error) throw new HttpError(400, `Could not move ${target.table}: ${error.message}`, 'merge_failed');
    }

    // Children come across too, or they are stranded under a tombstone.
    await supabase
      .from('crm_accounts')
      .update({ parent_account_id: input.winnerId })
      .eq('org_id', orgId)
      .eq('parent_account_id', input.loserId);

    const { data: snapshot } = await supabase
      .from('crm_accounts')
      .select('*')
      .eq('id', input.loserId)
      .maybeSingle();

    const { error: tombError } = await supabase
      .from('crm_accounts')
      .update({
        merged_into_id: input.winnerId,
        merged_at: new Date().toISOString(),
        is_archived: true,
        // Cleared so the tombstone cannot sit in the middle of somebody's tree.
        parent_account_id: null,
      })
      .eq('org_id', orgId)
      .eq('id', input.loserId);
    if (tombError) throw new HttpError(400, tombError.message, 'merge_failed');

    await supabase.from('crm_account_merges').insert({
      org_id: orgId,
      winner_id: input.winnerId,
      loser_id: input.loserId,
      moved: counts,
      loser_snapshot: snapshot ?? null,
      merged_by: userId,
    });

    res.json({
      dryRun: false,
      moved: counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    next(err);
  }
});
