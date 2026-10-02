import type { CampaignAudience, Contact, ContactStatus } from './types';

export const STATUS_LABEL: Record<ContactStatus, string> = {
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Past due',
  canceled: 'Canceled',
  none: 'No subscription',
};

export const STATUSES: ContactStatus[] = ['active', 'trialing', 'past_due', 'canceled', 'none'];

const PLAN_LABEL: Record<string, string> = {
  starter: 'Starter',
  work_verification: 'Work Verification',
  scale: 'Scale',
  none: 'No plan',
};

export function planLabel(plan: string | null | undefined): string {
  if (!plan) return 'No plan';
  return PLAN_LABEL[plan.toLowerCase()] ?? plan;
}

/** Same rules as the backend filterContacts; empty arrays mean "any". */
export function matchesAudience(contact: Contact, audience: CampaignAudience): boolean {
  const plan = (contact.plan ?? 'none').toLowerCase();
  return (
    (audience.plans.length === 0 || audience.plans.includes(plan)) &&
    (audience.statuses.length === 0 || audience.statuses.includes(contact.status)) &&
    (audience.sources.length === 0 || contact.sources.some((s) => audience.sources.includes(s)))
  );
}

export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter((c) =>
    [c.email, c.name, c.company, c.plan].some((field) => (field ?? '').toLowerCase().includes(q)),
  );
}

export function planOptions(contacts: Contact[]): string[] {
  const seen = new Set<string>(['starter', 'work_verification', 'scale']);
  for (const c of contacts) seen.add((c.plan ?? 'none').toLowerCase());
  seen.add('none');
  return [...seen];
}

export function audienceSummary(a: CampaignAudience): string {
  const parts: string[] = [];
  if (a.plans.length) parts.push(a.plans.map((p) => planLabel(p === 'none' ? null : p)).join(', '));
  if (a.statuses.length) parts.push(a.statuses.map((s) => STATUS_LABEL[s]).join(', '));
  if (a.sources.length) parts.push(a.sources.map((s) => (s === 'stripe' ? 'Stripe' : 'CRM')).join(', '));
  return parts.length ? parts.join(' · ') : 'All contacts';
}
