import { config } from '../config.js';
import { HttpError } from './errors.js';
import type { TranscriptSegment } from '../audio/transcriptFormat.js';

export type { TranscriptSegment };

export type TranscriptResult = {
  text: string;
  segments: TranscriptSegment[];
};

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

/** Pull text + optional Whisper segment clocks out of a provider JSON body. */
export function transcriptFromProviderBody(body: unknown): TranscriptResult {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const text = typeof rec.text === 'string' ? rec.text.trim() : '';
  const raw = Array.isArray(rec.segments) ? rec.segments : [];
  const segments: TranscriptSegment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const seg = row as Record<string, unknown>;
    const spoken = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!spoken) continue;
    const start = Number(seg.start);
    const end = Number(seg.end);
    segments.push({
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : undefined,
      text: spoken,
    });
  }
  return {
    text: text || segments.map((seg) => seg.text).join(' ').trim(),
    segments,
  };
}

function transcriptionForm(audio: Buffer, mimeType: string, model: string, verbose: boolean): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filenameFor(mimeType));
  form.append('model', model);
  if (verbose) form.append('response_format', 'verbose_json');
  return form;
}

async function postTranscription(url: string, apiKey: string, form: FormData): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    body: form,
  });
}

export async function transcribeAudioDetailed(audio: Buffer, mimeType: string): Promise<TranscriptResult> {
  const { url, apiKey, model } = config.technician.transcription;
  if (!url) {
    throw new HttpError(
      501,
      'Speech-to-text is not configured on this server. Dictation still works in Chrome and Edge.',
      'transcription_unavailable',
    );
  }

  let res: Response;
  try {
    res = await postTranscription(url, apiKey, transcriptionForm(audio, mimeType, model, true));
    if (!res.ok && (res.status === 400 || res.status === 415 || res.status === 422)) {
      res = await postTranscription(url, apiKey, transcriptionForm(audio, mimeType, model, false));
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

  let parsed: TranscriptResult = { text: '', segments: [] };
  try {
    parsed = transcriptFromProviderBody(await res.json());
  } catch {
    parsed = { text: '', segments: [] };
  }
  if (!parsed.text) {
    throw new HttpError(422, "That clip came back empty — I couldn't make out any speech.", 'transcription_empty');
  }
  return parsed;
}

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  return (await transcribeAudioDetailed(audio, mimeType)).text;
}
