/**
 * Profile photo validation. The route stores either a public object-storage
 * URL or a data URL; this module only decides whether the bytes are a real
 * picture teammates should see in an <img>.
 */

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MAX_DATA_URL_BYTES = 180 * 1024;

export const AVATAR_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;

export type AvatarMediaType = (typeof AVATAR_MEDIA_TYPES)[number];

const EXTENSION_BY_TYPE: Record<AvatarMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

export function isAvatarMediaType(value: string): value is AvatarMediaType {
  return (AVATAR_MEDIA_TYPES as readonly string[]).includes(value);
}

export function avatarExtension(mediaType: AvatarMediaType): string {
  return EXTENSION_BY_TYPE[mediaType];
}

export function avatarStoragePath(userId: string, mediaType: AvatarMediaType): string {
  return `${userId}/avatar.${avatarExtension(mediaType)}`;
}

export function sniffAvatarMediaType(bytes: Buffer): AvatarMediaType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'image/x-icon';
  }
  return null;
}

/** True when the stored value is safe to put in an <img src>. */
export function isDisplayableAvatarUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image/')) {
    return /^data:image\/(jpeg|jpg|png|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=\s]+$/.test(
      trimmed,
    );
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function dataUrlFor(bytes: Buffer, mediaType: AvatarMediaType): string {
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

export function isStoredAvatarObject(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes(`/object/public/${AVATAR_BUCKET}/`) || url.includes(`/${AVATAR_BUCKET}/`);
}

export function avatarPathFromUrl(url: string, userId: string): string | null {
  const marker = `/${AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split('?')[0];
  if (!path.startsWith(`${userId}/`)) return null;
  return decodeURIComponent(path);
}
