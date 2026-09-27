import { useEffect, useState } from 'react';
import { api, type OrgMember } from '../../lib/api';
import { mentionDisplayName, type MentionMember } from '../../lib/mentions';

const cached = new Map<string, MentionMember[]>();
const inflight = new Map<string, Promise<MentionMember[]>>();

function cacheKey(jobId?: string | null): string {
  return jobId ? `job:${jobId}` : 'org';
}

export function membersFromOrg(rows: OrgMember[]): MentionMember[] {
  return rows
    .map((row) => ({
      userId: row.userId,
      email: row.email,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl ?? null,
    }))
    .filter((row) => mentionDisplayName(row).length >= 2);
}

/** Org roster, or only the people on `jobId` when Ask is inside a job. */
export function loadOrgMentions(jobId?: string | null): Promise<MentionMember[]> {
  const key = cacheKey(jobId);
  const hit = cached.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = Promise.resolve()
    .then(() => (jobId ? api.getJobMentionMembers(jobId) : api.getMembers()))
    .then((res) => {
      const members = membersFromOrg(res.members ?? []);
      cached.set(key, members);
      return members;
    })
    .catch(() => [])
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

/** Roster for @ autocomplete. A job id limits the menu to people on that job. */
export function useOrgMentions(enabled: boolean, jobId?: string | null): MentionMember[] {
  const key = cacheKey(jobId);
  const [members, setMembers] = useState<MentionMember[]>(cached.get(key) ?? []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadOrgMentions(jobId).then((next) => {
      if (alive) setMembers(next);
    });
    return () => {
      alive = false;
    };
  }, [enabled, jobId]);
  return members;
}
