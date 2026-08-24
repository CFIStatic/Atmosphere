/**
 * One vision call against whichever model key the server actually has.
 *
 * Official clip analysis and live watch both used to hard-require
 * ANTHROPIC_API_KEY. Production already syncs GOOGLE_API_KEY / GEMINI_API_KEY
 * for the verification pipeline, so a missing Anthropic key left the Verifier
 * sitting on "Writing…" forever. This helper tries Anthropic first, then Gemini.
 */
import { config } from '../config.js';
import { anthropicClient, isModelProviderConfigured } from '../lib/anthropic.js';

export type VisionImage = { base64: string };

export function isVisionConfigured(): boolean {
  return isModelProviderConfigured() || Boolean(googleVisionKey());
}

function googleVisionKey(): string {
  return (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

function geminiModel(): string {
  return (
    process.env.VERIFICATION_PRIMARY_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-2.5-flash'
  ).trim();
}

function geminiBaseUrl(): string {
  return (process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com').replace(
    /\/+$/,
    '',
  );
}

export async function describeVision(input: {
  system: string;
  userText: string;
  images: VisionImage[];
  maxTokens?: number;
}): Promise<{ text: string; model: string } | null> {
  const images = input.images.filter((img) => img.base64 && img.base64.length >= 80);
  if (!images.length) return null;

  if (isModelProviderConfigured()) {
    try {
      const response = await anthropicClient().messages.create({
        model:
          images.length === 1
            ? config.technician.assistant.liveModel
            : config.technician.assistant.model,
        max_tokens: input.maxTokens ?? (images.length === 1 ? 220 : 1200),
        system: input.system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text' as const, text: input.userText },
              ...images.map((img) => ({
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: img.base64,
                },
              })),
            ],
          },
        ],
      });
      const text = response.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('\n')
        .trim();
      if (text) return { text, model: response.model };
    } catch {
      /* fall through to Gemini when Anthropic flakes */
    }
  }

  const key = googleVisionKey();
  if (!key) return null;

  const model = geminiModel();
  const url = `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: input.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: input.userText },
            ...images.map((img) => ({
              inline_data: { mime_type: 'image/jpeg', data: img.base64 },
            })),
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: input.maxTokens ?? (images.length === 1 ? 220 : 1200),
      },
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (payload.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
  return text ? { text, model } : null;
}

export async function completeText(input: {
  system: string;
  userText: string;
  maxTokens?: number;
}): Promise<{ text: string; model: string } | null> {
  if (isModelProviderConfigured()) {
    try {
      const response = await anthropicClient().messages.create({
        model: config.technician.assistant.model,
        max_tokens: input.maxTokens ?? 500,
        system: input.system,
        messages: [{ role: 'user', content: input.userText }],
      });
      const text = response.content
        .filter((block: { type: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('\n')
        .trim();
      if (text) return { text, model: response.model };
    } catch {
      /* fall through */
    }
  }

  const key = googleVisionKey();
  if (!key) return null;
  const model = geminiModel();
  const url = `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.userText }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: input.maxTokens ?? 500 },
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (payload.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
  return text ? { text, model } : null;
}
