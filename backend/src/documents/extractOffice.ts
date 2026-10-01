/**
 * Word, Excel, and PowerPoint.
 * XML parts are read as text. Legacy OLE streams are scanned for cell values
 * or visible text. Macro projects are ignored and never executed.
 */
import ExcelJS from 'exceljs';
import { DOCUMENT_LIMITS } from './limits.js';
import { oleStream, readOle } from './ole.js';
import { officeKindFromZip } from './sniff.js';
import { capChunks, columnLetter, sanitizeExtractedText } from './text.js';
import { readZip } from './zip.js';
import {
  DocumentReadError,
  type DocumentFormat,
  type ExtractedChunk,
  type ExtractionResult,
} from './types.js';

export function extractOffice(bytes: Buffer, format: DocumentFormat): ExtractionResult & { format: DocumentFormat; macrosIgnored: boolean } {
  if (format === 'docx' || format === 'pptx') {
    return extractOpenXml(bytes, format);
  }
  if (format === 'xls') return { ...extractXls(bytes), format: 'xls', macrosIgnored: false };
  if (format === 'doc') return { ...extractDoc(bytes), format: 'doc', macrosIgnored: false };
  throw new DocumentReadError('This file type is not supported.', 'unsupported');
}

function extractOpenXml(bytes: Buffer, hinted: DocumentFormat): ExtractionResult & { format: DocumentFormat; macrosIgnored: boolean } {
  let files: Map<string, Buffer>;
  try {
    files = readZip(bytes);
  } catch (err) {
    if (err instanceof DocumentReadError) throw err;
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const names = [...files.keys()];
  if (names.some((name) => /encryptioninfo|encryptedpackage/i.test(name))) {
    throw new DocumentReadError(
      'This file is password-protected. Remove the password and upload it again.',
      'password_protected',
    );
  }
  const contents = files.get('[Content_Types].xml')?.toString('utf8') ?? '';
  const kind = officeKindFromZip(names, contents) ?? (hinted === 'doc' || hinted === 'xls' ? null : hinted);
  if (!kind) throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  const macrosIgnored = names.some((name) => /vbaProject\.bin$/i.test(name));
  if (kind === 'pptx') return { ...extractPptx(files), format: 'pptx', macrosIgnored };
  if (kind === 'xlsx') {
    throw new DocumentReadError('This spreadsheet has to be read as a workbook.', 'corrupt');
  }
  return { ...extractDocx(files), format: 'docx', macrosIgnored };
}

function extractDocx(files: Map<string, Buffer>): ExtractionResult {
  const xml = files.get('word/document.xml')?.toString('utf8') ?? '';
  if (!xml) throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  const text = sanitizeExtractedText(docxText(xml));
  if (!text) throw new DocumentReadError('The file has no readable text.', 'empty');
  const chunks: ExtractedChunk[] = [];
  const size = DOCUMENT_LIMITS.chunkChars;
  for (let i = 0; i < text.length && chunks.length < DOCUMENT_LIMITS.maxChunks; i += size) {
    const slice = text.slice(i, i + size).trim();
    if (slice) chunks.push({ seq: chunks.length, location: chunks.length ? 'document (continued)' : 'document', text: slice });
  }
  return { text, chunks: capChunks(chunks), warnings: [], scanned: false };
}

export function docxText(xml: string): string {
  const paragraphs = xml.split(/<w:p[ >]/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const cells = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decodeXml(match[1] ?? ''));
    if (cells.length) lines.push(cells.join(''));
  }
  return lines.join('\n');
}

function extractPptx(files: Map<string, Buffer>): ExtractionResult {
  const slides = [...files.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .slice(0, DOCUMENT_LIMITS.maxSlides);
  if (!slides.length) throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  const chunks: ExtractedChunk[] = [];
  const lines: string[] = [];
  slides.forEach((name, index) => {
    const xml = files.get(name)?.toString('utf8') ?? '';
    const text = sanitizeExtractedText(
      [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1] ?? '')).join('\n'),
    );
    if (!text) return;
    lines.push(text);
    chunks.push({ seq: chunks.length, location: `slide ${index + 1}`, text: text.slice(0, 4000) });
  });
  const text = sanitizeExtractedText(lines.join('\n\n'));
  if (!text) throw new DocumentReadError('The file has no readable text.', 'empty');
  return { text, chunks: capChunks(chunks), warnings: [], scanned: false };
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)/i)?.[1] ?? 0);
}

async function extractXlsxAsync(bytes: Buffer): Promise<ExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/password|encrypt/i.test(message)) {
      throw new DocumentReadError(
        'This spreadsheet is password-protected. Remove the password and upload it again.',
        'password_protected',
      );
    }
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const chunks: ExtractedChunk[] = [];
  const lines: string[] = [];
  let sheets = 0;
  workbook.eachSheet((sheet) => {
    if (sheets >= DOCUMENT_LIMITS.maxSheets) return;
    sheets += 1;
    const sheetName = String(sheet.name || `Sheet${sheets}`).slice(0, 40);
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (chunks.length >= DOCUMENT_LIMITS.maxChunks) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = sanitizeExtractedText(String(cell.text ?? '')).slice(0, 200);
        if (!value) return;
        const address = String(cell.address || `${columnLetter(Number(cell.col))} ${rowNumber}`);
        cells.push(`${address}=${value}`);
      });
      if (!cells.length) return;
      const text = `${sheetName}!${cells.join(' | ')}`;
      lines.push(text);
      chunks.push({ seq: chunks.length, location: `${sheetName}!A${rowNumber}`, text });
    });
  });
  const text = sanitizeExtractedText(lines.join('\n'));
  if (!text) throw new DocumentReadError('The spreadsheet has no readable cells.', 'empty');
  return { text, chunks: capChunks(chunks), warnings: [], scanned: false };
}

export async function extractOfficeAsync(bytes: Buffer, format: DocumentFormat): Promise<ExtractionResult & { format: DocumentFormat; macrosIgnored: boolean }> {
  if (format === 'xlsx' || format === 'docx' || format === 'pptx') {
    let files: Map<string, Buffer>;
    try {
      files = readZip(bytes);
    } catch (err) {
      if (err instanceof DocumentReadError) throw err;
      throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    }
    const names = [...files.keys()];
    if (names.some((name) => /encryptioninfo|encryptedpackage/i.test(name))) {
      throw new DocumentReadError(
        'This file is password-protected. Remove the password and upload it again.',
        'password_protected',
      );
    }
    const contents = files.get('[Content_Types].xml')?.toString('utf8') ?? '';
    const kind = officeKindFromZip(names, contents) ?? format;
    const macrosIgnored = names.some((name) => /vbaProject\.bin$/i.test(name));
    if (kind === 'xlsx') return { ...(await extractXlsxAsync(bytes)), format: 'xlsx', macrosIgnored };
    if (kind === 'pptx') return { ...extractPptx(files), format: 'pptx', macrosIgnored };
    return { ...extractDocx(files), format: 'docx', macrosIgnored };
  }
  return extractOffice(bytes, format);
}

function extractXls(bytes: Buffer): ExtractionResult {
  let ole;
  try {
    ole = readOle(bytes);
  } catch (err) {
    if (err instanceof DocumentReadError) throw err;
    throw new DocumentReadError('This .xls workbook could not be read. Save it as .xlsx and upload it again.', 'unsupported');
  }
  if (ole.streams.has('EncryptionInfo') || ole.streams.has('EncryptedPackage')) {
    throw new DocumentReadError(
      'This spreadsheet is password-protected. Remove the password and upload it again.',
      'password_protected',
    );
  }
  const book = oleStream(ole, ['Workbook', 'Book']);
  if (!book) {
    throw new DocumentReadError('This .xls workbook could not be read. Save it as .xlsx and upload it again.', 'unsupported');
  }
  const grid = parseBiff(book);
  if (!grid.length) {
    throw new DocumentReadError('This .xls workbook could not be read. Save it as .xlsx and upload it again.', 'unsupported');
  }
  const chunks: ExtractedChunk[] = grid.map((row, seq) => ({
    seq,
    location: row.location,
    text: row.text,
  }));
  return {
    text: sanitizeExtractedText(grid.map((row) => row.text).join('\n')),
    chunks: capChunks(chunks),
    warnings: [],
    scanned: false,
  };
}

function extractDoc(bytes: Buffer): ExtractionResult {
  let ole;
  try {
    ole = readOle(bytes);
  } catch (err) {
    if (err instanceof DocumentReadError) throw err;
    throw new DocumentReadError('This .doc file could not be read. Save it as .docx and upload it again.', 'unsupported');
  }
  if (ole.streams.has('EncryptionInfo') || ole.streams.has('EncryptedPackage')) {
    throw new DocumentReadError(
      'This document is password-protected. Remove the password and upload it again.',
      'password_protected',
    );
  }
  const word = oleStream(ole, ['WordDocument', '1Table', '0Table']);
  const text = sanitizeExtractedText(utf16Runs(word ?? Buffer.concat([...ole.streams.values()])));
  if (text.length < 8) {
    throw new DocumentReadError('This .doc file could not be read. Save it as .docx and upload it again.', 'unsupported');
  }
  return { text, chunks: capChunks([{ seq: 0, location: 'document', text }]), warnings: [], scanned: false };
}

export function utf16Runs(buf: Buffer): string {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code >= 32 && code < 0xfffe && code !== 0xfffe) {
      current += String.fromCharCode(code);
    } else if (current.length >= 4) {
      parts.push(current);
      current = '';
    } else current = '';
  }
  if (current.length >= 4) parts.push(current);
  return parts.join('\n');
}

type BiffRow = { location: string; text: string };

export function parseBiff(buf: Buffer): BiffRow[] {
  const strings: string[] = [];
  const sheets: string[] = [];
  const rows = new Map<string, string[]>();
  let sheet = 'Sheet1';
  let sheetIndex = -1;
  let offset = 0;
  let globals = true;
  while (offset + 4 <= buf.length) {
    const type = buf.readUInt16LE(offset);
    const length = buf.readUInt16LE(offset + 2);
    if (offset + 4 + length > buf.length) break;
    const data = buf.slice(offset + 4, offset + 4 + length);
    offset += 4 + length;
    if (type === 0x002f) {
      throw new DocumentReadError(
        'This spreadsheet is password-protected. Remove the password and upload it again.',
        'password_protected',
      );
    }
    if (type === 0x0085 && globals) {
      sheets.push(biffString(data.slice(6)) || `Sheet${sheets.length + 1}`);
    }
    if (type === 0x0809) {
      if (!globals) {
        sheetIndex += 1;
        sheet = sheets[sheetIndex] || `Sheet${sheetIndex + 1}`;
      }
    }
    if (type === 0x000a && globals) globals = false;
    if (globals) {
      if (type === 0x00fc) strings.push(...sstStrings(data));
      continue;
    }
    if (type === 0x0203 && data.length >= 14) {
      const row = data.readUInt16LE(0);
      const col = data.readUInt16LE(2);
      const value = data.readDoubleLE(6);
      pushCell(rows, sheet, row, col, formatNumber(value));
    } else if (type === 0x0204 && data.length >= 8) {
      const row = data.readUInt16LE(0);
      const col = data.readUInt16LE(2);
      const value = biffString(data.slice(6));
      if (value) pushCell(rows, sheet, row, col, value);
    } else if (type === 0x00fd && data.length >= 10) {
      const row = data.readUInt16LE(0);
      const col = data.readUInt16LE(2);
      const idx = data.readUInt32LE(6);
      const value = strings[idx] ?? '';
      if (value) pushCell(rows, sheet, row, col, value);
    }
  }
  return [...rows.entries()].map(([location, cells]) => ({ location, text: cells.join(' | ') }));
}

function pushCell(rows: Map<string, string[]>, sheet: string, row: number, col: number, value: string) {
  const key = `${sheet}!A${row + 1}`;
  const list = rows.get(key) ?? [];
  list.push(`${columnLetter(col + 1)}${row + 1}=${value}`);
  rows.set(key, list);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value) && Math.abs(value) >= 100) {
    const body = Math.abs(Math.round(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${value < 0 ? '-' : ''}$${body}.00`;
  }
  return String(Math.round(value * 100) / 100);
}

function biffString(data: Buffer): string {
  if (data.length < 3) return '';
  const count = data.readUInt16LE(0);
  const flags = data[2] ?? 0;
  const wide = (flags & 0x01) !== 0;
  const start = 3;
  if (wide) return data.slice(start, start + count * 2).toString('utf16le');
  return data.slice(start, start + count).toString('latin1');
}

function sstStrings(data: Buffer): string[] {
  if (data.length < 8) return [];
  const unique = data.readUInt32LE(4);
  const out: string[] = [];
  let offset = 8;
  while (out.length < unique && offset + 3 <= data.length) {
    const count = data.readUInt16LE(offset);
    const flags = data[offset + 2] ?? 0;
    const wide = (flags & 0x01) !== 0;
    offset += 3;
    const byteLen = wide ? count * 2 : count;
    if (offset + byteLen > data.length) break;
    out.push(wide ? data.slice(offset, offset + byteLen).toString('utf16le') : data.slice(offset, offset + byteLen).toString('latin1'));
    offset += byteLen;
  }
  return out.filter(Boolean);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
