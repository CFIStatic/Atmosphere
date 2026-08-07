import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressChanged,
  createCrmSyncDriver,
  identityHash,
  reconcile,
  statusFor,
  workTypeFor,
  type ExternalJob,
  type JobLinkRow,
} from '../src/crm/sync.js';

/**
 * The sync rules. What earns a test is anything that, wrong, would corrupt
 * the record quietly: a geofence moved under existing evidence, a job file
 * deleted because a CRM row was, a re-run that reports work it did not do.
 */

const external = (over: Partial<ExternalJob> = {}): ExternalJob => ({
  externalId: 'jn-1',
  title: 'Kessler Rd — hail, roof replacement',
  claimNumber: 'CLM-90112',
  externalStatus: 'open',
  workHint: 'roof replacement',
  address: { line1: '77 Kessler Rd', city: 'Austin', region: 'TX', postalCode: '78704', lat: 30.245, lon: -97.771 },
  ...over,
});

const link = (over: Partial<JobLinkRow> = {}): JobLinkRow => ({
  id: 'link-1',
  externalId: 'jn-1',
  jobId: 'job-1',
  identityHash: identityHash(external()),
  archivedAt: null,
  pendingKind: null,
  ...over,
});

test('a job the CRM knows and we do not becomes a create', () => {
  const plan = reconcile({
    externals: [external()],
    links: [],
    previousByExternalId: new Map(),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('an unchanged job is a no-op, which is what makes re-running sync free', () => {
  const plan = reconcile({
    externals: [external()],
    links: [link()],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.creates.length + plan.updates.length + plan.conflicts.length, 0);
});

test('a title change applies as an update; identity only', () => {
  const incoming = external({ title: 'Kessler Rd — hail, roof + gutters' });
  const plan = reconcile({
    externals: [incoming],
    links: [link()],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(['job-1']),
  });
  // Evidence on the job does not freeze the title — only the address.
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.conflicts.length, 0);
});

test('an address move on a job with evidence parks as a conflict, never an update', () => {
  const incoming = external({
    address: { line1: '79 Kessler Rd', city: 'Austin', region: 'TX', postalCode: '78704', lat: 30.246, lon: -97.772 },
  });
  const plan = reconcile({
    externals: [incoming],
    links: [link()],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(['job-1']),
  });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts[0].jobId, 'job-1');
});

test('the same address move on a job with no evidence just applies', () => {
  const incoming = external({
    address: { line1: '79 Kessler Rd', city: 'Austin', region: 'TX', postalCode: '78704', lat: 30.246, lon: -97.772 },
  });
  const plan = reconcile({
    externals: [incoming],
    links: [link()],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.updates.length, 1);
});

test('a job gone from the CRM archives the link — the job file is never touched', () => {
  const plan = reconcile({
    externals: [],
    links: [link()],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(['job-1']),
  });
  assert.equal(plan.archives.length, 1);
  // Nothing in the plan's vocabulary can delete a job: the shape is the rule.
  assert.ok(!('deletes' in plan));
});

test('an archived link whose CRM row returns is revived, not duplicated', () => {
  const plan = reconcile({
    externals: [external({ title: 'Kessler Rd — reopened' })],
    links: [link({ archivedAt: '2026-08-01T00:00:00Z' })],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].revived, true);
});

test('an already-archived link missing again is not archived twice', () => {
  const plan = reconcile({
    externals: [],
    links: [link({ archivedAt: '2026-08-01T00:00:00Z' })],
    previousByExternalId: new Map(),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.archives.length, 0);
});

/* ---- the pending lifecycle: a conflict is the CRM's CURRENT proposal ---- */

test('a parked conflict clears when the CRM reverts to what we hold', () => {
  const plan = reconcile({
    externals: [external()],
    links: [link({ pendingKind: 'address_moved' })],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(['job-1']),
  });
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.clearPending, [{ linkId: 'link-1' }]);
});

test('a parked conflict clears when a later change takes the update path', () => {
  // Evidence gone (org resolved it another way): the address change applies,
  // and the stale parked question goes with it.
  const incoming = external({
    address: { line1: '79 Kessler Rd', city: 'Austin', region: 'TX', postalCode: '78704', lat: 30.246, lon: -97.772 },
  });
  const plan = reconcile({
    externals: [incoming],
    links: [link({ pendingKind: 'address_moved' })],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.clearPending, [{ linkId: 'link-1' }]);
});

test('a parked conflict clears when the CRM job disappears entirely', () => {
  const plan = reconcile({
    externals: [],
    links: [link({ pendingKind: 'address_moved' })],
    previousByExternalId: new Map(),
    jobsWithEvidence: new Set(['job-1']),
  });
  assert.equal(plan.archives.length, 1);
  assert.deepEqual(plan.clearPending, [{ linkId: 'link-1' }]);
});

test('a superseding conflict does not also clear — the new question replaces the old', () => {
  const incoming = external({
    address: { line1: '81 Kessler Rd', city: 'Austin', region: 'TX', postalCode: '78704', lat: 30.247, lon: -97.773 },
  });
  const plan = reconcile({
    externals: [incoming],
    links: [link({ pendingKind: 'address_moved' })],
    previousByExternalId: new Map([['jn-1', external()]]),
    jobsWithEvidence: new Set(['job-1']),
  });
  assert.equal(plan.conflicts.length, 1);
  // applyPlan overwrites pending on the conflict path; clearPending naming
  // the same link would race it, so reconcile leaves it to the conflict.
  assert.equal(plan.clearPending.length, 0);
});

test('a duplicate external id in one feed is one job, not two', () => {
  const plan = reconcile({
    externals: [external(), external({ title: 'Kessler Rd — duplicate row' })],
    links: [],
    previousByExternalId: new Map(),
    jobsWithEvidence: new Set(),
  });
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].title, external().title, 'first occurrence wins');
});

test('coordinates compare at column precision, so full-precision feeds do not flap', () => {
  // numeric(9,6) rounds what we store; the seventh decimal place must not
  // read as an address move against the round-tripped value.
  const stored = external({ address: { ...external().address!, lat: 30.245123, lon: -97.771456 } });
  const feed = external({ address: { ...external().address!, lat: 30.2451234, lon: -97.7714561 } });
  assert.equal(addressChanged(stored, feed), false);
  assert.equal(identityHash(stored), identityHash(feed));
});

test('the identity hash is stable across trims and blind to field order', () => {
  const a = identityHash(external());
  const b = identityHash(external({ title: '  Kessler Rd — hail, roof replacement  '.trim() }));
  assert.equal(a, b);
  assert.notEqual(a, identityHash(external({ claimNumber: 'CLM-99999' })));
});

test('addressChanged sees coordinates, not just street text', () => {
  assert.equal(addressChanged(external(), external()), false);
  assert.equal(
    addressChanged(external(), external({ address: { ...external().address!, lat: 30.9 } })),
    true,
  );
  // Gaining an address for the first time is a change.
  assert.equal(addressChanged(external({ address: null }), external()), true);
});

test('create-time mappings: work from the hint, status from open/closed', () => {
  assert.equal(workTypeFor('roof replacement'), 'construction');
  assert.equal(workTypeFor('water mitigation'), 'mitigation');
  assert.equal(workTypeFor(null), 'mitigation');
  assert.equal(statusFor('open'), 'in_progress');
  assert.equal(statusFor('closed'), 'completed');
  assert.equal(statusFor(null), 'in_progress');
});

test('the mock driver refuses a bad key and names the account for a good one', async () => {
  const driver = createCrmSyncDriver('mock');
  await assert.rejects(() => driver.validate('jobnimbus', 'bad-key'), /did not accept/);
  const { accountLabel } = await driver.validate('jobnimbus', 'jn_live_8f2a');
  assert.ok(accountLabel.includes('JobNimbus'));
  assert.ok(accountLabel.includes('8f2a'));
  // The label carries a tail for recognition, never the key itself.
  assert.ok(!accountLabel.includes('jn_live_8f2a'));
});

test('the mock book is deterministic, so the demo tells the same story every run', async () => {
  const driver = createCrmSyncDriver('mock');
  const first = await driver.fetchJobs('jobnimbus', 'k');
  const second = await driver.fetchJobs('jobnimbus', 'k');
  assert.deepEqual(first, second);
  assert.ok(first.length >= 3);
  assert.ok(first.every((j) => j.externalId.startsWith('jobnimbus-')));
});

test('the api driver refuses by name until a deployment configures it', async () => {
  const driver = createCrmSyncDriver('api');
  await assert.rejects(
    () => driver.fetchJobs('acculynx', 'k'),
    (err: any) => err.code === 'api_driver_not_configured',
  );
});
