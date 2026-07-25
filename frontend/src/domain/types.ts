/**
 * Domain vocabulary for Atmosphere.
 *
 * These types describe the restoration business, not the screens. Nothing here
 * imports React, and nothing here knows how anything is rendered — which is what
 * lets the same shapes back both the fixture layer today and real integrations
 * (DASH, Xactimate, QuickBooks) later.
 */

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Mirrors the `member_role` enum in Postgres, plus `executive`.
 *
 * NOTE: `executive` does not yet exist in the database enum. It is modelled here
 * because executive roll-up views were specified; adding it to `member_role` is
 * a pending migration, and `isExecutive()` is the single place that assumption
 * is encoded.
 */
export type Role =
  'field_technician' | 'project_manager' | 'office_manager' | 'accountant' | 'sales' | 'executive';

export type WorkType = 'mitigation' | 'construction';

export interface Person {
  id: string;
  name: string;
  initials: string;
  role: Role;
}

// ── Jobs ────────────────────────────────────────────────────────────────────

/** Cause of loss. Drives crew type, equipment, and carrier expectations. */
export type Peril = 'water' | 'fire' | 'mold' | 'storm' | 'contents' | 'reconstruction';

/** Lifecycle of a restoration job, in the order work actually flows. */
export type JobPhase =
  'lead' | 'inspection' | 'mitigation' | 'drying' | 'reconstruction' | 'invoicing' | 'closed';

export type JobHealth = 'on_track' | 'at_risk' | 'critical' | 'blocked';

export interface Job {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  address: string;
  peril: Peril;
  phase: JobPhase;
  health: JobHealth;
  /** Days since the loss date — the number PMs actually track. */
  ageDays: number;
  carrier: string | null;
  claimNumber: string | null;
  deductible: number | null;
  projectManagerId: string | null;
  assignedTechIds: string[];
  estimateTotal: number;
  approvedTotal: number;
  invoicedTotal: number;
  paidTotal: number;
  lossDate: string;
  targetCompletion: string | null;
  /** Short human-readable reasons the job is not healthy. */
  flags: string[];
  workType: WorkType;
}

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  jobId: string;
  jobNumber: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
  /** Set when an agent created this task rather than a person. */
  createdByAgentId?: string;
}

export type TimelineKind =
  | 'status_change'
  | 'note'
  | 'document'
  | 'communication'
  | 'agent_action'
  | 'financial'
  | 'field_update';

export interface TimelineEvent {
  id: string;
  jobId: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  at: string;
  actorName: string;
  /** Present when the actor was an agent, enabling provenance links. */
  agentId?: string;
}

export interface JobDocument {
  id: string;
  jobId: string;
  name: string;
  kind: 'photo' | 'estimate' | 'invoice' | 'report' | 'form' | 'correspondence';
  sizeKb: number;
  uploadedAt: string;
  uploadedBy: string;
  source: 'field' | 'dash' | 'xactimate' | 'email' | 'manual';
}

export interface Communication {
  id: string;
  jobId: string;
  channel: 'email' | 'sms' | 'call' | 'portal';
  direction: 'inbound' | 'outbound';
  subject: string;
  preview: string;
  at: string;
  participant: string;
  /** True when an agent drafted or sent it. */
  byAgent: boolean;
  needsReply: boolean;
}

// ── Customers, estimates, money ─────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  type: 'homeowner' | 'commercial' | 'property_manager';
  email: string | null;
  phone: string | null;
  city: string;
  activeJobs: number;
  lifetimeValue: number;
  lastContactAt: string | null;
}

export type EstimateStatus =
  'draft' | 'pending_review' | 'submitted' | 'approved' | 'rejected' | 'supplement_needed';

export interface Estimate {
  id: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  status: EstimateStatus;
  total: number;
  lineItems: number;
  carrier: string | null;
  submittedAt: string | null;
  /** Difference between what we billed and what the carrier approved. */
  varianceFromCarrier: number | null;
  preparedBy: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'disputed';

export interface Invoice {
  id: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  status: InvoiceStatus;
  amount: number;
  paidAmount: number;
  issuedAt: string;
  dueAt: string;
  daysOverdue: number;
}

export interface ScheduleEvent {
  id: string;
  jobId: string | null;
  jobNumber: string | null;
  title: string;
  kind: 'inspection' | 'mitigation' | 'monitoring' | 'reconstruction' | 'meeting';
  start: string;
  end: string;
  assigneeIds: string[];
  address: string | null;
  /** Set when the schedule agent detected a conflict on this event. */
  conflict?: string;
}

// ── Agents and automation ───────────────────────────────────────────────────

/**
 * Capability, not a persona. Users never pick one of these — the assistant
 * routes to them. They surface in the UI only as provenance.
 */
export type AgentCapability =
  | 'scheduling'
  | 'estimating'
  | 'collections'
  | 'project_management'
  | 'compliance'
  | 'customer_comms'
  | 'documentation';

export type AgentStatus = 'active' | 'paused' | 'degraded';

export interface Agent {
  id: string;
  name: string;
  capability: AgentCapability;
  status: AgentStatus;
  description: string;
  /** Rolling 7-day counters, shown on the Agents page. */
  runsToday: number;
  actionsAwaitingApproval: number;
  successRate: number;
  lastRunAt: string;
  connectedSystems: string[];
}

export type AgentRunOutcome = 'succeeded' | 'failed' | 'awaiting_approval' | 'running';

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  capability: AgentCapability;
  summary: string;
  outcome: AgentRunOutcome;
  at: string;
  jobId: string | null;
  jobNumber: string | null;
  /** Tools/systems the run touched, for auditability. */
  systemsTouched: string[];
  durationMs: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
  capability: AgentCapability;
  runsThisWeek: number;
  requiresApproval: boolean;
  lastEditedBy: string;
  lastEditedAt: string;
}

export type IntegrationStatus = 'connected' | 'degraded' | 'disconnected' | 'not_configured';

export interface Integration {
  id: string;
  name: string;
  category: 'job_management' | 'estimating' | 'accounting' | 'communication' | 'storage';
  status: IntegrationStatus;
  description: string;
  lastSyncAt: string | null;
  recordsSynced: number | null;
  issue: string | null;
}

// ── Approvals: the trust contract ───────────────────────────────────────────

export type ApprovalStatus =
  'proposed' | 'approved' | 'executing' | 'completed' | 'failed' | 'rejected' | 'expired';

export type RiskSeverity = 'low' | 'medium' | 'high';

export interface ContextItem {
  label: string;
  value: string;
}

/** A single field-level mutation the agent intends to make. */
export interface ProposedChange {
  entity: string;
  field: string;
  from: string | null;
  to: string;
}

export interface BusinessImpact {
  label: string;
  value: string;
  /** Which way this moves the business — drives colour, not wording. */
  direction: 'positive' | 'negative' | 'neutral';
}

export interface RiskFlag {
  severity: RiskSeverity;
  title: string;
  detail: string;
}

export interface EvidenceItem {
  label: string;
  kind: 'document' | 'record' | 'message' | 'system';
  reference: string;
}

export interface ExecutionStep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

/**
 * The unit of trust in Atmosphere. Every agent-initiated action a human must
 * see is one of these, and a single component renders all of them so the
 * contract never varies by surface.
 */
export interface ApprovalRequest {
  id: string;
  title: string;
  summary: string;
  agentId: string;
  agentName: string;
  capability: AgentCapability;
  jobId: string | null;
  jobNumber: string | null;
  status: ApprovalStatus;
  createdAt: string;
  /** Approvals go stale; collections and scheduling actions especially. */
  expiresAt: string | null;
  /** Minimum role permitted to approve. */
  requiredRole: Role;
  valueAtStake: number | null;
  context: ContextItem[];
  changes: ProposedChange[];
  impact: BusinessImpact[];
  risks: RiskFlag[];
  steps: ExecutionStep[];
  evidence: EvidenceItem[];
}

/** A proactive suggestion that has not yet become a formal approval request. */
export interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  capability: AgentCapability;
  severity: RiskSeverity;
  jobId: string | null;
  jobNumber: string | null;
  estimatedValue: number | null;
  /** Natural-language command that enacts it, fed into the command bar. */
  command: string;
}

// ── Overview metrics ────────────────────────────────────────────────────────

export interface MetricTile {
  id: string;
  label: string;
  value: string;
  /** Percentage change vs the prior period; null when not comparable. */
  deltaPct: number | null;
  /** Whether an increase is good — revenue up is good, DSO up is not. */
  higherIsBetter: boolean;
  hint?: string;
}
