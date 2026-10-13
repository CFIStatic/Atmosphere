import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  privacyBlurWindows,
  privacySafeFilterArgs,
  privacySafePath,
  secondsInBlurWindow,
} from '../src/lib/proofPrivacySafe.js';

const child = (ranges: unknown[]) => ({ childPrivacyRedactions: { ranges } });

test('blur windows: child and private-moment ranges, padded, with the player sound rule', () => {
  assert.deepEqual(privacyBlurWindows({}), []);
  assert.deepEqual(privacyBlurWindows(null), []);
  const windows = privacyBlurWindows({
    ...child([
      { startSec: 10, endSec: 14, confidence: 0.9, reason: 'child' },
      { startSec: 30, endSec: 34, confidence: 0.9, reason: 'child', regions: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] },
    ]),
    privacyRedactions: { ranges: [{ startSec: 50, endSec: 60, confidence: 0.9, reason: 'bathroom' }] },
  });
  assert.deepEqual(windows, [
    { startSec: 9, endSec: 15.5, mute: true },
    { startSec: 29, endSec: 35.5, mute: false },
    { startSec: 49, endSec: 61.5, mute: true },
  ]);
  assert.equal(secondsInBlurWindow(12, windows), true);
  assert.equal(secondsInBlurWindow(20, windows), false);
});

test('blurred copy path changes when the ranges change', () => {
  const a = privacyBlurWindows(child([{ startSec: 10, endSec: 14, confidence: 0.9, reason: 'child' }]));
  const b = privacyBlurWindows(child([{ startSec: 10, endSec: 20, confidence: 0.9, reason: 'child' }]));
  const pa = privacySafePath('org/job/clip.webm', a);
  const pb = privacySafePath('org/job/clip.webm', b);
  assert.match(String(pa), /^org\/job\/clip\.safe-[0-9a-f]{12}\.mp4$/);
  assert.notEqual(pa, pb);
  assert.equal(privacySafePath('org/job/clip.webm', []), null);
});

test('ffmpeg args blur the whole frame through every window and mute only muted ones', () => {
  const args = privacySafeFilterArgs([
    { startSec: 9, endSec: 15.5, mute: true },
    { startSec: 29, endSec: 35.5, mute: false },
  ]);
  assert.deepEqual(args, [
    '-vf',
    "gblur=sigma=60:steps=3:enable='between(t,9,15.5)+between(t,29,35.5)'",
    '-af',
    "volume=volume=0:enable='between(t,9,15.5)'",
  ]);
  assert.deepEqual(privacySafeFilterArgs([]), []);
});

test('download hands out the blurred copy for a clip with a child, never the original', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf("'/evidence/:proofId/download'"), src.indexOf('/* ---- Shares ---- */'));
  assert.match(body, /hasPrivacyBlur\(\(proof as any\)\.ai_findings\)/);
  assert.match(body, /ensurePrivacySafeCopy\(/);
  assert.match(body, /privacy_safe_pending/);
  assert.match(body, /createSignedUrl\(downloadPath, 600, \{ download: true \}\)/);
});

test('playback serves the blurred copy when it exists, else sends the windows to blur', () => {
  const src = readFileSync(new URL('../src/routes/proofOfWork.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function proofVideoUrl'), src.indexOf('async function signedPrivacySafeUrl'));
  assert.match(body, /existingPrivacySafeCopy\(/);
  assert.match(body, /privacySafe: Boolean\(safePath\)/);
  assert.match(body, /privacyWindows: safePath \? \[\] : privacyWindows/);
});

test('posters and stills skip child / private windows', () => {
  const src = readFileSync(new URL('../src/routes/evidencePortal.ts', import.meta.url), 'utf8');
  const posters = src.slice(src.indexOf('async function posterUrls('), src.indexOf('async function frameUrls('));
  assert.match(posters, /secondsInBlurWindow\(Number\(frame\.at_seconds\), windows\)/);
  assert.match(posters, /schedulePrivacySafeCopy\(/);
  const frames = src.slice(src.indexOf('async function frameUrls('), src.indexOf('async function custodyFor('));
  assert.match(frames, /secondsInBlurWindow\(Number\(frame\.at_seconds\), windows\)\) continue/);
});

test('the evidence report keeps stills and quotes from child ranges out', () => {
  const src = readFileSync(new URL('../src/shared/jobProofPack.ts', import.meta.url), 'utf8');
  assert.match(src, /childPrivacyRedactionsFromStored\(video\.childPrivacyRedactions\)/);
});

test('Dashboard player blurs and mutes through the windows when the file is not the blurred copy', () => {
  const html = readFileSync(new URL('../../verifier/index.html', import.meta.url), 'utf8');
  assert.match(html, /function syncPrivacyBlur\(item, vid\)/);
  assert.match(html, /\.preview-stage\.is-private video/);
  assert.match(html, /video && !video\.privacySafe && Array\.isArray\(video\.privacyWindows\)/);
  assert.match(html, /!\(item\._privacyWindows && item\._privacyWindows\.length\)/);
});
