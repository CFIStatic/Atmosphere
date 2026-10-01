/**
 * Photos, scans, and drawings go through the existing vision analyzer.
 * The quotable text is only what that pass reports as visible text.
 */
import { createDefaultAnalyzer } from '../verification/factory.js';
import { capChunks, sanitizeExtractedText } from './text.js';
import {
  DocumentReadError,
  type ExtractionResult,
  type ImageReader,
  type ImageVisionRead,
} from './types.js';

export async function defaultImageReader(input: {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}): Promise<ImageVisionRead> {
  const analyzer = createDefaultAnalyzer();
  const result = await analyzer.analyzeFrame({
    mimeType: input.mimeType,
    base64: input.base64,
  });
  const parsed = result.parsed;
  return {
    visibleText: (parsed.visible_text ?? []).map((line) => String(line).trim()).filter(Boolean),
    description: [parsed.room_type, ...(parsed.observed_conditions ?? []), ...(parsed.work_activities ?? [])]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join('. '),
    roomType: parsed.room_type ? String(parsed.room_type) : null,
  };
}

export async function extractImage(input: {
  bytes: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readImage?: ImageReader;
  location?: string;
}): Promise<ExtractionResult> {
  const read = input.readImage ?? defaultImageReader;
  let vision: ImageVisionRead;
  try {
    vision = await read({ mimeType: input.mimeType, base64: input.bytes.toString('base64') });
  } catch {
    throw new DocumentReadError('This image could not be read.', 'vision_failed');
  }
  return extractionFromVision(vision, input.location ?? 'image');
}

export function extractionFromVision(vision: ImageVisionRead, location: string): ExtractionResult {
  const visible = vision.visibleText.map((line) => sanitizeExtractedText(line)).filter(Boolean);
  const description = sanitizeExtractedText(vision.description);
  const lines = [
    visible.length ? `Visible text:\n${visible.join('\n')}` : '',
    description ? `Reading: ${description}` : '',
  ].filter(Boolean);
  const text = sanitizeExtractedText(lines.join('\n'));
  if (!text) {
    throw new DocumentReadError('This image could not be read.', 'vision_failed');
  }
  return {
    text,
    chunks: capChunks([{ seq: 0, location, text: text.slice(0, 4000) }]),
    warnings: visible.length ? [] : ['No text was visible in the image.'],
    scanned: true,
  };
}

/** Many phone HEIC files carry a JPEG preview. Use that when a full decode is unavailable. */
export function jpegPreviewFromHeic(bytes: Buffer): Buffer | null {
  let best: Buffer | null = null;
  let offset = 0;
  while (offset + 4 < bytes.length) {
    const start = bytes.indexOf(Buffer.from([0xff, 0xd8, 0xff]), offset);
    if (start < 0) break;
    const end = bytes.indexOf(Buffer.from([0xff, 0xd9]), start + 3);
    if (end < 0) break;
    const slice = bytes.slice(start, end + 2);
    if (!best || slice.length > best.length) best = slice;
    offset = end + 2;
  }
  if (!best || best.length < 400) return null;
  return best;
}
