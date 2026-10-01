/**
 * Minimal ZIP reader and writer for Office Open XML.
 * Reads stored and deflated entries. Does not execute anything inside the archive.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { DOCUMENT_LIMITS } from './limits.js';
import { DocumentReadError } from './types.js';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const DESCRIPTOR = 0x08074b50;

function unzippedTooLarge(): DocumentReadError {
  const mb = Math.round(DOCUMENT_LIMITS.maxUnzippedBytes / (1024 * 1024));
  return new DocumentReadError(`This file is over the ${mb} MB limit.`, 'too_large');
}

function inflateCapped(compressed: Buffer, room: number): Buffer {
  if (room < 1) throw unzippedTooLarge();
  try {
    return inflateRawSync(compressed, { maxOutputLength: room });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (code === 'ERR_BUFFER_TOO_LARGE') throw unzippedTooLarge();
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
}

export function readZip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== LOCAL) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  const files = new Map<string, Buffer>();
  let offset = 0;
  let unzipped = 0;
  while (offset + 30 <= bytes.length) {
    const sig = bytes.readUInt32LE(offset);
    if (sig === CENTRAL || sig === EOCD) break;
    if (sig !== LOCAL) break;
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    let compSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLen = bytes.readUInt16LE(offset + 26);
    const extraLen = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    if (nameStart + nameLen + extraLen > bytes.length) {
      throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    }
    const name = bytes.slice(nameStart, nameStart + nameLen).toString('utf8').replace(/\\/g, '/');
    const dataStart = nameStart + nameLen + extraLen;
    let dataEnd = dataStart + compSize;
    let descriptor = 0;
    if ((flags & 0x08) !== 0 && compSize === 0) {
      const found = findNextZipSig(bytes, dataStart);
      if (found < 0) throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
      dataEnd = found;
      compSize = dataEnd - dataStart;
      if (bytes.readUInt32LE(dataEnd) === DESCRIPTOR) descriptor = 16;
      else descriptor = 12;
    }
    if (dataEnd > bytes.length) {
      throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    }
    const compressed = bytes.slice(dataStart, dataEnd);
    const room = DOCUMENT_LIMITS.maxUnzippedBytes - unzipped;
    if (uncompressedSize === 0xffffffff || (uncompressedSize > 0 && uncompressedSize > room)) {
      throw unzippedTooLarge();
    }
    let content: Buffer;
    if (method === 0) {
      if (compressed.length > room) throw unzippedTooLarge();
      content = compressed;
    } else if (method === 8) content = inflateCapped(compressed, room);
    else {
      throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
    }
    if (content.length > room) throw unzippedTooLarge();
    unzipped += content.length;
    if (name && !name.endsWith('/')) files.set(name, content);
    offset = dataEnd + descriptor;
  }
  if (!files.size) {
    throw new DocumentReadError('This file looks damaged and could not be read.', 'corrupt');
  }
  return files;
}

function findNextZipSig(bytes: Buffer, from: number): number {
  for (let i = from; i + 4 <= bytes.length; i += 1) {
    const sig = bytes.readUInt32LE(i);
    if (sig === LOCAL || sig === CENTRAL || sig === EOCD || sig === DESCRIPTOR) return i;
  }
  return -1;
}

/** Stored or deflated ZIP. Used for synthetic docx and pptx fixtures. */
export function writeZip(entries: Array<{ name: string; data: Buffer | string }>, method: 0 | 8 = 8): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localFull = Buffer.concat([local, name, data]);
    locals.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localFull.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
