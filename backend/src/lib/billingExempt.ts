/**
 * Durable billing bypass for allowlisted emails (founders / comps).
 *
 * `BILLING_EXEMPT_EMAILS` is a comma-separated, case-insensitive list.
 * Default empty — paying customers stay gated. Do not hardcode addresses here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export function parseBillingExemptEmails(value: string | undefined | null): string[] {
  return [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function billingExemptEmailsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseBillingExemptEmails(env.BILLING_EXEMPT_EMAILS);
}

export function normalizeBillingEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export function isBillingExemptEmail(
  email: string | null | undefined,
  allowlist: readonly string[] = billingExemptEmailsFromEnv(),
): boolean {
  const normalized = normalizeBillingEmail(email);
  if (!normalized) return false;
  return allowlist.includes(normalized);
}

export function isCompedBillingStatus(status: string | null | undefined): boolean {
  return String(status ?? '').trim().toLowerCase() === 'comped';
}

/** Founder comps store `comp_jack_<uuid>` (or any non-`sub_…` token) as the subscription id. */
export function isComplimentarySubscriptionId(id: string | null | undefined): boolean {
  const value = String(id ?? '').trim();
  if (!value) return false;
  if (value.startsWith('comp_')) return true;
  return !/^sub_[A-Za-z0-9]+$/.test(value);
}

/** Org should not be charged or shown Stripe Manage/Add controls. */
export function isBillingExemptOrg(input: {
  status?: string | null;
  subscriptionId?: string | null;
  creatorEmail?: string | null;
  actingUserEmail?: string | null;
  allowlist?: readonly string[];
}): boolean {
  const allowlist = input.allowlist ?? billingExemptEmailsFromEnv();
  if (isCompedBillingStatus(input.status)) return true;
  if (isComplimentarySubscriptionId(input.subscriptionId)) return true;
  if (isBillingExemptEmail(input.actingUserEmail, allowlist)) return true;
  return isBillingExemptEmail(input.creatorEmail, allowlist);
}

/** Skip Stripe usage invoices for a comped org or an exempt creator. */
export function shouldSkipUsageBilling(input: {
  status?: string | null;
  creatorEmail?: string | null;
  subscriptionId?: string | null;
  allowlist?: readonly string[];
}): boolean {
  if (isCompedBillingStatus(input.status)) return true;
  if (isComplimentarySubscriptionId(input.subscriptionId)) return true;
  return isBillingExemptEmail(input.creatorEmail, input.allowlist ?? billingExemptEmailsFromEnv());
}

export async function loadOrgCreatorEmail(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data: org } = await supabase.from('orgs').select('created_by').eq('id', orgId).maybeSingle();
  const createdBy = (org as { created_by?: string } | null)?.created_by;
  if (!createdBy) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', createdBy)
    .maybeSingle();
  return (profile as { email?: string | null } | null)?.email ?? null;
}
