import { describe, expect, it } from 'vitest';
import {
  canApprove,
  canTransition,
  compareUrgency,
  executionProgress,
  isInFlight,
  isTerminal,
  peakRisk,
  roleMeets,
} from './approvals';
import type { ApprovalRequest, Role } from './types';

/**
 * The approval rules decide whether an agent is allowed to change a customer's
 * job, invoice, or schedule. They are the highest-consequence logic in the
 * product, so they are tested directly rather than through a rendered component.
 */

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'ap-test',
    title: 'Test action',
    summary: '',
    agentId: 'a-1',
    agentName: 'Test',
    capability: 'project_management',
    jobId: null,
    jobNumber: null,
    status: 'proposed',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    requiredRole: 'project_manager',
    valueAtStake: null,
    context: [],
    changes: [],
    impact: [],
    risks: [],
    steps: [],
    evidence: [],
    ...overrides,
  };
}

describe('state machine', () => {
  it('allows only the legal transitions out of proposed', () => {
    expect(canTransition('proposed', 'approved')).toBe(true);
    expect(canTransition('proposed', 'rejected')).toBe(true);
    expect(canTransition('proposed', 'expired')).toBe(true);
    // Skipping approval straight to execution would bypass the human gate.
    expect(canTransition('proposed', 'executing')).toBe(false);
    expect(canTransition('proposed', 'completed')).toBe(false);
  });

  it('treats resolved states as terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('proposed')).toBe(false);
  });

  it('cannot resurrect a rejected request', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('completed', 'executing')).toBe(false);
  });

  it('identifies in-flight work', () => {
    expect(isInFlight('approved')).toBe(true);
    expect(isInFlight('executing')).toBe(true);
    expect(isInFlight('proposed')).toBe(false);
    expect(isInFlight('completed')).toBe(false);
  });
});

describe('role gating', () => {
  it('lets senior roles satisfy junior requirements', () => {
    expect(roleMeets('office_manager', 'project_manager')).toBe(true);
    expect(roleMeets('executive', 'accountant')).toBe(true);
    expect(roleMeets('project_manager', 'project_manager')).toBe(true);
  });

  it('never lets a field technician authorise other people’s work', () => {
    const roles: Role[] = ['project_manager', 'accountant', 'office_manager', 'executive'];
    for (const required of roles) {
      expect(roleMeets('field_technician', required)).toBe(false);
    }
  });
});

describe('canApprove', () => {
  it('permits a qualified role on a live request', () => {
    expect(canApprove(request(), 'project_manager').allowed).toBe(true);
  });

  it('refuses an under-qualified role and explains why', () => {
    const gate = canApprove(request({ requiredRole: 'accountant' }), 'field_technician');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('Accountant');
  });

  it('refuses anything already resolved', () => {
    for (const status of ['approved', 'completed', 'rejected', 'expired'] as const) {
      expect(canApprove(request({ status }), 'executive').allowed).toBe(false);
    }
  });

  it('refuses an expired request even for an executive', () => {
    const gate = canApprove(
      request({ expiresAt: '2026-01-01T00:00:00.000Z' }),
      'executive',
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('expired');
  });

  it('still permits a request that has not yet expired', () => {
    const gate = canApprove(
      request({ expiresAt: '2026-01-03T00:00:00.000Z' }),
      'project_manager',
      new Date('2026-01-02T00:00:00.000Z'),
    );
    expect(gate.allowed).toBe(true);
  });
});

describe('risk and ordering', () => {
  it('reports the highest severity present', () => {
    expect(
      peakRisk(
        request({
          risks: [
            { severity: 'low', title: '', detail: '' },
            { severity: 'high', title: '', detail: '' },
            { severity: 'medium', title: '', detail: '' },
          ],
        }),
      ),
    ).toBe('high');
    expect(peakRisk(request())).toBeNull();
  });

  it('puts the soonest expiry at the top of the queue', () => {
    const soon = request({ id: 'soon', expiresAt: '2026-01-01T01:00:00.000Z' });
    const later = request({ id: 'later', expiresAt: '2026-01-01T09:00:00.000Z' });
    const never = request({ id: 'never' });
    expect([never, later, soon].sort(compareUrgency).map((r) => r.id)).toEqual([
      'soon',
      'later',
      'never',
    ]);
  });

  it('breaks expiry ties by risk, then by value', () => {
    const highRisk = request({ id: 'risk', risks: [{ severity: 'high', title: '', detail: '' }] });
    const bigMoney = request({ id: 'money', valueAtStake: 100_000 });
    expect([bigMoney, highRisk].sort(compareUrgency).map((r) => r.id)).toEqual(['risk', 'money']);

    const cheap = request({ id: 'cheap', valueAtStake: 100 });
    const rich = request({ id: 'rich', valueAtStake: 90_000 });
    expect([cheap, rich].sort(compareUrgency).map((r) => r.id)).toEqual(['rich', 'cheap']);
  });
});

describe('executionProgress', () => {
  it('is zero with no steps rather than NaN', () => {
    expect(executionProgress(request())).toBe(0);
  });

  it('reports the completed fraction', () => {
    const r = request({
      steps: [
        { label: 'a', status: 'done' },
        { label: 'b', status: 'done' },
        { label: 'c', status: 'running' },
        { label: 'd', status: 'pending' },
      ],
    });
    expect(executionProgress(r)).toBe(50);
  });
});
