import { CATALOG, codeFor, keyForCode, type CatalogKey } from '../pricing/catalog.js';
import type { JobDirectives } from '../ai/noteAnalysis.js';
import type { JobAddress, RoomMeasurements, ScopeItem, Unit } from '../types.js';

/**
 * Local construction codes and permit rules that change a rebuild estimate.
 *
 * A complete post-mitigation rebuild is not only "put the finishes back." When
 * walls are opened, many jurisdictions require smoke/CO detectors to current
 * code, GFCI protection in wet areas, and a building permit above trivial
 * thresholds. Ignoring them produces an estimate that cannot be performed
 * legally — or that fails inspection and comes back as a supplement.
 *
 * Rules are conservative: they add flagged line items with rationale citing
 * the jurisdiction pack, never silently. Unknown jurisdictions still get the
 * IRC-baseline pack so the estimate is not empty of code work.
 */

export interface CodeContext {
  address: JobAddress;
  rooms: RoomMeasurements[];
  /** Water category from notes, when known. */
  waterCategory?: number | null;
  directives?: JobDirectives;
}

export interface CodeFinding {
  items: ScopeItem[];
  warnings: string[];
  /** Which jurisdiction pack fired. */
  jurisdiction: string;
}

interface JurisdictionPack {
  id: string;
  /** Match against state (case-insensitive). Empty = baseline fallback. */
  states: string[];
  /** SF of drywall / structural work that triggers a building permit. */
  permitDrywallSf: number;
  /** Always require interconnected smoke detectors after bedroom wall work. */
  smokeAfterBedroomWork: boolean;
  /** CO detectors when fuel-burning appliances / attached garage context. */
  coDetectors: boolean;
  /** GFCI required in baths, kitchens, laundry, garage, unfinished basements. */
  gfciWetAreas: boolean;
}

const PACKS: JurisdictionPack[] = [
  {
    id: 'california',
    states: ['CA', 'California'],
    permitDrywallSf: 100,
    smokeAfterBedroomWork: true,
    coDetectors: true,
    gfciWetAreas: true,
  },
  {
    id: 'new_york',
    states: ['NY', 'New York'],
    permitDrywallSf: 100,
    smokeAfterBedroomWork: true,
    coDetectors: true,
    gfciWetAreas: true,
  },
  {
    id: 'florida',
    states: ['FL', 'Florida'],
    permitDrywallSf: 150,
    smokeAfterBedroomWork: true,
    coDetectors: true,
    gfciWetAreas: true,
  },
  {
    id: 'texas',
    states: ['TX', 'Texas'],
    permitDrywallSf: 200,
    smokeAfterBedroomWork: true,
    coDetectors: true,
    gfciWetAreas: true,
  },
  {
    id: 'irc_baseline',
    states: [],
    permitDrywallSf: 200,
    smokeAfterBedroomWork: true,
    coDetectors: true,
    gfciWetAreas: true,
  },
];

const WET_ROOM = /\b(bath|powder|kitchen|laundry|utility|garage|basement)\b/i;
const BEDROOM = /\b(bed|master|sleep)\b/i;

function pickPack(address: JobAddress): JurisdictionPack {
  const state = (address.state ?? '').trim();
  if (state) {
    const match = PACKS.find(
      (pack) =>
        pack.states.length > 0 &&
        pack.states.some((candidate) => candidate.toLowerCase() === state.toLowerCase()),
    );
    if (match) return match;
  }
  return PACKS[PACKS.length - 1]!;
}

function hasDrywall(items: ScopeItem[]): boolean {
  return items.some((item) => {
    const key = keyForCode(item.code);
    return key === 'drywall_half' || key === 'drywall_five_eighths';
  });
}

function drywallSf(items: ScopeItem[]): number {
  return items
    .filter((item) => {
      const key = keyForCode(item.code);
      return key === 'drywall_half' || key === 'drywall_five_eighths';
    })
    .reduce((sum, item) => sum + item.quantity, 0);
}

function hasKey(items: ScopeItem[], key: CatalogKey): boolean {
  const code = codeFor(key);
  return items.some((item) => item.code === code);
}

function makeJobItem(
  key: CatalogKey,
  quantity: number,
  rationale: string,
  _anchor: ScopeItem | undefined,
): ScopeItem {
  const catalogItem = CATALOG[key];
  return {
    roomId: 'job:general',
    roomName: 'General',
    code: codeFor(key),
    description: catalogItem.description,
    unit: catalogItem.unit as Unit,
    quantity,
    rationale,
    confidence: 0.8,
    evidence: ['code:jurisdiction'],
    needsReview: true,
  };
}

function makeRoomItem(
  room: RoomMeasurements,
  key: CatalogKey,
  quantity: number,
  rationale: string,
): ScopeItem {
  const catalogItem = CATALOG[key];
  return {
    roomId: room.id,
    roomName: room.name,
    code: codeFor(key),
    description: catalogItem.description,
    unit: catalogItem.unit as Unit,
    quantity,
    rationale,
    confidence: 0.8,
    evidence: ['code:jurisdiction'],
    needsReview: true,
  };
}

/**
 * Apply jurisdiction construction-code requirements to a rebuild scope.
 */
export function applyCodeRequirements(
  items: ScopeItem[],
  context: CodeContext,
): CodeFinding {
  const pack = pickPack(context.address);
  const warnings: string[] = [];
  const additions: ScopeItem[] = [];
  const roomsById = new Map(context.rooms.map((room) => [room.id, room]));

  const byRoom = new Map<string, ScopeItem[]>();
  for (const item of items) {
    const bucket = byRoom.get(item.roomId);
    if (bucket) bucket.push(item);
    else byRoom.set(item.roomId, [item]);
  }

  const totalDrywall = drywallSf(items);
  const anchor = items[0];

  if (totalDrywall >= pack.permitDrywallSf && !hasKey(items, 'building_permit')) {
    additions.push(
      makeJobItem(
        'building_permit',
        1,
        `Building permit required under ${pack.id} rules — ${Math.round(totalDrywall)} SF of drywall ` +
          `meets/exceeds the ${pack.permitDrywallSf} SF threshold for reconstruction permits.`,
        anchor,
      ),
    );
    additions.push(
      makeJobItem(
        'inspection_fee',
        1,
        `Municipal inspection fee paired with the building permit (${pack.id}).`,
        anchor,
      ),
    );
    warnings.push(
      `Code (${pack.id}): building permit + inspection added for ${Math.round(totalDrywall)} SF drywall work.`,
    );
  }

  for (const [roomId, roomItems] of byRoom) {
    const room =
      roomsById.get(roomId) ??
      ({
        id: roomId,
        name: roomItems[0]!.roomName,
        floorAreaSqFt: 0,
        ceilingAreaSqFt: 0,
        wallAreaSqFt: 0,
        perimeterLf: 0,
        ceilingHeightFt: 8,
        openings: [],
        roomType: roomItems[0]!.roomName,
      } satisfies RoomMeasurements);

    const roomLabel = `${room.name} ${room.roomType ?? ''}`;
    const wallWork = hasDrywall(roomItems);

    if (pack.smokeAfterBedroomWork && wallWork && BEDROOM.test(roomLabel)) {
      if (!hasKey(roomItems, 'smoke_detector') && !hasKey(additions, 'smoke_detector')) {
        // one per bedroom with wall work; also ensure hallway later
        additions.push(
          makeRoomItem(
            room,
            'smoke_detector',
            1,
            `Smoke detector to current code after bedroom wall reconstruction (${pack.id} / IRC R314).`,
          ),
        );
      }
    }

    if (pack.gfciWetAreas && wallWork && WET_ROOM.test(roomLabel)) {
      if (!hasKey(roomItems, 'gfci_outlet') && !additions.some((a) => a.roomId === room.id && a.code === codeFor('gfci_outlet'))) {
        additions.push(
          makeRoomItem(
            room,
            'gfci_outlet',
            2,
            `GFCI-protected receptacles required in wet areas when walls are opened (${pack.id} / NEC 210.8). Confirm device count.`,
          ),
        );
      }
    }
  }

  // Interconnected smoke in hallway when any bedroom was opened.
  const bedroomWork = [...byRoom.entries()].some(([roomId, roomItems]) => {
    const room = roomsById.get(roomId);
    const label = `${room?.name ?? roomItems[0]?.roomName ?? ''} ${room?.roomType ?? ''}`;
    return hasDrywall(roomItems) && BEDROOM.test(label);
  });

  if (pack.smokeAfterBedroomWork && bedroomWork) {
    const hallway = context.rooms.find((room) => /\b(hall|corridor)\b/i.test(room.name));
    if (hallway && !hasKey(items, 'smoke_detector')) {
      const already = additions.some(
        (item) => item.roomId === hallway.id && item.code === codeFor('smoke_detector'),
      );
      if (!already) {
        additions.push(
          makeRoomItem(
            hallway,
            'smoke_detector',
            1,
            `Hallway smoke detector required for interconnection when bedroom walls were opened (${pack.id}).`,
          ),
        );
      }
    }
  }

  if (pack.coDetectors && totalDrywall >= pack.permitDrywallSf) {
    const hasCo = hasKey(items, 'co_detector') || hasKey(additions, 'co_detector');
    if (!hasCo) {
      const living =
        context.rooms.find((room) => /\b(living|family|great)\b/i.test(room.name)) ??
        context.rooms[0];
      if (living) {
        additions.push(
          makeRoomItem(
            living,
            'co_detector',
            1,
            `Carbon monoxide detector to current code on reconstruction permits (${pack.id} / IRC R315).`,
          ),
        );
      }
    }
  }

  // Category 3 water: flag that antimicrobial sealers / specialty coatings may
  // still be needed on remaining framing — rebuild paints over sealed substrate.
  if (context.waterCategory === 3) {
    warnings.push(
      'Code / health: Category 3 water loss — confirm remaining framing was sealed during mitigation before finishes go back. Do not paint over contaminated substrate.',
    );
  }

  if (context.waterCategory === 2) {
    warnings.push(
      'Category 2 water loss — confirm affected cavity surfaces were cleaned/treated during mitigation before rebuild.',
    );
  }

  // Deduplicate against existing scope.
  const existing = new Set(items.map((item) => `${item.roomId}::${item.code}`));
  const filtered = additions.filter((item) => !existing.has(`${item.roomId}::${item.code}`));

  return { items: filtered, warnings, jurisdiction: pack.id };
}
