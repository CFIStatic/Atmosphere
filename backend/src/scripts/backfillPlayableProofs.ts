/**
 * One-shot, idempotent backfill of office-playable copies for filed videos.
 *
 * Thin wrapper around `backfillPlayableProofs`. The deployed API runs the
 * same function about a minute after boot (`schedulePlayableProofBackfill`),
 * which is what production uses — this process image does not carry a
 * service key for a shell one-off. Run the script only where
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, and ffmpeg is on PATH.
 *
 *   cd backend
 *   npx tsx src/scripts/backfillPlayableProofs.ts
 *   npx tsx src/scripts/backfillPlayableProofs.ts --dry-run
 *
 * Content-Type corrections for mislabeled WebM ship in migration
 * `20260927170000_job_proofs_video_content_types.sql`. This script does not
 * rewrite original bytes.
 */

import 'dotenv/config';
import { backfillPlayableProofs } from '../lib/backfillPlayableProofs.js';
import { createAdminClient } from '../lib/supabase.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Nothing was changed.');
    process.exit(1);
  }

  const result = await backfillPlayableProofs(admin, {
    dryRun,
    onClip(event) {
      const path = event.path ? ` ${event.path}` : '';
      if (event.outcome === 'built') {
        console.log(`playable ${event.id}${path}`);
      } else if (event.outcome === 'failed') {
        console.error(`failed ${event.id}${path}: ${event.reason ?? 'unknown error'}`);
      } else if (event.reason === 'dry-run') {
        console.log(`dry-run ${event.id}${path}`);
      } else if (event.outcome === 'skipped' && event.reason) {
        console.log(`skipped ${event.id}: ${event.reason}`);
      } else if (event.outcome === 'alreadyPlayable') {
        console.log(`ready ${event.id}${path}`);
      }
    },
  });

  console.log(JSON.stringify({ dryRun, ...result }, null, 2));
  if (result.failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
