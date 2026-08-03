import { activeAlerts, alertCoversTerritory, hoursOfNotice, type WeatherAlert } from './weather.js';

/**
 * Deciding what fires, and who it goes to.
 *
 * Everything expensive or irreversible about a weather campaign is decided
 * here, and the decisions are deliberately conservative in the same direction
 * every time: when in doubt, do not send. An email that goes out a day late
 * costs a lead. An email that goes out to the wrong list, or three times for
 * one storm, costs the relationship — and in this business the relationship is
 * the whole asset.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TriggerConfig {
  /** Which of our weather groups: 'hail', 'wind', 'flood'… */
  groups?: string[];
  /** NWS severities worth acting on. Defaults to the serious ones. */
  severities?: string[];
  /**
   * How much warning the campaign wants. An alert arriving with less notice
   * than this still fires — you would rather reach them late than not at all —
   * but one arriving with *more* does not, because it is too early to be
   * credible and the storm may still miss.
   */
  leadTimeHours?: number;
  /** Days before the same campaign may fire again. Stops a storm mailing twice. */
  cooldownDays?: number;
}

export interface AudienceConfig {
  /** Place categories to include: 'school', 'hospital'… */
  placeCategories?: string[];
  /** Include the org's existing contacts. */
  includeContacts?: boolean;
  /** Restrict everything to one territory. */
  territoryId?: string | null;
  /** Only people whose title contains one of these. */
  titleKeywords?: string[];
}

export interface FireDecision {
  campaignId: string;
  campaignName: string;
  alert: WeatherAlert;
  /** Why this one fired, in words that can go in the audit trail. */
  reason: string;
}

export interface SkipDecision {
  campaignId: string;
  campaignName: string;
  reason: string;
}

const DEFAULT_SEVERITIES = ['Extreme', 'Severe'];
const DEFAULT_LEAD_HOURS = 48;
const DEFAULT_COOLDOWN_DAYS = 14;

/**
 * Which campaigns should go out right now, and which should not.
 *
 * Returns both. A page that only showed what fired would leave somebody
 * staring at a campaign that did nothing during a hail storm with no way to
 * find out why, and "why didn't this send?" is the question that actually gets
 * asked.
 */
export function decideFires(input: {
  campaigns: Array<{
    id: string;
    name: string;
    status: string;
    trigger_kind: string;
    trigger_config: TriggerConfig | null;
    territory_id: string | null;
  }>;
  territories: Array<{ id: string; cities: string[]; counties: string[]; postal_codes: string[] }>;
  alerts: WeatherAlert[];
  /** Alert ids this campaign has already fired on. */
  firedAlertIds: Set<string>;
  /** Most recent fire per campaign, for the cooldown. */
  lastFiredAt: Map<string, Date>;
  now?: Date;
}): { fire: FireDecision[]; skip: SkipDecision[] } {
  const now = input.now ?? new Date();
  const byId = new Map(input.territories.map((t) => [t.id, t]));

  const fire: FireDecision[] = [];
  const skip: SkipDecision[] = [];

  for (const campaign of input.campaigns) {
    if (campaign.trigger_kind !== 'weather') continue;

    if (campaign.status !== 'active') {
      skip.push({ campaignId: campaign.id, campaignName: campaign.name, reason: `Campaign is ${campaign.status}.` });
      continue;
    }

    const cfg = campaign.trigger_config ?? {};
    const groups = cfg.groups ?? [];
    const severities = cfg.severities?.length ? cfg.severities : DEFAULT_SEVERITIES;
    const leadHours = cfg.leadTimeHours ?? DEFAULT_LEAD_HOURS;
    const cooldownDays = cfg.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;

    if (!groups.length) {
      skip.push({ campaignId: campaign.id, campaignName: campaign.name, reason: 'No weather events chosen.' });
      continue;
    }

    // A territory is required, and not defaulting to "everywhere" is the point.
    // An unconfigured campaign that treated a missing territory as the whole
    // state would mail every contact the first time it hailed anywhere.
    const territory = campaign.territory_id ? byId.get(campaign.territory_id) : null;
    if (!territory) {
      skip.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        reason: 'No territory set — a weather campaign must know where it applies.',
      });
      continue;
    }

    const last = input.lastFiredAt.get(campaign.id);
    if (last && (now.getTime() - last.getTime()) / 86_400_000 < cooldownDays) {
      skip.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        reason: `Sent ${Math.round((now.getTime() - last.getTime()) / 86_400_000)} days ago; cooldown is ${cooldownDays}.`,
      });
      continue;
    }

    const match = input.alerts.find((alert) => {
      if (!alert.group || !groups.includes(alert.group)) return false;
      if (!severities.includes(alert.severity)) return false;
      if (input.firedAlertIds.has(`${campaign.id}:${alert.id}`)) return false;
      if (
        !alertCoversTerritory(alert, {
          cities: territory.cities,
          counties: territory.counties,
          postalCodes: territory.postal_codes,
        })
      ) {
        return false;
      }
      // Too early is a real failure mode: a watch issued four days out often
      // misses entirely, and "a storm is coming" that never arrives is the
      // email that gets a sender ignored.
      const notice = hoursOfNotice(alert, now);
      if (notice !== null && notice > leadHours) return false;
      return true;
    });

    if (!match) {
      skip.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        reason: 'No matching alert in this territory right now.',
      });
      continue;
    }

    const notice = hoursOfNotice(match, now);
    fire.push({
      campaignId: campaign.id,
      campaignName: campaign.name,
      alert: match,
      reason:
        notice !== null && notice > 0
          ? `${match.event} for ${match.areaDesc}, about ${Math.round(notice)}h out.`
          : `${match.event} in effect for ${match.areaDesc}.`,
    });
  }

  return { fire, skip };
}

/** One person a campaign would reach, and why they are on the list. */
export interface AudienceMember {
  kind: 'contact' | 'place';
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  title: string | null;
  /** Why they matched — shown so a list can be sanity-checked before sending. */
  why: string;
}

/**
 * Who a campaign would reach, given its rules.
 *
 * Kept as a pure function over already-fetched rows so it can be tested
 * without a database, and so the same code answers both "who would this
 * reach?" in the UI and "who does this reach?" at send time. Those two
 * drifting apart is how somebody previews forty recipients and mails four
 * hundred.
 */
export function buildAudience(input: {
  audience: AudienceConfig;
  contacts: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    title: string | null;
    company_name: string | null;
    postal_code?: string | null;
    city?: string | null;
  }>;
  places: Array<{
    id: string;
    name: string;
    category: string;
    city: string | null;
    postal_code: string | null;
    territory_id: string | null;
    contact_id: string | null;
  }>;
  territory?: { cities: string[]; counties: string[]; postal_codes: string[] } | null;
}): AudienceMember[] {
  const cfg = input.audience ?? {};
  const keywords = (cfg.titleKeywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  const out: AudienceMember[] = [];
  const seenEmails = new Set<string>();

  const titleMatches = (title: string | null): boolean => {
    if (!keywords.length) return true;
    const lower = (title ?? '').toLowerCase();
    return keywords.some((k) => lower.includes(k));
  };

  const inTerritory = (city: string | null | undefined, postal: string | null | undefined): boolean => {
    if (!input.territory) return true;
    const cities = input.territory.cities.map((c) => c.toLowerCase());
    const codes = input.territory.postal_codes;
    if (city && cities.includes(city.toLowerCase())) return true;
    if (postal && codes.includes(postal)) return true;
    return false;
  };

  if (cfg.includeContacts) {
    for (const c of input.contacts) {
      if (!c.email) continue;
      if (!titleMatches(c.title)) continue;
      if (!inTerritory(c.city, c.postal_code)) continue;

      const email = c.email.toLowerCase();
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

      out.push({
        kind: 'contact',
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown',
        email: c.email,
        company: c.company_name,
        title: c.title,
        why: keywords.length ? `${c.title ?? 'Contact'} in your CRM` : 'In your CRM',
      });
    }
  }

  const categories = cfg.placeCategories ?? [];
  if (categories.length) {
    for (const place of input.places) {
      if (!categories.includes(place.category)) continue;
      if (cfg.territoryId && place.territory_id !== cfg.territoryId) continue;
      if (!inTerritory(place.city, place.postal_code)) continue;

      // A place whose contact is already in the CRM came through above with a
      // real name and address; listing the building again would double-count
      // the same relationship.
      if (place.contact_id && cfg.includeContacts) continue;

      out.push({
        kind: 'place',
        id: place.id,
        name: place.name,
        email: null,
        company: place.name,
        title: null,
        why: `${place.category.replace('_', ' ')} in this area — no contact yet`,
      });
    }
  }

  return out;
}

/**
 * Fill a message template.
 *
 * Deliberately tiny: five placeholders, no logic, no loops. A template
 * language in a tool that sends mail on a weather trigger is a way to
 * discover at 3am that a nested conditional produced "Hi ,".
 */
export function renderTemplate(
  template: string,
  vars: {
    firstName?: string | null;
    company?: string | null;
    event?: string | null;
    area?: string | null;
    senderName?: string | null;
  },
): string {
  return template
    // A missing first name becomes "there", which reads as intended rather
    // than as a broken merge field.
    .replace(/\{\{\s*first_name\s*\}\}/gi, vars.firstName?.trim() || 'there')
    .replace(/\{\{\s*company\s*\}\}/gi, vars.company?.trim() || 'your team')
    .replace(/\{\{\s*event\s*\}\}/gi, vars.event?.trim() || 'the forecast')
    .replace(/\{\{\s*area\s*\}\}/gi, vars.area?.trim() || 'your area')
    .replace(/\{\{\s*sender\s*\}\}/gi, vars.senderName?.trim() || '');
}

export { activeAlerts };
