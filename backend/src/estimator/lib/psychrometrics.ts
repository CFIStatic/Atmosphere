import { round } from './geometry.js';
import type { PsychrometricReading, WaterCategory, WaterClass } from '../types.js';

/**
 * Psychrometrics and IICRC S500 drying calculations.
 *
 * These are the numbers that decide how much equipment the job needed, and
 * therefore how many equipment-days are billable. Getting them from the
 * standard rather than from habit is what makes the resulting quantities
 * defensible when an adjuster asks "why four dehus?".
 */

const STANDARD_PRESSURE_HPA = 1013.25;
const GRAINS_PER_POUND = 7000;

/** Saturation vapour pressure over water (hPa), Magnus-Tetens. */
function saturationVapourPressure(temperatureC: number): number {
  return 6.112 * Math.exp((17.67 * temperatureC) / (temperatureC + 243.5));
}

/**
 * Grains per pound of dry air — the humidity measure the restoration industry
 * actually works in, because unlike relative humidity it does not move when the
 * temperature does. Drying progress is a falling GPP, not a falling RH.
 */
export function grainsPerPound(temperatureF: number, relativeHumidity: number): number {
  const temperatureC = (temperatureF - 32) / 1.8;
  const saturation = saturationVapourPressure(temperatureC);
  const actual = saturation * (relativeHumidity / 100);
  const humidityRatio = (0.62198 * actual) / Math.max(STANDARD_PRESSURE_HPA - actual, 0.001);
  return round(humidityRatio * GRAINS_PER_POUND, 1);
}

/** Dew point (°F). Below-dew-point surfaces are where secondary damage starts. */
export function dewPointF(temperatureF: number, relativeHumidity: number): number {
  const temperatureC = (temperatureF - 32) / 1.8;
  const gamma =
    Math.log(Math.max(relativeHumidity, 0.01) / 100) +
    (17.67 * temperatureC) / (temperatureC + 243.5);
  const dewC = (243.5 * gamma) / (17.67 - gamma);
  return round(dewC * 1.8 + 32, 1);
}

/** Fill in GPP for any reading that arrived without it. */
export function withDerivedGpp(reading: PsychrometricReading): PsychrometricReading {
  if (typeof reading.gpp === 'number') return reading;
  return {
    ...reading,
    gpp: grainsPerPound(reading.temperatureF, reading.relativeHumidity),
  };
}

/**
 * A drying system is working when the affected air is measurably drier than the
 * unaffected air — the "GPP differential". A differential at or below zero means
 * the dehumidifiers are losing to the intrusion, which is itself a billable
 * finding (more equipment was warranted).
 */
export function gppDifferential(readings: PsychrometricReading[]): number | null {
  const affected = latestOf(readings, 'affected');
  const unaffected = latestOf(readings, 'unaffected');
  if (!affected || !unaffected) return null;
  const a = withDerivedGpp(affected).gpp ?? 0;
  const u = withDerivedGpp(unaffected).gpp ?? 0;
  return round(a - u, 1);
}

function latestOf(
  readings: PsychrometricReading[],
  zone: PsychrometricReading['zone'],
): PsychrometricReading | undefined {
  return readings
    .filter((r) => r.zone === zone)
    .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt))[0];
}

/* ------------------------------------------------------------------ *
 * Category degradation
 * ------------------------------------------------------------------ */

/**
 * S500: category is a function of contamination *and* time. Clean water left
 * standing becomes Category 2 as it picks up soils and supports amplification,
 * and Category 2 becomes Category 3. The clock starts at the loss, not at
 * arrival — which is why a three-day-old "clean" supply-line break is scoped as
 * grossly contaminated.
 */
export function degradeCategory(
  sourceCategory: WaterCategory,
  hoursSinceLoss: number,
): WaterCategory {
  let category: WaterCategory = sourceCategory;
  if (category === 1 && hoursSinceLoss >= 48) category = 2;
  if (category === 2 && hoursSinceLoss >= 72) category = 3;
  return category;
}

/** Hours between two ISO timestamps; 0 when either is missing or malformed. */
export function hoursBetween(from?: string, to?: string): number {
  if (!from || !to) return 0;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, (b - a) / 3_600_000);
}

/* ------------------------------------------------------------------ *
 * Class determination
 * ------------------------------------------------------------------ */

export interface ClassInputs {
  /** Wet area ÷ total combined floor+wall+ceiling area of the affected rooms. */
  wetSurfaceFraction: number;
  /** True when water came from overhead and ceilings/insulation are wet. */
  ceilingAffected: boolean;
  /** True when hardwood, plaster, concrete or masonry holds the moisture. */
  lowEvaporationMaterials: boolean;
}

/**
 * Determine the S500 class of water intrusion.
 *
 * Class is about evaporation load, not contamination — a Category 3 sewage loss
 * in a small tiled bathroom is still Class 1. Getting this right matters
 * commercially because the class sets the dehumidification factor, and therefore
 * the equipment count that will be on the estimate for the whole drying period.
 */
export function determineClass(inputs: ClassInputs): WaterClass {
  // Class 4 is a materials call, not an area call: deeply held moisture in
  // low-evaporation assemblies needs specialty drying no matter how small.
  if (inputs.lowEvaporationMaterials && inputs.wetSurfaceFraction >= 0.05) return 4;
  if (inputs.ceilingAffected || inputs.wetSurfaceFraction > 0.4) return 3;
  if (inputs.wetSurfaceFraction >= 0.05) return 2;
  return 1;
}

/* ------------------------------------------------------------------ *
 * Equipment sizing
 * ------------------------------------------------------------------ */

/**
 * S500 initial-water-load factors: required capacity = affected cubic feet ÷
 * factor. Refrigerant factors yield AHAM pints/day; the desiccant factor yields
 * CFM of process air.
 */
export const DEHU_FACTORS = {
  conventional: { 1: 100, 2: 40, 3: 30, 4: 50 },
  lgr: { 1: 100, 2: 50, 3: 40, 4: 60 },
  desiccant: { 1: 100, 2: 60, 3: 45, 4: 50 },
} as const satisfies Record<string, Record<WaterClass, number>>;

export type DehuType = keyof typeof DEHU_FACTORS;

/** AHAM pints/day of the LGR unit the calculation assumes. Configurable per org. */
export const DEFAULT_LGR_CAPACITY_PPD = 70;

export interface DehumidificationResult {
  requiredPintsPerDay: number;
  unitsRequired: number;
  factor: number;
  dehuType: DehuType;
}

/**
 * Size the dehumidification for an affected volume.
 *
 * The result is a floor, not a ceiling: it says how much capacity the class
 * demanded. Where the crew actually placed more (because the structure was cold,
 * or the intrusion was ongoing) the *placed* count is what gets billed — this
 * number exists to catch the opposite case, where the job was under-equipped and
 * the estimate quietly under-bills the days.
 */
export function sizeDehumidification(
  affectedCubicFeet: number,
  waterClass: WaterClass,
  dehuType: DehuType = 'lgr',
  unitCapacityPpd: number = DEFAULT_LGR_CAPACITY_PPD,
): DehumidificationResult {
  const factor = DEHU_FACTORS[dehuType][waterClass];
  const requiredPintsPerDay = round(affectedCubicFeet / factor, 1);
  return {
    requiredPintsPerDay,
    unitsRequired: Math.max(1, Math.ceil(requiredPintsPerDay / unitCapacityPpd)),
    factor,
    dehuType,
  };
}

/** Coverage assumptions for air movers, at the midpoint of the S500 ranges. */
export const AIR_MOVER_COVERAGE = {
  /** One unit per this many SF of wet floor (S500 range: 50–70). */
  floorSFPerUnit: 60,
  /** One unit per this many LF of wet wall (S500 range: 10–16). */
  wallLFPerUnit: 14,
  /** One unit per this many SF of wet ceiling. */
  ceilingSFPerUnit: 70,
} as const;

export interface AirMoverInputs {
  wetFloorSF: number;
  /** Linear feet of wall wet above ~2 ft, i.e. Class 2 and up. */
  wetWallLF: number;
  wetCeilingSF: number;
  /** Inside corners and jogs — each traps air and needs its own unit. */
  offsets: number;
}

/**
 * Air-mover count for one room, per S500: one unit to establish airflow in the
 * room, then additional units by wet surface area, plus one per offset.
 */
export function sizeAirMovers(inputs: AirMoverInputs): number {
  let units = 1; // baseline circulation for the room itself
  units += Math.ceil(inputs.wetFloorSF / AIR_MOVER_COVERAGE.floorSFPerUnit);
  units += Math.ceil(inputs.wetWallLF / AIR_MOVER_COVERAGE.wallLFPerUnit);
  units += Math.ceil(inputs.wetCeilingSF / AIR_MOVER_COVERAGE.ceilingSFPerUnit);
  units += Math.max(0, inputs.offsets);
  return units;
}

/**
 * Air scrubbers / negative air machines are sized by air changes per hour. Four
 * ACH is the working figure for containment on a contaminated loss.
 */
export function sizeAirScrubbers(
  affectedCubicFeet: number,
  machineCfm = 500,
  airChangesPerHour = 4,
): number {
  const requiredCfm = (affectedCubicFeet * airChangesPerHour) / 60;
  return Math.max(1, Math.ceil(requiredCfm / machineCfm));
}
