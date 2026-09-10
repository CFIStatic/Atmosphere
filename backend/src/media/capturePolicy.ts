/**
 * Field / proof video is always an audiovisual recording.
 *
 * Sparse stills and dictation read frames; the stored object must still carry
 * the microphone track so the office can hear the site (and so future
 * transcription can run). Silent "video-only" containers are rejected for
 * day-film kinds unless explicitly marked evidence-still / frame.
 */
import { HttpError } from '../lib/errors.js';
import type { MediaKind } from './types.js';

/** Kinds that must be muxed A/V (camera + microphone). */
export const AUDIOVISUAL_KINDS: ReadonlySet<MediaKind> = new Set([
  'proof_video',
  'field_day_video',
]);

export function kindRequiresAudio(kind: MediaKind): boolean {
  return AUDIOVISUAL_KINDS.has(kind);
}

/**
 * Enforce capture policy at catalog mint / complete time.
 * `hasAudio` is reported by the client after recording (or probed later).
 */
export function assertAudiovisualPolicy(input: {
  kind: MediaKind;
  hasAudio: boolean | null | undefined;
  /** When true, missing audio fails hard; when false, only warn via return. */
  strict?: boolean;
}): void {
  if (!kindRequiresAudio(input.kind)) return;
  if (input.hasAudio === true) return;
  if (input.hasAudio === false || input.hasAudio == null) {
    if (input.strict !== false) {
      throw new HttpError(
        400,
        'Field day and proof videos must include a microphone track (video + audio). Re-record with mic permission enabled.',
        'audio_required',
      );
    }
  }
}

/**
 * Preferred container/codecs + quality caps for App Store + web day film.
 *
 * Target: ~720p, ~24–30 fps, ~2 Mbps video, microphone kept (A/V).
 * Clients should treat these as ideals — devices negotiate downward.
 */
export const PREFERRED_DAY_FILM = {
  /** Long edge / short edge for 720p (portrait phones may swap axes). */
  maxWidth: 1280,
  maxHeight: 720,
  /** Soft fps band — prefer 30, allow 24. */
  frameRateIdeal: 30,
  frameRateMin: 24,
  /** Video encode budget in bits/sec (MediaRecorder / AVFoundation). */
  videoBitsPerSecond: 2_000_000,
  ios: {
    fileType: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    /** AVFoundation must enable audio device input alongside video. */
    captureAudio: true,
    /** AVCaptureSession.Preset.hd1280x720 */
    sessionPreset: 'hd1280x720' as const,
    videoBitsPerSecond: 2_000_000,
    frameRate: 30,
  },
  web: {
    mimeCandidates: [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/mp4', // Safari — typically AAC audio when mic tracks present
    ],
    /** Ideal constraints — mirrored in fieldcapture/js/capture-core.js. */
    getUserMedia: {
      video: {
        facingMode: { ideal: 'environment' as const },
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        // ideal/max only in constraints; frameRateMin documents the soft floor
        frameRate: { ideal: 30, max: 30 },
      },
      audio: true,
    },
    videoBitsPerSecond: 2_000_000,
  },
};
