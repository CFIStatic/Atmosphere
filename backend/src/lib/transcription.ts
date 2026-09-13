import { config } from '../config.js';
import { HttpError } from './errors.js';

/**
 * Server-side speech-to-text.
 *
 * The browser's own `SpeechRecognition` handles dictation on Chrome and Edge
 * for free, so this exists for everyone else — iOS Safari and Firefox have no
 * usable Web Speech API, and those are exactly the phones technicians carry.
 * There the client records with MediaRecorder and posts the clip here.
 *
 * Any OpenAI-compatible `/audio/transcriptions` endpoint works (Whisper on
 * OpenAI, Groq, or a self-hosted whisper.cpp server), which keeps the choice
 * of provider — and the cost — with whoever deploys this.
 *
 * Proof captions and Ask conversation answers need seek times. Whisper-family
 * models return verbose_json segments; other models (gpt-4o-transcribe) return
 * text and the caller stamps the 10-minute slice start.
 */

export function transcriptionEnabled(): boolean {
  return Boolean(config.technician.transcription.url);
}

/** File extension per container, so the provider can sniff the codec. */
function filenameFor(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase();
  switch (base) {
    case 'audio/webm':
      return 'audio.webm';
    case 'audio/ogg':
      return 'audio.ogg';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'audio.m4a';
    case 'audio/mpeg':
      return 'audio.mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'audio.wav';
    default:
      return 'audio.webm';
  }
}

export type TranscriptSegmentIn = {
  start?: number | null;
  text?: string | null;
};

export function stampClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** True when the body already starts with a [m:ss] stamp we should not wrap again. */
export function transcriptAlreadyStamped(text: string): boolean {
  return /^\s*\[(?:\d+:)+\d+\]/.test(text);
}

export function formatVerboseTranscript(
  body: { text?: string | null; segments?: TranscriptSegmentIn[] | null },
  timeOffsetSeconds = 0,
): string {
  const offset = Number.isFinite(timeOffsetSeconds) ? Math.max(0, timeOffsetSeconds) : 0;
  const segments = Array.isArray(body.segments) ? body.segments : [];
  const stamped = segments
    .map((seg) => {
      const text = String(seg?.text || '').trim();
      if (!text) return '';
      const start = Number(seg?.start);
      const at = offset + (Number.isFinite(start) && start >= 0 ? start : 0);
      return `[${stampClock(at)}] ${text}`;
    })
    .filter(Boolean);
  if (stamped.length) return stamped.join('\n');
  return String(body.text || '').trim();
}

function wantsVerboseJson(model: string): boolean {
  return /whisper/i.test(model);
}

async function postTranscription(
  url: string,
  apiKey: string,
  form: FormData,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    body: form,
  });
}

export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  opts?: { timeOffsetSeconds?: number },
): Promise<string> {
  const { url, apiKey, model } = config.technician.transcription;
  if (!url) {
    throw new HttpError(
      501,
      'Speech-to-text is not configured on this server. Dictation still works in Chrome and Edge.',
      'transcription_unavailable',
    );
  }

  const file = new Blob([new Uint8Array(audio)], { type: mimeType });
  const buildForm = (verbose: boolean) => {
    const form = new FormData();
    form.append('file', file, filenameFor(mimeType));
    form.append('model', model);
    if (verbose) {
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
    }
    return form;
  };

  const tryVerbose = wantsVerboseJson(model);
  let res: Response;
  try {
    res = await postTranscription(url, apiKey, buildForm(tryVerbose));
    if (tryVerbose && (res.status === 400 || res.status === 422)) {
      res = await postTranscription(url, apiKey, buildForm(false));
    }
  } catch {
    throw new HttpError(502, 'Could not reach the transcription service.', 'transcription_failed');
  }

  if (!res.ok) {
    // Never surface the provider's body — it can echo the API key back.
    throw new HttpError(
      502,
      `The transcription service rejected the clip (${res.status}).`,
      'transcription_failed',
    );
  }

  const body = (await res.json()) as { text?: string; segments?: TranscriptSegmentIn[] };
  const text = formatVerboseTranscript(body, opts?.timeOffsetSeconds ?? 0);
  if (!text) {
    throw new HttpError(422, "That clip came back empty — I couldn't make out any speech.", 'transcription_empty');
  }
  return text;
}
