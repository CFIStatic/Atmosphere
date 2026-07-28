import { DEFAULT_ESTIMATOR_CONFIG, type EstimatorConfig } from './agent.js';
import { buildAccountCatalog } from './catalog/accountCatalog.js';
import type { PriceList } from './catalog/priceList.js';
import type { StoredSettings } from './store.js';

/**
 * Turn stored org settings and a synced price list into a runtime config.
 *
 * Kept apart from the rules so the estimating logic never reads settings
 * directly: every knob is resolved once, here, and handed down. That is what
 * makes an estimate reproducible — re-running one only needs the settings
 * snapshot, not the state of the org's preferences at some later moment.
 *
 * The catalog is built from the **account price list**. Knowledge profiles in
 * `lineItems.ts` only supply tags, evidence gates, and cost basis — selectors
 * and unit prices come from Xactimate.
 */
export function buildEstimatorConfig(
  stored: StoredSettings,
  priceList: PriceList | null,
): { config: EstimatorConfig; warnings: string[]; remapped: Array<{ from: string; to: string; description: string; via: string }> } {
  const account = buildAccountCatalog(priceList, {
    remaps: stored.catalogRemaps ?? {},
  });

  const base = DEFAULT_ESTIMATOR_CONFIG;

  return {
    warnings: account.warnings,
    remapped: account.remapped,
    config: {
      scope: {
        ...base.scope,
        hoursPerMonitoringVisit: stored.hoursPerMonitoringVisit ?? base.scope.hoursPerMonitoringVisit,
        techniciansOnSite: stored.techniciansOnSite ?? base.scope.techniciansOnSite,
        category3CutHeightIn: stored.category3CutHeightIn ?? base.scope.category3CutHeightIn,
        planCutHeightIn: stored.planCutHeightIn ?? base.scope.planCutHeightIn,
        equipmentBillingMode: stored.equipmentBillingMode ?? base.scope.equipmentBillingMode,
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
      catalog: account.catalog,
      lineMarginFloor: stored.lineMarginFloor ?? base.lineMarginFloor,
      codeOverrides: stored.codeOverrides ?? {},
    },
  };
}
