/**
 * One-shot, idempotent backfill of office-playable copies for filed videos.
 *
 * For each live `job_proofs` object that is not already a faststart H.264/AAC
 * MP4, writes a sibling `*.play.mp4` (moov at the front) in the `job-proofs`
 * bucket. Rows that already have that sibling are skipped. Safe to re-run.
 *
 * Content-Type corrections for mislabeled WebM (`application/octet-stream`)
 * ship in migration `20260927160000_job_proofs_video_content_types.sql` and
 * apply with the normal migrate. This script does not rewrite original bytes.
 *
 *   cd backend
 *   npx tsx src/scripts/backfillPlayableProofs.ts
 *   npx tsx src/scripts/backfillPlayableProofs.ts --dry-run
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and ffmpeg on PATH.
 * New uploads already build the sibling from `ensureStillsAndDuration`.
 * Run this once in production so the videos filed before that change play
 * on the first press.
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';
import {
  ensurePlayableDerivative,
  playableDerivativePath,
  PROOF_PLAYABLE_BUCKET,
} from '../lib/proofPlayableUrl.js';

const PAGE = 100;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const admin = createAdminClient();
  if (!admin) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Nothing was changed.');
    process.exit(1);
  }

  let from = 0;
  let seen = 0;
  let skipped = 0;
  let built = 0;
  let failed = 0;

  for (;;) {
    const { data, error } = await admin
      .from('job_proofs')
      .select('id, storage_path, deleted_at')
      .is('deleted_at', null)
      .order('received_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; storage_path: string | null }>;
    if (!rows.length) break;

    for (const row of rows) {
      const storagePath = String(row.storage_path ?? '').trim();
      if (!storagePath || !playableDerivativePath(storagePath)) {
        skipped += 1;
        continue;
      }
      seen += 1;
      if (dryRun) {
        console.log(`dry-run ${row.id} ${storagePath}`);
        continue;
      }
      try {
        const playPath = await ensurePlayableDerivative({
          admin,
          storagePath,
          bucket: PROOF_PLAYABLE_BUCKET,
        });
        if (playPath === storagePath) {
          skipped += 1;
          console.log(`ready (original) ${row.id} ${storagePath}`);
        } else {
          built += 1;
          console.log(`playable ${row.id} ${playPath}`);
        }
      } catch (err) {
        failed += 1;
        console.error(
          `failed ${row.id} ${storagePath}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  console.log(
    JSON.stringify({ dryRun, candidates: seen, built, skipped, failed }, null, 2),
  );
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
