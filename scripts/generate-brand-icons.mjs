#!/usr/bin/env node
/**
 * Rasterize the Atmosphere five-bar mark into the PNG / ICO sizes the
 * dashboard, Field Capture, and PWA manifests already reference.
 *
 * Bar geometry matches website/icons and frontend/public/icons/favicon.svg
 * (22×22 viewBox, five 2.8-tall bands, 2.0 gaps). Tab favicons stay
 * transparent; home-screen icons sit on the paper ground iOS requires.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const BAR_FILLS = [
  [0xa8, 0xa2, 0x9e, 0xff],
  [0x78, 0x71, 0x6c, 0xff],
  [0x57, 0x53, 0x4e, 0xff],
  [0x29, 0x25, 0x24, 0xff],
  [0xf2, 0x67, 0x0c, 0xff],
];
const PAPER = [0xf0, 0xee, 0xe9, 0xff];
const VIEW = 22;
const BAR_H = 2.8;
const BAR_Y = [0, 4.8, 9.6, 14.4, 19.2];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function paintBars(size, { background, pad = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  if (background) {
    for (let i = 0; i < size * size; i++) rgba.set(background, i * 4);
  }
  const inner = size - pad * 2;
  const scale = inner / VIEW;
  for (let i = 0; i < BAR_Y.length; i++) {
    const color = BAR_FILLS[i];
    const y0 = Math.round(pad + BAR_Y[i] * scale);
    const y1 = Math.round(pad + (BAR_Y[i] + BAR_H) * scale);
    const x0 = Math.round(pad);
    const x1 = Math.round(pad + VIEW * scale);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        rgba.set(color, (y * size + x) * 4);
      }
    }
  }
  return encodePng(size, size, rgba);
}

function encodeIco(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size === 256 ? 0 : size;
  header[7] = size === 256 ? 0 : size;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const frontendIcons = join(repoRoot, 'frontend/public/icons');
const fieldIcons = join(repoRoot, 'fieldcapture/icons');
const verifierIcons = join(repoRoot, 'verifier/icons');
for (const dir of [frontendIcons, fieldIcons, verifierIcons]) mkdirSync(dir, { recursive: true });

const favicon32 = paintBars(32);
const apple180 = paintBars(180, { background: PAPER, pad: 32 });
const pwa192 = paintBars(192, { background: PAPER, pad: 34 });
const pwa512 = paintBars(512, { background: PAPER, pad: 92 });

const named = [
  ['favicon-32.png', favicon32],
  ['atmosphere-180.png', apple180],
  ['atmosphere-192.png', pwa192],
  ['atmosphere-512.png', pwa512],
];

for (const dir of [frontendIcons, fieldIcons, verifierIcons]) {
  for (const [name, buf] of named) writeFileSync(join(dir, name), buf);
}

writeFileSync(join(repoRoot, 'frontend/public/favicon.ico'), encodeIco(favicon32, 32));

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">
  <rect width="22" height="2.8" fill="#A8A29E"/>
  <rect y="4.8" width="22" height="2.8" fill="#78716C"/>
  <rect y="9.6" width="22" height="2.8" fill="#57534E"/>
  <rect y="14.4" width="22" height="2.8" fill="#292524"/>
  <rect y="19.2" width="22" height="2.8" fill="#F2670C"/>
</svg>
`;
writeFileSync(join(frontendIcons, 'favicon.svg'), svg);
writeFileSync(join(fieldIcons, 'favicon.svg'), svg);
writeFileSync(join(verifierIcons, 'favicon.svg'), svg);

console.log('Wrote Atmosphere bar icons to frontend/public, fieldcapture/icons, and verifier/icons.');
