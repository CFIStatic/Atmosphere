/**
 * Resolve the Whisper-compatible /audio/transcriptions endpoint.
 *
 * Railway often sets TRANSCRIPTION_MODEL (e.g. gpt-4o-transcribe) without
 * TRANSCRIPTION_URL / TRANSCRIPTION_API_KEY. When those are missing, reuse
 * OPENAI_API_KEY and the OpenAI transcriptions URL so queueProofTranscript
 * can populate transcript_text (and closed captions).
 *
 * A self-hosted whisper.cpp server still works: set TRANSCRIPTION_URL and
 * leave the key blank.
 */

export type TranscriptionConfig = {
  url: string;
  apiKey: string;
  model: string;
};

const DEFAULT_OPENAI_TRANSCRIPTIONS = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function openaiTranscriptionsUrl(baseUrl: string): string {
  const base = trim(baseUrl) || 'https://api.openai.com/v1';
  const cleaned = base.replace(/\/+$/, '');
  if (/\/audio\/transcriptions$/i.test(cleaned)) return cleaned;
  return `${cleaned}/audio/transcriptions`;
}

export function resolveTranscriptionConfig(
  env: Record<string, string | undefined> = process.env,
): TranscriptionConfig {
  const apiKey = trim(env.TRANSCRIPTION_API_KEY) || trim(env.OPENAI_API_KEY);
  const explicitUrl = trim(env.TRANSCRIPTION_URL);
  const url =
    explicitUrl ||
    (apiKey ? openaiTranscriptionsUrl(env.OPENAI_BASE_URL || DEFAULT_OPENAI_TRANSCRIPTIONS.replace(/\/audio\/transcriptions$/i, '')) : '');
  const model = trim(env.TRANSCRIPTION_MODEL) || DEFAULT_MODEL;
  return { url, apiKey, model };
}

export function transcriptionConfigured(cfg: TranscriptionConfig = resolveTranscriptionConfig()): boolean {
  return Boolean(cfg.url);
}

export const OPENAI_TRANSCRIPTIONS_URL = DEFAULT_OPENAI_TRANSCRIPTIONS;
