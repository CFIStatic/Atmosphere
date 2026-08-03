import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessJob,
  clearToWork,
  scopeForParty,
  scopeMoney,
  type Party,
  type ScopeItem,
} from '../src/shared/jobRecord.js';

/**
 * The shared job record.
 *
 * Everything here is a judgement somebody will eventually argue with — "you
 * never told us", "that was approved" — so the tests are written as the
 * arguments themselves.
 */

const NOW = new Date('2026-08-05T12:00:00Z');

const party = (over: Partial<Party> = {}): Party => ({
  id: 'p1',
  company: 'Delgado Framing',
  trade: 'framing',
  role: 'subcontractor',
  invited_at: '2026-08-01T09:00:00Z',
  last_seen_at: '2026-08-01T10:00:00Z',
  revoked_at: null,
  ...over,
});

const item = (over: Partial<ScopeItem> = {}): ScopeItem => ({
  id: 's1',
  state: 'included',
  title: 'Frame interior partitions, level 2',
  revision: 1,
  amount: null,
  reason: null,
  party_id: null,
  decided_at: null,
  created_at: '2026-08-01T09:00:00Z',
  ...over,
});

test('a sub working from a superseded scope is the loudest thing on the page', () => {
  const risks = assessJob({
    parties: [party()],
    scope: [item()],
    acknowledgements: [{ party_id: 'p1', revision: 2, acknowledged_at: '2026-08-02T09:00:00Z' }],
    currentRevision: 4,
    now: NOW,
  });

  const stale = risks.find((r) => r.key === 'stale:p1');
  assert.ok(stale, 'expected a stale-revision risk');
  assert.equal(stale.level, 'blocker');
  assert.match(stale.title, /accepted revision 2.*on 4/);
  // Blockers sort above everything else — this is the one that produces the
  // wall coming down.
  assert.equal(risks[0].level, 'blocker');
});

test('an invited party that never accepted blocks; one not yet invited only warns', () => {
  const invited = assessJob({
    parties: [party({ id: 'p1', invited_at: '2026-08-01T09:00:00Z' })],
    scope: [],
    acknowledgements: [],
    currentRevision: 1,
    now: NOW,
  });
  assert.equal(invited.find((r) => r.key === 'unacked:p1')?.level, 'blocker');

  const notYet = assessJob({
    parties: [party({ id: 'p1', invited_at: null, last_seen_at: null })],
    scope: [],
    acknowledgements: [],
    currentRevision: 1,
    now: NOW,
  });
  // Nobody has failed to do anything yet; the GC has simply not sent it.
  assert.equal(notYet.find((r) => r.key === 'unacked:p1')?.level, 'warn');
});

test('the general contractor is not asked to accept their own scope', () => {
  const risks = assessJob({
    parties: [party({ id: 'gc', company: 'Ortiz Restoration', role: 'general_contractor' })],
    scope: [],
    acknowledgements: [],
    currentRevision: 3,
    now: NOW,
  });
  assert.equal(risks.find((r) => r.key === 'unacked:gc'), undefined);
});

test('a question left a day becomes a blocker, because it gets decided on site', () => {
  const fresh = assessJob({
    parties: [party()],
    scope: [item({ id: 'q1', state: 'proposed', created_at: '2026-08-05T09:00:00Z' })],
    acknowledgements: [{ party_id: 'p1', revision: 1, acknowledged_at: '2026-08-01T09:00:00Z' }],
    currentRevision: 1,
    now: NOW,
  });
  assert.equal(fresh.find((r) => r.key === 'proposed:q1')?.level, 'warn');

  const stale = assessJob({
    parties: [party()],
    scope: [item({ id: 'q1', state: 'proposed', created_at: '2026-08-02T09:00:00Z' })],
    acknowledgements: [{ party_id: 'p1', revision: 1, acknowledged_at: '2026-08-01T09:00:00Z' }],
    currentRevision: 1,
    now: NOW,
  });
  const risk = stale.find((r) => r.key === 'proposed:q1');
  assert.equal(risk?.level, 'blocker');
  assert.match(risk!.action, /decided on site/);
});

test('an approved line with no number is flagged before the work, not after', () => {
  const risks = assessJob({
    parties: [party()],
    scope: [
      item({ id: 'a1', state: 'approved', amount: null, decided_at: '2026-08-03T09:00:00Z' }),
      item({ id: 'a2', state: 'approved', amount: 1800, decided_at: '2026-08-03T09:00:00Z' }),
    ],
    acknowledgements: [{ party_id: 'p1', revision: 1, acknowledged_at: '2026-08-01T09:00:00Z' }],
    currentRevision: 1,
    now: NOW,
  });
  assert.ok(risks.some((r) => r.key === 'unpriced:a1'));
  assert.ok(!risks.some((r) => r.key === 'unpriced:a2'));
});

test('an exclusion with no reason is called out, and a scope with no exclusions at all', () => {
  const bare = assessJob({
    parties: [party()],
    scope: [item({ id: 'x1', state: 'excluded', reason: null })],
    acknowledgements: [{ party_id: 'p1', revision: 1, acknowledged_at: '2026-08-01T09:00:00Z' }],
    currentRevision: 1,
    now: NOW,
  });
  assert.ok(bare.some((r) => r.key === 'bare-exclusion:x1'));
  // It has an exclusion, so it should not also be told it has none.
  assert.ok(!bare.some((r) => r.key === 'no-exclusions'));

  const none = assessJob({
    parties: [party()],
    scope: [item(), item({ id: 's2' })],
    acknowledgements: [{ party_id: 'p1', revision: 1, acknowledged_at: '2026-08-01T09:00:00Z' }],
    currentRevision: 1,
    now: NOW,
  });
  assert.ok(none.some((r) => r.key === 'no-exclusions'));
});

test('an invitation nobody opened is surfaced after two days', () => {
  const quiet = assessJob({
    parties: [party({ invited_at: '2026-08-04T09:00:00Z', last_seen_at: null })],
    scope: [],
    acknowledgements: [],
    currentRevision: 1,
    now: NOW,
  });
  assert.ok(!quiet.some((r) => r.key === 'never-opened:p1'), 'one day is not yet a problem');

  const cold = assessJob({
    parties: [party({ invited_at: '2026-08-01T09:00:00Z', last_seen_at: null })],
    scope: [],
    acknowledgements: [],
    currentRevision: 1,
    now: NOW,
  });
  const risk = cold.find((r) => r.key === 'never-opened:p1');
  assert.ok(risk);
  assert.match(risk!.action, /Assume they have not seen any of it/);
});

test('a revoked party is not chased about anything', () => {
  const risks = assessJob({
    parties: [party({ revoked_at: '2026-08-03T09:00:00Z', last_seen_at: null })],
    scope: [],
    acknowledgements: [],
    currentRevision: 2,
    now: NOW,
  });
  assert.equal(risks.filter((r) => r.partyId === 'p1').length, 0);
});

test('clear to work means accepted the current facts with nothing outstanding', () => {
  const scope = [item({ id: 'a', state: 'included' })];

  assert.deepEqual(
    clearToWork({ party: party(), scope, acknowledgedRevision: 3, currentRevision: 3 }),
    { clear: true, because: 'Accepted revision 3. Nothing outstanding.' },
  );

  assert.equal(
    clearToWork({ party: party(), scope, acknowledgedRevision: 2, currentRevision: 3 }).clear,
    false,
  );
  assert.equal(
    clearToWork({ party: party(), scope, acknowledgedRevision: null, currentRevision: 3 }).clear,
    false,
  );
  assert.equal(
    clearToWork({ party: party(), scope, acknowledgedRevision: 3, currentRevision: null }).clear,
    false,
  );
  assert.equal(
    clearToWork({
      party: party({ revoked_at: '2026-08-04T00:00:00Z' }),
      scope,
      acknowledgedRevision: 3,
      currentRevision: 3,
    }).clear,
    false,
  );
});

test('an unanswered question of their own stops them being clear', () => {
  const result = clearToWork({
    party: party(),
    scope: [item({ id: 'q', state: 'proposed', party_id: 'p1' })],
    acknowledgedRevision: 2,
    currentRevision: 2,
  });
  assert.equal(result.clear, false);
  assert.match(result.because, /1 item waiting/);
});

test("another party's unanswered question does not stop this one", () => {
  const result = clearToWork({
    party: party({ id: 'p1' }),
    scope: [item({ id: 'q', state: 'proposed', party_id: 'p2' })],
    acknowledgedRevision: 2,
    currentRevision: 2,
  });
  assert.equal(result.clear, true);
});

test('what not to do is listed before what to do', () => {
  const ordered = scopeForParty(
    [
      item({ id: 'inc', state: 'included', created_at: '2026-08-01T09:00:00Z' }),
      item({ id: 'app', state: 'approved', created_at: '2026-08-01T08:00:00Z' }),
      item({ id: 'exc', state: 'excluded', created_at: '2026-08-01T10:00:00Z' }),
      item({ id: 'pro', state: 'proposed', created_at: '2026-08-01T11:00:00Z' }),
    ],
    'p1',
  );
  // Somebody reading on a phone in a truck reads the top and starts working.
  assert.deepEqual(ordered.map((i) => i.id), ['exc', 'pro', 'inc', 'app']);
});

test("scope for a party excludes another party's lines but keeps the shared ones", () => {
  const ordered = scopeForParty(
    [
      item({ id: 'mine', party_id: 'p1' }),
      item({ id: 'theirs', party_id: 'p2' }),
      item({ id: 'everyone', party_id: null }),
    ],
    'p1',
  );
  assert.deepEqual(ordered.map((i) => i.id).sort(), ['everyone', 'mine']);
});

test('the money adds up only what has actually been authorised', () => {
  const money = scopeMoney([
    item({ id: '1', state: 'approved', amount: 1800 }),
    item({ id: '2', state: 'approved', amount: 450 }),
    item({ id: '3', state: 'approved', amount: null }),
    item({ id: '4', state: 'proposed', amount: 900 }),
    // Neither of these is money anybody owes.
    item({ id: '5', state: 'declined', amount: 5000 }),
    item({ id: '6', state: 'included', amount: 7000 }),
  ]);
  assert.equal(money.approved, 2250);
  assert.equal(money.pending, 900);
  assert.equal(money.unpricedApprovals, 1);
});
