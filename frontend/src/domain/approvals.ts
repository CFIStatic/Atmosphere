import type { ApprovalRequest, ApprovalStatus, Role, RiskSeverity } from './types';

/**
 * The approval lifecycle, as a real state machine.
 *
 * Components render whatever state they are handed and never compute the next
 * one. Keeping the transitions here means the rules are testable without a DOM,
 * and there is exactly one answer to "can this be approved right now?" no matter
 * which surface is asking.
 */

const TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  proposed: ['approved', 'rejected', 'expired'],
  approved: ['executing', 'rejected'],
  executing: ['completed', 'failed'],
  // Terminal states.
  completed: [],
  failed: [],
  rejected: [],
  expired: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ApprovalStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function isPending(status: ApprovalStatus): boolean {
  return status === 'proposed';
}

/** In-flight work: approved but not yet finished. */
export function isInFlight(status: ApprovalStatus): boolean {
  return status === 'approved' || status === 'executing';
}

/**
 * Role seniority for approval gating. Product seats collapse to Global Admin
 * (bill payer) and Employee; legacy ranks still resolve for older fixtures.
 */
const RANK: Record<Role, number> = {
  field_technician: 1,
  sales: 1,
  accountant: 1,
  project_manager: 1,
  employee: 1,
  office_manager: 2,
  global_admin: 2,
  executive: 2,
};

export function roleMeets(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export interface ApprovalGate {
  allowed: boolean;
  /** Present when `allowed` is false — shown to the user verbatim. */
  reason?: string;
}

/**
 * Whether `role` may approve `request` at this moment. Expiry is evaluated
 * against an injected clock so the rule is deterministic under test.
 */
export function canApprove(
  request: ApprovalRequest,
  role: Role,
  now: Date = new Date(),
): ApprovalGate {
  if (request.status !== 'proposed') {
    return { allowed: false, reason: `This request is already ${request.status}.` };
  }
  if (request.expiresAt && new Date(request.expiresAt) <= now) {
    return { allowed: false, reason: 'This request expired and needs to be regenerated.' };
  }
  if (!roleMeets(role, request.requiredRole)) {
    return {
      allowed: false,
      reason: `Approval requires ${labelForRole(request.requiredRole)} or above.`,
    };
  }
  return { allowed: true };
}

export function labelForRole(role: Role): string {
  const LABELS: Record<Role, string> = {
    global_admin: 'Global Admin',
    employee: 'Employee',
    field_technician: 'Employee',
    project_manager: 'Employee',
    office_manager: 'Global Admin',
    accountant: 'Employee',
    sales: 'Employee',
    executive: 'Global Admin',
  };
  return LABELS[role];
}

/** Highest risk severity attached to a request, or null when it carries none. */
export function peakRisk(request: ApprovalRequest): RiskSeverity | null {
  const order: RiskSeverity[] = ['high', 'medium', 'low'];
  for (const severity of order) {
    if (request.risks.some((r) => r.severity === severity)) return severity;
  }
  return null;
}

/**
 * Ordering for the approvals queue: expiring soonest first, then by risk, then
 * by value at stake. This is the queue's actual product logic and belongs here
 * rather than inside a table component.
 */
export function compareUrgency(a: ApprovalRequest, b: ApprovalRequest): number {
  const expiryA = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const expiryB = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  if (expiryA !== expiryB) return expiryA - expiryB;

  const riskRank = { high: 0, medium: 1, low: 2 } as const;
  const riskA = peakRisk(a);
  const riskB = peakRisk(b);
  const rankA = riskA ? riskRank[riskA] : 3;
  const rankB = riskB ? riskRank[riskB] : 3;
  if (rankA !== rankB) return rankA - rankB;

  return (b.valueAtStake ?? 0) - (a.valueAtStake ?? 0);
}

/** Fraction of execution steps finished, 0–100. */
export function executionProgress(request: ApprovalRequest): number {
  if (request.steps.length === 0) return 0;
  const done = request.steps.filter((s) => s.status === 'done').length;
  return Math.round((done / request.steps.length) * 100);
}
