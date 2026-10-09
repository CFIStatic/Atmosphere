/**
 * Re-seal saved Logins passwords with the current COMPUTER_CREDENTIAL_KEY.
 *
 *   cd backend
 *   COMPUTER_CREDENTIAL_KEY=<new> COMPUTER_CREDENTIAL_KEY_PREVIOUS=<old> \
 *     npx tsx src/scripts/rotateComputerCredentials.ts            # dry-run
 *   ... npx tsx src/scripts/rotateComputerCredentials.ts --apply  # write
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Prints counts only.
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';
import { credentialsEnabled } from '../computer/credentialCrypto.js';
import { rotateComputerCredentials, type RotationRow } from '../computer/rotateCredentials.js';

const PAGE = 500;

async function main() {
  const apply = process.argv.includes('--apply');
  if (!credentialsEnabled()) {
    console.error('COMPUTER_CREDENTIAL_KEY is not set (or shorter than 32 characters). Nothing was changed.');
    process.exit(1);
  }
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Nothing was changed.');
    process.exit(1);
  }
  const rows: RotationRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('computer_login_credentials')
      .select('org_id, login_id, username_sealed, password_sealed, key_fingerprint')
      .order('login_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read saved logins: ${error.message}`);
    rows.push(...((data ?? []) as RotationRow[]));
    if (!data || data.length < PAGE) break;
  }
  const result = await rotateComputerCredentials({
    rows,
    apply,
    update: async (orgId, loginId, patch) => {
      const { error } = await admin
        .from('computer_login_credentials')
        .update({ ...patch, status: 'ok', attention_reason: null, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('login_id', loginId);
      if (error) throw new Error(`Could not update saved login ${loginId}: ${error.message}`);
    },
  });
  console.log(
    apply
      ? `Re-sealed ${result.resealed} of ${result.scanned} saved logins (${result.current} already current).`
      : `Dry-run: would re-seal ${result.resealed} of ${result.scanned} saved logins (${result.current} already current). Re-run with --apply to write.`,
  );
  if (result.unreadable.length) {
    console.log(`${result.unreadable.length} saved logins use a key that is not configured; an admin must save them again: ${result.unreadable.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
