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
};

export function termsRequired(status: TermsStatus | null | undefined): boolean {
  if (!status) return true;
  return status.required || status.acceptedVersion !== status.currentVersion;
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
