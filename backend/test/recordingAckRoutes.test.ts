import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORDING_DISCLOSURE_VERSION,
  RECORDING_DISCLOSURE_TEXT,
} from '../src/legal/recordingDisclosure.js';

const here = dirname(fileURLToPath(import.meta.url));
const fieldAppSrc = readFileSync(join(here, '../src/routes/fieldApp.ts'), 'utf8');
const sharedJobsSrc = readFileSync(join(here, '../src/routes/sharedJobs.ts'), 'utf8');

test('field-app exposes recording disclosure + ack routes', () => {
  assert.match(fieldAppSrc, /\/recording-disclosure/);
  assert.match(fieldAppSrc, /\/jobs\/:jobId\/recording-ack/);
  assert.match(fieldAppSrc, /recordRecordingAcknowledgment/);
  assert.match(fieldAppSrc, /disclosureVersion/);
});

test('job-share exposes recording disclosure + ack routes', () => {
  assert.match(sharedJobsSrc, /recording-disclosure/);
  assert.match(sharedJobsSrc, /recording-ack/);
  assert.match(sharedJobsSrc, /recordRecordingAcknowledgment/);
});

test('recording disclosure version binding is stable for clients', () => {
  assert.equal(RECORDING_DISCLOSURE_VERSION, 'recording-disclosure-v1');
  assert.match(RECORDING_DISCLOSURE_TEXT, /Video and audio may be recorded/i);
  assert.match(RECORDING_DISCLOSURE_TEXT, /analyzed to build the job record/i);
  assert.match(RECORDING_DISCLOSURE_TEXT, /authorized parties/i);
  assert.doesNotMatch(RECORDING_DISCLOSURE_TEXT, /HIPAA|GDPR|legally binding/i);
});
