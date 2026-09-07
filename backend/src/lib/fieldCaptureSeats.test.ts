import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedFcSeats,
  extraSeatsNeeded,
  INCLUDED_FC_SEATS,
} from './stripeCatalog.js';
import {
  entitledFcSeatCounts,
  fcSeatLimitError,
  isFieldCaptureSeat,
  isFieldCaptureSeatRole,
  isWorkVerificationEntitled,
  persistExtraFcSeats,
  summarizeFcSeats,
} from './fieldCaptureSeats.js';

describe('Field Capture seat allowance', () => {
  it('includes 3 seats on Work Verification and adds extra quantity', () => {
    assert.equal(INCLUDED_FC_SEATS, 3);
    assert.equal(allowedFcSeats(0), 3);
    assert.equal(allowedFcSeats(2), 5);
    assert.equal(allowedFcSeats(-1), 3);
    assert.equal(allowedFcSeats(1.8), 4);
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
    assert.equal(isWorkVerificationEntitled('canceled'), false);
    assert.equal(isWorkVerificationEntitled(null), true);
    assert.deepEqual(entitledFcSeatCounts(2, 'active'), { extra: 2, included: 3 });
    assert.deepEqual(entitledFcSeatCounts(4, 'canceled'), { extra: 0, included: 0 });
    assert.equal(summarizeFcSeats(1, 0, 0).allowed, 0);
    assert.equal(summarizeFcSeats(1, 0, 0).remaining, 0);
  });

  it('builds an upgrade-path error for the 4th account', () => {
    const err = fcSeatLimitError(3, 3);
    assert.equal(err.status, 402);
    assert.equal(err.code, 'fc_seat_limit');
    assert.match(err.message, /3 Field Capture accounts/);
    assert.match(err.message, /\$100/);
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
