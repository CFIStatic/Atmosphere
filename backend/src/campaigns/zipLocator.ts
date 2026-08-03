import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { normaliseZip, zipToState } from './zips.js';

/**
 * Turning ZIP codes into points, once.
 *
 * The expensive half of zips.ts. Geocoding is rate-limited to one request a
 * second by the service's terms, so doing it per request would make a page
 * load take a minute for a territory with sixty ZIPs. Doing it once and
 * keeping the answer makes the second load instant and the hundredth free.
 *
 * Shared across organizations deliberately: where 78664 is does not belong to
 * anybody, and org-scoping it would mean geocoding the same code once per
 * customer to learn the same fact.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ZipPoint {
  zip: string;
  lat: number;
  lon: number;
  state: string | null;
  place: string | null;
}

/** In-process cache in front of the table, for the common repeat within a request. */
const memory = new Map<string, ZipPoint>();

let lastGeocodeAt = 0;
async function spaceOut(): Promise<void> {
  const wait = 1_100 - (Date.now() - lastGeocodeAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeocodeAt = Date.now();
}

/** One ZIP, from the geocoder. Null rather than throwing on anything unusable. */
async function geocodeZip(zip: string): Promise<ZipPoint | null> {
  await spaceOut();

  const url = new URL('/search', config.campaigns.nominatimBaseUrl);
  url.searchParams.set('postalcode', zip);
  url.searchParams.set('country', 'us');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.campaigns.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.campaigns.userAgent, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const hit = body[0];
    if (!hit?.lat || !hit?.lon) return null;

    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      zip,
      lat,
      lon,
      // From the range table rather than the geocoder's prose: it is exact,
      // and it is right even when the geocoder names a neighbouring town.
      state: zipToState(zip),
      place: hit.display_name?.split(',').slice(0, 2).join(',').trim() ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Locate a set of ZIPs, using the cache and geocoding only what is missing.
 *
 * `limit` bounds how many unknown codes one call will geocode. A territory
 * with two hundred new ZIPs would otherwise hold a request open for three
 * minutes; the rest resolve on subsequent calls, and matching degrades to
 * county names in the meantime rather than failing.
 */
export async function locateZips(zips: string[], limit = 12): Promise<Map<string, ZipPoint>> {
  const wanted = [...new Set(zips.map(normaliseZip).filter((z): z is string => Boolean(z)))];
  const found = new Map<string, ZipPoint>();

  const missing: string[] = [];
  for (const zip of wanted) {
    const cached = memory.get(zip);
    if (cached) found.set(zip, cached);
    else missing.push(zip);
  }
  if (!missing.length) return found;

  const admin = createAdminClient();
  if (admin) {
    const { data } = await admin
      .from('zip_centroids')
      .select('zip, lat, lon, state, place')
      .in('zip', missing);

    for (const row of (data ?? []) as any[]) {
      const point: ZipPoint = {
        zip: row.zip,
        lat: row.lat,
        lon: row.lon,
        state: row.state,
        place: row.place,
      };
      memory.set(point.zip, point);
      found.set(point.zip, point);
    }
  }

  const stillMissing = missing.filter((z) => !found.has(z)).slice(0, limit);
  for (const zip of stillMissing) {
    const point = await geocodeZip(zip);
    if (!point) continue;
    memory.set(zip, point);
    found.set(zip, point);

    if (admin) {
      // Shared, so another org asking for the same code never geocodes it.
      await admin.from('zip_centroids').upsert(
        { zip, lat: point.lat, lon: point.lon, state: point.state, place: point.place },
        { onConflict: 'zip' },
      );
    }
  }

  return found;
}
