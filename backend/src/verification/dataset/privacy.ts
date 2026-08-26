/**
 * Privacy scan — vertical-slice implementation.
 *
 * Detects obvious PII patterns in stored observation text / visible_text.
 * Production should add face/plate/document detectors in a media worker.
 * Original media is never destroyed here.
 */

import { randomUUID } from 'node:crypto';
import type { PipelineContext } from '../pipeline/orchestrator.js';
import type { PrivacyStatus } from './eligibility.js';

const TEXT_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { type: 'phone', re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { type: 'ssn_like', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { type: 'address_hint', re: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive)\b/ },
];

export function scanTextForPrivacy(texts: string[]): Array<{ type: string; snippet: string }> {
  const findings: Array<{ type: string; snippet: string }> = [];
  for (const text of texts) {
    for (const pattern of TEXT_PATTERNS) {
      const m = text.match(pattern.re);
      if (m) findings.push({ type: pattern.type, snippet: m[0]!.slice(0, 64) });
    }
  }
  return findings;
}

export function privacyStatusFromFindings(count: number): PrivacyStatus {
  if (count === 0) return 'export_safe';
  return 'review_required';
}

export function createPrivacyScanHandler(): (
  ctx: PipelineContext,
) => Promise<{ output: Record<string, unknown> }> {
  return async (ctx) => {
    const { data: observations } = await ctx.supabase
      .from('frame_observations')
      .select('id, frame_id, visible_text, parsed')
      .eq('video_id', ctx.videoId);

    const { data: speechRows } = await ctx.supabase
      .from('audio_transcript_segments')
      .select('text')
      .eq('video_id', ctx.videoId);

    const texts: string[] = [];
    for (const spoken of speechRows ?? []) {
      if (typeof spoken.text === 'string') texts.push(spoken.text);
    }
    for (const obs of observations ?? []) {
      if (Array.isArray(obs.visible_text)) texts.push(...obs.visible_text);
      if (obs.parsed?.visible_text) texts.push(...(obs.parsed.visible_text as string[]));
      if (typeof obs.parsed?.room_type === 'string') texts.push(obs.parsed.room_type);
    }

    const detected = scanTextForPrivacy(texts);
    for (const finding of detected) {
      await ctx.supabase.from('privacy_findings').insert({
        id: randomUUID(),
        org_id: ctx.orgId,
        video_id: ctx.videoId,
        finding_type: finding.type,
        confidence: 0.7,
        detection_model: 'text_pattern_v1',
        region: { snippet: finding.snippet },
        action_taken: 'flagged',
        review_status: 'open',
      });
    }

    const status = privacyStatusFromFindings(detected.length);
    await ctx.supabase
      .from('verification_videos')
      .update({ privacy_status: status })
      .eq('id', ctx.videoId);

    await ctx.supabase
      .from('verification_results')
      .update({ privacy_status: status })
      .eq('video_id', ctx.videoId)
      .eq('org_id', ctx.orgId);

    return { output: { findings: detected.length, privacyStatus: status } };
  };
}
