import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest } from '../lib/errors.js';
import {
  autocompletePlaces,
  detailsForPlace,
  placesProvider,
  resolvePlace,
  type AddressSuggestion,
  type ResolvedAddress,
} from '../lib/googlePlaces.js';

/**
 * Address lookup for office intake.
 *
 * Google Places when GOOGLE_MAPS_API_KEY is set (Places API enabled).
 * Otherwise OpenStreetMap via Photon — still real geocoded streets, not a mock.
 * A configured Google key is never silently replaced by OSM.
 */

export const placesRouter = Router();
placesRouter.use(requireAuth);

export type { AddressSuggestion, ResolvedAddress };

const autocompleteSchema = z.object({
  input: z.string().trim().min(2).max(200),
  sessionToken: z.string().trim().min(8).max(64).optional(),
});

const detailsSchema = z.object({
  placeId: z.string().trim().min(3).max(300),
  sessionToken: z.string().trim().min(8).max(64).optional(),
});

const resolveSchema = z.object({
  input: z.string().trim().min(3).max(200).optional(),
  placeId: z.string().trim().min(3).max(300).optional(),
  sessionToken: z.string().trim().min(8).max(64).optional(),
});

/** GET /api/operations/places/status — whether address autocomplete is available. */
placesRouter.get('/places/status', (_req: Request, res: Response) => {
  const provider = placesProvider();
  res.json({ configured: true, provider, google: provider === 'google' });
});

/** POST /api/operations/places/autocomplete */
placesRouter.post('/places/autocomplete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = autocompleteSchema.parse(req.body ?? {});
    const { suggestions, provider } = await autocompletePlaces(input.input, input.sessionToken);
    res.json({ suggestions, configured: true, provider });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest(err.errors[0]?.message ?? 'Invalid input'));
    next(err);
  }
});

/** POST /api/operations/places/details */
placesRouter.post('/places/details', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = detailsSchema.parse(req.body ?? {});
    const { address, provider } = await detailsForPlace(input.placeId, input.sessionToken);
    if (!address.addressLine1 && !address.formatted) {
      throw badRequest('That place did not include a street address.', 'no_street');
    }
    res.json({ address, configured: true, provider });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest(err.errors[0]?.message ?? 'Invalid input'));
    next(err);
  }
});

/** POST /api/operations/places/resolve — geocode a typed line through Google. */
placesRouter.post('/places/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = resolveSchema.parse(req.body ?? {});
    if (!input.input && !input.placeId) {
      throw badRequest('Enter an address to look up.', 'address_required');
    }
    const resolved = await resolvePlace({
      query: input.input,
      placeId: input.placeId,
      sessionToken: input.sessionToken,
    });
    if (!resolved || !(resolved.address.addressLine1 || resolved.address.formatted)) {
      throw badRequest(
        'Search for the site address and pick it from the list.',
        'address_unresolved',
      );
    }
    res.json({ address: resolved.address, configured: true, provider: resolved.provider });
  } catch (err) {
    if (err instanceof z.ZodError) return next(badRequest(err.errors[0]?.message ?? 'Invalid input'));
    next(err);
  }
});
