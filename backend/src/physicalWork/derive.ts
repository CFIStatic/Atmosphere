/**
 * Pure assembly of a physical-work record.
 *
 * The database shape lives next door. This file is the product judgement:
 * how a day's proofs, actions and findings become before/after, an immediate
 * outcome, and a rights-aware export. Nothing here talks to Postgres, which
 * is what keeps every rule testable without a key.
 */

import { createHash } from 'node:crypto';
import { taskByKey } from '../episodes/ontology.js';
import {
  PHYSICAL_WORK_SCHEMA,
  type DerivedAction,
  type DerivedEvidence,
  type DerivedImmediateOutcome,
  type DerivedResource,
  type DerivedWorldState,
  type EpisodeForDerive,
  type ExportRights,
  type ExportView,
  type ImmediateStatus,
  type PhysicalWorkRecord,
  type ProofForDerive,
  type ScopeVerdictLine,
} from './types.js';

const GROUND_TRUTH_KINDS = new Set([
  'gc_acceptance',
  'owner_acceptance',
  'code_inspection',
  'engineer_review',
  'pressure_test',
  'electrical_test',
  'moisture_reading',
  'thermal_scan',
  'punch_list',
  'third_party_test',
]);

export function stringList(value: unknown, max = 24): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const next = item.trim().slice(0, 400);
    if (!next || seen.has(next.toLowerCase())) continue;
    seen.add(next.toLowerCase());
    out.push(next);
    if (out.length >= max) break;
  }
  return out;
}

function cleanText(value: unknown, max = 2000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

function openingWord(findings: Record<string, unknown> | null | undefined, half: 'before' | 'after'): string | null {
  const opening = findings?.opening;
  if (typeof opening === 'string') return half === 'after' ? opening : null;
  if (opening && typeof opening === 'object') {
    const rec = opening as Record<string, unknown>;
    return cleanText(rec[half], 40);
  }
  return null;
}

function findingsOf(proof: ProofForDerive | null | undefined): Record<string, unknown> {
  return proof?.ai_findings && typeof proof.ai_findings === 'object' ? proof.ai_findings : {};
}

function pickProofs(proofs: ProofForDerive[]): { before: ProofForDerive | null; after: ProofForDerive | null; film: ProofForDerive | null } {
  const before = proofs.find((p) => p.phase === 'before') ?? null;
  const after = proofs.find((p) => p.phase === 'after') ?? null;
  return { before, after, film: after ?? before ?? proofs[0] ?? null };
}

function worldHasSubstance(state: DerivedWorldState): boolean {
  return Boolean(
    state.summary ||
      state.opening ||
      state.visibleConditions.length ||
      state.changes.length ||
      state.concerns.length ||
      state.uncertainties.length ||
      state.objects.length,
  );
}

function objectsFrom(proof: ProofForDerive | null, extra: string[]): string[] {
  const findings = findingsOf(proof);
  const fromActions = Array.isArray(proof?.actions)
    ? (proof!.actions as Array<Record<string, unknown>>).flatMap((a) => [
        ...(typeof a.objectLabel === 'string' ? [a.objectLabel] : []),
        ...(Array.isArray(a.objects) ? a.objects.filter((x): x is string => typeof x === 'string') : []),
      ])
    : [];
  return stringList(
    [...stringList(findings.scopeTouched), ...stringList(findings.workPerformed), ...fromActions, ...extra],
    16,
  );
}

export function deriveWorldStates(proofs: ProofForDerive[]): {
  before: DerivedWorldState | null;
  after: DerivedWorldState | null;
} {
  const { before: beforeProof, after: afterProof, film } = pickProofs(proofs);
  const afterFindings = findingsOf(afterProof ?? film);
  const beforeFindings = findingsOf(beforeProof ?? film);

  const sharedChanges = stringList(
    Array.isArray(afterFindings.changes) && afterFindings.changes.length
      ? afterFindings.changes
      : afterFindings.workPerformed,
  );
  const sharedUncertainties = stringList(
    [...stringList(beforeFindings.cannotTell), ...stringList(afterFindings.cannotTell)],
    16,
  );
  const sharedConcerns = stringList(
    [...stringList(beforeFindings.concerns), ...stringList(afterFindings.concerns)],
    12,
  );

  const before: DerivedWorldState = {
    kind: 'before',
    sourceProofId: beforeProof?.id ?? film?.id ?? null,
    summary: cleanText(beforeProof?.ai_summary ?? (beforeProof ? null : film?.ai_summary)),
    opening: openingWord(beforeFindings, 'before') ?? openingWord(beforeFindings, 'after'),
    visibleConditions: stringList(beforeFindings.workPerformed ?? beforeFindings.changes, 12),
    changes: [],
    concerns: stringList(beforeFindings.concerns, 8),
    uncertainties: stringList(beforeFindings.cannotTell, 12),
    objects: objectsFrom(beforeProof ?? film, []),
    source: 'ai',
    model: cleanText(beforeProof?.ai_model ?? film?.ai_model, 80),
  };

  const after: DerivedWorldState = {
    kind: 'after',
    sourceProofId: afterProof?.id ?? film?.id ?? null,
    summary: cleanText(afterProof?.ai_summary ?? film?.ai_summary),
    opening: openingWord(afterFindings, 'after') ?? openingWord(afterFindings, 'before'),
    visibleConditions: [],
    changes: sharedChanges,
    concerns: sharedConcerns,
    uncertainties: sharedUncertainties,
    objects: objectsFrom(afterProof ?? film, sharedChanges),
    source: 'ai',
    model: cleanText(afterProof?.ai_model ?? film?.ai_model, 80),
  };

  // A day film with no paired before still earns an after reading. A before
  // clip with no description is not invented into a world state.
  return {
    before: beforeProof || worldHasSubstance(before) ? before : null,
    after: afterProof || film || worldHasSubstance(after) ? after : null,
  };
}

export function parseScopeVerdicts(raw: unknown): ScopeVerdictLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ScopeVerdictLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = cleanText(rec.title, 200);
    if (!title) continue;
    out.push({
      title,
      verdict: typeof rec.verdict === 'string' ? rec.verdict : 'not_visible',
      because: cleanText(rec.because, 500),
    });
  }
  return out.slice(0, 48);
}

export function immediateStatusFromVerdicts(
  verdicts: ScopeVerdictLine[],
  materialChange: string | null,
): ImmediateStatus {
  if (verdicts.length === 0) {
    if (materialChange === 'significant' || materialChange === 'minor') return 'changed';
    return 'unknown';
  }
  const set = new Set(verdicts.map((v) => v.verdict));
  if (set.size === 1) {
    const only = [...set][0];
    if (only === 'appears_complete' || only === 'in_progress' || only === 'not_visible') return only;
  }
  return 'mixed';
}

export function deriveImmediateOutcome(proofs: ProofForDerive[]): DerivedImmediateOutcome | null {
  const { after, film } = pickProofs(proofs);
  const source = after ?? film;
  if (!source) return null;

  const findings = findingsOf(source);
  const scopeVerdicts = parseScopeVerdicts(findings.scopeVerdicts);
  const materialChange = cleanText(source.ai_material_change ?? findings.materialChange, 40);
  const summary = cleanText(source.ai_summary ?? findings.summary);
  const status = immediateStatusFromVerdicts(scopeVerdicts, materialChange);

  if (!summary && !materialChange && scopeVerdicts.length === 0) return null;

  return {
    status,
    materialChange,
    summary,
    scopeVerdicts,
    source: 'ai',
    isGroundTruth: false,
    model: cleanText(source.ai_model, 80),
  };
}

export function deriveEvidence(proofs: ProofForDerive[]): DerivedEvidence[] {
  return proofs.map((proof) => ({
    proofId: proof.id,
    kind: 'video',
    phase: proof.phase ?? null,
    contentHash: proof.content_hash ?? null,
    storagePath: proof.storage_path ?? null,
    durationSeconds:
      proof.duration_seconds === null || proof.duration_seconds === undefined
        ? null
        : Number(proof.duration_seconds),
    byteSize: proof.byte_size === null || proof.byte_size === undefined ? null : Number(proof.byte_size),
    capturedAt: proof.captured_at ?? null,
  }));
}

export function deriveResourcesFromActions(
  actions: Array<{ tool_label?: string | null; material_label?: string | null }>,
): DerivedResource[] {
  const out: DerivedResource[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    for (const [kind, name] of [
      ['tool', action.tool_label],
      ['material', action.material_label],
    ] as const) {
      const cleaned = cleanText(name, 200);
      if (!cleaned) continue;
      const key = `${kind}:${cleaned.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, name: cleaned, source: 'ai' });
    }
  }
  return out;
}

export function deriveActions(rows: Array<Record<string, unknown>>): DerivedAction[] {
  return rows
    .map((row, index) => ({
      sequence: Number(row.sequence ?? index + 1),
      action: typeof row.action === 'string' ? row.action : 'other',
      objectLabel: cleanText(row.object_label, 80),
      toolLabel: cleanText(row.tool_label, 80),
      materialLabel: cleanText(row.material_label, 80),
      startSeconds:
        row.start_seconds === null || row.start_seconds === undefined ? null : Number(row.start_seconds),
      endSeconds: row.end_seconds === null || row.end_seconds === undefined ? null : Number(row.end_seconds),
      purpose: cleanText(row.purpose, 500),
      labelSource: typeof row.label_source === 'string' ? row.label_source : 'ai',
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      validated: Boolean(row.validated_at),
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

export function exportRights(dataRights: string | null | undefined, workerConsent: string | null | undefined): ExportRights {
  const rights = dataRights ?? 'job_only';
  const consent = workerConsent ?? 'not_asked';
  const reasons: string[] = [];

  if (rights === 'licensable' && consent === 'granted') {
    return { dataRights: rights, workerConsent: consent, view: 'training', trainingEligible: true, reasons };
  }
  if (rights === 'licensable' && consent !== 'granted') {
    reasons.push('licensable_without_consent');
  }
  if (rights === 'org_analytics') {
    reasons.push('not_licensable');
    return {
      dataRights: rights,
      workerConsent: consent,
      view: 'org_analytics',
      trainingEligible: false,
      reasons,
    };
  }
  if (rights === 'job_only') reasons.push('job_only');
  return {
    dataRights: rights,
    workerConsent: consent,
    view: 'operational',
    trainingEligible: false,
    reasons,
  };
}

export function redactEvidenceForView(evidence: DerivedEvidence[], view: ExportView): DerivedEvidence[] {
  if (view === 'training') return evidence;
  return evidence.map((item) => ({
    ...item,
    contentHash: view === 'org_analytics' ? item.contentHash : null,
    storagePath: null,
  }));
}

export function payloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assemblePhysicalWorkRecord(input: {
  episode: EpisodeForDerive;
  proofs: ProofForDerive[];
  actions: Array<Record<string, unknown>>;
  resources?: Array<{ kind?: string; name?: string; source?: string }>;
  verifications?: Array<{ kind?: string; result?: string; detail?: string | null }>;
  outcomes?: Array<{
    kind?: string;
    days_after_work?: number | null;
    detail?: string | null;
    corrected_by_episode_id?: string | null;
  }>;
  persisted?: {
    before?: DerivedWorldState | null;
    after?: DerivedWorldState | null;
    outcome?: DerivedImmediateOutcome | null;
    evidence?: DerivedEvidence[];
  };
}): PhysicalWorkRecord {
  const task = input.episode.task_key ? taskByKey(input.episode.task_key) : null;
  const derived = deriveWorldStates(input.proofs);
  const before = input.persisted?.before ?? derived.before;
  const after = input.persisted?.after ?? derived.after;
  const outcome = input.persisted?.outcome ?? deriveImmediateOutcome(input.proofs);
  const actions = deriveActions(input.actions);
  const fromActions = deriveResourcesFromActions(input.actions);
  const stored = (input.resources ?? []).map((row) => ({
    kind: row.kind === 'material' ? ('material' as const) : ('tool' as const),
    name: row.name ?? '',
    source: (row.source as DerivedResource['source']) ?? 'human',
  })).filter((row) => row.name);
  const resources = stored.length ? stored : fromActions;
  const evidence = input.persisted?.evidence ?? deriveEvidence(input.proofs);
  const rights = exportRights(input.episode.data_rights, input.episode.worker_consent);

  return {
    schema: PHYSICAL_WORK_SCHEMA,
    episodeId: input.episode.id,
    jobId: input.episode.job_id,
    workDate: input.episode.work_date,
    performerLabel: input.episode.performer_label ?? null,
    performerKind: input.episode.performer_kind ?? 'human',
    goal: {
      taskKey: input.episode.task_key ?? null,
      taskName: task?.name ?? null,
      trade: input.episode.trade ?? task?.trade ?? null,
      system: input.episode.system ?? task?.system ?? null,
      assembly: input.episode.assembly ?? task?.assembly ?? null,
      intentNote: input.episode.intent_note ?? null,
      scopeItemId: input.episode.scope_item_id ?? null,
      expectedActions: task?.expectedActions ?? [],
    },
    before,
    after,
    actions,
    tools: resources.filter((r) => r.kind === 'tool'),
    materials: resources.filter((r) => r.kind === 'material'),
    outcome,
    longTermOutcomes: (input.outcomes ?? []).map((row) => ({
      kind: row.kind ?? 'unknown',
      daysAfterWork: row.days_after_work ?? null,
      detail: row.detail ?? null,
      corrected: Boolean(row.corrected_by_episode_id),
    })),
    evidence: redactEvidenceForView(evidence, rights.view),
    verification: (input.verifications ?? []).map((row) => ({
      kind: row.kind ?? 'ai_analysis',
      result: row.result ?? 'inconclusive',
      detail: row.detail ?? null,
      isGroundTruth: GROUND_TRUTH_KINDS.has(row.kind ?? ''),
    })),
    rights,
    tier: Number(input.episode.tier ?? 1),
    status: input.episode.status ?? 'in_progress',
  };
}

export function verifiedPhysicalWorkEpisode(row: { tier?: number | null }): boolean {
  return Number(row.tier ?? 1) >= 2;
}
