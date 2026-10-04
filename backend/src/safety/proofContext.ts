/**
 * Context for confirming a transcript candidate on a filed proof: the clip's
 * media-window tagging (vision narration saying a TV / monitor / phone was
 * playing) and stills near the flagged moment.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readMediaAudio, soundsLikeBroadcast } from '../audio/audioSource.js';
import type { SafetyMediaContext } from './confirm.js';

const PROOF_BUCKET = 'job-proofs';

export async function proofMediaContext(
  admin: any,
  proofId: string,
  transcriptText: string,
): Promise<SafetyMediaContext> {
  try {
    const { data } = await admin
      .from('job_proofs')
      .select('narration_text, ai_findings, actions, narration')
      .eq('id', proofId)
      .maybeSingle();
    const findings = (data?.ai_findings ?? {}) as Record<string, any>;
    const narration =
      (typeof data?.narration_text === 'string' && data.narration_text.trim()) ||
      (typeof findings.narrative === 'string' ? findings.narrative : '') ||
      '';
    const events = [
      ...(Array.isArray(data?.actions) ? data.actions : Array.isArray(findings.actions) ? findings.actions : []),
      ...(Array.isArray(findings.timeline) ? findings.timeline : []),
      ...(Array.isArray(data?.narration?.entries) ? data.narration.entries : []),
    ];
    const reading = readMediaAudio({ narration, events, hasSpeech: Boolean(transcriptText.trim()) });
    return {
      mediaWindows: reading.mediaWindows,
      mediaUntimed: reading.mediaUntimed,
      broadcastPhrasing: soundsLikeBroadcast(transcriptText),
    };
  } catch {
    return { broadcastPhrasing: soundsLikeBroadcast(transcriptText) };
  }
}

/** Up to `max` stored stills closest to `atSeconds` (all stills when null), as base64. */
export async function loadProofFramesNear(
  admin: any,
  proofId: string,
  atSeconds: number | null,
  max = 6,
): Promise<Array<{ atSeconds: number; base64: string }>> {
  try {
    const { data } = await admin
      .from('job_proof_frames')
      .select('at_seconds, storage_path')
      .eq('proof_id', proofId)
      .limit(400);
    const rows = ((data ?? []) as any[])
      .map((r) => ({ at: Number(r.at_seconds), path: String(r.storage_path ?? '') }))
      .filter((r) => Number.isFinite(r.at) && r.path);
    if (!rows.length) return [];
    const target = atSeconds ?? 0;
    const picked = rows
      .sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))
      .slice(0, max)
      .sort((a, b) => a.at - b.at);
    const out: Array<{ atSeconds: number; base64: string }> = [];
    for (const row of picked) {
      const { data: blob, error } = await admin.storage.from(PROOF_BUCKET).download(row.path);
      if (error || !blob) continue;
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (bytes.length < 200 || bytes.length > 1_500_000) continue;
      out.push({ atSeconds: row.at, base64: bytes.toString('base64') });
    }
    return out;
  } catch {
    return [];
  }
}
