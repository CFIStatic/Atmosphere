import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORDING_DISCLOSURE_VERSION,
  RECORDING_VERSION_MISMATCH_CODE,
  isAcceptableRecordingDisclosureVersion,
} from './recordingDisclosure.js';
import { recordRecordingAcknowledgment } from './recordingAckStore.js';
import { HttpError } from '../lib/errors.js';

const storeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'recordingAckStore.ts'),
  'utf8',
);
const proofSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../routes/proofOfWork.ts'),
  'utf8',
);
const migration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../supabase/migrations/20260915220000_recording_acknowledgments.sql',
  ),
  'utf8',
);

describe('recording ack store wiring', () => {
  it('uses the service_role admin client like terms acceptances', () => {
    assert.match(storeSrc, /function recordingAdmin/);
    assert.match(storeSrc, /unscopedAdminOrNull/);
    assert.match(storeSrc, /recording_acknowledgments/);
  });

  it('enforces version binding on record', async () => {
    await assert.rejects(
      () =>
        recordRecordingAcknowledgment({
          jobId: '00000000-0000-4000-8000-000000000001',
          workDate: '2026-09-14',
          disclosureVersion: 'recording-disclosure-v0',
          actorUserId: '00000000-0000-4000-8000-000000000099',
        }),
      (err: unknown) =>
        err instanceof HttpError &&
        err.status === 400 &&
        err.code === RECORDING_VERSION_MISMATCH_CODE,
    );
    assert.equal(isAcceptableRecordingDisclosureVersion(RECORDING_DISCLOSURE_VERSION), true);
  });

  it('gates Field Capture proof upload / assemble on the ack in production', () => {
    assert.match(proofSrc, /assertRecordingAckForProof/);
    assert.match(proofSrc, /createUploadUrl/);
    assert.match(proofSrc, /completeChunkedProofUpload/);
    assert.match(proofSrc, /recordProof/);
  });

  it('ships a durable recording_acknowledgments migration', () => {
    assert.match(migration, /create table if not exists public\.recording_acknowledgments/);
    assert.match(migration, /unique \(job_id, actor_user_id, work_date, disclosure_version\)/);
    assert.match(migration, /disclosure_version/);
    assert.match(migration, /property_id/);
  });
});
