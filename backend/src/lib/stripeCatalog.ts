/**
 * Live Jettx LLC Atmosphere catalog.
 *
 * These public Stripe ids are already created. Prefer lookup by
 * `atmosphere_plan_code` metadata, then these ids — do not mint duplicates.
 * Secret keys never live here.
 */

export const WORK_VERIFICATION_PLAN_CODE = 'work_verification';
export const FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE = 'field_capture_extra_seat';

export const INCLUDED_FC_SEATS = 3;
export const WORK_VERIFICATION_MONTHLY_CENTS = 59_900;
export const EXTRA_FC_SEAT_MONTHLY_CENTS = 10_000;
export const CHEST_MOUNT_PRICE_CENTS = 4_999;

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

export const WORK_VERIFICATION_DESCRIPTION = [
  '• Field Capture + Evidence Platform',
  '• $599/mo includes 3 Field Capture accounts',
  '• Additional Field Capture accounts are $100/mo each',
  '• AI/token usage is billed the day it is used',
].join('\n');

export const EXTRA_FC_SEAT_DESCRIPTION =
  'Additional Field Capture account beyond the 3 included with Work Verification. $100/mo per account.';

export function allowedFcSeats(
  extraSeats: number,
  included: number = INCLUDED_FC_SEATS,
): number {
  const extra = Number.isFinite(extraSeats) ? Math.max(0, Math.floor(extraSeats)) : 0;
  const base = Number.isFinite(included) ? Math.max(0, Math.floor(included)) : INCLUDED_FC_SEATS;
  return base + extra;
}

/** Extra seats to buy so `used` fits under 3 + extra. Zero when already allowed. */
export function extraSeatsNeeded(
  used: number,
  extraSeats = 0,
  included: number = INCLUDED_FC_SEATS,
): number {
  const allowed = allowedFcSeats(extraSeats, included);
  const taken = Number.isFinite(used) ? Math.max(0, Math.floor(used)) : 0;
  return Math.max(0, taken - allowed);
}

export function hasFcSeatCapacity(used: number, extraSeats = 0, included: number = INCLUDED_FC_SEATS): boolean {
  return extraSeatsNeeded(used, extraSeats, included) === 0;
}
