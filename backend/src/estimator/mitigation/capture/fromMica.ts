import { createHash } from 'node:crypto';
import { parseMica } from '../ingest/mica.js';
import type { DryingReport } from '../planning/dryingProgress.js';
import type {
  EquipmentPlacement,
  Evidence,
  MoistureReading,
  PsychrometricReading,
} from '../types.js';
import { withDerivedGpp } from '../lib/psychrometrics.js';

/**
 * Turn a MICA / MICA Dash export into a visit timeline the estimator can merge.
 *
 * A full MICA file is not one moment — it is every monitoring visit, every
 * reading, and the equipment log across the dry-out. Splitting it into
 * DryingReport rows lets later Dash pulls *update* the estimate instead of
 * replacing the whole assessment blindly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

function pick(source: any, ...keys: string[]): any {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function str(value: any): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function iso(value: any, fallback?: string): string {
  const raw = value instanceof Date ? value.toISOString() : str(value);
  if (!raw) return fallback ?? new Date().toISOString();
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? (fallback ?? new Date().toISOString()) : new Date(parsed).toISOString();
}

function contentId(prefix: string, parts: unknown[]): string {
  const hash = createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

/**
 * Build drying reports from a MICA Dash (or file) export.
 *
 * Strategy:
 * 1. One report per `monitoring` / daily-log visit, attaching readings and
 *    psychrometrics taken on that calendar day.
 * 2. Equipment snapshot on the latest visit (or a synthetic setup report).
 * 3. Dry/wet room inference from moisture readings vs dry standard that day.
 */
export function dryingReportsFromMicaExport(
  payload: unknown,
  options: { claimNumber?: string } = {},
): DryingReport[] {
  const parsed = parseMica(payload);
  const root: any = payload ?? {};
  const claim =
    options.claimNumber ??
    parsed.claimNumber ??
    str(pick(pick(root, 'job') ?? {}, 'claimNumber', 'claim_number')) ??
    'unknown';

  const visitsRaw =
    pick(root, 'monitoring', 'visits', 'dailyLogs', 'monitoringVisits', 'daily_logs') ?? [];
  const visits = Array.isArray(visitsRaw) ? visitsRaw : [];

  if (visits.length === 0) {
    // No visit log — emit a single snapshot so a Dash pull still updates the job.
    const takenAt =
      parsed.dateOfArrival ??
      parsed.moistureReadings[0]?.takenAt ??
      parsed.psychrometrics[0]?.takenAt ??
      new Date().toISOString();
    const dryWet = classifyRooms(parsed.moistureReadings);
    return [
      {
        id: contentId('mica', [claim, takenAt, 'snapshot']),
        takenAt,
        source: 'mica',
        notes: 'MICA Dash export — full drying snapshot (no visit log).',
        moistureReadings: parsed.moistureReadings,
        psychrometrics: parsed.psychrometrics,
        equipment: parsed.equipment,
        roomsAtDryStandard: dryWet.dry,
        roomsStillWet: dryWet.wet,
        evidence: parsed.evidence.slice(0, 20),
        raw: { kind: 'mica_snapshot', claim },
      },
    ];
  }

  const reports: DryingReport[] = [];

  for (let index = 0; index < visits.length; index++) {
    const visit = visits[index];
    const takenAt = iso(pick(visit, 'date', 'visitDate', 'timestamp', 'takenAt'));
    const dayKey = takenAt.slice(0, 10);
    const notes = str(pick(visit, 'notes', 'summary', 'description'));

    const moisture = parsed.moistureReadings.filter((r) => r.takenAt.slice(0, 10) === dayKey);
    const psychro = parsed.psychrometrics.filter((r) => r.takenAt.slice(0, 10) === dayKey);
    const dryWet = classifyRooms(moisture.length ? moisture : readingsAsOf(parsed.moistureReadings, takenAt));

    // Equipment on the last visit is the live snapshot; earlier visits keep
    // placements that had been set by then.
    const equipment =
      index === visits.length - 1
        ? parsed.equipment
        : equipmentAsOf(parsed.equipment, takenAt);

    const evidence: Evidence[] = [
      {
        id: contentId('mica-ev', [claim, takenAt, notes ?? index]),
        kind: 'note',
        capturedAt: takenAt,
        description: notes ?? `MICA monitoring visit ${index + 1}`,
        tags: ['mica', 'monitoring', 'capture'],
      },
    ];

    reports.push({
      id: contentId('mica', [claim, takenAt, notes ?? index]),
      takenAt,
      source: 'mica',
      notes,
      moistureReadings: moisture.length ? moisture : undefined,
      psychrometrics: psychro.length ? psychro.map((p) => withDerivedGpp(p)) : undefined,
      equipment: equipment.length ? equipment : undefined,
      roomsAtDryStandard: dryWet.dry,
      roomsStillWet: dryWet.wet,
      evidence,
      raw: { kind: 'mica_visit', claim, index },
    });
  }

  return reports.sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
}

function readingsAsOf(readings: MoistureReading[], asOf: string): MoistureReading[] {
  const cutoff = Date.parse(asOf);
  const latestByKey = new Map<string, MoistureReading>();
  for (const reading of readings) {
    if (Date.parse(reading.takenAt) > cutoff) continue;
    const key = `${reading.roomId}|${reading.material}|${reading.location ?? ''}`;
    const prior = latestByKey.get(key);
    if (!prior || Date.parse(reading.takenAt) >= Date.parse(prior.takenAt)) {
      latestByKey.set(key, reading);
    }
  }
  return [...latestByKey.values()];
}

function equipmentAsOf(equipment: EquipmentPlacement[], asOf: string): EquipmentPlacement[] {
  const cutoff = Date.parse(asOf);
  return equipment.filter((item) => {
    const placed = Date.parse(item.placedAt);
    if (Number.isNaN(placed) || placed > cutoff) return false;
    if (!item.removedAt) return true;
    const removed = Date.parse(item.removedAt);
    return Number.isNaN(removed) || removed >= cutoff;
  });
}

function classifyRooms(readings: MoistureReading[]): { dry: string[]; wet: string[] } {
  const wet = new Set<string>();
  const dry = new Set<string>();
  const byRoom = new Map<string, MoistureReading[]>();
  for (const reading of readings) {
    const list = byRoom.get(reading.roomId) ?? [];
    list.push(reading);
    byRoom.set(reading.roomId, list);
  }
  for (const [roomId, roomReadings] of byRoom) {
    const stillWet = roomReadings.some((r) => r.value > r.dryStandard);
    if (stillWet) wet.add(prettyRoom(roomId));
    else dry.add(prettyRoom(roomId));
  }
  return { dry: [...dry], wet: [...wet] };
}

function prettyRoom(id: string): string {
  if (!id) return id;
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Re-export psychro helper typing for callers that stitch reports. */
export type { PsychrometricReading };
