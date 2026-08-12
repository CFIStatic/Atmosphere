/**
 * OpenStreetMap address lookup via Photon (Komoot).
 *
 * Used when GOOGLE_MAPS_API_KEY is unset so job intake still resolves real
 * street addresses — not a mock, not free-typed guesses.
 */

export type AddressSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

export type ResolvedAddress = {
  placeId: string;
  formatted: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  state: string;
  country: string;
  lat: number | null;
  lng: number | null;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    locality?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    countrycode?: string;
  };
};

const PHOTON_SEARCH = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
const USER_AGENT = 'Atmosphere/1.0 (job-intake address lookup; https://atmosphere.app)';

export function lineFromPhoton(props: NonNullable<PhotonFeature['properties']>): string {
  return [props.housenumber, props.street].filter(Boolean).join(' ').trim();
}

export function cityFromPhoton(props: NonNullable<PhotonFeature['properties']>): string {
  return String(props.city || props.locality || props.district || props.county || '').trim();
}

export function formatPhotonAddress(props: NonNullable<PhotonFeature['properties']>): string {
  const line1 = lineFromPhoton(props) || props.name || '';
  const city = cityFromPhoton(props);
  const region = [city, props.state, props.postcode].filter(Boolean).join(', ');
  const country = props.countrycode || props.country || '';
  return [line1, region, country].filter(Boolean).join(', ');
}

export function encodeOsmPlaceId(input: {
  osmType: string;
  osmId: number | string;
  lat: number | null;
  lng: number | null;
}): string {
  const type = String(input.osmType || 'N').slice(0, 1).toUpperCase();
  const lat = input.lat ?? '';
  const lng = input.lng ?? '';
  return `osm:${type}:${input.osmId}:${lng},${lat}`;
}

export function decodeOsmPlaceId(
  placeId: string,
): { osmType: string; osmId: string; lat: number | null; lng: number | null } | null {
  const m = /^osm:([NWR]):(\d+):(-?[\d.]+),(-?[\d.]+)$/i.exec(placeId.trim());
  if (!m) return null;
  const lng = Number(m[3]);
  const lat = Number(m[4]);
  return {
    osmType: m[1]!.toUpperCase(),
    osmId: m[2]!,
    lng: Number.isFinite(lng) ? lng : null,
    lat: Number.isFinite(lat) ? lat : null,
  };
}

export function suggestionFromPhoton(feature: PhotonFeature): AddressSuggestion | null {
  const props = feature.properties;
  const osmId = props?.osm_id;
  if (!props || osmId == null) return null;
  const [lng, lat] = feature.geometry?.coordinates ?? [null, null];
  const line1 = lineFromPhoton(props) || props.name || '';
  if (!line1) return null;
  const city = cityFromPhoton(props);
  const secondary = [city, props.state, props.postcode].filter(Boolean).join(', ');
  return {
    placeId: encodeOsmPlaceId({
      osmType: props.osm_type || 'N',
      osmId,
      lat: typeof lat === 'number' ? lat : null,
      lng: typeof lng === 'number' ? lng : null,
    }),
    description: formatPhotonAddress(props),
    mainText: line1,
    secondaryText: secondary,
  };
}

export function resolvedFromPhoton(feature: PhotonFeature, placeId: string): ResolvedAddress {
  const props = feature.properties ?? {};
  const [lng, lat] = feature.geometry?.coordinates ?? [null, null];
  const line1 = lineFromPhoton(props) || props.name || formatPhotonAddress(props);
  return {
    placeId,
    formatted: formatPhotonAddress(props),
    addressLine1: line1,
    city: cityFromPhoton(props),
    postalCode: String(props.postcode || '').trim(),
    state: String(props.state || '').trim(),
    country: String(props.countrycode || props.country || '').trim(),
    lat: typeof lat === 'number' ? lat : null,
    lng: typeof lng === 'number' ? lng : null,
  };
}

async function photonGet(url: URL): Promise<{ features?: PhotonFeature[] }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`photon_${res.status}`);
  return (await res.json()) as { features?: PhotonFeature[] };
}

export async function osmAutocomplete(input: string): Promise<AddressSuggestion[]> {
  const url = new URL(PHOTON_SEARCH);
  url.searchParams.set('q', input);
  url.searchParams.set('limit', '8');
  url.searchParams.set('lang', 'en');
  const body = await photonGet(url);
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const feature of body.features ?? []) {
    const suggestion = suggestionFromPhoton(feature);
    if (!suggestion || seen.has(suggestion.placeId)) continue;
    seen.add(suggestion.placeId);
    out.push(suggestion);
  }
  return out;
}

export async function osmDetails(placeId: string): Promise<ResolvedAddress> {
  const decoded = decodeOsmPlaceId(placeId);
  if (!decoded || decoded.lat == null || decoded.lng == null) {
    throw new Error('osm_place_invalid');
  }
  const url = new URL(PHOTON_REVERSE);
  url.searchParams.set('lat', String(decoded.lat));
  url.searchParams.set('lon', String(decoded.lng));
  url.searchParams.set('lang', 'en');
  const body = await photonGet(url);
  const feature = body.features?.[0];
  if (!feature) throw new Error('osm_place_not_found');
  return resolvedFromPhoton(feature, placeId);
}
