import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteDigest, formatSiteDigestForContractor } from '../src/shared/siteDigest.js';

test('item 13: digest lists work done, missing work, and safety flags from video', () => {
  const digest = buildSiteDigest({
    jobTitle: 'Cedar Ridge roof',
    claimNumber: 'CLM-1',
    address: '1842 Cedar Ridge Dr',
    workDate: '2026-09-12',
    clips: [
      {
        workDate: '2026-09-12',
        summary: 'Crew removing damaged shingles on the south elevation.',
        concerns: ['Open hole on the north eaves without fall protection'],
        transcript: 'Speaker 1: That edge is unsafe until we set the harness line.',
      },
    ],
    scope: [{ title: 'Install ridge cap', status: 'pending' }],
  });
  assert.match(digest.headline, /Cedar Ridge roof/);
  assert.ok(digest.done.some((d) => /shingles/i.test(d)));
  assert.ok(digest.flags.some((f) => f.kind === 'safety' && /fall protection|unsafe/i.test(f.text)));
  assert.ok(digest.flags.some((f) => f.kind === 'missing_work' && /ridge cap/i.test(f.text)));
  assert.equal(digest.homeownerDraft.requiresApprove, true);
  assert.match(digest.homeownerDraft.subject, /Cedar Ridge roof/);
  const contractor = formatSiteDigestForContractor(digest);
  assert.match(contractor, /Safety flags from video/);
  assert.match(contractor, /Approve/);
  // Homeowner body stays calm — no raw "unsafe" dump required
  assert.doesNotMatch(digest.homeownerDraft.body, /Open hole on the north eaves without fall protection/);
});

test('item 13: empty day still produces Approve-gated draft', () => {
  const digest = buildSiteDigest({ jobTitle: 'Sample Job', clips: [] });
  assert.equal(digest.homeownerDraft.requiresApprove, true);
  assert.match(digest.homeownerDraft.body, /do not have new field video/i);
});
