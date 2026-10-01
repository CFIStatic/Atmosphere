/**
 * PDF text extraction without rendering or executing the file.
 * Text pages keep their page numbers. Image-only pages are returned so the
 * caller can send them through the existing vision pipeline.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';
import { DOCUMENT_LIMITS } from './limits.js';
import { capChunks, sanitizeExtractedText } from './text.js';
import { DocumentReadError, type ExtractedChunk, type ExtractionResult } from './types.js';

export type PdfRead = {
  pages: Array<{ page: number; text: string }>;
  images: Buffer[];
  encrypted: boolean;
};

export function readPdf(bytes: Buffer): PdfRead {
  if (!bytes.slice(0, 5).toString('latin1').startsWith('%PDF')) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const objects = parseObjects(bytes);
  if (isEncrypted(bytes, objects)) {
    throw new DocumentReadError(
      'This PDF is password-protected. Remove the password and upload it again.',
      'password_protected',
    );
  }
  const pageIds = pageOrder(objects);
  const pages: Array<{ page: number; text: string }> = [];
  const images: Buffer[] = [];
  const seenImages = new Set<number>();

  const takePage = (pageNumber: number, contentIds: number[]) => {
    const parts: string[] = [];
    for (const id of contentIds) {
      const obj = objects.get(id);
      if (!obj?.stream) continue;
      parts.push(textFromContent(obj.stream.toString('latin1')));
    }
    const text = sanitizeExtractedText(parts.join('\n'));
    pages.push({ page: pageNumber, text });
  };

  if (pageIds.length) {
    pageIds.slice(0, DOCUMENT_LIMITS.maxPages).forEach((page, index) => {
      takePage(index + 1, page.contents);
      for (const id of xobjectIds(page.body)) {
        const image = jpegFromObject(objects.get(id));
        if (image && !seenImages.has(id)) {
          seenImages.add(id);
          images.push(image);
        }
      }
    });
  } else {
    const blobs: string[] = [];
    for (const obj of objects.values()) {
      if (!obj.stream) continue;
      const text = textFromContent(obj.stream.toString('latin1'));
      if (text.trim()) blobs.push(text);
      const image = jpegFromObject(obj);
      if (image) images.push(image);
    }
    pages.push({ page: 1, text: sanitizeExtractedText(blobs.join('\n')) });
  }

  if (!pages.some((page) => page.text) && !images.length) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  return { pages, images, encrypted: false };
}

export function pdfToExtraction(read: PdfRead, visionText: Array<{ page: number; text: string }> = []): ExtractionResult {
  const chunks: ExtractedChunk[] = [];
  const warnings: string[] = [];
  let scanned = false;
  const lines: string[] = [];
  for (const page of read.pages) {
    const vision = visionText.find((row) => row.page === page.page)?.text ?? '';
    const text = sanitizeExtractedText([page.text, vision].filter(Boolean).join('\n'));
    if (!page.text && vision) scanned = true;
    if (!text) {
      if (!vision) warnings.push(`Page ${page.page} has no readable text.`);
      continue;
    }
    lines.push(text);
    const size = DOCUMENT_LIMITS.chunkChars;
    for (let i = 0; i < text.length && chunks.length < DOCUMENT_LIMITS.maxChunks; i += size) {
      const slice = text.slice(i, i + size).trim();
      if (!slice) continue;
      chunks.push({
        seq: chunks.length,
        location: i === 0 ? `page ${page.page}` : `page ${page.page} (continued)`,
        text: slice,
      });
    }
  }
  const text = sanitizeExtractedText(lines.join('\n\n'));
  if (!text) {
    throw new DocumentReadError('This PDF has no readable text.', 'empty');
  }
  return { text, chunks: capChunks(chunks), warnings, scanned };
}

type PdfObj = { body: string; stream: Buffer | null };

function parseObjects(bytes: Buffer): Map<number, PdfObj> {
  const src = bytes.toString('latin1');
  const starts: Array<{ id: number; index: number }> = [];
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) starts.push({ id: Number(match[1]), index: match.index + match[0].length });
  const objects = new Map<number, PdfObj>();
  let produced = 0;
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i]!.index;
    const end = src.indexOf('endobj', start);
    const chunk = src.slice(start, end === -1 ? undefined : end);
    const streamAt = chunk.search(/stream\r?\n/);
    if (streamAt < 0) {
      objects.set(starts[i]!.id, { body: chunk, stream: null });
      continue;
    }
    const body = chunk.slice(0, streamAt);
    const marker = chunk.slice(streamAt).match(/^stream\r?\n/);
    const dataStart = start + streamAt + (marker?.[0].length ?? 6);
    const endRel = chunk.indexOf('endstream', streamAt);
    let dataEnd = endRel >= 0 ? start + endRel : dataStart;
    if (bytes[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (bytes[dataEnd - 1] === 0x0d) dataEnd -= 1;
    const raw = bytes.slice(dataStart, Math.max(dataStart, dataEnd));
    const stream = decodeStream(body, raw, DOCUMENT_LIMITS.maxUnzippedBytes - produced);
    produced += stream.length;
    if (produced > DOCUMENT_LIMITS.maxUnzippedBytes) throw streamTooLarge();
    objects.set(starts[i]!.id, { body, stream });
  }
  return objects;
}

function streamTooLarge(): DocumentReadError {
  const mb = Math.round(DOCUMENT_LIMITS.maxUnzippedBytes / (1024 * 1024));
  return new DocumentReadError(`This file is over the ${mb} MB limit.`, 'too_large');
}

function outputCapped(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE');
}

/** Inflate one stream inside the same per-entry and total caps as a zip part. */
function decodeStream(body: string, raw: Buffer, room: number): Buffer {
  if (room < 1) throw streamTooLarge();
  const cap = Math.min(DOCUMENT_LIMITS.maxZipEntryBytes, room);
  if (!/\/FlateDecode\b/.test(body) || raw.length === 0) {
    if (raw.length > cap) throw streamTooLarge();
    return raw;
  }
  const inflated = inflateFlate(raw, cap);
  if (inflated) {
    if (inflated.length > cap) throw streamTooLarge();
    return inflated;
  }
  if (raw.length > cap) throw streamTooLarge();
  return raw;
}

function inflateFlate(raw: Buffer, cap: number): Buffer | null {
  try {
    return inflateSync(raw, { maxOutputLength: cap });
  } catch (err) {
    if (outputCapped(err)) throw streamTooLarge();
  }
  try {
    return inflateRawSync(raw, { maxOutputLength: cap });
  } catch (err) {
    if (outputCapped(err)) throw streamTooLarge();
    return null;
  }
}

function isEncrypted(bytes: Buffer, objects: Map<number, PdfObj>): boolean {
  for (const obj of objects.values()) {
    if (/\/Encrypt\b/.test(obj.body)) return true;
  }
  const tail = bytes.slice(Math.max(0, bytes.length - 4000)).toString('latin1');
  return /\/Encrypt\b/.test(tail);
}

function pageOrder(objects: Map<number, PdfObj>): Array<{ body: string; contents: number[] }> {
  const pages: Array<{ body: string; contents: number[] }> = [];
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(obj.body) || /\/Type\s*\/Pages\b/.test(obj.body)) continue;
    pages.push({ body: obj.body, contents: refIds(obj.body, 'Contents') });
  }
  return pages;
}

function refIds(body: string, key: string): number[] {
  const match = body.match(new RegExp(`\\/${key}\\s*(\\[[^\\]]+\\]|\\d+\\s+\\d+\\s+R)`));
  if (!match) return [];
  return [...match[1]!.matchAll(/(\d+)\s+\d+\s+R/g)].map((row) => Number(row[1]));
}

function xobjectIds(body: string): number[] {
  const match = body.match(/\/XObject\s*<<([\s\S]*?)>>/);
  if (!match) return [];
  return [...match[1]!.matchAll(/\/\w+\s+(\d+)\s+\d+\s+R/g)].map((row) => Number(row[1]));
}

function jpegFromObject(obj: PdfObj | undefined): Buffer | null {
  if (!obj?.stream) return null;
  if (!/\/Subtype\s*\/Image\b/.test(obj.body) && !/\/DCTDecode\b/.test(obj.body)) return null;
  if (obj.stream.length >= 3 && obj.stream[0] === 0xff && obj.stream[1] === 0xd8) return obj.stream;
  return null;
}

function textFromContent(content: string): string {
  let out = '';
  let i = 0;
  const newline = () => {
    if (!out.endsWith('\n')) out += '\n';
  };
  while (i < content.length) {
    const ch = content[i]!;
    if (ch === '%') {
      const nl = content.indexOf('\n', i);
      i = nl < 0 ? content.length : nl + 1;
      continue;
    }
    if (ch === '(') {
      const read = readLiteral(content, i);
      out += read.text;
      i = read.next;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i + 1);
      if (end > i) {
        out += hexString(content.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const end = findArrayEnd(content, i);
      if (end > i) {
        const op = content.slice(end + 1).match(/^\s*(TJ|Tj)\b/);
        if (op) out += tjArray(content.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (operatorAt(content, i, 'ET') || operatorAt(content, i, 'T*') || operatorAt(content, i, 'Td') || operatorAt(content, i, 'TD')) {
      newline();
      i += content.startsWith('T*', i) || content.startsWith('Td', i) || content.startsWith('TD', i) ? 2 : 2;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Kerning adjustments inside a TJ array. A large negative gap is a word space. */
function tjArray(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === '(') {
      const read = readLiteral(body, i);
      out += read.text;
      i = read.next;
      continue;
    }
    if (ch === '<') {
      const end = body.indexOf('>', i + 1);
      if (end > i) {
        out += hexString(body.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (ch === '-' || (ch >= '0' && ch <= '9') || ch === '.') {
      const num = body.slice(i).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)/);
      if (num) {
        // PDF subtracts the number from the text position. Large negatives open a word gap.
        if (Number(num[0]) <= -150) out += ' ';
        i += num[0].length;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

function findArrayEnd(content: string, start: number): number {
  let i = start + 1;
  let depth = 1;
  while (i < content.length && depth > 0) {
    const ch = content[i]!;
    if (ch === '(') {
      i = readLiteral(content, i).next;
      continue;
    }
    if (ch === '<') {
      const end = content.indexOf('>', i + 1);
      i = end < 0 ? content.length : end + 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    if (depth > 0) i += 1;
  }
  return depth === 0 ? i : -1;
}

function operatorAt(content: string, index: number, op: string): boolean {
  if (!content.startsWith(op, index)) return false;
  const before = index === 0 ? ' ' : content[index - 1]!;
  const after = content[index + op.length] ?? ' ';
  return /[\s\[\]<>]/.test(before) && /[\s\[\]<>/]/.test(after);
}

function readLiteral(source: string, start: number): { text: string; next: number } {
  let i = start + 1;
  let text = '';
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i]!;
    if (ch === '\\') {
      const n = source[i + 1] ?? '';
      if (n === 'n') text += '\n';
      else if (n === 'r') text += '\r';
      else if (n === 't') text += '\t';
      else if (n === '(' || n === ')' || n === '\\') text += n;
      else if (/[0-7]/.test(n)) {
        const oct = source.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? n;
        text += String.fromCharCode(parseInt(oct, 8));
        i += 1 + oct.length;
        continue;
      } else text += n;
      i += 2;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      text += ch;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
      text += ch;
      i += 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  return { text, next: i };
}

function hexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length < 2 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return '';
  return Buffer.from(clean, 'hex').toString('latin1');
}
