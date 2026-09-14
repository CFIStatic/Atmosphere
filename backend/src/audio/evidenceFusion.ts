/**
 * Second-pass fusion of vision dictation + mic transcript into denser
 * timed evidence beats for Analysis.
 *
 * Vision already produced scene/work/camera rows; speech already produced
 * SAID rows. This pass asks the Analysis model to add ONLY the cross-linked
 * beats that a single modality misses: speech grounded in visible action,
 * context/why when both support it, objects tied to decisions, next steps
 * with a seek time. Never invent dialogue, people, objects, or motives.
 */

import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { logger } from '../lib/logger.js';
import {
  dedupeEvidenceLog,
  type EvidenceLogEntry,
} from './evidenceLog.js';
import type { ConversationDetails } from './conversationDetails.js';

export const EVIDENCE_FUSION_MAX_TOKENS = 8_192;
export const EVIDENCE_FUSION_MAX_NEW = 80;

const FUSION_SYSTEM = `You fuse vision dictation and a mic transcript into denser timed evidence for a claims / restoration office.

ACCURACY OVER COMPLETENESS. Never invent speech, speakers, people, objects, rooms, decisions, amounts, or motives. If vision and transcript disagree or are unclear, say so (prefix "Uncertain:") or omit the beat. Prefer omitting a guess over inventing detail.

Return JSON only:
{"entries":[{"atSeconds":number,"text":"...","type":"work"|"scene"|"activity"|"decision"|"said"|"other","quote":null|"verbatim transcript span","confidence":0.0}]}

Rules:
- Add ONLY beats that combine vision + speech (or fill an obvious gap) — do not restate every SAID or SCENE row already listed.
- atSeconds must be a seek time supported by a transcript stamp and/or a vision row nearby. Never invent a time.
- quote, when set, MUST be an exact verbatim substring of the transcript.
- Surface context/why, object interactions tied to talk, decisions/next steps, and people doing visible work — densely but only when evidenced.
- confidence ≤0.4 when uncertain. Empty entries array when nothing new is grounded.`;

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function parseFusionEntries(text: string): EvidenceLogEntry[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { entries?: unknown };
    if (!Array.isArray(data.entries)) return [];
    const out: EvidenceLogEntry[] = [];
    for (const raw of data.entries) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const body = String(row.text ?? '').replace(/\s+/g, ' ').trim();
      if (!body) continue;
      const at = Number(row.atSeconds);
      out.push({
        atSeconds: Number.isFinite(at) ? roundTime(at) : 0,
        text: body.slice(0, 500),
        type: String(row.type || 'other').toLowerCase(),
        quote: row.quote != null ? String(row.quote).slice(0, 500) : null,
        confidence:
          row.confidence != null && Number.isFinite(Number(row.confidence))
            ? Number(row.confidence)
            : null,
        kind: 'fusion',
      });
      if (out.length >= EVIDENCE_FUSION_MAX_NEW) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge a denser vision↔transcript fusion into an existing evidence log.
 * No-ops (returns input) when providers are missing or either modality is empty.
 */
export async function fuseVisionTranscriptEvidence(input: {
  entries: EvidenceLogEntry[];
  narrationText?: string | null;
  summary?: string | null;
  transcript?: string | null;
  conversation?: ConversationDetails | null;
  durationSeconds?: number | null;
}): Promise<EvidenceLogEntry[]> {
  const narration = String(input.narrationText || '').trim();
  const transcript = String(input.transcript || '').trim();
  if (!narration || !transcript) return input.entries;
  if (!isAskModelConfigured()) return input.entries;

  const existingSketch = input.entries
    .slice(0, 60)
    .map((e) => `[${e.atSeconds}s/${e.type}] ${e.text}`)
    .join('\n')
    .slice(0, 6_000);
  const conversationSketch = input.conversation
    ? JSON.stringify(
        {
          summary: input.conversation.executiveSummary || input.conversation.summary,
          commitments: input.conversation.commitments.slice(0, 6),
          refusals: input.conversation.refusals.slice(0, 4),
          actionItems: input.conversation.actionItems.slice(0, 6),
          moneyTalk: input.conversation.moneyTalk.slice(0, 4),
        },
        null,
        0,
      ).slice(0, 4_000)
    : '';

  try {
    const completed = await completeAskText({
      system: FUSION_SYSTEM,
      user: [
        input.durationSeconds != null && Number.isFinite(Number(input.durationSeconds))
          ? `Clip length: ${Math.round(Number(input.durationSeconds))} seconds.`
          : null,
        `Vision dictation / summary:\n${(input.summary ? `${input.summary}\n\n` : '') + narration}`.slice(
          0,
          8_000,
        ),
        `Mic transcript (verbatim ground truth for speech):\n${transcript.slice(0, 10_000)}`,
        existingSketch ? `Existing evidence rows (do not duplicate):\n${existingSketch}` : null,
        conversationSketch ? `Conversation brief sketch:\n${conversationSketch}` : null,
        'Return JSON only with NEW fused entries.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      maxTokens: EVIDENCE_FUSION_MAX_TOKENS,
      mode: 'analysis',
    });
    if (!completed?.text) return input.entries;
    const fused = parseFusionEntries(completed.text);
    if (!fused.length) return input.entries;
    return dedupeEvidenceLog([...input.entries, ...fused]);
  } catch (err) {
    logger.warn('evidence_fusion_failed', {
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return input.entries;
  }
}
