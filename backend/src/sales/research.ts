import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { DiscoveredBusiness } from './types.js';

/**
 * Territory research for the Sales Agent.
 *
 * 1. Geocode the territory with OpenStreetMap Nominatim.
 * 2. Query Overpass for amenity/shop nodes that match the sales focus.
 * 3. Optionally ask Claude to refine / fill gaps when an API key is present.
 * 4. Fall back to a deterministic demo set so the pipeline is always exercisable.
 */

const USER_AGENT = 'AtmosphereSalesAgent/1.0 (outbound research; contact support@atmosphere.app)';

interface GeoPoint {
  lat: number;
  lng: number;
  displayName: string;
  city?: string;
  region?: string;
  country?: string;
}

function focusTokens(salesFocus: string): string[] {
  return salesFocus
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

/** Map common sales-focus phrases onto Overpass amenity/shop tags. */
function overpassFilters(salesFocus: string): string[] {
  const text = salesFocus.toLowerCase();
  const filters: string[] = [];

  const rules: Array<[RegExp, string[]]> = [
    [/propert(?:y|ies)|apartment|condo|multifamily|landlord/, ['"building"="apartments"', '"office"="property_management"', '"office"="estate_agent"']],
    [/restaurant|food|dining|hospitality/, ['"amenity"="restaurant"', '"amenity"="cafe"', '"amenity"="fast_food"']],
    [/hotel|lodging/, ['"tourism"="hotel"', '"tourism"="motel"']],
    [/dental|dentist/, ['"amenity"="dentist"']],
    [/medical|clinic|doctor|physician|health/, ['"amenity"="clinic"', '"amenity"="doctors"', '"amenity"="hospital"']],
    [/law|attorney|legal/, ['"office"="lawyer"']],
    [/insurance|carrier|adjuster/, ['"office"="insurance"']],
    [/construction|contractor|builder|gc\b/, ['"office"="construction_company"', '"craft"="carpenter"']],
    [/retail|store|shop/, ['"shop"']],
    [/gym|fitness/, ['"leisure"="fitness_centre"', '"leisure"="sports_centre"']],
    [/school|education/, ['"amenity"="school"', '"amenity"="college"']],
    [/church|faith|religious/, ['"amenity"="place_of_worship"']],
    [/auto|car\b|dealership/, ['"shop"="car"', '"amenity"="car_repair"']],
  ];

  for (const [re, tags] of rules) {
    if (re.test(text)) filters.push(...tags);
  }

  if (filters.length === 0) {
    filters.push('"office"', '"shop"', '"amenity"="restaurant"');
  }

  return [...new Set(filters)].slice(0, 6);
}

async function geocodeTerritory(territory: string): Promise<GeoPoint | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', territory);
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '1');

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Record<string, any>>;
    const hit = data[0];
    if (!hit) return null;
    const address = hit.address ?? {};
    return {
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      displayName: String(hit.display_name ?? territory),
      city: address.city || address.town || address.village || undefined,
      region: address.state || undefined,
      country: address.country || undefined,
    };
  } catch {
    return null;
  }
}

async function overpassNearby(
  point: GeoPoint,
  salesFocus: string,
  limit = 25,
): Promise<DiscoveredBusiness[]> {
  const filters = overpassFilters(salesFocus);
  // ~3–4 km radius around the geocoded point.
  const radius = 3500;
  const union = filters
    .map((f) => `node[${f}](around:${radius},${point.lat},${point.lng});`)
    .join('\n  ');

  const query = `
[out:json][timeout:25];
(
  ${union}
);
out body ${limit};
`.trim();

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { elements?: Array<Record<string, any>> };
    const elements = data.elements ?? [];
    const tokens = focusTokens(salesFocus);

    const businesses: DiscoveredBusiness[] = [];
    for (const el of elements) {
      const tags = el.tags ?? {};
      const name = tags.name as string | undefined;
      if (!name) continue;

      // Soft relevance: prefer names/tags that mention focus tokens, but keep
      // everything if the filter already targeted the right amenity class.
      const hay = `${name} ${tags.shop ?? ''} ${tags.amenity ?? ''} ${tags.office ?? ''}`.toLowerCase();
      if (tokens.length && !tokens.some((t) => hay.includes(t)) && filters.length > 2) {
        // Still keep — Overpass tag filter is the real gate.
      }

      const website = (tags.website || tags['contact:website'] || null) as string | null;
      const phone = (tags.phone || tags['contact:phone'] || null) as string | null;
      const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');

      businesses.push({
        name,
        category: tags.amenity || tags.shop || tags.office || tags.tourism || salesFocus,
        address: street || null,
        city: tags['addr:city'] || point.city || null,
        region: tags['addr:state'] || point.region || null,
        postalCode: tags['addr:postcode'] || null,
        country: tags['addr:country'] || point.country || null,
        phone,
        websiteUrl: website ? normalizeUrl(website) : null,
        lat: typeof el.lat === 'number' ? el.lat : null,
        lng: typeof el.lon === 'number' ? el.lon : null,
        source: 'overpass',
        sourceRef: el.id != null ? `osm:${el.type ?? 'node'}/${el.id}` : null,
        researchNotes: `Found via OpenStreetMap near ${point.displayName}.`,
      });

      if (businesses.length >= limit) break;
    }
    return businesses;
  } catch {
    return [];
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function demoBusinesses(territory: string, salesFocus: string): DiscoveredBusiness[] {
  const city = territory.split(',')[0]?.trim() || territory;
  const focus = salesFocus.trim();
  const seeds = [
    {
      name: `${city} Premier Properties`,
      category: 'Property management',
      website: `https://example.com/${slug(city)}-premier`,
      titleHint: 'regional property groups',
    },
    {
      name: `${city} Harbor Hospitality Group`,
      category: 'Hospitality',
      website: `https://example.com/${slug(city)}-harbor`,
      titleHint: 'multi-site operators',
    },
    {
      name: `North ${city} Medical Partners`,
      category: 'Healthcare',
      website: `https://example.com/${slug(city)}-medical`,
      titleHint: 'clinic networks',
    },
    {
      name: `${city} Ridge Construction`,
      category: 'General contractor',
      website: `https://example.com/${slug(city)}-ridge`,
      titleHint: 'commercial GCs',
    },
    {
      name: `Summit ${city} Retail Collective`,
      category: 'Retail',
      website: `https://example.com/${slug(city)}-summit`,
      titleHint: 'multi-location retail',
    },
    {
      name: `${city} Lakeside Insurance Agency`,
      category: 'Insurance',
      website: `https://example.com/${slug(city)}-lakeside`,
      titleHint: 'local agencies',
    },
  ];

  return seeds.map((seed, i) => ({
    name: seed.name,
    category: seed.category,
    address: `${100 + i * 12} Main Street`,
    city,
    region: null,
    postalCode: null,
    country: 'United States',
    phone: null,
    websiteUrl: seed.website,
    lat: null,
    lng: null,
    source: 'demo' as const,
    sourceRef: `demo:${i + 1}`,
    researchNotes: `Demo prospect for focus “${focus}” in ${territory}. Targets ${seed.titleHint}.`,
  }));
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function llmEnrich(
  territory: string,
  salesFocus: string,
  existing: DiscoveredBusiness[],
): Promise<DiscoveredBusiness[]> {
  if (!config.anthropic.apiKey) return [];

  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const known = existing
      .slice(0, 15)
      .map((b) => `- ${b.name}${b.websiteUrl ? ` (${b.websiteUrl})` : ''}`)
      .join('\n');

    const message = await client.messages.create({
      model: config.anthropic.defaultModel,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `You help a B2B sales agent find real businesses to prospect.

Territory: ${territory}
Sales focus: ${salesFocus}

Already found:
${known || '(none)'}

Suggest up to 8 ADDITIONAL plausible businesses in this territory matching the focus.
Return ONLY a JSON array of objects with keys:
name, category, address, city, websiteUrl, researchNotes
No markdown. websiteUrl may be null if unknown.`,
        },
      ],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
    return parsed
      .filter((row) => typeof row.name === 'string' && row.name.trim())
      .slice(0, 8)
      .map((row) => ({
        name: String(row.name).trim(),
        category: row.category ? String(row.category) : salesFocus,
        address: row.address ? String(row.address) : null,
        city: row.city ? String(row.city) : null,
        region: null,
        postalCode: null,
        country: null,
        phone: null,
        websiteUrl: row.websiteUrl ? normalizeUrl(String(row.websiteUrl)) : null,
        lat: null,
        lng: null,
        source: 'research' as const,
        sourceRef: null,
        researchNotes: row.researchNotes ? String(row.researchNotes).slice(0, 2000) : null,
      }));
  } catch {
    return [];
  }
}

function dedupe(businesses: DiscoveredBusiness[]): DiscoveredBusiness[] {
  const seen = new Set<string>();
  const out: DiscoveredBusiness[] = [];
  for (const b of businesses) {
    const key = `${b.name.toLowerCase()}|${(b.websiteUrl ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

export interface ResearchOptions {
  forceDemo?: boolean;
  limit?: number;
}

/**
 * Discover businesses in a territory for a given sales focus.
 */
export async function researchBusinesses(
  territory: string,
  salesFocus: string,
  options: ResearchOptions = {},
): Promise<{ businesses: DiscoveredBusiness[]; mode: 'live' | 'demo'; geo: GeoPoint | null }> {
  const forceDemo =
    options.forceDemo === true ||
    process.env.SALES_DEMO_MODE === 'true' ||
    process.env.SALES_DEMO_MODE === '1';

  if (forceDemo) {
    return {
      businesses: demoBusinesses(territory, salesFocus).slice(0, options.limit ?? 25),
      mode: 'demo',
      geo: null,
    };
  }

  const geo = await geocodeTerritory(territory);
  let found: DiscoveredBusiness[] = [];

  if (geo) {
    found = await overpassNearby(geo, salesFocus, options.limit ?? 25);
  }

  const enriched = await llmEnrich(territory, salesFocus, found);
  found = dedupe([...found, ...enriched]);

  if (found.length === 0) {
    return {
      businesses: demoBusinesses(territory, salesFocus).slice(0, options.limit ?? 25),
      mode: 'demo',
      geo,
    };
  }

  return { businesses: found.slice(0, options.limit ?? 40), mode: 'live', geo };
}
