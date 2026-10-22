/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';

/**
 * What the general contractor lets the invited homeowner see and do on one
 * job file (public.job_homeowner_permissions). No row means everything on,
 * which is what a homeowner got before this setting existed: the carbon copy
 * of the contractor's job file.
 *
 * These sit on top of the always-on homeowner rules (no pay, disputes,
 * internal or analyst notes, nothing that changes the job). Those are not
 * settings and cannot be turned back on here.
 *
 * Chat and the Evidence report are built from the videos, transcripts, AI
 * summaries and scope, so they only work while all of those are on; turning
 * one off turns them off too (the server enforces the effective value).
 */

export const HOMEOWNER_PERMISSION_KEYS = [
  'seeVideos',
  'seeTranscripts',
  'seeAiSummaries',
  'seeScope',
  'seeEvidenceReport',
  'seeAccessList',
  'useChat',
  'downloadFiles',
] as const;

export type HomeownerPermissionKey = (typeof HOMEOWNER_PERMISSION_KEYS)[number];
export type HomeownerPermissions = Record<HomeownerPermissionKey, boolean>;

export const DEFAULT_HOMEOWNER_PERMISSIONS: HomeownerPermissions = Object.freeze({
  seeVideos: true,
  seeTranscripts: true,
  seeAiSummaries: true,
  seeScope: true,
  seeEvidenceReport: true,
  seeAccessList: true,
  useChat: true,
  downloadFiles: true,
}) as HomeownerPermissions;

const COLUMN: Record<HomeownerPermissionKey, string> = {
  seeVideos: 'see_videos',
  seeTranscripts: 'see_transcripts',
  seeAiSummaries: 'see_ai_summaries',
  seeScope: 'see_scope',
  seeEvidenceReport: 'see_evidence_report',
  seeAccessList: 'see_access_list',
  useChat: 'use_chat',
  downloadFiles: 'download_files',
};

/** Stored flags from a row (snake_case); missing or non-boolean = default (on). */
export function homeownerPermissionsFromRow(row: Record<string, unknown> | null | undefined): HomeownerPermissions {
  const out = { ...DEFAULT_HOMEOWNER_PERMISSIONS };
  if (!row) return out;
  for (const key of HOMEOWNER_PERMISSION_KEYS) {
    const v = row[COLUMN[key]];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

export function homeownerPermissionsToRow(perms: HomeownerPermissions): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of HOMEOWNER_PERMISSION_KEYS) out[COLUMN[key]] = perms[key];
  return out;
}

/** What the server actually allows, after the Chat / Evidence report dependencies. */
export function effectiveHomeownerPermissions(stored: HomeownerPermissions): HomeownerPermissions {
  const content = stored.seeVideos && stored.seeTranscripts && stored.seeAiSummaries && stored.seeScope;
  return {
    ...stored,
    useChat: stored.useChat && content,
    seeEvidenceReport: stored.seeEvidenceReport && content,
    downloadFiles: stored.downloadFiles && stored.seeVideos,
  };
}

function missingTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return /job_homeowner_permissions|does not exist|schema cache/i.test(`${error.message ?? ''} ${error.code ?? ''}`);
}

/** Stored settings for a job (defaults when none, or before the migration is applied). */
export async function loadStoredHomeownerPermissions(
  admin: SupabaseClient,
  jobId: string,
): Promise<HomeownerPermissions> {
  const { data, error } = await admin
    .from('job_homeowner_permissions')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return { ...DEFAULT_HOMEOWNER_PERMISSIONS };
    // Fail closed: a homeowner gets nothing optional if we cannot read the settings.
    throw new HttpError(500, 'Could not load this job file\'s homeowner settings.', 'homeowner_permissions_failed');
  }
  return homeownerPermissionsFromRow(data as Record<string, unknown> | null);
}

/** Effective permissions for a homeowner on a job. */
export async function loadHomeownerPermissions(admin: SupabaseClient, jobId: string): Promise<HomeownerPermissions> {
  return effectiveHomeownerPermissions(await loadStoredHomeownerPermissions(admin, jobId));
}

export async function saveHomeownerPermissions(
  admin: SupabaseClient,
  input: { orgId: string; jobId: string; userId: string; permissions: HomeownerPermissions },
): Promise<HomeownerPermissions> {
  const { data, error } = await admin
    .from('job_homeowner_permissions')
    .upsert(
      {
        job_id: input.jobId,
        org_id: input.orgId,
        ...homeownerPermissionsToRow(input.permissions),
        updated_at: new Date().toISOString(),
        updated_by: input.userId,
      },
      { onConflict: 'job_id' },
    )
    .select('*')
    .single();
  if (error) {
    if (missingTable(error)) {
      throw new HttpError(503, 'Homeowner settings are not available yet.', 'homeowner_permissions_unavailable');
    }
    throw new HttpError(500, 'Could not save homeowner settings.', 'homeowner_permissions_failed');
  }
  return homeownerPermissionsFromRow(data as Record<string, unknown>);
}

/** The access shape carried by resolveOrgOrViewerAccess. */
type AccessLike = { access: 'org' | 'viewer'; homeownerPermissions?: HomeownerPermissions | null };

/** Permissions that apply to this caller, or null when they are not limited (office, sub). */
export function homeownerLimits(access: AccessLike): HomeownerPermissions | null {
  return access.access === 'viewer' && access.homeownerPermissions ? access.homeownerPermissions : null;
}

/** 403 when the caller is a homeowner and the contractor turned this off. */
export function assertHomeownerMay(access: AccessLike, key: HomeownerPermissionKey): void {
  const limits = homeownerLimits(access);
  if (limits && !limits[key]) {
    throw new HttpError(403, 'The contractor has not shared this on the job file.', 'homeowner_permission_denied');
  }
}

/** One clip/video card as the homeowner may see it under these permissions. */
export function applyHomeownerPermissionsToVideo<V extends Record<string, any>>(video: V, perms: HomeownerPermissions): V {
  const next: any = { ...video };
  if (!perms.seeTranscripts) {
    next.transcriptText = null;
    next.heardOnMic = null;
    next.transcriptSegments = [];
    next.transcriptWords = [];
    next.dictationEntries = [];
    if ('transcript' in next) next.transcript = null;
    if ('quotes' in next) next.quotes = [];
  }
  if (!perms.seeAiSummaries) {
    next.aiSummary = null;
    next.conversation = null;
    next.events = [];
    if ('summary' in next) next.summary = null;
    if ('aiTitle' in next) next.aiTitle = null;
    if ('findings' in next) next.findings = null;
    if (Array.isArray(next.rooms)) next.rooms = next.rooms.map((r: any) => ({ ...r, findings: [] }));
  }
  if (!perms.downloadFiles) {
    if ('downloadUrl' in next) next.downloadUrl = null;
  }
  return next;
}

/**
 * The homeowner's videos payload (already through homeownerProofPayload)
 * under the contractor's settings. Videos off empties the list.
 */
export function applyHomeownerPermissionsToProofPayload<T extends Record<string, any>>(
  payload: T,
  perms: HomeownerPermissions | null | undefined,
): T {
  if (!perms) return payload;
  const safe: any = { ...payload, homeownerPermissions: perms };
  if (!perms.seeVideos) {
    return {
      ...safe,
      videos: [],
      days: [],
      rooms: [],
      counts: { ...(safe.counts ?? {}), days: 0, videos: 0, analysing: 0, awaitingAfter: 0 },
    };
  }
  safe.videos = ((safe.videos ?? []) as any[]).map((v) => applyHomeownerPermissionsToVideo(v, perms));
  if (!perms.seeAiSummaries) {
    safe.days = ((safe.days ?? []) as any[]).map((d) => ({ ...d, aiSummary: null, summary: '' }));
    safe.rooms = [];
  }
  return safe;
}

/**
 * One Videos-library / clip-panel item (serializeEvidence shape) as the
 * homeowner may see it. `analysis` mixes the AI reading with the spoken
 * transcript, so it goes whole when either is off.
 */
export function applyHomeownerPermissionsToLibraryItem<I extends Record<string, any>>(
  item: I,
  perms: HomeownerPermissions | null | undefined,
): I {
  if (!perms || !item) return item;
  const next: any = { ...item };
  if (!perms.seeTranscripts) {
    next.transcriptWords = [];
    next.hasTranscript = false;
  }
  if (!perms.seeAiSummaries) {
    next.aiTitle = null;
    if (!next.customTitle) next.title = null;
    next.hasAiSummary = false;
    next.hasSummary = false;
  }
  if (!perms.seeTranscripts || !perms.seeAiSummaries) next.analysis = null;
  return next;
}
