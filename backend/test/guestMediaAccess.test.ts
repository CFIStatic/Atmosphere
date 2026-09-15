import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { HttpError } from '../src/lib/errors.js';
import {
  GUEST_RAW_MEDIA_REFUSED_CODE,
  assertGuestMayMintRawMedia,
  proofFindingsHavePrivacyRedactions,
} from '../src/shared/guestMediaAccess.js';

const here = dirname(fileURLToPath(import.meta.url));
const progressShare = readFileSync(join(here, '../src/routes/progressShare.ts'), 'utf8');
const evidencePortal = readFileSync(join(here, '../src/routes/evidencePortal.ts'), 'utf8');
const sharedJobs = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');

test('proofFindingsHavePrivacyRedactions is false when findings are empty', () => {
  assert.equal(proofFindingsHavePrivacyRedactions(null), false);
  assert.equal(proofFindingsHavePrivacyRedactions({}), false);
  assert.equal(
    proofFindingsHavePrivacyRedactions({ privacyRedactions: { version: 1, ranges: [] } }),
    false,
  );
});

test('proofFindingsHavePrivacyRedactions is true for private-moment or child ranges', () => {
  assert.equal(
    proofFindingsHavePrivacyRedactions({
      privacyRedactions: {
        version: 1,
        ranges: [{ startSec: 10, endSec: 20, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
      },
    }),
    true,
  );
  assert.equal(
    proofFindingsHavePrivacyRedactions({
      childPrivacyRedactions: {
        version: 1,
        category: 'child_privacy',
        ranges: [
          {
            startSec: 5,
            endSec: 15,
            reason: 'child present',
            confidence: 0.8,
            source: 'vision',
          },
        ],
      },
    }),
    true,
  );
});

test('assertGuestMayMintRawMedia allows clean proofs and refuses redacted ones', () => {
  assert.doesNotThrow(() => assertGuestMayMintRawMedia({}));
  assert.throws(
    () =>
      assertGuestMayMintRawMedia({
        privacyRedactions: {
          version: 1,
          ranges: [{ startSec: 1, endSec: 2, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 403);
      assert.equal(err.code, GUEST_RAW_MEDIA_REFUSED_CODE);
      return true;
    },
  );
});

test('progress-share video excludes soft-deleted proofs and gates privacy redactions', () => {
  const start = progressShare.indexOf("'/:token/proof/:proofId/video'");
  assert.ok(start > 0);
  const body = progressShare.slice(start, start + 1800);
  assert.match(body, /\.is\('deleted_at',\s*null\)/);
  assert.match(body, /assertGuestMayMintRawMedia/);
  assert.match(body, /ai_findings/);
});

test('progress-share token lookup rejects soft-deleted jobs', () => {
  const start = progressShare.indexOf('async function progressShareForToken');
  const body = progressShare.slice(start, start + 1600);
  assert.match(body, /crm_jobs/);
  assert.match(body, /deleted_at/);
  assert.match(body, /job_deleted/);
});

test('verifier-share video and download exclude deleted proofs and refuse raw when redacted', () => {
  const videoStart = evidencePortal.indexOf("'/:token/evidence/:proofId/video'");
  assert.ok(videoStart > 0);
  const video = evidencePortal.slice(videoStart, videoStart + 1800);
  assert.match(video, /\.is\('deleted_at',\s*null\)/);
  assert.match(video, /assertGuestMayMintRawMedia/);

  const dlStart = evidencePortal.indexOf("'/:token/evidence/:proofId/download'");
  assert.ok(dlStart > 0);
  const download = evidencePortal.slice(dlStart, dlStart + 2200);
  assert.match(download, /\.is\('deleted_at',\s*null\)/);
  assert.match(download, /assertGuestMayMintRawMedia/);
});

test('job soft-delete revokes related verifier_shares', () => {
  const start = sharedJobs.indexOf("sharedJobsRouter.delete('/shared/:jobId'");
  assert.ok(start > 0);
  const body = sharedJobs.slice(start, start + 4500);
  assert.match(body, /from\('verifier_shares'\)/);
  assert.match(body, /revoked_at:\s*now/);
  assert.match(body, /\.is\('revoked_at',\s*null\)/);
});
