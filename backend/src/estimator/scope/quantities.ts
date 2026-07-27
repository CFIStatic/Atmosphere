import type { Opening, RoomMeasurements } from '../types.js';

/**
 * Turning measurements into estimate quantities.
 *
 * Every number in a construction estimate is a claim about how much material
 * and labour a room needs, and the arithmetic that produces it is exactly where
 * an estimate is won or lost. Two rules govern this file:
 *
 *   1. **Deduct what is not there.** A wall with a door in it does not get
 *      drywall across the doorway, and baseboard does not run through it.
 *   2. **Count a shared opening once.** A doorway between two scoped rooms has
 *      one set of casing, not two, so the second room does not bill for it.
 *
 * Functions here are pure and take no dependencies, which is what makes them
 * directly testable — see `backend/test/quantities.test.ts`.
 */

/** Round to Xactimate's two-decimal quantity precision. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Square feet cut out of the walls by a single opening. */
export function openingArea(opening: Opening): number {
  return opening.width * opening.height;
}

/**
 * Wall area with door and window openings removed.
 *
 * Small openings are kept in rather than deducted: trade practice is to ignore
 * anything under about 10 SF, because the labour to cut around it exceeds the
 * material saved. Deducting them would systematically under-scope every room
 * with a small window.
 */
const MIN_DEDUCTIBLE_OPENING_SQFT = 10;

export function netWallArea(room: RoomMeasurements): number {
  const deducted = room.openings
    .map(openingArea)
    .filter((area) => area >= MIN_DEDUCTIBLE_OPENING_SQFT)
    .reduce((sum, area) => sum + area, 0);

  // Never return a negative wall: a scan that reports more opening than wall is
  // wrong, and a negative quantity would silently subtract from the estimate.
  return round2(Math.max(room.wallAreaSqFt - deducted, 0));
}

/**
 * Wall area for a flood cut — a partial-height removal measured up from the
 * floor. Mitigation crews cut at 2 or 4 feet, so the rebuild is that band, not
 * the whole wall.
 */
export function floodCutArea(room: RoomMeasurements, cutHeightFt: number): number {
  const height = Math.min(Math.max(cutHeightFt, 0), room.ceilingHeightFt);
  return round2(room.perimeterLf * height);
}

/**
 * Baseboard runs the perimeter minus every doorway and cased opening. Windows
 * do not interrupt it, so they are not deducted.
 */
export function baseboardLength(room: RoomMeasurements): number {
  const interruptions = room.openings
    .filter((o) => o.kind === 'door' || o.kind === 'cased_opening')
    .reduce((sum, o) => sum + o.width, 0);

  return round2(Math.max(room.perimeterLf - interruptions, 0));
}

/**
 * Casing length around openings.
 *
 * A door is cased on two sides and across the head; a window is cased all the
 * way round. Openings shared with another scoped room are skipped here so the
 * pair is not billed twice — the room that owns the opening bills it.
 */
export function casingLength(room: RoomMeasurements): number {
  const total = room.openings
    .filter((o) => !o.sharedWithRoomId)
    .reduce((sum, o) => {
      if (o.kind === 'window') return sum + 2 * o.height + 2 * o.width;
      return sum + 2 * o.height + o.width;
    }, 0);

  return round2(total);
}

/** Doors in the room, excluding ones another scoped room already accounts for. */
export function doorCount(room: RoomMeasurements): number {
  return room.openings.filter((o) => o.kind === 'door' && !o.sharedWithRoomId).length;
}

/**
 * Area actually affected on a surface.
 *
 * A photo showing water damage across a third of a wall should not scope the
 * whole wall — but nor should it scope exactly 33%, because drywall is replaced
 * in whole sheets and paint is applied corner to corner. The floor is a quarter
 * of the surface, which is roughly one 4×8 sheet on a typical wall.
 */
const MIN_AFFECTED_FRACTION = 0.25;

export function affectedArea(totalArea: number, fraction: number | undefined): number {
  if (fraction === undefined || !Number.isFinite(fraction)) return round2(totalArea);
  const clamped = Math.min(Math.max(fraction, MIN_AFFECTED_FRACTION), 1);
  return round2(totalArea * clamped);
}

/**
 * Debris loads for a room, at roughly one pickup load per 250 SF of finish
 * removed. Rounded up, because half a load still means a trip.
 */
export function debrisLoads(removedAreaSqFt: number): number {
  return Math.max(1, Math.ceil(removedAreaSqFt / 250));
}
