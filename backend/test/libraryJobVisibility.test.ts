import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryJobCaptureStatus } from '../src/lib/proofUploadChunks.js';

test('a job-scoped library read filters that job before the newest-500 window', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  const start = src.indexOf("evidencePortalRouter.get('/library'");
  const end = src.indexOf("evidencePortalRouter.get(\n  '/evidence/:proofId'");
  const handler = src.slice(start, end);
  assert.match(handler, /jobId: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  const eqAt = handler.indexOf(".eq('job_id', jobId)");
  const limitAt = handler.indexOf('.limit(500)');
  assert.ok(eqAt !== -1, 'job-scoped library query filters job_id');
  assert.ok(limitAt !== -1, 'org library feed still caps at 500');
  assert.ok(eqAt < limitAt, 'job_id filter runs before the newest-500 cap');
});

test('the office library ships job files before any clip lands', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  assert.match(src, /from\('crm_jobs'\)/);
  assert.match(src, /createdAt: createdAt \?\? null/);
  assert.match(src, /captureStatus: libraryJobCaptureStatus\(lastWorkDateByJob.has\(jobId\)\)/);
  assert.equal(libraryJobCaptureStatus(false), 'in_progress');
  assert.equal(libraryJobCaptureStatus(true), 'recorded');
});

test('Field Capture and job-share can stitch resumed upload parts', () => {
  const field = readFileSync(new URL('../src/routes/fieldApp.ts', import.meta.url), 'utf8');
  const share = readFileSync(new URL('../src/routes/sharedJobs.ts', import.meta.url), 'utf8');
  const proof = readFileSync(new URL('../src/routes/proofOfWork.ts', import.meta.url), 'utf8');
  assert.match(field, /proof\/upload-complete/);
  assert.match(field, /completeChunkedProofUpload/);
  assert.match(share, /proof\/upload-complete/);
  assert.match(proof, /export async function completeChunkedProofUpload/);
  assert.match(proof, /assertProofAssembleBudget/);
  assert.match(proof, /listedProofObjectBytes/);
  assert.match(proof, /PROOF_ASSEMBLE_MAX_BYTES/);
  assert.match(proof, /byteSize: z\.number\(\)\.int\(\)\.positive\(\)/);
});
