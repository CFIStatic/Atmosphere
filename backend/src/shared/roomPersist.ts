/**
 * Write clip room segments onto job_locations (the physical room) and
 * clip_room_segments (the timed evidence). A failure here must not fail
 * narration or transcription — callers catch.
 *
 * Re-running with the same analysis hash is a no-op. A user-corrected
 * segment on the clip is left alone.
 */
import {
  applyCrossClipRoomIdentity,
  matchRoomsAcrossClips,
  roomAnalysisFingerprint,
  roomDisplayName,
  segmentClipRooms,
  shouldRewriteRooms,
  type RoomClipInput,
  type RoomIdentity,
} from './roomIntelligence.js';

type Admin = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
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

function identityFromKey(roomKey: string): RoomIdentity {
  const [roomType, qualifier] = roomKey.split('::');
  return { roomType: roomType || 'unclear', qualifier: qualifier || null };
}

async function upsertLocation(
  admin: Admin,
  input: { orgId: string; jobId: string; roomKey: string; traits: string[] },
): Promise<string | null> {
  const identity = identityFromKey(input.roomKey);
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

async function loadSiblingRoomClips(admin: Admin, jobId: string, proofId: string): Promise<RoomClipInput[]> {
  const { data, error } = await admin
    .from('job_proofs')
    .select(
      'id, title, work_date, phase, duration_seconds, actions, narration, ai_findings, transcript_text, transcript_segments',
    )
    .eq('job_id', jobId)
    .neq('id', proofId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((item: Record<string, unknown>) => roomClipFromProofRow(item));
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
  if (error) throw new Error(error.message);
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
  const segments = segmentClipRooms(input);
  const bounds = segments.map((segment) => ({
    startSec: segment.startSeconds,
    endSec: segment.endSeconds,
    room: segment.roomName,
    confidence: segment.confidence,
  }));
  // Hash the bounds that will be stored. Writing them back onto ai_findings
  // must not change the next hash, so a second pass is a no-op.
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

  // A generic bathroom on this clip folds into the job's only specific bathroom
  // when the other proofs are in the same match. One clip cannot see that row.
  const siblings = await loadSiblingRoomClips(admin, String(row.job_id), proofId);
  const rooms = matchRoomsAcrossClips([...siblings, input]);
  const storedSegments = applyCrossClipRoomIdentity(proofId, segments, rooms);
  const locationByKey = new Map<string, string | null>();
  for (const room of rooms) {
    if (room.roomType === 'unclear') continue;
    const id = await upsertLocation(admin, {
      orgId: String(row.org_id),
      jobId: String(row.job_id),
      roomKey: room.roomKey,
      traits: room.traits,
    });
    locationByKey.set(room.roomKey, id);
  }

  await admin.from('clip_room_segments').delete().eq('proof_id', proofId).eq('user_corrected', false);
  if (storedSegments.length) {
    const { error: insertError } = await admin.from('clip_room_segments').insert(
      storedSegments.map((segment) => ({
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
      segments: storedSegments,
      locationByKey,
    });
  } catch {
    /* verification scenes are optional; the proof segments are the Ask source */
  }

  return { written: true, skipped: false, segments: segments.length };
}

export async function backfillClipRooms(
  admin: Admin,
  opts?: { apply?: boolean; jobId?: string | null; orgId?: string | null; limit?: number },
): Promise<{ scanned: number; written: number; skipped: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 500, 2000));
  let query = admin
    .from('job_proofs')
    .select('id')
    .is('deleted_at', null)
    .in('narration_status', ['done', 'skipped'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (opts?.jobId) query = query.eq('job_id', opts.jobId);
  if (opts?.orgId) query = query.eq('org_id', opts.orgId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let written = 0;
  let skipped = 0;
  for (const row of data ?? []) {
    if (!opts?.apply) {
      skipped += 1;
      continue;
    }
    const result = await refreshClipRooms(admin, String(row.id), 'backfill');
    if (result.written) written += 1;
    else skipped += 1;
  }
  return { scanned: (data ?? []).length, written, skipped };
}
