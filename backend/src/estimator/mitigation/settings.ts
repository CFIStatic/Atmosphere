import { DEFAULT_ESTIMATOR_CONFIG, type EstimatorConfig } from './agent.js';
import { CATALOG } from './catalog/lineItems.js';
import { reconcileCatalog, type PriceList } from './catalog/priceList.js';
import type { StoredSettings } from './store.js';

/**
 * Turn stored org settings and a synced price list into a runtime config.
 *
 * Kept apart from the rules so the estimating logic never reads settings
 * directly: every knob is resolved once, here, and handed down. That is what
 * makes an estimate reproducible — re-running one only needs the settings
 * snapshot, not the state of the org's preferences at some later moment.
 */
export function buildEstimatorConfig(
  stored: StoredSettings,
  priceList: PriceList | null,
): { config: EstimatorConfig; warnings: string[] } {
  const warnings: string[] = [];

  let catalog = CATALOG;
  if (priceList) {
    const reconciled = reconcileCatalog(priceList);
    catalog = reconciled.catalog;
    warnings.push(...reconciled.warnings);
  } else {
    warnings.push(
      'No Xactimate price list is connected, so every price below is a built-in placeholder. Connect Xactimate or upload an exported price list before submitting this estimate.',
    );
  }

  const base = DEFAULT_ESTIMATOR_CONFIG;

  return {
    warnings,
    config: {
      scope: {
        ...base.scope,
        hoursPerMonitoringVisit: stored.hoursPerMonitoringVisit ?? base.scope.hoursPerMonitoringVisit,
        techniciansOnSite: stored.techniciansOnSite ?? base.scope.techniciansOnSite,
        category3CutHeightIn: stored.category3CutHeightIn ?? base.scope.category3CutHeightIn,
      },
      pricing: {
        overheadAndProfitRate: stored.overheadAndProfitRate ?? base.pricing.overheadAndProfitRate,
        oAndPEligible: stored.oAndPEligible ?? base.pricing.oAndPEligible,
        taxRate: stored.taxRate ?? base.pricing.taxRate,
        targetMargin: stored.targetMargin ?? base.pricing.targetMargin,
      },
      costBasis: {
        overrides: stored.costOverrides ?? {},
        costMultiplier: stored.costMultiplier ?? 1,
      },
      priceList,
      catalog,
      lineMarginFloor: stored.lineMarginFloor ?? base.lineMarginFloor,
    },
  };
}
