/**
 * Everything the phone does to a video before it leaves.
 *
 * Three jobs, all of them in the browser and none of them on the server:
 *
 *   Hash it.      SHA-256 of the bytes, so re-uploading yesterday's footage is
 *                 caught. Done here because the server never sees the file —
 *                 the upload goes straight to storage — so if the device does
 *                 not fingerprint it, nothing does.
 *
 *   Read it.      Duration, and stills from across the clip. The stills are
 *                 what the model reads: a handful of JPEGs is a fraction of the
 *                 bytes of the video and the only form a vision model can take.
 *                 Doing it here also means the server needs no video toolchain.
 *
 *   Locate it.    Where the phone is, with its own reported accuracy. Refused
 *                 permission is a missing fact, not a failure — the upload
 *                 still goes, and the record says the location is unknown.
 *
 * Everything degrades rather than blocks. A browser that cannot decode the file
 * still uploads it; the day is then unproven rather than unrecorded, and
 * unproven is a state the whole system is built to handle honestly.
 */

export interface CaptureFacts {
  contentHash: string | null;
  durationSeconds: number | null;
  capturedAt: string;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  frames: Array<{ atSeconds: number; base64: string }>;
}

/** SHA-256 of the file, hex. Null where the browser has no SubtleCrypto. */
export async function hashFile(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Where the phone is, if it will say.
 *
 * Short timeout on purpose: a crew standing in a doorway at the end of a long
 * day should not wait thirty seconds for a fix that is not coming. No location
 * is a worse record than a location, and both are better than an upload
 * abandoned because the dialogue hung.
 */
export function currentPosition(timeoutMs = 8000): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/**
 * Pull stills from the clip.
 *
 * Evenly spaced across the whole video rather than the first N seconds — the
 * opening of a walkthrough is always the front door, and the front door is
 * never the work.
 */
export async function extractFrames(
  file: File,
  count = 6,
  maxEdge = 900,
): Promise<{ durationSeconds: number | null; frames: Array<{ atSeconds: number; base64: string }> }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  // Required for iOS Safari, which otherwise takes over the screen with a
  // fullscreen player the moment the video is asked to play.
  video.playsInline = true;
  video.src = url;

  try {
    const duration = await new Promise<number | null>((resolve) => {
      const done = () => resolve(Number.isFinite(video.duration) ? video.duration : null);
      video.onloadedmetadata = done;
      video.onerror = () => resolve(null);
      setTimeout(done, 5000);
    });

    if (!duration || duration <= 0) return { durationSeconds: duration, frames: [] };

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return { durationSeconds: duration, frames: [] };

    const frames: Array<{ atSeconds: number; base64: string }> = [];
    for (let i = 0; i < count; i += 1) {
      // Nudged off the exact ends: the first and last frames of a phone
      // recording are usually a thumb over the lens.
      const at = duration * ((i + 0.5) / count);
      const drew = await new Promise<boolean>((resolve) => {
        const onSeeked = () => {
          const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(true);
        };
        video.onseeked = onSeeked;
        video.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 4000);
        video.currentTime = at;
      });
      if (!drew) continue;

      // 0.7 is the point where a JPEG of a room still shows what changed and
      // the payload stops growing. Six of these is well under a megabyte.
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const base64 = dataUrl.split(',')[1];
      if (base64) frames.push({ atSeconds: Math.round(at * 100) / 100, base64 });
    }

    return { durationSeconds: duration, frames };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Everything, in the order that keeps the crew waiting least. */
export async function readCapture(file: File): Promise<CaptureFacts> {
  // Location first and in parallel: it is the slowest and the only one that
  // depends on the physical world.
  const [position, hash, media] = await Promise.all([
    currentPosition(),
    hashFile(file),
    extractFrames(file),
  ]);

  return {
    contentHash: hash,
    durationSeconds: media.durationSeconds,
    // The file's own modification time, which for a fresh recording is when it
    // was filmed. Falls back to now — recorded either way, and the server's
    // receipt time is what the check actually compares against.
    capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
    lat: position?.coords.latitude ?? null,
    lon: position?.coords.longitude ?? null,
    accuracyM: position?.coords.accuracy ?? null,
    frames: media.frames,
  };
}

/** Today, as the site would write it. */
export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
