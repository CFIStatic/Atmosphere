/**
 * Pluggable object store for fleet video.
 *
 * Hot path today: Supabase Storage signed upload/read (same as job-proofs).
 * Fleet scale (billions of hours aggregate) expects an S3-compatible driver
 * with multipart upload and lifecycle rules into warm/cold — without changing
 * the catalog or twin/proof code that only hold media ids + keys.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import type { MediaBackend, MediaObject } from './types.js';

export type CreateUploadInput = {
  orgId: string;
  objectKey: string;
  contentType: string;
  byteSize?: number | null;
  /** Prefer multipart when the driver supports it and size warrants it. */
  preferMultipart?: boolean;
};

export type CreatedUpload = {
  backend: MediaBackend;
  bucket: string;
  objectKey: string;
  /** Single PUT target when multipart is not used. */
  uploadUrl: string | null;
  multipart: null | {
    uploadId: string;
    partSizeBytes: number;
    partCount: number;
    parts: Array<{ partNumber: number; url: string }>;
  };
  expiresAt: Date;
};

export interface MediaStorageDriver {
  readonly backend: MediaBackend;
  readonly bucket: string;
  createUpload(input: CreateUploadInput): Promise<CreatedUpload>;
  createSignedReadUrl(objectKey: string, ttlSeconds: number): Promise<string>;
  /** Optional: copy/mark object into another tier (S3 lifecycle / restore). */
  promoteTier?(objectKey: string, tier: 'hot' | 'warm' | 'cold'): Promise<void>;
}

function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    throw new HttpError(400, 'Unsafe media object key', 'unsafe_media_key');
  }
}

/**
 * In-memory driver for unit tests — no network, no disk.
 * Does not pretend to hold fleet-scale bytes.
 */
export class MemoryMediaStorage implements MediaStorageDriver {
  readonly backend = 'memory' as const;
  readonly bucket = 'memory';
  private readonly urls = new Map<string, string>();

  async createUpload(input: CreateUploadInput): Promise<CreatedUpload> {
    assertSafeKey(input.objectKey);
    const token = randomUUID();
    const uploadUrl = `memory://upload/${input.objectKey}?t=${token}`;
    this.urls.set(input.objectKey, `memory://object/${input.objectKey}`);
    return {
      backend: this.backend,
      bucket: this.bucket,
      objectKey: input.objectKey,
      uploadUrl,
      multipart: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  async createSignedReadUrl(objectKey: string, _ttlSeconds: number): Promise<string> {
    assertSafeKey(objectKey);
    return this.urls.get(objectKey) ?? `memory://object/${objectKey}`;
  }
}

/**
 * Supabase hot-tier driver — today's production path for proof video.
 * Large day files still use a single signed upload URL; the S3 driver will
 * add true multipart when MEDIA_BACKEND=s3.
 */
export class SupabaseMediaStorage implements MediaStorageDriver {
  readonly backend = 'supabase' as const;

  constructor(readonly bucket: string = config.media.hotBucket) {}

  async createUpload(input: CreateUploadInput): Promise<CreatedUpload> {
    assertSafeKey(input.objectKey);
    const admin = createAdminClient();
    if (!admin) {
      throw new HttpError(503, 'Object storage is not configured.', 'storage_unconfigured');
    }
    const { data, error } = await admin.storage
      .from(this.bucket)
      .createSignedUploadUrl(input.objectKey, { upsert: true });
    if (error || !data?.signedUrl) {
      throw new HttpError(502, error?.message ?? 'Could not mint upload URL', 'upload_url_failed');
    }
    return {
      backend: this.backend,
      bucket: this.bucket,
      objectKey: input.objectKey,
      uploadUrl: data.signedUrl,
      multipart: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  async createSignedReadUrl(objectKey: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(objectKey);
    const admin = createAdminClient();
    if (!admin) {
      throw new HttpError(503, 'Object storage is not configured.', 'storage_unconfigured');
    }
    const { data, error } = await admin.storage
      .from(this.bucket)
      .createSignedUrl(objectKey, ttlSeconds);
    if (error || !data?.signedUrl) {
      throw new HttpError(502, error?.message ?? 'Could not mint read URL', 'read_url_failed');
    }
    return data.signedUrl;
  }
}

/**
 * S3-shaped stub: returns a planned multipart layout so App Store / field
 * clients can integrate against the contract before credentials are wired.
 * Completing parts still requires a real AWS/S3-compatible deployment.
 */
export class S3MediaStorageStub implements MediaStorageDriver {
  readonly backend = 's3' as const;

  constructor(
    readonly bucket: string = config.media.archiveBucket || config.media.hotBucket,
    private readonly partSizeBytes = config.media.multipartPartBytes,
  ) {}

  async createUpload(input: CreateUploadInput): Promise<CreatedUpload> {
    assertSafeKey(input.objectKey);
    const size = input.byteSize ?? 0;
    const useMultipart =
      Boolean(input.preferMultipart) || size >= config.media.multipartThresholdBytes;

    if (!useMultipart || size <= 0) {
      return {
        backend: this.backend,
        bucket: this.bucket,
        objectKey: input.objectKey,
        uploadUrl: `https://s3.example.invalid/${this.bucket}/${input.objectKey}?upload=1`,
        multipart: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
    }

    const partCount = Math.max(1, Math.ceil(size / this.partSizeBytes));
    const uploadId = randomUUID();
    const parts = Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      url: `https://s3.example.invalid/${this.bucket}/${input.objectKey}?uploadId=${uploadId}&partNumber=${i + 1}`,
    }));

    return {
      backend: this.backend,
      bucket: this.bucket,
      objectKey: input.objectKey,
      uploadUrl: null,
      multipart: {
        uploadId,
        partSizeBytes: this.partSizeBytes,
        partCount,
        parts,
      },
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    };
  }

  async createSignedReadUrl(objectKey: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(objectKey);
    return `https://s3.example.invalid/${this.bucket}/${objectKey}?ttl=${ttlSeconds}`;
  }

  async promoteTier(_objectKey: string, _tier: 'hot' | 'warm' | 'cold'): Promise<void> {
    // Lifecycle rules in the bucket own real tier moves; this is a no-op hook.
  }
}

export function mediaDriverFor(
  backend: MediaBackend = config.media.backend,
): MediaStorageDriver {
  if (backend === 'memory') return new MemoryMediaStorage();
  if (backend === 's3') return new S3MediaStorageStub();
  return new SupabaseMediaStorage();
}

/** Build a stable object key; catalog id is the durable identity. */
export function mediaObjectKey(input: {
  orgId: string;
  kind: string;
  mediaId: string;
  ext: string;
}): string {
  const ext = input.ext.replace(/^\./, '').toLowerCase() || 'bin';
  return `${input.orgId}/${input.kind}/${input.mediaId}.${ext}`;
}

export function readUrlFor(media: MediaObject, ttlSeconds: number): Promise<string> {
  return mediaDriverFor(media.backend).createSignedReadUrl(media.objectKey, ttlSeconds);
}
