import test from 'node:test';
import assert from 'node:assert/strict';
import { pickUsageActor, resolveUsageActor } from '../src/metering/usageAttribution.js';

test('pickUsageActor prefers uploader, then party inviter, then job owner', () => {
  assert.equal(pickUsageActor({}), null);
  assert.equal(pickUsageActor({ jobCreatedBy: 'creator' }), 'creator');
  assert.equal(pickUsageActor({ jobOwnerId: 'owner', jobCreatedBy: 'creator' }), 'owner');
  assert.equal(
    pickUsageActor({
      partyCreatedBy: 'inviter',
      jobOwnerId: 'owner',
      jobCreatedBy: 'creator',
    }),
    'inviter',
  );
  assert.equal(
    pickUsageActor({
      uploaderId: 'uploader',
      partyCreatedBy: 'inviter',
      jobOwnerId: 'owner',
    }),
    'uploader',
  );
  assert.equal(
    pickUsageActor({
      userId: 'signed-in',
      uploaderId: 'uploader',
    }),
    'signed-in',
  );
});

function tableClient(tables: Record<string, Record<string, unknown> | null>) {
  return {
    from(table: string) {
      const row = tables[table] ?? null;
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return api;
    },
  };
}

test('resolveUsageActor uses the video uploader when present', async () => {
  const userId = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: 'jack', party_id: 'party-1', job_id: 'job-1' },
      job_parties: { created_by: 'inviter' },
      crm_jobs: { owner_id: 'owner', created_by: 'creator' },
    }),
    { orgId: 'org-1', videoId: 'vid-1' },
  );
  assert.equal(userId, 'jack');
});

test('resolveUsageActor falls back to the party inviter, then the job owner', async () => {
  const fromParty = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: null, party_id: 'party-1', job_id: 'job-1' },
      job_parties: { created_by: 'inviter' },
      crm_jobs: { owner_id: 'owner', created_by: 'creator' },
    }),
    { orgId: 'org-1', videoId: 'vid-1', jobId: 'job-1', partyId: 'party-1' },
  );
  assert.equal(fromParty, 'inviter');

  const fromJob = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: null, party_id: null, job_id: 'job-1' },
      job_parties: null,
      crm_jobs: { owner_id: 'owner', created_by: 'creator' },
    }),
    { orgId: 'org-1', jobId: 'job-1' },
  );
  assert.equal(fromJob, 'owner');
});

test('resolveUsageActor stays null when no uploader, party, or job owner exists', async () => {
  const userId = await resolveUsageActor(
    tableClient({
      verification_videos: { uploader_id: null, party_id: null, job_id: null },
      job_parties: null,
      crm_jobs: { owner_id: null, created_by: null },
    }),
    { orgId: 'org-1', videoId: 'vid-1' },
  );
  assert.equal(userId, null);
});

test('resolveUsageActor never throws when a lookup fails', async () => {
  const userId = await resolveUsageActor(
    {
      from() {
        throw new Error('db down');
      },
    },
    { orgId: 'org-1', videoId: 'vid-1', jobId: 'job-1' },
  );
  assert.equal(userId, null);
});
