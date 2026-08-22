/** Client-side rules for turning a picked photo or icon into a profile avatar. */

export const AVATAR_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,.ico';
export const AVATAR_MAX_EDGE = 384;
export const AVATAR_MAX_SOURCE_BYTES = 8 * 1024 * 1024;

const NAMED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export function isAvatarFile(file: File): boolean {
  if (NAMED_TYPES.has(file.type.toLowerCase())) return true;
  return /\.(jpe?g|png|webp|gif|ico)$/i.test(file.name);
}

export function keepsTransparency(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === 'image/png' || type === 'image/webp' || type.includes('icon')) return true;
  return /\.(png|webp|ico)$/i.test(file.name);
}

export interface PreparedAvatar {
  filename: string;
  mediaType: 'image/jpeg' | 'image/png';
  contentBase64: string;
  previewUrl: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not encode that picture.'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Square-crop and shrink a photo or icon so the avatar bubble stays sharp
 * without shipping a multi-megabyte phone picture.
 */
export async function prepareAvatarUpload(file: File): Promise<PreparedAvatar> {
  if (!isAvatarFile(file)) {
    throw new Error('Use a JPEG, PNG, WebP, GIF, or ICO image.');
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    throw new Error('That file is larger than 8 MB.');
  }

  const image = await loadImage(file);
  const source = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (!source) throw new Error('That image has no size.');

  const edge = Math.min(AVATAR_MAX_EDGE, source);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare that picture.');

  const sx = Math.max(0, ((image.naturalWidth || image.width) - source) / 2);
  const sy = Math.max(0, ((image.naturalHeight || image.height) - source) / 2);
  context.drawImage(image, sx, sy, source, source, 0, 0, edge, edge);

  const transparent = keepsTransparency(file);
  const mediaType = transparent ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, mediaType, transparent ? undefined : 0.86);
  const contentBase64 = await blobToBase64(blob);
  const previewUrl = URL.createObjectURL(blob);

  return {
    filename: transparent ? 'avatar.png' : 'avatar.jpg',
    mediaType,
    contentBase64,
    previewUrl,
  };
}
