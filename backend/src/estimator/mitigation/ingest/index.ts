import { clamp, deriveGeometry, round } from '../lib/geometry.js';
import { formatCitation } from '../standards/s500.js';
import { degradeCategory, determineClass, hoursBetween } from '../lib/psychrometrics.js';
import { parseDocuSketch, isPorous, surfaceFor } from './docusketch.js';
import { parseMica, categoryForCause } from './mica.js';
import { parsePhotos, type PhotoManifestEntry } from './photos.js';
import { parseNotes } from './notes.js';
import type {
  AffectedMaterial,
  AssessedRoom,
  Evidence,
  LossAssessment,
  MaterialType,
  MoistureReading,
  SourceKind,
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

  /* ---- Rooms ------------------------------------------------------ */

  let rooms: AssessedRoom[] = sketch?.rooms ?? [];
  if (rooms.length === 0 && notes?.roomDimensions.length) {
    rooms = roomsFromNotes(notes.roomDimensions);
    warnings.push(
      'No DocuSketch scan was supplied — room geometry was read from the field notes and should be verified before the estimate is submitted.',
    );
  }
  if (rooms.length === 0) {
    warnings.push('No room geometry from any source. Quantities cannot be computed.');
  }

  rooms = applyMicaHints(rooms, mica?.roomHints ?? []);
  rooms = applyNoteHints(rooms, notes);
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

  /* ---- Moisture + equipment --------------------------------------- */

  const moistureReadings = assignReadingRooms(mica?.moistureReadings ?? [], rooms);

  const equipment = mica?.equipment ?? [];
  if (equipment.length === 0 && notes?.equipmentMentioned.length) {
    warnings.push(
      'No MICA equipment log was supplied — equipment counts came from the field notes, so the billed days rest on the notes alone.',
    );
  }

  const dryingDays =
    overrides.dryingDays ??
    (mica?.dryingDays && mica.dryingDays > 0
      ? mica.dryingDays
      : estimateDryingDays(waterClass, category));

  const monitoringVisits = overrides.monitoringVisits ?? mica?.monitoringVisits ?? dryingDays;

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
    evidence.some((item) => item.tags.includes('containment'));

  return {
    jobId: sources.jobId ?? `job-${Date.now().toString(36)}`,
    propertyAddress: overrides.propertyAddress ?? mica?.propertyAddress ?? sketch?.propertyAddress,
    claimNumber: overrides.claimNumber ?? mica?.claimNumber,
    carrier: overrides.carrier ?? mica?.carrier,
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
 * Apply note-derived flood-cut heights.
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
  notes: ReturnType<typeof parseNotes> | null,
): AssessedRoom[] {
  if (!notes || notes.floodCuts.length === 0) return rooms;

  // Without a room name on the cut, the note describes the job, so apply the
  // largest stated height everywhere a wall is already known to be wet.
  const globalCut = Math.max(...notes.floodCuts.map((cut) => cut.heightIn));

  return rooms.map((room) => {
    const scoped = notes.floodCuts.find(
      (cut) => cut.roomName && nameMatches(room.name, cut.roomName),
    );
    return { ...room, documentedCutHeightIn: scoped?.heightIn ?? globalCut };
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
 * Build rooms from note dimensions when no scan exists. Materials are left empty
 * on purpose: guessing what was wet from a bare "12x14" would put demolition on
 * the estimate that nobody documented.
 */
function roomsFromNotes(
  dimensions: Array<{ name?: string; lengthFt: number; widthFt: number; heightFt?: number }>,
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
    affectedFloorFraction: 1,
    materials: [],
    ceilingAffected: false,
    notes: 'Geometry read from field notes; not measured.',
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
export type { AffectedMaterial };
