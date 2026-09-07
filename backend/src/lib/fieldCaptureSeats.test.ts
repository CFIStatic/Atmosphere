import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedFcSeats,
  extraSeatsNeeded,
  INCLUDED_FC_SEATS,
  EXTRA_FC_SEAT_DESCRIPTION,
  WORK_VERIFICATION_DESCRIPTION,
  atmospherePlan,
  includedFcSeatsForPlan,
  parseAtmospherePlanCode,
  planDescription,
} from './stripeCatalog.js';
import {
  entitledFcSeatCounts,
  fcSeatLimitError,
  isFcSeatLimitDbError,
  isFieldCaptureSeat,
  isFieldCaptureSeatRole,
  isWorkVerificationEntitled,
  persistExtraFcSeats,
  summarizeFcSeats,
} from './fieldCaptureSeats.js';

describe('Work Verification catalog copy', () => {
  it('uses same-day usage wording and does not expose markup', () => {
    assert.match(WORK_VERIFICATION_DESCRIPTION, /AI\/token usage is billed the day it is used/);
    assert.match(WORK_VERIFICATION_DESCRIPTION, /Field Capture \+ Evidence Platform/);
    assert.doesNotMatch(WORK_VERIFICATION_DESCRIPTION, /10\s*[x×]/i);
    assert.doesNotMatch(WORK_VERIFICATION_DESCRIPTION, /provider cost/i);
    assert.match(EXTRA_FC_SEAT_DESCRIPTION, /beyond the seats included with your Atmosphere plan/);
    assert.doesNotMatch(EXTRA_FC_SEAT_DESCRIPTION, /beyond the 3 included/);
  });
});

describe('Field Capture seat allowance', () => {
  it('includes 3 seats on Work Verification and adds extra quantity', () => {
    assert.equal(INCLUDED_FC_SEATS, 3);
    assert.equal(allowedFcSeats(0), 3);
    assert.equal(allowedFcSeats(2), 5);
    assert.equal(allowedFcSeats(-1), 3);
    assert.equal(allowedFcSeats(1.8), 4);
  });

  it('resolves included seats from the org plan, not a hardcoded 3', () => {
    assert.equal(parseAtmospherePlanCode(undefined), 'work_verification');
    assert.equal(parseAtmospherePlanCode('starter'), 'starter');
    assert.equal(parseAtmospherePlanCode('SCALE'), 'scale');
    assert.equal(atmospherePlan('starter').includedFcSeats, 1);
    assert.equal(atmospherePlan('work_verification').includedFcSeats, 3);
    assert.equal(atmospherePlan('scale').includedFcSeats, 10);
    assert.equal(includedFcSeatsForPlan('starter'), 1);
    assert.equal(includedFcSeatsForPlan('scale', 10), 10);
    assert.equal(allowedFcSeats(0, 1), 1);
    assert.equal(allowedFcSeats(2, 1), 3);
    assert.equal(allowedFcSeats(0, 10), 10);
    assert.equal(extraSeatsNeeded(2, 0, 1), 1);
    assert.equal(extraSeatsNeeded(10, 0, 10), 0);
    assert.deepEqual(entitledFcSeatCounts(0, 'active', false, 1), { extra: 0, included: 1 });
    assert.deepEqual(entitledFcSeatCounts(1, 'active', false, 10), { extra: 1, included: 10 });
    assert.match(planDescription(atmospherePlan('starter')), /1 Field Capture account/);
    assert.doesNotMatch(planDescription(atmospherePlan('scale')), /10\s*[x×]/i);
    assert.equal(atmospherePlan('starter').knownPriceId, 'price_1UD7vi1b5twUY3LykzUsVQVr');
    assert.equal(atmospherePlan('scale').knownPriceId, 'price_1UD7vj1b5twUY3Ly1Q4uv4kS');
  });

  it('computes extra seats needed for a 4th Field Capture account', () => {
    assert.equal(extraSeatsNeeded(3, 0), 0);
    assert.equal(extraSeatsNeeded(4, 0), 1);
    assert.equal(extraSeatsNeeded(6, 1), 2);
    assert.equal(extraSeatsNeeded(5, 2), 0);
  });

  it('counts crew and employees as Field Capture seats, not Global Admins', () => {
    assert.equal(isFieldCaptureSeatRole('employee'), true);
    assert.equal(isFieldCaptureSeatRole('field_technician'), true);
    assert.equal(isFieldCaptureSeatRole('global_admin'), false);
    assert.equal(isFieldCaptureSeat({ role: 'global_admin', email: 'owner@office.example' }), false);
    assert.equal(
      isFieldCaptureSeat({
        role: 'global_admin',
        email: 'nick.smith.aaaa@field.atmosphere.app',
      }),
      true,
    );
    assert.equal(
      isFieldCaptureSeat({ role: 'employee', email: 'crew@office.example' }),
      true,
    );
    assert.equal(
      isFieldCaptureSeat({
        role: 'office_manager',
        usageIntents: ['field_work'],
      }),
      true,
    );
  });

  it('summarizes used / allowed remaining', () => {
    const seats = summarizeFcSeats(2, 0);
    assert.deepEqual(seats, {
      included: 3,
      extra: 0,
      allowed: 3,
      used: 2,
      remaining: 1,
    });
    assert.equal(summarizeFcSeats(4, 0).remaining, 0);
    assert.equal(summarizeFcSeats(4, 2).remaining, 1);
  });

  it('drops extra and included seats when Work Verification is canceled', () => {
    assert.equal(isWorkVerificationEntitled('active'), true);
    assert.equal(isWorkVerificationEntitled('past_due'), true);
    assert.equal(isWorkVerificationEntitled('comped'), true);
    assert.equal(isWorkVerificationEntitled('canceled'), false);
    assert.equal(isWorkVerificationEntitled(null), true);
    assert.deepEqual(entitledFcSeatCounts(2, 'active'), { extra: 2, included: 3 });
    assert.deepEqual(entitledFcSeatCounts(4, 'canceled'), { extra: 0, included: 0 });
    assert.deepEqual(entitledFcSeatCounts(2, 'incomplete', true), { extra: 2, included: 3 });
    assert.deepEqual(entitledFcSeatCounts(2, 'comped'), { extra: 2, included: 3 });
    assert.equal(summarizeFcSeats(1, 0, 0).allowed, 0);
    assert.equal(summarizeFcSeats(1, 0, 0).remaining, 0);
  });

  it('builds an upgrade-path error for the 4th account', () => {
    const err = fcSeatLimitError(3, 3);
    assert.equal(err.status, 402);
    assert.equal(err.code, 'fc_seat_limit');
    assert.match(err.message, /3 Field Capture accounts/);
    assert.match(err.message, /\$100/);
    const starter = fcSeatLimitError(1, 1, 1);
    assert.match(starter.message, /1 Field Capture account/);
  });

  it('recognizes the Postgres seat-limit trigger error', () => {
    assert.equal(isFcSeatLimitDbError({ message: 'fc_seat_limit', hint: 'fc_seat_limit' }), true);
    assert.equal(isFcSeatLimitDbError({ message: 'duplicate key' }), false);
  });

  it('refuses a silent extra-seat persist when no org_billing row is updated', async () => {
    const admin = {
      from() {
        return {
          update() {
            return this;
          },
          eq() {
            return this;
          },
          async select() {
            return { data: [], error: null };
          },
        };
      },
    };
    await assert.rejects(
      () => persistExtraFcSeats(admin as never, 'org-1', 1),
      /org_billing row was not updated/,
    );
  });
});
