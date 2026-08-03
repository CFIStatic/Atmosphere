import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../design';
import { ActionProposal } from './ActionProposal';
import type { ApprovalRequest } from '../domain/types';

/**
 * ActionProposal is the one component that stands between an agent and a change
 * to a customer's job. These tests assert the contract it promises: that a user
 * always sees what will change, what it costs, and what could go wrong before
 * the approve button does anything.
 */

const BASE: ApprovalRequest = {
  id: 'ap-1',
  title: 'Extend drying equipment by 3 days',
  summary: 'Moisture readings have not moved in 48 hours.',
  agentId: 'a-pm',
  agentName: 'Project Management',
  capability: 'project_management',
  jobId: 'j-1',
  jobNumber: 'WTR-1041',
  status: 'proposed',
  createdAt: new Date().toISOString(),
  expiresAt: null,
  requiredRole: 'project_manager',
  valueAtStake: 2850,
  context: [{ label: 'Current phase', value: 'Drying, day 9' }],
  changes: [{ entity: 'Job WTR-1041', field: 'Equipment end date', from: 'Mar 14', to: 'Mar 17' }],
  impact: [{ label: 'Additional cost', value: '$2,850', direction: 'negative' }],
  risks: [
    {
      severity: 'high',
      title: 'Carrier may deny extended drying',
      detail: 'Outside approved scope.',
    },
  ],
  steps: [{ label: 'Update equipment schedule', status: 'pending' }],
  evidence: [],
};

function renderProposal(
  request: Partial<ApprovalRequest> = {},
  props: Record<string, unknown> = {},
) {
  const merged = { ...BASE, ...request };
  return render(
    <TooltipProvider>
      <ActionProposal request={merged} role="project_manager" {...props} />
    </TooltipProvider>,
  );
}

describe('the seven-part contract', () => {
  it('shows context, changes, impact, and risks before asking for approval', () => {
    renderProposal();

    expect(screen.getByText('Extend drying equipment by 3 days')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByText('Drying, day 9')).toBeInTheDocument();

    expect(screen.getByText('Proposed changes')).toBeInTheDocument();
    // Both sides of the change must be visible — a "to" without a "from" hides
    // what is actually being overwritten.
    expect(screen.getByText('Mar 14')).toBeInTheDocument();
    expect(screen.getByText('Mar 17')).toBeInTheDocument();

    expect(screen.getByText('Business impact')).toBeInTheDocument();
    expect(screen.getByText('Additional cost')).toBeInTheDocument();
    // Appears twice by design: once as the headline value at stake, once as the
    // itemised impact.
    expect(screen.getAllByText('$2,850')).toHaveLength(2);

    expect(screen.getByText('Risks & conflicts')).toBeInTheDocument();
    expect(screen.getByText('Carrier may deny extended drying')).toBeInTheDocument();
  });

  it('surfaces the value at stake', () => {
    renderProposal();
    expect(screen.getByText('At stake')).toBeInTheDocument();
  });

  it('shows execution progress once running, not before', () => {
    renderProposal();
    expect(screen.queryByText('Execution')).not.toBeInTheDocument();

    renderProposal({ status: 'executing' });
    expect(screen.getByText('Execution')).toBeInTheDocument();
  });

  it('shows evidence only once complete', () => {
    renderProposal({
      status: 'completed',
      evidence: [{ label: 'DASH record updated', kind: 'record', reference: 'WTR-1041-001' }],
    });
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByText('DASH record updated')).toBeInTheDocument();
  });
});

describe('approval controls', () => {
  it('calls back with the request id when approved', async () => {
    const onApprove = vi.fn();
    renderProposal({}, { onApprove });

    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('ap-1');
  });

  it('disables approval for an under-qualified role and explains why', () => {
    const onApprove = vi.fn();
    render(
      <TooltipProvider>
        <ActionProposal request={BASE} role="field_technician" onApprove={onApprove} />
      </TooltipProvider>,
    );

    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByText(/Requires Project Manager or above/i)).toBeInTheDocument();
  });

  it('offers no controls once the request is resolved', () => {
    renderProposal({ status: 'completed' }, { onApprove: vi.fn(), onReject: vi.fn() });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('can be rejected', async () => {
    const onReject = vi.fn();
    renderProposal({}, { onReject });

    await userEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith('ap-1');
  });
});

describe('compact variant', () => {
  it('drops context but keeps the changes and the decision', () => {
    renderProposal({}, { variant: 'compact', onApprove: vi.fn() });

    expect(screen.queryByText('Context')).not.toBeInTheDocument();
    expect(screen.getByText('Proposed changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });
});
