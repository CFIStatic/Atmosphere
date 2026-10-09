/**
 * Identify a file from its bytes, not its extension.
 * Rejects executables and HTML. Does not run macros or decrypt anything.
 */
import { limitForFormat } from './limits.js';
import { DocumentReadError, type SniffedFile } from './types.js';

const DANGEROUS_EXT = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'js', 'mjs', 'cjs', 'html', 'htm', 'svg', 'scr', 'ps1', 'vbs', 'jar', 'apk',
]);

const MEDIA: Record<SniffedFile['format'], string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  rtf: 'application/rtf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function safeFilename(filename: string): string {
  // eslint-disable-next-line no-control-regex -- strips control characters on purpose
  const base = (filename.split(/[/\\]/).pop() ?? 'document').replace(/[\u0000-\u001f]/g, '').trim();
  const cleaned = base.replace(/[^\w.\- ()]+/g, '_').replace(/_+/g, '_').slice(0, 180);
  return cleaned || 'document';
}

export function sniffDocument(bytes: Buffer, filename: string): SniffedFile {
  if (!bytes.length) {
    throw new DocumentReadError('The file is empty.', 'empty');
  }
  const ext = extensionOf(filename);
  if (DANGEROUS_EXT.has(ext)) {
    throw new DocumentReadError(
      'This file type is not supported. Upload a PDF, Word, Excel, PowerPoint, text, or image file.',
      'unsupported',
    );
  }
  if (isExecutable(bytes) || looksLikeHtml(bytes)) {
    throw new DocumentReadError(
      'This file type is not supported. Upload a PDF, Word, Excel, PowerPoint, text, or image file.',
      'unsupported',
    );
  }

  const format = detectFormat(bytes, ext);
  if (!format) {
    throw new DocumentReadError(
      'This file type is not supported. Upload a PDF, Word, Excel, PowerPoint, text, or image file.',
      'unsupported',
    );
  }
  if (bytes.length > limitForFormat(format)) {
    const mb = Math.round(limitForFormat(format) / (1024 * 1024));
    throw new DocumentReadError(`This file is over the ${mb} MB limit.`, 'too_large');
  }
  return {
    format,
    mediaType: MEDIA[format],
    encrypted: false,
    macrosPresent: false,
  };
}

function detectFormat(bytes: Buffer, ext: string): SniffedFile['format'] | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return ext === 'doc' ? 'doc' : 'xls';
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || starts(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    if (ext === 'pptx') return 'pptx';
    if (ext === 'docx') return 'docx';
    if (ext === 'xlsx') return 'xlsx';
    return 'docx';
  }
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (isHeic(bytes)) return 'heic';
  const head = bytes.slice(0, Math.min(bytes.length, 16)).toString('latin1').trimStart();
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (isMostlyText(bytes)) {
    if (ext === 'csv') return 'csv';
    if (ext === 'md' || ext === 'markdown') return 'md';
    if (ext === 'rtf') return 'rtf';
    if (looksLikeCsv(bytes, ext)) return 'csv';
    return ext === 'txt' || ext === '' ? 'txt' : ext === 'text' ? 'txt' : 'txt';
  }
  return null;
}

function starts(bytes: Buffer, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

function isExecutable(bytes: Buffer): boolean {
  if (starts(bytes, [0x4d, 0x5a])) return true;
  if (starts(bytes, [0x7f, 0x45, 0x4c, 0x46])) return true;
  if (starts(bytes, [0xfe, 0xed, 0xfa, 0xce]) || starts(bytes, [0xfe, 0xed, 0xfa, 0xcf])) return true;
  if (starts(bytes, [0xcf, 0xfa, 0xed, 0xfe])) return true;
  return false;
}

function looksLikeHtml(bytes: Buffer): boolean {
  const head = bytes.slice(0, 240).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<script');
}

function isHeic(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = bytes.toString('ascii', 8, 12).toLowerCase();
  return brand === 'heic' || brand === 'heix' || brand === 'heif' || brand === 'mif1' || brand === 'msf1';
}

function isMostlyText(bytes: Buffer): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 8000));
  let printable = 0;
  let nul = 0;
  for (const byte of sample) {
    if (byte === 0) nul += 1;
    else if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  }
  if (nul > 0) return false;
  return printable / sample.length > 0.9;
}

function looksLikeCsv(bytes: Buffer, ext: string): boolean {
  if (ext === 'csv') return true;
  const sample = bytes.slice(0, 2000).toString('utf8');
  const lines = sample.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return false;
  const commas = lines.filter((line) => line.includes(',') || line.includes('\t')).length;
  return commas >= Math.min(2, lines.length);
}

export function officeKindFromZip(names: string[], contentsXml: string): 'docx' | 'xlsx' | 'pptx' | null {
  const xml = contentsXml.toLowerCase();
  if (xml.includes('spreadsheetml') || names.some((name) => name.startsWith('xl/'))) return 'xlsx';
  if (xml.includes('presentationml') || names.some((name) => name.startsWith('ppt/'))) return 'pptx';
  if (xml.includes('wordprocessingml') || names.some((name) => name.startsWith('word/'))) return 'docx';
  return null;
}
