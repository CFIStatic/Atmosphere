import type {
  ConstructionEstimate,
  CrmJob,
  JobPhoto,
  MitigationEstimate,
  ScanProject,
} from '../types.js';

/**
 * The contracts the pipeline depends on.
 *
 * The pipeline is written against these three interfaces and nothing else, so a
 * connector can be swapped (DocuSketch → another scanning vendor), stubbed
 * (fixtures, for a run without credentials), or re-pointed at a different
 * tenant without any change to matching, scoping, or pricing.
 *
 * Each vendor exposes a different HTTP surface and, in practice, a
 * partner-specific one — so the live adapters are written against configurable
 * hosts and documented request shapes rather than hard-coded endpoints. Where a
 * vendor's payload differs from what an adapter expects, the fix belongs in the
 * adapter's normaliser, not upstream of here.
 */

export interface ScanConnector {
  readonly name: string;
  /** Verify the stored credentials without doing any work. */
  verify(): Promise<void>;
  /** Projects visible to the account, newest first. */
  listProjects(options?: { search?: string; limit?: number }): Promise<ScanProjectSummary[]>;
  /** Full project: rooms, measurements, and the photo manifest. */
  getProject(projectId: string): Promise<ScanProject>;
  /** Download the bytes of one photo, for vision analysis. */
  downloadPhoto(photo: JobPhoto): Promise<{ bytes: Buffer; contentType: string }>;
}

export interface ScanProjectSummary {
  id: string;
  name: string;
  address?: string;
  claimNumber?: string;
  capturedAt?: string;
}

export interface CrmConnector {
  readonly name: string;
  verify(): Promise<void>;
  /**
   * Candidate jobs for a scan project. Implementations should search broadly —
   * the matcher scores candidates, so a slightly wide net costs little and a
   * narrow one loses the correct job.
   */
  searchJobs(query: CrmJobQuery): Promise<CrmJob[]>;
  getJob(jobId: string): Promise<CrmJob>;
  /** Attachment bytes — how a mitigation estimate arrives. */
  downloadDocument(jobId: string, documentId: string): Promise<{ bytes: Buffer; contentType: string }>;
}

export interface CrmJobQuery {
  claimNumber?: string;
  insuredName?: string;
  address?: string;
  postalCode?: string;
  limit?: number;
}

export interface EstimateConnector {
  readonly name: string;
  verify(): Promise<void>;
  /**
   * Write the estimate into the estimating platform.
   *
   * This is the one outward-facing, hard-to-reverse action in the pipeline, so
   * it is never called as part of an automatic run — the caller must approve
   * the estimate first. See `pipeline.ts`.
   */
  createEstimate(estimate: ConstructionEstimate): Promise<{ reference: string; url?: string }>;
  /** Pull an existing mitigation estimate back out, when the CRM has no copy. */
  fetchMitigationEstimate?(claimNumber: string): Promise<MitigationEstimate | null>;
}

export interface ConnectorSet {
  scan: ScanConnector;
  crm: CrmConnector;
  estimating: EstimateConnector;
  /** `sandbox` connectors serve fixtures; `live` talk to the vendors. */
  mode: 'live' | 'sandbox';
}
