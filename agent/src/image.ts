import sharp from 'sharp';

/**
 * Screenshot geometry.
 *
 * Claude returns coordinates in the space of the image it was shown. If the API
 * silently downscales an oversized screenshot, those coordinates land in a
 * scale we never computed and every click misses. So the agent does the
 * downscale itself, keeps the factor, and maps coordinates back before touching
 * the mouse.
 */

export interface PngSize {
  width: number;
  height: number;
}

export async function pngSize(png: Buffer): Promise<PngSize> {
  const { width, height } = await sharp(png).metadata();
  if (!width || !height) throw new Error('Could not read screenshot dimensions.');
  return { width, height };
}

/**
 * The largest factor ≤ 1 that brings an image inside the model's per-image
 * limits: both the long-edge cap and the total-pixel budget.
 */
export function scaleFactorFor(
  width: number,
  height: number,
  maxLongEdge: number,
  maxPixels: number,
): number {
  const longEdge = Math.max(width, height);
  const totalPixels = width * height;
  return Math.min(1, maxLongEdge / longEdge, Math.sqrt(maxPixels / totalPixels));
}

/** Resize to exact dimensions, staying PNG (lossless text is what matters here). */
export async function resizePng(
  png: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(png)
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/**
 * Crop a region out of a full-resolution screenshot for the `zoom` action.
 *
 * Zoom exists so Claude can read text too small to survive the downscale, so
 * the crop is taken from the *native* capture and returned without shrinking it
 * back down (only clamped if the region itself exceeds the model's limits).
 */
export async function cropPng(
  png: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
  maxLongEdge: number,
  maxPixels: number,
): Promise<Buffer> {
  const source = sharp(png);
  const meta = await source.metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  // Clamp into the image; a region partly off-screen should still return the
  // visible part rather than failing the whole tool call.
  const l = Math.max(0, Math.min(left, Math.max(0, imgW - 1)));
  const t = Math.max(0, Math.min(top, Math.max(0, imgH - 1)));
  const w = Math.max(1, Math.min(width, imgW - l));
  const h = Math.max(1, Math.min(height, imgH - t));

  const cropped = await sharp(png)
    .extract({ left: l, top: t, width: w, height: h })
    .png({ compressionLevel: 6 })
    .toBuffer();

  const scale = scaleFactorFor(w, h, maxLongEdge, maxPixels);
  if (scale >= 1) return cropped;
  return resizePng(cropped, Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale)));
}
