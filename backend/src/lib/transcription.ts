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

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  const { url, apiKey, model } = config.technician.transcription;
  if (!url) {
    throw new HttpError(
      501,
      'Speech-to-text is not configured on this server. Dictation still works in Chrome and Edge.',
      'transcription_unavailable',
    );
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filenameFor(mimeType));
  form.append('model', model);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      body: form,
    });
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

  const body = (await res.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    throw new HttpError(422, "That clip came back empty — I couldn't make out any speech.", 'transcription_empty');
  }
  return text;
}
