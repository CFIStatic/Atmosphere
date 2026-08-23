import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { classifyRequest } from '../src/legal/classify.js';
import {
  buildStaffJobLegalPortal,
  evaluateAutoHolds,
  runAutoHoldSweep,
  unreviewedAutoHolds,
  canPurgeBytes,
  createLegalHold,
  getLegalHold,
  listLegalHolds,
  listUserActivity,
  openJobLegalHold,
  produceHold,
  recordUserAction,
  releaseJobLegalHold,
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

test('classifyRequest names asking a clip in the evidence portal', () => {
  const orgAsk = classifyRequest(
    fakeReq('POST', `/api/evidence-portal/evidence/${ORG}/ask`),
  );
  assert.equal(orgAsk.action, 'evidence.asked');
  assert.equal(orgAsk.resourceType, 'proof');
  assert.equal(orgAsk.resourceId, ORG);

  const shareAsk = classifyRequest(
    fakeReq('POST', `/api/verifier-share/share-token/evidence/${ORG}/ask`),
  );
  assert.equal(shareAsk.action, 'evidence.asked');
  assert.equal(shareAsk.resourceId, ORG);
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

test('a job legal hold freezes the job and still lists a deleted clip for staff', async () => {
  resetLegalStoreForTests();
  resetMediaCatalogForTests();

  const { session } = await beginMediaUpload({
    orgId: ORG,
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: 45,
    byteSize: 800,
    driver: new MemoryMediaStorage(),
  });
  const ready = await completeMediaUpload({
    orgId: ORG,
    sessionId: session.id,
    byteSize: 800,
    contentHash: 'jobhold123456',
  });
  await vaultFromMediaObject(ready, { jobId: JOB, actorUserId: USER });
  await softDeleteMedia(ready.id, ORG, USER);
  await markSourceDeleted('media_object', ready.id);

  const hold = await openJobLegalHold({
    orgId: ORG,
    jobId: JOB,
    jobTitle: '14 Aug drywall',
    kind: 'lawsuit',
    reason: 'Complaint filed — preserve the job file.',
    createdBy: USER,
  });
  assert.equal(hold.subjects[0].subjectType, 'job');
  assert.equal(hold.subjects[0].subjectId, JOB);

  const staff = await buildStaffJobLegalPortal({ orgId: ORG, jobId: JOB, jobTitle: '14 Aug drywall' });
  assert.equal(staff.counts.jobOnHold, true);
  assert.equal(staff.hold?.id, hold.id);
  assert.equal(staff.counts.userDeleted, 1);
  assert.equal(staff.videos[0].sourceId, ready.id);

  await assert.rejects(
    () =>
      openJobLegalHold({
        orgId: ORG,
        jobId: JOB,
        kind: 'subpoena',
        reason: 'Second hold',
      }),
    (e: unknown) => e instanceof HttpError && e.code === 'job_already_on_hold',
  );

  const released = await releaseJobLegalHold(JOB, { releasedBy: USER, reason: 'Settled' });
  assert.equal(released.status, 'released');
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

// ---------------------------------------------------------------------------
// Automatic preservation holds
// ---------------------------------------------------------------------------

const AUTO_JOB = '44444444-4444-4444-8444-444444444444';
const PROOF = '55555555-5555-4555-8555-555555555555';

function ago(days: number, hours = 0): string {
  return new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();
}

test('the customer-facing legal-hold routes are gone from the monitor map', () => {
  // They used to be named actions. Now nothing routes there at all, so they
  // fall through to the generic bucket rather than pretending to exist.
  const opened = classifyRequest(fakeReq('POST', `/api/operations/shared/${AUTO_JOB}/legal-hold`));
  assert.equal(opened.action, 'http.post');
  const held = classifyRequest(
    fakeReq('POST', `/api/operations/shared/${AUTO_JOB}/evidence/${PROOF}/hold`),
  );
  assert.equal(held.action, 'http.post');
});

test('deleting video after an outside party read the file fires a preservation rule', async () => {
  resetLegalStoreForTests();

  await recordUserAction({
    orgId: ORG,
    action: 'evidence.asked',
    resourceType: 'proof',
    resourceId: PROOF,
    detail: { jobId: AUTO_JOB },
    occurredAt: ago(6),
  });
  await recordUserAction({
    actorUserId: USER,
    orgId: ORG,
    action: 'video.deleted',
    resourceType: 'proof',
    resourceId: PROOF,
    detail: { jobId: AUTO_JOB },
    occurredAt: ago(2),
  });

  const signals = await evaluateAutoHolds({});
  const signal = signals.find((row) => row.jobId === AUTO_JOB);
  assert.ok(signal, 'expected a signal on the job');
  assert.equal(signal.rule, 'delete_after_outside_review');
  assert.equal(signal.kind, 'preservation');
  assert.equal(signal.heldBy, null);
  assert.ok(signal.evidence.length >= 2);
});

test('a sweep freezes what fired, marks it automatic, and is idempotent', async () => {
  resetLegalStoreForTests();

  await recordUserAction({
    orgId: ORG,
    action: 'evidence.library_viewed',
    resourceType: 'library',
    resourceId: null,
    detail: { jobId: AUTO_JOB },
    occurredAt: ago(4),
  });
  await recordUserAction({
    actorUserId: USER,
    orgId: ORG,
    action: 'video.deleted',
    resourceType: 'proof',
    resourceId: PROOF,
    detail: { jobId: AUTO_JOB },
    occurredAt: ago(1),
  });

  const first = await runAutoHoldSweep({ apply: true });
  assert.equal(first.opened.length, 1);
  const hold = first.opened[0];
  assert.equal(hold.origin, 'automatic');
  assert.equal(hold.autoRule, 'delete_after_outside_review');
  assert.equal(hold.createdBy, null);
  assert.ok(hold.reviewBy, 'an automatic hold carries a review date');
  assert.ok(hold.caseNumber.startsWith('AUTO-'));
  assert.equal(hold.subjects[0].subjectId, AUTO_JOB);

  // Running it again must not open a second hold on the same job.
  const second = await runAutoHoldSweep({ apply: true });
  assert.equal(second.opened.length, 0);
  assert.equal(second.alreadyHeld, 1);
  assert.equal((await listLegalHolds()).filter((row) => row.origin === 'automatic').length, 1);

  // And the sweep itself is in the trail, so counsel can see why it froze.
  const trail = await listUserActivity({ action: 'legal.auto_hold_opened' });
  assert.equal(trail.length, 1);
  assert.equal(trail[0].resourceId, AUTO_JOB);
});

test('a dry-run sweep reports what would freeze without freezing it', async () => {
  resetLegalStoreForTests();
  for (const day of [3, 2, 1]) {
    await recordUserAction({
      actorUserId: USER,
      orgId: ORG,
      action: 'video.deleted',
      resourceType: 'proof',
      resourceId: PROOF,
      detail: { jobId: AUTO_JOB },
      occurredAt: ago(day),
    });
  }

  const dry = await runAutoHoldSweep({ apply: false });
  assert.equal(dry.applied, false);
  assert.equal(dry.opened.length, 0);
  assert.equal(dry.signals[0]?.rule, 'bulk_deletion');
  assert.equal((await listLegalHolds()).length, 0);
});

test('ordinary work on a job freezes nothing', async () => {
  resetLegalStoreForTests();
  for (const action of ['video.uploaded', 'video.viewed', 'legal.job_portal_viewed']) {
    await recordUserAction({
      actorUserId: USER,
      orgId: ORG,
      action,
      resourceType: 'proof',
      resourceId: PROOF,
      detail: { jobId: AUTO_JOB },
      occurredAt: ago(1),
    });
  }
  assert.deepEqual(await evaluateAutoHolds({}), []);
});

test('a delete with no job on the row still lands on the right file through the vault', async () => {
  resetLegalStoreForTests();
  resetMediaCatalogForTests();

  const { session } = await beginMediaUpload({
    orgId: ORG,
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: 20,
    byteSize: 400,
    driver: new MemoryMediaStorage(),
  });
  const ready = await completeMediaUpload({
    orgId: ORG,
    sessionId: session.id,
    byteSize: 400,
    contentHash: 'autohold99999',
  });
  await vaultFromMediaObject(ready, { jobId: AUTO_JOB, actorUserId: USER });

  await recordUserAction({
    orgId: ORG,
    action: 'evidence.asked',
    resourceType: 'media',
    resourceId: ready.id,
    occurredAt: ago(5),
  });
  await recordUserAction({
    actorUserId: USER,
    orgId: ORG,
    action: 'video.deleted',
    resourceType: 'media',
    resourceId: ready.id,
    occurredAt: ago(1),
  });

  const signals = await evaluateAutoHolds({});
  assert.equal(signals[0]?.jobId, AUTO_JOB);
  assert.equal(signals[0]?.rule, 'delete_after_outside_review');
});

test('an automatic hold past its review date is a queue, not an expiry', async () => {
  const open = {
    origin: 'automatic',
    status: 'open',
    reviewBy: ago(1),
  } as unknown as Parameters<typeof unreviewedAutoHolds>[0][number];
  const fresh = {
    origin: 'automatic',
    status: 'open',
    reviewBy: new Date(Date.now() + 86_400_000).toISOString(),
  } as unknown as Parameters<typeof unreviewedAutoHolds>[0][number];
  const staff = { origin: 'staff', status: 'open', reviewBy: ago(9) } as unknown as Parameters<
    typeof unreviewedAutoHolds
  >[0][number];

  assert.deepEqual(unreviewedAutoHolds([open, fresh, staff]), [open]);
});
