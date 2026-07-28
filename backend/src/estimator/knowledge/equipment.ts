import { CATALOG, codeFor, type CatalogKey } from '../pricing/catalog.js';
import { round2 } from '../scope/quantities.js';
import type { RoomMeasurements, ScopeItem, Unit } from '../types.js';

/**
 * Construction-phase equipment sizing.
 *
 * Mitigation already ran the dryout. This is the *rebuild* equipment: HEPA air
 * scrubbers, filter changes, containment, and negative air used while sanding
 * drywall, cutting flooring, and generating construction dust. Skipping them
 * leaves a scope that cannot actually be performed cleanly — and an adjuster
 * who knows the trade will ask where the scrubbers are.
 *
 * Sizing follows common restoration / remodel practice:
 *   • One HEPA scrubber covers roughly 1,000 cubic feet at ~4–6 ACH for dust.
 *   • Each scrubber-day needs a filter change budget (dirty filters stop working).
 *   • Dusty trades (drywall, sanding, tile demo remnants) trigger containment.
 *   • Days are derived from scope volume — not a flat “1 day” guess.
 */

/** Catalog keys whose installation generates fine particulate / silica dust. */
const DUSTY_KEYS: CatalogKey[] = [
  'drywall_half',
  'drywall_five_eighths',
  'drywall_texture',
  'drywall_tape',
  'ceramic_tile',
  'hardwood_refinish',
  'subfloor',
  'floor_prep',
];

const DUSTY_CODES = new Set(DUSTY_KEYS.map(codeFor));

export interface EquipmentPlan {
  items: ScopeItem[];
  /** Human-readable sizing notes for the event log / review UI. */
  notes: string[];
}

function roomVolume(room: RoomMeasurements): number {
  return room.floorAreaSqFt * room.ceilingHeightFt;
}

/**
 * Scrubber count for a work volume.
 *
 * Industry rule of thumb for construction dust: ~1 unit per 1,000 CF, minimum
 * one whenever dusty work is happening in the room.
 */
export function scrubbersForVolume(cubicFeet: number): number {
  if (cubicFeet <= 0) return 0;
  return Math.max(1, Math.ceil(cubicFeet / 1000));
}

/**
 * Estimated work days from dusty SF. Drywall hang/tape/float/sand is roughly
 * 200 SF per crew-day for a flood-cut band; flooring prep ~300 SF/day.
 */
export function workDaysForDustyArea(dustySqFt: number): number {
  if (dustySqFt <= 0) return 0;
  return Math.max(1, Math.ceil(dustySqFt / 200));
}

function isDusty(item: ScopeItem): boolean {
  return DUSTY_CODES.has(item.code);
}

/**
 * Size and emit construction equipment for every room that has dusty rebuild
 * work. Job-level dumpster is added once when total debris volume warrants it.
 */
export function sizeConstructionEquipment(
  items: ScopeItem[],
  rooms: RoomMeasurements[],
): EquipmentPlan {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const byRoom = new Map<string, ScopeItem[]>();
  for (const item of items) {
    const bucket = byRoom.get(item.roomId);
    if (bucket) bucket.push(item);
    else byRoom.set(item.roomId, [item]);
  }

  const equipment: ScopeItem[] = [];
  const notes: string[] = [];
  let totalDustySf = 0;
  let totalScrubberDays = 0;

  for (const [roomId, roomItems] of byRoom) {
    const dusty = roomItems.filter(isDusty);
    if (dusty.length === 0) continue;

    const room = roomsById.get(roomId);
    const roomName = roomItems[0]!.roomName;
    const dustySf = dusty
      .filter((item) => item.unit === 'SF')
      .reduce((sum, item) => sum + item.quantity, 0);
    totalDustySf += dustySf;

    const volume = room ? roomVolume(room) : dustySf * 8;
    const scrubbers = scrubbersForVolume(volume);
    const days = workDaysForDustyArea(dustySf || room?.floorAreaSqFt || 100);
    const scrubberDays = scrubbers * days;
    totalScrubberDays += scrubberDays;

    // Filter changes: one set per scrubber per day of operation (minimum one).
    const filterChanges = Math.max(scrubbers, scrubberDays);

    notes.push(
      `${roomName}: ${scrubbers} HEPA scrubber(s) × ${days} day(s) for ~${Math.round(volume)} CF ` +
        `(${Math.round(dustySf)} SF dusty work) → ${filterChanges} filter change(s).`,
    );

    const evidence = [...new Set(dusty.flatMap((item) => item.evidence))];
    const base = {
      roomId,
      roomName,
      confidence: 0.85,
      evidence: [...evidence, 'equipment:sizing'],
    };

    equipment.push({
      ...base,
      code: codeFor('hepa_air_scrubber'),
      description: CATALOG.hepa_air_scrubber.description,
      unit: CATALOG.hepa_air_scrubber.unit as Unit,
      quantity: scrubberDays,
      rationale:
        `${scrubbers} HEPA air scrubber(s) required for ~${Math.round(volume)} CF of work area ` +
        `during ${days} day(s) of dusty reconstruction (drywall / flooring). ` +
        `Sized at 1 unit per 1,000 CF.`,
    });

    equipment.push({
      ...base,
      code: codeFor('hepa_filter_change'),
      description: CATALOG.hepa_filter_change.description,
      unit: CATALOG.hepa_filter_change.unit as Unit,
      quantity: filterChanges,
      rationale:
        `Each scrubber-day needs a clean HEPA filter — ${scrubbers} unit(s) × ${days} day(s) ` +
        `(${filterChanges} change(s)). Filters are not optional when scrubbers are required.`,
    });

    // Containment around the work area perimeter.
    const containmentLf = room
      ? round2(room.perimeterLf)
      : round2(Math.sqrt(Math.max(dustySf, 1)) * 4);
    equipment.push({
      ...base,
      code: codeFor('containment_barrier'),
      description: CATALOG.containment_barrier.description,
      unit: CATALOG.containment_barrier.unit as Unit,
      quantity: containmentLf,
      confidence: 0.8,
      rationale:
        'Temporary containment keeps construction dust out of clean rooms while drywall and flooring are rebuilt.',
    });

    equipment.push({
      ...base,
      code: codeFor('zip_pole_door'),
      description: CATALOG.zip_pole_door.description,
      unit: CATALOG.zip_pole_door.unit as Unit,
      quantity: 1,
      confidence: 0.8,
      rationale: 'Zippered door in the containment wall for crew access.',
    });

    // Negative air when the dusty area is large enough to warrant it.
    if (volume >= 1500 || dustySf >= 200) {
      equipment.push({
        ...base,
        code: codeFor('negative_air_machine'),
        description: CATALOG.negative_air_machine.description,
        unit: CATALOG.negative_air_machine.unit as Unit,
        quantity: days,
        confidence: 0.75,
        needsReview: true,
        rationale:
          `Negative air for ${days} day(s) — work volume (~${Math.round(volume)} CF) warrants ` +
          'pressurization control beyond a scrubber alone.',
      });
    }

    if (room) {
      equipment.push({
        ...base,
        code: codeFor('plastic_protection'),
        description: CATALOG.plastic_protection.description,
        unit: CATALOG.plastic_protection.unit as Unit,
        quantity: round2(room.floorAreaSqFt + room.ceilingAreaSqFt * 0.25),
        confidence: 0.8,
        rationale: 'Plastic protection on floors and remaining finishes inside the work area.',
      });

      equipment.push({
        ...base,
        code: codeFor('floor_protection'),
        description: CATALOG.floor_protection.description,
        unit: CATALOG.floor_protection.unit as Unit,
        quantity: room.floorAreaSqFt,
        confidence: 0.75,
        rationale: 'Floor protection board in traffic paths during reconstruction.',
      });
    }
  }

  // Job-level dumpster when total dusty work exceeds what pickup loads handle cleanly.
  if (totalDustySf >= 400) {
    const dumpsters = Math.max(1, Math.ceil(totalDustySf / 800));
    equipment.push({
      roomId: 'job:general',
      roomName: 'General',
      code: codeFor('dumpster_rental'),
      description: CATALOG.dumpster_rental.description,
      unit: CATALOG.dumpster_rental.unit as Unit,
      quantity: dumpsters,
      rationale:
        `${dumpsters} dumpster(s) for ~${Math.round(totalDustySf)} SF of reconstruction debris ` +
        '— pickup-truck loads alone are not practical at this volume.',
      confidence: 0.85,
      evidence: ['equipment:sizing'],
    });
    notes.push(
      `Job: ${dumpsters} dumpster(s) sized from ${Math.round(totalDustySf)} SF dusty/rebuild area.`,
    );
  }

  if (totalScrubberDays > 0) {
    notes.unshift(
      `Construction equipment: ${totalScrubberDays} scrubber-day(s) across dusty rooms ` +
        `(mitigation dryout equipment is intentionally excluded — this is rebuild dust control).`,
    );
  }

  // Avoid duplicating keys already present (e.g. from a prior expansion).
  const existing = new Set(items.map((item) => `${item.roomId}::${item.code}`));
  const filtered = equipment.filter((item) => !existing.has(`${item.roomId}::${item.code}`));

  return { items: filtered, notes };
}

/** True when a catalog key is construction equipment (not mitigation dryout). */
export function isConstructionEquipment(key: CatalogKey): boolean {
  return (
    key === 'hepa_air_scrubber' ||
    key === 'hepa_filter_change' ||
    key === 'negative_air_machine' ||
    key === 'containment_barrier' ||
    key === 'zip_pole_door'
  );
}

/** Helper for tests / completeness — scrubber math without building scope. */
export function planForRoom(room: RoomMeasurements, dustySqFt: number) {
  const volume = roomVolume(room);
  const scrubbers = scrubbersForVolume(volume);
  const days = workDaysForDustyArea(dustySqFt);
  return {
    volume: round2(volume),
    scrubbers,
    days,
    scrubberDays: scrubbers * days,
    filterChanges: Math.max(scrubbers, scrubbers * days),
  };
}
