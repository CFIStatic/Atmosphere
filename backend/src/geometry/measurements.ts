/**
 * Room measurements and the geometry derived from them.
 *
 * These types and this arithmetic used to live in the estimator, which the
 * property twin borrowed from. The estimator has been removed along with the
 * other products that are not Work Verification, so the twin owns them now —
 * it is the only thing left that measures a room.
 *
 * Ported unchanged from estimator/types.ts, estimator/mitigation/types.ts and
 * estimator/mitigation/lib/geometry.ts so twin output is byte-identical to what
 * it was: the rounding (including the Number.EPSILON nudge) and the
 * measured-wins-over-derived rule are load-bearing for stored twins.
 */

/** A door, window, or cased opening cut into a room's walls. */
export interface Opening {
  kind: 'door' | 'window' | 'cased_opening' | 'other';
  /** Feet. */
  width: number;
  /** Feet. */
  height: number;
  /** Openings between two scoped rooms are counted once, not twice. */
  sharedWithRoomId?: string;
}

/**
 * One room as measured by the 3D scan.
 *
 * Areas are stored as the scanner reports them rather than recomputed from the
 * perimeter: real rooms have bays, soffits, and sloped ceilings that a
 * perimeter × height product silently loses.
 */
export interface RoomMeasurements {
  id: string;
  name: string;
  /** e.g. "bedroom", "kitchen", "bathroom". */
  roomType?: string;
  /** Square feet of floor. */
  floorAreaSqFt: number;
  /** Square feet of ceiling. Defaults to floor area for a flat ceiling. */
  ceilingAreaSqFt: number;
  /** Square feet of wall, gross of openings. */
  wallAreaSqFt: number;
  /** Linear feet of floor perimeter. */
  perimeterLf: number;
  /** Feet, floor to ceiling. */
  ceilingHeightFt: number;
  openings: Opening[];
  /** Storey/area grouping from the scan ("Main Level", "Basement"). */
  level?: string;
}

export interface JobPhoto {
  id: string;
  /** Room this photo was captured in, when the scan records it. */
  roomId?: string;
  caption?: string;
  takenAt?: string;
  /** Fetch URL. Bytes are only downloaded for photos we actually analyse. */
  url: string;
  contentType?: string;
}

/** A room's dimensions once every gap the source left has been filled. */
export interface RoomGeometry {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
  floorSF: number;
  ceilingSF: number;
  /** Gross wall area, before deducting openings. */
  wallSF: number;
  perimeterLF: number;
  /** Inside corners / jogs. */
  offsets: number;
  /** Door, window and cased openings. */
  openingSF: number;
}

/** Round to a sane number of decimals — measured quantities are 2dp. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Clamp into a range; used to keep parsed fractions and counts sane. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface GeometryInput {
  lengthFt?: number;
  widthFt?: number;
  heightFt?: number;
  floorSF?: number;
  ceilingSF?: number;
  wallSF?: number;
  perimeterLF?: number;
  offsets?: number;
  openingSF?: number;
}

/** Standard residential ceiling, used when a source omits height entirely. */
export const DEFAULT_CEILING_HEIGHT_FT = 8;

/**
 * Fill in whatever the source left out.
 *
 * Measured values always win — a scan of an L-shaped room knows its true wall
 * area, and deriving `2 × (L + W) × H` from the bounding box would quietly
 * under-measure it. Derivation is strictly a fallback.
 */
export function deriveGeometry(input: GeometryInput): RoomGeometry {
  const heightFt = positive(input.heightFt) ?? DEFAULT_CEILING_HEIGHT_FT;

  // Recover missing side lengths from a known floor area by assuming a square,
  // which is the least-wrong guess when only an area is on hand.
  let lengthFt = positive(input.lengthFt);
  let widthFt = positive(input.widthFt);
  const knownFloor = positive(input.floorSF);

  if (!lengthFt && !widthFt && knownFloor) {
    lengthFt = round(Math.sqrt(knownFloor));
    widthFt = lengthFt;
  } else if (lengthFt && !widthFt && knownFloor) {
    widthFt = round(knownFloor / lengthFt);
  } else if (widthFt && !lengthFt && knownFloor) {
    lengthFt = round(knownFloor / widthFt);
  }

  lengthFt = lengthFt ?? 0;
  widthFt = widthFt ?? 0;

  const floorSF = knownFloor ?? round(lengthFt * widthFt);
  const ceilingSF = positive(input.ceilingSF) ?? floorSF;
  const perimeterLF = positive(input.perimeterLF) ?? round(2 * (lengthFt + widthFt));
  const wallSF = positive(input.wallSF) ?? round(perimeterLF * heightFt);

  return {
    lengthFt,
    widthFt,
    heightFt,
    floorSF,
    ceilingSF,
    wallSF,
    perimeterLF,
    offsets: Math.max(0, Math.round(input.offsets ?? 0)),
    openingSF: Math.max(0, round(input.openingSF ?? 0)),
  };
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Room volume — the input to every dehumidification calculation. */
export function cubicFeet(geometry: RoomGeometry): number {
  return round(geometry.floorSF * geometry.heightFt);
}

/** Wall area net of doors and windows, which is what actually gets removed. */
export function netWallSF(geometry: RoomGeometry): number {
  return round(Math.max(0, geometry.wallSF - geometry.openingSF));
}
