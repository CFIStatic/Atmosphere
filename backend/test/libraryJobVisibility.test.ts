import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryJobCaptureStatus } from '../src/lib/proofUploadChunks.js';

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
  assert.match(proof, /PROOF_ASSEMBLE_MAX_BYTES/);
  assert.match(proof, /byteSize: z\.number\(\)\.int\(\)\.positive\(\)/);
});
