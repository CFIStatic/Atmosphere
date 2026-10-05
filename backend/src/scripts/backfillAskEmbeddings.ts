/**
 * Backfill Ask retrieval embeddings (transcript + analysis chunks).
 *
 *   cd backend
 *   npx tsx src/scripts/backfillAskEmbeddings.ts                 # dry run
 *   npx tsx src/scripts/backfillAskEmbeddings.ts --job <jobId>   # one job, dry
 *   npx tsx src/scripts/backfillAskEmbeddings.ts --apply         # write vectors
 *
 * Needs OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the
 * ask_retrieval_embeddings migration. Do not run live from an agent without
 * sign-off — this script only exists so ops can run it deliberately.
 */
import 'dotenv/config';
import { backfillAskEmbeddings } from '../lib/backfillAskEmbeddings.js';
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
  const result = await backfillAskEmbeddings(admin, {
    apply,
    orgId: arg('--org'),
    jobId: arg('--job'),
    onProgress: (line) => console.log(line),
  });
  console.log(JSON.stringify({ apply, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
