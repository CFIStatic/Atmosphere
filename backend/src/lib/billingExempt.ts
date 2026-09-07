/**
 * Durable billing bypass for allowlisted emails (founders / comps).
 *
 * `BILLING_EXEMPT_EMAILS` is a comma-separated, case-insensitive list.
 * Default empty — paying customers stay gated. Do not hardcode addresses here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { unscopedAdminOrNull } from './scopedAdmin.js';

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

/** Keep a stored comp unless Stripe reports a live paid status. */
export function retainStoredCompedStatus(
  stored: string | null | undefined,
  nextStatus: string,
): string {
  if (isCompedBillingStatus(stored) && !['active', 'trialing', 'past_due'].includes(nextStatus)) {
    return 'comped';
  }
  return nextStatus;
}

/** Skip Stripe usage invoices for a comped org or an exempt creator. */
export function shouldSkipUsageBilling(input: {
  status?: string | null;
  creatorEmail?: string | null;
  allowlist?: readonly string[];
}): boolean {
  if (isCompedBillingStatus(input.status)) return true;
  return isBillingExemptEmail(input.creatorEmail, input.allowlist ?? billingExemptEmailsFromEnv());
}

export async function loadOrgCreatorEmail(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  // profiles_self is id = auth.uid(); a manager JWT cannot read the creator row.
  const client = unscopedAdminOrNull() ?? supabase;
  const { data: org } = await client.from('orgs').select('created_by').eq('id', orgId).maybeSingle();
  const createdBy = (org as { created_by?: string } | null)?.created_by;
  if (!createdBy) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('email')
    .eq('id', createdBy)
    .maybeSingle();
  return (profile as { email?: string | null } | null)?.email ?? null;
}
