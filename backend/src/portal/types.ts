/**
 * Domain types for the HomeOwner Report portal.
 *
 * Mirrors `homeowner_portal_*` tables in camelCase. Guest responses never
 * include raw token hashes or internal crew/alert data — the route layer
 * projects a safe DTO from PM rows under visibility flags.
 */

export const SHARE_STATUSES = ['active', 'revoked', 'expired'] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];

export const MESSAGE_AUTHORS = ['homeowner', 'staff', 'assistant', 'system'] as const;
export type MessageAuthorKind = (typeof MESSAGE_AUTHORS)[number];

export const MESSAGE_TOPICS = [
  'general',
  'schedule',
  'progress',
  'insurance',
  'policy',
  'contact',
] as const;
export type MessageTopic = (typeof MESSAGE_TOPICS)[number];

export interface PortalShare {
  id: string;
  orgId: string;
  projectId: string;
  label: string | null;
  customerName: string | null;
  customerEmail: string | null;
  status: ShareStatus;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  welcomeNote: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface PortalVisibility {
  projectId: string;
  orgId: string;
  showSchedule: boolean;
  showPhaseProgress: boolean;
  showMilestones: boolean;
  showCustomerUpdates: boolean;
  showDryingSummary: boolean;
  showDocuments: boolean;
  showClaimBasics: boolean;
  showDeductible: boolean;
  showOfficeContact: boolean;
  showAdjusterContact: boolean;
  showFieldContact: boolean;
  allowChat: boolean;
  allowPolicyUpload: boolean;
  allowInsuranceQa: boolean;
  officeName: string | null;
  officePhone: string | null;
  officeEmail: string | null;
  fieldContactName: string | null;
  fieldContactPhone: string | null;
  customMessage: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortalMessage {
  id: string;
  orgId: string;
  projectId: string;
  shareId: string;
  authorKind: MessageAuthorKind;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  topic: MessageTopic | null;
  createdAt: string;
}

export interface PortalPolicy {
  id: string;
  orgId: string;
  projectId: string;
  shareId: string;
  fileName: string;
  mimeType: string;
  byteSize: number | null;
  contentText: string;
  summary: string | null;
  uploadedAt: string;
  createdAt: string;
}

/** Defaults when a project has never configured visibility. */
export function defaultVisibility(orgId: string, projectId: string): PortalVisibility {
  const now = new Date().toISOString();
  return {
    projectId,
    orgId,
    showSchedule: true,
    showPhaseProgress: true,
    showMilestones: true,
    showCustomerUpdates: true,
    showDryingSummary: true,
    showDocuments: false,
    showClaimBasics: true,
    showDeductible: false,
    showOfficeContact: true,
    showAdjusterContact: true,
    showFieldContact: false,
    allowChat: true,
    allowPolicyUpload: true,
    allowInsuranceQa: true,
    officeName: null,
    officePhone: null,
    officeEmail: null,
    fieldContactName: null,
    fieldContactPhone: null,
    customMessage: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}
