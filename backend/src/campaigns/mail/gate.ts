import { createAdminClient } from '../../lib/supabase.js';
import { screenRecipients, type Recipient, type Screened, type SendPolicy } from './guards.js';

/**
 * Loading everything the send gate needs, once, in one place.
 *
 * `screenRecipients` is the single decision about who gets a message, and it is
 * pure — it is handed the lists and returns a verdict. Which means the lists
 * themselves are the part that can drift, and until now the only caller was the
 * campaign route, so they lived inline in it.
 *
 * A second sender arrived — job updates from the Sales platform — and the
 * tempting thing was to write a second, slightly simpler version. That is how a
 * customer who bounced on a campaign starts receiving job mail, and how an
 * unsubscribe gets honoured on one path and not the other. So this exists
 * instead, and both paths call it.
 *
 * The lists deliberately span the whole org rather than the campaign. Somebody
 * who asked to stop hearing from this company asked the company, not a campaign.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GateLists {
  suppressedEmails: Set<string>;
  suppressedDomains: Set<string>;
  erasedEmails: Set<string>;
  unsubscribed: Set<string>;
  alreadySent: Set<string>;
  hardBounced: Set<string>;
  sentToday: number;
}

/**
 * Every list, for one org.
 *
 * `scope` decides what "already sent" means. A campaign asks about its own
 * prior sends, because re-running it must not send twice; a job update asks
 * about that job's, for the same reason. Neither should see the other's — a
 * customer who got a campaign in March must still be able to receive news that
 * their roof is finished.
 */
export async function loadGateLists(
  supabase: any,
  orgId: string,
  scope: { campaignId?: string; jobId?: string },
): Promise<GateLists> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  let priorQuery = supabase.from('crm_sends').select('email, state').eq('org_id', orgId);
  if (scope.campaignId) priorQuery = priorQuery.eq('campaign_id', scope.campaignId);
  else if (scope.jobId) priorQuery = priorQuery.eq('job_id', scope.jobId);

  const [supp, unsub, priorSends, todayCount, bounced] = await Promise.all([
    supabase.from('crm_suppressions').select('kind, value').eq('org_id', orgId),
    supabase.from('crm_unsubscribes').select('email').eq('org_id', orgId),
    priorQuery,
    // The daily count is the mailbox's, not the campaign's: the provider's
    // ceiling applies to everything leaving that address.
    supabase
      .from('crm_sends')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('state', 'sent')
      .gte('sent_at', midnight.toISOString()),
    // Hard bounces org-wide rather than per-campaign. An address that bounced
    // anywhere is an address that will bounce here, and sending to it again is
    // how a sender ends up on a blocklist.
    supabase.from('crm_sends').select('email').eq('org_id', orgId).eq('state', 'bounced'),
  ]);

  // Global erasure tombstones. They outrank every other list and cross org
  // boundaries — somebody who asked to be forgotten stays forgotten regardless
  // of which customer holds their address.
  const admin = createAdminClient();
  const erasedEmails = new Set<string>();
  if (admin) {
    const { data: erased } = await admin.from('network_erasures').select('email');
    for (const row of (erased ?? []) as any[]) {
      erasedEmails.add(String(row.email).toLowerCase());
    }
  }

  const suppressedEmails = new Set<string>();
  const suppressedDomains = new Set<string>();
  for (const row of (supp.data ?? []) as any[]) {
    const value = String(row.value ?? '').toLowerCase();
    if (row.kind === 'email') suppressedEmails.add(value);
    if (row.kind === 'domain') suppressedDomains.add(value);
  }

  const lower = (rows: any[], field = 'email') =>
    new Set(rows.map((r) => String(r[field] ?? '').toLowerCase()).filter(Boolean));

  return {
    suppressedEmails,
    suppressedDomains,
    erasedEmails,
    unsubscribed: lower((unsub.data ?? []) as any[]),
    alreadySent: lower(((priorSends.data ?? []) as any[]).filter((r) => r.state === 'sent')),
    hardBounced: lower((bounced.data ?? []) as any[]),
    sentToday: todayCount.count ?? 0,
  };
}

/** Screen a set of recipients against freshly loaded lists. */
export async function screenAgainstOrg(
  supabase: any,
  orgId: string,
  input: {
    recipients: Recipient[];
    policy: SendPolicy;
    scope: { campaignId?: string; jobId?: string };
  },
): Promise<Screened & { lists: GateLists }> {
  const lists = await loadGateLists(supabase, orgId, input.scope);
  const screened = screenRecipients({
    recipients: input.recipients,
    ...lists,
    policy: input.policy,
  });
  return { ...screened, lists };
}
