/**
 * The structured physical-work record assembled from a work episode.
 *
 * Names match the training-export JSON a buyer or a later model actually
 * reads. Nothing here is a second domain — every id is a work_episodes id.
 */

export const PHYSICAL_WORK_SCHEMA = 'atmosphere.physical_work.v1';

export type WorldStateKind = 'before' | 'after';

export type ImmediateStatus =
  | 'appears_complete'
  | 'in_progress'
  | 'not_visible'
  | 'mixed'
  | 'changed'
  | 'unknown';

export type ExportView = 'operational' | 'org_analytics' | 'training';

export interface ScopeVerdictLine {
  title: string;
  verdict: 'appears_complete' | 'in_progress' | 'not_visible' | string;
  because: string | null;
}

export interface DerivedWorldState {
  kind: WorldStateKind;
  sourceProofId: string | null;
  summary: string | null;
  opening: string | null;
  visibleConditions: string[];
  changes: string[];
  concerns: string[];
  uncertainties: string[];
  objects: string[];
  source: 'ai' | 'human' | 'derived';
  model: string | null;
}

export interface DerivedImmediateOutcome {
  status: ImmediateStatus;
  materialChange: string | null;
  summary: string | null;
  scopeVerdicts: ScopeVerdictLine[];
  source: 'ai' | 'human' | 'derived';
  isGroundTruth: false;
  model: string | null;
}

export interface DerivedResource {
  kind: 'tool' | 'material';
  name: string;
  source: 'ai' | 'human' | 'purchase_order' | 'telemetry';
}

export interface DerivedEvidence {
  proofId: string | null;
  kind: string;
  phase: string | null;
  contentHash: string | null;
  storagePath: string | null;
  durationSeconds: number | null;
  byteSize: number | null;
  capturedAt: string | null;
}

export interface DerivedAction {
  sequence: number;
  action: string;
  objectLabel: string | null;
  toolLabel: string | null;
  materialLabel: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  purpose: string | null;
  labelSource: string;
  confidence: number | null;
  validated: boolean;
}

export interface ExportRights {
  dataRights: string;
  workerConsent: string;
  view: ExportView;
  trainingEligible: boolean;
  reasons: string[];
}

export interface PhysicalWorkGoal {
  taskKey: string | null;
  taskName: string | null;
  trade: string | null;
  system: string | null;
  assembly: string | null;
  intentNote: string | null;
  scopeItemId: string | null;
  expectedActions: string[];
}

export interface PhysicalWorkRecord {
  schema: typeof PHYSICAL_WORK_SCHEMA;
  episodeId: string;
  jobId: string;
  workDate: string;
  performerLabel: string | null;
  performerKind: string;
  goal: PhysicalWorkGoal;
  before: DerivedWorldState | null;
  after: DerivedWorldState | null;
  actions: DerivedAction[];
  tools: DerivedResource[];
  materials: DerivedResource[];
  outcome: DerivedImmediateOutcome | null;
  longTermOutcomes: Array<{
    kind: string;
    daysAfterWork: number | null;
    detail: string | null;
    corrected: boolean;
  }>;
  evidence: DerivedEvidence[];
  verification: Array<{
    kind: string;
    result: string;
    detail: string | null;
    isGroundTruth: boolean;
  }>;
  rights: ExportRights;
  tier: number;
  status: string;
}

export interface ProofForDerive {
  id: string;
  phase?: string | null;
  ai_summary?: string | null;
  ai_findings?: Record<string, unknown> | null;
  ai_material_change?: string | null;
  ai_model?: string | null;
  content_hash?: string | null;
  storage_path?: string | null;
  duration_seconds?: number | null;
  byte_size?: number | null;
  captured_at?: string | null;
  actions?: unknown;
}

export interface EpisodeForDerive {
  id: string;
  job_id: string;
  org_id: string;
  party_id?: string | null;
  work_date: string;
  task_key?: string | null;
  trade?: string | null;
  system?: string | null;
  assembly?: string | null;
  intent_note?: string | null;
  scope_item_id?: string | null;
  performer_label?: string | null;
  performer_kind?: string | null;
  data_rights?: string | null;
  worker_consent?: string | null;
  tier?: number | null;
  status?: string | null;
}
