/**
 * Read a job's state for the suggestion rules. Service client, scoped by the
 * caller to one org and one job; every query filters on both.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  causeOfLossFrom,
  eventsFrom,
  mentionsMoistureReadings,
  milestonesFrom,
  roomKey,
  workOutsideScope,
  type JobEvent,
  type JobState,
  type Milestone,
} from './rules.js';

type Db = { from: (table: string) => any };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

export function proofText(row: any): string {
  const findings = row?.ai_findings ?? {};
  return [
    row?.ai_summary,
    row?.narration_text,
    typeof row?.transcript_text === 'string' ? row.transcript_text.slice(0, 6000) : null,
    ...strings(findings.workPerformed),
    ...strings(findings.concerns),
  ]
    .filter((t) => typeof t === 'string' && t.trim())
    .join('\n');
}

export async function loadJobState(admin: Db, input: { orgId: string; jobId: string }): Promise<JobState | null> {
  const { orgId, jobId } = input;
  const { data: job } = await admin
    .from('crm_jobs')
    .select('id, org_id, title, status, loss_type, description, deleted_at')
    .eq('org_id', orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (!job || job.deleted_at) return null;

  const [proofsRes, segmentsRes, docRoomsRes, estimateRes, scopeRes] = await Promise.all([
    admin
      .from('job_proofs')
      .select('id, created_at, ai_summary, narration_text, transcript_text, ai_findings, analysis_status')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(300),
    admin
      .from('clip_room_segments')
      .select('proof_id, room_name, room_key, findings')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .limit(2000),
    admin.from('job_document_rooms').select('name').eq('org_id', orgId).eq('job_id', jobId).limit(200),
    admin
      .from('job_chat_documents')
      .select('id, created_at')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .eq('doc_kind', 'estimate')
      .eq('status', 'ready')
      .order('created_at', { ascending: true })
      .limit(1),
    admin
      .from('job_scope_items')
      .select('title, state, created_at')
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .in('state', ['included', 'approved'])
      .limit(500),
  ]);

  const proofs = ((proofsRes?.data ?? []) as any[]).filter((p) => p.analysis_status === 'done' || p.ai_summary);
  const proofAt = new Map<string, string>(proofs.map((p) => [p.id, p.created_at]));
  const segments = ((segmentsRes?.data ?? []) as any[]).filter((s) => proofAt.has(s.proof_id));
  const scope = (scopeRes?.data ?? []) as any[];
  const estimateDoc = ((estimateRes?.data ?? []) as any[])[0] ?? null;

  const estimate = estimateDoc
    ? { ref: `doc:${estimateDoc.id}`, at: estimateDoc.created_at as string, scopeTitles: scope.map((s) => s.title) }
    : scope.length
      ? {
          ref: 'scope',
          at: scope.map((s) => s.created_at as string).sort()[0] ?? null,
          scopeTitles: scope.map((s) => s.title),
        }
      : null;

  const roomsOnVideo: string[] = [];
  const affectedRooms: string[] = [];
  const damageFirstSeen = new Map<string, { name: string; at: string }>();
  for (const seg of segments) {
    roomsOnVideo.push(seg.room_name);
    const damaged = Array.isArray(seg.findings) && seg.findings.some((f: any) => f?.kind === 'damage');
    if (!damaged) continue;
    affectedRooms.push(seg.room_name);
    const at = proofAt.get(seg.proof_id) ?? '';
    const key = roomKey(seg.room_key || seg.room_name);
    const prev = damageFirstSeen.get(key);
    if (!prev || at < prev.at) damageFirstSeen.set(key, { name: seg.room_name, at });
  }

  const newDamageRoomsSinceEstimate =
    estimate?.at ? [...damageFirstSeen.values()].filter((r) => r.at > estimate.at!).map((r) => r.name) : [];

  const workAfter = estimate?.at
    ? proofs.filter((p) => p.created_at > estimate.at!).flatMap((p) => strings(p.ai_findings?.workPerformed))
    : [];
  const workNotInEstimate = estimate ? workOutsideScope(workAfter, estimate.scopeTitles) : [];

  let moistureReadings = false;
  let causeOfLoss: string | null = null;
  const milestones = new Set<Milestone>();
  const events: JobEvent[] = [];
  const jobText = String(job.description ?? '');
  causeOfLoss = causeOfLossFrom(jobText);
  for (const p of proofs) {
    const text = proofText(p);
    if (!text) continue;
    if (!moistureReadings && mentionsMoistureReadings(text)) moistureReadings = true;
    if (!causeOfLoss) causeOfLoss = causeOfLossFrom(text);
    for (const m of milestonesFrom(text)) milestones.add(m);
    events.push(...eventsFrom(p.id, text));
  }
  // For fire, storm and the like the loss type names the cause; a water or
  // mold loss still needs its source (burst pipe, roof leak, …) on the record.
  if (!causeOfLoss && job.loss_type && !['water', 'mold', 'other'].includes(job.loss_type)) {
    causeOfLoss = `${job.loss_type} loss`;
  }

  return {
    jobId,
    orgId,
    title: String(job.title ?? 'Job'),
    status: job.status ?? null,
    lossType: job.loss_type ?? null,
    analyzedClipCount: proofs.length,
    roomsOnVideo,
    affectedRooms,
    expectedRooms: ((docRoomsRes?.data ?? []) as any[]).map((r) => String(r.name ?? '')).filter(Boolean),
    moistureReadings,
    causeOfLoss,
    estimate,
    newDamageRoomsSinceEstimate,
    workNotInEstimate,
    milestones: [...milestones],
    events: events.slice(-20),
  };
}
