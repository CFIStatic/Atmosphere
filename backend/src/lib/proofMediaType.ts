/**
 * Server-side Field Capture / proof upload acceptance.
 *
 * Clients assert extension / Content-Type; we allowlist extensions at mint
 * time and verify magic bytes when we already hold the object bytes
 * (assemble) or can Range-read the head (file proof).
 */

import { HttpError } from './errors.js';

export const ALLOWED_PROOF_EXTENSIONS = ['mp4', 'mov', 'webm', 'avi'] as const;
export type AllowedProofExtension = (typeof ALLOWED_PROOF_EXTENSIONS)[number];

export const ALLOWED_PROOF_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
] as const;
export type AllowedProofMimeType = (typeof ALLOWED_PROOF_MIME_TYPES)[number];

const MIME_BY_EXTENSION: Record<AllowedProofExtension, AllowedProofMimeType> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
};

export function isAllowedProofExtension(value: string): value is AllowedProofExtension {
  return (ALLOWED_PROOF_EXTENSIONS as readonly string[]).includes(value.toLowerCase());
}

export function assertAllowedProofExtension(raw: string): AllowedProofExtension {
  const extension = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!isAllowedProofExtension(extension)) {
    throw new HttpError(
      400,
      `Unsupported video type ".${extension || '?'}". Use mp4, mov, webm, or avi.`,
      'unsupported_media_type',
    );
  }
  return extension;
}

export function mimeTypeForProofExtension(extension: AllowedProofExtension): AllowedProofMimeType {
  return MIME_BY_EXTENSION[extension];
}

/**
 * Detect container from magic bytes. Returns null when the buffer is not a
 * recognized video container (or too short to tell).
 */
export function sniffProofMediaType(bytes: Buffer): AllowedProofMimeType | null {
  if (!bytes || bytes.length < 12) return null;

  // EBML / Matroska / WebM
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'video/webm';
  }

  // RIFF….AVI
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x41 &&
    bytes[9] === 0x56 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x20
  ) {
    return 'video/x-msvideo';
  }

  // ISO BMFF (mp4 / mov / m4v…): ....ftyp
  const ftyp = bytes.indexOf(Buffer.from('ftyp'));
  if (ftyp >= 4 && ftyp <= 8) {
    const brand = bytes.slice(ftyp + 4, ftyp + 8).toString('ascii');
    if (/^qt  $/i.test(brand)) return 'video/quicktime';
    // Common MP4 brands; QuickTime often uses isom/mp41 too — treat non-qt as mp4.
    return 'video/mp4';
  }

  return null;
}

export function assertProofBytesMatchExtension(
  bytes: Buffer,
  extension: string,
): AllowedProofMimeType {
  const allowedExt = assertAllowedProofExtension(extension);
  const sniffed = sniffProofMediaType(bytes);
  if (!sniffed) {
    throw new HttpError(
      400,
      'Uploaded bytes are not a recognized video file.',
      'unsupported_media_type',
    );
  }
  const expected = mimeTypeForProofExtension(allowedExt);
  // mp4 and quicktime both use BMFF; accept either for .mp4 / .mov.
  const compatible =
    sniffed === expected ||
    (expected === 'video/mp4' && sniffed === 'video/quicktime') ||
    (expected === 'video/quicktime' && sniffed === 'video/mp4');
  if (!compatible) {
    throw new HttpError(
      400,
      `File contents look like ${sniffed}, not .${allowedExt}.`,
      'unsupported_media_type',
    );
  }
  return sniffed;
}

/** Extension from a proof storage path (`…/day-phase-clip.webm`). */
export function extensionOfProofStoragePath(storagePath: string): string | null {
  const base = String(storagePath ?? '')
    .trim()
    .split('/')
    .pop();
  if (!base || !base.includes('.')) return null;
  const ext = base.split('.').pop()?.toLowerCase() ?? '';
  return ext || null;
}
