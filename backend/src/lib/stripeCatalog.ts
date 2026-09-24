/**
 * Live Jettx LLC Atmosphere catalog.
 *
 * These public Stripe ids are already created. Prefer these pinned ids,
 * then lookup by `atmosphere_plan_code` metadata — do not mint duplicates.
 * Secret keys never live here.
 *
 * Self-serve platform plans: Starter ($399/mo or $3,990/yr, 1 seat), Work
 * Verification ($849/mo or $8,490/yr, 3 seats, default), Scale ($1,999/mo or
 * $19,990/yr, 10 seats). Extra Field Capture seats are $125/mo or $1,250/yr.
 * Yearly is 10× the monthly price (2 months free). Enterprise is contact-sales
 * only — no fourth SKU. Annual price ids are pinned here the same way as
 * monthly: env vars win, these live ids are the fallback.
 */

export const STARTER_PLAN_CODE = 'starter';
export const WORK_VERIFICATION_PLAN_CODE = 'work_verification';
export const SCALE_PLAN_CODE = 'scale';
export const FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE = 'field_capture_extra_seat';
export const DEFAULT_ONBOARDING_PLAN_CODE = WORK_VERIFICATION_PLAN_CODE;

export const ATMOSPHERE_SELF_SERVE_PLAN_CODES = [
  STARTER_PLAN_CODE,
  WORK_VERIFICATION_PLAN_CODE,
  SCALE_PLAN_CODE,
] as const;

export type AtmosphereSelfServePlanCode = (typeof ATMOSPHERE_SELF_SERVE_PLAN_CODES)[number];

export interface AtmosphereSelfServePlan {
  code: AtmosphereSelfServePlanCode;
  name: string;
  monthlyCents: number;
  /** Prepaid annual amount (10× monthly — 2 months free). */
  annualCents: number;
  includedFcSeats: number;
  recommended: boolean;
  /** Live product id when known. Used by stripe:sync so re-runs reuse the SKU. */
  knownProductId?: string;
  /**
   * Live price id when known. Runtime still prefers STRIPE_*_PRICE_ID env
   * vars; these ids are the fallback so checkout works before Railway is set.
   */
  knownPriceId?: string;
}

/** Live Starter $399/mo (1 Field Capture seat). */
export const LIVE_STARTER_PRODUCT_ID = 'prod_VDZ3e7oBJWIYSE';
export const LIVE_STARTER_PRICE_ID = 'price_1UDGIY1b5twUY3Ly7UlLMYBW';

/** Live Work Verification $849/mo. */
export const LIVE_WORK_VERIFICATION_PRODUCT_ID = 'prod_VDVR9rM3g9Tkpg';
export const LIVE_WORK_VERIFICATION_PRICE_ID = 'price_1UDGIZ1b5twUY3LyO0culT5W';

/** Live Scale $1,999/mo (10 Field Capture seats). */
export const LIVE_SCALE_PRODUCT_ID = 'prod_VDZ3SMytTKoxc5';
export const LIVE_SCALE_PRICE_ID = 'price_1UDGIb1b5twUY3LyUuZeyp75';

/** Live extra Field Capture seat $125/mo. */
export const LIVE_EXTRA_FC_SEAT_PRODUCT_ID = 'prod_VDVTrP97lB98V6';
export const LIVE_EXTRA_FC_SEAT_PRICE_ID = 'price_1UDGIc1b5twUY3Ly0cEsD5Pr';

/** Live Starter $3,990/yr. Same product as the monthly price. */
export const LIVE_STARTER_ANNUAL_PRICE_ID = 'price_1UJL4a1b5twUY3LyozTzumYn';

/** Live Work Verification $8,490/yr. */
export const LIVE_WORK_VERIFICATION_ANNUAL_PRICE_ID = 'price_1UJL7O1b5twUY3LysyTksWMm';

/** Live Scale $19,990/yr. */
export const LIVE_SCALE_ANNUAL_PRICE_ID = 'price_1UJLA31b5twUY3LysRs2YVmw';

/** Live extra Field Capture seat $1,250/yr. */
export const LIVE_EXTRA_FC_SEAT_ANNUAL_PRICE_ID = 'price_1UJLCg1b5twUY3Ly33CATdSo';

/** Prior live prices — still on existing subscriptions until they migrate. */
export const LEGACY_STARTER_PRICE_ID = 'price_1UD7vi1b5twUY3LykzUsVQVr';
export const LEGACY_WORK_VERIFICATION_PRICE_ID = 'price_1UD4Sq1b5twUY3Ly6nqfRaGC';
export const LEGACY_SCALE_PRICE_ID = 'price_1UD7vj1b5twUY3Ly1Q4uv4kS';
export const LEGACY_EXTRA_FC_SEAT_PRICE_ID = 'price_1UD4Sl1b5twUY3LyjD850F4V';

/** Live Chest Mount one-time $49.99. */
export const LIVE_CHEST_MOUNT_PRODUCT_ID = 'prod_VDVQSFSfFnEs4J';
export const LIVE_CHEST_MOUNT_PRICE_ID = 'price_1UD4Sl1b5twUY3LyFtodoczS';

/** Active Payment Link that sells the $49.99 Chest Mount (old $49 link is inactive). */
export const LIVE_CHEST_MOUNT_PAYMENT_LINK =
  'https://buy.stripe.com/bJedR16fJ40l5G1eRJfYY01';

export const ATMOSPHERE_SELF_SERVE_PLANS: Record<
  AtmosphereSelfServePlanCode,
  AtmosphereSelfServePlan
> = {
  starter: {
    code: STARTER_PLAN_CODE,
    name: 'Starter',
    monthlyCents: 39_900,
    annualCents: 399_000,
    includedFcSeats: 1,
    recommended: false,
    knownProductId: LIVE_STARTER_PRODUCT_ID,
    knownPriceId: LIVE_STARTER_PRICE_ID,
  },
  work_verification: {
    code: WORK_VERIFICATION_PLAN_CODE,
    name: 'Work Verification',
    monthlyCents: 84_900,
    annualCents: 849_000,
    includedFcSeats: 3,
    recommended: true,
    knownProductId: LIVE_WORK_VERIFICATION_PRODUCT_ID,
    knownPriceId: LIVE_WORK_VERIFICATION_PRICE_ID,
  },
  scale: {
    code: SCALE_PLAN_CODE,
    name: 'Scale',
    monthlyCents: 199_900,
    annualCents: 1_999_000,
    includedFcSeats: 10,
    recommended: false,
    knownProductId: LIVE_SCALE_PRODUCT_ID,
    knownPriceId: LIVE_SCALE_PRICE_ID,
  },
};

/** Default included seats when the org has no stored plan — Work Verification. */
export const INCLUDED_FC_SEATS = ATMOSPHERE_SELF_SERVE_PLANS.work_verification.includedFcSeats;
export const WORK_VERIFICATION_MONTHLY_CENTS =
  ATMOSPHERE_SELF_SERVE_PLANS.work_verification.monthlyCents;
export const EXTRA_FC_SEAT_MONTHLY_CENTS = 12_500;
/** $1,250/yr — 10× monthly, same 2-months-free annual offer as the plans. */
export const EXTRA_FC_SEAT_ANNUAL_CENTS = 125_000;

/** Stripe metadata uses either code for the extra-seat price. */
export const EXTRA_SEAT_PLAN_CODES = [FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE, 'extra_fc_seat'] as const;

export function isExtraSeatPlanCode(value: string | null | undefined): boolean {
  return EXTRA_SEAT_PLAN_CODES.includes(value as (typeof EXTRA_SEAT_PLAN_CODES)[number]);
}
export const CHEST_MOUNT_PRICE_CENTS = 4_999;

export function isAtmosphereSelfServePlanCode(
  value: string | null | undefined,
): value is AtmosphereSelfServePlanCode {
  return ATMOSPHERE_SELF_SERVE_PLAN_CODES.includes(value as AtmosphereSelfServePlanCode);
}

export function parseAtmospherePlanCode(
  value: string | null | undefined,
  fallback: AtmosphereSelfServePlanCode = DEFAULT_ONBOARDING_PLAN_CODE,
): AtmosphereSelfServePlanCode {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return isAtmosphereSelfServePlanCode(normalized) ? normalized : fallback;
}

export function atmospherePlan(code?: string | null): AtmosphereSelfServePlan {
  return ATMOSPHERE_SELF_SERVE_PLANS[parseAtmospherePlanCode(code)];
}

export function includedFcSeatsForPlan(
  code?: string | null,
  stored?: number | null,
): number {
  if (stored != null && Number.isFinite(Number(stored))) {
    return Math.max(0, Math.floor(Number(stored)));
  }
  return atmospherePlan(code).includedFcSeats;
}

/** Read `atmosphere_included_fc_seats` from Stripe product / price / subscription metadata. */
export function includedFcSeatsFromMetadata(
  ...sources: Array<{ atmosphere_included_fc_seats?: string | number | null } | null | undefined>
): number | null {
  for (const source of sources) {
    const raw = source?.atmosphere_included_fc_seats;
    if (raw == null || raw === '') continue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return null;
}

export function selfServePlanList(): AtmosphereSelfServePlan[] {
  return ATMOSPHERE_SELF_SERVE_PLAN_CODES.map((code) => ATMOSPHERE_SELF_SERVE_PLANS[code]);
}

export function planDescription(plan: AtmosphereSelfServePlan): string {
  const seatWord = plan.includedFcSeats === 1 ? 'account' : 'accounts';
  return [
    '• Field Capture + Evidence Platform',
    `• $${(plan.monthlyCents / 100).toLocaleString('en-US')}/mo includes ${plan.includedFcSeats} Field Capture ${seatWord}`,
    `• Additional Field Capture accounts are $${(EXTRA_FC_SEAT_MONTHLY_CENTS / 100).toLocaleString('en-US')}/mo each`,
    '• AI/token usage is billed the day it is used',
  ].join('\n');
}

export const WORK_VERIFICATION_DESCRIPTION = planDescription(
  ATMOSPHERE_SELF_SERVE_PLANS.work_verification,
);

export const EXTRA_FC_SEAT_DESCRIPTION =
  `Additional Field Capture account beyond the seats included with your Atmosphere plan. $${(EXTRA_FC_SEAT_MONTHLY_CENTS / 100).toLocaleString('en-US')}/mo per account.`;

export function allowedFcSeats(
  extraSeats: number,
  included: number = INCLUDED_FC_SEATS,
): number {
  const extra = Number.isFinite(extraSeats) ? Math.max(0, Math.floor(extraSeats)) : 0;
  const base = Number.isFinite(included) ? Math.max(0, Math.floor(included)) : INCLUDED_FC_SEATS;
  return base + extra;
}

/** Extra seats to buy so `used` fits under included + extra. Zero when already allowed. */
export function extraSeatsNeeded(
  used: number,
  extraSeats = 0,
  included: number = INCLUDED_FC_SEATS,
): number {
  const allowed = allowedFcSeats(extraSeats, included);
  const taken = Number.isFinite(used) ? Math.max(0, Math.floor(used)) : 0;
  return Math.max(0, taken - allowed);
}

export function hasFcSeatCapacity(
  used: number,
  extraSeats = 0,
  included: number = INCLUDED_FC_SEATS,
): boolean {
  return extraSeatsNeeded(used, extraSeats, included) === 0;
}
