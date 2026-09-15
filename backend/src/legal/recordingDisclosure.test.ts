import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RECORDING_ACK_REQUIRED_CODE,
  RECORDING_DISCLOSURE_TEXT,
  RECORDING_DISCLOSURE_VERSION,
  hasCurrentRecordingAck,
  isAcceptableRecordingDisclosureVersion,
  recordingAckStatus,
  recordingDisclosure,
} from './recordingDisclosure.js';

describe('recording disclosure versioning', () => {
  it('exposes recording-disclosure-v1 with clear product wording', () => {
    assert.equal(RECORDING_DISCLOSURE_VERSION, 'recording-disclosure-v1');
    const payload = recordingDisclosure();
    assert.equal(payload.version, 'recording-disclosure-v1');
    assert.match(payload.text, /Video and audio may be recorded/i);
    assert.match(payload.text, /stored/i);
    assert.match(payload.text, /analyzed to build the job record/i);
    assert.match(payload.text, /authorized parties/i);
    assert.doesNotMatch(payload.text, /HIPAA|GDPR|legally binding|attorney/i);
    assert.equal(payload.text, RECORDING_DISCLOSURE_TEXT);
  });

  it('requires acknowledgment when nothing is recorded for the job/day', () => {
    const status = recordingAckStatus({
      jobId: 'job-1',
      workDate: '2026-09-14',
      acknowledgedVersion: null,
      acknowledgedAt: null,
    });
    assert.equal(status.required, true);
    assert.equal(status.currentVersion, RECORDING_DISCLOSURE_VERSION);
    assert.equal(status.jobId, 'job-1');
    assert.equal(status.workDate, '2026-09-14');
  });

  it('requires acknowledgment again when the recorded version is older', () => {
    const status = recordingAckStatus({
      jobId: 'job-1',
      workDate: '2026-09-14',
      acknowledgedVersion: 'recording-disclosure-v0',
      acknowledgedAt: '2026-09-01T00:00:00.000Z',
    });
    assert.equal(status.required, true);
    assert.equal(hasCurrentRecordingAck('recording-disclosure-v0'), false);
  });

  it('clears the gate when the recorded version matches the live revision', () => {
    const status = recordingAckStatus({
      jobId: 'job-1',
      workDate: '2026-09-14',
      acknowledgedVersion: RECORDING_DISCLOSURE_VERSION,
      acknowledgedAt: '2026-09-14T12:00:00.000Z',
    });
    assert.equal(status.required, false);
    assert.equal(hasCurrentRecordingAck(RECORDING_DISCLOSURE_VERSION), true);
  });

  it('rejects a missing or stale disclosure version on POST', () => {
    assert.equal(isAcceptableRecordingDisclosureVersion(undefined), false);
    assert.equal(isAcceptableRecordingDisclosureVersion(''), false);
    assert.equal(isAcceptableRecordingDisclosureVersion('recording-disclosure-v0'), false);
    assert.equal(
      isAcceptableRecordingDisclosureVersion(` ${RECORDING_DISCLOSURE_VERSION} `),
      true,
    );
    assert.equal(isAcceptableRecordingDisclosureVersion(RECORDING_DISCLOSURE_VERSION), true);
  });

  it('exports the recording_ack_required code clients and upload gates branch on', () => {
    assert.equal(RECORDING_ACK_REQUIRED_CODE, 'recording_ack_required');
  });
});
