import { floodCutSF, round } from '../lib/geometry.js';
import { buildEquipmentPlan } from '../planning/equipmentPlan.js';
import type {
  AffectedMaterial,
  Evidence,
  LossAssessment,
  ScopeItem,
  WaterCategory,
} from '../types.js';

/**
 * Scope derivation — the estimating judgement, in one place.
 *
 * Each rule answers one question: given what the sources documented, what work
 * did this loss require? The output is still in restoration language, not
 * Xactimate's; the translation happens in `mapping.ts`.
 *
 * Two properties matter more than any individual rule:
 *
 * 1. **Every item carries its justification and its evidence.** An item with
 *    neither is an item that gets struck on review, so the estimator never
 *    writes one. `citations` names the IICRC requirements the decision rests on
 *    by registry id, never by a section number typed in here — see
 *    `standards/s500.ts` for why that indirection is not ceremony.
 *
 * 2. **Rules are conservative about adding work and aggressive about not
 *    dropping it.** The way mitigation jobs lose money is almost never a missing
 *    line item nobody performed — it is a line item the crew *did* perform and
 *    nobody wrote down. So the rules scope what the documentation supports, in
 *    full, and flag rather than guess.
 */

/** Scope-derivation knobs an org can tune without touching rule logic. */
export interface ScopeOptions {
  /** Flood-cut height in inches for Category 3 losses. */
  category3CutHeightIn: number;
  /** Minimum flood-cut height when a wall cavity is wet. */
  minimumCutHeightIn: number;
  /** Clearance added above the highest wet reading before rounding up. */
  cutClearanceIn: number;
  /** Billable hours per monitoring visit — readings, notes, photos, travel. */
  hoursPerMonitoringVisit: number;
  /** Hours of setup labour per piece of equipment placed. */
  setupHoursPerUnit: number;
  /** Technicians on site per day, for PPE. */
  techniciansOnSite: number;
  /** Usable cubic yards per debris haul. */
  cubicYardsPerLoad: number;
  /** Content-manipulation hours per 100 SF of affected floor. */
  contentHoursPer100SF: number;
  /**
   * How equipment days are billed:
   * - recommended — S500 coverage plan (smart default when no log)
   * - as_logged — only what the equipment log recorded
   * - max — greater of plan vs log (never under-scope a progressing job)
   */
  equipmentBillingMode?: 'as_logged' | 'recommended' | 'max';
  /** Force plan cut height in inches (e.g. 24 for a standard 2-ft flood cut). */
  planCutHeightIn?: number;
}

export const DEFAULT_SCOPE_OPTIONS: ScopeOptions = {
  category3CutHeightIn: 24,
  minimumCutHeightIn: 12,
  cutClearanceIn: 12,
  hoursPerMonitoringVisit: 1.5,
  setupHoursPerUnit: 0.25,
  techniciansOnSite: 2,
  cubicYardsPerLoad: 2.5,
  contentHoursPer100SF: 0.75,
  equipmentBillingMode: undefined,
  planCutHeightIn: undefined,
};

/** Debris volume per unit of demolished material, in cubic feet. */
const DEBRIS_CF_PER_UNIT: Record<string, number> = {
  carpet: 0.05,
  carpet_pad: 0.04,
  drywall: 0.05, // ½" board, loosely stacked
  ceiling_drywall: 0.05,
  insulation: 0.3, // R-13 batt, uncompressed
  baseboard: 0.02, // per LF
  hard_flooring: 0.08,
  cabinetry: 0.6, // per LF
};

export function deriveScope(
  assessment: LossAssessment,
  options: ScopeOptions = DEFAULT_SCOPE_OPTIONS,
): ScopeItem[] {
  const items: ScopeItem[] = [];
  const evidenceIndex = new EvidenceIndex(assessment.evidence);
  let sequence = 0;

  const add = (item: Omit<ScopeItem, 'id'>): void => {
    if (item.quantity <= 0) return;
    items.push({ ...item, id: `scope-${(sequence += 1)}`, quantity: round(item.quantity) });
  };

  const demolished: Array<{ material: string; quantity: number }> = [];

  /* ---- Per-room rules --------------------------------------------- */

  for (const room of assessment.rooms) {
    const wetFloorSF = round(room.geometry.floorSF * room.affectedFloorFraction);

    // 1. Extraction. Standing water comes out before anything else happens, and
    //    it is billed against the wet floor area regardless of what covers it.
    const floorMaterials = room.materials.filter((m) => m.surface === 'floor');
    const hasCarpet = floorMaterials.some((m) => m.material === 'carpet');
    if (wetFloorSF > 0 && floorMaterials.length > 0) {
      add({
        roomId: room.id,
        rule: 'extraction',
        description: `Extract standing water from ${room.name}`,
        quantity: wetFloorSF,
        unit: 'SF',
        justification: `${wetFloorSF} SF of the ${room.geometry.floorSF} SF floor in ${room.name} was affected. Bulk water removal precedes evaporative drying — every gallon extracted is a gallon the dehumidifiers do not have to pull.`,
        citations: ['WATER_EXTRACTION_FIRST'],
        evidenceIds: evidenceIndex.match(room.id, ['extraction', 'before', 'photo']),
        tags: ['extraction', hasCarpet ? 'carpet' : 'hard_surface'],
      });
    }

    // 2. Flooring. Category decides salvageability far more than saturation does:
    //    porous floor coverings cannot be returned to a Category 3 standard.
    for (const material of floorMaterials) {
      const decision = flooringDecision(material, assessment.category);
      if (decision === 'keep') continue;

      const quantity = round(Math.min(material.quantity, room.geometry.floorSF) * room.affectedFloorFraction);
      const tagKey =
        material.material === 'carpet'
          ? 'carpet'
          : material.material === 'carpet_pad'
            ? 'carpet_pad'
            : 'hard_flooring';

      add({
        roomId: room.id,
        rule: `tear_out_${material.material}`,
        description: `Remove and dispose of ${label(material.material)} in ${room.name}`,
        quantity,
        unit: 'SF',
        justification: justifyFlooring(material, assessment.category, room.name),
        citations:
          assessment.category === 3
            ? ['POROUS_MATERIAL_REMOVAL_CAT3', 'SALVAGEABILITY_ASSESSMENT']
            : ['SALVAGEABILITY_ASSESSMENT'],
        evidenceIds: evidenceIndex.match(room.id, [tagKey, 'before', 'photo']),
        tags: ['tear_out', tagKey],
      });
      demolished.push({ material: tagKey === 'hard_flooring' ? 'hard_flooring' : material.material, quantity });
    }

    // 3. Walls. A flood cut is 12 inches above the highest wet reading, rounded
    //    up to a full sheet division so the rebuild lands on framing — and never
    //    less than 24 inches on a Category 3 loss.
    const wallMaterials = room.materials.filter((m) => m.surface === 'wall');
    for (const material of wallMaterials) {
      if (material.material === 'baseboard') continue; // handled below
      if (material.material === 'cabinetry') continue; // handled below
      if (!needsWallRemoval(material, assessment.category)) continue;

      const derivedCutIn = floodCutHeight(material, assessment.category, options);
      // A cut the crew documented is what actually happened; the derivation is
      // only a stand-in for when nobody wrote it down.
      const cutHeightIn = room.documentedCutHeightIn ?? derivedCutIn;
      const quantity = floodCutSF(room.geometry.perimeterLF, cutHeightIn);

      add({
        roomId: room.id,
        rule: 'flood_cut',
        description: `Flood cut ${label(material.material)} to ${cutHeightIn}" in ${room.name}`,
        quantity,
        unit: 'SF',
        justification: `Moisture reached ${material.wetHeightIn ?? 'an undocumented height'}${material.wetHeightIn ? '"' : ''} on the walls of ${room.name}. ${
          room.documentedCutHeightIn
            ? `The crew documented a cut at ${cutHeightIn}", which is what is billed here.`
            : `Cut set at ${cutHeightIn}" — ${options.cutClearanceIn}" above the wet line, rounded to a framing division${assessment.category === 3 ? `, and never below ${options.category3CutHeightIn}" on a Category 3 loss` : ''}.`
        } ${material.cavityWet ? 'The wall cavity was wet, so drying in place would have trapped moisture behind the finish.' : ''}`,
        citations: ['FLOOD_CUT_HEIGHT', 'WALL_CAVITY_ACCESS'],
        evidenceIds: evidenceIndex.match(room.id, ['flood_cut', 'drywall', 'photo']),
        tags: ['tear_out', 'drywall', 'flood_cut'],
      });
      demolished.push({ material: 'drywall', quantity });

      // 4. Insulation follows the cut whenever the cavity is wet — it holds
      //    water for weeks and no amount of airflow reaches it behind a finish.
      if (material.cavityWet) {
        add({
          roomId: room.id,
          rule: 'insulation_removal',
          description: `Remove wet insulation from open wall cavity in ${room.name}`,
          quantity,
          unit: 'SF',
          justification: `The wall cavity in ${room.name} was wet behind the finish. Batt insulation retains moisture long after the surrounding framing dries and will support microbial growth if left in place.`,
          citations: ['WALL_CAVITY_ACCESS', 'SALVAGEABILITY_ASSESSMENT'],
          evidenceIds: evidenceIndex.match(room.id, ['insulation', 'flood_cut', 'photo']),
          tags: ['tear_out', 'insulation'],
        });
        demolished.push({ material: 'insulation', quantity });
      }

      // 5. Baseboard comes off before any wall cut. It is a separate line item
      //    and it is one of the most commonly forgotten ones on the estimate.
      add({
        roomId: room.id,
        rule: 'baseboard_removal',
        description: `Remove wet baseboard in ${room.name}`,
        quantity: room.geometry.perimeterLF,
        unit: 'LF',
        justification: `Baseboard in ${room.name} had to come off to make the flood cut and to open the wall base for airflow. Trim wicks water along its length well past the visible wet line.`,
        citations: ['WALL_CAVITY_ACCESS'],
        evidenceIds: evidenceIndex.match(room.id, ['baseboard', 'flood_cut', 'photo']),
        tags: ['tear_out', 'baseboard'],
      });
      demolished.push({ material: 'baseboard', quantity: room.geometry.perimeterLF });
      break; // one wall assembly decision per room
    }

    // 6. Ceilings — water from above soaks the board and the insulation over it.
    if (room.ceilingAffected) {
      add({
        roomId: room.id,
        rule: 'ceiling_removal',
        description: `Remove wet ceiling drywall in ${room.name}`,
        quantity: room.geometry.ceilingSF,
        unit: 'SF',
        justification: `Water entered ${room.name} from above and saturated the ceiling assembly. Gypsum loses structural integrity once wet overhead and cannot be dried in place safely.`,
        citations: ['SALVAGEABILITY_ASSESSMENT'],
        evidenceIds: evidenceIndex.match(room.id, ['ceiling', 'photo']),
        tags: ['tear_out', 'ceiling'],
      });
      demolished.push({ material: 'ceiling_drywall', quantity: room.geometry.ceilingSF });
    }

    // 7. Cabinetry — the toe kick is the lowest cavity in the room and it is
    //    always wet when the floor was.
    const cabinetry = room.materials.find((m) => m.material === 'cabinetry');
    if (cabinetry) {
      add({
        roomId: room.id,
        rule: 'cabinet_toe_kick',
        description: `Detach cabinet toe kick for cavity drying in ${room.name}`,
        quantity: cabinetry.quantity,
        unit: 'LF',
        justification: `Water reached the cabinet run in ${room.name}. The toe-kick cavity is unvented and cannot dry without being opened; leaving it closed is how a "dry" job comes back with odour.`,
        citations: ['WALL_CAVITY_ACCESS'],
        evidenceIds: evidenceIndex.match(room.id, ['cabinetry', 'photo']),
        tags: ['tear_out', 'cabinetry'],
      });
      demolished.push({ material: 'cabinetry', quantity: cabinetry.quantity });
    }

    // 8. Antimicrobial on every affected surface of a contaminated loss — not
    //    just the floor, which is how it is usually under-billed.
    if (assessment.category >= 2) {
      const treatedSF = round(
        wetFloorSF +
          room.geometry.perimeterLF * 2 + // treated wall band at the base
          (room.ceilingAffected ? room.geometry.ceilingSF : 0),
      );
      add({
        roomId: room.id,
        rule: 'antimicrobial',
        description: `Apply antimicrobial to affected surfaces in ${room.name}`,
        quantity: treatedSF,
        unit: 'SF',
        justification: `Category ${assessment.category} water contacted ${room.name}. An EPA-registered antimicrobial is applied to all affected surfaces after removal of non-salvageable materials and before drying, to control amplification during the drying period.`,
        citations: ['ANTIMICROBIAL_APPLICATION', 'CLEANING_BEFORE_ANTIMICROBIAL'],
        evidenceIds: evidenceIndex.match(room.id, ['antimicrobial', 'category_3', 'category_2', 'photo']),
        tags: ['antimicrobial'],
      });
    }

    // 9. Content manipulation — performed on nearly every job, billed on far
    //    fewer. Floors cannot be extracted or dried under furniture.
    if (wetFloorSF > 0) {
      add({
        roomId: room.id,
        rule: 'content_manipulation',
        description: `Move and reset contents in ${room.name}`,
        quantity: round((wetFloorSF / 100) * options.contentHoursPer100SF, 2),
        unit: 'HR',
        justification: `Contents in ${room.name} had to be moved to expose ${wetFloorSF} SF of affected floor for extraction, treatment and airflow, then reset. This is billable labour separate from the drying line items.`,
        citations: ['CONTENTS_HANDLING'],
        evidenceIds: evidenceIndex.match(room.id, ['contents', 'before', 'photo']),
        tags: ['contents', 'labor'],
      });
    }

    // 10. HEPA vacuum after demolition. Demolition liberates the contamination
    //     the demolition was performed to remove.
    if (roomHadDemolition(items, room.id) && assessment.category >= 2) {
      add({
        roomId: room.id,
        rule: 'hepa_vacuum',
        description: `HEPA vacuum ${room.name} after demolition`,
        quantity: round(room.geometry.floorSF + room.geometry.perimeterLF * 2),
        unit: 'SF',
        justification: `Demolition in ${room.name} released settled contamination and gypsum dust. HEPA vacuuming of floors and the exposed wall base is the post-demolition cleaning step required before the space is released.`,
        citations: ['POST_DEMOLITION_CLEANING'],
        evidenceIds: evidenceIndex.match(room.id, ['hepa', 'after', 'photo']),
        tags: ['hepa', 'post_demolition'],
      });
    }
  }

  /* ---- Job-level rules -------------------------------------------- */

  const totalWetFloorSF = assessment.rooms.reduce(
    (sum, room) => sum + room.geometry.floorSF * room.affectedFloorFraction,
    0,
  );

  // 11. Containment. Category 3 and microbial work are performed inside a
  //     barrier so the demolition does not spread the problem through the house.
  if (assessment.containmentRequired) {
    const barrierSF = round(
      assessment.rooms.reduce((sum, room) => sum + room.geometry.heightFt * room.geometry.widthFt, 0),
    );
    add({
      rule: 'containment',
      description: 'Erect containment barrier around the affected area',
      quantity: barrierSF,
      unit: 'SF',
      justification: `${assessment.microbialGrowthPresent ? 'Microbial growth was documented' : `Category ${assessment.category} water was present`}, so demolition was performed inside a sealed containment to prevent cross-contamination of unaffected areas.`,
      citations: ['CONTAINMENT'],
      evidenceIds: evidenceIndex.match(undefined, ['containment', 'photo']),
      tags: ['containment'],
    });

    add({
      rule: 'negative_pressure',
      description: 'Establish and monitor negative pressure within containment',
      quantity: 1,
      unit: 'EA',
      justification:
        'Containment is only effective under negative pressure. Setup, manometer verification and daily monitoring are billable separately from the air scrubber rental.',
      citations: ['NEGATIVE_PRESSURE', 'CONTAINMENT'],
      evidenceIds: evidenceIndex.match(undefined, ['containment', 'air_scrubber', 'photo']),
      tags: ['containment', 'negative_pressure'],
    });
  }

  // 12. PPE for contaminated work, per technician per day.
  if (assessment.category === 3 || assessment.microbialGrowthPresent) {
    add({
      rule: 'ppe',
      description: 'Personal protective equipment for contaminated work',
      quantity: options.techniciansOnSite * Math.max(1, assessment.dryingDays),
      unit: 'DA',
      justification: `Category ${assessment.category}${assessment.microbialGrowthPresent ? ' with documented microbial growth' : ''} requires full PPE — suits, gloves, and respiratory protection — for every technician on site, replaced daily.`,
      citations: ['WORKER_SAFETY_PPE'],
      evidenceIds: evidenceIndex.match(undefined, ['category_3', 'microbial', 'photo']),
      tags: ['ppe'],
    });
  }

  // 13. Deodorization on grossly contaminated losses.
  if (assessment.category === 3) {
    add({
      rule: 'deodorization',
      description: 'Apply odour counteractant to affected areas',
      quantity: round(totalWetFloorSF),
      unit: 'SF',
      justification:
        'Category 3 water leaves organic residue that produces odour after the structure is dry. Counteractant is applied to affected surfaces at the end of the removal phase.',
      citations: ['ANTIMICROBIAL_APPLICATION'],
      evidenceIds: evidenceIndex.match(undefined, ['category_3', 'photo']),
      tags: ['deodorization'],
    });
  }

  // 14. Debris haul, sized from what was actually demolished.
  const debrisCF = demolished.reduce(
    (sum, entry) => sum + entry.quantity * (DEBRIS_CF_PER_UNIT[entry.material] ?? 0.05),
    0,
  );
  const loads = Math.ceil(debrisCF / 27 / options.cubicYardsPerLoad);
  if (loads > 0) {
    add({
      rule: 'debris_haul',
      description: 'Haul demolition debris and pay dump fees',
      quantity: loads,
      unit: 'EA',
      justification: `Demolition produced roughly ${round(debrisCF / 27, 1)} cubic yards of debris — ${loads} load${loads === 1 ? '' : 's'} at ${options.cubicYardsPerLoad} usable CY each. Disposal of Category ${assessment.category} material is a hard cost that is separate from the tear-out line items.`,
      // No citation: disposal is a cost of performing the removal, not an
      // obligation the standard imposes. An empty list is the honest answer and
      // is why `citations` is required-but-allowed-empty rather than optional —
      // it forces the question to be answered at each rule.
      citations: [],
      evidenceIds: evidenceIndex.match(undefined, ['after', 'photo']),
      tags: ['debris'],
    });
  }

  // 15. Floor protection over the path from the work area to the exit.
  if (totalWetFloorSF > 0) {
    add({
      rule: 'floor_protection',
      description: 'Protect unaffected flooring along the work path',
      quantity: round(Math.max(120, totalWetFloorSF * 0.25)),
      unit: 'SF',
      justification:
        'Wet and contaminated material is carried out through unaffected areas. Protecting that path is what prevents a second claim for the floor it was carried across.',
      citations: ['WORK_PATH_PROTECTION'],
      evidenceIds: evidenceIndex.match(undefined, ['containment', 'before', 'photo']),
      tags: ['protection'],
    });
  }

  // 16–18. Equipment and the labour around it.
  items.push(...deriveEquipmentScope(assessment, options, evidenceIndex, () => (sequence += 1)));

  return items;
}

/* ------------------------------------------------------------------ *
 * Equipment scope
 * ------------------------------------------------------------------ */

function deriveEquipmentScope(
  assessment: LossAssessment,
  options: ScopeOptions,
  evidenceIndex: EvidenceIndex,
  nextId: () => number,
): ScopeItem[] {
  const items: ScopeItem[] = [];
  const days = Math.max(1, assessment.dryingDays);

  // Smart plan: movers from open wall SF after the flood cut, dehu from class/CF,
  // scrubbers when containment, injectidry when cavity is salvageable.
  const plan = buildEquipmentPlan(assessment, {
    billingMode: options.equipmentBillingMode,
    planCutHeightIn: options.planCutHeightIn,
    preferInjectidryWhenSalvageable: assessment.category < 3,
  });

  const placements =
    plan.billingMode === 'as_logged' && assessment.equipment.length > 0
      ? assessment.equipment
      : plan.placements;

  const totals = new Map<string, { unitDays: number; units: number; rationale: string }>();
  for (const placement of placements) {
    const unitDays = placement.quantity * (placement.days ?? days);
    const existing = totals.get(placement.kind);
    const planLine = plan.lines.find((l) => l.kind === placement.kind);
    totals.set(placement.kind, {
      unitDays: (existing?.unitDays ?? 0) + unitDays,
      units: (existing?.units ?? 0) + placement.quantity,
      rationale: planLine?.rationale ?? existing?.rationale ?? '',
    });
  }

  // When a log exists, still add plan-only kinds the crew never logged.
  if (plan.billingMode !== 'recommended') {
    for (const line of plan.lines) {
      if (totals.has(line.kind)) continue;
      totals.set(line.kind, {
        unitDays: line.unitDays,
        units: line.units,
        rationale: `${line.rationale} (added from S500 plan — not in the equipment log).`,
      });
    }
  }

  const EQUIPMENT_LABELS: Record<string, string> = {
    air_mover: 'air mover',
    axial_air_mover: 'axial air mover',
    dehumidifier_lgr: 'LGR dehumidifier',
    dehumidifier_conventional: 'dehumidifier',
    dehumidifier_desiccant: 'desiccant dehumidifier',
    air_scrubber: 'air scrubber / negative air machine',
    heater: 'portable heater',
    injectidry: 'wall cavity drying system',
  };

  let totalUnits = 0;

  for (const [kind, { unitDays, units, rationale }] of totals) {
    if (unitDays <= 0) continue;
    totalUnits += units;

    items.push({
      id: `scope-${nextId()}`,
      rule: `equipment_${kind}`,
      description: `${EQUIPMENT_LABELS[kind] ?? kind} — ${units} unit${units === 1 ? '' : 's'} × billed days`,
      quantity: round(unitDays),
      unit: 'DA',
      justification:
        rationale ||
        `${units} ${EQUIPMENT_LABELS[kind] ?? kind}${units === 1 ? '' : 's'} on a Class ${assessment.class} loss for ${round(unitDays)} unit-days. Equipment is billed per 24-hour period.`,
      citations: ['DEHUMIDIFICATION_SIZING', 'AIRFLOW_SIZING'],
      evidenceIds: evidenceIndex.match(undefined, [equipmentTag(kind), 'photo']),
      tags: ['equipment', kind],
    });
  }

  if (totalUnits > 0) {
    items.push({
      id: `scope-${nextId()}`,
      rule: 'equipment_setup',
      description: 'Equipment setup and take down',
      quantity: round(totalUnits * options.setupHoursPerUnit * 2, 2),
      unit: 'HR',
      justification: `${totalUnits} pieces of equipment were placed and later removed. Setup and take-down labour is billed hourly and is not included in the per-day equipment rate.`,
      citations: ['AIRFLOW_SIZING'],
      evidenceIds: evidenceIndex.match(undefined, ['air_mover', 'dehumidifier', 'photo']),
      tags: ['labor', 'monitoring'],
    });
  }

  if (assessment.monitoringVisits > 0) {
    items.push({
      id: `scope-${nextId()}`,
      rule: 'monitoring',
      description: 'Daily monitoring visits — readings, documentation and adjustment',
      quantity: round(assessment.monitoringVisits * options.hoursPerMonitoringVisit, 2),
      unit: 'HR',
      justification: `${assessment.monitoringVisits} monitoring visits were performed at ${options.hoursPerMonitoringVisit} billable hours each. Each visit covers moisture readings against the dry standard, psychrometric logging, equipment repositioning and photo documentation — the record that supports the whole estimate.`,
      citations: ['MONITORING_AND_DOCUMENTATION', 'PSYCHROMETRIC_DOCUMENTATION'],
      evidenceIds: evidenceIndex.match(undefined, ['monitoring', 'moisture_reading']),
      tags: ['labor', 'monitoring'],
    });
  }

  return items;
}

function equipmentTag(kind: string): string {
  if (kind.includes('dehumidifier')) return 'dehumidifier';
  if (kind.includes('scrubber')) return 'air_scrubber';
  return 'air_mover';
}

/* ------------------------------------------------------------------ *
 * Material decisions
 * ------------------------------------------------------------------ */

type FlooringDecision = 'keep' | 'remove';

/**
 * Whether a floor covering comes out.
 *
 * Category 3 removes every porous covering, full stop — it cannot be cleaned to
 * a safe standard. Category 2 removes the pad (which is a sponge) but carpet may
 * be salvageable if the technician judged it so. Category 1 dries in place
 * unless the technician marked the material non-salvageable.
 */
function flooringDecision(material: AffectedMaterial, category: WaterCategory): FlooringDecision {
  if (category === 3) return material.porous ? 'remove' : 'keep';
  if (category === 2) {
    if (material.material === 'carpet_pad') return 'remove';
    return material.salvageable ? 'keep' : 'remove';
  }
  return material.salvageable ? 'keep' : 'remove';
}

function justifyFlooring(
  material: AffectedMaterial,
  category: WaterCategory,
  roomName: string,
): string {
  if (category === 3) {
    return `Category 3 water contacted ${label(material.material)} in ${roomName}. Porous materials cannot be returned to a Category 3 sanitary standard by cleaning, so they are removed and disposed of rather than dried.`;
  }
  if (category === 2 && material.material === 'carpet_pad') {
    return `Carpet pad in ${roomName} held Category 2 water. Pad is a high-retention porous material that will not dry through the carpet above it and is removed as a matter of course on any Category 2 loss.`;
  }
  return `${label(material.material)} in ${roomName} was assessed as non-salvageable — the material was either delaminating or held moisture that would not reach the dry standard within a reasonable drying period.`;
}

/**
 * Whether a wall assembly comes out. A wet cavity is the deciding factor: a
 * surface-wet wall dries, a wet cavity behind a vapour-retarding finish does not.
 */
function needsWallRemoval(material: AffectedMaterial, category: WaterCategory): boolean {
  if (!material.porous) return false;
  if (category === 3) return true;
  if (material.cavityWet) return true;
  return !material.salvageable;
}

/**
 * Flood-cut height: 12 inches above the highest wet reading, rounded up to the
 * next framing division (12/24/48), and never below 24 inches on Category 3.
 */
function floodCutHeight(
  material: AffectedMaterial,
  category: WaterCategory,
  options: ScopeOptions,
): number {
  const wetHeight = material.wetHeightIn ?? options.minimumCutHeightIn;
  const withClearance = wetHeight + options.cutClearanceIn;

  const divisions = [12, 24, 48];
  const rounded = divisions.find((division) => division >= withClearance) ?? Math.ceil(withClearance / 12) * 12;

  return category === 3 ? Math.max(rounded, options.category3CutHeightIn) : rounded;
}

function roomHadDemolition(items: ScopeItem[], roomId: string): boolean {
  return items.some((item) => item.roomId === roomId && item.tags.includes('tear_out'));
}

const MATERIAL_LABELS: Record<string, string> = {
  carpet: 'carpet',
  carpet_pad: 'carpet pad',
  hardwood: 'hardwood flooring',
  engineered_wood: 'engineered wood flooring',
  laminate: 'laminate flooring',
  vinyl_plank: 'luxury vinyl plank',
  sheet_vinyl: 'sheet vinyl',
  tile: 'tile',
  concrete: 'concrete',
  drywall: 'drywall',
  plaster: 'plaster',
  insulation: 'insulation',
  baseboard: 'baseboard',
  cabinetry: 'cabinetry',
  subfloor_wood: 'wood subfloor',
  ceiling_drywall: 'ceiling drywall',
  contents: 'contents',
};

function label(material: string): string {
  return MATERIAL_LABELS[material] ?? material.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Evidence lookup
 * ------------------------------------------------------------------ */

/**
 * Finds the evidence that substantiates a scope item.
 *
 * Room-scoped evidence is preferred; job-wide evidence (a photo of the
 * containment, say) is accepted as a fallback. Matching is by tag, which is why
 * `photos.ts` works so hard to derive tags from captions.
 */
class EvidenceIndex {
  constructor(private readonly evidence: Evidence[]) {}

  forRoom(roomId: string): Evidence[] {
    return this.evidence.filter((item) => item.roomId === roomId);
  }

  match(roomId: string | undefined, tags: string[]): string[] {
    const scoped = roomId ? this.forRoom(roomId) : this.evidence;
    const hits = scoped.filter((item) => tags.some((tag) => item.tags.includes(tag)));
    if (hits.length > 0) return hits.map((item) => item.id);

    // Fall back to job-wide evidence when nothing room-specific exists.
    if (roomId) {
      return this.evidence
        .filter((item) => !item.roomId && tags.some((tag) => item.tags.includes(tag)))
        .map((item) => item.id);
    }
    return [];
  }
}
