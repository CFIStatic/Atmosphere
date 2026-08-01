import { CATALOG, codeFor, type CatalogKey } from '../pricing/catalog.js';
import { EMPTY_DIRECTIVES, type JobDirectives } from '../ai/noteAnalysis.js';
import { similarity } from '../matching/jobMatcher.js';
import { expandDependents } from '../knowledge/dependents.js';
import { sizeConstructionEquipment } from '../knowledge/equipment.js';
import { applyCodeRequirements } from '../knowledge/codes.js';
import {
  affectedArea,
  baseboardLength,
  casingLength,
  debrisLoads,
  doorCount,
  floodCutArea,
  netWallArea,
  round2,
} from './quantities.js';
import {
  MIN_OBSERVATION_CONFIDENCE,
  type DamageObservation,
  type JobAddress,
  type RoomMeasurements,
  type ScopeItem,
  type Severity,
  type Surface,
} from '../types.js';

/**
 * Turning evidence into scope.
 *
 * Three sources feed this: measurements from the scan, damage observations from
 * the photos, and — when there is one — a rebuild scope derived from the
 * mitigation estimate. They disagree, and the merge rules encode which to
 * believe:
 *
 *   • **Mitigation wins on existence.** If the mitigation estimate says the
 *     carpet came out, the carpet comes back, whether or not a photo caught it.
 *   • **The scan wins on quantity.** A photo cannot measure a room; a laser
 *     scan can. Where both produce the same line item, the larger quantity is
 *     kept and both pieces of evidence are attached.
 *   • **The notes win on inclusion.** A room the PM wrote "homeowner declined"
 *     against is dropped, no matter what the photos show.
 *
 * Nothing here is silently discarded. Every decision that a human might want to
 * revisit comes back either as a flagged line item or as a warning.
 */

const SEVERITY_RANK: Record<Severity, number> = { none: 0, light: 1, moderate: 2, heavy: 3 };

/** Names of the finishes we know how to price, keyed by what a photo calls them. */
const MATERIAL_PATTERNS: { pattern: RegExp; key: CatalogKey; companion?: CatalogKey }[] = [
  { pattern: /\b(carpet)\b/i, key: 'carpet', companion: 'carpet_pad' },
  { pattern: /\b(lvp|lvt|luxury\s*vinyl|vinyl\s*plank|laminate)\b/i, key: 'luxury_vinyl_plank' },
  { pattern: /\b(sheet\s*vinyl|linoleum|vinyl)\b/i, key: 'sheet_vinyl' },
  { pattern: /\b(ceramic|porcelain|tile)\b/i, key: 'ceramic_tile' },
  { pattern: /\b(hardwood|engineered|wood)\b/i, key: 'engineered_wood' },
];

function flooringFor(material: string | undefined): { key: CatalogKey; companion?: CatalogKey } | null {
  if (!material) return null;
  return MATERIAL_PATTERNS.find((entry) => entry.pattern.test(material)) ?? null;
}

/** One merged finding per (room, surface): the worst case seen across photos. */
interface SurfaceFinding {
  roomId: string;
  surface: Surface;
  severity: Severity;
  confidence: number;
  material?: string;
  affectedFraction?: number;
  evidence: string[];
  notes: string[];
  demolished: boolean;
}

function mergeObservations(observations: DamageObservation[]): SurfaceFinding[] {
  const merged = new Map<string, SurfaceFinding>();

  for (const observation of observations) {
    if (!observation.roomId) continue;
    const key = `${observation.roomId}::${observation.surface}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        roomId: observation.roomId,
        surface: observation.surface,
        severity: observation.severity,
        confidence: observation.confidence,
        material: observation.material,
        affectedFraction: observation.affectedFraction,
        evidence: [observation.sourcePhotoId],
        notes: [observation.note],
        demolished: observation.damageType === 'demolition',
      });
      continue;
    }

    // Take the worst severity seen: one photo showing a saturated corner is
    // enough to scope the wall, even if three others look dry.
    if (SEVERITY_RANK[observation.severity] > SEVERITY_RANK[existing.severity]) {
      existing.severity = observation.severity;
    }
    existing.confidence = Math.max(existing.confidence, observation.confidence);
    existing.material ??= observation.material;
    existing.affectedFraction = Math.max(
      existing.affectedFraction ?? 0,
      observation.affectedFraction ?? 0,
    ) || undefined;
    existing.evidence.push(observation.sourcePhotoId);
    existing.notes.push(observation.note);
    existing.demolished ||= observation.damageType === 'demolition';
  }

  return [...merged.values()];
}

/* ------------------------------------------------------------------ */
/* Room-level rules                                                    */
/* ------------------------------------------------------------------ */

interface RuleContext {
  room: RoomMeasurements;
  finding: SurfaceFinding;
  directives: JobDirectives;
  warnings: string[];
}

function item(
  context: RuleContext,
  key: CatalogKey,
  quantity: number,
  rationale: string,
  overrides: Partial<Pick<ScopeItem, 'confidence' | 'needsReview'>> = {},
): ScopeItem | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;

  const catalogItem = CATALOG[key];
  const confidence = overrides.confidence ?? context.finding.confidence;

  return {
    roomId: context.room.id,
    roomName: context.room.name,
    code: codeFor(key),
    description: catalogItem.description,
    unit: catalogItem.unit,
    quantity: round2(quantity),
    rationale,
    confidence,
    evidence: [...new Set(context.finding.evidence)],
    needsReview: overrides.needsReview ?? confidence < MIN_OBSERVATION_CONFIDENCE,
  };
}

function scopeFloor(context: RuleContext): ScopeItem[] {
  const { room, finding, directives, warnings } = context;
  const items: ScopeItem[] = [];
  const evidenceNote = finding.notes[0] ?? 'damage observed on the floor';

  if (finding.severity === 'light' && !finding.demolished) {
    // Light water on a hard surface dries; on carpet it is a cleaning line, not
    // a construction one. Say so instead of quietly scoping a replacement.
    warnings.push(
      `${room.name}: floor damage read as light — cleaning or drying may be sufficient, so no replacement was scoped.`,
    );
    return items;
  }

  // Material precedence: what the photo shows, then what the notes say, then a
  // documented assumption that the reviewer can see and change.
  const notedMaterial = directives.materialsByRoom.find(
    (entry) => similarity(entry.room.toLowerCase(), room.name.toLowerCase()) > 0.6,
  )?.material;

  const resolved = flooringFor(finding.material) ?? flooringFor(notedMaterial);
  const assumed = resolved === null;
  const flooring = resolved ?? { key: 'carpet' as CatalogKey, companion: 'carpet_pad' as CatalogKey };

  if (assumed) {
    warnings.push(
      `${room.name}: the floor covering could not be identified from the photos or the notes. Carpet was assumed — confirm the material before submitting.`,
    );
  }

  const area = room.floorAreaSqFt;
  const rationale = assumed
    ? `${evidenceNote} Material not identified; carpet assumed as the most common residential finish.`
    : `${evidenceNote} Floor covering identified as ${finding.material ?? notedMaterial}.`;

  items.push(item(context, flooring.key, area, rationale, { needsReview: assumed })!);
  if (flooring.companion) {
    items.push(
      item(context, flooring.companion, area, `Replaced with the ${CATALOG[flooring.key].description.toLowerCase()}.`)!,
    );
  }

  // Heavy damage reaches past the finish into what it is laid on.
  if (finding.severity === 'heavy') {
    items.push(
      item(context, 'subfloor', area, `${evidenceNote} Damage rated heavy, so the substrate is scoped as well.`, {
        needsReview: true,
      })!,
    );
  }

  return items.filter(Boolean);
}

function scopeWalls(context: RuleContext): ScopeItem[] {
  const { room, finding, directives } = context;
  const items: ScopeItem[] = [];
  const wallArea = netWallArea(room);
  const evidenceNote = finding.notes[0] ?? 'damage observed on the walls';

  if (finding.severity === 'light' && !finding.demolished) {
    // Cosmetic wall damage is a paint job. Painting is measured wall to wall
    // regardless of how much of it was stained — you cannot paint a patch.
    items.push(item(context, 'paint_walls', wallArea, `${evidenceNote} Cosmetic only, so the walls are repainted rather than replaced.`)!);
    return items.filter(Boolean);
  }

  // A carrier-approved flood cut is a partial-height replacement, and the
  // notes are the authority on its height.
  const cutHeight = directives.floodCutHeightFt;
  const replacementArea =
    finding.severity === 'moderate' && cutHeight
      ? floodCutArea(room, cutHeight)
      : finding.severity === 'moderate'
        ? affectedArea(wallArea, finding.affectedFraction)
        : wallArea;

  const cutNote = cutHeight && finding.severity === 'moderate' ? ` (${cutHeight}′ flood cut per the job notes)` : '';

  items.push(
    item(context, 'drywall_half', replacementArea, `${evidenceNote} Drywall replaced${cutNote}.`)!,
  );

  // A partial replacement leaves a seam that has to be taped into the existing
  // wall; a full-height replacement does not.
  if (replacementArea < wallArea) {
    items.push(
      item(context, 'drywall_tape', room.perimeterLf, 'Seam between new and existing drywall.')!,
    );
  }

  // Paint covers the whole wall even when only part of it was replaced —
  // scoping paint to the patch guarantees a visible line.
  items.push(item(context, 'paint_walls', wallArea, 'Walls repainted wall-to-wall after drywall work.')!);

  // Removing wall board means the baseboard came off with it, whether or not a
  // photo happened to show the baseboard.
  items.push(
    item(
      context,
      'baseboard',
      baseboardLength(room),
      'Baseboard is removed to replace wall drywall and is scoped to go back.',
      { confidence: Math.min(finding.confidence, 0.75), needsReview: true },
    )!,
  );
  items.push(
    item(context, 'paint_baseboard', baseboardLength(room), 'New baseboard painted.', {
      confidence: Math.min(finding.confidence, 0.75),
      needsReview: true,
    })!,
  );

  return items.filter(Boolean);
}

function scopeCeiling(context: RuleContext): ScopeItem[] {
  const { room, finding } = context;
  const area = room.ceilingAreaSqFt;
  const evidenceNote = finding.notes[0] ?? 'damage observed on the ceiling';

  if (finding.severity === 'light' && !finding.demolished) {
    return [item(context, 'paint_ceiling', area, `${evidenceNote} Staining only, so the ceiling is sealed and repainted.`)!].filter(Boolean);
  }

  return [
    item(context, 'drywall_half', area, `${evidenceNote} Ceiling drywall replaced.`),
    item(context, 'drywall_texture', area, 'Texture applied to match the existing ceiling.', {
      confidence: Math.min(finding.confidence, 0.7),
      needsReview: true,
    }),
    item(context, 'paint_ceiling', area, 'Ceiling repainted after drywall work.'),
  ].filter((entry): entry is ScopeItem => entry !== null);
}

/** Surfaces whose scope is a single item plus its paint companion. */
function scopeSimpleSurface(context: RuleContext): ScopeItem[] {
  const { room, finding } = context;
  const note = finding.notes[0] ?? `damage observed on the ${finding.surface}`;

  switch (finding.surface) {
    case 'baseboard':
      return [
        item(context, 'baseboard', baseboardLength(room), note),
        item(context, 'paint_baseboard', baseboardLength(room), 'New baseboard painted.'),
      ].filter((entry): entry is ScopeItem => entry !== null);

    case 'trim':
      return [
        item(context, 'casing', casingLength(room), note),
        item(context, 'paint_trim', casingLength(room), 'New casing painted.'),
      ].filter((entry): entry is ScopeItem => entry !== null);

    case 'door': {
      const doors = Math.max(1, doorCount(room));
      return [
        item(context, 'interior_door', doors, note),
        item(context, 'paint_door', doors, 'New door painted.'),
      ].filter((entry): entry is ScopeItem => entry !== null);
    }

    case 'insulation':
      return [
        item(
          context,
          'insulation_batt',
          affectedArea(netWallArea(room), finding.affectedFraction),
          note,
        ),
      ].filter((entry): entry is ScopeItem => entry !== null);

    case 'contents':
      return [
        item(context, 'content_manipulation', room.floorAreaSqFt, note),
      ].filter((entry): entry is ScopeItem => entry !== null);

    case 'cabinets':
    case 'countertop': {
      // A 3D scan measures rooms, not casework. Emitting a fabricated linear
      // footage here would be the one number in the estimate with nothing
      // behind it, so the line is raised with the quantity left for a human.
      const key: CatalogKey = finding.surface === 'cabinets' ? 'cabinets_lower' : 'countertop';
      context.warnings.push(
        `${room.name}: ${finding.surface} damage was observed but the scan does not measure casework — enter the linear footage before submitting.`,
      );
      return [
        item(context, key, 0, `${note} Quantity not measurable from the scan — enter the run length.`, {
          needsReview: true,
        }),
      ].filter((entry): entry is ScopeItem => entry !== null);
    }

    default:
      return [];
  }
}

function scopeSurface(context: RuleContext): ScopeItem[] {
  switch (context.finding.surface) {
    case 'floor':
      return scopeFloor(context);
    case 'walls':
      return scopeWalls(context);
    case 'ceiling':
      return scopeCeiling(context);
    default:
      return scopeSimpleSurface(context);
  }
}

/* ------------------------------------------------------------------ */
/* Merge and assemble                                                  */
/* ------------------------------------------------------------------ */

/** Rooms the notes put out of scope, matched loosely against scan room names. */
function isExcluded(room: RoomMeasurements, directives: JobDirectives): boolean {
  return directives.roomsOutOfScope.some(
    (excluded) => similarity(excluded.toLowerCase(), room.name.toLowerCase()) > 0.7,
  );
}

/**
 * Attach mitigation-derived items to the scan room they belong to.
 *
 * Mitigation estimates name rooms in prose ("Master Bedroom", "Bath 2") while
 * the scan names them from the capture. Matching them lets the two sources
 * merge; failing to match keeps the item rather than dropping it, because a
 * documented removal is real work whether or not it lines up with a scan room.
 */
function resolveMitigationRooms(
  mitigationItems: ScopeItem[],
  rooms: RoomMeasurements[],
  warnings: string[],
): ScopeItem[] {
  return mitigationItems.map((mitigationItem) => {
    let best: { room: RoomMeasurements; score: number } | null = null;
    for (const room of rooms) {
      const score = similarity(mitigationItem.roomName.toLowerCase(), room.name.toLowerCase());
      if (!best || score > best.score) best = { room, score };
    }

    if (best && best.score > 0.6) {
      return { ...mitigationItem, roomId: best.room.id, roomName: best.room.name };
    }

    warnings.push(
      `Mitigation line for "${mitigationItem.roomName}" does not match any room in the scan — it is kept in the estimate under that name.`,
    );
    return { ...mitigationItem, needsReview: true };
  });
}

/** Merge duplicate (room, code) pairs, keeping the larger quantity. */
function dedupe(items: ScopeItem[]): ScopeItem[] {
  const merged = new Map<string, ScopeItem>();

  for (const current of items) {
    const key = `${current.roomId}::${current.code}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...current, evidence: [...new Set(current.evidence)] });
      continue;
    }

    const winner = current.quantity > existing.quantity ? current : existing;
    merged.set(key, {
      ...winner,
      evidence: [...new Set([...existing.evidence, ...current.evidence])],
      // Agreement between two independent sources is itself evidence.
      confidence: Math.max(existing.confidence, current.confidence),
      // Combining a photo finding with a documented removal earns the line its
      // way off the review list.
      needsReview: existing.needsReview === true && current.needsReview === true,
      rationale:
        existing.rationale === current.rationale
          ? existing.rationale
          : `${existing.rationale} ${current.rationale}`,
    });
  }

  return [...merged.values()];
}

/**
 * Paint is measured wall to wall.
 *
 * A mitigation line for a 2-foot flood cut yields a 2-foot band of drywall —
 * but you cannot paint a 2-foot band and expect it to disappear. Wherever a
 * paint item lands in a room the scan measured, its quantity is raised to the
 * whole surface. Without this, every mitigation-derived estimate under-scopes
 * paint by the ratio of the cut height to the ceiling height.
 */
const PAINT_SURFACE_AREA: Record<string, (room: RoomMeasurements) => number> = {
  [codeFor('paint_walls')]: (room) => netWallArea(room),
  [codeFor('paint_ceiling')]: (room) => room.ceilingAreaSqFt,
};

function expandPaintToFullSurface(
  items: ScopeItem[],
  roomsById: Map<string, RoomMeasurements>,
): ScopeItem[] {
  return items.map((scopeItem) => {
    const surfaceArea = PAINT_SURFACE_AREA[scopeItem.code];
    const room = roomsById.get(scopeItem.roomId);
    if (!surfaceArea || !room) return scopeItem;

    const full = surfaceArea(room);
    if (full <= scopeItem.quantity) return scopeItem;

    return {
      ...scopeItem,
      quantity: full,
      rationale: `${scopeItem.rationale} Painted wall-to-wall rather than to the patch, so the repair is not visible.`,
    };
  });
}

/**
 * Codes that mean material left the building. Debris volume follows these, not
 * paint or cleaning — a repainted wall generates no dumpster load.
 */
const REPLACEMENT_CODES = new Set(
  (
    [
      'drywall_half',
      'drywall_five_eighths',
      'carpet',
      'carpet_pad',
      'luxury_vinyl_plank',
      'engineered_wood',
      'sheet_vinyl',
      'ceramic_tile',
      'subfloor',
      'insulation_batt',
    ] as CatalogKey[]
  ).map(codeFor),
);

export interface ScopeInput {
  rooms: RoomMeasurements[];
  observations: DamageObservation[];
  directives?: JobDirectives;
  /** Items derived from the mitigation estimate, if one was supplied. */
  mitigationItems?: ScopeItem[];
  /** Job address — drives local code / permit packs. */
  address?: JobAddress;
}

export interface ScopeResult {
  items: ScopeItem[];
  warnings: string[];
  /** How many companion lines the knowledge base added. */
  dependentsAdded: number;
  /** Equipment sizing notes for the run log. */
  equipmentNotes: string[];
  /** Jurisdiction pack that fired, when codes ran. */
  jurisdiction?: string;
}

export function buildScope(input: ScopeInput): ScopeResult {
  const directives = input.directives ?? EMPTY_DIRECTIVES;
  const warnings: string[] = [];

  // Surface free-text carrier directives so a reviewer sees them even when the
  // rule engine cannot act on every one automatically.
  for (const directive of directives.directives) {
    warnings.push(`Job directive: ${directive}`);
  }
  if (directives.waterCategory) {
    warnings.push(
      `Water category ${directives.waterCategory} recorded from the job notes — rebuild assumes mitigation already treated cavities appropriately.`,
    );
  }

  const roomsById = new Map(input.rooms.map((room) => [room.id, room]));
  const scopedRooms = input.rooms.filter((room) => {
    if (!isExcluded(room, directives)) return true;
    warnings.push(`${room.name}: excluded — the job notes place it out of scope.`);
    return false;
  });
  const scopedRoomIds = new Set(scopedRooms.map((room) => room.id));

  const findings = mergeObservations(input.observations);

  const orphaned = input.observations.filter((o) => !o.roomId);
  if (orphaned.length > 0) {
    warnings.push(
      `${orphaned.length} photo observation(s) could not be tied to a room and were not scoped. Tag those photos with a room in DocuSketch and re-run.`,
    );
  }

  const fromPhotos: ScopeItem[] = [];
  for (const finding of findings) {
    if (!scopedRoomIds.has(finding.roomId)) continue;
    const room = roomsById.get(finding.roomId);
    if (!room) continue;
    if (finding.confidence < 0.4) continue; // below what the model is asked to report

    fromPhotos.push(...scopeSurface({ room, finding, directives, warnings }));
  }

  const fromMitigation = input.mitigationItems
    ? resolveMitigationRooms(input.mitigationItems, scopedRooms, warnings)
    : [];

  let combined = expandPaintToFullSurface(
    dedupe([...fromPhotos, ...fromMitigation]),
    roomsById,
  );

  // Cleanup and debris follow from the work itself rather than from any single
  // observation, so they are added once per room that ended up with scope.
  const byRoom = new Map<string, ScopeItem[]>();
  for (const scopeItem of combined) {
    const bucket = byRoom.get(scopeItem.roomId);
    if (bucket) bucket.push(scopeItem);
    else byRoom.set(scopeItem.roomId, [scopeItem]);
  }

  const closeout: ScopeItem[] = [];
  for (const [roomId, roomItems] of byRoom) {
    const room = roomsById.get(roomId);
    const roomName = roomItems[0]!.roomName;
    const removedArea = roomItems
      .filter((entry) => entry.unit === 'SF' && REPLACEMENT_CODES.has(entry.code))
      .reduce((sum, entry) => sum + entry.quantity, 0);

    if (room) {
      closeout.push({
        roomId,
        roomName,
        code: codeFor('final_clean'),
        description: CATALOG.final_clean.description,
        unit: CATALOG.final_clean.unit,
        quantity: room.floorAreaSqFt,
        rationale: 'Final clean after construction work in this room.',
        confidence: 0.95,
        evidence: [],
      });
    }

    closeout.push({
      roomId,
      roomName,
      code: codeFor('debris_haul'),
      description: CATALOG.debris_haul.description,
      unit: CATALOG.debris_haul.unit,
      quantity: debrisLoads(removedArea),
      rationale: `Debris from roughly ${Math.round(removedArea)} SF of removed and replaced finishes.`,
      confidence: 0.8,
      evidence: [],
    });
  }

  combined = dedupe([...combined, ...closeout]);

  // Knowledge base: assembly companions (pad, primer, outlets, filters, …).
  const expanded = expandDependents(combined, scopedRooms);
  combined = dedupe(expanded.items);
  if (expanded.added > 0) {
    warnings.push(
      `Construction knowledge base added ${expanded.added} companion line(s) so assemblies are complete.`,
    );
  }

  // Construction-phase equipment sized to dusty work volume.
  const equipment = sizeConstructionEquipment(combined, scopedRooms);
  combined = dedupe([...combined, ...equipment.items]);
  for (const note of equipment.notes) warnings.push(note);

  // Local codes / permits from the job address.
  let jurisdiction: string | undefined;
  if (input.address) {
    const codes = applyCodeRequirements(combined, {
      address: input.address,
      rooms: scopedRooms,
      waterCategory: directives.waterCategory,
      directives,
    });
    jurisdiction = codes.jurisdiction;
    combined = dedupe([...combined, ...codes.items]);
    warnings.push(...codes.warnings);
  }

  // Second pass: equipment/code lines can unlock further companions
  // (scrubber → filters is already in equipment; final_clean → hepa_vacuum).
  const second = expandDependents(combined, scopedRooms);
  combined = dedupe(second.items);

  const emptyRooms = scopedRooms.filter((room) => !byRoom.has(room.id));
  if (emptyRooms.length > 0 && input.observations.length > 0) {
    warnings.push(
      `No work was scoped in: ${emptyRooms.map((room) => room.name).join(', ')}. Confirm these rooms are genuinely undamaged.`,
    );
  }

  return {
    items: combined,
    warnings,
    dependentsAdded: expanded.added + second.added,
    equipmentNotes: equipment.notes,
    jurisdiction,
  };
}
