import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  expiredLeaseFilter,
  leaseIsHeld,
  leaseOwnerId,
  leaseUntilIso,
  VERIFICATION_LEASE_MS,
} from './lease.js';

describe('verification lease helpers', () => {
  it('prefers Railway replica id, then hostname, then pid', () => {
    assert.equal(leaseOwnerId({ RAILWAY_REPLICA_ID: 'rep-9' }), 'rep-9');
    assert.equal(leaseOwnerId({ HOSTNAME: 'box-1' }), 'box-1');
    assert.match(leaseOwnerId({}), /^pid-/);
  });

  it('builds an expired-lease PostgREST filter', () => {
    const iso = '2026-09-05T17:00:00.000Z';
    assert.equal(expiredLeaseFilter(iso), `lease_until.is.null,lease_until.lt.${iso}`);
    assert.equal(
      expiredLeaseFilter(iso, 'narration_lease_until'),
      `narration_lease_until.is.null,narration_lease_until.lt.${iso}`,
    );
  });

  it('treats a future lease_until as held', () => {
    assert.equal(leaseIsHeld(null), false);
    assert.equal(leaseIsHeld(new Date(Date.now() + 60_000).toISOString()), true);
    assert.equal(leaseIsHeld(new Date(Date.now() - 1_000).toISOString()), false);
  });

  it('stamps lease_until in the future', () => {
    const until = Date.parse(leaseUntilIso(1_000_000, VERIFICATION_LEASE_MS));
    assert.equal(until, 1_000_000 + VERIFICATION_LEASE_MS);
  });
});
