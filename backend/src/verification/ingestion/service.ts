/**
 * Video ingestion: create upload records, signed paths, validation.
 *
 * Videos never pass through Express. The client gets a signed upload URL for
 * the private `job-proofs` (or configured) bucket, uploads directly, then
 * completes the record so processing can be enqueued.
 */

import { createHash, randomUUID } from 'node:crypto';
import { verificationConfig } from '../config.js';
import { createVideoUploadSchema, completeVideoUploadSchema } from '../schemas.js';
import type { DeviceMetadata, VideoMimeType, VideoStatus } from '../types.js';
import { ALLOWED_VIDEO_MIME_TYPES } from '../types.js';
import { appendAuditEvent } from '../audit/auditLog.js';

export interface IngestionDeps {
  /** User-scoped or admin Supabase client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  orgId: string;
  uploaderId: string | null;
}

export interface CreateUploadInput {
  jobId: string;
  partyId?: string | null;
  proofId?: string | null;
  fileName: string;
  fileSize?: number | null;
  mimeType?: VideoMimeType;
  durationSeconds?: number | null;
  captureDate?: string | null;
  deviceMetadata?: DeviceMetadata;
  latitude?: number | null;
  longitude?: number | null;
  contentHash?: string | null;
}

export interface CreatedUpload {
  videoId: string;
  storagePath: string;
  bucket: string;
  uploadUrl: string | null;
  token: string | null;
  status: VideoStatus;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180);
}

function extensionFor(mime: VideoMimeType): string {
  switch (mime) {
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    case 'video/x-msvideo':
      return 'avi';
    default:
      return 'mp4';
  }
}

export function buildStoragePath(opts: {
  orgId: string;
  jobId: string;
  videoId: string;
  fileName: string;
  mimeType: VideoMimeType;
}): string {
  const safe = sanitizeFileName(opts.fileName);
  const ext = safe.includes('.') ? safe.split('.').pop()! : extensionFor(opts.mimeType);
  return `${opts.orgId}/${opts.jobId}/verification/${opts.videoId}/original.${ext}`;
}

export function validateUploadConstraints(input: {
  mimeType: string;
  fileSize?: number | null;
  durationSeconds?: number | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, reason: `Unsupported MIME type: ${input.mimeType}` };
  }
  if (
    input.fileSize != null &&
    (input.fileSize <= 0 || input.fileSize > verificationConfig.maxUploadBytes)
  ) {
    return {
      ok: false,
      reason: `File size must be between 1 byte and ${verificationConfig.maxUploadBytes} bytes`,
    };
  }
  if (
    input.durationSeconds != null &&
    (input.durationSeconds < verificationConfig.minDurationSeconds ||
      input.durationSeconds > verificationConfig.maxDurationSeconds)
  ) {
    return {
      ok: false,
      reason: `Duration must be between ${verificationConfig.minDurationSeconds}s and ${verificationConfig.maxDurationSeconds}s`,
    };
  }
  return { ok: true };
}

/** Assert the caller can access the job within their org (RLS + explicit check). */
async function assertJobAccess(deps: IngestionDeps, jobId: string): Promise<void> {
  const { data, error } = await deps.supabase
    .from('crm_jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', deps.orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Job not found in this organization');
}

export async function createVideoUpload(
  deps: IngestionDeps,
  raw: CreateUploadInput,
): Promise<CreatedUpload> {
  const input = createVideoUploadSchema.parse(raw);
  const constraints = validateUploadConstraints({
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    durationSeconds: input.durationSeconds,
  });
  if (!constraints.ok) throw new Error(constraints.reason);

  await assertJobAccess(deps, input.jobId);

  const videoId = randomUUID();
  const storagePath = buildStoragePath({
    orgId: deps.orgId,
    jobId: input.jobId,
    videoId,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });

  const { error: insertError } = await deps.supabase.from('verification_videos').insert({
    id: videoId,
    org_id: deps.orgId,
    job_id: input.jobId,
    proof_id: input.proofId ?? null,
    party_id: input.partyId ?? null,
    uploader_id: deps.uploaderId,
    file_name: input.fileName,
    file_size: input.fileSize ?? null,
    mime_type: input.mimeType,
    duration_seconds: input.durationSeconds ?? null,
    capture_date: input.captureDate ?? null,
    device_metadata: input.deviceMetadata ?? {},
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    storage_path: storagePath,
    content_hash: input.contentHash ?? null,
    status: 'uploaded',
  });
  if (insertError) throw new Error(insertError.message);

  let uploadUrl: string | null = null;
  let token: string | null = null;
  const { data: signed, error: signError } = await deps.supabase.storage
    .from(verificationConfig.bucket)
    .createSignedUploadUrl(storagePath);
  if (!signError && signed) {
    uploadUrl = signed.signedUrl ?? null;
    token = signed.token ?? null;
  }

  await appendAuditEvent(deps.supabase, {
    orgId: deps.orgId,
    jobId: input.jobId,
    videoId,
    actorId: deps.uploaderId,
    eventType: 'video.upload_created',
    entityType: 'verification_video',
    entityId: videoId,
    payload: { storagePath, mimeType: input.mimeType, fileName: input.fileName },
  });

  return {
    videoId,
    storagePath,
    bucket: verificationConfig.bucket,
    uploadUrl,
    token,
    status: 'uploaded',
  };
}

export async function completeVideoUpload(
  deps: IngestionDeps,
  videoId: string,
  raw: unknown,
): Promise<{ videoId: string; status: VideoStatus; queued: boolean }> {
  const input = completeVideoUploadSchema.parse(raw);

  const { data: existing, error: loadError } = await deps.supabase
    .from('verification_videos')
    .select('id, org_id, job_id, storage_path, status')
    .eq('id', videoId)
    .eq('org_id', deps.orgId)
    .maybeSingle();
  if (loadError) throw new Error(loadError.message);
  if (!existing) throw new Error('Video not found');
  if (existing.storage_path !== input.storagePath) {
    throw new Error('storagePath does not match the upload record');
  }
  if (existing.status !== 'uploaded' && existing.status !== 'failed') {
    throw new Error(`Cannot complete upload from status ${existing.status}`);
  }

  const nextStatus: VideoStatus = input.enqueue ? 'queued' : 'uploaded';
  const { error: updateError } = await deps.supabase
    .from('verification_videos')
    .update({
      file_size: input.fileSize ?? undefined,
      duration_seconds: input.durationSeconds ?? undefined,
      content_hash: input.contentHash ?? undefined,
      status: nextStatus,
      processing_error: null,
    })
    .eq('id', videoId)
    .eq('org_id', deps.orgId);
  if (updateError) throw new Error(updateError.message);

  await appendAuditEvent(deps.supabase, {
    orgId: deps.orgId,
    jobId: existing.job_id,
    videoId,
    actorId: deps.uploaderId,
    eventType: 'video.upload_completed',
    entityType: 'verification_video',
    entityId: videoId,
    payload: { enqueue: input.enqueue, contentHash: input.contentHash ?? null },
  });

  return { videoId, status: nextStatus, queued: input.enqueue };
}

export async function getVideoForOrg(
  deps: IngestionDeps,
  videoId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { data, error } = await deps.supabase
    .from('verification_videos')
    .select('*')
    .eq('id', videoId)
    .eq('org_id', deps.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Video not found');
  return data;
}

export async function createSignedPlaybackUrl(
  deps: IngestionDeps,
  videoId: string,
): Promise<{ url: string; expiresIn: number }> {
  const video = await getVideoForOrg(deps, videoId);
  const { data, error } = await deps.supabase.storage
    .from(verificationConfig.bucket)
    .createSignedUrl(video.storage_path, verificationConfig.signedDownloadTtlSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not sign URL');

  await appendAuditEvent(deps.supabase, {
    orgId: deps.orgId,
    jobId: video.job_id,
    videoId,
    actorId: deps.uploaderId,
    eventType: 'video.playback_url_issued',
    entityType: 'verification_video',
    entityId: videoId,
    payload: { expiresIn: verificationConfig.signedDownloadTtlSeconds },
  });

  return { url: data.signedUrl, expiresIn: verificationConfig.signedDownloadTtlSeconds };
}

/** Create a verification_videos row from an existing job_proofs upload. */
export async function linkProofAsVerificationVideo(
  deps: IngestionDeps,
  proof: {
    id: string;
    jobId: string;
    partyId: string;
    storagePath: string;
    fileSize?: number | null;
    durationSeconds?: number | null;
    contentHash?: string | null;
    capturedAt?: string | null;
    lat?: number | null;
    lon?: number | null;
  },
): Promise<string> {
  const { data: existing } = await deps.supabase
    .from('verification_videos')
    .select('id')
    .eq('proof_id', proof.id)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const videoId = randomUUID();
  const { error } = await deps.supabase.from('verification_videos').insert({
    id: videoId,
    org_id: deps.orgId,
    job_id: proof.jobId,
    proof_id: proof.id,
    party_id: proof.partyId,
    uploader_id: deps.uploaderId,
    file_name: proof.storagePath.split('/').pop() ?? 'proof.mp4',
    file_size: proof.fileSize ?? null,
    mime_type: 'video/mp4',
    duration_seconds: proof.durationSeconds ?? null,
    capture_date: proof.capturedAt ?? null,
    latitude: proof.lat ?? null,
    longitude: proof.lon ?? null,
    storage_path: proof.storagePath,
    content_hash: proof.contentHash ?? null,
    status: 'queued',
  });
  if (error) throw new Error(error.message);
  return videoId;
}

export function contentHashHex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
