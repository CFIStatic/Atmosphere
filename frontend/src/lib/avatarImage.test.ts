import { describe, expect, it } from 'vitest';
import { isAvatarFile, keepsTransparency } from './avatarImage';

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

describe('isAvatarFile', () => {
  it('accepts pictures and icon files', () => {
    expect(isAvatarFile(file('headshot.jpg', 'image/jpeg'))).toBe(true);
    expect(isAvatarFile(file('mark.png', 'image/png'))).toBe(true);
    expect(isAvatarFile(file('logo.webp', 'image/webp'))).toBe(true);
    expect(isAvatarFile(file('face.gif', 'image/gif'))).toBe(true);
    expect(isAvatarFile(file('app.ico', 'image/x-icon'))).toBe(true);
    expect(isAvatarFile(file('favicon.ico', ''))).toBe(true);
  });

  it('rejects documents and other uploads', () => {
    expect(isAvatarFile(file('notes.pdf', 'application/pdf'))).toBe(false);
    expect(isAvatarFile(file('clip.mp4', 'video/mp4'))).toBe(false);
    expect(isAvatarFile(file('avatar.svg', 'image/svg+xml'))).toBe(false);
  });
});

describe('keepsTransparency', () => {
  it('keeps alpha on icons and PNGs, not on photos', () => {
    expect(keepsTransparency(file('icon.png', 'image/png'))).toBe(true);
    expect(keepsTransparency(file('app.ico', 'image/x-icon'))).toBe(true);
    expect(keepsTransparency(file('photo.jpg', 'image/jpeg'))).toBe(false);
  });
});
