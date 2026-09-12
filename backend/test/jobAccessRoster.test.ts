import assert from 'node:assert/strict';
import test from 'node:test';
import { presentJobAccessRoster } from '../src/shared/jobAccessRoster.js';

const profiles = [
  { id: 'u-office', full_name: 'Alex Office', email: 'alex@contractor.com' },
  { id: 'u-home', full_name: 'Von Mour', email: 'von@example.com' },
];

test('presentJobAccessRoster — homeowner share with grantor and last open', () => {
  const people = presentJobAccessRoster({
    shares: [
      {
        id: 'share-1',
        label: 'von@example.com',
        recipient_email: 'von@example.com',
        created_by: 'u-office',
        created_at: '2026-09-01T12:00:00.000Z',
        expires_at: null,
        revoked_at: null,
        last_opened_at: '2026-09-10T15:00:00.000Z',
        open_count: 2,
        share_kind: 'progress',
      },
    ],
    parties: [],
    grants: [],
    profiles,
  });

  assert.equal(people.length, 1);
  assert.equal(people[0]?.kind, 'homeowner');
  assert.equal(people[0]?.email, 'von@example.com');
  assert.equal(people[0]?.accessType, 'Homeowner');
  assert.equal(people[0]?.grantedByName, 'Alex Office');
  assert.equal(people[0]?.grantedByEmail, 'alex@contractor.com');
  assert.equal(people[0]?.lastAccessedAt, '2026-09-10T15:00:00.000Z');
  assert.equal(people[0]?.state, 'live');
});

test('presentJobAccessRoster — claimed grant prefers grant last_accessed_at', () => {
  const people = presentJobAccessRoster({
    shares: [
      {
        id: 'share-1',
        label: 'von@example.com',
        recipient_email: 'von@example.com',
        created_by: 'u-office',
        created_at: '2026-09-01T12:00:00.000Z',
        expires_at: null,
        revoked_at: null,
        last_opened_at: '2026-09-08T00:00:00.000Z',
        open_count: 1,
        share_kind: 'progress',
      },
    ],
    parties: [],
    grants: [
      {
        id: 'grant-1',
        user_id: 'u-home',
        share_id: 'share-1',
        recipient_email: 'von@example.com',
        created_at: '2026-09-02T00:00:00.000Z',
        last_accessed_at: '2026-09-12T18:00:00.000Z',
      },
    ],
    profiles,
  });

  assert.equal(people.length, 1);
  assert.equal(people[0]?.state, 'claimed');
  assert.equal(people[0]?.lastAccessedAt, '2026-09-12T18:00:00.000Z');
});

test('presentJobAccessRoster — revoked share without grant is omitted', () => {
  const people = presentJobAccessRoster({
    shares: [
      {
        id: 'share-dead',
        label: 'gone@example.com',
        recipient_email: 'gone@example.com',
        created_by: 'u-office',
        created_at: '2026-09-01T12:00:00.000Z',
        expires_at: null,
        revoked_at: '2026-09-05T00:00:00.000Z',
        last_opened_at: null,
        open_count: 0,
        share_kind: 'progress',
      },
    ],
    parties: [],
    grants: [],
    profiles,
  });
  assert.equal(people.length, 0);
});

test('presentJobAccessRoster — field capture party with grantor and last seen', () => {
  const people = presentJobAccessRoster({
    shares: [],
    parties: [
      {
        id: 'party-1',
        company: 'Rivera Drywall',
        trade: 'drywall',
        contact_name: 'Sam Rivera',
        email: 'sam@rivera.test',
        role: 'subcontractor',
        created_by: 'u-office',
        created_at: '2026-09-03T00:00:00.000Z',
        invited_at: '2026-09-03T01:00:00.000Z',
        last_seen_at: '2026-09-11T09:00:00.000Z',
        revoked_at: null,
      },
    ],
    grants: [],
    profiles,
  });

  assert.equal(people.length, 1);
  assert.equal(people[0]?.kind, 'field_capture');
  assert.equal(people[0]?.name, 'Sam Rivera');
  assert.equal(people[0]?.accessType, 'drywall');
  assert.equal(people[0]?.grantedByName, 'Alex Office');
  assert.equal(people[0]?.lastAccessedAt, '2026-09-11T09:00:00.000Z');
});

test('presentJobAccessRoster — sorts by last access descending, never last', () => {
  const people = presentJobAccessRoster({
    shares: [
      {
        id: 'share-a',
        label: 'a@x.com',
        recipient_email: 'a@x.com',
        created_by: null,
        created_at: '2026-09-01T00:00:00.000Z',
        expires_at: null,
        revoked_at: null,
        last_opened_at: null,
        open_count: 0,
        share_kind: 'progress',
      },
    ],
    parties: [
      {
        id: 'party-b',
        company: 'Crew',
        trade: null,
        contact_name: null,
        email: 'b@x.com',
        role: 'subcontractor',
        created_by: null,
        created_at: '2026-09-01T00:00:00.000Z',
        invited_at: null,
        last_seen_at: '2026-09-12T00:00:00.000Z',
        revoked_at: null,
      },
    ],
    grants: [],
    profiles: [],
  });
  assert.equal(people[0]?.email, 'b@x.com');
  assert.equal(people[1]?.email, 'a@x.com');
  assert.equal(people[1]?.lastAccessedAt, null);
});

test('presentJobAccessRoster — ignores evidence shares', () => {
  const people = presentJobAccessRoster({
    shares: [
      {
        id: 'ev',
        label: 'adjuster',
        recipient_email: 'adj@x.com',
        created_by: 'u-office',
        created_at: '2026-09-01T00:00:00.000Z',
        expires_at: null,
        revoked_at: null,
        last_opened_at: null,
        open_count: 0,
        share_kind: 'evidence',
      },
    ],
    parties: [],
    grants: [],
    profiles,
  });
  assert.equal(people.length, 0);
});
