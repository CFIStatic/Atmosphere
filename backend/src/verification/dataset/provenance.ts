/**
 * Provenance links for derived verification and dataset artifacts.
 */

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
  _supabase: any,
  _opts: Record<string, unknown>,
): Promise<void> {
  // provenance_records dropped
  return;
}

export async function hasProvenanceChain(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _supabase: any,
  _opts: { orgId: string; resultId: string },
): Promise<boolean> {
  // provenance chain / provenance_records dropped — treat as incomplete
  return false;
}
