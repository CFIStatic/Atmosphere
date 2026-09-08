import type { AtmosphereSelfServePlan } from './api';

export const DEFAULT_ONBOARDING_PLAN_CODE = 'work_verification' as const;

export const ATMOSPHERE_SELF_SERVE_PLANS: AtmosphereSelfServePlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    monthlyCents: 39_900,
    includedFcSeats: 1,
    recommended: false,
  },
  {
    code: 'work_verification',
    name: 'Work Verification',
    monthlyCents: 84_900,
    includedFcSeats: 3,
    recommended: true,
    defaultSelected: true,
  },
  {
    code: 'scale',
    name: 'Scale',
    monthlyCents: 199_900,
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
