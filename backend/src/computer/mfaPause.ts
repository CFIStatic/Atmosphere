/**
 * Plain Chat messages when a sign-in page asks the person for MFA.
 * Numbers and codes come only from what is on the page (pageSignals).
 * We never invent an approval number or OTP.
 */
import type { NeedsYouReason, PageSignals } from './types.js';

export interface MfaPause {
  reason: NeedsYouReason;
  message: string;
}

/** Build the Needs-you pause for a verification / number-matching page. */
export function mfaPauseFromSignals(signals: PageSignals): MfaPause | null {
  if (signals.approvalNumber) {
    return {
      reason: 'number_match',
      message: `Approve ${signals.approvalNumber} on your phone, then press Resume.`,
    };
  }
  if (signals.visibleOtpCode) {
    return {
      reason: 'two_factor',
      message: `The code on this page is ${signals.visibleOtpCode}. Enter it where the site asks, then press Resume.`,
    };
  }
  if (signals.hasOneTimeCodeField || signals.mentionsVerificationCode) {
    return {
      reason: 'two_factor',
      message:
        'The site is asking for a verification code. It was sent to your phone or email — enter it in the live view, then press Resume.',
    };
  }
  return null;
}
