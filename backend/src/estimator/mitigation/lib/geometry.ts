import type { RoomGeometry } from '../types.js';

/**
 * Geometry helpers shared by every ingestion adapter.
 *
 * Sources disagree about what they hand over: DocuSketch gives measured surface
 * areas, a MICA report often gives only L×W×H, and a technician's note may give
 * nothing but "12 by 14". All three end up as a complete `RoomGeometry` here, so
 * no downstream rule ever has to ask "did this source include wall area?".
 */

/** Round to a sane number of decimals — Xactimate quantities are 2dp. */
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
 * Measured values always win — a DocuSketch scan of an L-shaped room knows its
 * true wall area, and deriving `2 × (L + W) × H` from the bounding box would
 * quietly under-measure it. Derivation is strictly a fallback.
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

/**
 * Wall area below a flood-cut line, in SF. A 24-inch cut around a 40 ft
 * perimeter is 80 SF of drywall, regardless of ceiling height.
 */
export function floodCutSF(perimeterLF: number, cutHeightIn: number): number {
  return round(perimeterLF * (cutHeightIn / 12));
}

/** Square feet → square yards, for carpet line items priced by the yard. */
export function toSquareYards(squareFeet: number): number {
  return round(squareFeet / 9);
}
