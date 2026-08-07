import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeContact,
  displayContact,
  maskContact,
  mintCode,
  hashCode,
  checkCode,
  mintSessionToken,
  hashSessionToken,
  groupByGeneralContractor,
  dueToday,
  CODE_MAX_ATTEMPTS,
  type ClaimedJobRow,
} from '../src/verifier/subIdentity.js';

describe('normalizeContact', () => {
  it('collapses every way a phone number gets typed into one identity', () => {
    const forms = ['(512) 555-0134', '512-555-0134', '512.555.0134', '5125550134', '+1 512 555 0134', '15125550134'];
    const normalized = forms.map((f) => normalizeContact(f));
    for (const n of normalized) {
      assert.ok(n, 'every common form should normalize');
      assert.equal(n!.channel, 'sms');
      assert.equal(n!.address, '+15125550134');
    }
  });

  it('lowercases email so case is not a second account', () => {
    assert.deepEqual(normalizeContact('  Mike@Drywall.CO '), {
      channel: 'email',
      address: 'mike@drywall.co',
    });
  });

  it('refuses what it cannot send to rather than guessing', () => {
    for (const bad of ['', '   ', 'mike', 'mike@', '@drywall.co', 'mike@drywall', '555-0134', 'abc']) {
      assert.equal(normalizeContact(bad), null, `${JSON.stringify(bad)} should not normalize`);
    }
  });

  it('keeps an international number that arrived international', () => {
    assert.deepEqual(normalizeContact('+44 20 7946 0958'), {
      channel: 'sms',
      address: '+442079460958',
    });
  });

  it('does not invent a country code for a short bare number', () => {
    assert.equal(normalizeContact('79460958'), null);
  });

  it('displays a north american number the way it was typed', () => {
    const c = normalizeContact('5125550134')!;
    assert.equal(displayContact(c), '(512) 555-0134');
  });

  it('masks enough to recognise and not enough to harvest', () => {
    assert.equal(maskContact(normalizeContact('5125550134')!), '···0134');
    const masked = maskContact(normalizeContact('mike@drywall.co')!);
    assert.ok(masked.startsWith('m'), 'keeps the first letter');
    assert.ok(masked.endsWith('@drywall.co'), 'keeps the domain');
    assert.ok(!masked.includes('ike'), 'hides the rest of the local part');
  });
});

describe('codes', () => {
  const live = (over: Partial<{ code_hash: string; attempts: number; expires_at: string; consumed_at: string | null }> = {}) => ({
    code_hash: hashCode('123456'),
    attempts: 0,
    expires_at: new Date('2026-08-14T10:10:00Z').toISOString(),
    consumed_at: null as string | null,
    ...over,
  });
  const now = new Date('2026-08-14T10:00:00Z');

  it('mints six digits and keeps leading zeros', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = mintCode();
      assert.equal(code.length, 6);
      assert.match(code, /^\d{6}$/);
    }
  });

  it('accepts the right code', () => {
    assert.deepEqual(checkCode(live(), '123456', now), { ok: true });
  });

  it('tolerates the whitespace a phone keyboard adds', () => {
    assert.deepEqual(checkCode(live(), ' 123456 ', now), { ok: true });
  });

  it('rejects the wrong code without saying anything else', () => {
    assert.deepEqual(checkCode(live(), '999999', now), { ok: false, reason: 'wrong' });
  });

  it('reports a dead code as dead rather than as wrong', () => {
    // The distinction matters: "wrong" invites more guessing at something
    // that can never work again.
    const expired = live({ expires_at: new Date('2026-08-14T09:00:00Z').toISOString() });
    assert.deepEqual(checkCode(expired, '123456', now), { ok: false, reason: 'expired' });

    const consumed = live({ consumed_at: new Date('2026-08-14T09:30:00Z').toISOString() });
    assert.deepEqual(checkCode(consumed, '123456', now), { ok: false, reason: 'consumed' });
  });

  it('stops at the attempt cap even when the code is right', () => {
    const burned = live({ attempts: CODE_MAX_ATTEMPTS });
    assert.deepEqual(checkCode(burned, '123456', now), { ok: false, reason: 'exhausted' });
  });

  it('checks death before correctness so an expired right code never reads as valid', () => {
    const expiredAndRight = live({ expires_at: new Date('2026-08-14T09:00:00Z').toISOString() });
    const result = checkCode(expiredAndRight, '123456', now);
    assert.equal(result.ok, false);
  });

  it('hashes rather than stores, and session tokens differ every mint', () => {
    assert.notEqual(hashCode('123456'), '123456');
    assert.equal(hashCode('123456').length, 64);
    const a = mintSessionToken();
    const b = mintSessionToken();
    assert.notEqual(a, b);
    assert.equal(hashSessionToken(a).length, 64);
    assert.notEqual(hashSessionToken(a), a);
  });
});

describe('groupByGeneralContractor', () => {
  const row = (over: Partial<ClaimedJobRow>): ClaimedJobRow => ({
    partyId: 'p1',
    accessToken: 't1',
    orgId: 'org-a',
    orgName: 'Brightwater Restoration',
    jobId: 'j1',
    jobTitle: 'Anderson residence',
    jobNumber: 4471,
    address: '18 Larkspur Ln',
    scheduledStart: '2026-08-14T13:00:00Z',
    status: 'active',
    trade: 'drywall',
    revoked: false,
    ...over,
  });

  it('puts one sub\'s jobs under the general contractor who invited them', () => {
    const groups = groupByGeneralContractor([
      row({ partyId: 'p1', orgId: 'org-a', orgName: 'Brightwater', jobId: 'j1' }),
      row({ partyId: 'p2', orgId: 'org-b', orgName: 'Kestrel Builders', jobId: 'j2', scheduledStart: '2026-08-15T13:00:00Z' }),
      row({ partyId: 'p3', orgId: 'org-a', orgName: 'Brightwater', jobId: 'j3', scheduledStart: '2026-08-16T13:00:00Z' }),
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].orgName, 'Brightwater');
    assert.equal(groups[0].jobs.length, 2);
    assert.equal(groups[1].orgName, 'Kestrel Builders');
    assert.equal(groups[1].jobs.length, 1);
  });

  it('drops revoked invitations rather than showing an access that is gone', () => {
    const groups = groupByGeneralContractor([
      row({ partyId: 'p1', jobId: 'j1' }),
      row({ partyId: 'p2', jobId: 'j2', revoked: true }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].jobs.length, 1);
    assert.equal(groups[0].jobs[0].jobId, 'j1');
  });

  it('drops a general contractor entirely once their last link is withdrawn', () => {
    const groups = groupByGeneralContractor([
      row({ partyId: 'p1', orgId: 'org-a', jobId: 'j1' }),
      row({ partyId: 'p2', orgId: 'org-b', orgName: 'Kestrel', jobId: 'j2', revoked: true }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].orgId, 'org-a');
  });

  it('orders jobs by when the sub is due, unscheduled last', () => {
    const groups = groupByGeneralContractor([
      row({ partyId: 'p1', jobId: 'later', scheduledStart: '2026-08-20T13:00:00Z' }),
      row({ partyId: 'p2', jobId: 'never', scheduledStart: null }),
      row({ partyId: 'p3', jobId: 'sooner', scheduledStart: '2026-08-14T13:00:00Z' }),
    ]);
    assert.deepEqual(groups[0].jobs.map((j) => j.jobId), ['sooner', 'later', 'never']);
  });

  it('orders general contractors by whoever the sub is due at soonest', () => {
    const groups = groupByGeneralContractor([
      row({ partyId: 'p1', orgId: 'org-a', orgName: 'Later Co', jobId: 'j1', scheduledStart: '2026-08-20T13:00:00Z' }),
      row({ partyId: 'p2', orgId: 'org-b', orgName: 'Sooner Co', jobId: 'j2', scheduledStart: '2026-08-14T13:00:00Z' }),
    ]);
    assert.deepEqual(groups.map((g) => g.orgName), ['Sooner Co', 'Later Co']);
  });

  it('is stable across refreshes when nothing is scheduled', () => {
    const rows = [
      row({ partyId: 'p1', jobId: 'j1', jobTitle: 'Zeta', scheduledStart: null }),
      row({ partyId: 'p2', jobId: 'j2', jobTitle: 'Alpha', scheduledStart: null }),
    ];
    const first = groupByGeneralContractor(rows).map((g) => g.jobs.map((j) => j.jobTitle));
    const second = groupByGeneralContractor([...rows].reverse()).map((g) => g.jobs.map((j) => j.jobTitle));
    assert.deepEqual(first, second);
    assert.deepEqual(first[0], ['Alpha', 'Zeta']);
  });

  it('returns nothing for a sub who has claimed nothing', () => {
    assert.deepEqual(groupByGeneralContractor([]), []);
  });
});

describe('dueToday', () => {
  const row = (over: Partial<ClaimedJobRow>): ClaimedJobRow => ({
    partyId: 'p1',
    accessToken: 't1',
    orgId: 'org-a',
    orgName: 'Brightwater',
    jobId: 'j1',
    jobTitle: 'Anderson residence',
    jobNumber: 4471,
    address: '18 Larkspur Ln',
    scheduledStart: null,
    status: 'active',
    trade: 'drywall',
    revoked: false,
    ...over,
  });

  it('answers the 7am question across every general contractor at once', () => {
    const now = new Date('2026-08-14T12:00:00Z');
    const midday = new Date('2026-08-14T15:00:00Z').toISOString();
    const early = new Date('2026-08-14T11:00:00Z').toISOString();
    const tomorrow = new Date('2026-08-15T15:00:00Z').toISOString();

    const today = dueToday(
      [
        row({ partyId: 'p1', jobId: 'midday', orgId: 'org-a', scheduledStart: midday }),
        row({ partyId: 'p2', jobId: 'early', orgId: 'org-b', scheduledStart: early }),
        row({ partyId: 'p3', jobId: 'tomorrow', scheduledStart: tomorrow }),
        row({ partyId: 'p4', jobId: 'unscheduled', scheduledStart: null }),
      ],
      now,
    );

    assert.deepEqual(today.map((j) => j.jobId), ['early', 'midday']);
  });

  it('leaves out a job whose link was withdrawn this morning', () => {
    const now = new Date('2026-08-14T12:00:00Z');
    const today = dueToday(
      [row({ scheduledStart: new Date('2026-08-14T15:00:00Z').toISOString(), revoked: true })],
      now,
    );
    assert.deepEqual(today, []);
  });
});
