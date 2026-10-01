/**
 * Allowance knobs. One place, env-overridable, never shown to customers as a margin.
 *
 * The allowance is a share of what the org pays us for the billing period.
 * Purchased credits convert at AI_CREDIT_USD_RATIO (default 1): a $10 pack is
 * $10 of AI spend. That is the same "one credit is one dollar" rule as
 * `lib/money.ts`, not the legacy 10× same-day usage markup.
 */

export interface AiBudgetConfig {
  /** Share of the period's subscription charge that becomes the AI allowance. */
  allowanceFraction: number;
  /** Warn the account at this share of the included allowance. */
  warnFraction: number;
  rollingEnabled: boolean;
  rollingHours: number;
  /** Cap on included allowance inside the rolling window, as a share of the monthly slice. */
  rollingFraction: number;
  /** Dollars of AI spend credited per dollar paid for a pack. */
  creditUsdRatio: number;
  /** When true, token events are not also invoiced as same-day usage. */
  replacesUsageInvoices: boolean;
}

function fraction(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export function aiBudgetConfig(env: NodeJS.ProcessEnv = process.env): AiBudgetConfig {
  const rollingRaw = (env.AI_BUDGET_ROLLING_ENABLED ?? 'true').trim().toLowerCase();
  return {
    allowanceFraction: fraction(env.AI_BUDGET_FRACTION, 0.1),
    warnFraction: fraction(env.AI_BUDGET_WARN_FRACTION, 0.8),
    rollingEnabled: rollingRaw !== 'false' && rollingRaw !== '0' && rollingRaw !== 'off',
    rollingHours: Math.max(1, Math.round(fraction(env.AI_BUDGET_ROLLING_HOURS, 24))),
    rollingFraction: fraction(env.AI_BUDGET_ROLLING_FRACTION, 0.25),
    creditUsdRatio: fraction(env.AI_CREDIT_USD_RATIO, 1),
    replacesUsageInvoices: (env.AI_ALLOWANCE_REPLACES_USAGE_INVOICES ?? 'true').trim().toLowerCase() !== 'false',
  };
}

export const AI_CREDIT_PACKS = [
  { code: 'ai_10', cents: 1_000, env: 'STRIPE_AI_CREDIT_10_PRICE_ID', label: '$10' },
  { code: 'ai_25', cents: 2_500, env: 'STRIPE_AI_CREDIT_25_PRICE_ID', label: '$25' },
  { code: 'ai_50', cents: 5_000, env: 'STRIPE_AI_CREDIT_50_PRICE_ID', label: '$50' },
] as const;

export type AiCreditPackCode = (typeof AI_CREDIT_PACKS)[number]['code'];

export function creditPackByCode(code: string | null | undefined) {
  return AI_CREDIT_PACKS.find((pack) => pack.code === code) ?? null;
}

export function creditPackPriceId(code: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pack = creditPackByCode(code);
  if (!pack) return null;
  const id = (env[pack.env] ?? '').trim();
  return id || null;
}
