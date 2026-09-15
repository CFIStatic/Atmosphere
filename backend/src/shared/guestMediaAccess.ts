/**
 * Guest / external-share media access (MVP until Phase 2 privacy-safe derivatives).
 *
 * Policy:
 * - Progress-share and verifier-share (token) surfaces must NOT mint raw signed
 *   playback or download URLs when `ai_findings.privacyRedactions` or
 *   `ai_findings.childPrivacyRedactions` contain any ranges. Client blur is not
 *   enough — a signed URL hands the unredacted original bytes to the guest.
 * - Soft-deleted proofs (`deleted_at` set) are never mintable on those surfaces.
 * - Office authenticated playback/download may still mint raw originals until
 *   Phase 2 re-encode ships a privacy-safe derivative.
 *
 * Guests keep job progress metadata and Ask; only the raw media mint is refused.
 * See docs/privacy-redaction.md and docs/child-privacy-redaction.md.
 */

import {
  childPrivacyRedactionsFromStored,
} from '../audio/childPrivacyRedactions.js';
import { privacyRedactionsFromStored } from '../audio/privacyRedactions.js';
import { HttpError } from '../lib/errors.js';

export const GUEST_RAW_MEDIA_REFUSED_CODE = 'privacy_raw_unavailable';

export const GUEST_RAW_MEDIA_REFUSED_MESSAGE =
  'Privacy-protected evidence is not available as a raw download or signed playback URL. Open it in the authenticated office app, or wait until a privacy-safe derivative is available.';

/** True when private-moment or child-privacy redaction ranges are on file. */
export function proofFindingsHavePrivacyRedactions(aiFindings: unknown): boolean {
  const findings =
    aiFindings && typeof aiFindings === 'object' ? (aiFindings as Record<string, unknown>) : {};
  const privacy = privacyRedactionsFromStored(findings.privacyRedactions);
  if (privacy.length > 0) return true;
  const child = childPrivacyRedactionsFromStored(findings.childPrivacyRedactions);
  return child.length > 0;
}

/**
 * Throw 403 when guest/share surfaces must not mint a raw signed URL.
 * Call after confirming the proof exists and is not soft-deleted.
 */
export function assertGuestMayMintRawMedia(aiFindings: unknown): void {
  if (!proofFindingsHavePrivacyRedactions(aiFindings)) return;
  throw new HttpError(403, GUEST_RAW_MEDIA_REFUSED_MESSAGE, GUEST_RAW_MEDIA_REFUSED_CODE);
}
