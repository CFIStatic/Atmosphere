/**
 * Write clip room segments onto job_locations (the physical room) and
 * clip_room_segments (the timed evidence). A failure here must not fail
 * narration or transcription — callers catch.
 *
 * Re-running with the same analysis hash is a no-op. A user-corrected
 * segment on the clip is left alone.
 */
import {
  alignClipRoomsToJob,
  findingTraits,
  identityFromRoomKey,
  roomAnalysisFingerprint,
  roomDisplayName,
  segmentClipRooms,
  shouldRewriteRooms,
  type KnownJobRoom,
  type RoomClipInput,
} from './roomIntelligence.js';

type Admin = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

/** One room refresh per proof. Narration and transcript both call this. */
const roomRefreshChain = new Map<string, Promise<unknown>>();

export function roomClipFromProofRow(row: Record<string, unknown>): RoomClipInput {
  const findings =
    row.ai_findings && typeof row.ai_findings === 'object' ? (row.ai_findings as Record<string, unknown>) : {};
  return {
    proofId: String(row.id ?? ''),
    title: row.title == null ? null : String(row.title),
    workDate: row.work_date == null ? null : String(row.work_date),
    phase: row.phase == null ? null : String(row.phase),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    actions: Array.isArray(row.actions) ? row.actions : findings.actions,
    events: findings.events ?? (row.narration && typeof row.narration === 'object' ? (row.narration as { entries?: unknown }).entries : null),
    roomSegments: findings.roomSegments,
    transcript: row.transcript_text == null ? null : String(row.transcript_text),
    transcriptSegments: row.transcript_segments,
    privacyRedactions: findings.privacyRedactions,
    childPrivacyRedactions: findings.childPrivacyRedactions,
  };
}

async function upsertLocation(
  admin: Admin,
  input: { orgId: string; jobId: string; roomKey: string; traits: string[] },
): Promise<string | null> {
  const identity = identityFromRoomKey(input.roomKey);
  if (identity.roomType === 'unclear') return null;
  const { data: existing, error } = await admin
    .from('job_locations')
    .select('id, match_traits')
    .eq('job_id', input.jobId)
    .eq('room_key', input.roomKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const traits = [...new Set([...(existing?.match_traits ?? []), ...input.traits])].slice(0, 12);
  const detail = traits.join(', ').slice(0, 200) || null;
  if (existing?.id) {
    await admin.from('job_locations').update({ match_traits: traits, detail }).eq('id', existing.id);
    return String(existing.id);
  }
  const { data: created, error: insertError } = await admin
    .from('job_locations')
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      kind: 'room',
      name: roomDisplayName(identity).slice(0, 120),
      detail,
      room_key: input.roomKey,
      match_traits: traits,
      model_source: 'clip_analysis',
    })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);
  return created?.id ? String(created.id) : null;
}

/**
 * Set roomSegments without replacing the rest of ai_findings. A full-object
 * write drops people, privacy, or conversation saved after the read.
 */
async function writeRoomSegmentBounds(
  admin: Admin,
  proofId: string,
  bounds: Array<{ startSec: number; endSec: number; room: string; confidence: number }>,
): Promise<void> {
  const { error } = await admin.rpc('set_proof_room_segments', {
    p_proof_id: proofId,
    p_segments: bounds,
  });
  if (error) throw new Error(error.message || 'Could not store room segments.');
}

async function syncVerificationScenes(
  admin: Admin,
  input: { orgId: string; jobId: string; proofId: string; segments: ReturnType<typeof segmentClipRooms>; locationByKey: Map<string, string | null> },
): Promise<void> {
  const { data: video, error } = await admin
    .from('verification_videos')
    .select('id')
    .eq('proof_id', input.proofId)
    .maybeSingle();
  if (error || !video?.id) return;
  const { data: corrected } = await admin
    .from('verification_scenes')
    .select('id')
    .eq('video_id', video.id)
    .eq('user_corrected', true)
    .limit(1);
  if (Array.isArray(corrected) && corrected.length) return;
  await admin.from('verification_scenes').delete().eq('video_id', video.id).eq('user_corrected', false);
  if (!input.segments.length) return;
  const rows = input.segments.map((segment) => ({
    org_id: input.orgId,
    video_id: video.id,
    job_id: input.jobId,
    location_id: input.locationByKey.get(segment.roomKey) ?? null,
    sequence_index: segment.sequenceIndex,
    room_type: segment.roomType.replace(/\s+/g, '_').slice(0, 80),
    label: segment.roomName,
    start_seconds: segment.startSeconds,
    end_seconds: segment.endSeconds,
    confidence: segment.confidence,
    source: 'auto',
    metadata: { proofId: input.proofId, roomKey: segment.roomKey },
  }));
  await admin.from('verification_scenes').insert(rows);
}

/**
 * Rebuild one clip's room rows from the analysis and transcript already stored.
 * Does not re-read the video. Calls for the same proof run one at a time.
 */
export async function refreshClipRooms(
  admin: Admin,
  proofId: string,
  source: 'analysis' | 'backfill' = 'analysis',
): Promise<{ written: boolean; skipped: boolean; segments: number }> {
  const previous = roomRefreshChain.get(proofId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => writeClipRooms(admin, proofId, source));
  roomRefreshChain.set(proofId, run);
  return run.finally(() => {
    if (roomRefreshChain.get(proofId) === run) roomRefreshChain.delete(proofId);
  }) as Promise<{ written: boolean; skipped: boolean; segments: number }>;
}

async function writeClipRooms(
  admin: Admin,
  proofId: string,
  source: 'analysis' | 'backfill',
): Promise<{ written: boolean; skipped: boolean; segments: number }> {
  const { data: row, error } = await admin
    .from('job_proofs')
    .select(
      'id, org_id, job_id, title, work_date, phase, duration_seconds, actions, narration, ai_findings, transcript_text, transcript_segments',
    )
    .eq('id', proofId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.id || !row.org_id || !row.job_id) return { written: false, skipped: true, segments: 0 };

  const input = roomClipFromProofRow(row);
  const segmented = segmentClipRooms(input);
  const known = await knownJobRooms(admin, String(row.job_id));
  // Resolve against the job before hashing. A later generic "bathroom" then
  // lands on the existing bathroom::primary row, and the stored bounds hash
  // to the same value on the next pass.
  const segments = alignClipRoomsToJob(segmented, known);
  const bounds = segments.map((segment) => ({
    startSec: segment.startSeconds,
    endSec: segment.endSeconds,
    room: segment.roomName,
    confidence: segment.confidence,
  }));
  const fingerprint = roomAnalysisFingerprint({ ...input, roomSegments: bounds });
  const { data: existing, error: existingError } = await admin
    .from('clip_room_segments')
    .select('analysis_fingerprint, user_corrected')
    .eq('proof_id', proofId);
  if (existingError) throw new Error(existingError.message);
  const prior = (existing ?? []).map((item: { analysis_fingerprint?: string | null; user_corrected?: boolean }) => ({
    fingerprint: item.analysis_fingerprint,
    userCorrected: item.user_corrected === true,
  }));
  if (!shouldRewriteRooms(prior, fingerprint)) return { written: false, skipped: true, segments: prior.length };

  const traitsByKey = new Map<string, string[]>();
  for (const segment of segments) {
    if (segment.roomType === 'unclear') continue;
    const prev = traitsByKey.get(segment.roomKey) ?? [];
    traitsByKey.set(segment.roomKey, [...new Set([...prev, ...findingTraits(segment.findings)])]);
  }
  const locationByKey = new Map<string, string | null>();
  for (const [roomKey, traits] of traitsByKey) {
    const id = await upsertLocation(admin, {
      orgId: String(row.org_id),
      jobId: String(row.job_id),
      roomKey,
      traits,
    });
    locationByKey.set(roomKey, id);
  }

  await admin.from('clip_room_segments').delete().eq('proof_id', proofId).eq('user_corrected', false);
  if (segments.length) {
    const { error: insertError } = await admin.from('clip_room_segments').insert(
      segments.map((segment) => ({
        org_id: row.org_id,
        job_id: row.job_id,
        proof_id: proofId,
        location_id: locationByKey.get(segment.roomKey) ?? null,
        sequence_index: segment.sequenceIndex,
        room_name: segment.roomName,
        room_key: segment.roomKey,
        start_seconds: segment.startSeconds,
        end_seconds: segment.endSeconds,
        confidence: segment.confidence,
        source,
        user_corrected: false,
        findings: segment.findings,
        speech: segment.speech,
        analysis_fingerprint: fingerprint,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }

  await writeRoomSegmentBounds(admin, proofId, bounds);

  try {
    await syncVerificationScenes(admin, {
      orgId: String(row.org_id),
      jobId: String(row.job_id),
      proofId,
      segments,
      locationByKey,
    });
  } catch {
    /* verification scenes are optional; the proof segments are the Ask source */
  }

  return { written: true, skipped: false, segments: segments.length };
}

async function knownJobRooms(admin: Admin, jobId: string): Promise<KnownJobRoom[]> {
  const { data, error } = await admin
    .from('job_locations')
    .select('room_key, match_traits')
    .eq('job_id', jobId)
    .eq('kind', 'room')
    .not('room_key', 'is', null);
  if (error) throw new Error(error.message);
  const rooms: KnownJobRoom[] = [];
  for (const row of data ?? []) {
    const roomKey = String(row.room_key ?? '').trim();
    if (!roomKey) continue;
    const traits = Array.isArray(row.match_traits) ? row.match_traits.map((trait: unknown) => String(trait)) : [];
    rooms.push({ roomKey, traits });
  }
  return rooms;
}

const BACKFILL_PAGE = 50;

async function proofsAwaitingRoomBackfill(
  admin: Admin,
  limit: number,
  opts?: { jobId?: string | null; orgId?: string | null },
): Promise<string[]> {
  const { data, error } = await admin.rpc('proofs_awaiting_room_backfill', {
    p_limit: limit,
    p_job_id: opts?.jobId ?? null,
    p_org_id: opts?.orgId ?? null,
  });
  if (error) throw new Error(error.message || 'Could not list clips awaiting room backfill.');
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((row) => (row && typeof row === 'object' ? String((row as { id?: unknown }).id ?? '') : ''))
    .filter(Boolean);
}

export type RoomBackfillFailure = { id: string; reason: string };

export type RoomBackfillResult = {
  scanned: number;
  written: number;
  skipped: number;
  failed: number;
  failures: RoomBackfillFailure[];
};

/**
 * Clips with no room rows and no stored roomSegments key. A dry run reads
 * one page and writes nothing, so the same ids are not fetched again.
 * Apply walks pages until the cap or the queue is empty. An id that fails
 * is remembered for this run so a single error cannot spin the loop.
 */
export async function backfillClipRooms(
  admin: Admin,
  opts?: { apply?: boolean; jobId?: string | null; orgId?: string | null; limit?: number },
): Promise<RoomBackfillResult> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 500, 2000));
  const empty: RoomBackfillResult = { scanned: 0, written: 0, skipped: 0, failed: 0, failures: [] };
  if (!opts?.apply) {
    const ids = await proofsAwaitingRoomBackfill(admin, Math.min(limit, 200), opts);
    return { ...empty, scanned: ids.length, skipped: ids.length };
  }
  const seen = new Set<string>();
  let written = 0;
  let skipped = 0;
  let failed = 0;
  const failures: RoomBackfillFailure[] = [];
  while (seen.size < limit) {
    const page = await proofsAwaitingRoomBackfill(admin, Math.min(BACKFILL_PAGE, limit - seen.size), opts);
    const fresh = page.filter((id) => !seen.has(id));
    if (!fresh.length) break;
    for (const id of fresh) {
      if (seen.size >= limit) break;
      seen.add(id);
      try {
        const result = await refreshClipRooms(admin, id, 'backfill');
        if (result.written) written += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        failures.push({ id, reason: err instanceof Error && err.message ? err.message : String(err) });
      }
    }
  }
  return { scanned: seen.size, written, skipped, failed, failures };
}
