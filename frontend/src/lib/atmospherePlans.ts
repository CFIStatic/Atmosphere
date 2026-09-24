import type { AtmosphereSelfServePlan } from './api';

export const DEFAULT_ONBOARDING_PLAN_CODE = 'work_verification' as const;

/** Monthly stays the default. Yearly is 10× monthly (2 months free). */
export type AtmosphereBillingInterval = 'month' | 'year';

export const EXTRA_FC_SEAT_MONTHLY_CENTS = 12_500;
export const EXTRA_FC_SEAT_ANNUAL_CENTS = 125_000;

export const ATMOSPHERE_SELF_SERVE_PLANS: AtmosphereSelfServePlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    monthlyCents: 39_900,
    annualCents: 399_000,
    includedFcSeats: 1,
    recommended: false,
  },
  {
    code: 'work_verification',
    name: 'Work Verification',
    monthlyCents: 84_900,
    annualCents: 849_000,
    includedFcSeats: 3,
    recommended: true,
    defaultSelected: true,
  },
  {
    code: 'scale',
    name: 'Scale',
    monthlyCents: 199_900,
    annualCents: 1_999_000,
    includedFcSeats: 10,
    recommended: false,
  },
];

export function parseAtmospherePlanCode(
  value: string | null | undefined,
): AtmosphereSelfServePlan['code'] {
  if (value === 'starter' || value === 'scale' || value === 'work_verification') return value;
  return DEFAULT_ONBOARDING_PLAN_CODE;
}

export function parseAtmosphereBillingInterval(
  value: string | null | undefined,
): AtmosphereBillingInterval {
  if (value === 'year' || value === 'annual' || value === 'yearly') return 'year';
  return 'month';
}

export function planAnnualCents(plan: Pick<AtmosphereSelfServePlan, 'code' | 'annualCents' | 'monthlyCents'>): number {
  if (plan.annualCents && plan.annualCents > 0) return plan.annualCents;
  return plan.monthlyCents * 10;
}

/** One shared note under the plan cards. Monthly copy stays the default. */
export function planPickerFootnote(interval: AtmosphereBillingInterval): string {
  if (interval === 'year') {
    return (
      'Extra Field Capture seats are $1,250/yr each. Seats count Field Capture accounts only — ' +
      'office-only Global Admins do not use a seat. AI/token usage is billed the day it is used. ' +
      'The yearly prepay covers the plan and seats; the rate is locked for the term and the 10% increase applies at renewal (30-day notice). ' +
      'Annual plans are non-refundable and cancel at the end of the term.'
    );
  }
  return (
    'Extra Field Capture seats are $125/mo each. Seats count Field Capture accounts only — ' +
    'office-only Global Admins do not use a seat. AI/token usage is billed the day it is used. ' +
    'Prices increase 10% annually on your plan anniversary (30-day notice).'
  );
}

export function atmospherePlan(
  code?: string | null,
  catalog: AtmosphereSelfServePlan[] = ATMOSPHERE_SELF_SERVE_PLANS,
): AtmosphereSelfServePlan {
  const parsed = parseAtmospherePlanCode(code);
  return catalog.find((plan) => plan.code === parsed) ?? ATMOSPHERE_SELF_SERVE_PLANS[1]!;
}

/** Seat line on the plan picker — title-case, no "included". */
export function fieldCaptureSeatLabel(seats: number): string {
  return seats === 1 ? '1 Field Capture account' : `${seats} Field Capture accounts`;
}
