/**
 * Atmosphere Analytics email campaigns.
 *
 * Drafts live in public.analytics_campaigns behind SECURITY DEFINER RPCs that
 * re-check internal staff scope. Contacts are fetched live from the contact
 * registry (Stripe today) and never stored; only the addresses a campaign was
 * actually sent to are written, in analytics_campaign_sends, with one
 * unsubscribe token each.
 *
 * Sending is OFF unless CAMPAIGN_SENDING_ENABLED=true. Outside production it
 * additionally requires SYSTEM_MAIL_DRIVER=log so a dev or staging box can
 * only ever write to the local .mail/ file sink, never reach a customer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import { translateAnalyticsRpcError } from '../lib/analytics.js';
import { buildCampaignEmail, unsubscribeUrlFor } from './campaignEmail.js';
import { filterContacts, normalizeAudience } from './contacts/registry.js';
import type { CampaignAudience, Contact } from './contacts/types.js';

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  bodyMarkdown: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  recipientCount: number | null;
  sentCount: number | null;
  failedCount: number | null;
  suppressedCount: number | null;
}

export interface CampaignDraftInput {
  name: string;
  subject: string;
  bodyMarkdown: string;
  audience: CampaignAudience;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function mapCampaign(row: Row): Campaign {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    subject: String(row.subject ?? ''),
    bodyMarkdown: String(row.body_markdown ?? ''),
    audience: normalizeAudience(row.audience),
    status: (row.status as CampaignStatus) ?? 'draft',
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    sentAt: (row.sent_at as string | null) ?? null,
    recipientCount: num(row.recipient_count),
    sentCount: num(row.sent_count),
    failedCount: num(row.failed_count),
    suppressedCount: num(row.suppressed_count),
  };
}

function rpcFail(error: { message: string; code?: string }, fallback: string): HttpError {
  if (/campaign_not_editable/.test(error.message)) {
    return new HttpError(409, 'Only draft campaigns can be changed.', 'campaign_not_editable');
  }
  if (/campaign_not_sendable/.test(error.message)) {
    return new HttpError(409, 'This campaign has already been sent or is sending.', 'campaign_not_draft');
  }
  if (/campaign_not_sending/.test(error.message)) {
    return new HttpError(409, 'This campaign is not sending.', 'campaign_not_sending');
  }
  return translateAnalyticsRpcError(error, fallback);
}

export async function listCampaigns(
  supabase: SupabaseClient,
): Promise<{ campaigns: Campaign[]; suppressed: number }> {
  const { data, error } = await supabase.rpc('analytics_campaigns_list');
  if (error) throw rpcFail(error, 'campaigns_failed');
  const payload = (data ?? {}) as { campaigns?: Row[]; suppressed?: number };
  return {
    campaigns: (payload.campaigns ?? []).map(mapCampaign),
    suppressed: Number(payload.suppressed ?? 0),
  };
}

export async function getCampaign(supabase: SupabaseClient, id: string): Promise<Campaign> {
  const { data, error } = await supabase.rpc('analytics_campaign_get', { p_id: id });
  if (error) throw rpcFail(error, 'campaign_failed');
  if (!data) throw new HttpError(404, 'Campaign not found.', 'campaign_not_found');
  return mapCampaign(data as Row);
}

export async function saveCampaign(
  supabase: SupabaseClient,
  id: string | null,
  input: CampaignDraftInput,
): Promise<Campaign> {
  const { data, error } = await supabase.rpc('analytics_campaign_save', {
    p_id: id,
    p_name: input.name,
    p_subject: input.subject,
    p_body: input.bodyMarkdown,
    p_audience: input.audience,
  });
  if (error) throw rpcFail(error, 'campaign_save_failed');
  return mapCampaign(data as Row);
}

export async function deleteCampaign(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('analytics_campaign_delete', { p_id: id });
  if (error) throw rpcFail(error, 'campaign_delete_failed');
  return Boolean(data);
}

export async function suppressedEmails(
  supabase: SupabaseClient,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { data, error } = await supabase.rpc('analytics_email_suppressed', { p_emails: emails });
  if (error) throw rpcFail(error, 'suppressions_failed');
  return new Set(((data ?? []) as string[]).map((e) => e.toLowerCase()));
}

export interface AudienceResolution {
  matched: number;
  suppressed: number;
  recipients: Contact[];
}

/** Audience after filters and suppressions. The count the confirmation shows. */
export async function resolveAudience(
  supabase: SupabaseClient,
  contacts: Contact[],
  audience: CampaignAudience,
): Promise<AudienceResolution> {
  const matched = filterContacts(contacts, audience);
  const suppressed = await suppressedEmails(
    supabase,
    matched.map((c) => c.email),
  );
  const recipients = matched.filter((c) => !suppressed.has(c.email));
  return { matched: matched.length, suppressed: matched.length - recipients.length, recipients };
}

export interface SendGuardEnv {
  CAMPAIGN_SENDING_ENABLED?: string;
  SYSTEM_MAIL_DRIVER?: string;
  CAMPAIGN_POSTAL_ADDRESS?: string;
}

export function campaignSendingEnabled(env: SendGuardEnv = process.env): boolean {
  return (env.CAMPAIGN_SENDING_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** Why sending is blocked right now, or null when it may proceed. */
export function campaignSendBlocker(
  env: SendGuardEnv,
  isProduction: boolean,
): { code: string; message: string } | null {
  if (!campaignSendingEnabled(env)) {
    return {
      code: 'campaign_sending_disabled',
      message: 'Campaign sending is turned off on this server (CAMPAIGN_SENDING_ENABLED is not true).',
    };
  }
  if (!isProduction && (env.SYSTEM_MAIL_DRIVER ?? '').trim().toLowerCase() !== 'log') {
    return {
      code: 'campaign_sending_dev_guard',
      message: 'Outside production, campaigns only send to the local mail log (set SYSTEM_MAIL_DRIVER=log).',
    };
  }
  if (isProduction && !(env.CAMPAIGN_POSTAL_ADDRESS ?? '').trim()) {
    return {
      code: 'campaign_postal_address_missing',
      message: 'Set CAMPAIGN_POSTAL_ADDRESS. Commercial email must include a postal address.',
    };
  }
  return null;
}

export type CampaignMailer = (input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string;
}) => Promise<{ ok: true; providerId?: string | null } | { ok: false; why: string }>;

export interface SendCampaignDeps {
  supabase: SupabaseClient;
  contacts: () => Promise<Contact[]>;
  mailer: CampaignMailer;
  origin: string;
  env: SendGuardEnv;
  isProduction: boolean;
  concurrency?: number;
}

export interface SendCampaignResult {
  campaign: Campaign;
  attempted: number;
  sent: number;
  failed: number;
  suppressed: number;
}

/**
 * Send a draft. Order matters:
 *   1. guard (flag, dev log-sink rule, postal address)
 *   2. resolve the audience server-side and compare with the count the
 *      person confirmed; a mismatch means the list changed under them
 *   3. analytics_campaign_begin_send locks the draft, re-applies suppressions
 *      and hands back one unsubscribe token per address
 *   4. mail each recipient, then analytics_campaign_finish_send records it
 */
export async function sendCampaign(
  deps: SendCampaignDeps,
  campaignId: string,
  confirmRecipientCount: number,
): Promise<SendCampaignResult> {
  const blocker = campaignSendBlocker(deps.env, deps.isProduction);
  if (blocker) throw new HttpError(403, blocker.message, blocker.code);

  const campaign = await getCampaign(deps.supabase, campaignId);
  if (campaign.status !== 'draft') {
    throw new HttpError(409, 'This campaign has already been sent or is sending.', 'campaign_not_draft');
  }
  if (!campaign.subject.trim() || !campaign.bodyMarkdown.trim()) {
    throw new HttpError(400, 'Add a subject and a body before sending.', 'campaign_incomplete');
  }

  const audience = await resolveAudience(deps.supabase, await deps.contacts(), campaign.audience);
  if (audience.recipients.length === 0) {
    throw new HttpError(400, 'This audience has no one to send to.', 'campaign_audience_empty');
  }
  if (audience.recipients.length !== confirmRecipientCount) {
    throw new HttpError(
      409,
      `The audience is now ${audience.recipients.length} recipients, not ${confirmRecipientCount}. Review and confirm again.`,
      'campaign_count_changed',
    );
  }

  const { data: begun, error: beginError } = await deps.supabase.rpc('analytics_campaign_begin_send', {
    p_id: campaignId,
    p_emails: audience.recipients.map((c) => c.email),
  });
  if (beginError) throw rpcFail(beginError, 'campaign_send_failed');
  const start = (begun ?? {}) as {
    recipients?: Array<{ email: string; token: string }>;
    suppressed?: number;
  };
  const recipients = start.recipients ?? [];

  const results: Array<{ email: string; ok: boolean; provider_id: string | null; error: string | null }> = [];
  const postal = deps.env.CAMPAIGN_POSTAL_ADDRESS?.trim() || null;
  let cursor = 0;
  const worker = async () => {
    while (cursor < recipients.length) {
      const r = recipients[cursor++]!;
      const unsubscribeUrl = unsubscribeUrlFor(deps.origin, r.token);
      const email = buildCampaignEmail({
        subject: campaign.subject,
        bodyMarkdown: campaign.bodyMarkdown,
        unsubscribeUrl,
        postalAddress: postal,
      });
      try {
        const sent = await deps.mailer({ to: r.email, ...email, unsubscribeUrl });
        results.push(
          sent.ok
            ? { email: r.email, ok: true, provider_id: sent.providerId ?? null, error: null }
            : { email: r.email, ok: false, provider_id: null, error: sent.why },
        );
      } catch (err) {
        results.push({ email: r.email, ok: false, provider_id: null, error: (err as Error)?.message ?? 'send failed' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, worker));

  const { data: finished, error: finishError } = await deps.supabase.rpc('analytics_campaign_finish_send', {
    p_id: campaignId,
    p_results: results,
  });
  if (finishError) throw rpcFail(finishError, 'campaign_send_failed');

  const sent = results.filter((r) => r.ok).length;
  return {
    campaign: mapCampaign(finished as Row),
    attempted: results.length,
    sent,
    failed: results.length - sent,
    suppressed: audience.suppressed + Number(start.suppressed ?? 0),
  };
}
