/**
 * Compound File Binary reader for legacy .doc and .xls.
 * Enough to pull a named stream. Mini-streams are followed when the file uses them.
 */
import { DocumentReadError } from './types.js';

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;

export type OleFile = {
  streams: Map<string, Buffer>;
};

export function readOle(bytes: Buffer): OleFile {
  if (bytes.length < 512 || bytes.readUInt32LE(0) !== 0xe011cfd0) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const sectorShift = bytes.readUInt16LE(0x1e);
  const sectorSize = 2 ** sectorShift;
  const miniShift = bytes.readUInt16LE(0x20);
  const miniSize = 2 ** miniShift;
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
  const table = buildFat(bytes, fat, sectorSize);
  const directory = readChain(bytes, table, dirStart, sectorSize);
  const entries = parseDirectory(directory);
  const root = entries.find((entry) => entry.type === 5) ?? entries[0];
  const miniStream = root && root.start !== ENDOFCHAIN ? readChain(bytes, table, root.start, sectorSize, root.size) : Buffer.alloc(0);
  const miniTable = miniFatStart === ENDOFCHAIN || miniFatStart === FREESECT
    ? []
    : fatNumbers(readChain(bytes, table, miniFatStart, sectorSize));
  const streams = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.type !== 2 || !entry.name) continue;
    const data = entry.size < miniCutoff && miniTable.length
      ? readMini(miniStream, miniTable, entry.start, miniSize, entry.size)
      : readChain(bytes, table, entry.start, sectorSize, entry.size);
    streams.set(entry.name, data.slice(0, entry.size));
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

function readChain(bytes: Buffer, fat: number[], start: number, sectorSize: number, size?: number): Buffer {
  const parts: Buffer[] = [];
  let sector = start;
  const seen = new Set<number>();
  while (sector !== ENDOFCHAIN && sector !== FREESECT && sector !== FATSECT && !seen.has(sector)) {
    seen.add(sector);
    parts.push(sectorAt(bytes, sector, sectorSize));
    sector = fat[sector] ?? ENDOFCHAIN;
    if (parts.length > 4096) break;
  }
  const all = Buffer.concat(parts);
  return size != null ? all.slice(0, size) : all;
}

function readMini(miniStream: Buffer, fat: number[], start: number, miniSize: number, size: number): Buffer {
  const parts: Buffer[] = [];
  let sector = start;
  const seen = new Set<number>();
  while (sector !== ENDOFCHAIN && sector !== FREESECT && !seen.has(sector) && parts.join('').length < size + miniSize) {
    seen.add(sector);
    const at = sector * miniSize;
    parts.push(miniStream.slice(at, at + miniSize));
    sector = fat[sector] ?? ENDOFCHAIN;
    if (parts.length > 4096) break;
  }
  return Buffer.concat(parts).slice(0, size);
}

function parseDirectory(buf: Buffer): DirEntry[] {
  const entries: DirEntry[] = [];
  for (let i = 0; i + 128 <= buf.length; i += 128) {
    const type = buf[i + 66] ?? 0;
    if (!type) continue;
    const nameLen = buf.readUInt16LE(i + 64);
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
