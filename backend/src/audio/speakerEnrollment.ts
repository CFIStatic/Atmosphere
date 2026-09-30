/**
 * Voice enrollment rules.
 *
 * A person enrolls only from their own account. A coworker request stays
 * pending until that coworker confirms and supplies the sample. Revoking
 * consent removes the voiceprint (and, by cascade, the embedding).
 */

export const VOICE_CONSENT_TEXT =
  'I consent to Atmosphere creating a voiceprint from this recording to recognize my voice on job clips. I can revoke this consent at any time, which deletes the voiceprint. Atmosphere will not use this voiceprint to identify me on another company\'s jobs unless I turn on cross-company matching in my own account settings.';

export function consentAccepted(text: string | null | undefined, accepted: boolean): boolean {
  return accepted === true && String(text ?? '').trim() === VOICE_CONSENT_TEXT;
}

/** The signed-in user is the only person who can store their voiceprint. */
export function canStoreVoiceprint(actorUserId: string, subjectUserId: string): boolean {
  return Boolean(actorUserId) && actorUserId === subjectUserId;
}

export type EnrollmentRequest = {
  id: string;
  requesterUserId: string;
  subjectUserId: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
};

/** A coworker sample becomes a voiceprint only when the subject confirms their own request. */
export function canConfirmEnrollment(actorUserId: string, request: EnrollmentRequest): boolean {
  return request.status === 'pending' && actorUserId === request.subjectUserId && actorUserId !== request.requesterUserId;
}
