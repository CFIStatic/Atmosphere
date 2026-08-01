import { clamp, deriveGeometry, round } from '../lib/geometry.js';
import { formatCitation } from '../standards/s500.js';
import { degradeCategory, determineClass, hoursBetween } from '../lib/psychrometrics.js';
import { parseDocuSketch, isPorous, surfaceFor } from './docusketch.js';
import { parseMica, categoryForCause } from './mica.js';
import { parsePhotos, type PhotoManifestEntry } from './photos.js';
import { parseNotes, type NotesParseResult } from './notes.js';
import {
  deriveFindings,
  type DamageFinding,
  type FindingsBundle,
} from './findings.js';
import type {
  AffectedMaterial,
  AssessedRoom,
  EquipmentKind,
  EquipmentPlacement,
  Evidence,
  LossAssessment,
  MaterialType,
  MoistureReading,
  SourceKind,
  Unit,
  WaterCategory,
} from '../types.js';

/**
 * Source fusion.
 *
 * Four inputs describe one loss, and they disagree. Resolving that cleanly is
 * the whole job of this module, and it follows one rule: **measured beats
 * recorded beats written**. DocuSketch measured the room, so its geometry wins.
 * MICA recorded the drying, so its equipment log and category win over prose. A
 * technician's note fills the gaps nothing else covered.
 *
 * Photos and notes alone are a first-class path: many jobs arrive with captions
 * and a paragraph of field notes and nothing else. This module still has to
 * produce a LossAssessment those jobs can attach findings and requirements to —
 * without inventing square footage the sources never stated.
 *
 * The exception is water category, which takes the *worst* value any source
 * reports rather than the highest-priority one. Under-calling contamination
 * produces an estimate that omits required work and a job that gets re-opened;
 * over-calling it is caught at review. The asymmetry is deliberate.
 */

export interface EstimatorSources {
  jobId?: string;
  docusketch?: unknown;
  mica?: unknown;
  photos?: PhotoManifestEntry[];
  notes?: string;
  /**
   * Chronological drying visits. Merged in the agent after normalizeSources —
   * this field is declared here so buildEstimate accepts it through the same
   * sources object, but normalizeSources stays pure for one-shot inputs.
   */
  dryingReports?: import('../planning/dryingProgress.js').DryingReport[];
  /** Overrides a human supplied directly — always authoritative. */
  overrides?: AssessmentOverrides;
}

export interface AssessmentOverrides {
  propertyAddress?: string;
  claimNumber?: string;
  carrier?: string;
  insuredName?: string;
  dateOfLoss?: string;
  dateOfArrival?: string;
  category?: WaterCategory;
  class?: 1 | 2 | 3 | 4;
  dryingDays?: number;
  monitoringVisits?: number;
}

/**
 * Materials dense enough to hold moisture against ordinary airflow.
 *
 * Deliberately narrow. Class 4 means *specialty drying* — desiccants, cavity
 * systems, heat — and calling it wrongly inflates the dehumidification factor for
 * the whole job. Tile and engineered flooring are not on the list: they either
 * shed water or come out, and neither behaviour is what Class 4 describes.
 */
const LOW_EVAPORATION: ReadonlySet<MaterialType> = new Set<MaterialType>([
  'hardwood',
  'plaster',
  'concrete',
  'subfloor_wood',
]);

export function normalizeSources(sources: EstimatorSources): LossAssessment {
  const warnings: string[] = [];
  const sourcesUsed: SourceKind[] = [];

  const sketch = sources.docusketch ? parseDocuSketch(sources.docusketch) : null;
  const mica = sources.mica ? parseMica(sources.mica) : null;
  const photos = sources.photos?.length ? parsePhotos(sources.photos) : null;
  const notes = sources.notes?.trim() ? parseNotes(sources.notes) : null;

  if (sketch) sourcesUsed.push('docusketch');
  if (mica) sourcesUsed.push('mica');
  if (photos) sourcesUsed.push('photos');
  if (notes) sourcesUsed.push('notes');

  for (const source of [sketch, mica, photos, notes]) {
    if (source) warnings.push(...source.warnings);
  }

  const overrides = sources.overrides ?? {};

  /* ---- Findings (photos + notes) ---------------------------------- */

  // Findings are observational and do not need geometry. Derive them before
  // room fusion so named rooms in captions can seed placeholders when nothing
  // else produced a room list.
  const findingsBundle = deriveFindings({
    photoEvidence: photos?.evidence ?? [],
    noteEvidence: notes?.evidence ?? [],
    cause: mica?.cause ?? notes?.cause,
    sourceCategory: mica?.sourceCategory ?? notes?.sourceCategory,
    microbialGrowthPresent:
      Boolean(mica?.microbialGrowthPresent) || Boolean(notes?.microbialGrowthPresent),
    notesText: typeof sources.notes === 'string' ? sources.notes : undefined,
  });
  warnings.push(...findingsBundle.warnings);

  /* ---- Rooms ------------------------------------------------------ */

  let rooms: AssessedRoom[] = sketch?.rooms ?? [];
  if (rooms.length === 0 && notes?.roomDimensions.length) {
    rooms = roomsFromNotes(notes.roomDimensions, notes);
    warnings.push(
      'No DocuSketch scan was supplied — room geometry was read from the field notes and should be verified before the estimate is submitted.',
    );
  }

  // Zero-geometry placeholders exist solely so findings have a room to hang on.
  // They must never invent SF: quantities stay blocked until someone measures.
  if (rooms.length === 0 && findingsBundle.namedRooms.length > 0) {
    rooms = placeholderRoomsFromNames(findingsBundle.namedRooms);
    warnings.push(
      'Rooms were named in photos/notes but no dimensions were supplied. Placeholder rooms were created so findings can attach; square footage was NOT invented — add room sizes (e.g. "Kitchen 12x14") or a DocuSketch scan before quantities can be billed.',
    );
  }

  if (rooms.length === 0) {
    warnings.push(
      'No room geometry from any source. Quantities cannot be computed — do not invent square footage. Supply a DocuSketch scan or note dimensions (e.g. "12x14 bedroom").',
    );
  } else if (rooms.every((room) => room.geometry.floorSF <= 0)) {
    warnings.push(
      'Named rooms have no measured or stated dimensions. Demolition and extraction quantities are blocked until sizes are supplied — square footage was not invented.',
    );
  }

  rooms = applyMicaHints(rooms, mica?.roomHints ?? []);
  rooms = applyNoteHints(rooms, notes, { allowAffectedFractionFromNotes: !sketch });
  rooms = attachPhotoRooms(rooms, photos?.evidence ?? []);

  /* ---- Identity + dates ------------------------------------------- */

  const dateOfLoss = overrides.dateOfLoss ?? mica?.dateOfLoss;
  const dateOfArrival =
    overrides.dateOfArrival ?? mica?.dateOfArrival ?? photos?.earliestCapture;

  if (dateOfLoss && dateOfArrival && Date.parse(dateOfArrival) < Date.parse(dateOfLoss)) {
    warnings.push('Arrival is recorded before the date of loss — check the job dates.');
  }

  /* ---- Category (worst wins) -------------------------------------- */

  const cause = mica?.cause ?? notes?.cause ?? 'unknown';
  const categoryCandidates: WaterCategory[] = [
    mica?.sourceCategory,
    notes?.sourceCategory,
    cause !== 'unknown' ? categoryForCause(cause) : undefined,
    photoCategoryHint(photos?.evidence ?? []),
  ].filter((value): value is WaterCategory => value === 1 || value === 2 || value === 3);

  const sourceCategory: WaterCategory =
    categoryCandidates.length > 0
      ? (Math.max(...categoryCandidates) as WaterCategory)
      : 2; // Unknown source water is scoped as contaminated, never as clean.

  if (categoryCandidates.length === 0) {
    warnings.push(
      'No source identified the water category. Scoped as Category 2 pending confirmation — confirm before submitting, because it changes the demolition scope.',
    );
  }

  // The degradation clock runs from the loss to the moment work started, since
  // that is how long the water sat.
  const hoursStanding = hoursBetween(dateOfLoss, dateOfArrival ?? new Date().toISOString());
  const timeDegraded = degradeCategory(sourceCategory, hoursStanding);
  const category = overrides.category ?? timeDegraded;

  if (timeDegraded > sourceCategory && !overrides.category) {
    warnings.push(
      `Water sat for ${Math.round(hoursStanding)} hours, so the loss was scoped as Category ${timeDegraded} rather than the Category ${sourceCategory} at the source (${formatCitation('CATEGORY_DEGRADATION')}).`,
    );
  }

  /* ---- Materials from findings + notes ---------------------------- */

  // DocuSketch (and any room that already carries finishes) wins. Materials are
  // only painted onto rooms whose materials list is still empty — otherwise a
  // caption would silently double demolition against a measured finish list.
  rooms = applyMaterialsFromEvidence(rooms, findingsBundle, notes, category);

  /* ---- Class ------------------------------------------------------ */

  const wetSurfaceFraction = computeWetSurfaceFraction(rooms);
  // Only material being *dried in place* can trigger Class 4. Wet hardwood that
  // is coming out is a tear-out line, not a specialty-drying job, and treating
  // it as one would inflate the dehumidification factor for every room.
  const lowEvaporationMaterials = rooms.some((room) =>
    room.materials.some((m) => LOW_EVAPORATION.has(m.material) && m.salvageable),
  );
  const ceilingAffected = rooms.some((room) => room.ceilingAffected);

  const waterClass =
    overrides.class ??
    determineClass({ wetSurfaceFraction, ceilingAffected, lowEvaporationMaterials });

  /* ---- Moisture + drying duration --------------------------------- */

  const moistureReadings = assignReadingRooms(mica?.moistureReadings ?? [], rooms);

  const dryingDays =
    overrides.dryingDays ??
    (mica?.dryingDays && mica.dryingDays > 0
      ? mica.dryingDays
      : estimateDryingDays(waterClass, category));

  const monitoringVisits = overrides.monitoringVisits ?? mica?.monitoringVisits ?? dryingDays;

  /* ---- Equipment (MICA → notes → findings) ------------------------ */

  const equipmentPlacedAt = dateOfArrival ?? new Date().toISOString();
  let equipment: EquipmentPlacement[] = mica?.equipment ?? [];

  if (equipment.length === 0 && notes?.equipmentMentioned.length) {
    equipment = equipmentFromNotes(notes.equipmentMentioned, dryingDays, equipmentPlacedAt);
    warnings.push(
      'No MICA equipment log was supplied — equipment counts came from the field notes, so the billed days rest on the notes alone.',
    );
  }

  if (equipment.length === 0) {
    equipment = equipmentFromFindings(findingsBundle.findings, dryingDays, equipmentPlacedAt);
    if (equipment.length > 0) {
      warnings.push(
        'No MICA or note equipment counts were supplied — equipment was inferred from photo/note findings that mention units on site.',
      );
    }
  }

  /* ---- Evidence --------------------------------------------------- */

  const evidence: Evidence[] = [
    ...(sketch?.evidence ?? []),
    ...(mica?.evidence ?? []),
    ...(photos?.evidence ?? []),
    ...(notes?.evidence ?? []),
  ];

  const microbialGrowthPresent =
    Boolean(mica?.microbialGrowthPresent) ||
    Boolean(notes?.microbialGrowthPresent) ||
    evidence.some((item) => item.tags.includes('microbial'));

  // Required by the classification, or — just as billable — documented as having
  // actually been built. A photo of a poly barrier is proof the crew did the
  // work, whether or not the category obliged them to.
  const containmentRequired =
    category === 3 ||
    microbialGrowthPresent ||
    Boolean(notes?.containmentMentioned) ||
    evidence.some((item) => item.tags.includes('containment')) ||
    findingsBundle.findings.some((f) => f.kind === 'containment_built');

  // Carrier: MICA identity wins; notes fill the gap so program SLAs can still load.
  const carrier =
    overrides.carrier ?? mica?.carrier ?? notes?.carrierMentioned;

  return {
    jobId: sources.jobId ?? `job-${Date.now().toString(36)}`,
    propertyAddress: overrides.propertyAddress ?? mica?.propertyAddress ?? sketch?.propertyAddress,
    claimNumber: overrides.claimNumber ?? mica?.claimNumber,
    carrier,
    insuredName: overrides.insuredName ?? mica?.insuredName,
    dateOfLoss,
    dateOfArrival,
    cause,
    sourceCategory,
    category,
    class: waterClass,
    rooms,
    moistureReadings,
    psychrometrics: mica?.psychrometrics ?? [],
    equipment,
    evidence,
    dryingDays,
    monitoringVisits,
    microbialGrowthPresent,
    containmentRequired,
    warnings,
    sourcesUsed,
    findings: findingsBundle.findings,
  };
}

/* ------------------------------------------------------------------ *
 * Merge helpers
 * ------------------------------------------------------------------ */

/** Loose room-name matching: "Master Bath" ≈ "master bathroom". */
function nameMatches(a: string, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

function applyMicaHints(
  rooms: AssessedRoom[],
  hints: Array<{ name: string; ceilingAffected?: boolean; affectedFloorFraction?: number; notes?: string }>,
): AssessedRoom[] {
  if (hints.length === 0) return rooms;
  return rooms.map((room) => {
    const hint = hints.find((h) => nameMatches(room.name, h.name));
    if (!hint) return room;
    return {
      ...room,
      // MICA observed the loss; a `true` from the field is never overridden by
      // a scan default of `false`.
      ceilingAffected: room.ceilingAffected || Boolean(hint.ceilingAffected),
      affectedFloorFraction:
        hint.affectedFloorFraction !== undefined
          ? clamp(hint.affectedFloorFraction, 0, 1)
          : room.affectedFloorFraction,
      notes: [room.notes, hint.notes].filter(Boolean).join(' — ') || undefined,
    };
  });
}

/**
 * Apply note-derived flood-cut heights, ceiling wetness, and (when no scan
 * measured affected floor) the stated wet-floor fraction.
 *
 * A note that says "cut 24in" records a *decision the crew made*, not a
 * measurement — so it lands on `documentedCutHeightIn`, where the scope rules
 * will bill it as-performed. Writing it into `wetHeightIn` instead would be a
 * quiet and expensive error: the rules add clearance above the wet line and
 * round up to a framing division, so a documented 24-inch cut would come back
 * out of the arithmetic as a 48-inch one.
 */
function applyNoteHints(
  rooms: AssessedRoom[],
  notes: NotesParseResult | null,
  options: { allowAffectedFractionFromNotes: boolean },
): AssessedRoom[] {
  if (!notes) return rooms;

  const hasCuts = notes.floodCuts.length > 0;
  // Without a room name on the cut, the note describes the job, so apply the
  // largest stated height everywhere a wall is already known to be wet.
  const globalCut = hasCuts ? Math.max(...notes.floodCuts.map((cut) => cut.heightIn)) : undefined;

  return rooms.map((room) => {
    const scoped = notes.floodCuts.find(
      (cut) => cut.roomName && nameMatches(room.name, cut.roomName),
    );
    const documentedCutHeightIn = scoped?.heightIn ?? globalCut ?? room.documentedCutHeightIn;

    return {
      ...room,
      documentedCutHeightIn,
      ceilingAffected: room.ceilingAffected || notes.ceilingWet,
      affectedFloorFraction:
        options.allowAffectedFractionFromNotes && notes.affectedFloorFraction !== undefined
          ? clamp(notes.affectedFloorFraction, 0, 1)
          : room.affectedFloorFraction,
    };
  });
}

/** Let a photo tagged with a room name contribute that room's evidence. */
function attachPhotoRooms(rooms: AssessedRoom[], photoEvidence: Evidence[]): AssessedRoom[] {
  if (photoEvidence.length === 0) return rooms;
  for (const item of photoEvidence) {
    if (item.roomId) continue;
    const match = rooms.find((room) => item.tags.some((tag) => nameMatches(room.name, tag)));
    if (match) item.roomId = match.id;
  }
  return rooms;
}

function photoCategoryHint(evidence: Evidence[]): WaterCategory | undefined {
  if (evidence.some((item) => item.tags.includes('category_3'))) return 3;
  if (evidence.some((item) => item.tags.includes('category_2'))) return 2;
  return undefined;
}

/**
 * Build rooms from note dimensions when no scan exists.
 *
 * Materials stay empty here on purpose when the notes only gave sizes — the
 * findings / placement pass fills finishes separately so a bare "12x14" never
 * invents demolition. Affected floor fraction and ceiling wetness *are* taken
 * from the notes when stated, because those are observations about the loss,
 * not guesses about finishes.
 */
function roomsFromNotes(
  dimensions: Array<{ name?: string; lengthFt: number; widthFt: number; heightFt?: number }>,
  notes: NotesParseResult,
): AssessedRoom[] {
  return dimensions.map((dim, index) => ({
    id: `note-room-${index}`,
    name: dim.name ?? `Room ${index + 1}`,
    level: 'Main Level',
    geometry: deriveGeometry({
      lengthFt: dim.lengthFt,
      widthFt: dim.widthFt,
      heightFt: dim.heightFt,
    }),
    affectedFloorFraction: notes.affectedFloorFraction ?? 1,
    materials: [],
    ceilingAffected: notes.ceilingWet,
    notes: 'Geometry read from field notes; not measured.',
  }));
}

/**
 * Zero-geometry rooms named in captions/notes when nothing else produced a
 * room list. Findings need attachment points; inventing SF would be fraud.
 */
function placeholderRoomsFromNames(names: string[]): AssessedRoom[] {
  // Literal zeros — do not call deriveGeometry here; it would fill a default
  // ceiling height and look like measured space.
  const zeroGeometry = {
    lengthFt: 0,
    widthFt: 0,
    heightFt: 0,
    floorSF: 0,
    ceilingSF: 0,
    wallSF: 0,
    perimeterLF: 0,
    offsets: 0,
    openingSF: 0,
  };
  return names.map((name, index) => ({
    id: `finding-room-${index}`,
    name,
    level: 'Main Level',
    geometry: zeroGeometry,
    affectedFloorFraction: 1,
    materials: [],
    ceilingAffected: false,
    notes:
      'Named in photos/notes without dimensions — placeholder only; quantities blocked until sizes are supplied.',
  }));
}

/**
 * Paint findings + note materials onto rooms that still have an empty finish
 * list. Never overwrite DocuSketch (or any already-populated) materials.
 *
 * Salvageability: Category 3 porous finishes cannot be restored to a sanitary
 * condition, so they are always non-salvageable. An explicit tear-out /
 * "removed" signal also forces non-salvageable. When carpet is non-salvageable,
 * carpet pad is added if missing — pad under a carpet that is coming out always
 * comes out with it.
 */
function applyMaterialsFromEvidence(
  rooms: AssessedRoom[],
  findingsBundle: FindingsBundle,
  notes: NotesParseResult | null,
  category: WaterCategory,
): AssessedRoom[] {
  const emptyRooms = rooms.filter((room) => room.materials.length === 0);
  if (emptyRooms.length === 0) return rooms;

  type Spec = {
    material: MaterialType;
    roomName?: string;
    wetHeightIn?: number;
    cavityWet?: boolean;
    removed?: boolean;
  };

  const specs: Spec[] = [];

  for (const row of findingsBundle.materials) {
    specs.push({
      material: row.material,
      roomName: row.roomName,
      wetHeightIn: row.wetHeightIn,
      cavityWet: row.cavityWet,
      removed: row.removed,
    });
  }

  if (notes) {
    for (const placement of notes.materialPlacements) {
      specs.push({
        material: placement.material,
        roomName: placement.roomName,
        wetHeightIn: placement.wetHeightIn,
        removed: placement.removed,
        cavityWet:
          notes.cavityWet &&
          (placement.material === 'drywall' ||
            placement.material === 'plaster' ||
            placement.material === 'insulation')
            ? true
            : undefined,
      });
    }
    for (const material of notes.materialsMentioned) {
      if (!specs.some((s) => s.material === material && !s.roomName)) {
        specs.push({ material });
      }
    }
  }

  if (specs.length === 0) return rooms;

  return rooms.map((room) => {
    if (room.materials.length > 0) return room;

    const scoped = specs.filter((s) => s.roomName && nameMatches(room.name, s.roomName));
    const unscoped = specs.filter((s) => !s.roomName);
    // Room-named specs win for this room; unscoped specs apply to every empty
    // room (field notes often describe the whole job without naming rooms).
    const applicable = [...scoped, ...unscoped];
    if (applicable.length === 0) return room;

    const materials = buildAffectedMaterials(applicable, room, category);
    return { ...room, materials };
  });
}

function buildAffectedMaterials(
  specs: Array<{
    material: MaterialType;
    wetHeightIn?: number;
    cavityWet?: boolean;
    removed?: boolean;
  }>,
  room: AssessedRoom,
  category: WaterCategory,
): AffectedMaterial[] {
  const byMaterial = new Map<MaterialType, AffectedMaterial>();

  for (const spec of specs) {
    const porous = isPorous(spec.material);
    // Cat 3 porous finishes cannot be cleaned to a sanitary standard — they
    // come out. An explicit tear-out / "removed" signal does the same.
    const salvageable = !(Boolean(spec.removed) || (category === 3 && porous));
    const surface = surfaceFor(spec.material);
    const unit = unitFor(spec.material);
    const quantity = quantityFor(spec.material, unit, room);

    const existing = byMaterial.get(spec.material);
    if (!existing) {
      byMaterial.set(spec.material, {
        material: spec.material,
        surface,
        quantity,
        unit,
        wetHeightIn: spec.wetHeightIn,
        cavityWet: Boolean(spec.cavityWet),
        porous,
        salvageable,
      });
      continue;
    }

    existing.wetHeightIn = existing.wetHeightIn ?? spec.wetHeightIn;
    existing.cavityWet = existing.cavityWet || Boolean(spec.cavityWet);
    // Non-salvageable wins: once any source says it comes out, it stays out.
    if (!salvageable) existing.salvageable = false;
  }

  // Carpet that is coming out always takes its pad with it.
  const carpet = byMaterial.get('carpet');
  if (carpet && !carpet.salvageable && !byMaterial.has('carpet_pad')) {
    byMaterial.set('carpet_pad', {
      material: 'carpet_pad',
      surface: surfaceFor('carpet_pad'),
      quantity: quantityFor('carpet_pad', 'SF', room),
      unit: 'SF',
      porous: true,
      salvageable: false,
    });
  }

  return [...byMaterial.values()];
}

function unitFor(material: MaterialType): Unit {
  return material === 'baseboard' || material === 'cabinetry' ? 'LF' : 'SF';
}

function quantityFor(material: MaterialType, unit: Unit, room: AssessedRoom): number {
  const { geometry } = room;
  if (unit === 'LF') {
    return round(geometry.perimeterLF);
  }
  const surface = surfaceFor(material);
  if (surface === 'ceiling') return round(geometry.ceilingSF * (room.ceilingAffected ? 1 : room.affectedFloorFraction));
  if (surface === 'wall') {
    // Wall SF is not known until a cut height is applied; seed with floor SF so
    // a zero-geometry placeholder stays at zero rather than inventing area.
    return round(geometry.floorSF * room.affectedFloorFraction);
  }
  return round(geometry.floorSF * room.affectedFloorFraction);
}

function equipmentFromNotes(
  mentioned: NotesParseResult['equipmentMentioned'],
  dryingDays: number,
  placedAt: string,
): EquipmentPlacement[] {
  return mentioned.map((entry) => ({
    kind: mapNoteEquipmentKind(entry.kind),
    quantity: entry.quantity,
    placedAt,
    days: dryingDays,
  }));
}

function mapNoteEquipmentKind(
  kind: NotesParseResult['equipmentMentioned'][number]['kind'],
): EquipmentKind {
  if (kind === 'dehumidifier_lgr') return 'dehumidifier_lgr';
  if (kind === 'dehumidifier') return 'dehumidifier_conventional';
  return kind;
}

/**
 * Last-resort equipment list: count distinct equipment_placed findings by tag.
 * Quantities are a lower bound (one unit per finding), never a guess upward.
 */
function equipmentFromFindings(
  findings: DamageFinding[],
  dryingDays: number,
  placedAt: string,
): EquipmentPlacement[] {
  const totals = new Map<EquipmentKind, number>();
  for (const finding of findings) {
    if (finding.kind !== 'equipment_placed') continue;
    if (finding.tags.includes('air_mover')) {
      totals.set('air_mover', (totals.get('air_mover') ?? 0) + 1);
    }
    if (finding.tags.includes('dehumidifier')) {
      totals.set(
        'dehumidifier_conventional',
        (totals.get('dehumidifier_conventional') ?? 0) + 1,
      );
    }
    if (finding.tags.includes('air_scrubber')) {
      totals.set('air_scrubber', (totals.get('air_scrubber') ?? 0) + 1);
    }
  }
  return [...totals].map(([kind, quantity]) => ({
    kind,
    quantity,
    placedAt,
    days: dryingDays,
  }));
}

/** Attach readings to rooms by name so they can substantiate room line items. */
function assignReadingRooms(readings: MoistureReading[], rooms: AssessedRoom[]): MoistureReading[] {
  return readings.map((reading) => {
    if (rooms.some((room) => room.id === reading.roomId)) return reading;
    const match = rooms.find((room) => nameMatches(room.name, reading.roomId));
    return match ? { ...reading, roomId: match.id } : reading;
  });
}

/** Wall materials that form the assembly itself, as opposed to trim fixed to it. */
const WALL_ASSEMBLY: ReadonlySet<MaterialType> = new Set<MaterialType>([
  'drywall',
  'plaster',
  'insulation',
]);

/**
 * Wet surface area as a fraction of the affected rooms' total floor + wall +
 * ceiling area — the input the class determination is computed against.
 *
 * Two things this must not do, both of which silently push a job up a class and
 * therefore up a dehumidification factor:
 *
 *   - **Count trim as wall.** Baseboard and cabinetry sit *on* the wall. A room
 *     with wet drywall, wet baseboard and a wet cabinet run has one wet wall,
 *     not three.
 *   - **Add up multiple wall materials.** Drywall and the insulation behind it
 *     occupy the same square footage. The wet band is the highest wet line
 *     around the perimeter, taken once.
 */
function computeWetSurfaceFraction(rooms: AssessedRoom[]): number {
  let wet = 0;
  let total = 0;

  for (const room of rooms) {
    const { geometry } = room;
    total += geometry.floorSF + geometry.wallSF + geometry.ceilingSF;
    wet += geometry.floorSF * room.affectedFloorFraction;
    if (room.ceilingAffected) wet += geometry.ceilingSF;

    const wetHeightsIn = room.materials
      .filter((material) => material.surface === 'wall' && WALL_ASSEMBLY.has(material.material))
      .map((material) => material.wetHeightIn ?? 24);

    if (wetHeightsIn.length > 0) {
      const bandFt = Math.max(...wetHeightsIn) / 12;
      wet += Math.min(geometry.wallSF, geometry.perimeterLF * bandFt);
    }
  }

  if (total <= 0) return 0;
  return round(clamp(wet / total, 0, 1), 4);
}

/**
 * Fallback drying duration when no MICA log exists. Three days is the industry
 * baseline for a straightforward Class 1–2 loss; heavier classes and
 * contaminated water run longer.
 */
function estimateDryingDays(waterClass: number, category: WaterCategory): number {
  const base = waterClass >= 4 ? 5 : waterClass === 3 ? 4 : 3;
  return category === 3 ? base + 1 : base;
}

/** Re-exported so scope rules can reason about porosity without a deep import. */
export { isPorous, surfaceFor };
export type { AffectedMaterial, DamageFinding };
