/**
 * Room geometry helpers for Field Capture device / twin ingest.
 *
 * Measured values always win when the device sends them; L×W×H derivation is
 * only a fallback for incomplete payloads.
 */

export interface DerivedRoomGeometry {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
  floorSF: number;
  ceilingSF: number;
  wallSF: number;
  perimeterLF: number;
  offsets: number;
  openingSF: number;
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

/** Round to a sane number of decimals for area quantities. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Standard residential ceiling when a payload omits height. */
export const DEFAULT_CEILING_HEIGHT_FT = 8;

export function deriveGeometry(input: GeometryInput): DerivedRoomGeometry {
  const heightFt = positive(input.heightFt) ?? DEFAULT_CEILING_HEIGHT_FT;

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
