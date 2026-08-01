import type {
  EquipmentPlacement,
  Evidence,
  MoistureReading,
  PsychrometricReading,
} from '../types.js';
import { gppDifferential, withDerivedGpp } from '../lib/psychrometrics.js';

/**
 * Drying reports — the job's progress over time.
 *
 * A mitigation job is not a single snapshot. Day 1 may document extraction and
 * a flood cut; day 3 adds moisture readings and shows two rooms at dry standard;
 * day 5 pulls equipment. Each visit is a DryingReport. The estimator merges the
 * timeline into the live assessment so equipment days, monitoring visits, and
 * dry-standard progress stay current.
 */

export type DryingReportSource = 'mica' | 'manual' | 'notes' | 'photos' | 'outlook';

export interface DryingReport {
  id: string;
  /** ISO timestamp of the visit / export. */
  takenAt: string;
  source: DryingReportSource;
  /** Free-text visit notes from the technician. */
  notes?: string;
  moistureReadings?: MoistureReading[];
  psychrometrics?: PsychrometricReading[];
  /** Equipment on site as of this visit (full snapshot preferred). */
  equipment?: EquipmentPlacement[];
  /** Rooms that met dry standard on this visit. */
  roomsAtDryStandard?: string[];
  /** Rooms still above dry standard. */
  roomsStillWet?: string[];
  /** Evidence captured this visit. */
  evidence?: Evidence[];
  /** Original vendor payload when imported. */
  raw?: unknown;
}

export interface DryingProgress {
  reports: DryingReport[];
  latestAt?: string;
  visitCount: number;
  moistureReadingCount: number;
  psychrometricCount: number;
  roomsAtDryStandard: string[];
  roomsStillWet: string[];
  /** Latest GPP differential (affected − unaffected), when both exist. */
  gppDifferential: number | null;
  /** True when every named wet room has been marked dry. */
  dryingComplete: boolean;
  /** Suggested remaining equipment days from last wet visit. */
  suggestedRemainingDays: number;
  timeline: Array<{
    takenAt: string;
    source: DryingReportSource;
    summary: string;
  }>;
}

export interface MergedDryingState {
  moistureReadings: MoistureReading[];
  psychrometrics: PsychrometricReading[];
  equipment: EquipmentPlacement[];
  evidence: Evidence[];
  dryingDays: number;
  monitoringVisits: number;
  progress: DryingProgress;
  warnings: string[];
}

/**
 * Merge a chronological series of drying reports into live assessment fields.
 *
 * Rules:
 * - Moisture / psychro: accumulate (all visits retained for the record)
 * - Equipment: latest report that carries an equipment snapshot wins; otherwise
 *   union with max days
 * - dryingDays / monitoringVisits: max(span of reports, readings days, explicit)
 */
export function mergeDryingReports(
  reports: DryingReport[],
  fallback: {
    moistureReadings?: MoistureReading[];
    psychrometrics?: PsychrometricReading[];
    equipment?: EquipmentPlacement[];
    evidence?: Evidence[];
    dryingDays?: number;
    monitoringVisits?: number;
  } = {},
): MergedDryingState {
  const warnings: string[] = [];
  const ordered = [...reports].sort(
    (a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt),
  );

  const moistureReadings: MoistureReading[] = [...(fallback.moistureReadings ?? [])];
  const psychrometrics: PsychrometricReading[] = [...(fallback.psychrometrics ?? [])];
  let equipment: EquipmentPlacement[] = [...(fallback.equipment ?? [])];
  const evidence: Evidence[] = [...(fallback.evidence ?? [])];
  const dryRooms = new Set<string>();
  const wetRooms = new Set<string>();

  let latestEquipmentAt = '';

  for (const report of ordered) {
    if (report.moistureReadings?.length) {
      moistureReadings.push(...report.moistureReadings);
    }
    if (report.psychrometrics?.length) {
      psychrometrics.push(...report.psychrometrics.map((p) => withDerivedGpp(p)));
    }
    if (report.equipment?.length) {
      // Full snapshot from a later visit replaces earlier placements.
      if (!latestEquipmentAt || Date.parse(report.takenAt) >= Date.parse(latestEquipmentAt)) {
        equipment = report.equipment.map((e) => ({ ...e }));
        latestEquipmentAt = report.takenAt;
      }
    }
    if (report.evidence?.length) {
      evidence.push(...report.evidence);
    }
    for (const room of report.roomsAtDryStandard ?? []) dryRooms.add(room);
    for (const room of report.roomsStillWet ?? []) {
      wetRooms.add(room);
      dryRooms.delete(room);
    }
  }

  // Rooms marked dry in a later visit and never re-wet stay dry.
  for (const room of dryRooms) wetRooms.delete(room);

  const firstAt = ordered[0]?.takenAt;
  const lastAt = ordered[ordered.length - 1]?.takenAt;
  const spanDays =
    firstAt && lastAt
      ? Math.max(1, Math.ceil((Date.parse(lastAt) - Date.parse(firstAt)) / 86_400_000) + 1)
      : 0;

  const dryingDays = Math.max(fallback.dryingDays ?? 0, spanDays, ordered.length, 1);
  const monitoringVisits = Math.max(
    fallback.monitoringVisits ?? 0,
    ordered.length,
    dryingDays,
  );

  if (ordered.length === 0) {
    warnings.push('No drying reports on this job yet — equipment days rest on the initial assessment only.');
  }

  const gppDifferentialValue = gppDifferential(psychrometrics);
  // Shared helper returns affected − unaffected; drying is working when affected
  // is lower (negative differential). Remaining-day heuristic uses magnitude.
  const dryingWorking =
    gppDifferentialValue !== null && gppDifferentialValue < 0;
  const dryingComplete = dryRooms.size > 0 && wetRooms.size === 0 && ordered.length > 0;

  const suggestedRemainingDays = dryingComplete
    ? 0
    : dryingWorking && Math.abs(gppDifferentialValue!) > 15
      ? 1
      : dryingWorking
        ? 2
        : Math.max(1, 3 - Math.min(3, ordered.length));

  const progress: DryingProgress = {
    reports: ordered,
    latestAt: lastAt,
    visitCount: ordered.length,
    moistureReadingCount: moistureReadings.length,
    psychrometricCount: psychrometrics.length,
    roomsAtDryStandard: [...dryRooms],
    roomsStillWet: [...wetRooms],
    gppDifferential: gppDifferentialValue,
    dryingComplete,
    suggestedRemainingDays,
    timeline: ordered.map((report) => ({
      takenAt: report.takenAt,
      source: report.source,
      summary: summarizeReport(report),
    })),
  };

  return {
    moistureReadings,
    psychrometrics,
    equipment,
    evidence,
    dryingDays,
    monitoringVisits,
    progress,
    warnings,
  };
}

function summarizeReport(report: DryingReport): string {
  const bits: string[] = [];
  if (report.moistureReadings?.length) bits.push(`${report.moistureReadings.length} moisture readings`);
  if (report.psychrometrics?.length) bits.push(`${report.psychrometrics.length} psychro`);
  if (report.equipment?.length) {
    const units = report.equipment.reduce((sum, e) => sum + e.quantity, 0);
    bits.push(`${units} pieces of equipment`);
  }
  if (report.roomsAtDryStandard?.length) {
    bits.push(`dry: ${report.roomsAtDryStandard.join(', ')}`);
  }
  if (report.roomsStillWet?.length) {
    bits.push(`still wet: ${report.roomsStillWet.join(', ')}`);
  }
  if (report.notes?.trim()) bits.push(report.notes.trim().slice(0, 80));
  return bits.join(' · ') || 'Visit logged';
}

/** Build a drying report from a manual progress form. */
export function dryingReportFromManual(input: {
  takenAt?: string;
  notes?: string;
  moistureReadings?: MoistureReading[];
  psychrometrics?: PsychrometricReading[];
  equipment?: EquipmentPlacement[];
  roomsAtDryStandard?: string[];
  roomsStillWet?: string[];
}): DryingReport {
  return {
    id: `report-${Date.now().toString(36)}`,
    takenAt: input.takenAt ?? new Date().toISOString(),
    source: 'manual',
    notes: input.notes,
    moistureReadings: input.moistureReadings,
    psychrometrics: input.psychrometrics?.map((p) => withDerivedGpp(p)),
    equipment: input.equipment,
    roomsAtDryStandard: input.roomsAtDryStandard,
    roomsStillWet: input.roomsStillWet,
  };
}
