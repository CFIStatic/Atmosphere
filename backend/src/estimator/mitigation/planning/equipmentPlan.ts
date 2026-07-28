import { cubicFeet, floodCutSF, round } from '../lib/geometry.js';
import {
  sizeAirMovers,
  sizeAirScrubbers,
  sizeDehumidification,
  type AirMoverMethod,
  type DehuType,
} from '../lib/psychrometrics.js';
import type {
  AssessedRoom,
  EquipmentKind,
  EquipmentPlacement,
  LossAssessment,
  WaterCategory,
} from '../types.js';

/**
 * Smart equipment plan.
 *
 * This is the brain that answers questions like: "We are doing a 2-foot flood
 * cut in the kitchen — how many air movers does that room need?" Sizing follows
 * IICRC S500 coverage figures against the *open cavity surface after the cut*,
 * not against a vague wet-band guess.
 *
 * The plan is distinct from the equipment *log*. The log is what was placed
 * (billable as-performed). The plan is what the loss required. The smartest
 * estimator carries both: bills the log when present, fills gaps from the plan,
 * and flags under-equipment when the log falls short.
 */

export type EquipmentBillingMode = 'as_logged' | 'recommended' | 'max';

export interface EquipmentPlanOptions {
  airMoverMethod?: AirMoverMethod;
  dehuType?: DehuType;
  lgrCapacityPpd?: number;
  scrubberCfm?: number;
  /**
   * Force a cut height (inches) for planning open-wall airflow — e.g. 24 for a
   * standard 2-foot flood cut. When omitted, uses documented or derived cut.
   */
  planCutHeightIn?: number;
  /**
   * Prefer cavity drying systems over flood cuts when the finish is salvageable
   * and the category allows it (typically Cat 1). Cat 3 always plans a flood cut.
   */
  preferInjectidryWhenSalvageable?: boolean;
  billingMode?: EquipmentBillingMode;
}

export interface RoomEquipmentPlan {
  roomId: string;
  roomName: string;
  cutHeightIn: number;
  openWallSF: number;
  wetFloorSF: number;
  wetCeilingSF: number;
  airMoversRequired: number;
  injectidryRecommended: boolean;
  floodCutRequired: boolean;
  rationale: string;
}

export interface EquipmentPlanLine {
  kind: EquipmentKind;
  units: number;
  days: number;
  unitDays: number;
  source: 'plan' | 'log' | 'merged';
  rationale: string;
}

export interface EquipmentPlan {
  rooms: RoomEquipmentPlan[];
  lines: EquipmentPlanLine[];
  /** Placements ready to feed scope when billing from the plan. */
  placements: EquipmentPlacement[];
  dehu: {
    affectedCF: number;
    requiredPintsPerDay: number;
    unitsRequired: number;
    factor: number;
    dehuType: DehuType;
  };
  scrubbersRequired: number;
  airMoversRequired: number;
  warnings: string[];
  billingMode: EquipmentBillingMode;
}

const DEFAULT_CUT_DIVISIONS = [12, 24, 48];

/**
 * Build the equipment plan for a loss assessment.
 *
 * Flood-cut example: a room with 40 LF perimeter and a 24" (2 ft) cut opens
 * `40 × 2 = 80 SF` of cavity. Air movers = 1 room baseline + ceil(wetFloor/60)
 * + ceil((openWallSF + wetCeiling)/125) + offsets.
 */
export function buildEquipmentPlan(
  assessment: LossAssessment,
  options: EquipmentPlanOptions = {},
): EquipmentPlan {
  const dehuType = options.dehuType ?? (assessment.class === 4 ? 'desiccant' : 'lgr');
  const billingMode = options.billingMode ?? inferBillingMode(assessment);
  const warnings: string[] = [];
  const days = Math.max(1, assessment.dryingDays);

  const roomPlans: RoomEquipmentPlan[] = [];
  let totalMovers = 0;
  let injectidryUnits = 0;
  let openCavityRooms = 0;

  for (const room of assessment.rooms) {
    if (room.geometry.floorSF <= 0 && room.geometry.perimeterLF <= 0) continue;

    const plan = planRoom(room, assessment.category, options);
    roomPlans.push(plan);
    totalMovers += plan.airMoversRequired;
    if (plan.injectidryRecommended) {
      injectidryUnits += 1;
      openCavityRooms += 1;
    } else if (plan.floodCutRequired) {
      openCavityRooms += 1;
    }
  }

  const affectedCF = round(
    assessment.rooms.reduce(
      (sum, room) => sum + cubicFeet(room.geometry) * room.affectedFloorFraction,
      0,
    ),
  );

  const dehu =
    affectedCF > 0
      ? sizeDehumidification(affectedCF, assessment.class, dehuType, options.lgrCapacityPpd)
      : { requiredPintsPerDay: 0, unitsRequired: 0, factor: 0, dehuType };

  const scrubbersRequired =
    assessment.containmentRequired || assessment.microbialGrowthPresent || assessment.category === 3
      ? sizeAirScrubbers(Math.max(affectedCF, 1), options.scrubberCfm)
      : 0;

  if (affectedCF <= 0) {
    warnings.push(
      'No affected cubic footage yet — dehumidification cannot be sized until room dimensions are known.',
    );
  }
  if (totalMovers === 0 && assessment.rooms.some((r) => r.geometry.floorSF > 0)) {
    warnings.push('Air-mover plan is zero despite wet floor area — check affected floor fractions.');
  }

  const planLines: EquipmentPlanLine[] = [];

  if (totalMovers > 0) {
    planLines.push({
      kind: 'air_mover',
      units: totalMovers,
      days,
      unitDays: totalMovers * days,
      source: 'plan',
      rationale: roomPlans
        .filter((r) => r.airMoversRequired > 0)
        .map(
          (r) =>
            `${r.roomName}: ${r.airMoversRequired} movers for ${r.wetFloorSF} SF wet floor` +
            (r.openWallSF > 0
              ? ` + ${r.openWallSF} SF open wall after ${r.cutHeightIn}" cut`
              : ''),
        )
        .join('; '),
    });
  }

  if (dehu.unitsRequired > 0) {
    const kind: EquipmentKind =
      dehuType === 'desiccant'
        ? 'dehumidifier_desiccant'
        : dehuType === 'conventional'
          ? 'dehumidifier_conventional'
          : 'dehumidifier_lgr';
    planLines.push({
      kind,
      units: dehu.unitsRequired,
      days,
      unitDays: dehu.unitsRequired * days,
      source: 'plan',
      rationale: `Class ${assessment.class} LGR factor ${dehu.factor} on ${affectedCF} affected CF → ${dehu.requiredPintsPerDay} PPD → ${dehu.unitsRequired} unit(s).`,
    });
  }

  if (scrubbersRequired > 0) {
    planLines.push({
      kind: 'air_scrubber',
      units: scrubbersRequired,
      days,
      unitDays: scrubbersRequired * days,
      source: 'plan',
      rationale: `Containment / Cat ${assessment.category} / microbial work sized at 4 ACH on ${affectedCF} CF.`,
    });
  }

  if (injectidryUnits > 0) {
    planLines.push({
      kind: 'injectidry',
      units: injectidryUnits,
      days,
      unitDays: injectidryUnits * days,
      source: 'plan',
      rationale: `Cavity drying recommended in ${injectidryUnits} room(s) as an alternative to flood-cut demolition where the finish is salvageable.`,
    });
  }

  const merged = mergeWithLog(planLines, assessment.equipment, days, billingMode);
  const placements = linesToPlacements(merged.lines, assessment.dateOfArrival);

  return {
    rooms: roomPlans,
    lines: merged.lines,
    placements,
    dehu: {
      affectedCF,
      requiredPintsPerDay: dehu.requiredPintsPerDay,
      unitsRequired: dehu.unitsRequired,
      factor: dehu.factor,
      dehuType,
    },
    scrubbersRequired,
    airMoversRequired: totalMovers,
    warnings: [...warnings, ...merged.warnings],
    billingMode,
  };
}

/**
 * Plan one room: cut height → open wall SF → air movers.
 *
 * A 2-foot (24") flood cut on a 40 LF perimeter opens 80 SF of cavity wall that
 * must be swept by air movers — that open surface is what S500 coverage is
 * sized against once the cut is made.
 */
export function planRoom(
  room: AssessedRoom,
  category: WaterCategory,
  options: EquipmentPlanOptions = {},
): RoomEquipmentPlan {
  const wetFloorSF = round(room.geometry.floorSF * room.affectedFloorFraction);
  const wetCeilingSF = room.ceilingAffected ? room.geometry.ceilingSF : 0;

  const wallMaterials = room.materials.filter(
    (m) => m.surface === 'wall' && m.material !== 'baseboard' && m.material !== 'cabinetry',
  );
  const cavityWet = wallMaterials.some((m) => m.cavityWet) || Boolean(room.documentedCutHeightIn);
  const needsCut =
    cavityWet ||
    category === 3 ||
    wallMaterials.some((m) => !m.salvageable) ||
    options.planCutHeightIn !== undefined;

  const derivedCut = derivePlanCutHeight(room, category, options.planCutHeightIn);
  const cutHeightIn = needsCut ? derivedCut : 0;
  const openWallSF =
    cutHeightIn > 0 && room.geometry.perimeterLF > 0
      ? floodCutSF(room.geometry.perimeterLF, cutHeightIn)
      : wetWallBandSF(room);

  const preferInjectidry =
    Boolean(options.preferInjectidryWhenSalvageable) &&
    category < 3 &&
    cavityWet &&
    wallMaterials.every((m) => m.salvageable !== false) &&
    !room.documentedCutHeightIn;

  const floodCutRequired = needsCut && !preferInjectidry;
  const injectidryRecommended = preferInjectidry;

  const airMoversRequired =
    wetFloorSF > 0 || openWallSF > 0 || wetCeilingSF > 0
      ? sizeAirMovers(
          {
            wetFloorSF,
            wetWallLF: cutHeightIn > 0 ? room.geometry.perimeterLF : 0,
            wetWallSF: openWallSF,
            wetCeilingSF,
            offsets: room.geometry.offsets,
          },
          options.airMoverMethod ?? 'area',
        )
      : 0;

  const rationale = floodCutRequired
    ? `${cutHeightIn}" flood cut opens ${openWallSF} SF of wall cavity on ${room.geometry.perimeterLF} LF perimeter → ${airMoversRequired} air movers (floor ${wetFloorSF} SF` +
      (wetCeilingSF ? `, ceiling ${wetCeilingSF} SF` : '') +
      `).`
    : injectidryRecommended
      ? `Cavity wet; finish salvageable on Cat ${category} — plan injectidry instead of flood cut; ${airMoversRequired} air movers for remaining wet surfaces.`
      : wetFloorSF > 0
        ? `No flood cut planned — ${airMoversRequired} air movers for ${wetFloorSF} SF wet floor.`
        : 'No wet surfaces requiring equipment in this room.';

  return {
    roomId: room.id,
    roomName: room.name,
    cutHeightIn,
    openWallSF,
    wetFloorSF,
    wetCeilingSF,
    airMoversRequired,
    injectidryRecommended,
    floodCutRequired,
    rationale,
  };
}

/** Public helper: movers required for an explicit cut height (e.g. 24" / 2 ft). */
export function airMoversForFloodCut(input: {
  perimeterLF: number;
  cutHeightIn: number;
  wetFloorSF: number;
  wetCeilingSF?: number;
  offsets?: number;
  method?: AirMoverMethod;
}): number {
  const openWallSF = floodCutSF(input.perimeterLF, input.cutHeightIn);
  return sizeAirMovers(
    {
      wetFloorSF: input.wetFloorSF,
      wetWallLF: input.perimeterLF,
      wetWallSF: openWallSF,
      wetCeilingSF: input.wetCeilingSF ?? 0,
      offsets: input.offsets ?? 0,
    },
    input.method ?? 'area',
  );
}

function derivePlanCutHeight(
  room: AssessedRoom,
  category: WaterCategory,
  forced?: number,
): number {
  if (forced && forced > 0) return forced;
  if (room.documentedCutHeightIn && room.documentedCutHeightIn > 0) {
    return room.documentedCutHeightIn;
  }

  const wetHeights = room.materials
    .filter((m) => m.surface === 'wall' && m.wetHeightIn)
    .map((m) => m.wetHeightIn!) as number[];
  const wetLine = wetHeights.length > 0 ? Math.max(...wetHeights) : 12;
  const withClearance = wetLine + 12;
  let rounded = DEFAULT_CUT_DIVISIONS.find((d) => d >= withClearance) ?? Math.ceil(withClearance / 12) * 12;
  if (category === 3) rounded = Math.max(rounded, 24);
  return rounded;
}

function wetWallBandSF(room: AssessedRoom): number {
  const heights = room.materials
    .filter((m) => m.surface === 'wall' && m.material !== 'baseboard' && m.material !== 'cabinetry')
    .map((m) => (m.wetHeightIn ?? 0) / 12);
  if (heights.length === 0 || room.geometry.perimeterLF <= 0) return 0;
  const bandFt = Math.max(...heights);
  if (bandFt <= 0) return 0;
  return round(Math.min(room.geometry.wallSF, room.geometry.perimeterLF * bandFt));
}

function inferBillingMode(assessment: LossAssessment): EquipmentBillingMode {
  return assessment.equipment.length > 0 ? 'max' : 'recommended';
}

function mergeWithLog(
  planLines: EquipmentPlanLine[],
  log: EquipmentPlacement[],
  days: number,
  mode: EquipmentBillingMode,
): { lines: EquipmentPlanLine[]; warnings: string[] } {
  const warnings: string[] = [];
  if (mode === 'recommended' || log.length === 0) {
    return { lines: planLines.map((l) => ({ ...l, source: 'plan' as const })), warnings };
  }

  const logTotals = new Map<EquipmentKind, number>();
  for (const placement of log) {
    const unitDays = placement.quantity * (placement.days ?? days);
    logTotals.set(placement.kind, (logTotals.get(placement.kind) ?? 0) + unitDays);
  }

  const kinds = new Set<EquipmentKind>([
    ...planLines.map((l) => l.kind),
    ...([...logTotals.keys()] as EquipmentKind[]),
  ]);

  const lines: EquipmentPlanLine[] = [];
  for (const kind of kinds) {
    const plan = planLines.find((l) => l.kind === kind);
    const logUnitDays = logTotals.get(kind) ?? 0;
    const logUnits = log
      .filter((p) => p.kind === kind)
      .reduce((sum, p) => sum + p.quantity, 0);
    const planUnits = plan?.units ?? 0;
    const planUnitDays = plan?.unitDays ?? 0;

    if (mode === 'as_logged') {
      if (logUnitDays <= 0) {
        if (plan) {
          warnings.push(
            `Plan calls for ${plan.units} ${kind.replace(/_/g, ' ')}(s) but none were logged — add to the drying report or the estimate under-bills.`,
          );
          lines.push({ ...plan, source: 'plan' });
        }
        continue;
      }
      if (plan && logUnits < planUnits) {
        warnings.push(
          `Under-equipped on ${kind.replace(/_/g, ' ')}: log has ${logUnits}, plan requires ${planUnits}.`,
        );
      }
      lines.push({
        kind,
        units: logUnits,
        days,
        unitDays: logUnitDays,
        source: 'log',
        rationale: plan
          ? `Logged ${logUnits} (plan ${planUnits}). ${plan.rationale}`
          : `Logged ${logUnits} unit-days ${logUnitDays}.`,
      });
      continue;
    }

    // max — bill the greater of plan vs log so progress never under-scopes
    const units = Math.max(planUnits, logUnits);
    const unitDays = Math.max(planUnitDays, logUnitDays);
    if (units <= 0) continue;
    if (plan && logUnits > 0 && logUnits < planUnits) {
      warnings.push(
        `Under-equipped on ${kind.replace(/_/g, ' ')}: log ${logUnits} < plan ${planUnits} — billing plan count.`,
      );
    }
    lines.push({
      kind,
      units,
      days,
      unitDays,
      source: logUnits > 0 && planUnits > 0 ? 'merged' : planUnits > 0 ? 'plan' : 'log',
      rationale: plan?.rationale ?? `From equipment log (${logUnits} units).`,
    });
  }

  return { lines, warnings };
}

function linesToPlacements(lines: EquipmentPlanLine[], placedAt?: string): EquipmentPlacement[] {
  const at = placedAt ?? new Date().toISOString();
  return lines
    .filter((l) => l.units > 0)
    .map((l) => ({
      kind: l.kind,
      quantity: l.units,
      placedAt: at,
      days: l.days,
    }));
}
