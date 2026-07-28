/**
 * Partner network + adaptive internal thread types.
 */

export const PARTNER_KINDS = [
  'restoration',
  'general_contractor',
  'subcontractor',
  'vendor',
  'supplier',
  'specialty',
] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export const INVITEE_KINDS = [
  'subcontractor',
  'vendor',
  'supplier',
  'specialty',
  'general_contractor',
] as const;
export type InviteeKind = (typeof INVITEE_KINDS)[number];

export const THREAD_KINDS = [
  'project_ops',
  'vendor_coordination',
  'approval_followup',
  'procurement',
  'network',
  'general',
] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export const THREAD_MODES = ['live', 'digest', 'muted'] as const;
export type ThreadMode = (typeof THREAD_MODES)[number];

export interface PartnerProfile {
  orgId: string;
  displayName: string;
  kind: PartnerKind;
  blurb: string | null;
  trades: string[];
  serviceAreas: string[];
  phone: string | null;
  email: string | null;
  website: string | null;
  jobsCompleted: number;
  invitesSent: number;
  invitesAccepted: number;
  avgResponseHours: number | null;
  discoverable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerInvite {
  id: string;
  orgId: string;
  inviteeKind: InviteeKind;
  inviteeName: string;
  inviteeEmail: string | null;
  inviteePhone: string | null;
  inviteeCompany: string | null;
  trades: string[];
  message: string | null;
  token: string;
  status: 'pending' | 'sent' | 'accepted' | 'declined' | 'expired' | 'revoked';
  crmAccountId: string | null;
  projectId: string | null;
  invitedBy: string | null;
  acceptedOrgId: string | null;
  acceptedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Partnership {
  id: string;
  orgId: string;
  partnerOrgId: string;
  partnerKind: InviteeKind | 'restoration';
  status: 'pending' | 'active' | 'paused' | 'ended';
  inviteId: string | null;
  preferred: boolean;
  notes: string | null;
  sharedJobs: number;
  lastCollaboratedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  partnerProfile?: PartnerProfile | null;
}

export interface Thread {
  id: string;
  orgId: string;
  projectId: string | null;
  partnershipId: string | null;
  kind: ThreadKind;
  mode: ThreadMode;
  title: string;
  status: 'open' | 'resolved' | 'archived';
  originKey: string | null;
  originRef: string | null;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  lastMessageAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadParticipant {
  id: string;
  orgId: string;
  threadId: string;
  userId: string | null;
  partnerOrgId: string | null;
  roleInThread: 'owner' | 'member' | 'watcher' | 'bot';
  joinedAt: string;
  lastReadAt: string | null;
  muted: boolean;
}

export interface ThreadMessage {
  id: string;
  orgId: string;
  threadId: string;
  authorUserId: string | null;
  authorKind: 'user' | 'atmosphere' | 'partner';
  body: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** What the adaptive engine decided about opening / adjusting a thread. */
export interface ThreadAdaptation {
  action: 'open' | 'promote' | 'demote' | 'resolve' | 'skip';
  kind: ThreadKind;
  mode: ThreadMode;
  urgency: Thread['urgency'];
  title: string;
  originKey: string;
  reason: string;
  projectId?: string | null;
  partnershipId?: string | null;
  seedMessage?: string;
}
