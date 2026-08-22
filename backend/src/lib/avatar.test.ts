import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  avatarPathFromUrl,
  avatarStoragePath,
  dataUrlFor,
  isDisplayableAvatarUrl,
  isStoredAvatarObject,
  sniffAvatarMediaType,
} from './avatar.js';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

describe('sniffAvatarMediaType', () => {
  it('recognises pictures and icon files by magic bytes', () => {
    assert.equal(sniffAvatarMediaType(JPEG), 'image/jpeg');
    assert.equal(sniffAvatarMediaType(PNG), 'image/png');
    assert.equal(sniffAvatarMediaType(WEBP), 'image/webp');
    assert.equal(sniffAvatarMediaType(GIF), 'image/gif');
    assert.equal(sniffAvatarMediaType(ICO), 'image/x-icon');
  });

  it('rejects empty or non-image bytes', () => {
    assert.equal(sniffAvatarMediaType(Buffer.from('not-an-image')), null);
    assert.equal(sniffAvatarMediaType(Buffer.from([0x00])), null);
  });
});

describe('avatar storage path', () => {
  it('keeps each user under their own folder', () => {
    assert.equal(
      avatarStoragePath('11111111-1111-1111-1111-111111111111', 'image/jpeg'),
      '11111111-1111-1111-1111-111111111111/avatar.jpg',
    );
    assert.equal(
      avatarStoragePath('11111111-1111-1111-1111-111111111111', 'image/png'),
      '11111111-1111-1111-1111-111111111111/avatar.png',
    );
  });
});

describe('isDisplayableAvatarUrl', () => {
  it('accepts https photos and raster data URLs', () => {
    assert.equal(isDisplayableAvatarUrl('https://img.example/a.jpg'), true);
    assert.equal(isDisplayableAvatarUrl(dataUrlFor(JPEG, 'image/jpeg')), true);
    assert.equal(isDisplayableAvatarUrl('javascript:alert(1)'), false);
    assert.equal(isDisplayableAvatarUrl('data:text/html;base64,PHNjcmlwdD4='), false);
  });
});

describe('stored avatar objects', () => {
  it('extracts the object path only for this user', () => {
    const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const url = `https://proj.supabase.co/storage/v1/object/public/avatars/${userId}/avatar.jpg`;
    assert.equal(isStoredAvatarObject(url), true);
    assert.equal(avatarPathFromUrl(url, userId), `${userId}/avatar.jpg`);
    assert.equal(avatarPathFromUrl(url, 'someone-else'), null);
  });
});
