/**
 * Persist structured conversation analysis onto a proof's ai_findings.
 *
 * Transcript completion is the primary hook: Whisper text lands, then this
 * pass writes `ai_findings.conversation` without wiping vision findings.
 * Narration may finish first — merging keeps both.
 */

import {
  analyzeConversation,
  hasConversation,
  toStoredConversation,
  type ConversationDetails,
  type StoredConversation,
} from './conversationDetails.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function enrichProofConversation(
  admin: any,
  proofId: string,
  opts?: { transcript?: string | null; durationSeconds?: number | null },
): Promise<ConversationDetails | null> {
  let transcript = opts?.transcript;
  let durationSeconds = opts?.durationSeconds ?? null;

  if (transcript == null || durationSeconds == null) {
    const { data: proof } = await admin
      .from('job_proofs')
      .select('transcript_text, duration_seconds, ai_findings')
      .eq('id', proofId)
      .maybeSingle();
    if (transcript == null) transcript = (proof as any)?.transcript_text ?? null;
    if (durationSeconds == null) {
      const n = Number((proof as any)?.duration_seconds);
      durationSeconds = Number.isFinite(n) && n > 0 ? n : null;
    }
  }

  const details = await analyzeConversation(transcript, { durationSeconds });
  if (!hasConversation(details)) {
    // Clear stale fake talk on silent / noise-only re-runs.
    await mergeConversationFindings(admin, proofId, null);
    return null;
  }

  await mergeConversationFindings(admin, proofId, toStoredConversation(details));
  return details;
}

async function mergeConversationFindings(
  admin: any,
  proofId: string,
  conversation: StoredConversation | null,
): Promise<void> {
  const { data: proof } = await admin
    .from('job_proofs')
    .select('ai_findings')
    .eq('id', proofId)
    .maybeSingle();
  const prev =
    proof?.ai_findings && typeof proof.ai_findings === 'object' && !Array.isArray(proof.ai_findings)
      ? ({ ...(proof.ai_findings as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  if (conversation) prev.conversation = conversation;
  else delete prev.conversation;
  await admin.from('job_proofs').update({ ai_findings: prev }).eq('id', proofId);
}

/** Attach conversation onto a findings object about to be written (sync derive). */
export function findingsWithConversation(
  findings: Record<string, unknown>,
  transcript: string | null | undefined,
  conversation?: ConversationDetails | null,
): Record<string, unknown> {
  if (conversation && hasConversation(conversation)) {
    return { ...findings, conversation: toStoredConversation(conversation) };
  }
  const text = String(transcript || '').trim();
  if (!text) return findings;
  // Sync deterministic only — callers that want LLM should await enrichProofConversation.
  return findings;
}
