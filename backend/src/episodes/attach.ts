import { assessRows } from './resolve.js';
import { observationPhaseForProof } from './resolve.js';

/**
 * Making the shipped flow produce episodes.
 *
 * The subcontractor films before and after; that already works and nobody is
 * going to change their day for a data model. So the episode is assembled
 * around them: one per party per work day, created on the first upload and
 * joined by the second, with each proof attached as an observation.
 *
 * Nothing here can fail the upload. An episode is an enrichment of a record
 * that is already complete without it, and a crew standing in a doorway
 * getting an error because a secondary table rejected a row would be a
 * straightforwardly worse product. Every failure path returns null and leaves
 * the proof exactly as it was.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AttachInput {
  orgId: string;
  jobId: string;
  partyId: string;
  workDate: string;
  proofId: string;
  proofPhase: string;
  /** Shown on the episode when nothing better is known about who worked. */
  performerLabel?: string | null;
}

/**
 * Attach a proof to its day's episode, creating the episode if it is the first
 * upload of the day. Returns the episode id, or null if anything went wrong.
 */
export async function attachProofToEpisode(
  admin: any,
  input: AttachInput,
): Promise<string | null> {
  try {
    const { data: existing } = await admin
      .from('work_episodes')
      .select('id')
      .eq('job_id', input.jobId)
      .eq('party_id', input.partyId)
      .eq('work_date', input.workDate)
      .maybeSingle();

    let episodeId: string | null = existing?.id ?? null;

    if (!episodeId) {
      // Unclassified on purpose. A task key guessed from nothing would be a
      // fabricated label on every episode in the system, and the tier engine
      // already reports "unclassified" as the gap it is.
      const { data: created, error } = await admin
        .from('work_episodes')
        .insert({
          org_id: input.orgId,
          job_id: input.jobId,
          party_id: input.partyId,
          work_date: input.workDate,
          status: 'in_progress',
          performer_label: input.performerLabel ?? null,
        })
        .select('id')
        .single();
      if (error || !created) return null;
      episodeId = created.id as string;
    }

    // One observation per proof: re-uploading the same phase replaces the
    // media in place (the proof row is upserted upstream), so the observation
    // must not pile up either.
    const { data: priorObservation } = await admin
      .from('episode_observations')
      .select('id')
      .eq('episode_id', episodeId)
      .eq('proof_id', input.proofId)
      .maybeSingle();

    if (!priorObservation) {
      await admin.from('episode_observations').insert({
        episode_id: episodeId,
        org_id: input.orgId,
        phase: observationPhaseForProof(input.proofPhase),
        proof_id: input.proofId,
        evidence_kind: 'video',
      });
    }

    await rescoreEpisode(admin, episodeId);
    return episodeId;
  } catch {
    return null;
  }
}

/**
 * Recompute tier and confidence, and store them.
 *
 * Stored rather than derived on read for the same reason the verifier's
 * findings are: a decision taken on Tuesday was taken against Tuesday's
 * assessment, and a score that silently improves later would rewrite the
 * grounds somebody acted on.
 */
export async function rescoreEpisode(admin: any, episodeId: string): Promise<void> {
  try {
    const { data: episode } = await admin
      .from('work_episodes')
      .select('*')
      .eq('id', episodeId)
      .maybeSingle();
    if (!episode) return;

    const [location, observations, actions, resources, verifications, outcomes, economics] =
      await Promise.all([
        episode.location_id
          ? admin.from('job_locations').select('*').eq('id', episode.location_id).maybeSingle()
          : Promise.resolve({ data: null }),
        admin.from('episode_observations').select('*').eq('episode_id', episodeId),
        admin.from('episode_actions').select('*').eq('episode_id', episodeId),
        admin.from('episode_resources').select('*').eq('episode_id', episodeId),
        admin.from('episode_verifications').select('*').eq('episode_id', episodeId),
        admin.from('episode_outcomes').select('*').eq('episode_id', episodeId),
        admin.from('episode_economics').select('*').eq('episode_id', episodeId).maybeSingle(),
      ]);

    const proofIds = (observations.data ?? [])
      .map((o: any) => o.proof_id)
      .filter((v: string | null): v is string => Boolean(v));
    const proofs = new Map<string, any>();
    if (proofIds.length > 0) {
      const { data } = await admin
        .from('job_proofs')
        .select('id, checks, lat, lon')
        .in('id', proofIds);
      for (const proof of data ?? []) proofs.set(proof.id, proof);
    }

    const assessment = assessRows({
      episode,
      location: location.data,
      observations: observations.data ?? [],
      proofs,
      actions: actions.data ?? [],
      resources: resources.data ?? [],
      verifications: verifications.data ?? [],
      outcomes: outcomes.data ?? [],
      economics: economics.data,
    });

    await admin
      .from('work_episodes')
      .update({ tier: assessment.tier, confidence: assessment.confidence })
      .eq('id', episodeId);
  } catch {
    // Scoring is derived data. Failing to update it must never break the
    // caller, which is usually an upload that already succeeded.
  }
}

/**
 * Record the model's reading of a day as a verification.
 *
 * Deliberately written as `ai_analysis`, the one verification kind the
 * confidence engine refuses to treat as ground truth. Storing it here rather
 * than only on the proof row means an episode's verdicts all live in one
 * place, and the distinction between what the model thought and what an
 * inspector found stays visible in the same list.
 */
export async function recordAiVerification(
  admin: any,
  input: { episodeId: string; orgId: string; passed: boolean; detail: string },
): Promise<void> {
  try {
    await admin.from('episode_verifications').insert({
      episode_id: input.episodeId,
      org_id: input.orgId,
      kind: 'ai_analysis',
      result: input.passed ? 'pass' : 'inconclusive',
      verifier_label: 'Atmosphere analysis',
      detail: input.detail.slice(0, 2000),
    });
    await rescoreEpisode(admin, input.episodeId);
  } catch {
    /* derived data; never break the caller */
  }
}
