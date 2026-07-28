import { codeFor, keyForCode, type CatalogKey } from '../pricing/catalog.js';
import type {
  ConstructionEstimate,
  MitigationEstimate,
  RoomMeasurements,
  ScopeItem,
} from '../types.js';
import type { RebuildDerivation } from '../scope/rebuildFromMitigation.js';

/**
 * Completeness review — the last gate before a human approves a rebuild.
 *
 * A meticulous construction estimate does not ship with drywall and no paint,
 * carpet and no pad, or a mitigation removal that matched no rebuild rule and
 * vanished. This module surfaces every gap so the reviewer sees them; it does
 * not invent quantities for gaps it cannot size.
 */

export type CompletenessSeverity = 'critical' | 'warning' | 'info';

export interface CompletenessIssue {
  severity: CompletenessSeverity;
  roomName?: string;
  code?: string;
  message: string;
}

export interface CompletenessReport {
  issues: CompletenessIssue[];
  /** Mitigation removals that never produced rebuild work. */
  unmatchedRemovals: { description: string; roomName?: string; reason: string }[];
  criticalCount: number;
  warningCount: number;
}

/** Required companions: if A is present, B must also be present in the same room. */
const REQUIRED_PAIRS: { when: CatalogKey; need: CatalogKey; message: string }[] = [
  { when: 'drywall_half', need: 'paint_walls', message: 'Drywall without wall paint' },
  { when: 'drywall_five_eighths', need: 'paint_walls', message: 'Drywall without wall paint' },
  { when: 'drywall_half', need: 'drywall_primer', message: 'New drywall without primer' },
  { when: 'carpet', need: 'carpet_pad', message: 'Carpet without pad' },
  { when: 'carpet', need: 'carpet_tack_strip', message: 'Carpet without tack strip' },
  { when: 'baseboard', need: 'paint_baseboard', message: 'Baseboard without paint' },
  { when: 'interior_door', need: 'paint_door', message: 'Door without paint' },
  { when: 'ceramic_tile', need: 'tile_thinset', message: 'Tile without thinset' },
  { when: 'ceramic_tile', need: 'tile_grout', message: 'Tile without grout' },
  { when: 'hepa_air_scrubber', need: 'hepa_filter_change', message: 'Air scrubber without filter changes' },
  { when: 'luxury_vinyl_plank', need: 'floor_underlayment', message: 'LVP without underlayment' },
  { when: 'engineered_wood', need: 'floor_underlayment', message: 'Wood floor without underlayment' },
];

function hasKeyInRoom(items: ScopeItem[], roomId: string, key: CatalogKey): boolean {
  const code = codeFor(key);
  return items.some((item) => item.roomId === roomId && item.code === code);
}

function roomKeys(items: ScopeItem[], roomId: string): Set<CatalogKey> {
  const keys = new Set<CatalogKey>();
  for (const item of items) {
    if (item.roomId !== roomId) continue;
    const key = keyForCode(item.code);
    if (key) keys.add(key);
  }
  return keys;
}

export interface CompletenessInput {
  items: ScopeItem[];
  rooms: RoomMeasurements[];
  estimate?: ConstructionEstimate | null;
  derivation?: RebuildDerivation | null;
  mitigation?: MitigationEstimate | null;
}

export function assessCompleteness(input: CompletenessInput): CompletenessReport {
  const issues: CompletenessIssue[] = [];
  const unmatchedRemovals: CompletenessReport['unmatchedRemovals'] = [];

  const byRoom = new Map<string, ScopeItem[]>();
  for (const item of input.items) {
    const bucket = byRoom.get(item.roomId);
    if (bucket) bucket.push(item);
    else byRoom.set(item.roomId, [item]);
  }

  for (const [roomId, roomItems] of byRoom) {
    const roomName = roomItems[0]!.roomName;
    const keys = roomKeys(input.items, roomId);

    for (const pair of REQUIRED_PAIRS) {
      if (!keys.has(pair.when)) continue;
      if (hasKeyInRoom(input.items, roomId, pair.need)) continue;
      issues.push({
        severity: 'critical',
        roomName,
        code: codeFor(pair.need),
        message: `${pair.message} in ${roomName}.`,
      });
    }

    // Dusty drywall work must carry scrubbers + filters.
    if (keys.has('drywall_half') || keys.has('drywall_five_eighths')) {
      if (!keys.has('hepa_air_scrubber')) {
        issues.push({
          severity: 'critical',
          roomName,
          message: `${roomName}: drywall reconstruction without HEPA air scrubbers for dust control.`,
        });
      }
      if (!keys.has('containment_barrier')) {
        issues.push({
          severity: 'warning',
          roomName,
          message: `${roomName}: dusty work without temporary containment.`,
        });
      }
    }

    // Zero-quantity lines are always critical.
    for (const item of roomItems) {
      if (item.quantity === 0) {
        issues.push({
          severity: 'critical',
          roomName,
          code: item.code,
          message: `${roomName}: "${item.description}" has quantity 0 — enter a measured quantity.`,
        });
      }
    }

    // Review flags are warnings, not blockers.
    const reviewCount = roomItems.filter((item) => item.needsReview).length;
    if (reviewCount > 0) {
      issues.push({
        severity: 'info',
        roomName,
        message: `${roomName}: ${reviewCount} line(s) flagged for human review.`,
      });
    }
  }

  // Mitigation removals that never mapped.
  if (input.derivation) {
    for (const skipped of input.derivation.skipped) {
      if (skipped.reason.includes('no rebuild rule')) {
        unmatchedRemovals.push({
          description: skipped.line.description,
          roomName: skipped.line.roomName,
          reason: skipped.reason,
        });
        issues.push({
          severity: 'warning',
          roomName: skipped.line.roomName,
          message:
            `Mitigation removal "${skipped.line.description}"` +
            `${skipped.line.roomName ? ` in ${skipped.line.roomName}` : ''} ` +
            `has no rebuild rule — add the replacement manually or extend the catalog.`,
        });
      }
    }
  }

  // Empty rooms in the scan that notes put in scope.
  for (const room of input.rooms) {
    if (!byRoom.has(room.id)) {
      issues.push({
        severity: 'info',
        roomName: room.name,
        message: `${room.name}: no rebuild lines — confirm the room is genuinely untouched.`,
      });
    }
  }

  if (input.estimate && input.estimate.lineItems.length === 0) {
    issues.push({
      severity: 'critical',
      message: 'The estimate has no line items.',
    });
  }

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

  return { issues, unmatchedRemovals, criticalCount, warningCount };
}

/**
 * Readiness for Xactimate export: structural blockers only.
 * Completeness warnings still show in the UI but do not hard-block approve
 * unless they are critical gaps (missing companions / zero qty / empty).
 */
export function completenessBlockers(report: CompletenessReport): string[] {
  return report.issues
    .filter((issue) => issue.severity === 'critical')
    .map((issue) => issue.message);
}
