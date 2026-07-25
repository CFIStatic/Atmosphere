import type { Tone } from '../design';
import type {
  AgentRunOutcome,
  AgentStatus,
  ApprovalStatus,
  EstimateStatus,
  IntegrationStatus,
  InvoiceStatus,
  JobHealth,
  JobPhase,
  RiskSeverity,
  TaskPriority,
  TaskStatus,
} from '../domain/types';

/**
 * The single translation point between domain state and visual state.
 *
 * `design/` must not know what a Job is, and `domain/` must not know what a
 * colour is. This module is the only place allowed to know both, which is why
 * "at risk" looks the same on a job row, an invoice, and an agent run without
 * any component deciding for itself.
 */

export const jobHealthTone: Record<JobHealth, Tone> = {
  on_track: 'ok',
  at_risk: 'warn',
  critical: 'danger',
  blocked: 'danger',
};

export const jobHealthLabel: Record<JobHealth, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  critical: 'Critical',
  blocked: 'Blocked',
};

export const phaseLabel: Record<JobPhase, string> = {
  lead: 'Lead',
  inspection: 'Inspection',
  mitigation: 'Mitigation',
  drying: 'Drying',
  reconstruction: 'Reconstruction',
  invoicing: 'Invoicing',
  closed: 'Closed',
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  todo: 'idle',
  in_progress: 'info',
  blocked: 'danger',
  done: 'ok',
};

export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

export const taskPriorityTone: Record<TaskPriority, Tone> = {
  low: 'idle',
  normal: 'idle',
  high: 'warn',
  urgent: 'danger',
};

export const approvalStatusTone: Record<ApprovalStatus, Tone> = {
  proposed: 'warn',
  approved: 'info',
  executing: 'running',
  completed: 'ok',
  failed: 'danger',
  rejected: 'idle',
  expired: 'idle',
};

export const approvalStatusLabel: Record<ApprovalStatus, string> = {
  proposed: 'Needs approval',
  approved: 'Approved',
  executing: 'Executing',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Rejected',
  expired: 'Expired',
};

export const riskTone: Record<RiskSeverity, Tone> = {
  low: 'info',
  medium: 'warn',
  high: 'danger',
};

export const riskLabel: Record<RiskSeverity, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

export const agentStatusTone: Record<AgentStatus, Tone> = {
  active: 'ok',
  paused: 'idle',
  degraded: 'warn',
};

export const runOutcomeTone: Record<AgentRunOutcome, Tone> = {
  succeeded: 'ok',
  failed: 'danger',
  awaiting_approval: 'warn',
  running: 'running',
};

export const runOutcomeLabel: Record<AgentRunOutcome, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  awaiting_approval: 'Awaiting approval',
  running: 'Running',
};

export const estimateStatusTone: Record<EstimateStatus, Tone> = {
  draft: 'idle',
  pending_review: 'info',
  submitted: 'info',
  approved: 'ok',
  rejected: 'danger',
  supplement_needed: 'warn',
};

export const estimateStatusLabel: Record<EstimateStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  supplement_needed: 'Supplement needed',
};

export const invoiceStatusTone: Record<InvoiceStatus, Tone> = {
  draft: 'idle',
  sent: 'info',
  partial: 'warn',
  paid: 'ok',
  overdue: 'danger',
  disputed: 'danger',
};

export const integrationStatusTone: Record<IntegrationStatus, Tone> = {
  connected: 'ok',
  degraded: 'warn',
  disconnected: 'danger',
  not_configured: 'idle',
};

export const integrationStatusLabel: Record<IntegrationStatus, string> = {
  connected: 'Connected',
  degraded: 'Degraded',
  disconnected: 'Disconnected',
  not_configured: 'Not configured',
};

/** Impact direction → tone. Neutral impacts stay grey so real signal stands out. */
export const impactTone = (direction: 'positive' | 'negative' | 'neutral'): Tone =>
  direction === 'positive' ? 'ok' : direction === 'negative' ? 'danger' : 'idle';
