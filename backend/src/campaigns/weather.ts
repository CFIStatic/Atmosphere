import { config } from '../config.js';

/**
 * Weather, as a sales trigger.
 *
 * This is the timing the whole product is built around. Restoration work is
 * not sold on a quarterly cadence — it is sold in the two days before a hail
 * storm, to the facilities director who is about to have a very bad week, and
 * who will call whoever was in front of them. Being early is the entire
 * advantage; a week later they have already picked someone.
 *
 * The source is the National Weather Service API. Free, no key, no rate limit
 * worth the name, and authoritative: these are the same alerts that drive the
 * warnings on the radio. A commercial weather API would cost money to be less
 * official.
 *
 * One thing to be clear-eyed about, because it decides how this is used:
 * warnings are issued in minutes-to-hours, not days. "Two days out" comes from
 * watches and from the forecast, which are less certain by construction. So a
 * campaign carries its own lead time and the UI says plainly what each alert
 * type actually buys you — promising two days of notice on a tornado warning
 * would be a lie the weather itself refuses to tell.
 */

/** The events a restoration company sells against, grouped as they'd say them. */
export const WEATHER_EVENTS: Record<string, { label: string; blurb: string; events: string[] }> = {
  hail: {
    label: 'Hail',
    blurb: 'Roof and siding work. The biggest single driver in Texas.',
    events: ['Severe Thunderstorm Warning', 'Severe Thunderstorm Watch'],
  },
  wind: {
    label: 'High wind',
    blurb: 'Roof damage, downed trees, envelope failures.',
    events: ['High Wind Warning', 'High Wind Watch', 'Wind Advisory'],
  },
  tornado: {
    label: 'Tornado',
    blurb: 'Structural. Minutes of notice, not days.',
    events: ['Tornado Warning', 'Tornado Watch'],
  },
  flood: {
    label: 'Flooding',
    blurb: 'Water mitigation — the fastest work to mobilise on.',
    events: ['Flood Warning', 'Flash Flood Warning', 'Flood Watch', 'Flash Flood Watch'],
  },
  winter: {
    label: 'Freeze & winter storm',
    blurb: 'Burst pipes. The February 2021 event, again.',
    events: ['Winter Storm Warning', 'Winter Storm Watch', 'Ice Storm Warning', 'Hard Freeze Warning', 'Freeze Warning'],
  },
  hurricane: {
    label: 'Hurricane & tropical',
    blurb: 'Days of notice, and the largest single events.',
    events: ['Hurricane Warning', 'Hurricane Watch', 'Tropical Storm Warning', 'Tropical Storm Watch'],
  },
};

export type WeatherGroup = keyof typeof WEATHER_EVENTS;

export interface WeatherAlert {
  /** The NWS identifier. Used to make sure one alert fires a campaign once. */
  id: string;
  event: string;
  /** 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown' */
  severity: string;
  /** 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown' */
  urgency: string;
  certainty: string;
  headline: string | null;
  /** Human list of counties, as the issuing office wrote it. */
  areaDesc: string;
  /** County FIPS codes — the reliable way to match an area. */
  sameCodes: string[];
  /** NWS forecast zones, the other identifier alerts carry. */
  ugcCodes: string[];
  effective: string | null;
  onset: string | null;
  expires: string | null;
  /** Which of our groups this belongs to, when it belongs to one. */
  group: string | null;
}

interface NwsFeature {
  properties?: {
    id?: string;
    event?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    headline?: string;
    areaDesc?: string;
    effective?: string;
    onset?: string;
    expires?: string;
    geocode?: { SAME?: string[]; UGC?: string[] };
  };
}

/** Which of our groups covers this event name? */
export function groupFor(event: string): string | null {
  for (const [key, spec] of Object.entries(WEATHER_EVENTS)) {
    if (spec.events.includes(event)) return key;
  }
  return null;
}

/**
 * Active alerts for a state.
 *
 * Never throws. A weather service outage must not fail a page load; it means
 * no alerts are known right now, which the UI can say honestly.
 */
export async function activeAlerts(stateCode: string): Promise<WeatherAlert[]> {
  const area = stateCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(area)) return [];

  const url = new URL('/alerts/active', config.campaigns.weatherBaseUrl);
  url.searchParams.set('area', area);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        // NWS asks for a contactable User-Agent and returns GeoJSON by default.
        'User-Agent': config.campaigns.userAgent,
        Accept: 'application/geo+json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { features?: NwsFeature[] };
    return (body.features ?? [])
      .map((feature): WeatherAlert | null => {
        const p = feature.properties;
        if (!p?.id || !p.event) return null;
        return {
          id: p.id,
          event: p.event,
          severity: p.severity ?? 'Unknown',
          urgency: p.urgency ?? 'Unknown',
          certainty: p.certainty ?? 'Unknown',
          headline: p.headline ?? null,
          areaDesc: p.areaDesc ?? '',
          sameCodes: p.geocode?.SAME ?? [],
          ugcCodes: p.geocode?.UGC ?? [],
          effective: p.effective ?? null,
          onset: p.onset ?? null,
          expires: p.expires ?? null,
          group: groupFor(p.event),
        };
      })
      .filter((a): a is WeatherAlert => a !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Does this alert cover this territory?
 *
 * Matching is on the words the issuing office used, because a territory is
 * described the way a sales team talks — "Round Rock", "Williamson County",
 * "78664" — and not in FIPS codes anybody would type. `areaDesc` is a
 * semicolon-separated list of county names, which is exactly what a territory
 * already holds.
 *
 * Deliberately conservative: a territory with no area defined matches nothing.
 * The alternative — treating "no area" as "everywhere" — would have an
 * unconfigured territory mail an entire state the first time it hailed.
 */
export function alertCoversTerritory(
  alert: WeatherAlert,
  territory: { cities?: string[] | null; counties?: string[] | null; postalCodes?: string[] | null },
): boolean {
  const counties = (territory.counties ?? []).map((c) => c.toLowerCase().replace(/\s+county$/, '').trim());
  const cities = (territory.cities ?? []).map((c) => c.toLowerCase().trim());
  if (!counties.length && !cities.length) return false;

  const areas = alert.areaDesc
    .split(';')
    .map((a) => a.toLowerCase().replace(/\s+county$/, '').trim())
    .filter(Boolean);
  if (!areas.length) return false;

  // Counties are the unit NWS issues in, so they match directly.
  for (const county of counties) {
    if (county && areas.some((a) => a === county)) return true;
  }
  // Cities are a weaker signal — an alert names counties, not towns — so this
  // only fires when the office happened to name the place itself.
  for (const city of cities) {
    if (city && areas.some((a) => a === city)) return true;
  }
  return false;
}

/**
 * Hours of warning this alert actually gives, from now until it takes effect.
 *
 * Negative means it is already in force. A campaign with a 48-hour lead time
 * wants alerts arriving *before* that window closes, so a warning issued
 * fifteen minutes ahead is not what it is waiting for — and pretending
 * otherwise would send "a storm is coming in two days" while it is raining.
 */
export function hoursOfNotice(alert: WeatherAlert, now = new Date()): number | null {
  const start = alert.onset ?? alert.effective;
  if (!start) return null;
  const at = Date.parse(start);
  if (!Number.isFinite(at)) return null;
  return (at - now.getTime()) / 3_600_000;
}

export const WEATHER_ATTRIBUTION = 'Alerts from the US National Weather Service';
