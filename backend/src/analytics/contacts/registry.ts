import { stripeClient } from '../../lib/stripe.js';
import { unscopedAdminOrNull } from '../../lib/scopedAdmin.js';
import { crmContactSource } from './crmSource.js';
import { createStripeContactSource } from './stripeSource.js';
import {
  CONTACT_STATUSES,
  type CampaignAudience,
  type Contact,
  type ContactSource,
  type ContactSourceId,
  type ContactSourceInfo,
  type ContactStatus,
} from './types.js';
import { betterStatus } from './stripeSource.js';

/** Merge rows that share an email. Non-null fields win; earliest createdAt wins. */
export function dedupeContacts(rows: Contact[]): Contact[] {
  const byEmail = new Map<string, Contact>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email) continue;
    const prev = byEmail.get(email);
    if (!prev) {
      byEmail.set(email, { ...row, email, sources: [...new Set(row.sources)] });
      continue;
    }
    const createdAt =
      prev.createdAt && row.createdAt
        ? prev.createdAt <= row.createdAt
          ? prev.createdAt
          : row.createdAt
        : (prev.createdAt ?? row.createdAt);
    // The plan follows the more engaged subscription.
    const rowWins = betterStatus(prev.status, row.status) !== prev.status;
    byEmail.set(email, {
      email,
      name: prev.name ?? row.name,
      company: prev.company ?? row.company,
      orgId: prev.orgId ?? row.orgId,
      plan: rowWins ? (row.plan ?? prev.plan) : (prev.plan ?? row.plan),
      status: betterStatus(prev.status, row.status),
      createdAt,
      sources: [...new Set([...prev.sources, ...row.sources])],
      internal: Boolean(prev.internal || row.internal),
    });
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** Pure audience filter shared by preview, count and send. */
export function filterContacts(contacts: Contact[], audience: CampaignAudience): Contact[] {
  const plans = new Set(audience.plans.map((p) => p.toLowerCase()));
  const statuses = new Set(audience.statuses);
  const sources = new Set(audience.sources);
  return contacts.filter(
    (c) =>
      (plans.size === 0 || plans.has((c.plan ?? 'none').toLowerCase())) &&
      (statuses.size === 0 || statuses.has(c.status)) &&
      (sources.size === 0 || c.sources.some((s) => sources.has(s))),
  );
}

export function normalizeAudience(input: unknown): CampaignAudience {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 64) : [];
  return {
    plans: [...new Set(list(obj.plans).map((p) => p.trim().toLowerCase()).filter(Boolean))],
    statuses: [
      ...new Set(list(obj.statuses).filter((s): s is ContactStatus => (CONTACT_STATUSES as readonly string[]).includes(s))),
    ],
    sources: [
      ...new Set(list(obj.sources).filter((s): s is ContactSourceId => s === 'stripe' || s === 'crm')),
    ],
  };
}

export interface ContactDirectory {
  contacts: Contact[];
  sources: ContactSourceInfo[];
  fetchedAt: string;
  cached: boolean;
}

export interface ContactRegistry {
  load(opts?: { refresh?: boolean }): Promise<ContactDirectory>;
  clear(): void;
}

export function createContactRegistry(
  sources: ContactSource[],
  opts: { ttlMs?: number; now?: () => number } = {},
): ContactRegistry {
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now;
  let cache: { at: number; value: ContactDirectory } | null = null;
  let inflight: Promise<ContactDirectory> | null = null;

  async function fetchAll(): Promise<ContactDirectory> {
    const infos: ContactSourceInfo[] = [];
    const rows: Contact[] = [];
    for (const source of sources) {
      const { enabled, reason } = source.availability();
      if (!enabled) {
        infos.push({ id: source.id, label: source.label, enabled, reason, count: null, truncated: false });
        continue;
      }
      const result = await source.list();
      rows.push(...result.contacts);
      infos.push({
        id: source.id,
        label: source.label,
        enabled,
        reason,
        count: result.contacts.length,
        truncated: result.truncated,
      });
    }
    return {
      contacts: dedupeContacts(rows),
      sources: infos,
      fetchedAt: new Date(now()).toISOString(),
      cached: false,
    };
  }

  return {
    async load({ refresh = false } = {}) {
      if (!refresh && cache && now() - cache.at < ttl) {
        return { ...cache.value, cached: true };
      }
      inflight ??= fetchAll().finally(() => {
        inflight = null;
      });
      const value = await inflight;
      cache = { at: now(), value };
      return value;
    },
    clear() {
      cache = null;
    },
  };
}

let defaultRegistry: ContactRegistry | null = null;

/** Process-wide registry: Stripe (live) + CRM (disabled). Contacts are not stored. */
export function contactRegistry(): ContactRegistry {
  defaultRegistry ??= createContactRegistry([
    createStripeContactSource({ stripe: stripeClient, admin: unscopedAdminOrNull }),
    crmContactSource,
  ]);
  return defaultRegistry;
}
