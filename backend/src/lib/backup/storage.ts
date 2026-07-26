import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../../config.js';
import { createAdminClient } from '../supabase.js';

/**
 * Where backup archives live.
 *
 * Deliberately pluggable, because the right answer depends on what failure you
 * are protecting against. A local volume survives a bad migration but not the
 * loss of the host. Object storage survives the host but costs a network hop.
 * Neither is universally correct, so the driver is configuration.
 *
 * What is NOT configurable: archives never go back into the Postgres database
 * they were taken from.
 */

export interface BackupStorage {
  readonly driver: string;
  /** Copies a finished local archive into the store under `key`. */
  put(key: string, localPath: string): Promise<void>;
  /** Fetches an archive back out to a local path. */
  get(key: string, destPath: string): Promise<void>;
  /** Removes an archive. Missing objects are not an error — the goal is absence. */
  remove(key: string): Promise<void>;
}

/**
 * Storage keys are built by the runner from a scope, a timestamp, and a uuid,
 * so they are already safe. This rejects anything else on principle: a key that
 * can climb out of the backup directory turns a retention sweep into an
 * arbitrary-file delete.
 */
function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
    throw new Error(`Unsafe backup storage key: ${key}`);
  }
}

class LocalStorage implements BackupStorage {
  readonly driver = 'local';

  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    const rootWithSep = resolve(this.root) + sep;
    // Belt-and-braces against symlinked or otherwise surprising roots.
    if (!full.startsWith(rootWithSep)) {
      throw new Error(`Backup key escapes the backup directory: ${key}`);
    }
    return full;
  }

  async put(key: string, localPath: string): Promise<void> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(createReadStream(localPath), createWriteStream(dest, { mode: 0o600 }));
  }

  async get(key: string, destPath: string): Promise<void> {
    const src = this.pathFor(key);
    await mkdir(dirname(destPath), { recursive: true });
    await pipeline(createReadStream(src), createWriteStream(destPath, { mode: 0o600 }));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

class SupabaseStorage implements BackupStorage {
  readonly driver = 'supabase';

  constructor(private readonly bucket: string) {}

  private client() {
    const admin = createAdminClient();
    if (!admin) {
      throw new Error(
        'Supabase backup storage needs SUPABASE_SERVICE_ROLE_KEY. ' +
          'Set it, or use BACKUP_DRIVER=local.',
      );
    }
    return admin;
  }

  async put(key: string, localPath: string): Promise<void> {
    assertSafeKey(key);

    // supabase-js uploads a whole body rather than a stream, so the archive is
    // read into memory here. That is fine at the scale this runs at today, and
    // the guard below turns "silently truncated backup" into a loud failure if
    // it ever stops being fine.
    const { size } = await stat(localPath);
    const limit = 512 * 1024 * 1024;
    if (size > limit) {
      throw new Error(
        `Archive is ${Math.round(size / 1024 / 1024)}MB, above the ${limit / 1024 / 1024}MB ` +
          'single-request upload limit. Switch to BACKUP_DRIVER=local with an offsite sync, ' +
          'or add multipart upload support.',
      );
    }

    const body = await readFile(localPath);
    const { error } = await this.client()
      .storage.from(this.bucket)
      .upload(key, body, { contentType: 'application/octet-stream', upsert: true });

    if (error) throw new Error(`Backup upload failed: ${error.message}`);
  }

  async get(key: string, destPath: string): Promise<void> {
    assertSafeKey(key);
    const { data, error } = await this.client().storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Backup download failed: ${error?.message ?? 'not found'}`);

    await mkdir(dirname(destPath), { recursive: true });
    const buf = Buffer.from(await data.arrayBuffer());
    await pipeline(Readable.from(buf), createWriteStream(destPath, { mode: 0o600 }));
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    const { error } = await this.client().storage.from(this.bucket).remove([key]);
    // A 404 means the object is already gone, which is the state we wanted.
    if (error && !/not.?found/i.test(error.message)) {
      throw new Error(`Backup delete failed: ${error.message}`);
    }
  }
}

export function createBackupStorage(): BackupStorage {
  switch (config.backups.driver) {
    case 'supabase':
      return new SupabaseStorage(config.backups.bucket);
    case 'local':
      return new LocalStorage(config.backups.dir);
    default:
      throw new Error(`Unknown BACKUP_DRIVER: ${config.backups.driver} (expected 'local' or 'supabase')`);
  }
}

/** Scratch directory for archives being built, before they reach the store. */
export function stagingDir(): string {
  return join(config.backups.dir, '.staging');
}
