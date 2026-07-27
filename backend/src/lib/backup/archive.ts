import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv, type CipherGCM } from 'node:crypto';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough, Readable } from 'node:stream';
import { appendFile, open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { config } from '../../config.js';

/**
 * The on-disk backup archive.
 *
 * Format, outermost first:
 *
 *   [ AES-256-GCM envelope ]   ← only when an encryption key is configured
 *     [ gzip ]
 *       [ NDJSON ]             ← one JSON object per line
 *
 * NDJSON rather than a single JSON document because a snapshot can be larger
 * than memory in both directions: the writer streams rows out as it reads them,
 * and the reader replays them one line at a time. A 200k-row export never has
 * to exist as one string.
 *
 * The first line is a header describing the snapshot. Every line after it is
 * `{"t": "<table>", "d": {…row…}}`.
 *
 * Encryption envelope:
 *
 *   magic (8) | iv (12) | ciphertext (…) | auth tag (16)
 *
 * GCM only yields its authentication tag once the final block is written, so
 * the tag is appended after the stream closes. Verification reads it back off
 * the end — which is also what makes a truncated archive fail loudly at the
 * first decrypt rather than silently restoring half a company's records.
 */

const MAGIC = Buffer.from('ATMBKP\x01\x00', 'binary'); // 8 bytes
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface ArchiveHeader {
  format: 'atmosphere-backup';
  version: 1;
  scope: 'org' | 'platform';
  orgId: string | null;
  createdAt: string;
  /** Tables the writer intends to include, in write order. */
  tables: string[];
}

export interface TableStat {
  table: string;
  rowCount: number;
  byteSize: number;
  sha256: string;
}

export interface ArchiveResult {
  byteSize: number;
  /** SHA-256 of the archive exactly as it lands in storage. */
  sha256: string;
  encryption: 'none' | 'aes-256-gcm';
  encryptionKeyId: string | null;
  rowCount: number;
  tables: TableStat[];
}

/** Decodes the configured key, or null when archives are written in the clear. */
function resolveKey(): Buffer | null {
  const raw = config.backups.encryptionKey;
  if (!raw) return null;

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }
  return key;
}

/** SHA-256 of a file on disk, streamed. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/**
 * Streams rows into a new archive at `destPath`.
 *
 * Rows are pushed in by the caller, table by table. Per-table row counts and
 * hashes are accumulated over the *plaintext* lines, so the manifest describes
 * the data rather than the compression — which is what a restore needs to
 * check, and what stays comparable across a change of cipher or key.
 */
export class ArchiveWriter {
  private readonly source = new PassThrough();
  private readonly done: Promise<void>;
  private readonly key: Buffer | null;
  // Typed as CipherGCM rather than Cipher: the auth tag is only available on
  // the GCM variant, and it is the thing that makes a tampered archive fail.
  private readonly cipher: CipherGCM | null;
  private readonly stats = new Map<string, { rows: number; bytes: number; hash: ReturnType<typeof createHash> }>();
  private totalRows = 0;
  private finished = false;

  constructor(
    private readonly destPath: string,
    header: ArchiveHeader,
  ) {
    this.key = resolveKey();

    const gzip = createGzip({ level: 6 });
    const out = createWriteStream(destPath);

    if (this.key) {
      const iv = randomBytes(IV_BYTES);
      this.cipher = createCipheriv('aes-256-gcm', this.key, iv);
      // The envelope preamble is written ahead of the cipher stream so a reader
      // can recover the IV without knowing anything else about the file.
      out.write(Buffer.concat([MAGIC, iv]));
      this.done = pipeline(this.source, gzip, this.cipher, out);
    } else {
      this.cipher = null;
      this.done = pipeline(this.source, gzip, out);
    }

    this.source.write(`${JSON.stringify(header)}\n`);
  }

  /**
   * Appends one row. Awaits drain when the compressor falls behind, so a table
   * that reads faster than it compresses cannot balloon the heap.
   */
  async writeRow(table: string, row: unknown): Promise<void> {
    const line = `${JSON.stringify({ t: table, d: row })}\n`;

    let stat = this.stats.get(table);
    if (!stat) {
      stat = { rows: 0, bytes: 0, hash: createHash('sha256') };
      this.stats.set(table, stat);
    }
    stat.rows += 1;
    stat.bytes += Buffer.byteLength(line);
    stat.hash.update(line);
    this.totalRows += 1;

    if (!this.source.write(line)) {
      await new Promise<void>((resolve) => this.source.once('drain', () => resolve()));
    }
  }

  /** Records a table that legitimately had zero rows, so it appears in the manifest. */
  noteEmptyTable(table: string): void {
    if (!this.stats.has(table)) {
      this.stats.set(table, { rows: 0, bytes: 0, hash: createHash('sha256') });
    }
  }

  async finish(): Promise<ArchiveResult> {
    if (this.finished) throw new Error('Archive already finished');
    this.finished = true;

    this.source.end();
    await this.done;

    if (this.cipher) {
      await appendFile(this.destPath, this.cipher.getAuthTag());
    }

    const { size } = await stat(this.destPath);

    return {
      byteSize: size,
      sha256: await hashFile(this.destPath),
      encryption: this.key ? 'aes-256-gcm' : 'none',
      encryptionKeyId: this.key ? config.backups.encryptionKeyId : null,
      rowCount: this.totalRows,
      tables: [...this.stats.entries()].map(([table, s]) => ({
        table,
        rowCount: s.rows,
        byteSize: s.bytes,
        sha256: s.hash.digest('hex'),
      })),
    };
  }
}

/** True when the file carries the AES-GCM envelope. */
async function isEncrypted(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && buf.equals(MAGIC);
  } finally {
    await handle.close();
  }
}

/**
 * Opens an archive and yields its plaintext byte stream.
 *
 * Note what this does NOT do: it never decrypts into a buffer. A restore reads
 * the archive the same way the writer produced it — a line at a time — so the
 * memory cost of reading a backup is independent of how big the company got.
 */
async function openPlaintext(path: string): Promise<Readable> {
  /**
   * Chains the stages so failures SURFACE ON THE RETURNED STREAM.
   *
   * `.pipe()` would be shorter and wrong: it does not forward errors, so a
   * tampered archive fails GCM authentication deep inside the decipher and the
   * rejection escapes as an uncaught exception — taking the process down
   * instead of returning "this backup is bad". Detecting corruption is the
   * entire point of the verify path, so it has to fail as a value.
   */
  const chain = (source: Readable, ...transforms: NodeJS.ReadWriteStream[]): Readable => {
    const out = new PassThrough();
    pipeline([source, ...transforms, out]).catch((err: unknown) => {
      out.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    return out;
  };

  if (!(await isEncrypted(path))) {
    return chain(createReadStream(path), createGunzip());
  }

  const key = resolveKey();
  if (!key) {
    throw new Error(
      'This archive is encrypted but BACKUP_ENCRYPTION_KEY is not set. ' +
        'Supply the key that wrote it (see the snapshot\'s encryptionKeyId).',
    );
  }

  const { size } = await stat(path);
  const headerBytes = MAGIC.length + IV_BYTES;
  if (size < headerBytes + TAG_BYTES) {
    throw new Error('Archive is truncated: too short to contain an encryption envelope.');
  }

  const handle = await open(path, 'r');
  try {
    const iv = Buffer.alloc(IV_BYTES);
    await handle.read(iv, 0, IV_BYTES, MAGIC.length);

    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    // Read only the ciphertext: past the preamble, stopping short of the tag.
    const body = createReadStream(path, { start: headerBytes, end: size - TAG_BYTES - 1 });
    return chain(body, decipher, createGunzip());
  } finally {
    await handle.close();
  }
}

/**
 * Splits a byte stream into lines.
 *
 * Deliberately not `readline`: its Interface re-emits input errors on itself,
 * and both failures we care about — a gzip CRC mismatch and a GCM
 * authentication failure — arrive AFTER the last line, once readline's async
 * iterator has already detached. The error then has no listener and takes the
 * process down. Iterating the stream directly makes those failures come back
 * through `for await`, where a caller can catch them.
 *
 * StringDecoder rather than `chunk.toString()` because a multibyte character
 * can straddle a chunk boundary, which would silently corrupt exactly the
 * non-ASCII names and addresses a restoration company is full of.
 */
async function* readLines(stream: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  for await (const chunk of stream) {
    buffer += decoder.write(chunk as Buffer);

    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
      index = buffer.indexOf('\n');
    }
  }

  buffer += decoder.end();
  if (buffer.length > 0) yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
}

export interface ArchiveContents {
  header: ArchiveHeader;
  /** Rows actually read back, per table. */
  counts: Map<string, number>;
  totalRows: number;
}

/**
 * Replays an archive, handing every row to `onRow`.
 *
 * With no callback this is a verification pass: it forces the whole file
 * through decryption and decompression, which is the only way to learn that an
 * archive is genuinely readable. A checksum proves the bytes are the bytes we
 * wrote; only a full read proves those bytes are still a backup.
 */
export async function readArchive(
  path: string,
  onRow?: (table: string, row: unknown) => void | Promise<void>,
): Promise<ArchiveContents> {
  const stream = await openPlaintext(path);

  let header: ArchiveHeader | null = null;
  const counts = new Map<string, number>();
  let totalRows = 0;

  // Decryption and decompression both authenticate at the very end, so a
  // damaged archive yields a plausible-looking run of rows and only then
  // throws — from inside this loop, which is where the caller can catch it.
  for await (const line of readLines(stream)) {
    if (!line) continue;

    if (!header) {
      header = JSON.parse(line) as ArchiveHeader;
      if (header.format !== 'atmosphere-backup') {
        throw new Error(`Not an Atmosphere backup archive (format: ${String(header.format)})`);
      }
      continue;
    }

    const { t, d } = JSON.parse(line) as { t: string; d: unknown };
    counts.set(t, (counts.get(t) ?? 0) + 1);
    totalRows += 1;
    if (onRow) await onRow(t, d);
  }

  if (!header) throw new Error('Archive is empty: no header line.');
  return { header, counts, totalRows };
}
