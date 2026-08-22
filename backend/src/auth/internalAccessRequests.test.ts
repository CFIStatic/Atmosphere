import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapAccessRequest, sortAccessRequests, type AccessRequest } from './internalAccessRequests.js';

function request(partial: Partial<AccessRequest>): AccessRequest {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alex@company.com',
    firstName: 'Alex',
    lastName: 'Rivera',
    status: 'pending',
    requestedAt: '2026-08-22T10:00:00.000Z',
    lastRequestedAt: '2026-08-22T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    userId: null,
    ...partial,
  };
}

describe('access request mapping', () => {
  it('maps the service-role row into the admin payload', () => {
    const mapped = mapAccessRequest({
      id: '22222222-2222-4222-8222-222222222222',
      email: 'jordan@company.com',
      first_name: 'Jordan',
      last_name: 'Lee',
      status: 'pending',
      requested_at: '2026-08-21T09:00:00.000Z',
      last_requested_at: '2026-08-22T11:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
      user_id: null,
    });
    assert.equal(mapped.firstName, 'Jordan');
    assert.equal(mapped.lastName, 'Lee');
    assert.equal(mapped.lastRequestedAt, '2026-08-22T11:00:00.000Z');
    assert.equal(mapped.status, 'pending');
  });

  it('lists pending employees first, then newest', () => {
    const pendingOlder = request({
      id: 'a',
      email: 'old@company.com',
      status: 'pending',
      lastRequestedAt: '2026-08-20T00:00:00.000Z',
    });
    const pendingNewer = request({
      id: 'b',
      email: 'new@company.com',
      status: 'pending',
      lastRequestedAt: '2026-08-22T00:00:00.000Z',
    });
    const approved = request({
      id: 'c',
      email: 'done@company.com',
      status: 'approved',
      lastRequestedAt: '2026-08-23T00:00:00.000Z',
    });
    const denied = request({
      id: 'd',
      email: 'no@company.com',
      status: 'denied',
      lastRequestedAt: '2026-08-24T00:00:00.000Z',
    });
    assert.deepEqual(
      sortAccessRequests([denied, approved, pendingOlder, pendingNewer]).map((row) => row.id),
      ['b', 'a', 'c', 'd'],
    );
  });
});
