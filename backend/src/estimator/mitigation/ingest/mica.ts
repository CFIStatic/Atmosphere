import { round } from '../lib/geometry.js';
import { withDerivedGpp } from '../lib/psychrometrics.js';
import { normalizeMaterial } from './docusketch.js';
import type {
  EquipmentKind,
  EquipmentPlacement,
  Evidence,
  LossCause,
  MoistureReading,
  PsychrometricReading,
  WaterCategory,
} from '../types.js';

/**
 * MICA ingestion.
 *
 * A MICA report is the drying record: moisture readings against dry standards,
 * psychrometric logs, the equipment that was placed and when it came out, and
 * the daily monitoring visits. It is the *documentation* half of the estimate —
 * DocuSketch says how big the room is, MICA says what happened in it.
 *
 * Two things here drive real money. Equipment days come straight from the
 * placement/removal timestamps, so a unit logged out a day late is a day that
 * gets billed and survives review. And monitoring visits are billable labour
 * that crews routinely perform and estimators routinely forget, so every logged
 * visit is preserved rather than collapsed into a count.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface MicaParseResult {
  claimNumber?: string;
  carrier?: string;
  insuredName?: string;
  propertyAddress?: string;
  dateOfLoss?: string;
  dateOfArrival?: string;
  cause?: LossCause;
  sourceCategory?: WaterCategory;

  moistureReadings: MoistureReading[];
  psychrometrics: PsychrometricReading[];
  equipment: EquipmentPlacement[];
  evidence: Evidence[];
  /** Room-level hints keyed by room name, merged onto DocuSketch geometry. */
  roomHints: MicaRoomHint[];

  dryingDays: number;
  monitoringVisits: number;
  microbialGrowthPresent: boolean;
  warnings: string[];
}

export interface MicaRoomHint {
  name: string;
  ceilingAffected?: boolean;
  affectedFloorFraction?: number;
  notes?: string;
}

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

function iso(value: any): string | undefined {
  const raw = value instanceof Date ? value.toISOString() : str(value);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

// Ordered most-specific first. A named appliance outranks "supply line": nearly
// every appliance failure is a supply-line failure, and the appliance is both
// the more informative answer and the one that classifies the water correctly
// (Category 2 rather than 1).
const CAUSE_PATTERNS: Array<[RegExp, LossCause]> = [
  [/sewage|sewer|black\s*water|septic/i, 'sewage_backup'],
  [/toilet/i, 'toilet_overflow'],
  [/water\s*heater/i, 'water_heater'],
  [/dishwasher|washing\s*machine|refrigerator|appliance|ice\s*maker/i, 'appliance'],
  [/supply\s*line|pex|copper\s*line|burst\s*pipe|pipe\s*break/i, 'supply_line'],
  [/roof|ceiling\s*leak/i, 'roof_leak'],
  [/storm|flood|ground\s*water|hurricane/i, 'storm_flood'],
  [/sprinkler|fire\s*suppression/i, 'sprinkler'],
  [/hvac|condensate|a\/?c\s*line/i, 'hvac_condensate'],
];

/** Infer the loss cause from whatever free text the report carries. */
export function inferCause(text: string | undefined): LossCause | undefined {
  if (!text) return undefined;
  for (const [pattern, cause] of CAUSE_PATTERNS) {
    if (pattern.test(text)) return cause;
  }
  return undefined;
}

/** Causes whose water is contaminated at the source, before any time passes. */
const CAUSE_CATEGORY: Partial<Record<LossCause, WaterCategory>> = {
  supply_line: 1,
  water_heater: 1,
  sprinkler: 1,
  roof_leak: 1,
  hvac_condensate: 2,
  appliance: 2,
  toilet_overflow: 2,
  storm_flood: 3,
  sewage_backup: 3,
};

export function categoryForCause(cause: LossCause): WaterCategory {
  return CAUSE_CATEGORY[cause] ?? 2;
}

const EQUIPMENT_ALIASES: Array<[RegExp, EquipmentKind]> = [
  [/axial/i, 'axial_air_mover'],
  [/air\s*mover|blower|centrifugal|fan(?!.*negative)/i, 'air_mover'],
  [/desiccant/i, 'dehumidifier_desiccant'],
  [/lgr|low\s*grain/i, 'dehumidifier_lgr'],
  [/dehu|dehumidifier/i, 'dehumidifier_conventional'],
  [/scrubber|negative\s*air|afd|air\s*filtration/i, 'air_scrubber'],
  [/heater|heat\s*drying/i, 'heater'],
  [/injectidry|inject-?a-?dry|wall\s*cavity\s*dry/i, 'injectidry'],
];

export function normalizeEquipment(raw: unknown): EquipmentKind | undefined {
  const text = String(raw ?? '');
  if (!text.trim()) return undefined;
  for (const [pattern, kind] of EQUIPMENT_ALIASES) {
    if (pattern.test(text)) return kind;
  }
  return undefined;
}

/**
 * Billable days for a placement.
 *
 * Equipment is billed per 24-hour period and a partial day is a billed day —
 * a unit pulled at 9am on day four was on site for four periods, not three. The
 * ceiling here is deliberate, and it is worth real money across a fleet.
 */
export function equipmentDays(placedAt?: string, removedAt?: string, fallbackDays = 1): number {
  const start = placedAt ? Date.parse(placedAt) : NaN;
  const end = removedAt ? Date.parse(removedAt) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return Math.max(1, fallbackDays);
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

export function parseMica(payload: unknown): MicaParseResult {
  const warnings: string[] = [];
  const root: any = payload ?? {};
  const job = pick(root, 'job', 'jobInfo', 'claim', 'project') ?? root;

  const causeText = [
    str(pick(job, 'cause', 'causeOfLoss', 'lossCause', 'source')),
    str(pick(job, 'description', 'lossDescription', 'notes')),
  ]
    .filter(Boolean)
    .join(' ');

  const cause = inferCause(causeText);

  const moistureReadings = parseMoisture(root, warnings);
  const psychrometrics = parsePsychrometrics(root);
  const equipment = parseEquipment(root, warnings);
  const { dryingDays, monitoringVisits, evidence: visitEvidence } = parseMonitoring(root, equipment);

  const microbialGrowthPresent = detectMicrobial(root, causeText);

  const evidence: Evidence[] = [
    ...visitEvidence,
    ...moistureReadings.map<Evidence>((reading, index) => ({
      id: `mica-moisture-${index}`,
      kind: 'moisture_reading',
      roomId: reading.roomId,
      capturedAt: reading.takenAt,
      description: `${reading.material} at ${reading.value} against a dry standard of ${reading.dryStandard}${reading.location ? ` (${reading.location})` : ''}.`,
      tags: ['mica', 'moisture', reading.material],
    })),
    ...psychrometrics.map<Evidence>((reading, index) => ({
      id: `mica-psychro-${index}`,
      kind: 'psychrometric',
      capturedAt: reading.takenAt,
      description: `${reading.zone}: ${reading.temperatureF}°F / ${reading.relativeHumidity}% RH / ${reading.gpp} GPP.`,
      tags: ['mica', 'psychrometric', reading.zone],
    })),
  ];

  const sourceCategory =
    (num(pick(job, 'category', 'waterCategory', 'cat')) as WaterCategory | undefined) ??
    (cause ? categoryForCause(cause) : undefined);

  return {
    claimNumber: str(pick(job, 'claimNumber', 'claim_number', 'claimNo')),
    carrier: str(pick(job, 'carrier', 'insuranceCarrier', 'insurer')),
    insuredName: str(pick(job, 'insured', 'insuredName', 'customerName', 'customer')),
    propertyAddress: str(pick(job, 'address', 'propertyAddress', 'lossAddress')),
    dateOfLoss: iso(pick(job, 'dateOfLoss', 'lossDate', 'date_of_loss')),
    dateOfArrival: iso(pick(job, 'dateOfArrival', 'arrivalDate', 'firstResponse', 'startDate')),
    cause,
    sourceCategory: sourceCategory && sourceCategory >= 1 && sourceCategory <= 3 ? sourceCategory : undefined,

    moistureReadings,
    psychrometrics,
    equipment,
    evidence,
    roomHints: parseRoomHints(root),

    dryingDays,
    monitoringVisits,
    microbialGrowthPresent,
    warnings,
  };
}

function parseMoisture(root: any, warnings: string[]): MoistureReading[] {
  const list =
    pick(root, 'moistureReadings', 'readings', 'moisture', 'moisture_readings') ??
    pick(pick(root, 'data') ?? {}, 'moistureReadings', 'readings');
  if (!Array.isArray(list)) return [];

  const readings: MoistureReading[] = [];
  for (const entry of list) {
    const material = normalizeMaterial(pick(entry, 'material', 'materialType', 'surface', 'type'));
    const value = num(pick(entry, 'value', 'reading', 'moisture', 'mc', 'percent'));
    if (!material || value === undefined) {
      warnings.push('A MICA moisture reading was missing its material or value and was skipped.');
      continue;
    }
    readings.push({
      roomId: str(pick(entry, 'roomId', 'room_id', 'room', 'area')) ?? 'unassigned',
      material,
      value,
      // 16% is the conventional dry standard for framing lumber when the report
      // omits the unaffected-area benchmark.
      dryStandard: num(pick(entry, 'dryStandard', 'dry_standard', 'goal', 'target')) ?? 16,
      takenAt: iso(pick(entry, 'takenAt', 'timestamp', 'date', 'recordedAt')) ?? new Date(0).toISOString(),
      location: str(pick(entry, 'location', 'position', 'note')),
    });
  }
  return readings;
}

function parsePsychrometrics(root: any): PsychrometricReading[] {
  const list =
    pick(root, 'psychrometrics', 'atmospheric', 'psychrometricReadings', 'atmosphericReadings') ??
    pick(pick(root, 'data') ?? {}, 'psychrometrics');
  if (!Array.isArray(list)) return [];

  const zoneOf = (value: unknown): PsychrometricReading['zone'] => {
    const text = String(value ?? '').toLowerCase();
    if (text.includes('outside') || text.includes('exterior') || text.includes('ambient')) return 'outside';
    if (text.includes('dehu') || text.includes('outlet') || text.includes('discharge')) return 'dehu_outlet';
    if (text.includes('unaffected') || text.includes('control')) return 'unaffected';
    return 'affected';
  };

  return list
    .map((entry: any) => {
      const temperatureF = num(pick(entry, 'temperature', 'temp', 'temperatureF', 'tempF'));
      const relativeHumidity = num(pick(entry, 'rh', 'relativeHumidity', 'humidity'));
      if (temperatureF === undefined || relativeHumidity === undefined) return null;
      return withDerivedGpp({
        takenAt: iso(pick(entry, 'takenAt', 'timestamp', 'date')) ?? new Date(0).toISOString(),
        zone: zoneOf(pick(entry, 'zone', 'location', 'area', 'type')),
        temperatureF,
        relativeHumidity,
        gpp: num(pick(entry, 'gpp', 'grains', 'grainsPerPound')),
      });
    })
    .filter((r): r is PsychrometricReading => r !== null);
}

function parseEquipment(root: any, warnings: string[]): EquipmentPlacement[] {
  const list =
    pick(root, 'equipment', 'equipmentLog', 'equipment_log', 'dryingEquipment') ??
    pick(pick(root, 'data') ?? {}, 'equipment');
  if (!Array.isArray(list)) return [];

  const placements: EquipmentPlacement[] = [];
  for (const entry of list) {
    const kind = normalizeEquipment(pick(entry, 'type', 'kind', 'equipment', 'name', 'model'));
    if (!kind) {
      warnings.push(
        `Unrecognised equipment "${String(pick(entry, 'type', 'name') ?? '')}" in the MICA log — not billed.`,
      );
      continue;
    }
    const placedAt = iso(pick(entry, 'placedAt', 'startDate', 'placed', 'setDate', 'start'));
    const removedAt = iso(pick(entry, 'removedAt', 'endDate', 'removed', 'pickupDate', 'end'));
    const declaredDays = num(pick(entry, 'days', 'daysOnSite', 'billableDays'));

    placements.push({
      kind,
      quantity: Math.max(1, Math.round(num(pick(entry, 'quantity', 'count', 'qty')) ?? 1)),
      roomId: str(pick(entry, 'roomId', 'room_id', 'room', 'area')),
      placedAt: placedAt ?? new Date(0).toISOString(),
      removedAt,
      days: equipmentDays(placedAt, removedAt, declaredDays ?? 1),
    });
  }
  return placements;
}

/**
 * Drying days and monitoring visits.
 *
 * Prefer the logged visits — they are the billable record. When the log is
 * absent, fall back to the longest equipment run, since drying cannot have been
 * shorter than the equipment was on site.
 */
function parseMonitoring(
  root: any,
  equipment: EquipmentPlacement[],
): { dryingDays: number; monitoringVisits: number; evidence: Evidence[] } {
  const list =
    pick(root, 'monitoring', 'visits', 'dailyLogs', 'monitoringVisits', 'daily_logs') ?? [];
  const visits = Array.isArray(list) ? list : [];

  const evidence: Evidence[] = visits.map((visit: any, index: number) => ({
    id: `mica-visit-${index}`,
    kind: 'note',
    capturedAt: iso(pick(visit, 'date', 'visitDate', 'timestamp')),
    description:
      str(pick(visit, 'notes', 'summary', 'description')) ?? `Monitoring visit ${index + 1}.`,
    tags: ['mica', 'monitoring', 'visit'],
  }));

  const longestRun = equipment.reduce((max, item) => Math.max(max, item.days ?? 1), 0);
  const declaredDays = num(pick(root, 'dryingDays', 'drying_days', 'totalDays'));

  const dryingDays = Math.max(declaredDays ?? 0, visits.length, longestRun, 0);

  return {
    dryingDays: dryingDays > 0 ? dryingDays : 0,
    monitoringVisits: visits.length > 0 ? visits.length : dryingDays,
    evidence,
  };
}

function parseRoomHints(root: any): MicaRoomHint[] {
  const list = pick(root, 'rooms', 'areas', 'affectedAreas', 'affected_areas');
  if (!Array.isArray(list)) return [];
  return list
    .map((entry: any): MicaRoomHint | null => {
      const name = str(pick(entry, 'name', 'room', 'roomName', 'area'));
      if (!name) return null;
      const fraction = num(pick(entry, 'affectedPercent', 'affectedFraction', 'wetPercent'));
      return {
        name,
        ceilingAffected: Boolean(pick(entry, 'ceilingAffected', 'ceilingWet') ?? false),
        affectedFloorFraction:
          fraction === undefined ? undefined : round(fraction > 1 ? fraction / 100 : fraction, 3),
        notes: str(pick(entry, 'notes', 'description')),
      };
    })
    .filter((hint): hint is MicaRoomHint => hint !== null);
}

/**
 * Microbial growth is a scope-changing finding: it pulls in containment,
 * negative air and antimicrobial application. Presume it when the report says
 * so, and never infer it away.
 */
function detectMicrobial(root: any, causeText: string): boolean {
  const flag = pick(root, 'microbialGrowth', 'mold', 'moldPresent', 'microbial');
  if (typeof flag === 'boolean') return flag;
  const haystack = `${causeText} ${JSON.stringify(pick(root, 'observations', 'findings') ?? '')}`;
  // `(?<!anti)` keeps "antimicrobial applied" — a note about treatment — from
  // being read as a report of microbial growth.
  return /\bmold\b|(?<!anti)microbial|fungal|mildew|amplification/i.test(haystack);
}
