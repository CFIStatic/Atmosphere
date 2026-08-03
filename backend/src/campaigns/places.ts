import { config } from '../config.js';

/**
 * Finding the buildings worth selling to.
 *
 * A restoration salesperson does not think in leads first — they think in
 * buildings. "Every school in Round Rock", "the clinics off 183", "which
 * senior living places are in my patch". Those are the accounts; the
 * facilities director is just how you reach one.
 *
 * The data comes from OpenStreetMap, and that choice is deliberate. Google
 * Places charges per call and its terms forbid storing results, which makes
 * building a territory list out of it both expensive and against the rules.
 * OSM is open data under ODbL: free to query, free to cache, and attribution
 * is the only obligation — which the UI carries.
 *
 * Two public endpoints, both with etiquette obligations we honour rather than
 * push against, because getting blocked would break the feature for everyone:
 *
 *   Nominatim  turns "Round Rock, TX" into a bounding box. One request per
 *              second, ceiling enforced below, real User-Agent required.
 *   Overpass   returns the places inside that box. Queries are bounded by
 *              area and category and capped, never open-ended.
 */

/** What a salesperson asks for → what OpenStreetMap actually calls it. */
export const PLACE_CATEGORIES: Record<
  string,
  { label: string; blurb: string; tags: Array<[string, string]> }
> = {
  school: {
    label: 'Schools',
    blurb: 'K-12, public and private',
    tags: [['amenity', 'school']],
  },
  university: {
    label: 'Colleges & universities',
    blurb: 'Campuses and community colleges',
    tags: [['amenity', 'college'], ['amenity', 'university']],
  },
  hospital: {
    label: 'Hospitals',
    blurb: 'Full hospitals with inpatient care',
    tags: [['amenity', 'hospital']],
  },
  clinic: {
    label: 'Clinics & medical offices',
    blurb: 'Urgent care, doctors, dentists',
    tags: [['amenity', 'clinic'], ['amenity', 'doctors'], ['amenity', 'dentist']],
  },
  senior_living: {
    label: 'Senior living',
    blurb: 'Nursing homes and assisted living',
    tags: [['amenity', 'nursing_home'], ['social_facility', 'nursing_home'], ['social_facility', 'assisted_living']],
  },
  hotel: {
    label: 'Hotels',
    blurb: 'Hotels and motels',
    tags: [['tourism', 'hotel'], ['tourism', 'motel']],
  },
  church: {
    label: 'Churches & places of worship',
    blurb: 'Often self-managed, and often uninsured for the right things',
    tags: [['amenity', 'place_of_worship']],
  },
  government: {
    label: 'Government buildings',
    blurb: 'City, county and public offices',
    tags: [['amenity', 'townhall'], ['office', 'government']],
  },
  retail: {
    label: 'Retail & shopping centres',
    blurb: 'Malls, supermarkets, big box',
    tags: [['shop', 'mall'], ['shop', 'supermarket'], ['shop', 'department_store']],
  },
  office: {
    label: 'Office buildings',
    blurb: 'Commercial multi-tenant',
    tags: [['building', 'office'], ['office', 'company']],
  },
};

export type PlaceCategory = keyof typeof PLACE_CATEGORIES;

export interface FoundPlace {
  externalId: string;
  category: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  website: string | null;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
  displayName: string;
}

/**
 * Nominatim asks that clients identify themselves and stay under one request
 * per second. Both are conditions of use rather than suggestions, so the
 * spacing is enforced here rather than left to callers to remember.
 */
let lastGeocodeAt = 0;
async function spaceOutGeocoding(): Promise<void> {
  const wait = 1_100 - (Date.now() - lastGeocodeAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocodeAt = Date.now();
}

/** "Round Rock, TX" or "78664" → a box to search inside. */
export async function geocodeArea(query: string): Promise<BoundingBox | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  await spaceOutGeocoding();

  const url = new URL('/search', config.campaigns.nominatimBaseUrl);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  // Restoration companies work one country; without this "Austin" is
  // ambiguous with several places abroad.
  url.searchParams.set('countrycodes', config.campaigns.countryCode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.campaigns.userAgent, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ boundingbox?: string[]; display_name?: string }>;
    const hit = body[0];
    if (!hit?.boundingbox || hit.boundingbox.length < 4) return null;

    // Nominatim orders it [south, north, west, east].
    const [south, north, west, east] = hit.boundingbox.map(Number);
    if (![south, north, west, east].every(Number.isFinite)) return null;

    return { south, west, north, east, displayName: hit.display_name ?? trimmed };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Overpass QL for the requested categories inside one box. */
function overpassQuery(categories: string[], box: BoundingBox, limit: number): string {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  const clauses: string[] = [];

  for (const category of categories) {
    const spec = PLACE_CATEGORIES[category];
    if (!spec) continue;
    for (const [key, value] of spec.tags) {
      // Nodes and ways both: a school is usually a building outline (way),
      // a small clinic is often a single point (node). Asking for one loses
      // roughly half of everything.
      clauses.push(`node["${key}"="${value}"](${bbox});`);
      clauses.push(`way["${key}"="${value}"](${bbox});`);
    }
  }

  if (!clauses.length) return '';
  // `out center` gives a way a single representative coordinate, which is what
  // we store — a full polygon is not useful for a sales list.
  return `[out:json][timeout:${Math.round(config.campaigns.requestTimeoutMs / 1000)}];(${clauses.join('')});out center ${limit};`;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

/** Which of our categories does this element belong to? */
function categoryOf(tags: Record<string, string>, requested: string[]): string | null {
  for (const category of requested) {
    const spec = PLACE_CATEGORIES[category];
    if (!spec) continue;
    if (spec.tags.some(([k, v]) => tags[k] === v)) return category;
  }
  return null;
}

/**
 * Every place of the requested kinds inside an area.
 *
 * Never throws: Overpass is a free, shared, community-run service and it is
 * sometimes busy. An empty list with a reason the caller can show beats an
 * exception that loses a salesperson's search.
 */
export async function findPlaces(
  area: string,
  categories: string[],
  limit = 200,
): Promise<{ places: FoundPlace[]; box: BoundingBox | null; note: string | null }> {
  const wanted = categories.filter((c) => PLACE_CATEGORIES[c]);
  if (!wanted.length) return { places: [], box: null, note: 'Pick at least one kind of place.' };

  const box = await geocodeArea(area);
  if (!box) {
    return { places: [], box: null, note: `Could not find "${area}" on the map.` };
  }

  const query = overpassQuery(wanted, box, Math.min(limit, config.campaigns.maxPlacesPerSearch));
  if (!query) return { places: [], box, note: 'Nothing to search for.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
  try {
    const res = await fetch(config.campaigns.overpassBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': config.campaigns.userAgent,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (res.status === 429 || res.status === 504) {
      return { places: [], box, note: 'The map service is busy right now. Try again in a minute.' };
    }
    if (!res.ok) {
      return { places: [], box, note: `The map service returned ${res.status}.` };
    }

    const body = (await res.json()) as { elements?: OverpassElement[] };
    const places: FoundPlace[] = [];
    const seen = new Set<string>();

    for (const el of body.elements ?? []) {
      const tags = el.tags ?? {};
      const name = tags.name?.trim();
      // A building with no name cannot be put on a list somebody will act on.
      if (!name) continue;

      const category = categoryOf(tags, wanted);
      if (!category) continue;

      const externalId = `${el.type ?? 'node'}/${el.id ?? ''}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);

      places.push({
        externalId,
        category,
        name,
        street: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
        city: tags['addr:city'] ?? null,
        state: tags['addr:state'] ?? null,
        postalCode: tags['addr:postcode'] ?? null,
        lat: el.lat ?? el.center?.lat ?? null,
        lon: el.lon ?? el.center?.lon ?? null,
        phone: tags.phone ?? tags['contact:phone'] ?? null,
        website: tags.website ?? tags['contact:website'] ?? null,
      });
    }

    // Alphabetical: a salesperson works down this list, and OSM's own order is
    // an internal id nobody can reason about.
    places.sort((a, b) => a.name.localeCompare(b.name));

    return {
      places,
      box,
      note: places.length ? null : 'No places of that kind are mapped in that area.',
    };
  } catch {
    return { places: [], box, note: 'The map service did not respond in time.' };
  } finally {
    clearTimeout(timer);
  }
}

/** Attribution is the one obligation ODbL puts on us, so it is not optional. */
export const PLACE_ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';
