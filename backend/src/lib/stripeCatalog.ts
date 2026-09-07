/**
 * Live Jettx LLC Atmosphere catalog.
 *
 * These public Stripe ids are already created. Prefer lookup by
 * `atmosphere_plan_code` metadata, then these ids — do not mint duplicates.
 * Secret keys never live here.
 *
 * Self-serve platform plans: Starter ($299 / 1 seat), Work Verification
 * ($599 / 3 seats, default), Scale ($1,499 / 10 seats). Extra Field Capture
 * seats stay $100/mo. Enterprise is contact-sales only — no fourth SKU.
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
  includedFcSeats: number;
  recommended: boolean;
  /** Live product id when known. Starter/Scale are created by stripe:sync. */
  knownProductId?: string;
  /**
   * Live price id when known. Work Verification is pinned. Starter/Scale
   * come from STRIPE_STARTER_PRICE_ID / STRIPE_SCALE_PRICE_ID — the
   * coordinator sets those on Railway after stripe:sync.
   */
  knownPriceId?: string;
}

/** Live Work Verification $599/mo. */
export const LIVE_WORK_VERIFICATION_PRODUCT_ID = 'prod_VDVR9rM3g9Tkpg';
export const LIVE_WORK_VERIFICATION_PRICE_ID = 'price_1UD4Sq1b5twUY3Ly6nqfRaGC';

/** Live extra Field Capture seat $100/mo. */
export const LIVE_EXTRA_FC_SEAT_PRODUCT_ID = 'prod_VDVTrP97lB98V6';
export const LIVE_EXTRA_FC_SEAT_PRICE_ID = 'price_1UD4Sl1b5twUY3LyjD850F4V';

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
    monthlyCents: 29_900,
    includedFcSeats: 1,
    recommended: false,
    // knownPriceId: set STRIPE_STARTER_PRICE_ID after stripe:sync
  },
  work_verification: {
    code: WORK_VERIFICATION_PLAN_CODE,
    name: 'Work Verification',
    monthlyCents: 59_900,
    includedFcSeats: 3,
    recommended: true,
    knownProductId: LIVE_WORK_VERIFICATION_PRODUCT_ID,
    knownPriceId: LIVE_WORK_VERIFICATION_PRICE_ID,
  },
  scale: {
    code: SCALE_PLAN_CODE,
    name: 'Scale',
    monthlyCents: 149_900,
    includedFcSeats: 10,
    recommended: false,
    // knownPriceId: set STRIPE_SCALE_PRICE_ID after stripe:sync
  },
};

/** Default included seats when the org has no stored plan — Work Verification. */
export const INCLUDED_FC_SEATS = ATMOSPHERE_SELF_SERVE_PLANS.work_verification.includedFcSeats;
export const WORK_VERIFICATION_MONTHLY_CENTS =
  ATMOSPHERE_SELF_SERVE_PLANS.work_verification.monthlyCents;
export const EXTRA_FC_SEAT_MONTHLY_CENTS = 10_000;
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

export function selfServePlanList(): AtmosphereSelfServePlan[] {
  return ATMOSPHERE_SELF_SERVE_PLAN_CODES.map((code) => ATMOSPHERE_SELF_SERVE_PLANS[code]);
}

export function planDescription(plan: AtmosphereSelfServePlan): string {
  const seatWord = plan.includedFcSeats === 1 ? 'account' : 'accounts';
  return [
    '• Field Capture + Evidence Platform',
    `• $${(plan.monthlyCents / 100).toLocaleString('en-US')}/mo includes ${plan.includedFcSeats} Field Capture ${seatWord}`,
    '• Additional Field Capture accounts are $100/mo each',
    '• AI/token usage is billed the day it is used',
  ].join('\n');
}

export const WORK_VERIFICATION_DESCRIPTION = planDescription(
  ATMOSPHERE_SELF_SERVE_PLANS.work_verification,
);

export const EXTRA_FC_SEAT_DESCRIPTION =
  'Additional Field Capture account beyond the seats included with your Atmosphere plan. $100/mo per account.';

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
