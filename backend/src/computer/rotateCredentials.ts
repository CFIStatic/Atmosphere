/**
 * Re-seal every saved Logins password with the current COMPUTER_CREDENTIAL_KEY.
 * Run after moving the old key into COMPUTER_CREDENTIAL_KEY_PREVIOUS (see
 * credentialCrypto.ts). Never logs or returns plaintext: the result is counts
 * and the login ids that could not be opened.
 */
import { canOpenFingerprint, credentialKeyFingerprint, resealCredential } from './credentialCrypto.js';
import type { ComputerCredentialRow, CredentialPatch } from './store.js';

export type RotationRow = Pick<ComputerCredentialRow, 'org_id' | 'login_id' | 'username_sealed' | 'password_sealed' | 'key_fingerprint'>;

export interface RotationResult {
  scanned: number;
  current: number;
  resealed: number;
  /** Sealed with a key that is neither current nor listed as previous: an admin must save these again. */
  unreadable: string[];
}

export async function rotateComputerCredentials(input: {
  rows: RotationRow[];
  apply: boolean;
  update: (orgId: string, loginId: string, patch: CredentialPatch) => Promise<void>;
}): Promise<RotationResult> {
  const result: RotationResult = { scanned: 0, current: 0, resealed: 0, unreadable: [] };
  const fingerprint = credentialKeyFingerprint();
  for (const row of input.rows) {
    result.scanned += 1;
    if (row.key_fingerprint === fingerprint) {
      result.current += 1;
      continue;
    }
    if (!canOpenFingerprint(row.key_fingerprint)) {
      result.unreadable.push(row.login_id);
      continue;
    }
    let patch: ReturnType<typeof resealCredential>;
    try {
      patch = resealCredential(row);
    } catch {
      result.unreadable.push(row.login_id);
      continue;
    }
    if (!patch) {
      result.current += 1;
      continue;
    }
    if (input.apply) await input.update(row.org_id, row.login_id, patch);
    result.resealed += 1;
  }
  return result;
}
