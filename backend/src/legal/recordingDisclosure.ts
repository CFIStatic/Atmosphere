/**
 * Versioned Field Capture recording-on-property disclosure.
 *
 * Separate from worker Terms of Service. Bump RECORDING_DISCLOSURE_VERSION
 * (and revise RECORDING_DISCLOSURE_TEXT) when counsel updates the wording so
 * crews must acknowledge the new revision before recording again.
 *
 * Not legal final — product disclosure counsel can revise.
 */

export const RECORDING_DISCLOSURE_VERSION = 'recording-disclosure-v1';

export const RECORDING_DISCLOSURE_TEXT = [
  'Video and audio may be recorded on this job site while you use Field Capture.',
  'Recordings are stored by Atmosphere and analyzed to build the job record',
  '(what was done, where, and related site context).',
  'Authorized parties — such as your office, invited homeowner contacts, and',
  'other people your company invites to this job — may be given access to the',
  'job record and recordings as needed for the work.',
  'This notice is a product disclosure, not legal advice. Your company may',
  'provide additional notices for this property.',
].join(' ');

export const RECORDING_ACK_REQUIRED_CODE = 'recording_ack_required';
export const RECORDING_ACK_REQUIRED_MESSAGE =
  'Acknowledge the recording disclosure for this job before uploading Field Capture film.';

export const RECORDING_VERSION_MISMATCH_CODE = 'recording_disclosure_version_mismatch';

export type RecordingDisclosurePayload = {
  version: string;
  text: string;
};

export type RecordingAckStatus = {
  required: boolean;
  currentVersion: string;
  acknowledgedVersion: string | null;
  acknowledgedAt: string | null;
  workDate: string;
  jobId: string;
};

export function recordingDisclosure(): RecordingDisclosurePayload {
  return {
    version: RECORDING_DISCLOSURE_VERSION,
    text: RECORDING_DISCLOSURE_TEXT,
  };
}

export function isAcceptableRecordingDisclosureVersion(
  version: string | null | undefined,
  currentVersion: string = RECORDING_DISCLOSURE_VERSION,
): boolean {
  return typeof version === 'string' && version.trim() === currentVersion;
}

export function hasCurrentRecordingAck(
  acknowledgedVersion: string | null | undefined,
  currentVersion: string = RECORDING_DISCLOSURE_VERSION,
): boolean {
  return Boolean(acknowledgedVersion && acknowledgedVersion === currentVersion);
}

export function recordingAckStatus(input: {
  jobId: string;
  workDate: string;
  acknowledgedVersion: string | null;
  acknowledgedAt: string | null;
}): RecordingAckStatus {
  return {
    required: !hasCurrentRecordingAck(input.acknowledgedVersion),
    currentVersion: RECORDING_DISCLOSURE_VERSION,
    acknowledgedVersion: input.acknowledgedVersion,
    acknowledgedAt: input.acknowledgedAt,
    workDate: input.workDate,
    jobId: input.jobId,
  };
}
