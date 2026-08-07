/**
 * End-to-end smoke without crew footage:
 *   1. Generate synthetic H.264+AAC MP4
 *   2. Probe A/V tracks
 *   3. prepareVideoFrames (ffmpeg sparse + diversity)
 *   4. Catalog upload session (memory driver) with hasAudio
 *   5. Twin ingest with rooms + videoRef
 *
 * Usage:  npx tsx scripts/smokeSyntheticPipeline.ts
 *
 * Uses MEDIA_STORE=memory / GEOMETRY_STORE=memory so this runs without a
 * service role. Production API paths persist to the same Supabase project
 * as job_proofs when SUPABASE_SERVICE_ROLE_KEY is set.
 */
import {
  makeSyntheticDayClip,
  probeHasAudio,
  probeHasVideo,
} from '../test/helpers/syntheticAv.js';
import { prepareVideoFrames } from '../src/shared/videoIntelligence.js';
import {
  beginMediaUpload,
  completeMediaUpload,
  resetMediaCatalogForTests,
} from '../src/media/catalog.js';
import { MemoryMediaStorage } from '../src/media/driver.js';
import {
  createTwin,
  resetGeometryStoreForTests,
} from '../src/geometry/store.js';
import { ingestMeasurementsOntoTwin, summarizeTwin } from '../src/geometry/twin.js';

process.env.MEDIA_STORE ??= 'memory';
process.env.GEOMETRY_STORE ??= 'memory';

async function main() {
  console.log('[smoke] generating synthetic A/V clip…');
  const clip = await makeSyntheticDayClip({ durationSeconds: 12, withAudio: true });
  const hasV = await probeHasVideo(clip.path);
  const hasA = await probeHasAudio(clip.path);
  console.log(`[smoke] clip=${clip.path} video=${hasV} audio=${hasA}`);
  if (!hasV || !hasA) throw new Error('synthetic clip missing tracks');

  console.log('[smoke] prepareVideoFrames…');
  const prepared = await prepareVideoFrames({
    id: 'smoke-field-day',
    source: 'field_capture',
    url: clip.path,
    durationSeconds: clip.durationSeconds,
    maxFrames: 24,
  });
  console.log(`[smoke] frames=${prepared.frames.length} longForm=${prepared.longForm}`);
  if (!prepared.frames.length) throw new Error('no frames extracted');

  resetMediaCatalogForTests();
  const { media, session } = await beginMediaUpload({
    orgId: 'smoke-org',
    kind: 'field_day_video',
    contentType: 'video/mp4',
    durationSeconds: clip.durationSeconds,
    byteSize: 250_000,
    hasAudio: true,
    driver: new MemoryMediaStorage(),
  });
  const ready = await completeMediaUpload({
    orgId: 'smoke-org',
    sessionId: session.id,
    byteSize: 250_000,
    durationSeconds: clip.durationSeconds,
    hasAudio: true,
    contentHash: 'smoke' + '0'.repeat(16),
  });
  console.log(`[smoke] media=${ready.id} state=${ready.state} hasAudio=${ready.hasAudio}`);

  resetGeometryStoreForTests();
  const twin = await createTwin({
    orgId: 'smoke-org',
    jobId: 'smoke-job',
    label: 'Smoke site',
    primarySource: 'roomplan',
  });
  const updated = await ingestMeasurementsOntoTwin(twin.id, {
    source: 'roomplan',
    rooms: [
      { name: 'Living', lengthFt: 14, widthFt: 12, heightFt: 8 },
      { name: 'Kitchen', floorAreaSqFt: 120, heightFt: 8 },
    ],
    videoRef: media.id,
    work: [{ label: 'Synthetic work overlay', status: 'in_progress' }],
  });
  const summary = summarizeTwin(updated);
  console.log('[smoke] twin', summary);

  if (!summary.metric || summary.roomCount !== 2 || summary.videoCount !== 1) {
    throw new Error('twin summary unexpected');
  }
  console.log('[smoke] OK — pipeline stands without real field video');
}

main().catch((err) => {
  console.error('[smoke] FAILED', err);
  process.exit(1);
});
