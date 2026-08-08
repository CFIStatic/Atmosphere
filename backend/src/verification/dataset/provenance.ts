/**
 * Provenance links for derived verification and dataset artifacts.
 */

import { randomUUID } from 'node:crypto';

export interface ProvenanceInput {
  orgId: string;
  entityType: string;
  entityId: string;
  parentType?: string | null;
  parentId?: string | null;
  transformation: string;
  transformationVersion?: string;
  modelName?: string | null;
  promptVersion?: string | null;
  ruleVersion?: string | null;
  ontologyVersion?: string | null;
  codeVersion?: string | null;
  checksum?: string | null;
  payload?: Record<string, unknown>;
}

export async function recordProvenance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: ProvenanceInput,
): Promise<string> {
  const id = randomUUID();
  const { error } = await supabase.from('provenance_records').insert({
    id,
    org_id: input.orgId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    parent_type: input.parentType ?? null,
    parent_id: input.parentId ?? null,
    transformation: input.transformation,
    transformation_version: input.transformationVersion ?? 'v1',
    model_name: input.modelName ?? null,
    prompt_version: input.promptVersion ?? null,
    rule_version: input.ruleVersion ?? null,
    ontology_version: input.ontologyVersion ?? null,
    code_version: input.codeVersion ?? process.env.GIT_COMMIT ?? 'local',
    checksum: input.checksum ?? null,
    payload: input.payload ?? {},
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function hasProvenanceChain(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { orgId: string; resultId: string },
): Promise<boolean> {
  const { data: result } = await supabase
    .from('verification_results')
    .select('id, change_event_id, llm_run_id, video_id')
    .eq('id', opts.resultId)
    .eq('org_id', opts.orgId)
    .maybeSingle();
  if (!result) return false;
  if (!result.video_id) return false;
  // Minimal completeness: result exists with video + (llm run or change event)
  return Boolean(result.llm_run_id || result.change_event_id);
}
