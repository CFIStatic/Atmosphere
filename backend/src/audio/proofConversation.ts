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
import { fuseVisionTranscriptEvidence } from './evidenceFusion.js';
import {
  extractPeoplePresent,
  hasPeople,
  parsePeopleModelJson,
  toStoredPeople,
  type OrgMemberHint,
  type StoredPeoplePresent,
} from './peoplePresent.js';
import {
  classifySceneKind,
  identifySpeakers,
  webIdentifyPublicSpeakers,
} from './speakerIdentity.js';

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

  let logEntries = buildEvidenceLog({
    storedEntries: narration.entries,
    narrationText: proof?.narration_text ?? null,
    summary: proof?.ai_summary ?? findings.summary ?? null,
    actions,
    durationSeconds,
    transcript,
    conversation: hasConversation(details) ? details : null,
    people: findings.people,
    visionPeople: findings.visionPeople,
  });
  // Dense multi-pass: fuse vision + transcript into additional timed beats
  // (context/why, speech grounded in visible work) without inventing.
  logEntries = await fuseVisionTranscriptEvidence({
    entries: logEntries,
    narrationText: proof?.narration_text ?? null,
    summary: proof?.ai_summary ?? findings.summary ?? null,
    transcript,
    conversation: hasConversation(details) ? details : null,
    durationSeconds,
  });

  const visionPeople =
    Array.isArray(findings.visionPeople)
      ? findings.visionPeople
      : Array.isArray(findings.people) && !((findings.people as { people?: unknown }).people)
        ? findings.people
        : Array.isArray((findings.people as { people?: unknown } | undefined)?.people)
          ? (findings.people as { people: unknown[] }).people
          : [];
  const fromModel = parsePeopleModelJson(
    { people: visionPeople },
    extractPeoplePresent({
      narrationText: proof?.narration_text ?? null,
      summary: proof?.ai_summary ?? findings.summary ?? null,
      transcript,
      conversation: hasConversation(details) ? details : null,
      actions,
    }),
  );
  const basePeople =
    fromModel && hasPeople(fromModel)
      ? fromModel
      : extractPeoplePresent({
          narrationText: proof?.narration_text ?? null,
          summary: proof?.ai_summary ?? findings.summary ?? null,
          transcript,
          conversation: hasConversation(details) ? details : null,
          visionPeople,
          actions,
        });

  const narrationText = proof?.narration_text ?? null;
  const summary = proof?.ai_summary ?? findings.summary ?? null;
  const orgMembers = await loadOrgMembersForProof(admin, proofId);
  const visibleFromVision = (Array.isArray(visionPeople) ? visionPeople : [])
    .map((p: unknown) => {
      if (!p || typeof p !== 'object') return '';
      const row = p as { matchedName?: unknown; appearance?: unknown; label?: unknown };
      return [row.matchedName, row.appearance, row.label].filter(Boolean).join(' ');
    })
    .filter(Boolean) as string[];

  const sceneKind = classifySceneKind({ narrationText, summary });
  const people = await identifySpeakers({
    people: basePeople,
    narrationText,
    summary,
    orgMembers,
    visibleTextHints: visibleFromVision,
    allowWebIdentify: sceneKind === 'public_media' ? true : sceneKind === 'private_job' ? false : null,
    webIdentify:
      sceneKind === 'public_media'
        ? async ({ hints, people: ppl }) =>
            webIdentifyPublicSpeakers({
              hints,
              speakerLabels: ppl.speakers.map((s) => s.speakerLabel),
              narrationText,
              summary,
            })
        : undefined,
  });

  await mergeFindings(admin, proofId, {
    conversation: hasConversation(details) ? toStoredConversation(details) : null,
    evidenceLog: logEntries.length ? toStoredEvidenceLog(logEntries) : null,
    people: hasPeople(people) ? toStoredPeople(people) : null,
  });

  return hasConversation(details) ? details : null;
}


async function loadOrgMembersForProof(admin: any, proofId: string): Promise<OrgMemberHint[]> {
  try {
    const { data: proof } = await admin
      .from('job_proofs')
      .select('org_id')
      .eq('id', proofId)
      .maybeSingle();
    const orgId = proof?.org_id;
    if (!orgId) return [];
    const { data: rows } = await admin
      .from('org_members')
      .select('user_id, profiles(full_name, email)')
      .eq('org_id', orgId)
      .limit(200);
    const out: OrgMemberHint[] = [];
    for (const row of rows ?? []) {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const fullName = String(profile?.full_name || '').trim();
      if (!fullName || !row.user_id) continue;
      out.push({
        userId: String(row.user_id),
        fullName,
        email: profile?.email ?? null,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      '[speaker-identity] org roster load failed:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function mergeFindings(
  admin: any,
  proofId: string,
  patch: {
    conversation: StoredConversation | null;
    evidenceLog: StoredEvidenceLog | null;
    people: StoredPeoplePresent | null;
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
  if (patch.people) prev.people = patch.people;
  else delete prev.people;
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
