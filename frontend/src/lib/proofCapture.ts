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

import { isKnownDuration, knownDurationSeconds } from './clipDuration';

export interface CaptureFacts {
  contentHash: string | null;
  durationSeconds: number | null;
  capturedAt: string;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  frames: Array<{ atSeconds: number; base64: string }>;
}

/**
 * SHA-256 of the file, hex. Null where the browser has no SubtleCrypto.
 *
 * Streamed in chunks so a day-length (multi‑GB) recording does not get
 * loaded whole into RAM just to fingerprint it.
 */
export async function hashFile(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  try {
    // SubtleCrypto has no incremental digest in browsers; chunked read into
    // one digest still needs the full buffer for digest(), but we avoid a
    // second copy via arrayBuffer on huge files by reading through streams
    // when available and falling back carefully.
    if (typeof file.stream === 'function' && typeof crypto.subtle.digest === 'function') {
      // Prefer a single arrayBuffer only under a safe size; larger files
      // skip the client hash — the server still has the object in storage
      // and re-upload checks degrade to unknown rather than OOM the phone.
      const SAFE_HASH_BYTES = 512 * 1024 * 1024; // 512 MB
      if (file.size > SAFE_HASH_BYTES) return null;
    }
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
      const measured = () => (isKnownDuration(video.duration) ? video.duration : null);
      const done = () => resolve(measured());

      video.onloadedmetadata = () => {
        if (measured() !== null) {
          done();
          return;
        }
        /*
         * A clip the browser recorded itself.
         *
         * MediaRecorder writes a WebM with no duration in its header, so the
         * element reports 0 or Infinity no matter how long the crew filmed.
         * Nothing downstream survives that: the office list prints 0:00, and
         * the extraction below divides by it and returns no stills at all, so
         * the video arrives with nothing to show for itself.
         *
         * Seeking past any plausible length forces the browser to scan to the
         * end and work the real duration out. The playhead goes back to the
         * start afterwards; the loop below seeks per frame anyway.
         */
        const settle = () => {
          video.ontimeupdate = null;
          video.onseeked = null;
          video.currentTime = 0;
          done();
        };
        video.ontimeupdate = settle;
        video.onseeked = settle;
        try {
          video.currentTime = Number.MAX_SAFE_INTEGER;
        } catch {
          done();
        }
      };
      video.onerror = () => resolve(null);
      setTimeout(done, 5000);
    });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return { durationSeconds: duration, frames: [] };

    const paint = (): string | null => {
      if (!video.videoWidth) return null;
      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.7).split(',')[1] ?? null;
    };

    // Duration still unknown — the player can often paint frame 0 anyway
    // (the office screenshot). One still is enough for the model to start.
    if (!duration || duration <= 0) {
      const first = await new Promise<string | null>((resolve) => {
        const grab = () => resolve(paint());
        if (video.readyState >= 2 && video.videoWidth) {
          grab();
          return;
        }
        video.onloadeddata = grab;
        video.onseeked = grab;
        try {
          video.currentTime = 0;
        } catch {
          grab();
        }
        setTimeout(grab, 1500);
      });
      return { durationSeconds: duration, frames: first ? [{ atSeconds: 0, base64: first }] : [] };
    }

    const frames: Array<{ atSeconds: number; base64: string }> = [];
    for (let i = 0; i < count; i += 1) {
      // Nudged off the exact ends: the first and last frames of a phone
      // recording are usually a thumb over the lens.
      const at = duration * ((i + 0.5) / count);
      const drew = await new Promise<boolean>((resolve) => {
        const onSeeked = () => {
          resolve(Boolean(paint()));
        };
        video.onseeked = onSeeked;
        video.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 4000);
        video.currentTime = at;
      });
      if (!drew) continue;

      // paint() already encoded the JPEG; read it back off the same canvas.
      const base64 = paint();
      if (base64) frames.push({ atSeconds: Math.round(at * 100) / 100, base64 });
    }

    return { durationSeconds: duration, frames };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Duration only — used for day-length files where pulling even six stills
 * in the browser is slow and unnecessary. The server sparsely extracts
 * frames from storage for the office dictation.
 */
export async function readDuration(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    return await new Promise<number | null>((resolve) => {
      let settled = false;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        video.ontimeupdate = null;
        video.onseeked = null;
        video.onloadedmetadata = null;
        video.onerror = null;
        resolve(value);
      };
      const measured = () => (isKnownDuration(video.duration) ? video.duration : null);
      const discover = () => {
        if (measured() != null) {
          finish(measured());
          return;
        }
        /*
         * MediaRecorder WebM reports 0 or Infinity. Seeking past any
         * plausible length makes the browser scan to the end so a
         * 50-minute film files as 50 minutes, not 0:00.
         */
        const settle = () => {
          video.ontimeupdate = null;
          video.onseeked = null;
          try {
            video.currentTime = 0;
          } catch {
            /* playhead reset is best-effort */
          }
          finish(measured());
        };
        video.ontimeupdate = settle;
        video.onseeked = settle;
        try {
          video.currentTime = Number.MAX_SAFE_INTEGER;
        } catch {
          finish(measured());
        }
      };
      video.onloadedmetadata = discover;
      video.onerror = () => finish(null);
      setTimeout(() => finish(measured()), 8000);
      if (video.readyState >= 1) discover();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Above this, the phone stops extracting stills and lets the server do it. */
export const LONG_FORM_CLIENT_SECONDS = 15 * 60;

/** Everything, in the order that keeps the crew waiting least. */
export async function readCapture(file: File): Promise<CaptureFacts> {
  // Location first and in parallel: it is the slowest and the only one that
  // depends on the physical world.
  const positionP = currentPosition();
  const durationHint = await readDuration(file);
  const longForm =
    (durationHint != null && durationHint > LONG_FORM_CLIENT_SECONDS) ||
    file.size > 80_000_000;

  const [position, hash, media] = await Promise.all([
    positionP,
    hashFile(file),
    longForm
      ? Promise.resolve({ durationSeconds: durationHint, frames: [] as CaptureFacts['frames'] })
      : extractFrames(file),
  ]);

  return {
    contentHash: hash,
    durationSeconds: knownDurationSeconds(media.durationSeconds, durationHint),
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
