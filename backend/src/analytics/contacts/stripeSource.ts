import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { atmospherePlanCodeForPriceId, isExtraSeatPriceId } from '../../lib/stripe.js';
import type { Contact, ContactSource, ContactSourceResult, ContactStatus } from './types.js';

/**
 * Stripe customers as campaign contacts.
 *
 * Server-side only: the secret key stays in the backend (config.stripe.secretKey)
 * and the browser only ever sees the mapped rows. Read-only; this source never
 * writes to Stripe.
 */

export const STRIPE_CONTACT_CAP = 5_000;

const STATUS_RANK: Record<ContactStatus, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  canceled: 3,
  none: 4,
};

/** Map Stripe's subscription status onto the five the report uses. */
export function contactStatusFromStripe(status: string | null | undefined): ContactStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return 'canceled';
    default:
      return 'none';
  }
}

export function betterStatus(a: ContactStatus, b: ContactStatus): ContactStatus {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;
}

interface SubscriptionLike {
  status?: string | null;
  items?: { data?: Array<{ price?: { id?: string | null; nickname?: string | null } | null }> };
}

function planForSubscription(sub: SubscriptionLike): string | null {
  for (const item of sub.items?.data ?? []) {
    const priceId = item.price?.id ?? null;
    if (!priceId || isExtraSeatPriceId(priceId)) continue;
    const code = atmospherePlanCodeForPriceId(priceId);
    if (code) return code;
    const nickname = item.price?.nickname?.trim();
    if (nickname) return nickname;
  }
  return null;
}

export interface StripeCustomerLike {
  id: string;
  email?: string | null;
  name?: string | null;
  created?: number | null;
  deleted?: boolean;
  metadata?: Record<string, string> | null;
  subscriptions?: { data?: SubscriptionLike[] } | null;
}

/** Pure mapping, exported for tests. Returns null for customers with no usable email. */
export function contactFromStripeCustomer(
  customer: StripeCustomerLike,
  orgNames: Map<string, string>,
): Contact | null {
  if (customer.deleted) return null;
  const email = (customer.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;

  let status: ContactStatus = 'none';
  let plan: string | null = null;
  let planStatus: ContactStatus = 'none';
  for (const sub of customer.subscriptions?.data ?? []) {
    const s = contactStatusFromStripe(sub.status);
    status = betterStatus(status, s);
    const p = planForSubscription(sub);
    if (p && (plan === null || STATUS_RANK[s] < STATUS_RANK[planStatus])) {
      plan = p;
      planStatus = s;
    }
  }

  const orgId = customer.metadata?.org_id?.trim() || null;
  const name = customer.name?.trim() || null;
  return {
    email,
    name,
    company: (orgId && orgNames.get(orgId)) || customer.metadata?.company?.trim() || null,
    orgId,
    plan,
    status,
    createdAt:
      typeof customer.created === 'number'
        ? new Date(customer.created * 1000).toISOString()
        : null,
    sources: ['stripe'],
  };
}

export interface StripeContactSourceDeps {
  stripe: () => Pick<Stripe, 'customers'>;
  /** Service-role client used only to resolve org names from metadata.org_id. */
  admin: () => SupabaseClient | null;
  secretKeyConfigured?: () => boolean;
  cap?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrgNames(admin: SupabaseClient | null, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const valid = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (!admin || valid.length === 0) return names;
  for (let i = 0; i < valid.length; i += 200) {
    const { data, error } = await admin
      .from('orgs')
      .select('id, name')
      .in('id', valid.slice(i, i + 200));
    if (error) {
      console.warn('[analytics-contacts] org name lookup failed:', error.message);
      return names;
    }
    for (const row of (data ?? []) as Array<{ id: string; name: string | null }>) {
      if (row.name) names.set(row.id, row.name);
    }
  }
  return names;
}

export function createStripeContactSource(deps: StripeContactSourceDeps): ContactSource {
  const cap = deps.cap ?? STRIPE_CONTACT_CAP;
  const keyConfigured = deps.secretKeyConfigured ?? (() => Boolean(config.stripe.secretKey));
  return {
    id: 'stripe',
    label: 'Stripe',
    availability() {
      return keyConfigured()
        ? { enabled: true, reason: null }
        : { enabled: false, reason: 'Stripe is not configured on this server.' };
    },
    async list(): Promise<ContactSourceResult> {
      const customers: StripeCustomerLike[] = [];
      let truncated = false;
      const iterator = deps.stripe().customers.list({
        limit: 100,
        expand: ['data.subscriptions'],
      });
      for await (const customer of iterator) {
        if (customers.length >= cap) {
          truncated = true;
          break;
        }
        customers.push(customer as unknown as StripeCustomerLike);
      }
      const orgIds = customers
        .map((c) => c.metadata?.org_id?.trim())
        .filter((id): id is string => Boolean(id));
      const orgNames = await loadOrgNames(deps.admin(), orgIds);
      const contacts = customers
        .map((c) => contactFromStripeCustomer(c, orgNames))
        .filter((c): c is Contact => c !== null);
      return { contacts, truncated };
    },
  };
}
