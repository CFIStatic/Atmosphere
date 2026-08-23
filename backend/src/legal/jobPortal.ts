/**
 * Job-scoped legal hold.
 *
 * Nobody in the customer's office opens one of these any more — the switch
 * moved inside, to the legal desk and to the automatic preservation rules in
 * `autoHold.ts`. What stays here is the mechanism: freeze a whole job file,
 * and let every clip that arrives while the hold is open inherit the freeze.
 * Staff produce the vault, including clips the customer later hid.
 */
import { adminOrNull } from '../lib/adminClient.js';
import { HttpError } from '../lib/errors.js';
import { createLegalHold, jobHasOpenHold, openHoldsForJob, releaseLegalHold } from './holds.js';
import { activityForSubjects, listUserActivity } from './monitor.js';
import { listVaultedVideos } from './vault.js';
import type {
  LegalHoldKind,
  LegalHoldOrigin,
  LegalHoldRecord,
  LegalVaultEntry,
  UserActivityEvent,
} from './types.js';

export type JobLegalClip = {
  id: string;
  title: string | null;
  workDate: string | null;
  phase: string | null;
  company: string | null;
  legalHold: boolean;
  userDeleted: boolean;
  contentHash: string | null;
  durationSeconds: number | null;
  byteSize: number | null;
  receivedAt: string | null;
};

export type JobLegalPortal = {
  job: { id: string; title: string | null; jobNumber: number | null; orgId: string };
  hold: LegalHoldRecord | null;
  holds: LegalHoldRecord[];
  clips: JobLegalClip[];
  counts: {
    clips: number;
    onHold: number;
    userDeleted: number;
    jobOnHold: boolean;
  };
};

export type StaffJobLegalPortal = JobLegalPortal & {
  videos: LegalVaultEntry[];
  activity: UserActivityEvent[];
};

export async function openJobLegalHold(input: {
  orgId: string;
  jobId: string;
  jobTitle?: string | null;
  kind: LegalHoldKind;
  reason: string;
  caseNumber?: string | null;
  title?: string | null;
  counselName?: string | null;
  origin?: LegalHoldOrigin;
  autoRule?: string | null;
  reviewBy?: string | null;
  createdBy?: string | null;
}): Promise<LegalHoldRecord> {
  const existing = (await openHoldsForJob(input.jobId)).find((hold) =>
    hold.subjects.some((subject) => subject.subjectType === 'job' && subject.subjectId === input.jobId),
  );
  if (existing) {
    throw new HttpError(409, 'This job is already on legal hold.', 'job_already_on_hold');
  }
  const short = input.jobId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return createLegalHold({
    caseNumber: input.caseNumber?.trim() || `JOB-${short}-${Date.now()}`,
    kind: input.kind,
    title: input.title?.trim() || input.jobTitle?.trim() || `Legal hold · ${short}`,
    reason: input.reason.trim(),
    counselName: input.counselName ?? null,
    origin: input.origin ?? 'staff',
    autoRule: input.autoRule ?? null,
    reviewBy: input.reviewBy ?? null,
    createdBy: input.createdBy ?? null,
    subjects: [{ subjectType: 'job', subjectId: input.jobId }],
  });
}

export async function releaseJobLegalHold(
  jobId: string,
  input: { releasedBy?: string | null; reason: string },
): Promise<LegalHoldRecord> {
  const hold = (await openHoldsForJob(jobId)).find((row) =>
    row.subjects.some((subject) => subject.subjectType === 'job' && subject.subjectId === jobId),
  );
  if (!hold) throw new HttpError(404, 'This job is not on legal hold.', 'job_hold_not_found');
  const released = await releaseLegalHold(hold.id, input);
  const admin = adminOrNull();
  if (admin) {
    await admin
      .from('job_proofs')
      .update({ legal_hold: false, hold_reason: null })
      .eq('job_id', jobId)
      .eq('hold_reason', hold.reason);
  }
  return released;
}

export async function applyOpenHoldToProof(input: {
  orgId: string;
  jobId: string;
  proofId: string;
}): Promise<void> {
  const hold = await jobHasOpenHold(input.jobId, input.orgId);
  if (!hold) return;
  const admin = adminOrNull();
  if (!admin) return;
  await admin
    .from('job_proofs')
    .update({ legal_hold: true, hold_reason: hold.reason })
    .eq('id', input.proofId);
}

export async function buildStaffJobLegalPortal(input: {
  orgId?: string | null;
  jobId: string;
  jobTitle?: string | null;
  jobNumber?: number | null;
}): Promise<StaffJobLegalPortal> {
  const videos = (await listVaultedVideos()).filter((video) => video.jobId === input.jobId);
  const holds = await openHoldsForJob(input.jobId, input.orgId ?? videos[0]?.orgId ?? null);
  const activity = activityForSubjects(await listUserActivity({ limit: 1000 }), [
    { subjectType: 'job', subjectId: input.jobId },
    ...holds.flatMap((hold) => hold.subjects),
  ]);
  const clips: JobLegalClip[] = videos.map((video) => ({
    id: video.id,
    title: (video.metadata.phase as string | undefined)
      ? `${String(video.metadata.phase)} · ${String(video.metadata.workDate ?? '')}`
      : video.sourceId,
    workDate: (video.metadata.workDate as string | undefined) ?? null,
    phase: (video.metadata.phase as string | undefined) ?? null,
    company: null,
    legalHold: holds.length > 0,
    userDeleted: Boolean(video.userDeletedAt),
    contentHash: video.contentHash,
    durationSeconds: video.durationSeconds,
    byteSize: video.byteSize,
    receivedAt: video.receivedAt,
  }));
  const jobHold =
    holds.find((hold) =>
      hold.subjects.some((subject) => subject.subjectType === 'job' && subject.subjectId === input.jobId),
    ) ?? holds[0] ?? null;
  return {
    job: {
      id: input.jobId,
      title: input.jobTitle ?? null,
      jobNumber: input.jobNumber ?? null,
      orgId: input.orgId ?? videos[0]?.orgId ?? '',
    },
    hold: jobHold,
    holds,
    clips,
    counts: {
      clips: clips.length,
      onHold: clips.filter((clip) => clip.legalHold).length,
      userDeleted: clips.filter((clip) => clip.userDeleted).length,
      jobOnHold: holds.length > 0,
    },
    videos,
    activity,
  };
}
