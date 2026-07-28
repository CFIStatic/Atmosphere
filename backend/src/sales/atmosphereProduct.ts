/**
 * Atmosphere internal GTM — product messaging + ICP defaults.
 *
 * This outreach pipeline is for Atmosphere's own sales team: market our
 * platform to restoration and construction companies, automate outbound, and
 * book product demos so reps spend the day closing.
 */

/** Short product one-liner used in emails and research prompts. */
export const ATMOSPHERE_PRODUCT_NAME = 'Atmosphere';

export const ATMOSPHERE_PRODUCT_BLURB =
  'Atmosphere is an AI platform for restoration and construction companies — ' +
  'mitigation & rebuild estimators, computer use, carrier/supplier web access, ' +
  'technician field tools, CRM, and an audit trail so every agent action is replayable.';

/** Default ICP / sales focus when the rep leaves it blank or starts a new campaign. */
export const DEFAULT_SALES_FOCUS =
  'Restoration & construction companies — mitigation, water/fire/mold, rebuild GCs';

/** Default value prop pitched in outreach when the campaign does not override it. */
export const DEFAULT_VALUE_PROP =
  'Atmosphere helps restoration and construction teams estimate faster, operate ' +
  'carrier and supplier portals with AI, run field tech workflows, and keep a full ' +
  'audit trail — so your people spend time closing and delivering work, not fighting software.';

/** Soft CTA language: product demo / walkthrough, not generic "in-person chat". */
export const DEMO_CTA =
  'a short product demo (live walkthrough of estimators, web access, and the field tools)';

export const DEFAULT_SENDER_ORG = 'Atmosphere';

export const DEFAULT_SENDER_NAME = 'Atmosphere Sales';

/** Meeting titles / ICS descriptions for booked demos. */
export function demoMeetingTitle(businessName?: string | null): string {
  const who = businessName?.trim() || 'your team';
  return `Atmosphere product demo — ${who}`;
}

export function demoMeetingDescription(salesFocus: string): string {
  return (
    `Atmosphere product demo for ${salesFocus}. ` +
    'Booked by the Atmosphere internal outreach pipeline. ' +
    "We'll show estimators, web access, technician tools, and how the audit trail works."
  );
}

/**
 * Preferred buyer titles when researching decision-makers at restoration /
 * construction firms.
 */
export const ICP_BUYER_TITLES = [
  'Owner',
  'President',
  'CEO',
  'COO',
  'VP Operations',
  'Director of Operations',
  'General Manager',
  'Sales Manager',
  'Estimator Manager',
  'Office Manager',
] as const;

/**
 * People-search starter queries tuned for Atmosphere's buyers.
 */
export const PEOPLE_SEARCH_EXAMPLES = [
  'owner of a water mitigation company in Dallas',
  'CEO of a restoration contractor in Phoenix',
  'VP of operations at a fire restoration company in Houston',
  'general manager at a mold remediation firm in Tampa',
] as const;

/**
 * Resolve campaign messaging: use campaign overrides when set, otherwise
 * Atmosphere product defaults so every outreach email pitches us.
 */
export function resolveCampaignMessaging(input: {
  salesFocus?: string | null;
  valueProp?: string | null;
  senderName?: string | null;
  senderOrg?: string | null;
}): {
  salesFocus: string;
  valueProp: string;
  senderName: string;
  senderOrg: string;
} {
  return {
    salesFocus: input.salesFocus?.trim() || DEFAULT_SALES_FOCUS,
    valueProp: input.valueProp?.trim() || DEFAULT_VALUE_PROP,
    senderName: input.senderName?.trim() || DEFAULT_SENDER_NAME,
    senderOrg: input.senderOrg?.trim() || DEFAULT_SENDER_ORG,
  };
}
