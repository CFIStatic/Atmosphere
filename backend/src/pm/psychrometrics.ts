/**
 * Psychrometrics and the IICRC S500 drying arithmetic the rules reason with.
 *
 * A project manager does not need these numbers to be exact to three decimals;
 * they need them to be *the same numbers the adjuster will run*. So the formulas
 * here are the standard ones — Magnus-Tetens for saturation pressure, the S500
 * airflow and dehumidification factors — rather than anything tuned to be
 * clever. When a rule says "you are two dehumidifiers short", that claim has to
 * survive being checked.
 */

const STANDARD_PRESSURE_HPA = 1013.25;
const GRAINS_PER_POUND = 7000;

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Saturation vapour pressure over water (hPa), Magnus-Tetens. */
function saturationVapourPressure(temperatureC: number): number {
  return 6.112 * Math.exp((17.67 * temperatureC) / (temperatureC + 243.5));
}

const toC = (f: number): number => (f - 32) / 1.8;

/**
 * Grains of water per pound of dry air.
 *
 * This is the humidity measure the restoration industry actually works in,
 * because unlike relative humidity it does not move when the temperature does.
 * Drying progress is a falling GPP; a falling RH can just mean someone turned
 * the heat up.
 */
export function grainsPerPound(temperatureF: number, relativeHumidity: number): number {
  const saturation = saturationVapourPressure(toC(temperatureF));
  const actual = saturation * (Math.min(Math.max(relativeHumidity, 0), 100) / 100);
  const ratio = (0.62198 * actual) / Math.max(STANDARD_PRESSURE_HPA - actual, 0.001);
  return round(ratio * GRAINS_PER_POUND, 1);
}

/**
 * Dew point (°F). Surfaces below it are where secondary damage starts, which is
 * why a dehumidifier running against a cold wall can look busy and achieve
 * nothing.
 */
export function dewPointF(temperatureF: number, relativeHumidity: number): number {
  const temperatureC = toC(temperatureF);
  const gamma =
    Math.log(Math.max(relativeHumidity, 0.01) / 100) +
    (17.67 * temperatureC) / (temperatureC + 243.5);
  const dewC = (243.5 * gamma) / (17.67 - gamma);
  return round(dewC * 1.8 + 32, 1);
}

/**
 * Air movers needed for a water class, per S500: roughly one per 50–70 ft² of
 * affected floor, plus one per wall-length allowance. We use the conservative
 * end (50 ft²) for class 3 and 4, where the whole envelope is wet, and 70 ft²
 * for class 1 and 2.
 *
 * Returned as a minimum, not a target. Being over on airflow is cheap; being
 * under is a job that does not dry and a PM who finds out on day five.
 */
export function airMoversRequired(affectedSqft: number, waterClass: number): number {
  if (affectedSqft <= 0) return 0;
  const sqftPerMover = waterClass >= 3 ? 50 : 70;
  return Math.max(1, Math.ceil(affectedSqft / sqftPerMover));
}

/**
 * Dehumidification required, in AHAM pints per day.
 *
 * S500 sizes LGR dehumidifiers by cubic feet divided by a class factor: the
 * wetter the class, the fewer cubic feet each pint of capacity can handle.
 */
export function dehumidificationRequiredPintsDay(
  affectedCuft: number,
  waterClass: number,
): number {
  if (affectedCuft <= 0) return 0;
  const factorByClass: Record<number, number> = { 1: 100, 2: 50, 3: 40, 4: 30 };
  const factor = factorByClass[waterClass] ?? 50;
  // AHAM ratings are ~2x the field-realistic output, which the standard's
  // divisor already accounts for; this is the pints/day figure to compare
  // against equipment nameplates.
  return Math.ceil((affectedCuft / factor) * 2);
}

export interface DryingTrendPoint {
  takenAt: Date;
  moisturePct: number;
}

export interface DryingTrend {
  /** Chronological, de-duplicated to one reading per calendar day (the last). */
  daily: DryingTrendPoint[];
  first: DryingTrendPoint | null;
  latest: DryingTrendPoint | null;
  /** Total points dropped since the first reading. Negative means it got wetter. */
  totalDropPct: number | null;
  /** Points dropped between the last two daily readings. */
  lastDropPct: number | null;
  /** Mean points per day across the series. */
  averageDailyDropPct: number | null;
  /**
   * Consecutive most-recent days whose drop was under the org's threshold. This
   * is the stall signal: one flat day is weather, three is a problem.
   */
  flatDays: number;
  /**
   * Days until the goal at the recent rate, or null when there is no usable
   * rate (not enough readings, or it is not drying).
   */
  projectedDaysToGoal: number | null;
}

/**
 * Reduce a reading series to the trend the rules ask questions of.
 *
 * Collapsed to one point per day on purpose: crews take two or three readings
 * on a visit, and treating each as a time step makes a normal day look like a
 * stall. The last reading of a day is the one that counts, because it is taken
 * after that day's equipment has had its run.
 */
export function dryingTrend(
  readings: { takenAt: string; moisturePct: number | null }[],
  goalPct: number,
  flatThresholdPct: number,
  timezone: string,
): DryingTrend {
  const points = readings
    .filter((r): r is { takenAt: string; moisturePct: number } => r.moisturePct !== null)
    .map((r) => ({ takenAt: new Date(r.takenAt), moisturePct: r.moisturePct }))
    .filter((p) => !Number.isNaN(p.takenAt.getTime()))
    .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());

  const byDay = new Map<string, DryingTrendPoint>();
  for (const p of points) byDay.set(localDayKey(p.takenAt, timezone), p);
  const daily = [...byDay.values()].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());

  const first = daily[0] ?? null;
  const latest = daily[daily.length - 1] ?? null;

  if (!first || !latest || daily.length < 2) {
    return {
      daily,
      first,
      latest,
      totalDropPct: null,
      lastDropPct: null,
      averageDailyDropPct: null,
      flatDays: 0,
      projectedDaysToGoal: null,
    };
  }

  const totalDropPct = round(first.moisturePct - latest.moisturePct, 2);
  const previous = daily[daily.length - 2]!;
  const lastDropPct = round(previous.moisturePct - latest.moisturePct, 2);

  const elapsedDays = Math.max(
    1,
    (latest.takenAt.getTime() - first.takenAt.getTime()) / 86_400_000,
  );
  const averageDailyDropPct = round(totalDropPct / elapsedDays, 2);

  let flatDays = 0;
  for (let i = daily.length - 1; i > 0; i -= 1) {
    const drop = daily[i - 1]!.moisturePct - daily[i]!.moisturePct;
    if (drop < flatThresholdPct) flatDays += 1;
    else break;
  }

  const remaining = latest.moisturePct - goalPct;
  // Use the recent rate rather than the lifetime average: drying slows as it
  // approaches the goal, so the lifetime figure is optimistic exactly when
  // somebody is relying on it to promise the customer a date.
  const recentRate = recentDailyRate(daily);
  const projectedDaysToGoal =
    remaining <= 0 ? 0 : recentRate > 0.05 ? round(remaining / recentRate, 1) : null;

  return {
    daily,
    first,
    latest,
    totalDropPct,
    lastDropPct,
    averageDailyDropPct,
    flatDays,
    projectedDaysToGoal,
  };
}

/** Mean daily drop over the last three intervals, which is where the rate is heading. */
function recentDailyRate(daily: DryingTrendPoint[]): number {
  const window = daily.slice(-4);
  if (window.length < 2) return 0;
  const spanDays = Math.max(
    0.5,
    (window[window.length - 1]!.takenAt.getTime() - window[0]!.takenAt.getTime()) / 86_400_000,
  );
  return (window[0]!.moisturePct - window[window.length - 1]!.moisturePct) / spanDays;
}

/**
 * The org's local calendar day for an instant, as `YYYY-MM-DD`.
 *
 * "Has anyone taken a reading today?" is the single most common question the
 * engine asks, and it is meaningless in UTC: a 9pm Eastern reading is tomorrow
 * in UTC, so a UTC-based check would report a missed day on a job that was
 * visited that evening.
 */
export function localDayKey(instant: Date, timezone: string): string {
  try {
    // en-CA gives ISO-ordered parts, which is what makes this sortable.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    // An invalid IANA zone should degrade to something usable rather than throw
    // in the middle of an engine pass.
    return instant.toISOString().slice(0, 10);
  }
}

/** Whole hours between two instants, floored. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 3_600_000);
}

/** Whole days between two instants, floored. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
