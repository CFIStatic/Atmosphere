import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { milesBetween } from '../campaigns/geo.js';

/**
 * Where the crew are, right now.
 *
 * Answers two operational questions nothing else in the product can: which
 * technician is closest to a loss that just came in, and who is already inside
 * a territory a storm warning just landed on.
 *
 * The consent machinery lives in SQL, deliberately. `record_crew_location`
 * refuses when the caller has not opted in, so this router cannot be the place
 * somebody adds a second write path that forgets to check — and neither can a
 * background job, an import, or next year's endpoint.
 *
 * Nothing here lets one person switch sharing on for another. An owner asking
 * for that is asking for a different product, and the RLS policy has no
 * admin-write path to give it to them.
 */
export const locationsRouter = Router();

locationsRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

// A phone watching position reports every few seconds while moving. Generous
// enough for that, bounded so a stuck client cannot fill the table.
const pingLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down.', code: 'rate_limited' },
});

const pingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  speed: z.number().min(0).max(200).nullable().optional(),
});

/**
 * GET /api/locations/sharing
 * Whether this person is sharing, and what that means. Read by the toggle and
 * by the indicator that has to stay visible while sharing is on.
 */
locationsRouter.get('/sharing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, supabase } = await requireOrgContext(req);
    const { data } = await supabase
      .from('crew_location_consent')
      .select('sharing, share_window, decided_at')
      .eq('user_id', userId)
      .maybeSingle();

    res.json({
      sharing: Boolean(data?.sharing),
      shareWindow: data?.share_window ?? 'shift',
      decidedAt: data?.decided_at ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/locations/sharing
 * The person's own decision. Turning it off erases what was collected, because
 * stopping without deleting is not stopping.
 */
locationsRouter.put('/sharing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const { sharing, shareWindow } = z
      .object({
        sharing: z.boolean(),
        shareWindow: z.enum(['always', 'shift']).optional(),
      })
      .parse(req.body ?? {});

    if (!sharing) {
      const { data, error } = await supabase.rpc('stop_sharing_location');
      if (error) throw new HttpError(400, error.message, 'stop_failed');
      res.json({ sharing: false, erased: Number(data ?? 0) });
      return;
    }

    const { error } = await supabase.from('crew_location_consent').upsert(
      {
        user_id: userId,
        org_id: orgId,
        sharing: true,
        share_window: shareWindow ?? 'shift',
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw new HttpError(400, error.message, 'sharing_failed');

    res.json({ sharing: true, shareWindow: shareWindow ?? 'shift' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/locations/ping
 * One position from the browser.
 *
 * Answers 200 with `recorded: false` when the person is not sharing, rather
 * than an error: a watch started before somebody switched sharing off keeps
 * firing for a moment afterwards, and that is not a failure worth showing them.
 */
locationsRouter.post('/ping', pingLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase } = await requireOrgContext(req);
    const input = pingSchema.parse(req.body ?? {});

    const { data, error } = await supabase.rpc('record_crew_location', {
      p_lat: input.lat,
      p_lon: input.lon,
      p_accuracy: input.accuracy ?? null,
      p_heading: input.heading ?? null,
      p_speed: input.speed ?? null,
    });
    if (error) throw new HttpError(400, error.message, 'ping_failed');

    res.json({ recorded: Boolean(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/locations/crew
 * Everyone currently sharing, with which territory they are in.
 *
 * The territory join is the useful part. "Ken is at 30.51, -97.68" is a number;
 * "Ken is in North Austin" is an answer, and it is what makes this connect to
 * the campaign and territory work rather than being a map for its own sake.
 */
locationsRouter.get('/crew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const [positions, territories, profiles] = await Promise.all([
      supabase.from('crew_live_positions').select('*').eq('org_id', orgId),
      supabase.from('crm_territories').select('*').eq('org_id', orgId),
      supabase.from('profiles').select('id, full_name, email'),
    ]);

    const nameById = new Map(
      ((profiles.data ?? []) as any[]).map((p) => [p.id, p.full_name || p.email || 'Unknown']),
    );

    // Territories are described as ZIPs, cities and counties rather than
    // polygons, so a position cannot be matched to one geometrically. What can
    // be answered is distance to the places the org has saved in each — which
    // is the practical question anyway: not "is Ken inside a boundary" but
    // "how far is Ken from the buildings I sell to there".
    const { data: places } = await supabase
      .from('crm_places')
      .select('id, name, lat, lon, territory_id')
      .eq('org_id', orgId)
      .not('lat', 'is', null)
      .limit(2000);

    const items = ((positions.data ?? []) as any[]).map((p) => {
      const here = { lat: p.lat, lon: p.lon };

      let nearest: { name: string; miles: number; territoryId: string | null } | null = null;
      for (const place of (places ?? []) as any[]) {
        if (typeof place.lat !== 'number' || typeof place.lon !== 'number') continue;
        const miles = milesBetween(here, { lat: place.lat, lon: place.lon });
        if (!nearest || miles < nearest.miles) {
          nearest = { name: place.name, miles, territoryId: place.territory_id };
        }
      }

      const territory = nearest?.territoryId
        ? ((territories.data ?? []) as any[]).find((t) => t.id === nearest!.territoryId)
        : null;

      return {
        userId: p.user_id,
        name: nameById.get(p.user_id) ?? 'Unknown',
        lat: p.lat,
        lon: p.lon,
        // A 2km fix is not a location, and the UI needs this to say so rather
        // than drawing a confident dot in the wrong place.
        accuracyM: p.accuracy_m,
        headingDeg: p.heading,
        speedMps: p.speed_mps,
        capturedAt: p.captured_at,
        nearestPlace: nearest ? { name: nearest.name, miles: Math.round(nearest.miles * 10) / 10 } : null,
        territory: territory ? { id: territory.id, name: territory.name } : null,
      };
    });

    res.json({ items, sharing: items.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/locations/nearest?lat=&lon=
 * Who is closest to a point. The dispatch question, answered directly.
 */
locationsRouter.get('/nearest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new HttpError(400, 'A latitude and longitude are needed.', 'bad_point');
    }

    const [positions, profiles] = await Promise.all([
      supabase.from('crew_live_positions').select('*').eq('org_id', orgId),
      supabase.from('profiles').select('id, full_name, email'),
    ]);

    const nameById = new Map(
      ((profiles.data ?? []) as any[]).map((p) => [p.id, p.full_name || p.email || 'Unknown']),
    );

    const items = ((positions.data ?? []) as any[])
      .map((p) => ({
        userId: p.user_id,
        name: nameById.get(p.user_id) ?? 'Unknown',
        miles: Math.round(milesBetween({ lat, lon }, { lat: p.lat, lon: p.lon }) * 10) / 10,
        capturedAt: p.captured_at,
        accuracyM: p.accuracy_m,
      }))
      .sort((a, b) => a.miles - b.miles);

    res.json({ items });
  } catch (err) {
    next(err);
  }
});
