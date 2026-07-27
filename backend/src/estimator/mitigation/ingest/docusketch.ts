import { deriveGeometry, round, clamp } from '../lib/geometry.js';
import type { AffectedMaterial, AssessedRoom, Evidence, MaterialType, Unit } from '../types.js';

/**
 * DocuSketch ingestion.
 *
 * DocuSketch produces a measured 3D scan of the loss: rooms with real surface
 * areas, perimeters and openings. It is the most trustworthy source of geometry
 * the agent gets, so its numbers win over anything a technician typed by hand.
 *
 * The parser is deliberately tolerant about key names. DocuSketch's JSON export,
 * its Sketch API payload and the intermediate JSON some ESX converters emit all
 * describe the same rooms with different spellings (`floorArea` vs `floor_sf` vs
 * `area`). Rejecting a scan over a key name would mean a technician re-scanning
 * a house, so every field is read through an alias list and anything genuinely
 * missing is derived (see `deriveGeometry`) rather than treated as fatal.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DocuSketchParseResult {
  rooms: AssessedRoom[];
  evidence: Evidence[];
  propertyAddress?: string;
  warnings: string[];
}

/** Read the first present key from a list of aliases. */
function pick(source: any, ...keys: string[]): any {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function num(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(value: any): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Map DocuSketch's material vocabulary onto ours. Unknown finishes are dropped
 * rather than guessed — a wrong material would silently change a flood cut.
 */
const MATERIAL_ALIASES: Record<string, MaterialType> = {
  carpet: 'carpet',
  'carpet pad': 'carpet_pad',
  pad: 'carpet_pad',
  padding: 'carpet_pad',
  hardwood: 'hardwood',
  wood: 'hardwood',
  'solid hardwood': 'hardwood',
  engineered: 'engineered_wood',
  'engineered wood': 'engineered_wood',
  laminate: 'laminate',
  lvp: 'vinyl_plank',
  'luxury vinyl plank': 'vinyl_plank',
  'vinyl plank': 'vinyl_plank',
  vinyl: 'sheet_vinyl',
  'sheet vinyl': 'sheet_vinyl',
  linoleum: 'sheet_vinyl',
  tile: 'tile',
  ceramic: 'tile',
  porcelain: 'tile',
  concrete: 'concrete',
  slab: 'concrete',
  drywall: 'drywall',
  gypsum: 'drywall',
  sheetrock: 'drywall',
  plaster: 'plaster',
  insulation: 'insulation',
  baseboard: 'baseboard',
  base: 'baseboard',
  trim: 'baseboard',
  cabinet: 'cabinetry',
  cabinets: 'cabinetry',
  cabinetry: 'cabinetry',
  subfloor: 'subfloor_wood',
  osb: 'subfloor_wood',
  plywood: 'subfloor_wood',
};

export function normalizeMaterial(raw: unknown): MaterialType | undefined {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!key) return undefined;
  if (MATERIAL_ALIASES[key]) return MATERIAL_ALIASES[key];
  // Fall back to a substring match so "Carpet - Berber" still resolves.
  const hit = Object.keys(MATERIAL_ALIASES).find((alias) => key.includes(alias));
  return hit ? MATERIAL_ALIASES[hit] : undefined;
}

/** Porous materials cannot be cleaned back to a Category 3 standard. */
const POROUS: ReadonlySet<MaterialType> = new Set<MaterialType>([
  'carpet',
  'carpet_pad',
  'drywall',
  'plaster',
  'insulation',
  'baseboard',
  'subfloor_wood',
  'laminate',
  'contents',
]);

export function isPorous(material: MaterialType): boolean {
  return POROUS.has(material);
}

const SURFACE_FOR_MATERIAL: Record<MaterialType, 'floor' | 'wall' | 'ceiling' | 'contents'> = {
  carpet: 'floor',
  carpet_pad: 'floor',
  hardwood: 'floor',
  engineered_wood: 'floor',
  laminate: 'floor',
  vinyl_plank: 'floor',
  sheet_vinyl: 'floor',
  tile: 'floor',
  concrete: 'floor',
  subfloor_wood: 'floor',
  drywall: 'wall',
  plaster: 'wall',
  insulation: 'wall',
  baseboard: 'wall',
  cabinetry: 'wall',
  ceiling_drywall: 'ceiling',
  contents: 'contents',
};

export function surfaceFor(material: MaterialType): 'floor' | 'wall' | 'ceiling' | 'contents' {
  return SURFACE_FOR_MATERIAL[material];
}

/** Trim is measured in linear feet; everything else in square feet. */
function unitFor(material: MaterialType): Unit {
  return material === 'baseboard' ? 'LF' : material === 'cabinetry' ? 'LF' : 'SF';
}

/**
 * Parse a DocuSketch export into rooms.
 *
 * @param payload The raw export — either `{ rooms: [...] }`, `{ data: { rooms } }`,
 *                or a bare array of rooms.
 */
export function parseDocuSketch(payload: unknown): DocuSketchParseResult {
  const warnings: string[] = [];
  const evidence: Evidence[] = [];

  const root: any = payload ?? {};
  const rawRooms: any[] =
    (Array.isArray(root) && root) ||
    pick(root, 'rooms', 'Rooms', 'spaces', 'areas') ||
    pick(pick(root, 'data', 'project', 'sketch') ?? {}, 'rooms', 'spaces', 'areas') ||
    [];

  if (!Array.isArray(rawRooms) || rawRooms.length === 0) {
    warnings.push('DocuSketch export contained no rooms — geometry will come from other sources.');
    return { rooms: [], evidence, warnings };
  }

  const propertyAddress =
    str(pick(root, 'address', 'propertyAddress', 'property_address')) ??
    str(pick(pick(root, 'property', 'project') ?? {}, 'address'));

  const rooms: AssessedRoom[] = [];

  rawRooms.forEach((raw, index) => {
    const name = str(pick(raw, 'name', 'roomName', 'room_name', 'label')) ?? `Room ${index + 1}`;
    const id = str(pick(raw, 'id', 'roomId', 'room_id', 'uuid')) ?? slug(name, index);
    const level = str(pick(raw, 'level', 'floor', 'story', 'levelName')) ?? 'Main Level';

    const dims = pick(raw, 'dimensions', 'size') ?? raw;
    const geometry = deriveGeometry({
      lengthFt: num(pick(dims, 'length', 'lengthFt', 'length_ft', 'l')),
      widthFt: num(pick(dims, 'width', 'widthFt', 'width_ft', 'w')),
      heightFt: num(pick(dims, 'height', 'heightFt', 'height_ft', 'ceilingHeight', 'h')),
      floorSF: num(pick(raw, 'floorArea', 'floorSF', 'floor_sf', 'floorAreaSqFt', 'area')),
      ceilingSF: num(pick(raw, 'ceilingArea', 'ceilingSF', 'ceiling_sf')),
      wallSF: num(pick(raw, 'wallArea', 'wallSF', 'wall_sf', 'wallAreaSqFt')),
      perimeterLF: num(pick(raw, 'perimeter', 'perimeterLF', 'perimeter_lf', 'floorPerimeter')),
      offsets: num(pick(raw, 'offsets', 'insideCorners', 'corners')),
      openingSF: openingArea(raw),
    });

    if (geometry.floorSF <= 0) {
      warnings.push(`DocuSketch room "${name}" had no usable dimensions and was skipped.`);
      return;
    }

    const affectedFloorFraction = clamp(
      num(pick(raw, 'affectedFraction', 'wetFraction', 'affected_percent')) ?? 1,
      0,
      1,
    );

    const ceilingAffected = Boolean(
      pick(raw, 'ceilingAffected', 'ceiling_affected', 'ceilingWet') ?? false,
    );

    rooms.push({
      id,
      name,
      level,
      geometry,
      affectedFloorFraction: affectedFloorFraction > 1 ? affectedFloorFraction / 100 : affectedFloorFraction,
      materials: parseMaterials(raw, geometry.floorSF, geometry.perimeterLF, warnings, name),
      ceilingAffected,
      notes: str(pick(raw, 'notes', 'comment', 'description')),
    });

    evidence.push({
      id: `sketch-${id}`,
      kind: 'sketch',
      roomId: id,
      description: `DocuSketch measurement for ${name}: ${geometry.floorSF} SF floor, ${geometry.perimeterLF} LF perimeter, ${geometry.heightFt} ft ceiling.`,
      tags: ['docusketch', 'measurement', level.toLowerCase().replace(/\s+/g, '_')],
    });
  });

  return { rooms, evidence, propertyAddress, warnings };
}

/** Sum door/window/opening areas so wall quantities can be taken net. */
function openingArea(raw: any): number | undefined {
  const explicit = num(pick(raw, 'openingArea', 'openingSF', 'opening_sf'));
  if (explicit !== undefined) return explicit;

  const openings = pick(raw, 'openings', 'doors', 'windows');
  if (!Array.isArray(openings)) return undefined;

  const total = openings.reduce((sum: number, opening: any) => {
    const area =
      num(pick(opening, 'area', 'areaSqFt', 'sf')) ??
      (num(pick(opening, 'width')) ?? 0) * (num(pick(opening, 'height')) ?? 0);
    return sum + (Number.isFinite(area) ? area : 0);
  }, 0);
  return total > 0 ? round(total) : undefined;
}

/**
 * Read the affected-material list. When DocuSketch reports finishes without
 * quantities we fall back to the room's own geometry, which is the correct
 * default: a wet carpet is wet across the affected floor, not across some
 * unstated fraction of it.
 */
function parseMaterials(
  raw: any,
  floorSF: number,
  perimeterLF: number,
  warnings: string[],
  roomName: string,
): AffectedMaterial[] {
  const list = pick(raw, 'materials', 'finishes', 'affectedMaterials', 'affected_materials');
  if (!Array.isArray(list)) return [];

  const materials: AffectedMaterial[] = [];
  for (const entry of list) {
    const material = normalizeMaterial(
      pick(entry, 'material', 'type', 'name', 'finish') ?? entry,
    );
    if (!material) {
      warnings.push(
        `Unrecognised material "${String(pick(entry, 'material', 'type', 'name') ?? entry)}" in ${roomName} — not scoped.`,
      );
      continue;
    }

    const unit = unitFor(material);
    const fallback = unit === 'LF' ? perimeterLF : floorSF;
    const quantity = num(pick(entry, 'quantity', 'amount', 'area', 'sf', 'lf')) ?? fallback;

    materials.push({
      material,
      surface: surfaceFor(material),
      quantity: round(quantity),
      unit,
      wetHeightIn: num(pick(entry, 'wetHeight', 'wetHeightIn', 'waterLine')),
      cavityWet: Boolean(pick(entry, 'cavityWet', 'cavity_wet', 'insulationWet') ?? false),
      porous: isPorous(material),
      salvageable: Boolean(pick(entry, 'salvageable', 'dryInPlace') ?? !isPorous(material)),
    });
  }
  return materials;
}

function slug(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base ? `${base}-${index}` : `room-${index}`;
}
