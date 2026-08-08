/**
 * Lightweight clip records around temporal change candidates.
 * Storage of actual video bytes is optional — metadata always recorded.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';

export async function createClipsForChangeEvents(ctx: PipelineContext): Promise<number> {
  const { data: events, error } = await ctx.supabase
    .from('temporal_change_events')
    .select('id, before_frame_ids, after_frame_ids, before_video_id, after_video_id')
    .eq('job_id', ctx.jobId)
    .eq('org_id', ctx.orgId)
    .limit(50);
  if (error) throw new Error(error.message);

  let created = 0;
  for (const event of events ?? []) {
    const frameIds = [...(event.before_frame_ids ?? []), ...(event.after_frame_ids ?? [])];
    if (!frameIds.length) continue;

    const { data: frames } = await ctx.supabase
      .from('verification_frames')
      .select('id, timestamp_seconds, video_id')
      .in('id', frameIds);
    if (!frames?.length) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stamps = frames.map((f: any) => Number(f.timestamp_seconds));
    const start = Math.max(0, Math.min(...stamps) - 1);
    const end = Math.max(...stamps) + 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videoId = frames[0]?.video_id ?? event.after_video_id ?? ctx.videoId;

    const { data: existing } = await ctx.supabase
      .from('video_clips')
      .select('id')
      .eq('change_event_id', event.id)
      .maybeSingle();
    if (existing) continue;

    await ctx.supabase.from('video_clips').insert({
      id: randomUUID(),
      org_id: ctx.orgId,
      video_id: videoId,
      job_id: ctx.jobId,
      change_event_id: event.id,
      start_seconds: start,
      end_seconds: Math.max(end, start + 0.5),
      frame_ids: frameIds,
      reason: 'change_candidate',
    });
    created += 1;
  }
  return created;
}
