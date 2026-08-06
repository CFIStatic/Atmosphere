/**
 * Reporting API helpers — structured timelines for the frontend.
 */

import type { TimelineEvent, VerificationStatus } from '../types.js';

export interface ProjectVerificationSummary {
  jobId: string;
  videoCount: number;
  resultCount: number;
  byStatus: Record<string, number>;
  openReviews: number;
  timeline: TimelineEvent[];
}

function formatTitle(activity: string, room: string | null, status: string): string {
  const act = activity.replace(/_/g, ' ');
  const roomLabel = room ? room.replace(/_/g, ' ') : null;
  const verb =
    status === 'verified' || status === 'human_verified'
      ? 'verified'
      : status === 'likely_verified'
        ? 'likely verified'
        : status === 'rejected'
          ? 'rejected'
          : status === 'contradicted'
            ? 'contradicted'
            : 'observed';
  return roomLabel ? `${roomLabel} — ${act} ${verb}` : `${act} ${verb}`;
}

export async function getVideoProcessingStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  videoId: string,
) {
  const { data: video, error } = await supabase
    .from('verification_videos')
    .select(
      'id, job_id, status, status_detail, processing_error, duration_seconds, file_name, upload_date, thumbnail_path, proof_id',
    )
    .eq('id', videoId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!video) throw new Error('Video not found');

  const { data: jobs } = await supabase
    .from('video_processing_jobs')
    .select('id, status, current_stage, attempt_count, last_error, started_at, completed_at, result_summary')
    .eq('video_id', videoId)
    .order('created_at', { ascending: false })
    .limit(5);

  const latestJobId = jobs?.[0]?.id;
  let steps: unknown[] = [];
  if (latestJobId) {
    const { data } = await supabase
      .from('video_processing_steps')
      .select('stage, status, attempt_count, started_at, completed_at, last_error, output')
      .eq('processing_job_id', latestJobId)
      .order('stage');
    steps = data ?? [];
  }

  return { video, jobs: jobs ?? [], steps };
}

export async function getProjectVerificationReport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  jobId: string,
): Promise<ProjectVerificationSummary> {
  const { data: videos } = await supabase
    .from('verification_videos')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .is('deleted_at', null);

  const { data: results } = await supabase
    .from('verification_results')
    .select(
      'id, activity_type, room_or_area, title, summary, status, model_confidence, system_confidence, confidence_breakdown, observed_at, first_evidence_at, last_evidence_at, rule_version, ai_observation, rules_result, verification_evidence(frame_id, role, video_timestamp_seconds)',
    )
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('observed_at', { ascending: true, nullsFirst: false });

  const { count: openReviews } = await supabase
    .from('human_review_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .in('status', ['open', 'in_progress']);

  const byStatus: Record<string, number> = {};
  const timeline: TimelineEvent[] = [];

  for (const row of results ?? []) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    const evidence = row.verification_evidence ?? [];
    timeline.push({
      id: row.id,
      observedAt: row.observed_at ?? row.last_evidence_at ?? row.first_evidence_at,
      roomOrArea: row.room_or_area,
      title: row.title || formatTitle(row.activity_type, row.room_or_area, row.status),
      activityType: row.activity_type,
      status: row.status as VerificationStatus,
      systemConfidence:
        row.system_confidence === null || row.system_confidence === undefined
          ? null
          : Number(row.system_confidence),
      modelConfidence:
        row.model_confidence === null || row.model_confidence === undefined
          ? null
          : Number(row.model_confidence),
      summary: row.summary,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evidenceFrameIds: evidence.map((e: any) => e.frame_id).filter(Boolean),
      videoTimestamps: evidence
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((e: any) =>
          e.video_timestamp_seconds === null || e.video_timestamp_seconds === undefined
            ? null
            : Number(e.video_timestamp_seconds),
        )
        .filter((n: number | null): n is number => n !== null),
      reviewStatus: null,
    });
  }

  // Attach review status
  const { data: reviews } = await supabase
    .from('human_review_tasks')
    .select('result_id, status')
    .eq('org_id', orgId)
    .eq('job_id', jobId);
  const reviewByResult = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reviews ?? []).filter((r: any) => r.result_id).map((r: any) => [r.result_id, r.status]),
  );
  for (const event of timeline) {
    event.reviewStatus = (reviewByResult.get(event.id) as string | undefined) ?? null;
  }

  return {
    jobId,
    videoCount: (videos ?? []).length,
    resultCount: (results ?? []).length,
    byStatus,
    openReviews: openReviews ?? 0,
    timeline,
  };
}

export async function getResultDetail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  resultId: string,
) {
  const { data, error } = await supabase
    .from('verification_results')
    .select(
      `*,
       verification_evidence(*),
       temporal_change_events(*),
       human_review_tasks(id, status, reason, priority, human_review_decisions(*))`,
    )
    .eq('id', resultId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Result not found');
  return data;
}

/** Group timeline by room for room-by-room views. */
export function groupTimelineByRoom(timeline: TimelineEvent[]): Record<string, TimelineEvent[]> {
  const out: Record<string, TimelineEvent[]> = {};
  for (const event of timeline) {
    const key = event.roomOrArea || 'unidentified';
    (out[key] ??= []).push(event);
  }
  return out;
}
