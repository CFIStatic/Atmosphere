/**
 * Platform legal hold, video vault, and user-action monitor.
 *
 * User delete hides a clip from the product. The vault keeps the catalog
 * row and the object-storage key so a subpoena, lawsuit, or preservation
 * letter can still be answered.
 */

export const LEGAL_HOLD_KINDS = [
  'subpoena',
  'lawsuit',
  'preservation',
  'investigation',
  'other',
] as const;
export type LegalHoldKind = (typeof LEGAL_HOLD_KINDS)[number];

export const LEGAL_HOLD_STATUSES = ['open', 'released'] as const;
export type LegalHoldStatus = (typeof LEGAL_HOLD_STATUSES)[number];

export const LEGAL_SUBJECT_TYPES = ['org', 'user', 'job', 'proof', 'media'] as const;
export type LegalSubjectType = (typeof LEGAL_SUBJECT_TYPES)[number];

export const LEGAL_VAULT_SOURCES = ['job_proof', 'media_object'] as const;
export type LegalVaultSource = (typeof LEGAL_VAULT_SOURCES)[number];

export type LegalHold = {
  id: string;
  caseNumber: string;
  kind: LegalHoldKind;
  title: string;
  reason: string;
  counselName: string | null;
  receivedAt: string;
  dueAt: string | null;
  status: LegalHoldStatus;
  createdBy: string | null;
  createdAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
};

export type LegalHoldSubject = {
  id: string;
  holdId: string;
  subjectType: LegalSubjectType;
  subjectId: string;
  createdAt: string;
};

export type LegalHoldRecord = LegalHold & { subjects: LegalHoldSubject[] };

export type LegalVaultEntry = {
  id: string;
  orgId: string;
  sourceKind: LegalVaultSource;
  sourceId: string;
  jobId: string | null;
  actorUserId: string | null;
  storageBackend: string;
  storageBucket: string;
  storageKey: string;
  contentHash: string | null;
  byteSize: number | null;
  durationSeconds: number | null;
  contentType: string | null;
  capturedAt: string | null;
  receivedAt: string;
  userDeletedAt: string | null;
  vaultedAt: string;
  metadata: Record<string, unknown>;
};

export type UserActivityEvent = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorLabel: string | null;
  orgId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  requestId: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown>;
};

export type LegalProduction = {
  id: string;
  holdId: string;
  requestedBy: string | null;
  createdAt: string;
  itemCount: number;
  activityCount: number;
  note: string | null;
};

export type RecordActivityInput = {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorLabel?: string | null;
  orgId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: unknown;
  occurredAt?: string;
};

export type VaultMediaInput = {
  orgId: string;
  sourceKind: LegalVaultSource;
  sourceId: string;
  jobId?: string | null;
  actorUserId?: string | null;
  storageBackend: string;
  storageBucket: string;
  storageKey: string;
  contentHash?: string | null;
  byteSize?: number | null;
  durationSeconds?: number | null;
  contentType?: string | null;
  capturedAt?: string | null;
  receivedAt?: string;
  metadata?: Record<string, unknown>;
};

export type CreateHoldInput = {
  caseNumber: string;
  kind: LegalHoldKind;
  title: string;
  reason: string;
  counselName?: string | null;
  receivedAt?: string;
  dueAt?: string | null;
  createdBy?: string | null;
  subjects: Array<{ subjectType: LegalSubjectType; subjectId: string }>;
};
