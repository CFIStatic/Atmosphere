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

/**
 * The job file a homeowner's Ask may read. Office notes and messages, task
 * details, crew, work logs, memory events, uploaded documents (estimates,
 * contracts) and model "concerns" on clips stay with the contractor. Job
 * identity, the brief and scope (as the share page already shows them),
 * invited companies and what the videos show/say remain.
 */
export function homeownerAskJobFile<
  F extends {
    messages?: unknown[] | null;
    tasks?: unknown[] | null;
    crew?: unknown[] | null;
    workLogs?: unknown[] | null;
    memory?: unknown[] | null;
    documents?: unknown[] | null;
    clips?: Array<Record<string, any>> | null;
  },
>(file: F): F {
  return {
    ...file,
    messages: [],
    tasks: [],
    crew: [],
    workLogs: [],
    memory: [],
    documents: [],
    clips: (file.clips ?? []).map((clip) => ({ ...clip, concerns: [] })),
  };
}

const FINDINGS_OFFICE_KEYS = ['concerns', 'scopeVerdicts', 'materialChange', 'disputes', 'checks', 'payable'];

/** Model findings a homeowner's Ask may read: what was seen and said, not the office's verdicts. */
export function homeownerFindings(findings: unknown): unknown {
  if (!findings || typeof findings !== 'object' || Array.isArray(findings)) return findings;
  const next: Record<string, unknown> = { ...(findings as Record<string, unknown>) };
  for (const key of FINDINGS_OFFICE_KEYS) delete next[key];
  return next;
}

/** Clip records a homeowner's Ask can quote, without office verdicts in their findings. */
export function homeownerAskClips<C extends { findings?: unknown }>(clips: C[]): C[] {
  return clips.map((clip) => ({ ...clip, findings: homeownerFindings(clip.findings) }));
}
