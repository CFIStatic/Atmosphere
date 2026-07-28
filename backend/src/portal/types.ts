/**
 * Domain types for the HomeOwner Report portal.
 *
 * Mirrors `homeowner_portal_*` tables in camelCase. Guest responses never
 * include raw token hashes or internal crew/alert data — the route layer
 * projects a safe DTO from PM rows under visibility flags.
 */

export const SHARE_STATUSES = ['active', 'revoked', 'expired'] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];

export const CONVERSATION_KINDS = ['assistant', 'company', 'adjuster', 'group'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const MESSAGE_AUTHORS = ['homeowner', 'staff', 'adjuster', 'assistant', 'system'] as const;
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
  /** Homeowner ↔ company direct messages. */
  allowChat: boolean;
  /** Homeowner ↔ adjuster direct messages. */
  allowAdjusterChat: boolean;
  /** Homeowner + company + adjuster group thread. */
  allowGroupChat: boolean;
  allowPolicyUpload: boolean;
  allowInsuranceQa: boolean;
  /** Display name on the guest chat (e.g. ServiceMaster Recovery Services). */
  brandName: string | null;
  /** HTTPS URL for the company logo shown in the chat header. */
  logoUrl: string | null;
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

export interface PortalConversation {
  id: string;
  orgId: string;
  projectId: string;
  shareId: string;
  kind: ConversationKind;
  title: string;
  includesHomeowner: boolean;
  includesCompany: boolean;
  includesAdjuster: boolean;
  includesAssistant: boolean;
  status: 'open' | 'archived';
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optional preview for the sidebar. */
  lastMessagePreview?: string | null;
}

export interface PortalMessage {
  id: string;
  orgId: string;
  projectId: string;
  shareId: string;
  conversationId: string;
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
    allowAdjusterChat: true,
    allowGroupChat: true,
    allowPolicyUpload: true,
    allowInsuranceQa: true,
    brandName: null,
    logoUrl: null,
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
