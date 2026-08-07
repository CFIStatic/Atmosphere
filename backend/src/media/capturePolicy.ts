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

/** Preferred container/codecs for App Store + web day film. */
export const PREFERRED_DAY_FILM = {
  ios: {
    fileType: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    /** AVFoundation must enable audio device input alongside video. */
    captureAudio: true,
  },
  web: {
    mimeCandidates: [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/mp4', // Safari — typically AAC audio when mic tracks present
    ],
    getUserMedia: { video: true, audio: true },
  },
};
