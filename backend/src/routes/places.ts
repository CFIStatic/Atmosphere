import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { config } from '../config.js';

/**
 * Google Places proxy — keeps the Maps/Places API key on the server.
 *
 * Used by office intake so site addresses are real Google-resolved places
 * (street, city, postal) rather than free-typed guesses.
 */

export const placesRouter = Router();
placesRouter.use(requireAuth);

function mapsKey(): string {
  // Prefer a dedicated Maps/Places key — do not reuse the Gemini GOOGLE_API_KEY.
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    config.googleMaps?.apiKey?.trim() ||
    ''
  );
}

function requireMapsKey(): string {
  const key = mapsKey();
  if (!key) {
    throw new HttpError(
      503,
      'Google Maps is not configured. Set GOOGLE_MAPS_API_KEY (Places API enabled).',
      'maps_unconfigured',
    );
  }
  return key;
}

const autocompleteSchema = z.object({
  input: z.string().trim().min(2).max(200),
  sessionToken: z.string().trim().min(8).max(64).optional(),
});

const detailsSchema = z.object({
  placeId: z.string().trim().min(3).max(300),
  sessionToken: z.string().trim().min(8).max(64).optional(),
});

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

function component(
  components: Array<{ longText?: string; shortText?: string; types?: string[] }>,
  type: string,
  short = false,
): string {
  const hit = components.find((c) => (c.types ?? []).includes(type));
  if (!hit) return '';
  return String((short ? hit.shortText : hit.longText) || hit.longText || hit.shortText || '').trim();
}

async function autocompleteNew(
  key: string,
  input: string,
  sessionToken?: string,
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
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
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
  const comps = body.addressComponents ?? [];
  const streetNumber = component(comps, 'street_number');
  const route = component(comps, 'route');
  const line1 = [streetNumber, route].filter(Boolean).join(' ').trim() || body.formattedAddress || '';
  return {
    placeId: placeId.replace(/^places\//, ''),
    formatted: body.formattedAddress || line1,
    addressLine1: line1,
    city:
      component(comps, 'locality') ||
      component(comps, 'postal_town') ||
      component(comps, 'sublocality') ||
      component(comps, 'administrative_area_level_3'),
    postalCode: component(comps, 'postal_code'),
    state: component(comps, 'administrative_area_level_1', true),
    country: component(comps, 'country', true),
    lat: body.location?.latitude ?? null,
    lng: body.location?.longitude ?? null,
  };
}

async function detailsLegacy(
  key: string,
  placeId: string,
  sessionToken?: string,
): Promise<ResolvedAddress> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
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
  const streetNumber = component(comps, 'street_number');
  const route = component(comps, 'route');
  const line1 =
    [streetNumber, route].filter(Boolean).join(' ').trim() || body.result.formatted_address || '';
  return {
    placeId: body.result.place_id || placeId,
    formatted: body.result.formatted_address || line1,
    addressLine1: line1,
    city:
      component(comps, 'locality') ||
      component(comps, 'postal_town') ||
      component(comps, 'sublocality'),
    postalCode: component(comps, 'postal_code'),
    state: component(comps, 'administrative_area_level_1', true),
    country: component(comps, 'country', true),
    lat: body.result.geometry?.location?.lat ?? null,
    lng: body.result.geometry?.location?.lng ?? null,
  };
}

/** GET /api/operations/places/status — whether Maps autocomplete is available. */
placesRouter.get('/places/status', (_req: Request, res: Response) => {
  res.json({ configured: Boolean(mapsKey()) });
});

/** POST /api/operations/places/autocomplete */
placesRouter.post('/places/autocomplete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = requireMapsKey();
    const input = autocompleteSchema.parse(req.body ?? {});
    let suggestions: AddressSuggestion[] = [];
    try {
      suggestions = await autocompleteNew(key, input.input, input.sessionToken);
    } catch (err) {
      console.warn('[places] new autocomplete failed, trying legacy', err);
      suggestions = await autocompleteLegacy(key, input.input, input.sessionToken);
    }
    res.json({ suggestions, configured: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest(err.errors[0]?.message ?? 'Invalid input'));
    next(err);
  }
});

/** POST /api/operations/places/details */
placesRouter.post('/places/details', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = requireMapsKey();
    const input = detailsSchema.parse(req.body ?? {});
    let address: ResolvedAddress;
    try {
      address = await detailsNew(key, input.placeId, input.sessionToken);
    } catch (err) {
      console.warn('[places] new details failed, trying legacy', err);
      address = await detailsLegacy(key, input.placeId, input.sessionToken);
    }
    if (!address.addressLine1) {
      throw badRequest('Google did not return a street address for that place.', 'no_street');
    }
    res.json({ address, configured: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest(err.errors[0]?.message ?? 'Invalid input'));
    next(err);
  }
});
