/**
 * Auto-title untitled clips (blank / UUID titles) from existing analysis.
 *
 *   cd backend
 *   npx tsx src/scripts/backfillProofClipTitles.ts              # dry-run
 *   npx tsx src/scripts/backfillProofClipTitles.ts --apply      # write titles
 *   npx tsx src/scripts/backfillProofClipTitles.ts --job <id> --apply
 *
 * No model calls. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import 'dotenv/config';
import { backfillProofClipTitles } from '../verifier/proofClipTitle.js';
import { createAdminClient } from '../lib/supabase.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Nothing was changed.');
    process.exit(1);
  }
  const limit = arg('--limit');
  const result = await backfillProofClipTitles(admin, {
    apply,
    orgId: arg('--org'),
    jobId: arg('--job'),
    limit: limit ? Number(limit) : undefined,
  });
  console.log(
    apply
      ? `Wrote titles for ${result.written} of ${result.scanned} clips (${result.skipped} skipped).`
      : `Dry-run: would title ${result.wouldWrite} of ${result.scanned} clips (${result.skipped} skipped). Re-run with --apply to write.`,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
