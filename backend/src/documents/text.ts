/**
 * Plain text, markdown, CSV, and RTF.
 * RTF control words are stripped. Embedded objects are dropped, never opened.
 */
import { stripWebControlMarkers } from '../shared/askWebSearch.js';
import { DOCUMENT_LIMITS } from './limits.js';
import { DocumentReadError, type ExtractedChunk, type ExtractionResult } from './types.js';

export function sanitizeExtractedText(value: string): string {
  return stripWebControlMarkers(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractPlain(bytes: Buffer, location = 'document'): ExtractionResult {
  const text = sanitizeExtractedText(decodeUtf8(bytes));
  if (!text) throw new DocumentReadError('The file has no readable text.', 'empty');
  return packText(text, location);
}

export function extractMarkdown(bytes: Buffer): ExtractionResult {
  return extractPlain(bytes, 'document');
}

export function extractRtf(bytes: Buffer): ExtractionResult {
  const raw = bytes.toString('latin1');
  if (!raw.trimStart().startsWith('{\\rtf')) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const text = sanitizeExtractedText(rtfToText(raw));
  if (!text) throw new DocumentReadError('The file has no readable text.', 'empty');
  return packText(text, 'document');
}

export function extractCsv(bytes: Buffer): ExtractionResult {
  const grid = parseCsv(decodeUtf8(bytes));
  if (!grid.length) throw new DocumentReadError('The file has no readable text.', 'empty');
  const chunks: ExtractedChunk[] = [];
  const lines: string[] = [];
  grid.slice(0, 500).forEach((row, index) => {
    const cells = row.map((value, col) => `${columnLetter(col + 1)}${index + 1}=${value}`);
    const text = cells.join(' | ');
    if (!text.trim()) return;
    lines.push(text);
    chunks.push({ seq: chunks.length, location: `CSV!A${index + 1}`, text });
  });
  return {
    text: sanitizeExtractedText(lines.join('\n')),
    chunks: capChunks(chunks),
    warnings: [],
    scanned: false,
  };
}

export function packText(text: string, location: string): ExtractionResult {
  const clean = sanitizeExtractedText(text);
  const chunks: ExtractedChunk[] = [];
  const size = DOCUMENT_LIMITS.chunkChars;
  for (let i = 0; i < clean.length && chunks.length < DOCUMENT_LIMITS.maxChunks; i += size) {
    const slice = clean.slice(i, i + size).trim();
    if (!slice) continue;
    chunks.push({
      seq: chunks.length,
      location: chunks.length === 0 ? location : `${location} (continued)`,
      text: slice,
    });
  }
  return { text: clean, chunks: capChunks(chunks), warnings: [], scanned: false };
}

/** Every stored chunk goes through the same marker strip as the document text. */
export function capChunks(chunks: ExtractedChunk[]): ExtractedChunk[] {
  return chunks.slice(0, DOCUMENT_LIMITS.maxChunks).map((chunk, seq) => ({
    ...chunk,
    seq,
    text: sanitizeExtractedText(chunk.text).slice(0, 4000),
  })).filter((chunk) => chunk.text.trim().length > 0);
}

export function columnLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function decodeUtf8(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.slice(3).toString('utf8');
  }
  return bytes.toString('utf8');
}

export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quote = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quote = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quote = true;
      continue;
    }
    if (ch === ',' || ch === '\t') {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      if (row.some((value) => value)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((value) => value)) rows.push(row);
  return rows;
}

function rtfToText(source: string): string {
  let i = 0;
  let out = '';
  let skipDepth = 0;
  const skipHeads = /^\\(?:fonttbl|colortbl|stylesheet|info|pict|object|datastore|themedata|xmlnstbl|listtable|listoverridetable|rsidtbl)\b/;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '{') {
      const rest = source.slice(i + 1, i + 40);
      if (skipDepth > 0 || rest.startsWith('\\*') || skipHeads.test(rest)) {
        skipDepth += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (skipDepth > 0) skipDepth -= 1;
      i += 1;
      continue;
    }
    if (skipDepth > 0) {
      i += 1;
      continue;
    }
    if (ch === '\\') {
      if (source.startsWith('\\par', i) || source.startsWith('\\line', i)) {
        out += '\n';
      } else if (source.startsWith('\\tab', i)) {
        out += '\t';
      } else if (source[i + 1] === "'") {
        const hex = source.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) out += Buffer.from(hex, 'hex').toString('latin1');
        i += 4;
        continue;
      } else if (source[i + 1] === 'u' && /[-\d]/.test(source[i + 2] ?? '')) {
        const match = source.slice(i).match(/^\\u(-?\d+)\??/);
        if (match) {
          let code = Number(match[1]);
          if (code < 0) code += 65536;
          out += String.fromCharCode(code);
          i += match[0].length;
          continue;
        }
      }
      const word = source.slice(i).match(/^\\[a-zA-Z]+-?\d* ?/);
      i += word ? word[0].length : 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
