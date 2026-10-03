/**
 * Provider-reported usage → MeasuredUsage.
 *
 * The counts we bill on come only from the provider's own response. Anthropic
 * is parsed in lib/anthropic.ts (`extractUsage`); this module covers Gemini
 * and the helpers that combine several calls into one ledger row.
 *
 * Gemini `usageMetadata` semantics (https://ai.google.dev/api/generate-content#UsageMetadata):
 *  - `promptTokenCount` INCLUDES `cachedContentTokenCount`. Uncached input is
 *    therefore prompt − cached; adding both would double-count.
 *  - `candidatesTokenCount` EXCLUDES `thoughtsTokenCount`. Thinking tokens are
 *    billed at the output rate ("Output price (including thinking tokens)"),
 *    so output = candidates + thoughts.
 *  - `toolUsePromptTokenCount` (tool results fed back to the model) is billed
 *    as input.
 *  - `promptTokensDetails` splits the prompt by modality (AUDIO is priced
 *    higher on the 2.5 Flash family).
 */

import { rawUsageObject, type MeasuredUsage, type ProviderUsageCall } from './anthropic.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function n(value: unknown): number {
  const v = Number(value ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  cacheTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  [key: string]: unknown;
}

/** One Gemini call. Null when the response carried no usageMetadata. */
export function geminiUsageCall(meta: unknown, model: string | null): ProviderUsageCall | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as GeminiUsageMetadata;
  const prompt = n(m.promptTokenCount);
  const cached = Math.min(n(m.cachedContentTokenCount), prompt);
  const toolPrompt = n(m.toolUsePromptTokenCount);
  const output = n(m.candidatesTokenCount) + n(m.thoughtsTokenCount);
  const audioPrompt = (m.promptTokensDetails ?? [])
    .filter((d) => String(d?.modality ?? '').toUpperCase() === 'AUDIO')
    .reduce((sum, d) => sum + n(d?.tokenCount), 0);
  const audioCached = (m.cacheTokensDetails ?? [])
    .filter((d) => String(d?.modality ?? '').toUpperCase() === 'AUDIO')
    .reduce((sum, d) => sum + n(d?.tokenCount), 0);
  const inputTokens = prompt - cached + toolPrompt;
  return {
    provider: 'google',
    model,
    inputTokens,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    ...(audioPrompt > 0 ? { audioInputTokens: Math.max(0, Math.min(inputTokens, audioPrompt - audioCached)) } : {}),
    promptTokens: prompt + toolPrompt,
    raw: rawUsageObject(meta),
  };
}

export function measuredUsageFromCalls(calls: ProviderUsageCall[]): MeasuredUsage | null {
  if (!calls.length) return null;
  const sum = (k: keyof ProviderUsageCall) => calls.reduce((acc, c) => acc + (Number(c[k]) || 0), 0);
  const inputTokens = sum('inputTokens');
  const outputTokens = sum('outputTokens');
  const cacheReadTokens = sum('cacheReadTokens');
  const cacheWrite5mTokens = sum('cacheWrite5mTokens');
  const cacheWrite1hTokens = sum('cacheWrite1hTokens');
  const providers = new Set(calls.map((c) => c.provider));
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWrite5mTokens + cacheWrite1hTokens,
    ...(providers.size === 1 ? { provider: calls[0]!.provider } : {}),
    calls,
  };
}

/** Gemini usageMetadata → MeasuredUsage (all zeros when absent, like tryExtractUsage). */
export function geminiMeasuredUsage(meta: unknown, model: string | null): MeasuredUsage {
  const call = geminiUsageCall(meta, model);
  return (
    (call && measuredUsageFromCalls([call])) ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      totalTokens: 0,
      provider: 'google',
      calls: [],
    }
  );
}

/**
 * Sum several MeasuredUsage values (a multi-call Ask turn), keeping every
 * provider call so each is priced at its own model's rate. Parts without a
 * call list are carried as a synthetic call with `raw: {}` and the event's
 * model, which is how legacy callers were priced.
 */
export function mergeMeasuredUsages(parts: Array<MeasuredUsage | null | undefined>, fallbackModel: string | null = null): MeasuredUsage | null {
  const calls: ProviderUsageCall[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.calls?.length) {
      calls.push(...part.calls);
      continue;
    }
    if ((part.totalTokens || 0) <= 0) continue;
    calls.push({
      provider: part.provider ?? (/^gemini/i.test(fallbackModel ?? '') ? 'google' : 'anthropic'),
      model: fallbackModel,
      inputTokens: part.inputTokens || 0,
      outputTokens: part.outputTokens || 0,
      cacheReadTokens: part.cacheReadTokens || 0,
      cacheWrite5mTokens: part.cacheWrite5mTokens || 0,
      cacheWrite1hTokens: part.cacheWrite1hTokens || 0,
      raw: {},
    });
  }
  const merged = measuredUsageFromCalls(calls);
  return merged && merged.totalTokens > 0 ? merged : null;
}

/** OpenAI transcription `usage` ({type:'duration', seconds} or token usage). */
export function openAiTranscriptionUsage(usage: any): { seconds: number | null; raw: Record<string, unknown> } {
  const raw = rawUsageObject(usage);
  const seconds = usage && typeof usage === 'object' && usage.type === 'duration' ? Number(usage.seconds) : null;
  return { seconds: Number.isFinite(seconds) && (seconds as number) > 0 ? (seconds as number) : null, raw };
}
