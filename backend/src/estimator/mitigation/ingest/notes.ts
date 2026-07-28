import { round } from '../lib/geometry.js';
import { inferCause } from './mica.js';
import { normalizeMaterial } from './docusketch.js';
import type { Evidence, LossCause, MaterialType, WaterCategory } from '../types.js';

/**
 * Field-note ingestion.
 *
 * Technicians write things down that no structured system captured: "cat 3 from
 * the toilet supply, cut 2ft in the hall bath", "12x14 bedroom, carpet and pad
 * out", "6 movers 2 lgr set 5/17". These notes are frequently the only record of
 * a decision that changes the estimate by four figures.
 *
 * This parser extracts *hints*, never facts. Every value it produces is
 * overridden by a structured source that covers the same ground — DocuSketch
 * geometry beats "12x14", a MICA category field beats "cat 3" in prose. What is
 * left is the material that would otherwise have been lost.
 */

export interface NotesParseResult {
  evidence: Evidence[];
  cause?: LossCause;
  sourceCategory?: WaterCategory;
  roomDimensions: NoteRoomDimension[];
  floodCuts: NoteFloodCut[];
  materialsMentioned: MaterialType[];
  materialPlacements: NoteMaterialPlacement[];
  equipmentMentioned: NoteEquipment[];
  microbialGrowthPresent: boolean;
  containmentMentioned: boolean;
  ceilingWet: boolean;
  affectedFloorFraction?: number;
  cavityWet: boolean;
  carrierMentioned?: string;
  warnings: string[];
}

export interface NoteMaterialPlacement {
  material: MaterialType;
  roomName?: string;
  removed?: boolean;
  wetHeightIn?: number;
}

export interface NoteRoomDimension {
  name?: string;
  lengthFt: number;
  widthFt: number;
  heightFt?: number;
}

export interface NoteFloodCut {
  roomName?: string;
  heightIn: number;
}

export interface NoteEquipment {
  kind: 'air_mover' | 'dehumidifier' | 'dehumidifier_lgr' | 'air_scrubber';
  quantity: number;
}

/** "12x14", "12 x 14 x 9", "12'x14'" — with an optional ceiling height. */
const DIMENSION_RE =
  /(?:([A-Za-z][A-Za-z\s]{1,24}?)\s*[:\-—]?\s*)?(\d{1,3}(?:\.\d+)?)\s*'?\s*[xX×]\s*(\d{1,3}(?:\.\d+)?)\s*'?(?:\s*[xX×]\s*(\d{1,2}(?:\.\d+)?)\s*'?)?/g;

/** "cut 2ft", "24in cut", "flood cut 2'", "cut to 18 inches". */
const FLOOD_CUT_RE =
  /(?:flood\s*cut|cut)\s*(?:to\s*)?(\d{1,3}(?:\.\d+)?)\s*(?:"|''|in\b|inch(?:es)?|'|ft\b|feet|foot)/gi;
const FLOOD_CUT_REVERSED_RE =
  /(\d{1,3}(?:\.\d+)?)\s*(?:"|''|in\b|inch(?:es)?|'|ft\b|feet|foot)\s*(?:flood\s*)?cut/gi;

/** "6 air movers", "2 lgr", "3 dehus", "1 scrubber". */
const EQUIPMENT_RE =
  /(\d{1,3})\s*(air\s*movers?|movers?|blowers?|fans?|dehus?|dehumidifiers?|lgrs?|desiccants?|scrubbers?|negative\s*airs?|afds?)/gi;

const CATEGORY_RE = /\b(?:cat|category)\s*([123])\b/i;

// Stop at sentence punctuation so "Carrier: State Farm. Mold observed" does not
// swallow the next sentence into the carrier name.
const CARRIER_RE =
  /\b(?:carrier|insurer|insurance)\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 &'-]{2,40})/i;

export function parseNotes(input: unknown): NotesParseResult {
  const text = typeof input === 'string' ? input : Array.isArray(input) ? input.join('\n') : '';
  const warnings: string[] = [];

  if (!text.trim()) {
    return {
      evidence: [],
      roomDimensions: [],
      floodCuts: [],
      materialsMentioned: [],
      materialPlacements: [],
      equipmentMentioned: [],
      microbialGrowthPresent: false,
      containmentMentioned: false,
      ceilingWet: false,
      cavityWet: false,
      warnings,
    };
  }

  const categoryMatch = text.match(CATEGORY_RE);
  const sourceCategory = categoryMatch
    ? (Number(categoryMatch[1]) as WaterCategory)
    : undefined;

  const roomDimensions = extractDimensions(text);
  const floodCuts = extractFloodCuts(text);
  const equipmentMentioned = extractEquipment(text);
  const materialsMentioned = extractMaterials(text);
  const materialPlacements = extractMaterialPlacements(text, materialsMentioned, floodCuts);
  const affectedFloorFraction = extractAffectedFraction(text);
  const ceilingWet = /\bceiling\s+(?:wet|affected|down|removed)|wet\s+ceiling\b/i.test(text);
  const cavityWet = /\bcavity\s+wet\b|\bwet\s+cavity\b|\binsulation\s+wet\b/i.test(text);
  const carrierMatch = text.match(CARRIER_RE);
  const carrierMentioned = carrierMatch?.[1]?.trim().replace(/\s+/g, ' ');

  if (floodCuts.some((cut) => cut.heightIn > 96)) {
    warnings.push('A flood-cut height over 8 ft was read from the notes — confirm before scoping.');
  }

  const evidence: Evidence[] = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => ({
      id: `note-${index}`,
      kind: 'note' as const,
      description: chunk,
      tags: ['field_note', ...noteTags(chunk)],
    }));

  return {
    evidence,
    cause: inferCause(text),
    sourceCategory,
    roomDimensions,
    floodCuts,
    materialsMentioned,
    materialPlacements,
    equipmentMentioned,
    microbialGrowthPresent: /\bmold\b|(?<!anti)microbial|\bmildew\b|\bfungal\b|\bamplification\b/i.test(text),
    containmentMentioned: /\b(containment|poly\s*barrier|zip\s*wall|negative\s*pressure)\b/i.test(text),
    ceilingWet,
    affectedFloorFraction,
    cavityWet,
    carrierMentioned,
    warnings,
  };
}

function extractDimensions(text: string): NoteRoomDimension[] {
  const results: NoteRoomDimension[] = [];
  for (const match of text.matchAll(DIMENSION_RE)) {
    const [, rawName, l, w, h] = match;
    const lengthFt = Number.parseFloat(l);
    const widthFt = Number.parseFloat(w);
    if (!Number.isFinite(lengthFt) || !Number.isFinite(widthFt)) continue;
    if (lengthFt < 3 || widthFt < 3 || lengthFt > 200 || widthFt > 200) continue;

    const name = rawName?.trim().replace(/\s+/g, ' ');
    results.push({
      name: name && name.length > 1 ? name : undefined,
      lengthFt: round(lengthFt),
      widthFt: round(widthFt),
      heightFt: h ? round(Number.parseFloat(h)) : undefined,
    });
  }
  return results;
}

function extractFloodCuts(text: string): NoteFloodCut[] {
  const cuts: NoteFloodCut[] = [];

  const push = (raw: string, unitHint: string, roomName?: string) => {
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const inches = /'|ft|feet|foot/i.test(unitHint) ? value * 12 : value;
    cuts.push({ heightIn: round(inches), roomName });
  };

  for (const match of text.matchAll(FLOOD_CUT_RE)) push(match[1], match[0]);
  for (const match of text.matchAll(FLOOD_CUT_REVERSED_RE)) push(match[1], match[0]);

  const seen = new Set<number>();
  return cuts.filter((cut) => (seen.has(cut.heightIn) ? false : (seen.add(cut.heightIn), true)));
}

function extractEquipment(text: string): NoteEquipment[] {
  const totals = new Map<NoteEquipment['kind'], number>();
  for (const match of text.matchAll(EQUIPMENT_RE)) {
    const quantity = Number.parseInt(match[1], 10);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 200) continue;
    const word = match[2].toLowerCase();
    const kind: NoteEquipment['kind'] = /scrub|negative|afd/.test(word)
      ? 'air_scrubber'
      : /lgr/.test(word)
        ? 'dehumidifier_lgr'
        : /dehu|desiccant/.test(word)
          ? 'dehumidifier'
          : 'air_mover';
    totals.set(kind, (totals.get(kind) ?? 0) + quantity);
  }
  return [...totals].map(([kind, quantity]) => ({ kind, quantity }));
}

function extractMaterials(text: string): MaterialType[] {
  const found = new Set<MaterialType>();
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    const material = normalizeMaterial(word);
    if (material) found.add(material);
  }
  for (const phrase of ['carpet pad', 'sheet vinyl', 'vinyl plank', 'engineered wood']) {
    if (text.toLowerCase().includes(phrase)) {
      const material = normalizeMaterial(phrase);
      if (material) found.add(material);
    }
  }
  return [...found];
}

function extractMaterialPlacements(
  text: string,
  materials: MaterialType[],
  floodCuts: NoteFloodCut[],
): NoteMaterialPlacement[] {
  const removed = /\b(out|removed|tear\s*out|demo(?:lished)?|bagged)\b/i.test(text);
  const cutHeight = floodCuts[0]?.heightIn;
  return materials.map((material) => ({
    material,
    removed:
      removed ||
      (material === 'drywall' && floodCuts.length > 0) ||
      (material === 'carpet_pad' && removed) ||
      undefined,
    wetHeightIn: material === 'drywall' || material === 'plaster' ? cutHeight : undefined,
  }));
}

function extractAffectedFraction(text: string): number | undefined {
  const pct = text.match(/(\d{1,3})\s*%\s*(?:wet|affected)/i);
  if (pct) {
    const value = Number.parseInt(pct[1], 10);
    if (value > 0 && value <= 100) return round(value / 100, 2);
  }
  if (/\b(entire|whole)\s+(?:room|floor)\s+wet\b/i.test(text)) return 1;
  if (/\bhalf\s+(?:the\s+)?(?:room|floor)\b/i.test(text)) return 0.5;
  return undefined;
}

function noteTags(chunk: string): string[] {
  const tags: string[] = [];
  if (/flood\s*cut|cut/i.test(chunk)) tags.push('flood_cut');
  if (/\bmold\b|(?<!anti)microbial|mildew/i.test(chunk)) tags.push('microbial');
  if (/containment|poly/i.test(chunk)) tags.push('containment');
  if (/cat\s*3|category\s*3|sewage/i.test(chunk)) tags.push('category_3');
  if (/extract/i.test(chunk)) tags.push('extraction');
  if (/antimicrobial|biocide/i.test(chunk)) tags.push('antimicrobial');
  if (/ceiling/i.test(chunk)) tags.push('ceiling');
  if (/carpet\s*pad|padding/i.test(chunk)) tags.push('carpet_pad');
  else if (/carpet/i.test(chunk)) tags.push('carpet');
  if (/drywall|sheetrock/i.test(chunk)) tags.push('drywall');
  if (/baseboard/i.test(chunk)) tags.push('baseboard');
  if (/air\s*mover|blower/i.test(chunk)) tags.push('air_mover');
  if (/dehu|lgr/i.test(chunk)) tags.push('dehumidifier');
  if (/before/i.test(chunk)) tags.push('before');
  if (/after|complete/i.test(chunk)) tags.push('after');
  return tags;
}
