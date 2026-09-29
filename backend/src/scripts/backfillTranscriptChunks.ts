/**
 * One-time: build the Ask transcript chunk index for existing clips.
 *
 *   cd backend
 *   npx tsx src/scripts/backfillTranscriptChunks.ts                 # dry run: count only
 *   npx tsx src/scripts/backfillTranscriptChunks.ts --job <jobId>   # one job, dry run
 *   npx tsx src/scripts/backfillTranscriptChunks.ts --apply         # write chunks
 *
 * Needs the 20260929160000_ask_transcript_chunks migration applied, plus
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Makes no model or embedding
 * calls. Not for production from a laptop without sign-off.
 */

import 'dotenv/config';
import { backfillTranscriptChunks } from '../lib/backfillTranscriptChunks.js';
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
  const result = await backfillTranscriptChunks(admin, {
    apply,
    orgId: arg('--org'),
    jobId: arg('--job'),
    onRow(row) {
      console.log(`${apply ? 'write' : 'would write'} ${row.id} (${row.reason}, ${row.chunks} chunks)`);
    },
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
