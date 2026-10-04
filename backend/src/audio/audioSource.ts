/**
 * Media audio: speech from a TV, laptop, phone or radio in frame is not field
 * conversation. The vision reading says when a screen is playing; transcript
 * lines inside those moments are tagged `media`, so Ask, summaries and the
 * player never present a TV host as the homeowner or the crew.
 *
 * Speaker labels: nothing in the pipeline diarizes voices, so a "Speaker A"
 * label is made up. Unproven attribution is shown as "unknown".
 */

export type AudioSourceTag = 'field' | 'media' | 'unknown';
export type ClipAudioSource = 'field' | 'media' | 'mixed' | 'none';

export type MediaWindow = {
  startSeconds: number;
  endSeconds: number;
  device: string;
  evidence: string;
};

export type MediaAudioReading = {
  /** field: no playing screen seen; media: all speech falls in media moments; mixed: some or unknown split. */
  audioSource: ClipAudioSource;
  /** A playing screen was described for the clip without a time. */
  mediaUntimed: string | null;
  mediaWindows: MediaWindow[];
};

const DEVICE =
  /\b(tv|television|flat[- ]?screen|smart ?tv|monitor|laptop|computer screen|desktop screen|tablet|ipad|phone screen|smartphone screen|screen|radio|speaker ?phone|bluetooth speaker)\b/i;
const PLAYING =
  /\b(playing|plays|played|turned on and (?:showing|playing)|broadcast(?:ing)?|streaming|showing (?:a |an )?(?:video|show|program|programme|movie|film|news|game|cartoon|commercial|ad|clip|youtube)|tv show|news(?:cast| broadcast| program| anchor)|(?:tv|television) commercial|commercial break|sitcom|cartoon|movie|sports (?:game|broadcast)|youtube|video call|zoom call|facetime|audio (?:from|playing)|sound (?:from|of) the (?:tv|television|laptop|speaker|radio)|voices? (?:from|on) the (?:tv|television|laptop|screen|speaker|radio)|talk show|podcast|music video|narrator|presenter)\b/i;
const NEGATED =
  /\b(off|powered (?:down|off)|turned off|blank|black(?:\/off)?|not (?:on|playing|in use)|no (?:on-screen|broadcast|picture|image|video|sound|programme|program)|nothing (?:on|playing)|screen (?:is )?dark)\b/i;

/** Transcript phrasing that is typical of broadcast or online video, not a job site. */
const BROADCAST_LINE =
  /\b(coming up next|stay tuned|after the break|back after this|brought to you by|breaking news|don't forget to (?:like|subscribe)|like and subscribe|smash that like|this episode|in today's video|welcome back to the (?:show|channel)|tonight on)\b/i;

type TimedRow = { atSeconds?: number | null; startSeconds?: number | null; endSeconds?: number | null; text?: string | null; description?: string | null; summary?: string | null };

function sentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A sentence that describes a screen/radio actively producing sound or pictures. */
export function describesPlayingMedia(sentence: string): { device: string } | null {
  const device = sentence.match(DEVICE);
  if (!device) return null;
  if (!PLAYING.test(sentence)) return null;
  if (NEGATED.test(sentence)) return null;
  return { device: device[1]!.toLowerCase() };
}

function rowStart(row: TimedRow): number | null {
  const n = Number(row.startSeconds ?? row.atSeconds);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Read the vision narration and timed events for a playing screen. Timed rows
 * give media windows (until the next timed row, or +10s); an untimed mention
 * only marks the clip as possibly mixed.
 */
export function readMediaAudio(input: {
  narration?: string | null;
  events?: TimedRow[] | null;
  durationSeconds?: number | null;
  hasSpeech?: boolean;
}): MediaAudioReading {
  const timed = (input.events ?? [])
    .map((row) => ({ at: rowStart(row), end: Number(row.endSeconds), text: String(row.text ?? row.description ?? row.summary ?? '') }))
    .filter((row): row is { at: number; end: number; text: string } => row.at != null && !!row.text)
    .sort((a, b) => a.at - b.at);
  const windows: MediaWindow[] = [];
  timed.forEach((row, index) => {
    for (const sentence of sentences(row.text)) {
      const hit = describesPlayingMedia(sentence);
      if (!hit) continue;
      const next = timed.slice(index + 1).find((later) => later.at > row.at);
      const end = Number.isFinite(row.end) && row.end > row.at ? row.end : next ? next.at : row.at + 10;
      windows.push({ startSeconds: row.at, endSeconds: end, device: hit.device, evidence: sentence.slice(0, 240) });
      break;
    }
  });
  let mediaUntimed: string | null = null;
  for (const sentence of sentences(input.narration ?? '')) {
    if (describesPlayingMedia(sentence)) {
      mediaUntimed = sentence.slice(0, 240);
      break;
    }
  }
  const audioSource: ClipAudioSource = !input.hasSpeech
    ? 'none'
    : windows.length || mediaUntimed
      ? 'mixed'
      : 'field';
  return { audioSource, mediaUntimed, mediaWindows: mergeWindows(windows) };
}

function mergeWindows(windows: MediaWindow[]): MediaWindow[] {
  const out: MediaWindow[] = [];
  for (const window of windows.sort((a, b) => a.startSeconds - b.startSeconds)) {
    const last = out[out.length - 1];
    if (last && window.startSeconds <= last.endSeconds + 1) {
      last.endSeconds = Math.max(last.endSeconds, window.endSeconds);
      continue;
    }
    out.push({ ...window });
  }
  return out;
}

/**
 * Tag each timed line: inside a media window, or broadcast phrasing → media.
 * When a playing screen was seen but the line cannot be placed → unknown.
 * No playing screen anywhere → field.
 */
export function tagSegmentSources<T extends { tSec?: number | null; text?: string | null }>(
  rows: T[],
  reading: MediaAudioReading,
): Array<T & { source: AudioSourceTag }> {
  return rows.map((row) => {
    const at = Number(row.tSec);
    const inWindow =
      Number.isFinite(at) && reading.mediaWindows.some((w) => at >= w.startSeconds - 0.5 && at < w.endSeconds + 0.5);
    let source: AudioSourceTag;
    if (inWindow || BROADCAST_LINE.test(String(row.text ?? ''))) source = 'media';
    else if (reading.mediaUntimed && !reading.mediaWindows.length) source = 'unknown';
    else source = 'field';
    return { ...row, source };
  });
}

/** Clip-level source once lines are tagged. */
export function clipAudioSource(tags: AudioSourceTag[], reading: MediaAudioReading): ClipAudioSource {
  if (!tags.length) return 'none';
  const media = tags.filter((tag) => tag === 'media').length;
  if (media === tags.length) return 'media';
  if (media > 0 || tags.includes('unknown') || reading.mediaUntimed) return 'mixed';
  return 'field';
}

/** Diarization letters and empty labels are not an identity. */
const MADE_UP_LABEL = /^(?:speaker|voice|person|unknown speaker)?[\s_-]*(?:[a-z]|\d{1,2})?$/i;

/**
 * "unknown" for a made-up label. A letter label is kept only when the source
 * transcript itself carries it: `proof` is either the transcript text or the
 * deterministic turns parsed from it.
 */
export function provenSpeakerLabel(
  label: unknown,
  proof?: string | null | Array<{ speakerLabel?: string | null }>,
): string {
  const text = String(label ?? '').trim();
  if (!text || /^unknown$/i.test(text)) return 'unknown';
  if (!MADE_UP_LABEL.test(text) && !/^speaker\b/i.test(text)) return text;
  if (Array.isArray(proof)) {
    if (proof.some((row) => String(row.speakerLabel ?? '').trim().toLowerCase() === text.toLowerCase())) return text;
  } else if (typeof proof === 'string' && proof) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    if (new RegExp(`\\b${escaped}\\s*[:\\-–—]`, 'i').test(proof)) return text;
  }
  return 'unknown';
}
