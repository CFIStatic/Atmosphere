import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_SELF_SERVE_PLANS,
  DEFAULT_ONBOARDING_PLAN_CODE,
  atmospherePlan,
  fieldCaptureSeatLabel,
  parseAtmosphereBillingInterval,
  parseAtmospherePlanCode,
  planAnnualCents,
  planPickerFootnote,
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
    expect(planAnnualCents(atmospherePlan('starter'))).toBe(399000);
    expect(planAnnualCents(atmospherePlan('work_verification'))).toBe(849000);
    expect(planAnnualCents(atmospherePlan('scale'))).toBe(1999000);
    expect(parseAtmosphereBillingInterval(undefined)).toBe('month');
    expect(parseAtmosphereBillingInterval('annual')).toBe('year');
    expect(planPickerFootnote('month')).toMatch(/\$125\/mo/);
    expect(planPickerFootnote('year')).toMatch(/\$1,250\/yr/);
    expect(planPickerFootnote('year')).toMatch(/non-refundable/);
    expect(planPickerFootnote('year')).toMatch(/billed the day it is used/);
  });

  it('formats Field Capture seat copy without included', () => {
    expect(fieldCaptureSeatLabel(1)).toBe('1 Field Capture account');
    expect(fieldCaptureSeatLabel(3)).toBe('3 Field Capture accounts');
    expect(fieldCaptureSeatLabel(10)).toBe('10 Field Capture accounts');
  });
});
