/**
 * Platform legal holds — subpoena, lawsuit, preservation, investigation.
 *
 * Staff create a hold against an org, a user, a job, or a specific video.
 * Matching catalog rows are marked legal_hold so retention cannot expire them.
 * User delete still hides the clip from the product; the vault keeps it.
 */
import { adminOrNull } from '../lib/adminClient.js';
import { HttpError } from '../lib/errors.js';
import {
  createHoldRecord,
  getHoldFromMemory,
  listHoldsFromMemory,
  loadHold,
  loadHolds,
  persistHold,
  persistHoldRelease,
  releaseHoldInMemory,
} from './store.js';
import { listVaultedVideos } from './vault.js';
import type { CreateHoldInput, LegalHoldRecord, LegalHoldSubject, LegalVaultEntry } from './types.js';

export async function createLegalHold(input: CreateHoldInput): Promise<LegalHoldRecord> {
  if (!input.subjects.length) {
    throw new HttpError(400, 'A hold must name at least one org, user, job, or video.', 'subjects_required');
  }
  const existing = (await loadHolds()).find(
    (hold) => hold.caseNumber.toLowerCase() === input.caseNumber.trim().toLowerCase() && hold.status === 'open',
  );
  if (existing) {
    throw new HttpError(409, 'An open hold already uses that case number.', 'case_number_in_use');
  }
  const record = createHoldRecord(input);
  await persistHold(record);
  await applyHoldFlags(record);
  return record;
}

export async function listLegalHolds(): Promise<LegalHoldRecord[]> {
  return loadHolds();
}

export async function getLegalHold(id: string): Promise<LegalHoldRecord> {
  const record = await loadHold(id);
  if (!record) throw new HttpError(404, 'Legal hold not found', 'legal_hold_not_found');
  return record;
}

export async function releaseLegalHold(
  id: string,
  input: { releasedBy?: string | null; reason: string },
): Promise<LegalHoldRecord> {
  if (!input.reason.trim()) {
    throw new HttpError(400, 'Say why the hold is being released.', 'reason_required');
  }
  await loadHold(id);
  const record = releaseHoldInMemory(id, input);
  await persistHoldRelease(record);
  return record;
}

export function holdCovers(
  hold: LegalHoldRecord,
  video: Pick<LegalVaultEntry, 'orgId' | 'jobId' | 'actorUserId' | 'sourceKind' | 'sourceId'>,
): boolean {
  return hold.subjects.some((subject) => subjectMatches(subject, video));
}

export function subjectMatches(
  subject: LegalHoldSubject,
  video: Pick<LegalVaultEntry, 'orgId' | 'jobId' | 'actorUserId' | 'sourceKind' | 'sourceId'>,
): boolean {
  if (subject.subjectType === 'org') return video.orgId === subject.subjectId;
  if (subject.subjectType === 'job') return video.jobId === subject.subjectId;
  if (subject.subjectType === 'user') return video.actorUserId === subject.subjectId;
  if (subject.subjectType === 'proof') {
    return video.sourceKind === 'job_proof' && video.sourceId === subject.subjectId;
  }
  if (subject.subjectType === 'media') {
    return video.sourceKind === 'media_object' && video.sourceId === subject.subjectId;
  }
  return false;
}

export async function videosForHold(hold: LegalHoldRecord): Promise<LegalVaultEntry[]> {
  const videos = await listVaultedVideos();
  return videos.filter((video) => holdCovers(hold, video));
}

export function isUnderOpenHold(
  video: Pick<LegalVaultEntry, 'orgId' | 'jobId' | 'actorUserId' | 'sourceKind' | 'sourceId'>,
  openHolds = listHoldsFromMemory().filter((hold) => hold.status === 'open'),
): boolean {
  return openHolds.some((hold) => holdCovers(hold, video));
}

async function applyHoldFlags(hold: LegalHoldRecord): Promise<void> {
  const admin = adminOrNull();
  if (!admin) return;
  const videos = await videosForHold(hold);
  const proofIds = videos.filter((v) => v.sourceKind === 'job_proof').map((v) => v.sourceId);
  const mediaIds = videos.filter((v) => v.sourceKind === 'media_object').map((v) => v.sourceId);
  const orgIds = hold.subjects.filter((s) => s.subjectType === 'org').map((s) => s.subjectId);
  const jobIds = hold.subjects.filter((s) => s.subjectType === 'job').map((s) => s.subjectId);

  if (orgIds.length) {
    await admin.from('job_proofs').update({ legal_hold: true, hold_reason: hold.reason }).in('org_id', orgIds);
    await admin.from('media_objects').update({ legal_hold: true }).in('org_id', orgIds);
  }
  if (jobIds.length) {
    await admin.from('job_proofs').update({ legal_hold: true, hold_reason: hold.reason }).in('job_id', jobIds);
  }
  if (proofIds.length) {
    await admin.from('job_proofs').update({ legal_hold: true, hold_reason: hold.reason }).in('id', proofIds);
  }
  if (mediaIds.length) {
    await admin.from('media_objects').update({ legal_hold: true }).in('id', mediaIds);
  }
}

export function requireOpenHold(id: string): LegalHoldRecord {
  const record = getHoldFromMemory(id);
  if (!record) throw new HttpError(404, 'Legal hold not found', 'legal_hold_not_found');
  return record;
}

export async function openHoldsForJob(jobId: string, orgId?: string | null): Promise<LegalHoldRecord[]> {
  const holds = (await loadHolds()).filter((hold) => hold.status === 'open');
  return holds.filter((hold) =>
    hold.subjects.some(
      (subject) =>
        (subject.subjectType === 'job' && subject.subjectId === jobId) ||
        (orgId != null && subject.subjectType === 'org' && subject.subjectId === orgId),
    ),
  );
}

export async function jobHasOpenHold(
  jobId: string,
  orgId?: string | null,
): Promise<LegalHoldRecord | null> {
  const holds = await openHoldsForJob(jobId, orgId);
  return holds[0] ?? null;
}
