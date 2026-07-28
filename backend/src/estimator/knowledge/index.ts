import { CATALOG, codeFor, type CatalogKey } from '../pricing/catalog.js';

/**
 * Barrel for the construction knowledge base.
 *
 * Keep imports of specific modules preferred in production code; this exists so
 * demos and docs can point at one place.
 */
export { expandDependents, DEPENDENT_RULES } from './dependents.js';
export {
  sizeConstructionEquipment,
  scrubbersForVolume,
  workDaysForDustyArea,
  planForRoom,
} from './equipment.js';
export { applyCodeRequirements } from './codes.js';
export {
  assessCompleteness,
  completenessBlockers,
  type CompletenessReport,
  type CompletenessIssue,
} from './completeness.js';

export { CATALOG, codeFor };
export type { CatalogKey };
