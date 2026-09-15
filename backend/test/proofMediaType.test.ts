import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/lib/errors.js';
import {
  assertAllowedProofExtension,
  assertProofBytesMatchExtension,
  extensionOfProofStoragePath,
  sniffProofMediaType,
} from '../src/lib/proofMediaType.js';

test('allowlisted proof extensions are accepted', () => {
  assert.equal(assertAllowedProofExtension('mp4'), 'mp4');
  assert.equal(assertAllowedProofExtension('MOV'), 'mov');
  assert.equal(assertAllowedProofExtension('webm'), 'webm');
});

test('non-video extensions are rejected', () => {
  assert.throws(
    () => assertAllowedProofExtension('exe'),
    (err: unknown) => err instanceof HttpError && err.code === 'unsupported_media_type',
  );
  assert.throws(
    () => assertAllowedProofExtension('php'),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  );
});

test('sniffProofMediaType recognizes webm, mp4, and avi magic bytes', () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(sniffProofMediaType(webm), 'video/webm');

  const mp4 = Buffer.alloc(32, 0);
  mp4.writeUInt32BE(24, 0);
  Buffer.from('ftypisom').copy(mp4, 4);
  assert.equal(sniffProofMediaType(mp4), 'video/mp4');

  const mov = Buffer.alloc(32, 0);
  mov.writeUInt32BE(24, 0);
  Buffer.from('ftypqt  ').copy(mov, 4);
  assert.equal(sniffProofMediaType(mov), 'video/quicktime');

  const avi = Buffer.from('RIFF....AVI ....');
  avi[4] = 0;
  avi[5] = 0;
  avi[6] = 0;
  avi[7] = 0;
  assert.equal(sniffProofMediaType(avi), 'video/x-msvideo');

  assert.equal(sniffProofMediaType(Buffer.from('hello world!!')), null);
});

test('assertProofBytesMatchExtension rejects mismatched containers', () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.equal(assertProofBytesMatchExtension(webm, 'webm'), 'video/webm');
  assert.throws(
    () => assertProofBytesMatchExtension(webm, 'mp4'),
    (err: unknown) => err instanceof HttpError && err.code === 'unsupported_media_type',
  );
});

test('extensionOfProofStoragePath reads the object suffix', () => {
  assert.equal(
    extensionOfProofStoragePath('org/job/party/2026-09-09-after-abc123.webm'),
    'webm',
  );
  assert.equal(extensionOfProofStoragePath('no-extension'), null);
});
