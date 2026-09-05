/**
 * Field Capture day-film upload: larger chunks, fewer round trips, resume
 * from the first missing part. Bytes still go to signed storage URLs — the
 * BFF only mints parts and assembles them.
 */

export const PROOF_CHUNK_SIZE = 8 * 1024 * 1024;
export const PROOF_LARGE_CHUNK_SIZE = 16 * 1024 * 1024;
export const PROOF_DAY_CHUNK_SIZE = 32 * 1024 * 1024;
export const PROOF_ASSEMBLE_MAX_BYTES = 512 * 1024 * 1024;
export const PROOF_UPLOAD_ATTEMPTS = 8;
export const PROOF_UPLOAD_PARALLEL = 2;

export type ProofChunkPlan = {
  byteSize: number;
  chunkSize: number;
  chunkCount: number;
  offsets: number[];
  multipart: boolean;
};

/** Bigger files get bigger slices so a day film is not 200 tiny PUTs. */
export function chooseProofChunkSize(byteSize: number): number {
  const size = Math.max(0, Math.floor(Number(byteSize) || 0));
  if (size <= PROOF_CHUNK_SIZE) return Math.max(size, 1);
  if (size <= 64 * 1024 * 1024) return PROOF_CHUNK_SIZE;
  if (size <= 256 * 1024 * 1024) return PROOF_LARGE_CHUNK_SIZE;
  return PROOF_DAY_CHUNK_SIZE;
}

export function planProofChunks(byteSize: number, chunkSize?: number): ProofChunkPlan {
  const size = Math.max(0, Math.floor(Number(byteSize) || 0));
  const slice = Math.max(1, Math.floor(chunkSize ?? chooseProofChunkSize(size)));
  if (size <= 0) {
    return { byteSize: 0, chunkSize: slice, chunkCount: 0, offsets: [], multipart: false };
  }
  const chunkCount = Math.ceil(size / slice);
  const offsets = Array.from({ length: chunkCount }, (_, i) => i * slice);
  return {
    byteSize: size,
    chunkSize: slice,
    chunkCount,
    offsets,
    multipart: chunkCount > 1 && size <= PROOF_ASSEMBLE_MAX_BYTES,
  };
}

export function partObjectPath(finalPath: string, index: number): string {
  const n = Math.floor(Number(index));
  if (!Number.isFinite(n) || n < 0 || n > 9999) {
    throw new Error('Invalid upload part index.');
  }
  return `${finalPath}.parts/${String(n).padStart(4, '0')}`;
}

export function partByteRange(
  byteSize: number,
  chunkSize: number,
  index: number,
): { start: number; end: number } {
  const start = index * chunkSize;
  const end = Math.min(start + chunkSize, byteSize) - 1;
  return { start, end };
}

/** 400ms, 800ms, 1.6s, 3.2s, 5s — truck signal comes back in bursts. */
export function nextUploadBackoffMs(attempt: number): number {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  return Math.min(5000, 400 * 2 ** n);
}

/**
 * Running total while stitching parts. Rejects before the next slice is
 * kept so a minted `.parts/` object cannot grow the BFF heap past the cap.
 */
export function assertProofAssembleBudget(
  received: number,
  incoming: number,
  maxBytes = PROOF_ASSEMBLE_MAX_BYTES,
): number {
  const have = Math.max(0, Math.floor(Number(received) || 0));
  const add = Math.max(0, Math.floor(Number(incoming) || 0));
  const next = have + add;
  if (!Number.isFinite(next) || next > maxBytes) {
    throw Object.assign(new Error('Assembled upload is too large.'), { code: 'upload_too_large' });
  }
  return next;
}

/** Size of a storage download before it is copied onto the heap a second time. */
export function storageObjectByteSize(data: unknown): number | null {
  if (Buffer.isBuffer(data)) return data.length;
  if (data && typeof (data as { size?: unknown }).size === 'number') {
    return Math.max(0, Math.floor((data as { size: number }).size));
  }
  if (data && typeof (data as { byteLength?: unknown }).byteLength === 'number') {
    return Math.max(0, Math.floor((data as { byteLength: number }).byteLength));
  }
  return null;
}

export function missingPartIndexes(have: Iterable<number>, chunkCount: number): number[] {
  const seen = new Set<number>();
  for (const i of have) {
    if (Number.isInteger(i) && i >= 0 && i < chunkCount) seen.add(i);
  }
  const missing: number[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    if (!seen.has(i)) missing.push(i);
  }
  return missing;
}

export type LibraryJobCaptureStatus = 'recorded' | 'in_progress';

/** A job file with no clip yet is in progress — not an empty/failed folder. */
export function libraryJobCaptureStatus(hasClip: boolean): LibraryJobCaptureStatus {
  return hasClip ? 'recorded' : 'in_progress';
}
