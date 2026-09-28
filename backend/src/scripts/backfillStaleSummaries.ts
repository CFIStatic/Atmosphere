/**
 * One-time: re-queue AI summaries that are older than their transcript.
 *
 *   cd backend
 *   npx tsx src/scripts/backfillStaleSummaries.ts            # dry run: list only
 *   npx tsx src/scripts/backfillStaleSummaries.ts --apply    # mark them stale
 *
 * `--apply` only sets summary_status = 'stale'. A running API worker (the
 * analysis sweep) rebuilds each one on the summary retry queue. Needs
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Not for production from a
 * laptop without sign-off.
 */

import 'dotenv/config';
import { backfillStaleSummaries } from '../lib/backfillStaleSummaries.js';
import { createAdminClient } from '../lib/supabase.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Nothing was changed.');
    process.exit(1);
  }
  const result = await backfillStaleSummaries(admin, {
    apply,
    onRow(row) {
      console.log(`${apply ? 'stale' : 'would mark'} ${row.id} (${row.reason})`);
    },
  });
  console.log(JSON.stringify({ ...result, affected: result.affected.length }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
