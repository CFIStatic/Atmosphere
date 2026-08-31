/**
 * Google Places / Geocoding for job-site addresses.
 *
 * The Maps key stays on the server. Autocomplete and resolve both prefer
 * Google when GOOGLE_MAPS_API_KEY (or GOOGLE_PLACES_API_KEY) is set — OSM
 * is only the no-key fallback, never a silent substitute for a configured
 * Google lookup.
 */

import {
  osmAutocomplete,
  osmDetails,
  type AddressSuggestion,
  type ResolvedAddress,
} from './osmPlaces.js';

export type { AddressSuggestion, ResolvedAddress };

const ADDRESS_TYPES = ['street_address', 'premise', 'subpremise', 'route'] as const;

export function mapsKey(): string {
  // Prefer a dedicated Maps/Places key — do not reuse the Gemini GOOGLE_API_KEY.
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    ''
  );
}

export function placesProvider(): 'google' | 'osm' {
  return mapsKey() ? 'google' : 'osm';
}

function component(
  components: Array<{ longText?: string; shortText?: string; types?: string[] }>,
  type: string,
  short = false,
): string {
  const hit = components.find((c) => (c.types ?? []).includes(type));
  if (!hit) return '';
  return String((short ? hit.shortText : hit.longText) || hit.longText || hit.shortText || '').trim();
}

export function resolvedFromComponents(input: {
  placeId: string;
  formatted: string;
  components: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  lat?: number | null;
  lng?: number | null;
}): ResolvedAddress {
  const streetNumber = component(input.components, 'street_number');
  const route = component(input.components, 'route');
  const line1 =
    [streetNumber, route].filter(Boolean).join(' ').trim() || input.formatted || '';
  return {
    placeId: input.placeId.replace(/^places\//, ''),
    formatted: input.formatted || line1,
    addressLine1: line1,
    city:
      component(input.components, 'locality') ||
      component(input.components, 'postal_town') ||
      component(input.components, 'sublocality') ||
      component(input.components, 'administrative_area_level_3'),
    postalCode: component(input.components, 'postal_code'),
    state: component(input.components, 'administrative_area_level_1', true),
    country: component(input.components, 'country', true),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  };
}

async function autocompleteNew(
  key: string,
  input: string,
  sessionToken?: string,
  includedPrimaryTypes?: readonly string[],
): Promise<AddressSuggestion[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify({
      input,
      includeQueryPredictions: false,
      ...(includedPrimaryTypes?.length ? { includedPrimaryTypes } : {}),
      ...(sessionToken ? { sessionToken } : {}),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`places_new_${res.status}:${errText.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }>;
  };
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: String(p.placeId),
      description: String(p.text?.text || ''),
      mainText: String(p.structuredFormat?.mainText?.text || p.text?.text || ''),
      secondaryText: String(p.structuredFormat?.secondaryText?.text || ''),
    }))
    .slice(0, 8);
}

async function autocompleteLegacy(
  key: string,
  input: string,
  sessionToken?: string,
): Promise<AddressSuggestion[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', input);
  url.searchParams.set('types', 'address');
  url.searchParams.set('key', key);
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`places_legacy_${res.status}`);
  const body = (await res.json()) as {
    status: string;
    predictions?: Array<{
      place_id: string;
      description: string;
      structured_formatting?: { main_text?: string; secondary_text?: string };
    }>;
  };
  if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    throw new Error(`places_legacy_${body.status}`);
  }
  return (body.predictions ?? []).map((p) => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting?.main_text || p.description,
    secondaryText: p.structured_formatting?.secondary_text || '',
  }));
}

export async function googleAutocomplete(
  key: string,
  input: string,
  sessionToken?: string,
): Promise<AddressSuggestion[]> {
  try {
    const typed = await autocompleteNew(key, input, sessionToken, ADDRESS_TYPES);
    if (typed.length) return typed;
  } catch (err) {
    console.warn('[places] new autocomplete (address types) failed', err);
  }
  try {
    const open = await autocompleteNew(key, input, sessionToken);
    if (open.length) return open;
  } catch (err) {
    console.warn('[places] new autocomplete failed, trying legacy', err);
  }
  return autocompleteLegacy(key, input, sessionToken);
}

async function detailsNew(key: string, placeId: string, sessionToken?: string): Promise<ResolvedAddress> {
  const id = placeId.startsWith('places/') ? placeId : `places/${placeId}`;
  const url = new URL(`https://places.googleapis.com/v1/${id}`);
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'id,formattedAddress,addressComponents,location',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`details_new_${res.status}:${errText.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    id?: string;
    formattedAddress?: string;
    addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
    location?: { latitude?: number; longitude?: number };
  };
  return resolvedFromComponents({
    placeId: body.id || placeId,
    formatted: body.formattedAddress || '',
    components: body.addressComponents ?? [],
    lat: body.location?.latitude ?? null,
    lng: body.location?.longitude ?? null,
  });
}

async function detailsLegacy(
  key: string,
  placeId: string,
  sessionToken?: string,
): Promise<ResolvedAddress> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId.replace(/^places\//, ''));
  url.searchParams.set('fields', 'place_id,formatted_address,address_component,geometry');
  url.searchParams.set('key', key);
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`details_legacy_${res.status}`);
  const body = (await res.json()) as {
    status: string;
    result?: {
      place_id?: string;
      formatted_address?: string;
      address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
      geometry?: { location?: { lat: number; lng: number } };
    };
  };
  if (body.status !== 'OK' || !body.result) throw new Error(`details_legacy_${body.status}`);
  const comps = (body.result.address_components ?? []).map((c) => ({
    longText: c.long_name,
    shortText: c.short_name,
    types: c.types,
  }));
  return resolvedFromComponents({
    placeId: body.result.place_id || placeId,
    formatted: body.result.formatted_address || '',
    components: comps,
    lat: body.result.geometry?.location?.lat ?? null,
    lng: body.result.geometry?.location?.lng ?? null,
  });
}

export async function googleDetails(
  key: string,
  placeId: string,
  sessionToken?: string,
): Promise<ResolvedAddress> {
  try {
    return await detailsNew(key, placeId, sessionToken);
  } catch (err) {
    console.warn('[places] new details failed, trying legacy', err);
    return detailsLegacy(key, placeId, sessionToken);
  }
}

export async function googleGeocode(key: string, address: string): Promise<ResolvedAddress> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`geocode_${res.status}`);
  const body = (await res.json()) as {
    status: string;
    results?: Array<{
      place_id?: string;
      formatted_address?: string;
      address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
      geometry?: { location?: { lat: number; lng: number } };
    }>;
  };
  if (body.status !== 'OK' || !body.results?.[0]) throw new Error(`geocode_${body.status}`);
  const hit = body.results[0];
  return resolvedFromComponents({
    placeId: hit.place_id || `geocode:${address.slice(0, 40)}`,
    formatted: hit.formatted_address || address,
    components: (hit.address_components ?? []).map((c) => ({
      longText: c.long_name,
      shortText: c.short_name,
      types: c.types,
    })),
    lat: hit.geometry?.location?.lat ?? null,
    lng: hit.geometry?.location?.lng ?? null,
  });
}

export async function autocompletePlaces(
  input: string,
  sessionToken?: string,
): Promise<{ suggestions: AddressSuggestion[]; provider: 'google' | 'osm' }> {
  const key = mapsKey();
  if (key) {
    return { suggestions: await googleAutocomplete(key, input, sessionToken), provider: 'google' };
  }
  return { suggestions: await osmAutocomplete(input), provider: 'osm' };
}

export async function detailsForPlace(
  placeId: string,
  sessionToken?: string,
): Promise<{ address: ResolvedAddress; provider: 'google' | 'osm' }> {
  if (placeId.startsWith('osm:')) {
    return { address: await osmDetails(placeId), provider: 'osm' };
  }
  const key = mapsKey();
  if (key) {
    return { address: await googleDetails(key, placeId, sessionToken), provider: 'google' };
  }
  return { address: await osmDetails(placeId), provider: 'osm' };
}

/**
 * Turn a typed line (or a place id) into a Google-resolved street when a
 * Maps key is set. Used on Approve so a pasted address still goes through
 * lookup instead of being stored as free text.
 */
export async function resolvePlace(input: {
  query?: string;
  placeId?: string;
  sessionToken?: string;
}): Promise<{ address: ResolvedAddress; provider: 'google' | 'osm' } | null> {
  const placeId = input.placeId?.trim();
  if (placeId) {
    try {
      return await detailsForPlace(placeId, input.sessionToken);
    } catch (err) {
      console.warn('[places] resolve placeId failed', err);
    }
  }
  const query = (input.query ?? '').trim();
  if (query.length < 3) return null;

  const key = mapsKey();
  if (key) {
    try {
      const suggestions = await googleAutocomplete(key, query, input.sessionToken);
      const first = suggestions[0];
      if (first?.placeId) {
        return { address: await googleDetails(key, first.placeId, input.sessionToken), provider: 'google' };
      }
    } catch (err) {
      console.warn('[places] resolve via autocomplete failed', err);
    }
    try {
      return { address: await googleGeocode(key, query), provider: 'google' };
    } catch (err) {
      console.warn('[places] resolve via geocode failed', err);
      return null;
    }
  }

  try {
    const suggestions = await osmAutocomplete(query);
    const first = suggestions[0];
    if (first?.placeId) {
      return { address: await osmDetails(first.placeId), provider: 'osm' };
    }
  } catch (err) {
    console.warn('[places] OSM resolve failed', err);
  }
  return null;
}
