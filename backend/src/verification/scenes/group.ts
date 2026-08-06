/**
 * Scene / room grouping from sequence, visual similarity, and optional labels.
 *
 * Does not rely only on AI room names. User corrections are first-class.
 */

import { randomUUID } from 'node:crypto';
import { hammingDistanceHex } from '../quality/filter.js';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import type { RoomType } from '../types.js';
import { ROOM_TYPES } from '../types.js';

export interface SceneDraft {
  sequenceIndex: number;
  roomType: string;
  startSeconds: number;
  endSeconds: number;
  frameIds: string[];
  confidence: number;
  source: 'auto' | 'user' | 'floor_plan' | 'gps' | 'mixed';
}

const BOUNDARY_HAMMING = 18;

export function groupFramesIntoScenes(
  frames: Array<{
    id: string;
    timestampSeconds: number;
    perceptualHash: string | null;
    userRoomType?: string | null;
  }>,
  opts?: { minSceneSeconds?: number },
): SceneDraft[] {
  if (!frames.length) return [];
  const minScene = opts?.minSceneSeconds ?? 3;
  const scenes: SceneDraft[] = [];
  let current: SceneDraft = {
    sequenceIndex: 0,
    roomType: frames[0]!.userRoomType ?? 'unidentified',
    startSeconds: frames[0]!.timestampSeconds,
    endSeconds: frames[0]!.timestampSeconds,
    frameIds: [frames[0]!.id],
    confidence: frames[0]!.userRoomType ? 0.9 : 0.4,
    source: frames[0]!.userRoomType ? 'user' : 'auto',
  };

  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1]!;
    const frame = frames[i]!;
    const hashGap =
      prev.perceptualHash && frame.perceptualHash
        ? hammingDistanceHex(prev.perceptualHash, frame.perceptualHash)
        : 0;
    const userChanged =
      Boolean(frame.userRoomType) &&
      frame.userRoomType !== (prev.userRoomType ?? current.roomType);
    const boundary =
      userChanged ||
      (hashGap >= BOUNDARY_HAMMING &&
        frame.timestampSeconds - current.startSeconds >= minScene);

    if (boundary) {
      scenes.push(current);
      current = {
        sequenceIndex: scenes.length,
        roomType: frame.userRoomType ?? 'unidentified',
        startSeconds: frame.timestampSeconds,
        endSeconds: frame.timestampSeconds,
        frameIds: [frame.id],
        confidence: frame.userRoomType ? 0.9 : 0.45,
        source: frame.userRoomType ? 'user' : 'auto',
      };
    } else {
      current.frameIds.push(frame.id);
      current.endSeconds = frame.timestampSeconds;
      if (frame.userRoomType) {
        current.roomType = frame.userRoomType;
        current.source = current.source === 'auto' ? 'user' : 'mixed';
        current.confidence = Math.max(current.confidence, 0.85);
      }
    }
  }
  scenes.push(current);
  return scenes;
}

export function normalizeRoomType(raw: string | null | undefined): string {
  if (!raw) return 'unidentified';
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if ((ROOM_TYPES as readonly string[]).includes(cleaned)) return cleaned as RoomType;
  const aliases: Record<string, RoomType> = {
    bath: 'bathroom',
    powder_room: 'bathroom',
    master_bedroom: 'bedroom',
    living: 'living_room',
    family_room: 'living_room',
    outside: 'exterior',
    outdoor: 'exterior',
    mech: 'mechanical_room',
    utility: 'mechanical_room',
  };
  return aliases[cleaned] ?? (cleaned || 'unidentified');
}

export function createClassifyScenesHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { count } = await ctx.supabase
      .from('verification_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('video_id', ctx.videoId);
    if ((count ?? 0) > 0) {
      return { output: { sceneCount: count, reused: true } };
    }

    const { data: frames, error } = await ctx.supabase
      .from('verification_frames')
      .select('id, timestamp_seconds, perceptual_hash')
      .eq('video_id', ctx.videoId)
      .order('sequence_number', { ascending: true });
    if (error) throw new Error(error.message);

    const drafts = groupFramesIntoScenes(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (frames ?? []).map((f: any) => ({
        id: f.id,
        timestampSeconds: Number(f.timestamp_seconds),
        perceptualHash: f.perceptual_hash,
      })),
    );

    const rows = drafts.map((d) => ({
      id: randomUUID(),
      org_id: ctx.orgId,
      video_id: ctx.videoId,
      job_id: ctx.jobId,
      sequence_index: d.sequenceIndex,
      room_type: normalizeRoomType(d.roomType),
      start_seconds: d.startSeconds,
      end_seconds: d.endSeconds,
      confidence: d.confidence,
      source: d.source,
      metadata: { frameIds: d.frameIds },
    }));

    if (rows.length) {
      const { error: insertError } = await ctx.supabase.from('verification_scenes').insert(rows);
      if (insertError) throw new Error(insertError.message);

      for (const row of rows) {
        const frameIds = (row.metadata as { frameIds: string[] }).frameIds;
        if (frameIds.length) {
          await ctx.supabase
            .from('verification_frames')
            .update({ scene_id: row.id })
            .in('id', frameIds);
        }
      }
    }

    return { output: { sceneCount: rows.length } };
  };
}

export async function correctSceneRoom(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    sceneId: string;
    roomType: string;
    label?: string | null;
    locationId?: string | null;
    actorId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from('verification_scenes')
    .update({
      room_type: normalizeRoomType(opts.roomType),
      label: opts.label ?? null,
      location_id: opts.locationId ?? null,
      source: 'user',
      user_corrected: true,
      confidence: 1,
    })
    .eq('id', opts.sceneId)
    .eq('org_id', opts.orgId);
  if (error) throw new Error(error.message);
}
