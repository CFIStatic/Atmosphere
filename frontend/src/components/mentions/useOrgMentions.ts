import { useEffect, useState } from 'react';
import { api, type OrgMember } from '../../lib/api';
import { assignOrgHandles, type MentionMember } from '../../lib/mentions';

let cached: MentionMember[] | null = null;
let inflight: Promise<MentionMember[]> | null = null;

export function membersFromOrg(rows: OrgMember[]): MentionMember[] {
  return assignOrgHandles(
    rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      fullName: row.fullName,
      handle: row.handle ?? null,
    })),
  ).map((row) => ({
    userId: row.userId,
    handle: row.handle,
    fullName: row.fullName,
    email: row.email,
  }));
}

export function loadOrgMentions(): Promise<MentionMember[]> {
  if (cached !== null) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = Promise.resolve()
    .then(() => api.getMembers())
    .then((res) => {
      cached = membersFromOrg(res.members ?? []);
      return cached;
    })
    .catch(() => [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Org roster for @ autocomplete. Loaded once the composer asks for it. */
export function useOrgMentions(enabled: boolean): MentionMember[] {
  const [members, setMembers] = useState<MentionMember[]>(cached ?? []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadOrgMentions().then((next) => {
      if (alive) setMembers(next);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return members;
}
