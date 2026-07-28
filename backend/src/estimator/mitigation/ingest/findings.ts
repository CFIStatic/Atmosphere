import type {
  Evidence,
  LossCause,
  MaterialType,
  WaterCategory,
} from '../types.js';
import { normalizeMaterial } from './docusketch.js';
import { tagsFromCaption } from './photos.js';

/**
 * Damage findings — what is wrong with the property.
 *
 * Distinct from scope (what we will bill) and from requirements (what rules
 * oblige us to do). Findings are the observational layer: wet carpet in the
 * kitchen, a flood cut on the north wall, microbial growth behind the vanity.
 * They are built from photo captions and field notes so a job without a scan
 * or a MICA log still has a defensible description of the loss.
 */

export type FindingKind =
  | 'water_intrusion'
  | 'contaminated_water'
  | 'wet_material'
  | 'demolition_performed'
  | 'microbial_growth'
  | 'equipment_placed'
  | 'containment_built'
  | 'source_identified'
  | 'structural_concern';

export type FindingConfidence = 'stated' | 'inferred' | 'undetermined';

export interface DamageFinding {
  id: string;
  kind: FindingKind;
  /** Plain-English finding for the adjuster / estimator. */
  summary: string;
  roomName?: string;
  material?: MaterialType;
  /** Supporting evidence ids (photos, notes). */
  evidenceIds: string[];
  confidence: FindingConfidence;
  /** Tags that feed fusion / scope / requirements. */
  tags: string[];
}

export interface FindingsBundle {
  findings: DamageFinding[];
  /** Materials observed wet / removed, with optional room. */
  materials: Array<{
    material: MaterialType;
    roomName?: string;
    wetHeightIn?: number;
    cavityWet?: boolean;
    removed?: boolean;
    evidenceIds: string[];
  }>;
  /** Rooms named in captions/notes that may not yet have geometry. */
  namedRooms: string[];
  warnings: string[];
}

/**
 * Build findings from photo evidence + note evidence already tagged by ingest.
 * Does not invent geometry — only what captions and notes explicitly support.
 */
export function deriveFindings(input: {
  photoEvidence: Evidence[];
  noteEvidence: Evidence[];
  cause?: LossCause;
  sourceCategory?: WaterCategory;
  microbialGrowthPresent?: boolean;
  notesText?: string;
}): FindingsBundle {
  const findings: DamageFinding[] = [];
  const materials: FindingsBundle['materials'] = [];
  const namedRooms = new Set<string>();
  const warnings: string[] = [];
  let seq = 0;
  const nextId = () => `finding-${(seq += 1)}`;

  const allEvidence = [...input.photoEvidence, ...input.noteEvidence];

  if (input.cause && input.cause !== 'unknown') {
    findings.push({
      id: nextId(),
      kind: 'source_identified',
      summary: `Loss source identified as ${input.cause.replace(/_/g, ' ')}.`,
      evidenceIds: allEvidence.filter((e) => e.tags.includes('source') || e.kind === 'note').map((e) => e.id),
      confidence: 'stated',
      tags: ['source', input.cause],
    });
  }

  if (input.sourceCategory) {
    findings.push({
      id: nextId(),
      kind: 'contaminated_water',
      summary: `Water documented as Category ${input.sourceCategory}.`,
      evidenceIds: allEvidence
        .filter((e) => e.tags.includes(`category_${input.sourceCategory}`) || e.tags.includes('category_3') || e.tags.includes('category_2'))
        .map((e) => e.id),
      confidence: 'stated',
      tags: [`category_${input.sourceCategory}`],
    });
  }

  if (input.microbialGrowthPresent) {
    findings.push({
      id: nextId(),
      kind: 'microbial_growth',
      summary: 'Microbial growth observed or indicated in documentation.',
      evidenceIds: allEvidence.filter((e) => e.tags.includes('microbial')).map((e) => e.id),
      confidence: 'stated',
      tags: ['microbial'],
    });
  }

  for (const item of allEvidence) {
    const roomName = roomNameFromEvidence(item);
    if (roomName) namedRooms.add(roomName);

    const materialTags = MATERIAL_TAG_TO_TYPE.filter(([tag]) => item.tags.includes(tag));
    for (const [tag, material] of materialTags) {
      const removed =
        item.tags.includes('flood_cut') ||
        /\b(out|removed|tear\s*out|demo)\b/i.test(item.description);
      const wetHeightIn = heightFromText(item.description);
      const cavityWet = /\bcavity\b/i.test(item.description) || item.tags.includes('insulation');

      materials.push({
        material,
        roomName,
        wetHeightIn,
        cavityWet: cavityWet || undefined,
        removed: removed || undefined,
        evidenceIds: [item.id],
      });

      findings.push({
        id: nextId(),
        kind: removed ? 'demolition_performed' : 'wet_material',
        summary: removed
          ? `${label(material)} removed${roomName ? ` in ${roomName}` : ''}${wetHeightIn ? ` (cut ~${wetHeightIn}")` : ''}.`
          : `Wet ${label(material)} documented${roomName ? ` in ${roomName}` : ''}.`,
        roomName,
        material,
        evidenceIds: [item.id],
        confidence: item.kind === 'photo' || item.kind === 'note' ? 'stated' : 'inferred',
        tags: [tag, ...(removed ? ['tear_out'] : ['wet'])],
      });
    }

    if (item.tags.includes('flood_cut') && materialTags.length === 0) {
      findings.push({
        id: nextId(),
        kind: 'demolition_performed',
        summary: `Flood cut documented${roomName ? ` in ${roomName}` : ''}${heightFromText(item.description) ? ` at ~${heightFromText(item.description)}"` : ''}.`,
        roomName,
        material: 'drywall',
        evidenceIds: [item.id],
        confidence: 'stated',
        tags: ['flood_cut', 'drywall'],
      });
      materials.push({
        material: 'drywall',
        roomName,
        wetHeightIn: heightFromText(item.description),
        cavityWet: true,
        removed: true,
        evidenceIds: [item.id],
      });
    }

    if (item.tags.includes('containment')) {
      findings.push({
        id: nextId(),
        kind: 'containment_built',
        summary: `Containment documented${roomName ? ` at ${roomName}` : ''}.`,
        roomName,
        evidenceIds: [item.id],
        confidence: 'stated',
        tags: ['containment'],
      });
    }

    for (const eq of ['air_mover', 'dehumidifier', 'air_scrubber'] as const) {
      if (item.tags.includes(eq)) {
        findings.push({
          id: nextId(),
          kind: 'equipment_placed',
          summary: `${eq.replace(/_/g, ' ')} documented on site${roomName ? ` (${roomName})` : ''}.`,
          roomName,
          evidenceIds: [item.id],
          confidence: 'stated',
          tags: ['equipment', eq],
        });
      }
    }

    if (item.tags.includes('ceiling')) {
      findings.push({
        id: nextId(),
        kind: 'wet_material',
        summary: `Ceiling affected${roomName ? ` in ${roomName}` : ''}.`,
        roomName,
        material: 'ceiling_drywall',
        evidenceIds: [item.id],
        confidence: 'stated',
        tags: ['ceiling'],
      });
      materials.push({
        material: 'ceiling_drywall',
        roomName,
        removed: /\b(out|removed|tear\s*out)\b/i.test(item.description),
        evidenceIds: [item.id],
      });
    }
  }

  // Caption-only materials that normalizeMaterial can see beyond tags.
  if (input.notesText) {
    for (const word of input.notesText.toLowerCase().split(/[^a-z0-9]+/)) {
      const material = normalizeMaterial(word);
      if (material && !materials.some((m) => m.material === material && !m.roomName)) {
        // Already covered by extractMaterials in notes; skip duplicates.
      }
    }
  }

  // De-dupe materials by material+room.
  const dedupedMaterials = dedupeMaterials(materials);

  if (findings.length === 0 && allEvidence.length > 0) {
    warnings.push(
      'Photos and notes were supplied but no specific damage findings could be read from captions. Caption materials (e.g. "flood cut 24in — kitchen north wall") are what let the estimator identify what is wrong.',
    );
  }

  return {
    findings,
    materials: dedupedMaterials,
    namedRooms: [...namedRooms],
    warnings,
  };
}

/** Also used by photos ingest to attach structured tags from free text. */
export function heightFromText(text: string): number | undefined {
  const match =
    text.match(/(\d{1,3})\s*(?:"|''|in\b|inch)/i) ||
    text.match(/(\d{1,2})\s*(?:ft|feet|foot|')\b/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return /ft|feet|foot|'/i.test(match[0]) && !/in|inch|"/i.test(match[0]) ? value * 12 : value;
}

const MATERIAL_TAG_TO_TYPE: Array<[string, MaterialType]> = [
  ['carpet_pad', 'carpet_pad'],
  ['carpet', 'carpet'],
  ['baseboard', 'baseboard'],
  ['insulation', 'insulation'],
  ['drywall', 'drywall'],
  ['cabinetry', 'cabinetry'],
  ['hardwood', 'hardwood'],
  ['tile', 'tile'],
  ['subfloor', 'subfloor_wood'],
];

function roomNameFromEvidence(item: Evidence): string | undefined {
  if (item.roomId && !item.roomId.startsWith('photo-') && !item.roomId.startsWith('note-')) {
    // roomId may already be a real id; prefer description/room tags.
  }
  // Prefer an explicit room name tag that is not a scope tag.
  const SCOPE_TAGS = new Set([
    'photo',
    'field_note',
    'geotagged',
    'before',
    'after',
    'flood_cut',
    'carpet',
    'carpet_pad',
    'drywall',
    'baseboard',
    'insulation',
    'ceiling',
    'cabinetry',
    'hardwood',
    'tile',
    'subfloor',
    'microbial',
    'category_2',
    'category_3',
    'containment',
    'air_mover',
    'dehumidifier',
    'air_scrubber',
    'moisture_reading',
    'contents',
    'antimicrobial',
    'hepa',
    'extraction',
    'source',
  ]);
  const roomTag = item.tags.find((tag) => !SCOPE_TAGS.has(tag) && tag.length > 2);
  if (roomTag) return roomTag.replace(/_/g, ' ');

  // "— kitchen" / "in the master bath" patterns in captions.
  const named = item.description.match(
    /(?:—|-)\s*([A-Za-z][A-Za-z\s]{1,30})$|(?:\bin(?:\s+the)?\s+)([A-Za-z][A-Za-z\s]{1,30})(?:\b|$)/i,
  );
  if (named) return (named[1] ?? named[2]).trim();
  return undefined;
}

function dedupeMaterials(materials: FindingsBundle['materials']): FindingsBundle['materials'] {
  const map = new Map<string, FindingsBundle['materials'][number]>();
  for (const row of materials) {
    const key = `${row.material}::${(row.roomName ?? '').toLowerCase()}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
      continue;
    }
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...row.evidenceIds])];
    existing.wetHeightIn = existing.wetHeightIn ?? row.wetHeightIn;
    existing.cavityWet = existing.cavityWet || row.cavityWet;
    existing.removed = existing.removed || row.removed;
  }
  return [...map.values()];
}

function label(material: MaterialType): string {
  return material.replace(/_/g, ' ');
}

/** Re-export for callers that already have captions. */
export { tagsFromCaption };
