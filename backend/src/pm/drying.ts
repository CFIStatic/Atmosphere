import {
  airMoversRequired,
  daysBetween,
  dehumidificationRequiredPintsDay,
  dewPointF,
  dryingTrend,
  grainsPerPound,
  hoursBetween,
  localDayKey,
  round,
  type DryingTrend,
} from './psychrometrics.js';
import type { AutomationSettings, MoistureReading, ProjectContext } from './types.js';

/**
 * Drying analysis — the questions a mitigation PM asks about a job every morning.
 *
 * This module answers them; `rules.ts` decides which answers are worth
 * interrupting somebody about. Keeping the two apart means the project screen
 * and the alert panel are guaranteed to show the same numbers, because they call
 * the same function.
 */

export type AreaState =
  | 'drying' // on track
  | 'stalled' // readings flat for too long
  | 'wetter' // going the wrong way
  | 'goal_met' // at or below the dry standard, awaiting sign-off
  | 'signed_off'
  | 'no_readings'; // established but never measured

export interface AreaAnalysis {
  areaId: string;
  label: string;
  material: string;
  dryGoalPct: number;
  waterClass: number | null;
  state: AreaState;
  latestMoisturePct: number | null;
  latestReadingAt: string | null;
  hoursSinceReading: number | null;
  /** True when the last reading is older than the org's interval. */
  readingOverdue: boolean;
  trend: DryingTrend;
  /** Points still to lose before the area meets its standard. */
  remainingPct: number | null;
  projectedDaysToGoal: number | null;
  daysDrying: number;
}

export interface EquipmentAdequacy {
  airMoversOnSite: number;
  airMoversRequired: number;
  dehuPintsOnSite: number;
  dehuPintsRequired: number;
  /** Null when the areas carry no sizing data, so nothing can be said. */
  sufficient: boolean | null;
  shortfallNote: string | null;
}

export interface DryingAnalysis {
  /** Whether this project is in a phase that owes daily readings at all. */
  isDrying: boolean;
  areas: AreaAnalysis[];
  openAreas: number;
  areasAtGoal: number;
  areasOverdue: number;
  areasStalled: number;
  /** Latest ambient conditions on site, with GPP derived when it was not stored. */
  ambient: { temperatureF: number; humidityPct: number; gpp: number; dewPointF: number } | null;
  /** Latest outside conditions, for the "is the outside air drier?" question. */
  outside: { temperatureF: number; humidityPct: number; gpp: number } | null;
  equipment: EquipmentAdequacy;
  /** Days since the first reading on the job. */
  daysDrying: number;
  /** True when every area has met its goal — the trigger to pull equipment. */
  allAreasAtGoal: boolean;
  /** Areas at goal but with equipment still running on them. */
  equipmentStillOnDriedProject: boolean;
}

const DRYING_PHASES = new Set(['mitigation', 'drying', 'drying_complete']);

function latestOfKind(readings: MoistureReading[], kind: string): MoistureReading | null {
  let best: MoistureReading | null = null;
  for (const r of readings) {
    if (r.kind !== kind) continue;
    if (!best || new Date(r.takenAt) > new Date(best.takenAt)) best = r;
  }
  return best;
}

function airReading(r: MoistureReading | null) {
  if (!r || r.temperatureF === null || r.humidityPct === null) return null;
  const gpp = r.gpp ?? grainsPerPound(r.temperatureF, r.humidityPct);
  return { temperatureF: r.temperatureF, humidityPct: r.humidityPct, gpp: round(gpp, 1) };
}

export function analyzeDrying(
  ctx: ProjectContext,
  settings: AutomationSettings,
  now: Date,
): DryingAnalysis {
  const isDrying =
    ctx.project.workType === 'mitigation' && DRYING_PHASES.has(ctx.project.phase);

  const readingsByArea = new Map<string, MoistureReading[]>();
  for (const r of ctx.readings) {
    if (!r.areaId) continue;
    const list = readingsByArea.get(r.areaId);
    if (list) list.push(r);
    else readingsByArea.set(r.areaId, [r]);
  }

  const areas: AreaAnalysis[] = ctx.areas.map((area) => {
    const readings = readingsByArea.get(area.id) ?? [];
    const trend = dryingTrend(
      readings.map((r) => ({ takenAt: r.takenAt, moisturePct: r.moisturePct })),
      area.dryGoalPct,
      settings.dryingProgressMinPct,
      settings.timezone,
    );

    const latest = trend.latest;
    const hoursSinceReading = latest ? hoursBetween(latest.takenAt, now) : null;
    const remainingPct = latest ? round(latest.moisturePct - area.dryGoalPct, 2) : null;

    let state: AreaState;
    if (area.signedOffAt) state = 'signed_off';
    else if (!latest) state = 'no_readings';
    else if (latest.moisturePct <= area.dryGoalPct) state = 'goal_met';
    else if (trend.lastDropPct !== null && trend.lastDropPct < 0) state = 'wetter';
    else if (trend.flatDays >= settings.dryingStallDays) state = 'stalled';
    else state = 'drying';

    return {
      areaId: area.id,
      label: area.label,
      material: area.material,
      dryGoalPct: area.dryGoalPct,
      waterClass: area.waterClass,
      state,
      latestMoisturePct: latest?.moisturePct ?? null,
      latestReadingAt: latest?.takenAt.toISOString() ?? null,
      hoursSinceReading,
      // An area with no reading at all is overdue the moment it is older than
      // the interval — otherwise "never measured" would read as "fine".
      readingOverdue:
        state !== 'signed_off' &&
        (hoursSinceReading === null
          ? hoursBetween(new Date(area.establishedAt), now) >= settings.readingIntervalHours
          : hoursSinceReading >= settings.readingIntervalHours),
      trend,
      remainingPct,
      projectedDaysToGoal: trend.projectedDaysToGoal,
      daysDrying: trend.first ? daysBetween(trend.first.takenAt, now) : 0,
    };
  });

  const liveAreas = areas.filter((a) => a.state !== 'signed_off');
  const atGoal = liveAreas.filter((a) => a.state === 'goal_met');

  const ambientReading = airReading(latestOfKind(ctx.readings, 'ambient'));
  const outsideReading = airReading(latestOfKind(ctx.readings, 'outside'));

  const firstReading = areas
    .map((a) => a.trend.first?.takenAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const allAreasAtGoal =
    liveAreas.length > 0 && liveAreas.every((a) => a.state === 'goal_met');

  return {
    isDrying,
    areas,
    openAreas: liveAreas.length,
    areasAtGoal: atGoal.length,
    areasOverdue: liveAreas.filter((a) => a.readingOverdue).length,
    areasStalled: liveAreas.filter((a) => a.state === 'stalled' || a.state === 'wetter').length,
    ambient: ambientReading
      ? {
          ...ambientReading,
          dewPointF: dewPointF(ambientReading.temperatureF, ambientReading.humidityPct),
        }
      : null,
    outside: outsideReading,
    equipment: equipmentAdequacy(ctx),
    daysDrying: firstReading ? daysBetween(firstReading, now) : 0,
    allAreasAtGoal,
    equipmentStillOnDriedProject: allAreasAtGoal && ctx.placements.length > 0,
  };
}

/**
 * Is there enough equipment on site for what is wet?
 *
 * Only answerable when the areas carry sizing data — a crew that recorded a
 * dry standard but no square footage has given us a goal without a scale, and
 * the honest answer is `sufficient: null` rather than a confident number derived
 * from zero.
 */
function equipmentAdequacy(ctx: ProjectContext): EquipmentAdequacy {
  let airMoversOnSite = 0;
  let dehuPintsOnSite = 0;
  for (const p of ctx.placements) {
    const kind = p.equipment?.kind;
    if (kind === 'air_mover') airMoversOnSite += 1;
    if (kind === 'dehumidifier') dehuPintsOnSite += p.equipment?.capacityPintsDay ?? 0;
  }

  const openAreas = ctx.areas.filter((a) => !a.signedOffAt);
  const sizedSqft = openAreas.reduce((sum, a) => sum + (a.affectedSqft ?? 0), 0);
  const sizedCuft = openAreas.reduce((sum, a) => sum + (a.affectedCuft ?? 0), 0);
  const worstClass = openAreas.reduce((max, a) => Math.max(max, a.waterClass ?? 0), 0);

  if (!sizedSqft && !sizedCuft) {
    return {
      airMoversOnSite,
      airMoversRequired: 0,
      dehuPintsOnSite,
      dehuPintsRequired: 0,
      sufficient: null,
      shortfallNote: null,
    };
  }

  const moversNeeded = airMoversRequired(sizedSqft, worstClass || 2);
  const pintsNeeded = dehumidificationRequiredPintsDay(sizedCuft, worstClass || 2);

  const shortMovers = sizedSqft > 0 && airMoversOnSite < moversNeeded;
  const shortDehu = sizedCuft > 0 && dehuPintsOnSite < pintsNeeded;

  const notes: string[] = [];
  if (shortMovers) {
    notes.push(`${moversNeeded - airMoversOnSite} more air mover(s) for ${sizedSqft} ft²`);
  }
  if (shortDehu) {
    notes.push(
      `${pintsNeeded - dehuPintsOnSite} more AHAM pints/day of dehumidification for ${sizedCuft} ft³`,
    );
  }

  return {
    airMoversOnSite,
    airMoversRequired: moversNeeded,
    dehuPintsOnSite,
    dehuPintsRequired: pintsNeeded,
    sufficient: !shortMovers && !shortDehu,
    shortfallNote: notes.length ? notes.join(' and ') : null,
  };
}

/**
 * Did anybody log a reading on this project today, in the org's own timezone?
 *
 * Used by the daily-monitoring rule. Timezone matters more than it looks: a 9pm
 * Eastern visit is tomorrow in UTC, so a naive check reports a missed day on a
 * job that was visited last night.
 */
export function hasReadingToday(
  ctx: ProjectContext,
  now: Date,
  timezone: string,
): boolean {
  const today = localDayKey(now, timezone);
  return ctx.readings.some((r) => localDayKey(new Date(r.takenAt), timezone) === today);
}
