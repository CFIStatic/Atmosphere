import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertPartyOwnsVideo, partyVideoList } from '../src/shared/partyVideos.js';

const here = dirname(fileURLToPath(import.meta.url));
const party = { id: 'party-a', job_id: 'job-1' };

test("an invited sub's video list holds only the videos they recorded", () => {
  const rows = [
    { id: 'p1', party_id: 'party-a', job_id: 'job-1', work_date: '2026-10-10', phase: 'day', ai_summary: ' Set fans. ' },
    { id: 'p2', party_id: 'party-b', job_id: 'job-1', work_date: '2026-10-10', phase: 'day' },
    { id: 'p3', party_id: null, job_id: 'job-1', work_date: '2026-10-09', phase: 'day' },
    { id: 'p4', party_id: 'party-a', job_id: 'job-1', work_date: '2026-10-08', deleted_at: '2026-10-09' },
  ];
  const list = partyVideoList(rows, 'party-a');
  assert.deepEqual(list.map((v) => v.id), ['p1']);
  assert.equal(list[0]!.summary, 'Set fans.');
  assert.equal('storage_path' in list[0]!, false);
});

test("a sub cannot open another trade's or the office's clip", () => {
  assert.doesNotThrow(() => assertPartyOwnsVideo({ party_id: 'party-a', job_id: 'job-1' }, party));
  for (const proof of [
    null,
    { party_id: 'party-b', job_id: 'job-1' },
    { party_id: null, job_id: 'job-1' },
    { party_id: 'party-a', job_id: 'job-2' },
    { party_id: 'party-a', job_id: 'job-1', deleted_at: '2026-10-09' },
  ]) {
    assert.throws(() => assertPartyOwnsVideo(proof, party), /No such video/);
  }
});

test('the sub video routes filter by party and apply the guest media rules', () => {
  const src = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');
  const start = src.indexOf("jobShareActionPattern('/videos')");
  assert.ok(start > 0);
  const body = src.slice(start, start + 2600);
  assert.match(body, /listAllVisibleProofs\(admin, \{ partyId: party\.id \}\)/);
  assert.match(body, /assertPartyOwnsVideo\(proof, party\)/);
  assert.match(body, /assertGuestMayMintRawMedia/);
});
