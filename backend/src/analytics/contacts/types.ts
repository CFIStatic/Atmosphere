/**
 * Contact sources for Atmosphere Analytics campaigns.
 *
 * A source is anything that can list customer contacts. Stripe is the only
 * live source today. A CRM source is registered but disabled; adding one later
 * means implementing ContactSource and turning it on in the registry. No
 * route, page or campaign code needs to change.
 */

export type ContactSourceId = 'stripe' | 'crm';

/** Best subscription state on the customer, most engaged first. */
export type ContactStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';

export const CONTACT_STATUSES: readonly ContactStatus[] = [
  'active',
  'trialing',
  'past_due',
  'canceled',
  'none',
];

export interface Contact {
  /** Lower-cased, trimmed. The dedupe key across sources. */
  email: string;
  name: string | null;
  company: string | null;
  orgId: string | null;
  /** Plan code (starter, work_verification, scale) or the Stripe price nickname. */
  plan: string | null;
  status: ContactStatus;
  /** ISO timestamp; earliest across sources after a merge. */
  createdAt: string | null;
  sources: ContactSourceId[];
  /** Jettx / test / demo / comp org: hidden unless staff include internal & test accounts. */
  internal?: boolean;
}

export interface ContactSourceInfo {
  id: ContactSourceId;
  label: string;
  enabled: boolean;
  /** Why the source is off, in plain words. Null when enabled. */
  reason: string | null;
  /** Rows the source returned on the last load (null when not loaded). */
  count: number | null;
  /** True when the source hit its row cap and the list is incomplete. */
  truncated: boolean;
}

export interface ContactSourceResult {
  contacts: Contact[];
  truncated: boolean;
}

export interface ContactSource {
  readonly id: ContactSourceId;
  readonly label: string;
  availability(): { enabled: boolean; reason: string | null };
  list(): Promise<ContactSourceResult>;
}

/** Audience filter saved on a campaign. Empty arrays mean "no filter". */
export interface CampaignAudience {
  plans: string[];
  statuses: ContactStatus[];
  sources: ContactSourceId[];
}

export const EMPTY_AUDIENCE: CampaignAudience = { plans: [], statuses: [], sources: [] };
