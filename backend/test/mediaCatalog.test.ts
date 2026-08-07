import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import {
  beginMediaUpload,
  completeMediaUpload,
  orgUsage,
  resetMediaCatalogForTests,
  setOrgQuota,
} from '../src/media/catalog.js';
import { MemoryMediaStorage, S3MediaStorageStub } from '../src/media/driver.js';
import { assertWithinQuotas, formatDurationHours } from '../src/media/quotas.js';
import { HttpError } from '../src/lib/errors.js';

process.env.MEDIA_STORE = 'memory';

test('one object cannot exceed the ~24h duration cap', async () => {
  resetMediaCatalogForTests();
  const over = config.verification.maxDurationSeconds + 1;
  await assert.rejects(
    () =>
      beginMediaUpload({
        orgId: 'org-1',
        kind: 'field_day_video',
        contentType: 'video/mp4',
        durationSeconds: over,
        driver: new MemoryMediaStorage(),
      }),
    (e: unknown) => e instanceof HttpError && e.code === 'duration_too_long',
  );
});

test('a 24h object uploads, completes, and counts toward fleet hours', async () => {
  resetMediaCatalogForTests();
  const day = 24 * 60 * 60;
  const { media, session } = await beginMediaUpload({
    orgId: 'org-1',
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: day,
    byteSize: 12_000_000_000,
    driver: new MemoryMediaStorage(),
  });
  assert.equal(media.state, 'pending_upload');
  assert.ok(session.uploadUrl?.startsWith('memory://'));

  const ready = await completeMediaUpload({
    orgId: 'org-1',
    sessionId: session.id,
    byteSize: 12_000_000_000,
    contentHash: 'abc123456789',
    durationSeconds: day,
  });
  assert.equal(ready.state, 'ready');

  const usage = orgUsage('org-1');
  assert.equal(usage.objectCount, 1);
  assert.equal(usage.totalDurationSeconds, day);
  assert.equal(formatDurationHours(usage.totalDurationSeconds), 24);
  assert.equal(usage.ingestDurationSecondsToday, day);
});

test('soft hot quota rejects another large object', async () => {
  resetMediaCatalogForTests();
  await setOrgQuota({
    orgId: 'org-1',
    maxHotBytes: 5_000,
    maxTotalBytes: null,
    maxIngestSecondsPerDay: null,
    maxObjectBytes: null,
  });
  const { session } = await beginMediaUpload({
    orgId: 'org-1',
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: 60,
    byteSize: 4_000,
    driver: new MemoryMediaStorage(),
  });
  await completeMediaUpload({ orgId: 'org-1', sessionId: session.id, byteSize: 4_000 });

  await assert.rejects(
    () =>
      beginMediaUpload({
        orgId: 'org-1',
        kind: 'field_day_video',
        contentType: 'video/mp4',
        durationSeconds: 60,
        byteSize: 2_000,
        driver: new MemoryMediaStorage(),
      }),
    (e: unknown) => e instanceof HttpError && e.code === 'hot_quota_exceeded',
  );
});

test('S3 stub plans multipart for large day files', async () => {
  const driver = new S3MediaStorageStub('archive-test');
  const size = 200 * 1024 * 1024;
  const created = await driver.createUpload({
    orgId: 'org-1',
    objectKey: 'org-1/field_day_video/x.mp4',
    contentType: 'video/mp4',
    byteSize: size,
    preferMultipart: true,
  });
  assert.equal(created.uploadUrl, null);
  assert.ok(created.multipart);
  assert.ok(created.multipart!.partCount >= 2);
  assert.equal(created.multipart!.parts.length, created.multipart!.partCount);
});

test('field day video without audio is rejected', async () => {
  resetMediaCatalogForTests();
  await assert.rejects(
    () =>
      beginMediaUpload({
        orgId: 'org-1',
        kind: 'field_day_video',
        contentType: 'video/mp4',
        durationSeconds: 60,
        hasAudio: false,
        driver: new MemoryMediaStorage(),
      }),
    (e: unknown) => e instanceof HttpError && e.code === 'audio_required',
  );
});

test('assertWithinQuotas allows unlimited when ceilings are null', () => {
  assert.doesNotThrow(() =>
    assertWithinQuotas({
      quota: {
        orgId: 'o',
        maxHotBytes: null,
        maxTotalBytes: null,
        maxIngestSecondsPerDay: null,
        maxObjectBytes: null,
      },
      usage: {
        orgId: 'o',
        objectCount: 0,
        totalBytes: 0,
        hotBytes: 0,
        warmBytes: 0,
        coldBytes: 0,
        totalDurationSeconds: 0,
        ingestDurationSecondsToday: 0,
      },
      incomingBytes: 50_000_000_000,
      incomingDurationSeconds: 86_400,
      maxObjectDurationSeconds: 86_400,
    }),
  );
});
