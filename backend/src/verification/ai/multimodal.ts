/**
 * Multimodal (text + images) completion for video analysis.
 *
 * Dispatches to Gemini, Anthropic Messages, or OpenAI-compatible chat
 * completions (OpenAI + xAI/Grok) so the cost-aware router can swap arms
 * without each analyzer owning HTTP.
 */

import { estimateCostUsd as catalogEstimateCostUsd } from '../../ai/catalog.js';
import type { ProviderId } from '../../ai/providers/types.js';
import {
  type VideoProviderId,
  type VideoRouteChoice,
  videoProviderApiKey,
  videoProviderBaseUrl,
} from './router.js';

export interface VisionImagePart {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface MultimodalResult {
  text: string;
  provider: VideoProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  providerRequestId: string | null;
  estimatedCostUsd: number;
}

export async function completeMultimodal(opts: {
  route: VideoRouteChoice;
  system: string;
  userText: string;
  images: VisionImagePart[];
  json?: boolean;
  maxOutputTokens?: number;
  fetchFn?: typeof fetch;
}): Promise<MultimodalResult> {
  const apiKey = videoProviderApiKey(opts.route.provider);
  if (!apiKey) {
    throw new Error(`${opts.route.provider.toUpperCase()} API key is not configured`);
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const started = Date.now();

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let requestId: string | null = null;

  if (opts.route.provider === 'google') {
    const result = await callGemini({
      apiKey,
      baseUrl: videoProviderBaseUrl('google'),
      model: opts.route.model,
      system: opts.system,
      userText: opts.userText,
      images: opts.images,
      json: opts.json ?? true,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      fetchFn,
    });
    text = result.text;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    requestId = result.requestId;
  } else if (opts.route.provider === 'anthropic') {
    const result = await callAnthropic({
      apiKey,
      baseUrl: videoProviderBaseUrl('anthropic'),
      model: opts.route.model,
      system: opts.system,
      userText: opts.userText,
      images: opts.images,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      fetchFn,
    });
    text = result.text;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    requestId = result.requestId;
  } else {
    // OpenAI + xAI share the chat/completions dialect with image_url parts.
    const result = await callOpenAiCompatible({
      provider: opts.route.provider,
      apiKey,
      baseUrl: videoProviderBaseUrl(opts.route.provider),
      model: opts.route.model,
      system: opts.system,
      userText: opts.userText,
      images: opts.images,
      json: opts.json ?? true,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      fetchFn,
    });
    text = result.text;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
    requestId = result.requestId;
  }

  return {
    text,
    provider: opts.route.provider,
    model: opts.route.model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
    providerRequestId: requestId,
    estimatedCostUsd: catalogEstimateCostUsd(
      opts.route.provider as ProviderId,
      opts.route.model,
      inputTokens,
      outputTokens,
    ),
  };
}

/** Text-only multimodal (no images) — used by the LLM work-event verifier. */
export async function completeTextRoute(opts: {
  route: VideoRouteChoice;
  system: string;
  userText: string;
  json?: boolean;
  maxOutputTokens?: number;
  fetchFn?: typeof fetch;
}): Promise<MultimodalResult> {
  return completeMultimodal({ ...opts, images: [] });
}

async function callGemini(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  userText: string;
  images: VisionImagePart[];
  json: boolean;
  maxOutputTokens: number;
  fetchFn: typeof fetch;
}): Promise<{ text: string; inputTokens: number; outputTokens: number; requestId: string | null }> {
  const url = `${opts.baseUrl}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: opts.userText },
          ...opts.images.map((img) => ({
            inline_data: { mime_type: img.mimeType, data: img.base64 },
          })),
        ],
      },
    ],
    generationConfig: {
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      temperature: 0,
      maxOutputTokens: opts.maxOutputTokens,
    },
  };
  const response = await opts.fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini vision error ${response.status}: ${errText.slice(0, 400)}`);
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    responseId?: string;
  };
  return {
    text: (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
    inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    requestId: payload.responseId ?? null,
  };
}

async function callAnthropic(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  userText: string;
  images: VisionImagePart[];
  maxOutputTokens: number;
  fetchFn: typeof fetch;
}): Promise<{ text: string; inputTokens: number; outputTokens: number; requestId: string | null }> {
  const response = await opts.fetchFn(`${opts.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxOutputTokens,
      temperature: 0,
      system: opts.system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.userText },
            ...opts.images.map((img) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mimeType,
                data: img.base64,
              },
            })),
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Anthropic vision failed: ${response.status}${errText ? ` ${errText.slice(0, 200)}` : ''}`,
    );
  }
  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    id?: string;
  };
  return {
    text: (payload.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(''),
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    requestId: payload.id ?? null,
  };
}

async function callOpenAiCompatible(opts: {
  provider: 'openai' | 'xai';
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  userText: string;
  images: VisionImagePart[];
  json: boolean;
  maxOutputTokens: number;
  fetchFn: typeof fetch;
}): Promise<{ text: string; inputTokens: number; outputTokens: number; requestId: string | null }> {
  const userContent: Array<Record<string, unknown>> = [{ type: 'text', text: opts.userText }];
  for (const img of opts.images) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    });
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    temperature: 0,
    max_completion_tokens: opts.maxOutputTokens,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: userContent },
    ],
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const response = await opts.fetchFn(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `${opts.provider} vision failed: ${response.status}${errText ? ` ${errText.slice(0, 200)}` : ''}`,
    );
  }
  const payload = (await response.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = payload.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error(`${opts.provider} returned an empty completion`);
  return {
    text,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
    requestId: payload.id ?? null,
  };
}
