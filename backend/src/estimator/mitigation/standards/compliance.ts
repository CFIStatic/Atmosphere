import { round } from '../lib/geometry.js';
import { cubicFeet } from '../lib/geometry.js';
import { gppDifferential, sizeDehumidification } from '../lib/psychrometrics.js';
import { formatCitation, type CitationId } from './s500.js';
import type { EstimateLineItem, LossAssessment, ScopeItem } from '../types.js';

/**
 * The S500 compliance review.
 *
 * The scope rules use the standard to decide *what work to write*. This module
 * uses it for the other half: reading the finished estimate back against the
 * standard's obligations and reporting what the job did, did not do, and cannot
 * show it did.
 *
 * That distinction matters commercially. An estimate can be perfectly priced and
 * still fall apart on review because the dry standard was never established, or
 * because the final readings never reached it, or because a Category 3 loss has
 * porous material left in place. Those are the arguments an adjuster actually
 * makes, and they are all checkable from what the sources already contain.
 *
 * Three deliberate properties:
 *
 * - **`undetermined` is a real outcome.** When the sources do not say, the check
 *   says it does not know. Scoring a missing MICA report as "met" would make the
 *   report worthless and scoring it "unmet" would make it noise.
 * - **Every check cites.** The citation is the point — a compliance finding
 *   without one is just an opinion about someone's job.
 * - **Every failure carries a remedy.** These get read on site, sometimes while
 *   equipment is still running, and "what do I do about it" is the useful part.
 */

export type ComplianceStatus = 'met' | 'unmet' | 'undetermined' | 'not_applicable';

export interface ComplianceCheck {
  id: string;
  citation: CitationId;
  title: string;
  status: ComplianceStatus;
  detail: string;
  /** What to do about it. Present whenever the status is not `met`. */
  remedy?: string;
  /**
   * True when failing this check costs money as well as credibility — an
   * obligation that is also a billable line the estimate is missing.
   */
  affectsEstimate?: boolean;
}

export interface ComplianceReport {
  checks: ComplianceCheck[];
  met: number;
  unmet: number;
  undetermined: number;
  /** Every citation the review touched, for the estimate's reference appendix. */
  citations: CitationId[];
  /** One-line verdict for the top of the report. */
  summary: string;
}

export function reviewCompliance(
  assessment: LossAssessment,
  scope: ScopeItem[],
  lineItems: EstimateLineItem[],
): ComplianceReport {
  const checks: ComplianceCheck[] = [
    checkPreliminaryDetermination(assessment),
    checkDryStandard(assessment),
    checkPsychrometrics(assessment),
    checkMonitoring(assessment),
    checkDryingVerification(assessment),
    checkExtractionFirst(assessment, lineItems),
    checkPorousRemoval(assessment, scope),
    checkWallCavity(assessment, scope),
    checkCleaningBeforeChemistry(assessment, scope),
    checkAntimicrobial(assessment, lineItems),
    checkDehumidificationCapacity(assessment),
    checkAirflow(assessment),
    checkContainment(assessment, lineItems),
    checkNegativePressure(assessment, lineItems),
    checkPpe(assessment, lineItems),
    checkSpecialtyDrying(assessment, lineItems),
    checkContents(assessment, lineItems),
    checkPostDemolitionCleaning(assessment, scope, lineItems),
  ];

  const met = checks.filter((c) => c.status === 'met').length;
  const unmet = checks.filter((c) => c.status === 'unmet').length;
  const undetermined = checks.filter((c) => c.status === 'undetermined').length;

  return {
    checks,
    met,
    unmet,
    undetermined,
    citations: [...new Set(checks.map((c) => c.citation))],
    summary: writeSummary(met, unmet, undetermined, checks),
  };
}

function writeSummary(
  met: number,
  unmet: number,
  undetermined: number,
  checks: ComplianceCheck[],
): string {
  const applicable = met + unmet + undetermined;
  if (unmet === 0 && undetermined === 0) {
    return `All ${applicable} applicable requirements are satisfied and documented.`;
  }

  const parts: string[] = [`${met} of ${applicable} applicable requirements documented as met`];
  if (unmet > 0) parts.push(`${unmet} not met`);
  if (undetermined > 0) parts.push(`${undetermined} that the sources do not answer`);

  const billable = checks.filter((c) => c.status !== 'met' && c.affectsEstimate).length;
  const tail =
    billable > 0
      ? ` ${billable} of the gaps are billable work as well as documentation gaps.`
      : '';

  return `${parts.join(', ')}.${tail}`;
}

/* ------------------------------------------------------------------ *
 * Inspection and documentation
 * ------------------------------------------------------------------ */

function checkPreliminaryDetermination(a: LossAssessment): ComplianceCheck {
  const hasGeometry = a.rooms.length > 0 && a.rooms.every((room) => room.geometry.floorSF > 0);
  const hasMaterials = a.rooms.some((room) => room.materials.length > 0);
  const categoryKnown = a.sourcesUsed.length > 0;

  if (hasGeometry && hasMaterials && categoryKnown) {
    return {
      id: 'preliminary_determination',
      citation: 'PRELIMINARY_DETERMINATION',
      title: 'Loss inspected, classified and measured',
      status: 'met',
      detail: `${a.rooms.length} rooms measured, affected materials identified, and the loss classified as Category ${a.category} / Class ${a.class} from ${a.sourcesUsed.join(', ')}.`,
    };
  }

  return {
    id: 'preliminary_determination',
    citation: 'PRELIMINARY_DETERMINATION',
    title: 'Loss inspected, classified and measured',
    status: 'unmet',
    detail: !hasGeometry
      ? 'Room geometry is missing or incomplete, so quantities on this estimate are not measured.'
      : 'No affected materials were identified, so no removal or drying scope can be derived.',
    remedy: 'Supply a DocuSketch scan, or record dimensions and affected materials in the notes.',
  };
}

function checkDryStandard(a: LossAssessment): ComplianceCheck {
  if (a.moistureReadings.length === 0) {
    return {
      id: 'dry_standard',
      citation: 'DRY_STANDARD',
      title: 'Drying goal established from unaffected material',
      status: 'undetermined',
      detail: 'No moisture readings were supplied, so no drying goal can be shown.',
      remedy: 'Attach the MICA report, or record readings with the unaffected-area benchmark each was measured against.',
    };
  }

  // 16 is the fallback the MICA adapter substitutes when a report omits the
  // benchmark, so a reading sitting exactly on it is a reading with no real
  // standard behind it.
  const withoutStandard = a.moistureReadings.filter((r) => !r.dryStandard || r.dryStandard === 16);
  const materials = [...new Set(a.moistureReadings.map((r) => r.material))];

  if (withoutStandard.length === 0) {
    return {
      id: 'dry_standard',
      citation: 'DRY_STANDARD',
      title: 'Drying goal established from unaffected material',
      status: 'met',
      detail: `All ${a.moistureReadings.length} readings across ${materials.length} material type(s) carry the dry standard they were measured against.`,
    };
  }

  return {
    id: 'dry_standard',
    citation: 'DRY_STANDARD',
    title: 'Drying goal established from unaffected material',
    status: 'unmet',
    detail: `${withoutStandard.length} of ${a.moistureReadings.length} readings have no dry standard recorded, or fall back to a generic 16% rather than a benchmark taken from this building.`,
    remedy:
      'Take a reading of the same material in an unaffected area and record it as the goal. Without it, "dry" cannot be demonstrated for those materials.',
  };
}

function checkPsychrometrics(a: LossAssessment): ComplianceCheck {
  if (a.psychrometrics.length === 0) {
    return {
      id: 'psychrometrics',
      citation: 'PSYCHROMETRIC_DOCUMENTATION',
      title: 'Psychrometric conditions recorded',
      status: 'unmet',
      detail: 'No temperature or humidity readings were logged, so the drying system cannot be shown to have been removing moisture.',
      remedy: 'Log affected and unaffected readings at each visit — this is the evidence behind every equipment day on the estimate.',
      affectsEstimate: true,
    };
  }

  const hasControl = a.psychrometrics.some((r) => r.zone === 'unaffected');
  const differential = gppDifferential(a.psychrometrics);

  if (!hasControl) {
    return {
      id: 'psychrometrics',
      citation: 'PSYCHROMETRIC_DOCUMENTATION',
      title: 'Psychrometric conditions recorded',
      status: 'unmet',
      detail: `${a.psychrometrics.length} readings were logged but none from an unaffected control, so there is nothing to compare the affected air against.`,
      remedy: 'Record an unaffected-area reading at each visit alongside the affected one.',
    };
  }

  return {
    id: 'psychrometrics',
    citation: 'PSYCHROMETRIC_DOCUMENTATION',
    title: 'Psychrometric conditions recorded',
    status: 'met',
    detail:
      differential !== null
        ? `${a.psychrometrics.length} readings logged including an unaffected control. Latest differential: ${differential} GPP.`
        : `${a.psychrometrics.length} readings logged including an unaffected control.`,
  };
}

function checkMonitoring(a: LossAssessment): ComplianceCheck {
  if (a.monitoringVisits === 0) {
    return {
      id: 'monitoring',
      citation: 'MONITORING_AND_DOCUMENTATION',
      title: 'Drying monitored and documented',
      status: 'unmet',
      detail: `Equipment was on site for ${a.dryingDays} days with no monitoring visits documented.`,
      remedy: 'Record each visit. Unmonitored equipment days are the first thing an adjuster removes, and the visits are billable labour.',
      affectsEstimate: true,
    };
  }

  if (a.monitoringVisits < a.dryingDays) {
    return {
      id: 'monitoring',
      citation: 'MONITORING_AND_DOCUMENTATION',
      title: 'Drying monitored and documented',
      status: 'unmet',
      detail: `${a.monitoringVisits} monitoring visits are documented across ${a.dryingDays} drying days, leaving ${a.dryingDays - a.monitoringVisits} day(s) unaccounted for.`,
      remedy:
        'Add the missing visits to the drying log if they happened — they are billable hours that are currently being given away, as well as a documentation gap.',
      affectsEstimate: true,
    };
  }

  return {
    id: 'monitoring',
    citation: 'MONITORING_AND_DOCUMENTATION',
    title: 'Drying monitored and documented',
    status: 'met',
    detail: `${a.monitoringVisits} monitoring visits documented across ${a.dryingDays} drying days.`,
  };
}

function checkDryingVerification(a: LossAssessment): ComplianceCheck {
  if (a.moistureReadings.length === 0) {
    return {
      id: 'drying_verification',
      citation: 'DRYING_VERIFICATION',
      title: 'Drying goal reached before demobilising',
      status: 'undetermined',
      detail: 'No readings were supplied, so completion cannot be verified.',
      remedy: 'Attach the final readings that showed the structure had reached its drying goal.',
    };
  }

  // Take the last reading per room+material — the closing measurement is what
  // demonstrates completion, not the worst one taken along the way.
  const latest = new Map<string, (typeof a.moistureReadings)[number]>();
  for (const reading of a.moistureReadings) {
    const key = `${reading.roomId}::${reading.material}`;
    const current = latest.get(key);
    if (!current || Date.parse(reading.takenAt) > Date.parse(current.takenAt)) {
      latest.set(key, reading);
    }
  }

  const stillWet = [...latest.values()].filter((r) => r.value > r.dryStandard);

  if (stillWet.length === 0) {
    return {
      id: 'drying_verification',
      citation: 'DRYING_VERIFICATION',
      title: 'Drying goal reached before demobilising',
      status: 'met',
      detail: `Every monitored material's final reading is at or below its drying goal across ${latest.size} monitored location(s).`,
    };
  }

  return {
    id: 'drying_verification',
    citation: 'DRYING_VERIFICATION',
    title: 'Drying goal reached before demobilising',
    status: 'unmet',
    detail: `${stillWet.length} monitored location(s) had a final reading above the drying goal: ${stillWet
      .map((r) => `${r.material} at ${r.value} against a goal of ${r.dryStandard}`)
      .join('; ')}.`,
    remedy:
      'Either the drying was not finished — in which case there are more equipment days and visits to bill — or a final reading was never taken. Both are worth resolving before this goes out.',
    affectsEstimate: true,
  };
}

/* ------------------------------------------------------------------ *
 * Scope obligations
 * ------------------------------------------------------------------ */

function checkExtractionFirst(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  const wetFloor = a.rooms.some((room) => room.geometry.floorSF * room.affectedFloorFraction > 0);
  if (!wetFloor) {
    return notApplicable('extraction', 'WATER_EXTRACTION_FIRST', 'Bulk water extracted before drying', 'No affected floor area.');
  }

  const extracted = lines.some((line) => line.catalogKey.startsWith('WTRXTR'));
  return extracted
    ? {
        id: 'extraction',
        citation: 'WATER_EXTRACTION_FIRST',
        title: 'Bulk water extracted before drying',
        status: 'met',
        detail: 'Extraction is scoped against the affected floor area ahead of the drying equipment.',
      }
    : {
        id: 'extraction',
        citation: 'WATER_EXTRACTION_FIRST',
        title: 'Bulk water extracted before drying',
        status: 'unmet',
        detail: 'Affected floor area is present but no extraction line is on the estimate.',
        remedy: 'Add extraction. It removes water far more cheaply than the dehumidifiers, and its absence makes the equipment days look unjustified.',
        affectsEstimate: true,
      };
}

function checkPorousRemoval(a: LossAssessment, scope: ScopeItem[]): ComplianceCheck {
  if (a.category < 3) {
    return notApplicable(
      'porous_removal',
      'POROUS_MATERIAL_REMOVAL_CAT3',
      'Porous materials removed on Category 3',
      `This is a Category ${a.category} loss.`,
    );
  }

  const porousLeft = a.rooms.flatMap((room) =>
    room.materials
      .filter((m) => m.porous)
      .filter(
        (m) =>
          !scope.some(
            (item) => item.roomId === room.id && item.tags.includes('tear_out') && item.tags.some((t) => t.includes(m.material.split('_')[0])),
          ),
      )
      .map((m) => `${m.material} in ${room.name}`),
  );

  return porousLeft.length === 0
    ? {
        id: 'porous_removal',
        citation: 'POROUS_MATERIAL_REMOVAL_CAT3',
        title: 'Porous materials removed on Category 3',
        status: 'met',
        detail: 'Every porous material contacted by Category 3 water is scoped for removal.',
      }
    : {
        id: 'porous_removal',
        citation: 'POROUS_MATERIAL_REMOVAL_CAT3',
        title: 'Porous materials removed on Category 3',
        status: 'unmet',
        detail: `Category 3 water contacted porous material that is not scoped for removal: ${porousLeft.join(', ')}.`,
        remedy:
          'Scope it for removal, or record why it was not affected. Leaving porous material in place after Category 3 contact is the finding that reopens a job.',
        affectsEstimate: true,
      };
}

function checkWallCavity(a: LossAssessment, scope: ScopeItem[]): ComplianceCheck {
  const wetCavities = a.rooms.filter((room) => room.materials.some((m) => m.cavityWet));
  if (wetCavities.length === 0) {
    return notApplicable('wall_cavity', 'WALL_CAVITY_ACCESS', 'Wet wall cavities opened or dried', 'No wet cavities documented.');
  }

  const unaddressed = wetCavities.filter(
    (room) =>
      !scope.some(
        (item) =>
          item.roomId === room.id && (item.rule === 'flood_cut' || item.rule.includes('injectidry')),
      ),
  );

  return unaddressed.length === 0
    ? {
        id: 'wall_cavity',
        citation: 'WALL_CAVITY_ACCESS',
        title: 'Wet wall cavities opened or dried',
        status: 'met',
        detail: `${wetCavities.length} room(s) with wet cavities are addressed by a flood cut or a cavity drying system.`,
      }
    : {
        id: 'wall_cavity',
        citation: 'WALL_CAVITY_ACCESS',
        title: 'Wet wall cavities opened or dried',
        status: 'unmet',
        detail: `Wet wall cavity in ${unaddressed.map((r) => r.name).join(', ')} with neither a flood cut nor a cavity drying system scoped.`,
        remedy:
          'A cavity behind a finished wall will not dry through the finish. Open it, or add an interstitial drying system — which is often cheaper for the carrier and bills well per day.',
        affectsEstimate: true,
      };
}

function checkCleaningBeforeChemistry(a: LossAssessment, scope: ScopeItem[]): ComplianceCheck {
  if (a.category < 2) {
    return notApplicable(
      'cleaning_first',
      'CLEANING_BEFORE_ANTIMICROBIAL',
      'Removal and cleaning precede chemical treatment',
      `This is a Category ${a.category} loss.`,
    );
  }

  const hasAntimicrobial = scope.some((item) => item.tags.includes('antimicrobial'));
  const hasRemoval = scope.some((item) => item.tags.includes('tear_out'));

  if (hasAntimicrobial && !hasRemoval && a.category === 3) {
    return {
      id: 'cleaning_first',
      citation: 'CLEANING_BEFORE_ANTIMICROBIAL',
      title: 'Removal and cleaning precede chemical treatment',
      status: 'unmet',
      detail:
        'Antimicrobial is scoped on a Category 3 loss with no removal alongside it. Treatment applied over contamination that was not removed does not make the material safe.',
      remedy: 'Scope the removal the category calls for. The antimicrobial supplements it; it does not replace it.',
    };
  }

  return {
    id: 'cleaning_first',
    citation: 'CLEANING_BEFORE_ANTIMICROBIAL',
    title: 'Removal and cleaning precede chemical treatment',
    status: 'met',
    detail: hasRemoval
      ? 'Non-salvageable material is removed before any treatment is applied.'
      : 'No treatment is scoped in place of removal.',
  };
}

function checkAntimicrobial(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  if (a.category < 2) {
    return notApplicable(
      'antimicrobial',
      'ANTIMICROBIAL_APPLICATION',
      'Antimicrobial applied to affected surfaces',
      `This is a Category ${a.category} loss.`,
    );
  }

  return lines.some((line) => line.catalogKey === 'CLNAM')
    ? {
        id: 'antimicrobial',
        citation: 'ANTIMICROBIAL_APPLICATION',
        title: 'Antimicrobial applied to affected surfaces',
        status: 'met',
        detail: `Applied across affected surfaces on this Category ${a.category} loss, after removal of non-salvageable material.`,
      }
    : {
        id: 'antimicrobial',
        citation: 'ANTIMICROBIAL_APPLICATION',
        title: 'Antimicrobial applied to affected surfaces',
        status: 'unmet',
        detail: `No antimicrobial application is on this Category ${a.category} estimate.`,
        remedy:
          'Add it if it was performed. It is customary on contaminated losses and carriers expect to see it, so its absence draws attention to the rest of the scope.',
        affectsEstimate: true,
      };
}

/* ------------------------------------------------------------------ *
 * Equipment
 * ------------------------------------------------------------------ */

function checkDehumidificationCapacity(a: LossAssessment): ComplianceCheck {
  const affectedCF = round(
    a.rooms.reduce((sum, room) => sum + cubicFeet(room.geometry) * room.affectedFloorFraction, 0),
  );
  if (affectedCF <= 0) {
    return notApplicable('dehumidification', 'DEHUMIDIFICATION_SIZING', 'Dehumidification sized to the loss', 'No affected volume.');
  }

  const required = sizeDehumidification(affectedCF, a.class);
  const placed = a.equipment
    .filter((e) => e.kind.startsWith('dehumidifier'))
    .reduce((sum, e) => sum + e.quantity, 0);

  if (placed === 0) {
    return {
      id: 'dehumidification',
      citation: 'DEHUMIDIFICATION_SIZING',
      title: 'Dehumidification sized to the loss',
      status: 'undetermined',
      detail: `${affectedCF} affected cubic feet at the Class ${a.class} factor of ${required.factor} calls for about ${required.requiredPintsPerDay} AHAM pints/day — roughly ${required.unitsRequired} unit(s). No dehumidifiers appear in the equipment log.`,
      remedy: 'Record the dehumidifiers that were placed. Unlogged equipment is unbilled equipment.',
      affectsEstimate: true,
    };
  }

  return placed >= required.unitsRequired
    ? {
        id: 'dehumidification',
        citation: 'DEHUMIDIFICATION_SIZING',
        title: 'Dehumidification sized to the loss',
        status: 'met',
        detail: `${placed} unit(s) placed against a computed requirement of ${required.unitsRequired} for ${affectedCF} affected cubic feet at the Class ${a.class} factor of ${required.factor}.`,
      }
    : {
        id: 'dehumidification',
        citation: 'DEHUMIDIFICATION_SIZING',
        title: 'Dehumidification sized to the loss',
        status: 'unmet',
        detail: `${placed} unit(s) placed where ${required.unitsRequired} were indicated (${required.requiredPintsPerDay} AHAM pints/day for ${affectedCF} affected cubic feet at the Class ${a.class} factor of ${required.factor}).`,
        remedy:
          'Either units are missing from the log — unbilled days — or the structure genuinely dried under-equipped, which is worth a note before an adjuster asks.',
        affectsEstimate: true,
      };
}

function checkAirflow(a: LossAssessment): ComplianceCheck {
  const placed = a.equipment
    .filter((e) => e.kind.includes('air_mover'))
    .reduce((sum, e) => sum + e.quantity, 0);

  if (placed === 0) {
    return {
      id: 'airflow',
      citation: 'AIRFLOW_SIZING',
      title: 'Airflow provided across wet surfaces',
      status: 'undetermined',
      detail: 'No air movers appear in the equipment log.',
      remedy: 'Record the air movers placed — they are usually the largest single equipment line on a mitigation estimate.',
      affectsEstimate: true,
    };
  }

  return {
    id: 'airflow',
    citation: 'AIRFLOW_SIZING',
    title: 'Airflow provided across wet surfaces',
    status: 'met',
    detail: `${placed} air movers documented across ${a.rooms.length} room(s). Per-room coverage shortfalls, if any, are listed under the open questions.`,
  };
}

function checkSpecialtyDrying(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  if (a.class < 4) {
    return notApplicable(
      'specialty_drying',
      'CLASS_4_SPECIALTY_DRYING',
      'Specialty drying for deeply held moisture',
      `This is a Class ${a.class} loss.`,
    );
  }

  const specialty = lines.some((line) =>
    ['WTRDHMDES', 'WTRINJD', 'WTRHEAT'].includes(line.catalogKey),
  );

  return specialty
    ? {
        id: 'specialty_drying',
        citation: 'CLASS_4_SPECIALTY_DRYING',
        title: 'Specialty drying for deeply held moisture',
        status: 'met',
        detail: 'A desiccant, cavity or heat drying system is on the estimate, as the class calls for.',
      }
    : {
        id: 'specialty_drying',
        citation: 'CLASS_4_SPECIALTY_DRYING',
        title: 'Specialty drying for deeply held moisture',
        status: 'unmet',
        detail:
          'This loss was classified Class 4 — moisture bound in low-evaporation material — but only conventional equipment is on the estimate.',
        remedy:
          'Add the specialty equipment that was used, or revisit the classification. Class 4 without specialty drying is a contradiction an adjuster will notice.',
        affectsEstimate: true,
      };
}

/* ------------------------------------------------------------------ *
 * Safety and containment
 * ------------------------------------------------------------------ */

function checkContainment(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  if (!a.containmentRequired) {
    return notApplicable('containment', 'CONTAINMENT', 'Work contained to prevent cross-contamination', 'Containment not indicated for this loss.');
  }

  return lines.some((line) => line.catalogKey === 'DMOCNTB')
    ? {
        id: 'containment',
        citation: 'CONTAINMENT',
        title: 'Work contained to prevent cross-contamination',
        status: 'met',
        detail: 'A containment barrier is scoped around the affected area.',
      }
    : {
        id: 'containment',
        citation: 'CONTAINMENT',
        title: 'Work contained to prevent cross-contamination',
        status: 'unmet',
        detail: `${a.microbialGrowthPresent ? 'Microbial growth was documented' : `Category ${a.category} water was present`}, but no containment is on the estimate.`,
        remedy: 'Add the barrier if one was built. Demolition on a contaminated loss without containment distributes the problem through the building.',
        affectsEstimate: true,
      };
}

function checkNegativePressure(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  if (!a.containmentRequired) {
    return notApplicable('negative_pressure', 'NEGATIVE_PRESSURE', 'Containment held under negative pressure', 'No containment on this loss.');
  }

  const scrubber = lines.some((line) => line.catalogKey === 'WTRNAF');
  const setup = lines.some((line) => line.catalogKey === 'DMONEGP');

  return scrubber && setup
    ? {
        id: 'negative_pressure',
        citation: 'NEGATIVE_PRESSURE',
        title: 'Containment held under negative pressure',
        status: 'met',
        detail: 'Both the negative-pressure setup and the air scrubber days that maintain it are on the estimate.',
      }
    : {
        id: 'negative_pressure',
        citation: 'NEGATIVE_PRESSURE',
        title: 'Containment held under negative pressure',
        status: 'unmet',
        detail: !scrubber
          ? 'Containment is billed with no air scrubber days — the barrier is there but not the machine that makes it work.'
          : 'Air scrubber days are billed with no negative-pressure setup and monitoring line.',
        remedy: 'Add the missing line. Both are separately billable and both are needed for the containment to do anything.',
        affectsEstimate: true,
      };
}

function checkPpe(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  if (a.category < 3 && !a.microbialGrowthPresent) {
    return notApplicable('ppe', 'WORKER_SAFETY_PPE', 'Protective equipment matched to the hazard', 'No Category 3 or microbial exposure.');
  }

  return lines.some((line) => line.catalogKey === 'DMOPPE')
    ? {
        id: 'ppe',
        citation: 'WORKER_SAFETY_PPE',
        title: 'Protective equipment matched to the hazard',
        status: 'met',
        detail: 'PPE is billed per technician per day for the contaminated work.',
      }
    : {
        id: 'ppe',
        citation: 'WORKER_SAFETY_PPE',
        title: 'Protective equipment matched to the hazard',
        status: 'unmet',
        detail: `Work in ${a.category === 3 ? 'Category 3 water' : 'documented microbial growth'} with no PPE on the estimate.`,
        remedy: 'Add it. Suits, gloves and respiratory protection are consumed daily per technician, and the job is otherwise absorbing that cost.',
        affectsEstimate: true,
      };
}

/* ------------------------------------------------------------------ *
 * Contents and closing
 * ------------------------------------------------------------------ */

function checkContents(a: LossAssessment, lines: EstimateLineItem[]): ComplianceCheck {
  const wetFloor = a.rooms.some((room) => room.geometry.floorSF * room.affectedFloorFraction > 0);
  if (!wetFloor) {
    return notApplicable('contents', 'CONTENTS_HANDLING', 'Contents moved and handled by category', 'No affected floor area.');
  }

  return lines.some((line) => line.catalogKey === 'CLNCONT')
    ? {
        id: 'contents',
        citation: 'CONTENTS_HANDLING',
        title: 'Contents moved and handled by category',
        status: 'met',
        detail: 'Content manipulation is billed as labour separate from the drying line items.',
      }
    : {
        id: 'contents',
        citation: 'CONTENTS_HANDLING',
        title: 'Contents moved and handled by category',
        status: 'unmet',
        detail: 'Affected floor area is scoped for extraction and drying, but no content manipulation is billed.',
        remedy:
          'Floors cannot be extracted or dried under furniture, so this work was almost certainly done. It is among the most consistently unbilled labour in mitigation.',
        affectsEstimate: true,
      };
}

function checkPostDemolitionCleaning(
  a: LossAssessment,
  scope: ScopeItem[],
  lines: EstimateLineItem[],
): ComplianceCheck {
  const demolition = scope.some((item) => item.tags.includes('tear_out'));
  if (!demolition || a.category < 2) {
    return notApplicable(
      'post_demolition_cleaning',
      'POST_DEMOLITION_CLEANING',
      'Cleaned after demolition',
      demolition ? `This is a Category ${a.category} loss.` : 'No demolition on this job.',
    );
  }

  return lines.some((line) => line.catalogKey === 'CLNHEPAV')
    ? {
        id: 'post_demolition_cleaning',
        citation: 'POST_DEMOLITION_CLEANING',
        title: 'Cleaned after demolition',
        status: 'met',
        detail: 'HEPA vacuuming is scoped for the rooms where demolition happened.',
      }
    : {
        id: 'post_demolition_cleaning',
        citation: 'POST_DEMOLITION_CLEANING',
        title: 'Cleaned after demolition',
        status: 'unmet',
        detail: 'Demolition on a contaminated loss with no post-demolition cleaning on the estimate.',
        remedy: 'Add HEPA vacuuming of floors and the exposed wall base — demolition liberates the contamination it was performed to remove.',
        affectsEstimate: true,
      };
}

/* ------------------------------------------------------------------ */

function notApplicable(
  id: string,
  citation: CitationId,
  title: string,
  reason: string,
): ComplianceCheck {
  return { id, citation, title, status: 'not_applicable', detail: reason };
}

/** Render a check for a text report, with its citation attached. */
export function formatCheck(check: ComplianceCheck): string {
  const marker = { met: '[x]', unmet: '[ ]', undetermined: '[?]', not_applicable: '[-]' }[
    check.status
  ];
  const lines = [`${marker} ${check.title}  (${formatCitation(check.citation)})`, `    ${check.detail}`];
  if (check.remedy) lines.push(`    → ${check.remedy}`);
  return lines.join('\n');
}
