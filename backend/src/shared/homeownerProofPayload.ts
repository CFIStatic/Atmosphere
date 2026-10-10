/* eslint-disable @typescript-eslint/no-explicit-any */
import { redactProofDeviceIdentity } from './deviceIdentity.js';

/**
 * What an invited homeowner may see of a job's videos. The office payload
 * also carries pay decisions, disputes, the punch list (with assigned task
 * notes), raw model findings, integrity checks, hashes, device identity and
 * pipeline errors; none of that is the homeowner's. Deleted clips are already
 * excluded by the list query.
 */
const DAY_DROP = [
  'payable',
  'payableBecause',
  'accepted',
  'rejected',
  'checks',
  'contradicted',
  'aiFindings',
  'materialChange',
  'analysisError',
  'reports',
] as const;

const VIDEO_DROP = [
  'contentHash',
  'device',
  'checks',
  'evidenceLog',
  'disputes',
  'transcriptError',
  'proofState',
] as const;

export function homeownerProofPayload<T extends Record<string, any>>(payload: T): T {
  const safe: any = redactProofDeviceIdentity(payload as any);
  const days = ((safe.days ?? []) as any[]).map((day) => {
    const next: any = { ...day, summary: day.aiSummary ?? '' };
    for (const key of DAY_DROP) delete next[key];
    return next;
  });
  const videos = ((safe.videos ?? []) as any[]).map((video) => {
    const next: any = { ...video };
    for (const key of VIDEO_DROP) delete next[key];
    return next;
  });
  return {
    ...safe,
    days,
    videos,
    disputes: [],
    punchList: [],
    siteKnown: undefined,
    counts: {
      ...(safe.counts ?? {}),
      payable: 0,
      contradicted: 0,
      disputes: 0,
      punchList: 0,
    },
  };
}
