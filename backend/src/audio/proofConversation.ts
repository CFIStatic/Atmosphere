/**
 * Persist structured conversation analysis + complete evidence log onto a
 * proof's ai_findings. Transcript completion is the primary hook; narration
 * may finish first — merging keeps both. Vision dictation/summary is passed
 * as context so the LLM can ground roles and rooms.
 */

import {
  analyzeConversation,
  hasConversation,
  toStoredConversation,
  type ConversationDetails,
  type StoredConversation,
} from './conversationDetails.js';
import {
  buildEvidenceLog,
  toStoredEvidenceLog,
  type StoredEvidenceLog,
} from './evidenceLog.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function visionContextFromProof(proof: any): string | null {
  const findings = proof?.ai_findings && typeof proof.ai_findings === 'object' ? proof.ai_findings : {};
  const parts = [
    typeof proof?.narration_text === 'string' ? proof.narration_text.trim() : '',
    typeof proof?.ai_summary === 'string' ? proof.ai_summary.trim() : '',
    typeof findings.summary === 'string' ? String(findings.summary).trim() : '',
    typeof findings.narrative === 'string' ? String(findings.narrative).trim() : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return [...new Set(parts)].join('\n\n').slice(0, 4000);
}

export async function enrichProofConversation(
  admin: any,
  proofId: string,
  opts?: {
    transcript?: string | null;
    durationSeconds?: number | null;
    visionContext?: string | null;
  },
): Promise<ConversationDetails | null> {
  let transcript = opts?.transcript;
  let durationSeconds = opts?.durationSeconds ?? null;
  let visionContext = opts?.visionContext ?? null;
  let proof: any = null;

  {
    const { data } = await admin
      .from('job_proofs')
      .select('transcript_text, duration_seconds, ai_findings, ai_summary, narration_text, narration, actions')
      .eq('id', proofId)
      .maybeSingle();
    proof = data;
    if (transcript == null) transcript = proof?.transcript_text ?? null;
    if (durationSeconds == null) {
      const n = Number(proof?.duration_seconds);
      durationSeconds = Number.isFinite(n) && n > 0 ? n : null;
    }
    if (visionContext == null) visionContext = visionContextFromProof(proof);
  }

  const details = await analyzeConversation(transcript, {
    durationSeconds,
    visionContext,
  });

  const findings =
    proof?.ai_findings && typeof proof.ai_findings === 'object' && !Array.isArray(proof.ai_findings)
      ? proof.ai_findings
      : {};
  const actions = Array.isArray(proof?.actions)
    ? proof.actions
    : Array.isArray(findings.actions)
      ? findings.actions
      : [];
  const narration = proof?.narration && typeof proof.narration === 'object' ? proof.narration : {};

  const logEntries = buildEvidenceLog({
    storedEntries: narration.entries,
    narrationText: proof?.narration_text ?? null,
    summary: proof?.ai_summary ?? findings.summary ?? null,
    actions,
    durationSeconds,
    transcript,
    conversation: hasConversation(details) ? details : null,
  });

  await mergeFindings(admin, proofId, {
    conversation: hasConversation(details) ? toStoredConversation(details) : null,
    evidenceLog: logEntries.length ? toStoredEvidenceLog(logEntries) : null,
  });

  return hasConversation(details) ? details : null;
}

async function mergeFindings(
  admin: any,
  proofId: string,
  patch: {
    conversation: StoredConversation | null;
    evidenceLog: StoredEvidenceLog | null;
  },
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
  if (patch.conversation) prev.conversation = patch.conversation;
  else delete prev.conversation;
  if (patch.evidenceLog) prev.evidenceLog = patch.evidenceLog;
  else delete prev.evidenceLog;
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
  return findings;
}
