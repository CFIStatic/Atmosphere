/**
 * Turn a filed proof into the Phase 1 physical-work rows.
 *
 * Additive and silent: a crew standing in a doorway already got their upload
 * acknowledgement. This layer must never throw into that path.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { recordAiVerification, rescoreEpisode } from '../episodes/attach.js';
import {
  assemblePhysicalWorkRecord,
  deriveEvidence,
  deriveImmediateOutcome,
  deriveResourcesFromActions,
  deriveWorldStates,
  payloadHash,
} from './derive.js';
import type { EpisodeForDerive, PhysicalWorkRecord, ProofForDerive } from './types.js';

export interface IngestInput {
  orgId: string;
  proofId: string;
}

async function loadProofsForEpisode(admin: any, episodeId: string): Promise<{
  observations: any[];
  proofs: ProofForDerive[];
}> {
  const { data: observations } = await admin
    .from('episode_observations')
    .select('*')
    .eq('episode_id', episodeId);
  const rows = observations ?? [];
  const proofIds = rows
    .map((o: any) => o.proof_id)
    .filter((id: string | null): id is string => Boolean(id));
  if (proofIds.length === 0) return { observations: rows, proofs: [] };

  const { data: proofs } = await admin
    .from('job_proofs')
    .select(
      'id, phase, ai_summary, ai_findings, ai_material_change, ai_model, content_hash, storage_path, duration_seconds, byte_size, captured_at, actions',
    )
    .in('id', proofIds);
  return { observations: rows, proofs: (proofs ?? []) as ProofForDerive[] };
}

async function upsertWorldStates(
  admin: any,
  orgId: string,
  episodeId: string,
  states: ReturnType<typeof deriveWorldStates>,
): Promise<void> {
  for (const state of [states.before, states.after]) {
    if (!state) continue;
    await admin.from('episode_world_states').upsert(
      {
        episode_id: episodeId,
        org_id: orgId,
        kind: state.kind,
        source_proof_id: state.sourceProofId,
        summary: state.summary,
        opening: state.opening,
        visible_conditions: state.visibleConditions,
        changes: state.changes,
        concerns: state.concerns,
        uncertainties: state.uncertainties,
        objects: state.objects,
        payload: {
          opening: state.opening,
          objects: state.objects,
        },
        source: state.source,
        model: state.model,
      },
      { onConflict: 'episode_id,kind' },
    );
  }
}

async function upsertEvidence(
  admin: any,
  orgId: string,
  episodeId: string,
  proofs: ProofForDerive[],
): Promise<void> {
  for (const asset of deriveEvidence(proofs)) {
    if (!asset.proofId) continue;
    await admin.from('episode_evidence_assets').upsert(
      {
        episode_id: episodeId,
        org_id: orgId,
        proof_id: asset.proofId,
        kind: asset.kind,
        phase: asset.phase,
        content_hash: asset.contentHash,
        storage_path: asset.storagePath,
        duration_seconds: asset.durationSeconds,
        byte_size: asset.byteSize,
        captured_at: asset.capturedAt,
      },
      { onConflict: 'episode_id,proof_id,kind' },
    );
  }
}

async function insertAnnotation(
  admin: any,
  orgId: string,
  episodeId: string,
  kind: 'ai_world_state' | 'ai_actions' | 'ai_immediate_outcome' | 'ai_resources',
  model: string | null,
  payload: unknown,
): Promise<void> {
  const hash = payloadHash(payload);
  const { data: existing } = await admin
    .from('episode_annotations')
    .select('id')
    .eq('episode_id', episodeId)
    .eq('kind', kind)
    .eq('payload_hash', hash)
    .maybeSingle();
  if (existing) return;
  await admin.from('episode_annotations').insert({
    episode_id: episodeId,
    org_id: orgId,
    kind,
    model,
    payload_hash: hash,
    payload,
  });
}

async function upsertImmediateOutcome(
  admin: any,
  orgId: string,
  episodeId: string,
  outcome: NonNullable<ReturnType<typeof deriveImmediateOutcome>>,
): Promise<void> {
  await admin.from('episode_immediate_outcomes').upsert(
    {
      episode_id: episodeId,
      org_id: orgId,
      status: outcome.status,
      material_change: outcome.materialChange,
      summary: outcome.summary,
      scope_verdicts: outcome.scopeVerdicts,
      source: outcome.source,
      is_ground_truth: false,
      model: outcome.model,
    },
    { onConflict: 'episode_id' },
  );
}

async function upsertAiResources(
  admin: any,
  orgId: string,
  episodeId: string,
  actions: Array<{ tool_label?: string | null; material_label?: string | null }>,
): Promise<void> {
  const derived = deriveResourcesFromActions(actions);
  if (!derived.length) return;

  const { data: existing } = await admin
    .from('episode_resources')
    .select('kind, name, source')
    .eq('episode_id', episodeId);
  const seen = new Set(
    (existing ?? []).map((row: any) => `${row.kind}:${String(row.name ?? '').toLowerCase()}`),
  );

  for (const resource of derived) {
    const key = `${resource.kind}:${resource.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await admin.from('episode_resources').insert({
      episode_id: episodeId,
      org_id: orgId,
      kind: resource.kind,
      name: resource.name,
      source: 'ai',
    });
  }
}

/**
 * Ingest one proof's episode. Returns the episode id, or null if anything
 * went wrong or the proof is not on an episode yet.
 */
export async function ingestPhysicalWorkFromProof(
  admin: any,
  input: IngestInput,
): Promise<string | null> {
  try {
    const { data: observation } = await admin
      .from('episode_observations')
      .select('episode_id')
      .eq('proof_id', input.proofId)
      .maybeSingle();
    const episodeId = observation?.episode_id as string | undefined;
    if (!episodeId) return null;

    const { data: episode } = await admin
      .from('work_episodes')
      .select(
        'id, org_id, job_id, party_id, work_date, task_key, trade, system, assembly, intent_note, scope_item_id, performer_label, performer_kind, data_rights, worker_consent, tier, status',
      )
      .eq('id', episodeId)
      .maybeSingle();
    if (!episode) return null;

    const [{ proofs }, actionsRes, verificationsRes] = await Promise.all([
      loadProofsForEpisode(admin, episodeId),
      admin.from('episode_actions').select('*').eq('episode_id', episodeId).order('sequence'),
      admin.from('episode_verifications').select('*').eq('episode_id', episodeId),
    ]);

    const worlds = deriveWorldStates(proofs);
    const outcome = deriveImmediateOutcome(proofs);
    const actions = actionsRes.data ?? [];
    const model = proofs.find((p) => p.ai_model)?.ai_model ?? null;

    await upsertWorldStates(admin, input.orgId, episodeId, worlds);
    await upsertEvidence(admin, input.orgId, episodeId, proofs);
    if (worlds.before || worlds.after) {
      await insertAnnotation(admin, input.orgId, episodeId, 'ai_world_state', model, worlds);
    }
    if (actions.length) {
      await insertAnnotation(admin, input.orgId, episodeId, 'ai_actions', model, {
        count: actions.length,
        verbs: actions.map((a: any) => a.action),
      });
    }
    if (outcome) {
      await upsertImmediateOutcome(admin, input.orgId, episodeId, outcome);
      await insertAnnotation(admin, input.orgId, episodeId, 'ai_immediate_outcome', model, outcome);
    }
    await upsertAiResources(admin, input.orgId, episodeId, actions);

    const hasAiVerification = (verificationsRes.data ?? []).some((v: any) => v.kind === 'ai_analysis');
    if (!hasAiVerification && (outcome?.summary || (outcome?.scopeVerdicts.length ?? 0) > 0)) {
      const passed = outcome?.status === 'appears_complete';
      await recordAiVerification(admin, {
        episodeId,
        orgId: input.orgId,
        passed,
        detail: (outcome?.summary ?? 'Atmosphere day reading.').slice(0, 2000),
      });
    } else {
      await rescoreEpisode(admin, episodeId);
    }

    return episodeId;
  } catch {
    return null;
  }
}

function worldFromRow(row: any, kind: 'before' | 'after') {
  return {
    kind,
    sourceProofId: row.source_proof_id,
    summary: row.summary,
    opening: row.opening,
    visibleConditions: row.visible_conditions ?? [],
    changes: row.changes ?? [],
    concerns: row.concerns ?? [],
    uncertainties: row.uncertainties ?? [],
    objects: row.objects ?? [],
    source: row.source,
    model: row.model,
  };
}

export async function loadPhysicalWorkRecord(
  supabase: any,
  episode: EpisodeForDerive,
): Promise<PhysicalWorkRecord> {
  const [{ proofs }, actions, resources, verifications, outcomes, worlds, immediate, evidence] =
    await Promise.all([
      loadProofsForEpisode(supabase, episode.id),
      supabase.from('episode_actions').select('*').eq('episode_id', episode.id).order('sequence'),
      supabase.from('episode_resources').select('*').eq('episode_id', episode.id),
      supabase.from('episode_verifications').select('*').eq('episode_id', episode.id).order('verified_at'),
      supabase.from('episode_outcomes').select('*').eq('episode_id', episode.id).order('observed_at'),
      supabase.from('episode_world_states').select('*').eq('episode_id', episode.id),
      supabase.from('episode_immediate_outcomes').select('*').eq('episode_id', episode.id).maybeSingle(),
      supabase.from('episode_evidence_assets').select('*').eq('episode_id', episode.id),
    ]);

  const beforeRow = (worlds.data ?? []).find((row: any) => row.kind === 'before');
  const afterRow = (worlds.data ?? []).find((row: any) => row.kind === 'after');

  return assemblePhysicalWorkRecord({
    episode,
    proofs,
    actions: actions.data ?? [],
    resources: resources.data ?? [],
    verifications: verifications.data ?? [],
    outcomes: outcomes.data ?? [],
    persisted: {
      before: beforeRow ? worldFromRow(beforeRow, 'before') : null,
      after: afterRow ? worldFromRow(afterRow, 'after') : null,
      outcome: immediate.data
        ? {
            status: immediate.data.status,
            materialChange: immediate.data.material_change,
            summary: immediate.data.summary,
            scopeVerdicts: immediate.data.scope_verdicts ?? [],
            source: immediate.data.source,
            isGroundTruth: false as const,
            model: immediate.data.model,
          }
        : null,
      evidence: (evidence.data ?? []).map((row: any) => ({
        proofId: row.proof_id,
        kind: row.kind,
        phase: row.phase,
        contentHash: row.content_hash,
        storagePath: row.storage_path,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        byteSize: row.byte_size === null ? null : Number(row.byte_size),
        capturedAt: row.captured_at,
      })),
    },
  });
}
