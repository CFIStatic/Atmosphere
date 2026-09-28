/**
 * Read-only load for the job Timeline.
 *
 * Custody, memory, shares, and the library are fetched with GET. Nothing
 * here records a view, writes a chain-of-custody row, or opens a video.
 * Org-only reads are skipped for homeowner / grant viewers.
 */
import {
  api,
  type EvidenceShare,
  type JobAccessPerson,
  type JobCustodyExport,
  type MemoryEvent,
  type OfficeLiveSession,
  type OrgMember,
  type ProofResponse,
  type ScopeDocument,
  type SharedJobRecord,
} from '../../lib/api';
import { type TimelinePoster, type TimelineSource } from './jobTimeline';

const JOB_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isJobUuid(jobId: string): boolean {
  return JOB_UUID.test(jobId);
}

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function loadMemory(jobId: string): Promise<MemoryEvent[]> {
  if (!isJobUuid(jobId)) return [];
  const events: MemoryEvent[] = [];
  let before: number | undefined;
  for (let page = 0; page < 10; page += 1) {
    const res = await api.getMemory({ jobId, limit: 200, before });
    const batch = res.events ?? [];
    events.push(...batch.filter((event) => !event.jobId || event.jobId === jobId));
    if (res.nextCursor == null || batch.length === 0 || res.nextCursor === before) break;
    before = res.nextCursor;
  }
  return events;
}

async function loadMembers(jobId: string): Promise<OrgMember[]> {
  try {
    const mentioned = await api.getJobMentionMembers(jobId);
    if (mentioned.members?.length) return mentioned.members;
  } catch {
    /* fall through to the org roster */
  }
  try {
    const roster = await api.getMembers();
    return roster.members ?? [];
  } catch {
    return [];
  }
}

async function loadPosters(jobId: string): Promise<TimelinePoster[]> {
  const library = await api.evidenceLibrary(jobId);
  const posters: TimelinePoster[] = [];
  for (const item of library.items ?? []) {
    if (!item?.id || item.jobId !== jobId) continue;
    posters.push({
      id: item.id,
      jobId,
      posterUrl: item.posterUrl ?? null,
      title: item.title ?? null,
    });
  }
  return posters;
}

export async function loadJobTimelineSource(input: {
  jobId: string;
  record: SharedJobRecord | null;
  office: boolean;
}): Promise<TimelineSource> {
  const { jobId, record, office } = input;
  const proofs = await settled<ProofResponse | null>(api.jobProofs(jobId), null);

  if (!office) {
    return {
      jobId,
      record: record?.job.id === jobId ? record : null,
      proofs,
      memory: [],
      custody: null,
      shares: [],
      access: [],
      scopeDoc: null,
      liveSessions: [],
      posters: [],
      members: [],
    };
  }

  const [memory, custody, shares, access, scopeDoc, liveSessions, posters, members] =
    await Promise.all([
      settled(loadMemory(jobId), [] as MemoryEvent[]),
      settled<JobCustodyExport | null>(api.jobCustodyExport(jobId), null),
      settled(
        api.evidenceShares(jobId).then((res) => res.shares ?? []),
        [] as EvidenceShare[],
      ),
      settled(
        api.jobAccessRoster(jobId).then((res) => res.people ?? []),
        [] as JobAccessPerson[],
      ),
      settled<ScopeDocument | null>(
        api.scopeDocument(jobId).then((res) => res.doc ?? null),
        null,
      ),
      settled(
        api.jobLiveSessions(jobId).then((res) => res.sessions ?? []),
        [] as OfficeLiveSession[],
      ),
      settled(loadPosters(jobId), [] as TimelinePoster[]),
      settled(loadMembers(jobId), [] as OrgMember[]),
    ]);

  return {
    jobId,
    record: record?.job.id === jobId ? record : null,
    proofs,
    memory,
    custody,
    shares,
    access,
    scopeDoc,
    liveSessions,
    posters,
    members,
  };
}
