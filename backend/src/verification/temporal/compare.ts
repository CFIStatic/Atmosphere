/**
 * Temporal comparison: change over time in the same room/area.
 *
 * A single frame is never enough to claim work was completed.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import type { VerificationStatus } from '../types.js';

export interface ObservationSnapshot {
  frameId: string;
  videoId: string;
  sceneId: string | null;
  roomType: string | null;
  timestampSeconds: number;
  observedAt: string | null;
  activities: string[];
  conditions: string[];
  equipment: string[];
  materials: string[];
  confidence: number;
}

export interface ChangeEventDraft {
  roomOrArea: string;
  beforeFrameIds: string[];
  afterFrameIds: string[];
  beforeVideoId: string | null;
  afterVideoId: string | null;
  beforeState: string;
  afterState: string;
  inferredActivity: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  confidence: number;
  evidence: string[];
  conflictingEvidence: string[];
  verificationStatus: VerificationStatus;
}

/** Map activities to implied before/after state labels used by rules. */
const ACTIVITY_STATES: Record<
  string,
  { before: string[]; after: string[]; activity: string }
> = {
  drywall_removed: {
    before: ['drywall_present', 'drywall_visible'],
    after: ['framing_exposed', 'drywall_removed', 'exposed_studs'],
    activity: 'drywall_removed',
  },
  insulation_installed: {
    before: ['framing_exposed', 'cavity_empty', 'cavity_exposed'],
    after: ['insulation_installed', 'insulation_present'],
    activity: 'insulation_installed',
  },
  drywall_installed: {
    before: ['framing_exposed', 'insulation_present'],
    after: ['drywall_installed', 'drywall_present', 'drywall_hung'],
    activity: 'drywall_installed',
  },
  flooring_removed: {
    before: ['flooring_present', 'damaged_flooring'],
    after: ['flooring_removed', 'subfloor_exposed'],
    activity: 'flooring_removed',
  },
  drying_equipment_installed: {
    before: ['no_equipment'],
    after: ['air_mover_present', 'dehumidifier_present', 'equipment_installed'],
    activity: 'drying_equipment_installed',
  },
  debris_removed: {
    before: ['debris_present'],
    after: ['debris_removed', 'area_cleared'],
    activity: 'debris_removed',
  },
  painting_completed: {
    before: ['primer_applied', 'unfinished_drywall', 'bare_drywall', 'unfinished_surface'],
    after: ['painting_completed', 'painted_wall', 'painted_surface'],
    activity: 'painting_completed',
  },
};

function tokensOf(obs: ObservationSnapshot): Set<string> {
  return new Set([
    ...obs.activities,
    ...obs.conditions,
    ...obs.equipment,
    ...obs.materials,
  ]);
}

function hasAny(set: Set<string>, needles: string[]): boolean {
  return needles.some((n) => set.has(n));
}

export function detectChangeEvents(
  observations: ObservationSnapshot[],
): ChangeEventDraft[] {
  if (observations.length < 2) return [];

  // Group by room
  const byRoom = new Map<string, ObservationSnapshot[]>();
  for (const obs of observations) {
    const key = obs.roomType || obs.sceneId || 'unidentified';
    const list = byRoom.get(key) ?? [];
    list.push(obs);
    byRoom.set(key, list);
  }

  const events: ChangeEventDraft[] = [];

  for (const [room, list] of byRoom) {
    const ordered = [...list].sort((a, b) => {
      const ta = a.observedAt ? Date.parse(a.observedAt) : a.timestampSeconds;
      const tb = b.observedAt ? Date.parse(b.observedAt) : b.timestampSeconds;
      return ta - tb;
    });

    for (const [activityKey, spec] of Object.entries(ACTIVITY_STATES)) {
      const befores = ordered.filter((o) => hasAny(tokensOf(o), [...spec.before, activityKey]));
      // "before" means states that precede the activity — prefer observations
      // that look like the earlier state without the after markers.
      const early = ordered.filter(
        (o) => hasAny(tokensOf(o), spec.before) && !hasAny(tokensOf(o), spec.after),
      );
      const late = ordered.filter((o) => hasAny(tokensOf(o), spec.after));

      if (!late.length) continue;

      // Prefer genuine before→after pairs; if only after exists, mark uncertain.
      const beforePool = early.length ? early : befores;
      const beforeObs = beforePool[0] ?? null;
      const afterObs = late[late.length - 1]!;

      if (beforeObs && beforeObs.frameId === afterObs.frameId) continue;
      if (beforeObs && beforeObs.timestampSeconds > afterObs.timestampSeconds) continue;

      const evidence: string[] = [];
      const conflicting: string[] = [];
      if (beforeObs) {
        evidence.push(
          `Before frame ${beforeObs.frameId}: ${[...tokensOf(beforeObs)].slice(0, 6).join(', ')}`,
        );
      } else {
        conflicting.push('missing_before_evidence');
      }
      evidence.push(
        `After frame ${afterObs.frameId}: ${[...tokensOf(afterObs)].slice(0, 6).join(', ')}`,
      );

      // Later contradiction: after markers disappear again with before markers returning.
      const laterContradiction = ordered.some(
        (o) =>
          o.timestampSeconds > afterObs.timestampSeconds &&
          hasAny(tokensOf(o), spec.before) &&
          !hasAny(tokensOf(o), spec.after),
      );
      if (laterContradiction) conflicting.push('later_frame_contradicts_removal');

      const supportCount = (beforeObs ? 1 : 0) + 1;
      const conf =
        (beforeObs?.confidence ?? 0.4) * 0.4 +
        afterObs.confidence * 0.4 +
        (beforeObs ? 0.15 : 0) +
        (conflicting.length ? -0.2 : 0.05);

      let status: VerificationStatus = 'uncertain';
      if (conflicting.includes('later_frame_contradicts_removal')) status = 'contradicted';
      else if (!beforeObs) status = 'uncertain';
      else if (supportCount >= 2 && conf >= 0.75 && !conflicting.length) status = 'likely_verified';
      else if (supportCount >= 2 && conf >= 0.55) status = 'uncertain';

      events.push({
        roomOrArea: room,
        beforeFrameIds: beforeObs ? [beforeObs.frameId] : [],
        afterFrameIds: [afterObs.frameId],
        beforeVideoId: beforeObs?.videoId ?? null,
        afterVideoId: afterObs.videoId,
        beforeState: beforeObs
          ? [...tokensOf(beforeObs)].find((t) => spec.before.includes(t)) ?? spec.before[0]!
          : 'unknown',
        afterState:
          [...tokensOf(afterObs)].find((t) => spec.after.includes(t)) ?? spec.after[0]!,
        inferredActivity: spec.activity,
        firstObservedAt: beforeObs?.observedAt ?? null,
        lastObservedAt: afterObs.observedAt,
        confidence: Number(Math.max(0, Math.min(1, conf)).toFixed(4)),
        evidence,
        conflictingEvidence: conflicting,
        verificationStatus: status,
      });
    }
  }

  return events;
}

export function createCompareTimelineHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    // Observations from this video plus other videos on the same job for true temporal compare.
    const { data: rows, error } = await ctx.supabase
      .from('frame_observations')
      .select(
        'frame_id, video_id, scene_id, room_type, work_activities, observed_conditions, equipment_present, materials_present, model_confidence, verification_frames!inner(timestamp_seconds), verification_videos!inner(capture_date, upload_date, job_id)',
      )
      .eq('org_id', ctx.orgId);
    if (error) throw new Error(error.message);

    const snapshots: ObservationSnapshot[] = (rows ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.verification_videos?.job_id === ctx.jobId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => ({
        frameId: r.frame_id,
        videoId: r.video_id,
        sceneId: r.scene_id,
        roomType: r.room_type,
        timestampSeconds: Number(r.verification_frames?.timestamp_seconds ?? 0),
        observedAt: r.verification_videos?.capture_date ?? r.verification_videos?.upload_date ?? null,
        activities: r.work_activities ?? [],
        conditions: r.observed_conditions ?? [],
        equipment: r.equipment_present ?? [],
        materials: r.materials_present ?? [],
        confidence: Number(r.model_confidence ?? 0),
      }));

    const events = detectChangeEvents(snapshots);

    // Replace prior auto events for this job from this pipeline run's videos — insert fresh.
    for (const event of events) {
      await ctx.supabase.from('temporal_change_events').insert({
        id: randomUUID(),
        org_id: ctx.orgId,
        job_id: ctx.jobId,
        room_or_area: event.roomOrArea,
        before_frame_ids: event.beforeFrameIds,
        after_frame_ids: event.afterFrameIds,
        before_video_id: event.beforeVideoId,
        after_video_id: event.afterVideoId,
        before_state: event.beforeState,
        after_state: event.afterState,
        inferred_activity: event.inferredActivity,
        first_observed_at: event.firstObservedAt,
        last_observed_at: event.lastObservedAt,
        confidence: event.confidence,
        evidence: event.evidence,
        conflicting_evidence: event.conflictingEvidence,
        verification_status: event.verificationStatus,
        activity_ontology_id: event.inferredActivity,
        candidate_status: 'proposed',
        scene_match_confidence: 0.7,
        evidence_quality_score: event.confidence,
      });
    }

    return { output: { changeEvents: events.length } };
  };
}
