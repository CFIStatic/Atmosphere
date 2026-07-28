/**
 * Orchestration domain types for the Project Manager Agent.
 *
 * Platforms (Dash, XactAnalysis, Xactimate, Outlook), messaging intake
 * (@atmosphere mentions), equipment plans from estimates, procurement
 * (dumpster bids + material referral links), and the human approval queue.
 */

export const ORCHESTRATION_PLATFORMS = [
  'dash',
  'xactanalysis',
  'xactimate',
  'outlook',
] as const;
export type OrchestrationPlatform = (typeof ORCHESTRATION_PLATFORMS)[number];

export const PLATFORM_CONNECTION_STATUSES = [
  'connected',
  'disconnected',
  'error',
  'pending',
] as const;
export type PlatformConnectionStatus = (typeof PLATFORM_CONNECTION_STATUSES)[number];

export const PLATFORM_LINK_STATUSES = [
  'linked',
  'syncing',
  'synced',
  'stale',
  'error',
] as const;
export type PlatformLinkStatus = (typeof PLATFORM_LINK_STATUSES)[number];

export const COMMUNICATION_CHANNELS = [
  'imessage',
  'whatsapp',
  'signal',
  'sms',
  'email',
  'outlook',
  'other',
] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_STATUSES = [
  'new',
  'reviewed',
  'filed',
  'actioned',
  'ignored',
] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

export const COUNTERPARTY_KINDS = [
  'vendor',
  'customer',
  'adjuster',
  'crew',
  'carrier',
  'supplier',
  'unknown',
] as const;
export type CounterpartyKind = (typeof COUNTERPARTY_KINDS)[number];

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'executed',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const EQUIPMENT_PLAN_SOURCES = [
  'mitigation_estimate',
  'construction_estimate',
  'manual',
  's500',
] as const;
export type EquipmentPlanSource = (typeof EQUIPMENT_PLAN_SOURCES)[number];

export const PROCUREMENT_KINDS = [
  'dumpster',
  'material',
  'equipment_rental',
  'other',
] as const;
export type ProcurementKind = (typeof PROCUREMENT_KINDS)[number];

export interface PlatformConnection {
  id: string;
  orgId: string;
  platform: OrchestrationPlatform;
  label: string | null;
  status: PlatformConnectionStatus;
  externalAccountId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  connectedBy: string | null;
  connectedAt: string;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformLink {
  id: string;
  orgId: string;
  projectId: string;
  platform: OrchestrationPlatform;
  externalId: string;
  externalUrl: string | null;
  externalLabel: string | null;
  syncStatus: PlatformLinkStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  linkedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformEvent {
  id: string;
  orgId: string;
  projectId: string | null;
  platform: OrchestrationPlatform;
  eventKind: string;
  direction: 'inbound' | 'outbound' | 'internal';
  summary: string;
  detail: string | null;
  externalId: string | null;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  approvalId: string | null;
  occurredAt: string;
  recordedBy: string | null;
  createdAt: string;
}

export interface Communication {
  id: string;
  orgId: string;
  projectId: string | null;
  channel: CommunicationChannel;
  direction: 'inbound' | 'outbound' | 'note';
  intake: 'mention' | 'relay' | 'manual' | 'platform_sync';
  counterpartyName: string | null;
  counterpartyHandle: string | null;
  counterpartyKind: CounterpartyKind;
  body: string;
  mentionExcerpt: string | null;
  threadKey: string | null;
  externalMessageId: string | null;
  fingerprint: string;
  status: CommunicationStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  orgId: string;
  projectId: string | null;
  kind: string;
  title: string;
  detail: string | null;
  proposedAction: Record<string, unknown>;
  platform: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: ApprovalStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown>;
  expiresAt: string | null;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentPlan {
  id: string;
  orgId: string;
  projectId: string;
  source: EquipmentPlanSource;
  sourceRef: string | null;
  status: 'draft' | 'approved' | 'in_progress' | 'fulfilled' | 'cancelled';
  summary: string | null;
  dumpsterRequired: boolean;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentPlanItem {
  id: string;
  orgId: string;
  planId: string;
  projectId: string;
  itemKind: string;
  label: string;
  quantity: number;
  unit: string;
  fulfillment: 'inventory' | 'rent' | 'buy' | 'referral' | 'bid' | 'crew';
  status: 'needed' | 'reserved' | 'ordered' | 'on_site' | 'returned' | 'cancelled';
  notes: string | null;
  estimateCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VendorReferral {
  id: string;
  orgId: string | null;
  vendorKey: string;
  name: string;
  category: string;
  baseUrl: string;
  linkTemplate: string;
  referralParam: string;
  atmosphereRefCode: string;
  commissionBps: number;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementRequest {
  id: string;
  orgId: string;
  projectId: string;
  planItemId: string | null;
  kind: ProcurementKind;
  title: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  shipToPostal: string | null;
  shipToAddress: string | null;
  status: 'open' | 'bidding' | 'awaiting_approval' | 'ordered' | 'fulfilled' | 'cancelled';
  selectedBidId: string | null;
  referralVendorKey: string | null;
  referralUrl: string | null;
  approvalId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementBid {
  id: string;
  orgId: string;
  requestId: string;
  projectId: string;
  vendorName: string;
  vendorUrl: string | null;
  vendorPhone: string | null;
  amountCents: number | null;
  currency: string;
  leadDays: number | null;
  notes: string | null;
  source: 'web_search' | 'manual' | 'referral' | 'api';
  status: 'collected' | 'shortlisted' | 'selected' | 'rejected' | 'expired';
  raw: Record<string, unknown>;
  collectedAt: string;
  createdAt: string;
}

/** One row on the situation timeline — what is happening right now. */
export interface SituationEvent {
  id: string;
  kind: 'alert' | 'communication' | 'platform' | 'approval' | 'procurement';
  projectId: string | null;
  occurredAt: string;
  title: string;
  detail: string | null;
  severity?: 'info' | 'warn' | 'critical';
  status?: string;
  href?: string;
}

export interface ProposedPlanItem {
  itemKind: string;
  label: string;
  quantity: number;
  unit: string;
  fulfillment: EquipmentPlanItem['fulfillment'];
  estimateCode?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}
