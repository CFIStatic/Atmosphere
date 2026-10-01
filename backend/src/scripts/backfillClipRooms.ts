/**
 * Build room segments for clips that were analyzed before room rows existed.
 *
 *   cd backend
 *   npx tsx src/scripts/backfillClipRooms.ts                 # dry run: count only
 *   npx tsx src/scripts/backfillClipRooms.ts --job <jobId>   # one job, dry run
 *   npx tsx src/scripts/backfillClipRooms.ts --apply         # write room rows
 *
 * Local use. Production runs the same pass from the APIs process about a
 * minute after boot (scheduleClipRoomBackfill), using that service's env.
 * PROOF_ROOM_BACKFILL_ON_BOOT=0 turns the boot pass off.
 *
 * Needs 20261001143000_clip_room_segments, 20261001161000_set_proof_room_segments,
 * and 20261001170000_proofs_awaiting_room_backfill applied, plus SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY for this process.
 * Reads the analysis and transcript already on each clip. Makes no model calls.
 * Skips clips that already have room rows or a stored roomSegments key, and
 * never rewrites a user-corrected clip.
 */

import 'dotenv/config';
import { backfillClipRooms } from '../shared/roomPersist.js';
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
  const result = await backfillClipRooms(admin, {
    apply,
    orgId: arg('--org'),
    jobId: arg('--job'),
    limit: limit ? Number(limit) : undefined,
  });
  console.log(
    apply
      ? `Wrote room segments for ${result.written} of ${result.scanned} clips (${result.skipped} unchanged).`
      : `Would scan ${result.scanned} analyzed clips. Re-run with --apply to write.`,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
