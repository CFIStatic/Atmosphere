import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_SELF_SERVE_PLANS,
  DEFAULT_ONBOARDING_PLAN_CODE,
  atmospherePlan,
  parseAtmospherePlanCode,
} from './atmospherePlans';

describe('atmosphere self-serve plans', () => {
  it('defaults checkout to Work Verification', () => {
    expect(DEFAULT_ONBOARDING_PLAN_CODE).toBe('work_verification');
    expect(parseAtmospherePlanCode(undefined)).toBe('work_verification');
    expect(parseAtmospherePlanCode('enterprise')).toBe('work_verification');
    expect(atmospherePlan(null).name).toBe('Work Verification');
  });

  it('maps Starter / Work Verification / Scale seats', () => {
    expect(ATMOSPHERE_SELF_SERVE_PLANS.map((plan) => plan.code)).toEqual([
      'starter',
      'work_verification',
      'scale',
    ]);
    expect(atmospherePlan('starter').includedFcSeats).toBe(1);
    expect(atmospherePlan('starter').monthlyCents).toBe(39900);
    expect(atmospherePlan('work_verification').includedFcSeats).toBe(3);
    expect(atmospherePlan('work_verification').monthlyCents).toBe(84900);
    expect(atmospherePlan('scale').includedFcSeats).toBe(10);
    expect(atmospherePlan('scale').monthlyCents).toBe(199900);
  });
});
