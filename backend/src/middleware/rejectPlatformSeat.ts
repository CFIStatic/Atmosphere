import type { NextFunction, Request, Response } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { PLATFORM_SEAT_NO_FIELD_CAPTURE_MESSAGE, isPlatformSeatMember } from '../lib/platformSeats.js';

type SeatLookup = (req: Request) => Promise<boolean>;

async function defaultLookup(req: Request): Promise<boolean> {
  let ctx: Awaited<ReturnType<typeof requireOrgContext>>;
  try {
    ctx = await requireOrgContext(req);
  } catch (err) {
    // No workspace yet: the Field Capture app's own join flow handles that.
    if (err instanceof HttpError && err.code === 'no_organization') return false;
    throw err;
  }
  return isPlatformSeatMember(ctx.supabase, ctx.orgId, ctx.userId);
}

let lookupForTests: SeatLookup | null = null;
/** Tests only: answer "is this a Platform seat?" without a database. */
export function setPlatformSeatLookupForTests(lookup: SeatLookup | null): void {
  lookupForTests = lookup;
}

/**
 * Field Capture (app.atmosphereteam.com, the phone apps, and the Platform's
 * /fieldcapture/ fallback) refuses Platform-only seats with a clear 403.
 * Must run after requireAuth.
 */
export async function rejectPlatformSeatInFieldCapture(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user && (await (lookupForTests ?? defaultLookup)(req))) {
      throw forbidden(PLATFORM_SEAT_NO_FIELD_CAPTURE_MESSAGE, 'platform_seat_no_field_capture');
    }
    next();
  } catch (err) {
    next(err);
  }
}
