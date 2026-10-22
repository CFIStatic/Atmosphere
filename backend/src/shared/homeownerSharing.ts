/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';

/**
 * Homeowner sharing delay (job_homeowner_permissions.share_delay_hours) and
 * per-clip overrides (job_homeowner_releases). A new upload reaches the
 * homeowner at upload time + delay. The office can share one early
 * ('share_now') or hold it from the homeowner until it says otherwise
 * ('hold'). Delay 0 and no overrides is what homeowners got before.
 *
 * Everything a homeowner sees of a clip (video, stills, transcript, AI
 * summary) hangs off that clip, so hiding the clip hides all of it. Chat and
 * the Evidence report read the whole job file, so they wait until nothing on
 * the job is pending for the homeowner (checked on the server).
 */

export const SHARE_DELAY_HOURS = [0, 24, 48, 72] as const;
export type ShareDelayHours = (typeof SHARE_DELAY_HOURS)[number];
export type HomeownerReleaseMode = 'share_now' | 'hold';

export type HomeownerSharing = {
  delayHours: number;
  /** Clip ids the homeowner may not see yet (pending delay or held). */
  hiddenProofIds: Set<string>;
  /** Per clip, when it becomes visible (null = held). Office display only. */
  visibleAt: Map<string, string | null>;
  overrides: Map<string, HomeownerReleaseMode>;
};

export function normalizeDelay(value: unknown): ShareDelayHours {
  const n = Number(value);
  return (SHARE_DELAY_HOURS as readonly number[]).includes(n) ? (n as ShareDelayHours) : 0;
}

/** When a clip becomes visible to the homeowner; null = held indefinitely. */
export function homeownerVisibleAt(
  receivedAt: string | null | undefined,
  delayHours: number,
  override: HomeownerReleaseMode | null | undefined,
): string | null {
  if (override === 'hold') return null;
  const base = receivedAt ? Date.parse(receivedAt) : NaN;
  if (override === 'share_now' || !Number.isFinite(base)) return receivedAt ?? new Date(0).toISOString();
  return new Date(base + delayHours * 3_600_000).toISOString();
}

export function computeHomeownerSharing(
  rows: Array<{ id: string; received_at?: string | null; created_at?: string | null }>,
  delayHours: number,
  overrides: Map<string, HomeownerReleaseMode>,
  now: number = Date.now(),
): HomeownerSharing {
  const hidden = new Set<string>();
  const visibleAt = new Map<string, string | null>();
  for (const row of rows) {
    const at = homeownerVisibleAt(row.received_at ?? row.created_at ?? null, delayHours, overrides.get(row.id));
    visibleAt.set(row.id, at);
    if (at === null || Date.parse(at) > now) hidden.add(row.id);
  }
  return { delayHours, hiddenProofIds: hidden, visibleAt, overrides };
}

function missingTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return /job_homeowner_(permissions|releases)|share_delay_hours|does not exist|schema cache/i.test(
    `${error.message ?? ''} ${error.code ?? ''}`,
  );
}

export async function loadShareDelay(admin: SupabaseClient, jobId: string): Promise<ShareDelayHours> {
  const { data, error } = await admin
    .from('job_homeowner_permissions')
    .select('share_delay_hours')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return 0;
    throw new HttpError(500, 'Could not load this job file\'s homeowner settings.', 'homeowner_permissions_failed');
  }
  return normalizeDelay((data as any)?.share_delay_hours);
}

/** The job's sharing state for a homeowner (fails closed on unexpected errors). */
export async function loadHomeownerSharing(admin: SupabaseClient, jobId: string): Promise<HomeownerSharing> {
  const delayHours = await loadShareDelay(admin, jobId);
  const { data: rel, error: relError } = await admin
    .from('job_homeowner_releases')
    .select('proof_id, mode')
    .eq('job_id', jobId);
  if (relError && !missingTable(relError)) {
    throw new HttpError(500, 'Could not load homeowner sharing.', 'homeowner_sharing_failed');
  }
  const overrides = new Map<string, HomeownerReleaseMode>();
  for (const r of ((relError ? [] : rel) ?? []) as any[]) {
    if (r.mode === 'share_now' || r.mode === 'hold') overrides.set(String(r.proof_id), r.mode);
  }
  if (delayHours === 0 && ![...overrides.values()].includes('hold')) {
    return { delayHours, hiddenProofIds: new Set(), visibleAt: new Map(), overrides };
  }
  const { data: proofs, error } = await admin
    .from('job_proofs')
    .select('id, received_at, created_at')
    .eq('job_id', jobId)
    .is('deleted_at', null);
  if (error) throw new HttpError(500, 'Could not load homeowner sharing.', 'homeowner_sharing_failed');
  return computeHomeownerSharing((proofs ?? []) as any[], delayHours, overrides);
}

type AccessLike = { access: 'org' | 'viewer'; homeownerSharing?: HomeownerSharing | null };

export function homeownerSharingOf(access: AccessLike): HomeownerSharing | null {
  return access.access === 'viewer' && access.homeownerSharing ? access.homeownerSharing : null;
}

/** 404 (as if it did not exist) when a homeowner asks for a clip not shared yet. */
export function assertHomeownerMaySeeProof(access: AccessLike, proofId: string): void {
  const s = homeownerSharingOf(access);
  if (s && s.hiddenProofIds.has(proofId)) throw new HttpError(404, 'No such video.', 'not_found');
}

/** Chat / Evidence report read the whole file: only once nothing is pending. */
export function assertNothingPendingForHomeowner(access: AccessLike): void {
  const s = homeownerSharingOf(access);
  if (s && s.hiddenProofIds.size > 0) {
    throw new HttpError(
      403,
      'Available once the contractor has shared everything on this job file.',
      'homeowner_sharing_pending',
    );
  }
}

/** The homeowner's videos payload without clips not shared yet. */
export function applyHomeownerSharingToProofPayload<T extends Record<string, any>>(
  payload: T,
  sharing: HomeownerSharing | null | undefined,
): T {
  if (!sharing || sharing.hiddenProofIds.size === 0) return payload;
  const hidden = sharing.hiddenProofIds;
  const videos = ((payload.videos ?? []) as any[]).filter((v) => !hidden.has(String(v.id)));
  const days = ((payload.days ?? []) as any[])
    .map((d) => (Array.isArray(d.proofIds) ? { ...d, proofIds: d.proofIds.filter((id: string) => !hidden.has(id)) } : d))
    .filter((d) => !Array.isArray(d.proofIds) || d.proofIds.length > 0);
  return {
    ...payload,
    videos,
    days,
    counts: { ...(payload.counts ?? {}), videos: videos.length, days: days.length },
  };
}

/** Office payload: each clip says when the homeowner sees it. */
export function annotateOfficeProofPayload<T extends Record<string, any>>(payload: T, sharing: HomeownerSharing): T {
  if (sharing.delayHours === 0 && sharing.overrides.size === 0) return payload;
  return {
    ...payload,
    homeownerShareDelayHours: sharing.delayHours,
    videos: ((payload.videos ?? []) as any[]).map((v) => {
      const id = String(v.id);
      const at = sharing.visibleAt.has(id)
        ? sharing.visibleAt.get(id)!
        : homeownerVisibleAt(v.receivedAt ?? null, sharing.delayHours, sharing.overrides.get(id));
      return { ...v, homeownerVisibleAt: at, homeownerRelease: sharing.overrides.get(id) ?? null };
    }),
  };
}

export async function setHomeownerRelease(
  admin: SupabaseClient,
  input: { orgId: string; jobId: string; proofId: string; userId: string; mode: HomeownerReleaseMode | 'default' },
): Promise<void> {
  const q =
    input.mode === 'default'
      ? admin.from('job_homeowner_releases').delete().eq('proof_id', input.proofId).eq('job_id', input.jobId)
      : admin.from('job_homeowner_releases').upsert(
          {
            proof_id: input.proofId,
            job_id: input.jobId,
            org_id: input.orgId,
            mode: input.mode,
            updated_by: input.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'proof_id' },
        );
  const { error } = await q;
  if (error) {
    if (missingTable(error)) throw new HttpError(503, 'Homeowner sharing is not available yet.', 'homeowner_sharing_unavailable');
    throw new HttpError(500, 'Could not update homeowner sharing.', 'homeowner_sharing_failed');
  }
}
