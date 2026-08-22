import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { classifyRequest } from '../src/legal/classify.js';
import {
  canPurgeBytes,
  createLegalHold,
  getLegalHold,
  listLegalHolds,
  listUserActivity,
  produceHold,
  recordUserAction,
  releaseLegalHold,
  resetLegalStoreForTests,
  vaultFromMediaObject,
  markSourceDeleted,
} from '../src/legal/index.js';
import {
  beginMediaUpload,
  completeMediaUpload,
  listMediaForOrg,
  resetMediaCatalogForTests,
  softDeleteMedia,
  getMedia,
} from '../src/media/catalog.js';
import { MemoryMediaStorage } from '../src/media/driver.js';
import { HttpError } from '../src/lib/errors.js';
import { preparePayload } from '../src/lib/auditLog.js';

process.env.LEGAL_STORE = 'memory';
process.env.MEDIA_STORE = 'memory';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

function fakeReq(method: string, path: string) {
  return { method, path, url: path } as any;
}

test('classifyRequest skips probes and heartbeats', () => {
  assert.equal(classifyRequest(fakeReq('GET', '/api/health')).skip, true);
  assert.equal(classifyRequest(fakeReq('POST', '/api/telemetry/feature')).skip, true);
  assert.equal(classifyRequest(fakeReq('OPTIONS', '/api/jobs')).skip, true);
});

test('classifyRequest names video delete and upload', () => {
  const deleted = classifyRequest(
    fakeReq('DELETE', `/api/media/catalog/objects/${ORG}`),
  );
  assert.equal(deleted.skip, false);
  assert.equal(deleted.action, 'video.deleted');
  assert.equal(deleted.resourceId, ORG);

  const uploaded = classifyRequest(fakeReq('POST', '/api/media/catalog/uploads/complete'));
  assert.equal(uploaded.action, 'video.uploaded');
});

test('user delete hides the catalog object and the vault keeps it', async () => {
  resetLegalStoreForTests();
  resetMediaCatalogForTests();

  const { media, session } = await beginMediaUpload({
    orgId: ORG,
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: 60,
    byteSize: 1_000,
    driver: new MemoryMediaStorage(),
  });
  const ready = await completeMediaUpload({
    orgId: ORG,
    sessionId: session.id,
    byteSize: 1_000,
    contentHash: 'abc123456789',
  });
  assert.equal(ready.state, 'ready');

  const vaulted = await vaultFromMediaObject(ready, { jobId: JOB, actorUserId: USER });
  assert.equal(vaulted.sourceId, media.id);
  assert.equal(vaulted.userDeletedAt, null);
  assert.equal(canPurgeBytes(vaulted, false), false);

  const deleted = await softDeleteMedia(media.id, ORG, USER);
  assert.equal(deleted.state, 'deleted');
  assert.ok(deleted.deletedAt);

  const hidden = listMediaForOrg(ORG);
  assert.equal(hidden.length, 0);

  const stillThere = await getMedia(media.id);
  assert.equal(stillThere?.state, 'deleted');
  assert.equal(stillThere?.objectKey, ready.objectKey);

  const stamped = await markSourceDeleted('media_object', media.id);
  assert.ok(stamped?.userDeletedAt);
  assert.equal(stamped?.storageKey, ready.objectKey);
});

test('an open subpoena hold still produces a user-deleted video', async () => {
  resetLegalStoreForTests();
  resetMediaCatalogForTests();

  const { session } = await beginMediaUpload({
    orgId: ORG,
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: 90,
    byteSize: 2_000,
    driver: new MemoryMediaStorage(),
  });
  const ready = await completeMediaUpload({
    orgId: ORG,
    sessionId: session.id,
    byteSize: 2_000,
    contentHash: 'def123456789',
  });
  await vaultFromMediaObject(ready, { jobId: JOB, actorUserId: USER });
  await softDeleteMedia(ready.id, ORG, USER);
  await markSourceDeleted('media_object', ready.id);

  const hold = await createLegalHold({
    caseNumber: 'SDNY-2026-0412',
    kind: 'subpoena',
    title: 'Produce field video',
    reason: 'Subpoena duces tecum for the 14 Aug drywall day.',
    createdBy: USER,
    subjects: [{ subjectType: 'org', subjectId: ORG }],
  });
  assert.equal(hold.status, 'open');
  assert.equal((await listLegalHolds()).length, 1);

  const pack = await produceHold({ holdId: hold.id, requestedBy: USER, note: 'Counsel request' });
  assert.equal(pack.videos.length, 1);
  assert.equal(pack.videos[0].userDeleted, true);
  assert.equal(pack.videos[0].sourceId, ready.id);
  assert.ok(pack.videos[0].downloadUrl);
  assert.equal(pack.production.itemCount, 1);

  await assert.rejects(
    () => createLegalHold({
      caseNumber: 'sdny-2026-0412',
      kind: 'lawsuit',
      title: 'Duplicate',
      reason: 'Same case number',
      subjects: [{ subjectType: 'org', subjectId: ORG }],
    }),
    (e: unknown) => e instanceof HttpError && e.code === 'case_number_in_use',
  );

  const released = await releaseLegalHold(hold.id, { releasedBy: USER, reason: 'Matter settled' });
  assert.equal(released.status, 'released');
  assert.equal((await getLegalHold(hold.id)).status, 'released');
});

test('user monitor records actions and redacts secrets', async () => {
  resetLegalStoreForTests();

  const event = await recordUserAction({
    actorUserId: USER,
    actorEmail: 'crew@example.com',
    actorLabel: 'Crew',
    orgId: ORG,
    action: 'video.deleted',
    resourceType: 'proof',
    resourceId: JOB,
    detail: { password: 'hunter2', storagePath: 'org/job/day.mp4' },
  });
  assert.ok(event);
  assert.equal(event!.action, 'video.deleted');
  assert.equal(event!.detail.password, '[redacted]');
  assert.equal(event!.detail.storagePath, 'org/job/day.mp4');

  const cleaned = preparePayload({ token: 'abc', note: 'viewed' });
  assert.equal((cleaned as any).token, '[redacted]');

  const trail = await listUserActivity({ actorUserId: USER });
  assert.equal(trail.length, 1);
  assert.equal(trail[0].actorEmail, 'crew@example.com');
});

test('a hold must name a subject and a release must name a reason', async () => {
  resetLegalStoreForTests();
  await assert.rejects(
    () =>
      createLegalHold({
        caseNumber: 'X-1',
        kind: 'preservation',
        title: 'Hold',
        reason: 'Why',
        subjects: [],
      }),
    (e: unknown) => e instanceof HttpError && e.code === 'subjects_required',
  );

  const hold = await createLegalHold({
    caseNumber: 'X-2',
    kind: 'lawsuit',
    title: 'Hold',
    reason: 'Complaint filed',
    subjects: [{ subjectType: 'user', subjectId: USER }],
  });
  await assert.rejects(
    () => releaseLegalHold(hold.id, { reason: '   ' }),
    (e: unknown) => e instanceof HttpError && e.code === 'reason_required',
  );
});

test('GET /api/legal/holds is 401 without a session', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/legal/holds`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'unauthorized');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
