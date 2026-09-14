/** Org-scoped trade playbook (checklist / skill card pack). */

export type PlaybookStatus = 'draft' | 'published' | 'archived';
export type PlaybookSourceKind = 'job_analysis' | 'manual' | 'seeded';

export interface PlaybookStep {
  id: string;
  playbookId: string;
  position: number;
  title: string;
  instruction: string | null;
  skillKey: string | null;
  evidenceHint: string | null;
  metadata: Record<string, unknown>;
}

export interface PlaybookSource {
  id: string;
  playbookId: string;
  jobId: string | null;
  proofId: string | null;
  episodeId: string | null;
  analysisSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface TradePlaybook {
  id: string;
  orgId: string;
  title: string;
  trade: string | null;
  summary: string | null;
  status: PlaybookStatus;
  sourceKind: PlaybookSourceKind;
  sourceJobId: string | null;
  skillTags: string[];
  stepCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  steps?: PlaybookStep[];
  sources?: PlaybookSource[];
}

export interface DraftPlaybookStep {
  title: string;
  instruction?: string | null;
  skillKey?: string | null;
  evidenceHint?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GeneratedPlaybookDraft {
  title: string;
  trade: string | null;
  summary: string | null;
  sourceKind: 'job_analysis';
  sourceJobId: string;
  skillTags: string[];
  steps: DraftPlaybookStep[];
  analysisSnapshot: Record<string, unknown>;
  proofIds: string[];
}

export interface ScopeVerdictLine {
  title: string;
  verdict: string;
  because?: string;
}
