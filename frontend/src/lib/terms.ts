/** Live Terms of Service revision — keep in lockstep with backend/src/legal/terms.ts. */
export const CURRENT_TERMS_VERSION = '2026-09-10';
export const TERMS_PUBLIC_URL = 'https://atmosphereteam.com/terms';
export const PRIVACY_PUBLIC_URL = 'https://atmosphereteam.com/privacy';

export type TermsStatus = {
  required: boolean;
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt?: string | null;
  url: string;
  /** No recorded voiceprint consent yet (and never turned off): ask once. */
  voiceConsentRequired?: boolean;
};

/** Bump with backend/src/legal/voiceConsent.ts VOICE_CONSENT_VERSION. */
export const VOICE_CONSENT_VERSION = 'voiceprint:2026-10-23';

export function termsRequired(status: TermsStatus | null | undefined): boolean {
  if (!status) return true;
  return status.required || status.acceptedVersion !== status.currentVersion || status.voiceConsentRequired === true;
}

export function publicTermsStatus(): TermsStatus {
  return {
    required: true,
    currentVersion: CURRENT_TERMS_VERSION,
    acceptedVersion: null,
    acceptedAt: null,
    url: TERMS_PUBLIC_URL,
  };
}

const SESSION_TERMS_ACK_KEY = 'atmosphere.termsAckVersion';
/** Session marker covers the Terms revision and the voiceprint consent. */
function sessionAckValue(version: string): string {
  return `${version}|${VOICE_CONSENT_VERSION}`;
}

/** Record that this browser tab acknowledged the current Terms (login / accept). */
export function markSessionTermsAccepted(version: string = CURRENT_TERMS_VERSION): void {
  try {
    sessionStorage.setItem(SESSION_TERMS_ACK_KEY, sessionAckValue(version));
  } catch {
    /* private mode / blocked storage */
  }
}

/** True when this tab already acknowledged the live Terms version. */
export function sessionTermsAcceptedForCurrent(): boolean {
  try {
    return sessionStorage.getItem(SESSION_TERMS_ACK_KEY) === sessionAckValue(CURRENT_TERMS_VERSION);
  } catch {
    return false;
  }
}

export function clearSessionTermsAccepted(): void {
  try {
    sessionStorage.removeItem(SESSION_TERMS_ACK_KEY);
  } catch {
    /* ignore */
  }
}

