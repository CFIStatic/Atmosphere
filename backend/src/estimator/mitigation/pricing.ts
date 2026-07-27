import { round } from './lib/geometry.js';
import type { EstimateLineItem } from './types.js';

/**
 * Estimate totals: subtotal, overhead & profit, tax.
 *
 * O&P is not automatic. Carriers pay the 10-and-10 when the job is complex
 * enough to warrant general-contractor coordination — which mitigation work with
 * three or more trades usually is — and decline it otherwise. So the rate is a
 * setting, `oAndPEligible` records the decision, and the reason is written onto
 * the estimate rather than left for the adjuster to infer.
 */

export interface PricingOptions {
  /** Combined overhead and profit rate. 0.20 is the conventional 10-and-10. */
  overheadAndProfitRate: number;
  /** Whether this job qualifies for O&P at all. */
  oAndPEligible: boolean;
  /** Sales tax rate applied to the material portion of the work. */
  taxRate: number;
  /** Target gross margin, 0–1, that the profitability review measures against. */
  targetMargin: number;
}

export const DEFAULT_PRICING_OPTIONS: PricingOptions = {
  overheadAndProfitRate: 0.2,
  oAndPEligible: true,
  taxRate: 0.07,
  targetMargin: 0.45,
};

/**
 * Share of each Xactimate category's price that is taxable material rather than
 * labour or equipment rental. Mitigation is labour- and equipment-heavy, so the
 * taxable base is small — assuming otherwise inflates the total and gets the
 * estimate re-priced.
 */
const MATERIAL_FRACTION: Record<string, number> = {
  WTR: 0.08,
  CLN: 0.2,
  DMO: 0.25,
};

export interface EstimateTotals {
  subtotal: number;
  overheadAndProfit: number;
  taxableBase: number;
  tax: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  grossMargin: number;
}

export function priceEstimate(
  lineItems: EstimateLineItem[],
  options: PricingOptions = DEFAULT_PRICING_OPTIONS,
): EstimateTotals {
  const subtotal = round(lineItems.reduce((sum, line) => sum + line.rcv, 0));
  const totalCost = round(lineItems.reduce((sum, line) => sum + line.totalCost, 0));

  const overheadAndProfit = options.oAndPEligible
    ? round(subtotal * options.overheadAndProfitRate)
    : 0;

  const taxableBase = round(
    lineItems.reduce(
      (sum, line) => sum + line.rcv * (MATERIAL_FRACTION[line.category] ?? 0.15),
      0,
    ),
  );
  const tax = round(taxableBase * options.taxRate);

  const total = round(subtotal + overheadAndProfit + tax);
  // Tax is collected and remitted, so it is not revenue and never counts toward
  // profit. Treating it as margin is a classic way to believe a job made money.
  const revenue = round(subtotal + overheadAndProfit);
  const grossProfit = round(revenue - totalCost);

  return {
    subtotal,
    overheadAndProfit,
    taxableBase,
    tax,
    total,
    totalCost,
    grossProfit,
    grossMargin: revenue > 0 ? round(grossProfit / revenue, 4) : 0,
  };
}

/** Per-line margin, for spotting the lines that drag a job under target. */
export function lineMargin(line: EstimateLineItem): number {
  if (line.rcv <= 0) return 0;
  return round((line.rcv - line.totalCost) / line.rcv, 4);
}

/**
 * Extra revenue needed to reach the target margin at the current cost base.
 *
 * Solving `(R − C) / R = target` for R gives `R = C / (1 − target)`, so the gap
 * is that figure less current revenue. This is the number that says how much
 * legitimately-performed-but-unbilled work has to be recovered for the job to
 * hit its number — not a licence to pad, which is why `profitability.ts` will
 * only ever close the gap with documented findings.
 */
export function revenueGapToTarget(totals: EstimateTotals, targetMargin: number): number {
  if (targetMargin <= 0 || targetMargin >= 1) return 0;
  const revenue = totals.subtotal + totals.overheadAndProfit;
  const requiredRevenue = totals.totalCost / (1 - targetMargin);
  return round(Math.max(0, requiredRevenue - revenue));
}
