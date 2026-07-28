import { CATALOG, CATALOG_KEYS, applyWaste, codeFor, type CatalogKey } from '../pricing/catalog.js';
import {
  assessCompleteness,
  completenessBlockers,
  type CompletenessReport,
} from '../knowledge/completeness.js';
import type { RebuildDerivation } from '../scope/rebuildFromMitigation.js';
import type {
  ConstructionEstimate,
  CrmJob,
  EstimateLineItem,
  EstimateSummary,
  MitigationEstimate,
  RoomMeasurements,
  ScopeItem,
} from '../types.js';

/**
 * Assembling the estimate.
 *
 * Scope items say what work a room needs. This turns them into the line items
 * an estimator submits: catalog codes resolved, waste allowances applied,
 * trades attached, and the whole thing ordered the way a scope sheet reads —
 * room by room, and within a room in build order, because an estimate that
 * lists paint before drywall gets questioned even when the numbers are right.
 */

/** Reverse index so a scope item's code resolves back to its catalog entry. */
const KEY_BY_CODE = new Map<string, CatalogKey>(
  CATALOG_KEYS.map((key) => [codeFor(key), key]),
);

/**
 * Build order. Trades that create substrate come before trades that finish it;
 * cleanup comes last. Anything not listed sorts after the named trades but
 * before cleanup, so an added catalog entry never lands in a nonsensical place.
 */
const TRADE_ORDER = [
  'Permits',
  'Protection',
  'Equipment',
  'Framing',
  'Insulation',
  'Drywall',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Finish Carpentry',
  'Cabinetry',
  'Flooring',
  'Painting',
  'General',
  'Cleaning',
];

function tradeRank(trade: string): number {
  const index = TRADE_ORDER.indexOf(trade);
  return index === -1 ? TRADE_ORDER.indexOf('General') : index;
}

export interface EstimateInput {
  job: CrmJob;
  rooms: RoomMeasurements[];
  scope: ScopeItem[];
  /** Where the scope came from — shown on the estimate and in the export. */
  basis: ConstructionEstimate['basis'];
  warnings: string[];
  /** Mitigation derivation — feeds the completeness report. */
  derivation?: RebuildDerivation | null;
  mitigation?: MitigationEstimate | null;
}

export function buildEstimate(input: EstimateInput): ConstructionEstimate {
  const warnings = [...input.warnings];
  const lineItems: EstimateLineItem[] = [];

  for (const scopeItem of input.scope) {
    const key = KEY_BY_CODE.get(scopeItem.code);
    if (!key) {
      // A scope item whose code is not in the catalog cannot be priced or
      // exported, and silently dropping it would hide real work.
      warnings.push(
        `Line "${scopeItem.description}" in ${scopeItem.roomName} uses code ${scopeItem.code}, which is not in the catalog — it was left out of the estimate.`,
      );
      continue;
    }

    const catalogItem = CATALOG[key];
    lineItems.push({
      ...scopeItem,
      category: catalogItem.category,
      selector: catalogItem.selector,
      trade: catalogItem.trade,
      quantityWithWaste: applyWaste(key, scopeItem.quantity),
    });
  }

  // Room order follows the scan, so the estimate walks the house the way the
  // technician did rather than in whatever order findings arrived.
  const roomOrder = new Map(input.rooms.map((room, index) => [room.id, index]));
  lineItems.sort((a, b) => {
    const roomDelta =
      (roomOrder.get(a.roomId) ?? Number.MAX_SAFE_INTEGER) -
      (roomOrder.get(b.roomId) ?? Number.MAX_SAFE_INTEGER);
    if (roomDelta !== 0) return roomDelta;

    const tradeDelta = tradeRank(a.trade) - tradeRank(b.trade);
    if (tradeDelta !== 0) return tradeDelta;

    return a.code.localeCompare(b.code);
  });

  const zeroQuantity = lineItems.filter((line) => line.quantity === 0);
  if (zeroQuantity.length > 0) {
    warnings.push(
      `${zeroQuantity.length} line item(s) need a quantity entered before this estimate can be submitted.`,
    );
  }

  const completeness = assessCompleteness({
    items: input.scope,
    rooms: input.rooms,
    derivation: input.derivation,
    mitigation: input.mitigation,
  });

  for (const issue of completeness.issues.filter((entry) => entry.severity !== 'info')) {
    warnings.push(`[${issue.severity}] ${issue.message}`);
  }

  return {
    jobId: input.job.id,
    jobNumber: input.job.jobNumber,
    claimNumber: input.job.claimNumber,
    insuredName: input.job.insuredName,
    address: input.job.address,
    basis: input.basis,
    lineItems,
    summary: summarise(lineItems, input.rooms),
    completeness,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

function summarise(lineItems: EstimateLineItem[], rooms: RoomMeasurements[]): EstimateSummary {
  const quantityByUnit: Record<string, number> = {};
  for (const line of lineItems) {
    quantityByUnit[line.unit] = Math.round(
      ((quantityByUnit[line.unit] ?? 0) + line.quantityWithWaste) * 100,
    ) / 100;
  }

  const scopedRoomIds = new Set(lineItems.map((line) => line.roomId));

  return {
    lineItemCount: lineItems.length,
    roomCount: scopedRoomIds.size,
    quantityByUnit,
    itemsNeedingReview: lineItems.filter((line) => line.needsReview).length,
    emptyRooms: rooms.filter((room) => !scopedRoomIds.has(room.id)).map((room) => room.name),
  };
}

/**
 * Whether the estimate is safe to push into the estimating platform.
 *
 * Writing an estimate into a customer's Xactimate account is outward-facing and
 * awkward to undo, so the pipeline never does it off the back of a confidence
 * score. This is the check the approve endpoint runs before it will export.
 *
 * Completeness criticals (missing pad with carpet, scrubber without filters,
 * zero quantities) block export. Soft warnings do not — a reviewer who has
 * looked at them can still approve.
 */
export function readinessIssues(estimate: ConstructionEstimate): string[] {
  const issues: string[] = [];

  if (estimate.lineItems.length === 0) {
    issues.push('The estimate has no line items.');
  }

  const zeroQuantity = estimate.lineItems.filter((line) => line.quantity === 0);
  if (zeroQuantity.length > 0) {
    issues.push(
      `${zeroQuantity.length} line item(s) still have a quantity of zero: ${zeroQuantity
        .map((line) => `${line.roomName} — ${line.description}`)
        .join('; ')}.`,
    );
  }

  if (estimate.completeness) {
    issues.push(...completenessBlockers(estimate.completeness));
  }

  return [...new Set(issues)];
}

export type { CompletenessReport };
