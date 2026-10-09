/**
 * Compound File Binary reader for legacy .doc and .xls.
 * Enough to pull a named stream. Mini-streams are followed when the file uses them.
 * Sector chains share the zip and PDF caps: 16 MB per stream, 128 MB total.
 * A chain that loops or revisits a sector already used by another chain fails closed.
 */
import { DOCUMENT_LIMITS } from './limits.js';
import { DocumentReadError } from './types.js';

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;

type OleBudget = {
  produced: number;
  usedSectors: Set<number>;
  usedMini: Set<number>;
};

function oleTooLarge(): DocumentReadError {
  const mb = Math.round(DOCUMENT_LIMITS.maxUnzippedBytes / (1024 * 1024));
  return new DocumentReadError(`This file is over the ${mb} MB limit.`, 'too_large');
}

export type OleFile = {
  streams: Map<string, Buffer>;
};

export function readOle(bytes: Buffer): OleFile {
  if (bytes.length < 512 || bytes.readUInt32LE(0) !== 0xe011cfd0) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const sectorShift = bytes.readUInt16LE(0x1e);
  const miniShift = bytes.readUInt16LE(0x20);
  if (sectorShift < 9 || sectorShift > 12 || miniShift < 6 || miniShift > 12) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const sectorSize = 2 ** sectorShift;
  const miniSize = 2 ** miniShift;
  const budget: OleBudget = { produced: 0, usedSectors: new Set(), usedMini: new Set() };
  const fatCount = bytes.readUInt32LE(0x2c);
  const dirStart = bytes.readUInt32LE(0x30);
  const miniCutoff = bytes.readUInt32LE(0x38);
  const miniFatStart = bytes.readUInt32LE(0x3c);
  const difatStart = bytes.readUInt32LE(0x44);
  const fat: number[] = [];
  for (let i = 0; i < 109 && fat.length < fatCount; i += 1) {
    const sector = bytes.readUInt32LE(0x4c + i * 4);
    if (sector === FREESECT || sector === ENDOFCHAIN) break;
    fat.push(sector);
  }
  let difat = difatStart;
  let guard = 0;
  while (difat !== ENDOFCHAIN && difat !== FREESECT && fat.length < fatCount && guard++ < 64) {
    const block = sectorAt(bytes, difat, sectorSize);
    for (let i = 0; i < sectorSize / 4 - 1 && fat.length < fatCount; i += 1) fat.push(block.readUInt32LE(i * 4));
    difat = block.readUInt32LE(sectorSize - 4);
  }
  for (const sector of fat) {
    if (sector === FREESECT || sector === ENDOFCHAIN || sector === FATSECT) continue;
    if (budget.usedSectors.has(sector)) throw oleTooLarge();
    budget.usedSectors.add(sector);
  }
  const table = buildFat(bytes, fat, sectorSize);
  const directory = readChain(bytes, table, dirStart, sectorSize, budget);
  const entries = parseDirectory(directory);
  const root = entries.find((entry) => entry.type === 5) ?? entries[0];
  const miniStream = root && root.start !== ENDOFCHAIN
    ? readChain(bytes, table, root.start, sectorSize, budget, root.size)
    : Buffer.alloc(0);
  const miniTable = miniFatStart === ENDOFCHAIN || miniFatStart === FREESECT
    ? []
    : fatNumbers(readChain(bytes, table, miniFatStart, sectorSize, budget));
  const streams = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue;
    if (entry.size > DOCUMENT_LIMITS.maxZipEntryBytes) throw oleTooLarge();
    const data = entry.size < miniCutoff && miniTable.length
      ? readMini(miniStream, miniTable, entry.start, miniSize, entry.size, budget)
      : readChain(bytes, table, entry.start, sectorSize, budget, entry.size);
    streams.set(entry.name, data.subarray(0, entry.size));
  }
  return { streams };
}

export function oleStream(file: OleFile, names: string[]): Buffer | null {
  for (const name of names) {
    for (const [key, value] of file.streams) {
      if (key.toLowerCase() === name.toLowerCase()) return value;
    }
  }
  return null;
}

type DirEntry = { name: string; type: number; start: number; size: number };

function sectorAt(bytes: Buffer, sector: number, sectorSize: number): Buffer {
  const start = (sector + 1) * sectorSize;
  return bytes.slice(start, start + sectorSize);
}

function buildFat(bytes: Buffer, fatSectors: number[], sectorSize: number): number[] {
  const table: number[] = [];
  for (const sector of fatSectors) {
    const block = sectorAt(bytes, sector, sectorSize);
    for (let i = 0; i < block.length; i += 4) table.push(block.readUInt32LE(i));
  }
  return table;
}

function fatNumbers(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) out.push(buf.readUInt32LE(i));
  return out;
}

function readChain(
  bytes: Buffer,
  fat: number[],
  start: number,
  sectorSize: number,
  budget: OleBudget,
  size?: number,
): Buffer {
  if (start === ENDOFCHAIN || start === FREESECT || size === 0) return Buffer.alloc(0);
  if (size != null && size > DOCUMENT_LIMITS.maxZipEntryBytes) throw oleTooLarge();
  const streamCap = Math.min(
    DOCUMENT_LIMITS.maxZipEntryBytes,
    Math.max(0, DOCUMENT_LIMITS.maxUnzippedBytes - budget.produced),
  );
  if (streamCap < 1) throw oleTooLarge();
  const target = size ?? streamCap;
  const parts: Buffer[] = [];
  let sector = start;
  let got = 0;
  const seen = new Set<number>();
  while (sector !== ENDOFCHAIN && sector !== FREESECT && sector !== FATSECT && got < target) {
    if (!Number.isInteger(sector) || sector < 0 || seen.has(sector) || budget.usedSectors.has(sector)) {
      throw oleTooLarge();
    }
    const offset = (sector + 1) * sectorSize;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) {
      throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    }
    const block = bytes.subarray(offset, Math.min(bytes.length, offset + sectorSize));
    if (!block.length) throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    const room = Math.min(streamCap, target) - got;
    if (room < 1) throw oleTooLarge();
    if (size == null && block.length > room) throw oleTooLarge();
    const take = block.length > room ? block.subarray(0, room) : block;
    seen.add(sector);
    budget.usedSectors.add(sector);
    parts.push(take);
    got += take.length;
    budget.produced += take.length;
    if (budget.produced > DOCUMENT_LIMITS.maxUnzippedBytes) throw oleTooLarge();
    const next = fat[sector] ?? ENDOFCHAIN;
    if (
      next !== ENDOFCHAIN &&
      next !== FREESECT &&
      next !== FATSECT &&
      (seen.has(next) || budget.usedSectors.has(next))
    ) {
      throw oleTooLarge();
    }
    sector = next;
  }
  return Buffer.concat(parts);
}

function readMini(
  miniStream: Buffer,
  fat: number[],
  start: number,
  miniSize: number,
  size: number,
  budget: OleBudget,
): Buffer {
  if (size > DOCUMENT_LIMITS.maxZipEntryBytes) throw oleTooLarge();
  if (size < 1) return Buffer.alloc(0);
  const streamCap = Math.min(
    DOCUMENT_LIMITS.maxZipEntryBytes,
    Math.max(0, DOCUMENT_LIMITS.maxUnzippedBytes - budget.produced),
  );
  if (streamCap < 1) throw oleTooLarge();
  const parts: Buffer[] = [];
  let sector = start;
  let got = 0;
  const seen = new Set<number>();
  while (sector !== ENDOFCHAIN && sector !== FREESECT && got < size) {
    if (!Number.isInteger(sector) || sector < 0 || seen.has(sector) || budget.usedMini.has(sector)) {
      throw oleTooLarge();
    }
    const at = sector * miniSize;
    if (!Number.isSafeInteger(at) || at < 0 || at >= miniStream.length) {
      throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    }
    const block = miniStream.subarray(at, Math.min(miniStream.length, at + miniSize));
    if (!block.length) throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    const room = Math.min(streamCap, size) - got;
    if (room < 1) throw oleTooLarge();
    const take = block.length > room ? block.subarray(0, room) : block;
    seen.add(sector);
    budget.usedMini.add(sector);
    parts.push(take);
    got += take.length;
    budget.produced += take.length;
    if (budget.produced > DOCUMENT_LIMITS.maxUnzippedBytes) throw oleTooLarge();
    const next = fat[sector] ?? ENDOFCHAIN;
    if (next !== ENDOFCHAIN && next !== FREESECT && (seen.has(next) || budget.usedMini.has(next))) {
      throw oleTooLarge();
    }
    sector = next;
  }
  return Buffer.concat(parts);
}

function parseDirectory(buf: Buffer): DirEntry[] {
  const entries: DirEntry[] = [];
  for (let i = 0; i + 128 <= buf.length; i += 128) {
    const type = buf[i + 66] ?? 0;
    if (!type) continue;
    if (entries.length >= DOCUMENT_LIMITS.maxZipEntries) throw oleTooLarge();
    const nameLen = buf.readUInt16LE(i + 64);
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    const name = buf.slice(i, i + Math.max(0, nameLen - 2)).toString('utf16le').replace(/\u0000/g, '');
    entries.push({
      name,
      type,
      start: buf.readUInt32LE(i + 116),
      size: buf.readUInt32LE(i + 120),
    });
  }
  return entries;
}

/**
 * Build a tiny compound file with one regular-sector stream.
 * The mini-stream cutoff is 0 so the stream lives in the FAT, which is enough
 * for synthetic fixtures and for the reader tests.
 */
export function writeOleStream(name: string, data: Buffer): Buffer {
  const sectorSize = 512;
  const header = Buffer.alloc(sectorSize);
  header.writeUInt32LE(0xe011cfd0, 0);
  header.writeUInt32LE(0xe11ab1a1, 4);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(0x0003, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(0, 0x38);
  header.writeUInt32LE(ENDOFCHAIN, 0x3c);
  header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(ENDOFCHAIN, 0x44);
  header.writeUInt32LE(0, 0x48);
  header.writeUInt32LE(0, 0x4c);

  const dataSectors = Math.max(1, Math.ceil(data.length / sectorSize));
  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeUInt32LE(FATSECT, 0);
  fat.writeUInt32LE(ENDOFCHAIN, 4);
  for (let i = 0; i < dataSectors; i += 1) {
    const next = i + 1 < dataSectors ? 2 + i + 1 : ENDOFCHAIN;
    fat.writeUInt32LE(next, (2 + i) * 4);
  }
  const directory = Buffer.alloc(sectorSize, 0);
  writeDir(directory, 0, 'Root Entry', 5, 1, ENDOFCHAIN, 0);
  writeDir(directory, 128, name, 2, FREESECT, 2, data.length);
  const payload = Buffer.alloc(dataSectors * sectorSize);
  data.copy(payload);
  return Buffer.concat([header, fat, directory, payload]);
}

function writeDir(buf: Buffer, at: number, name: string, type: number, child: number, start: number, size: number) {
  const encoded = Buffer.from(name, 'utf16le');
  encoded.copy(buf, at, 0, Math.min(encoded.length, 62));
  buf.writeUInt16LE(Math.min(encoded.length + 2, 64), at + 64);
  buf[at + 66] = type;
  buf[at + 67] = 1;
  buf.writeUInt32LE(FREESECT, at + 68);
  buf.writeUInt32LE(FREESECT, at + 72);
  buf.writeUInt32LE(child, at + 76);
  buf.writeUInt32LE(start, at + 116);
  buf.writeUInt32LE(size, at + 120);
}
