import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskApproval } from '../../lib/api';

const askApproval = vi.fn();
const approveAskApproval = vi.fn();
const denyAskApproval = vi.fn();

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    askApproval: (...a: unknown[]) => askApproval(...a),
    approveAskApproval: (...a: unknown[]) => approveAskApproval(...a),
    denyAskApproval: (...a: unknown[]) => denyAskApproval(...a),
  },
}));

import { AskApprovalCard } from './AskApprovalCard';
import { displayPhone } from '../../lib/displayPhone';

const ID = '0e000000-0000-4000-8000-0000000000a1';
const sms = (over: Partial<AskApproval> = {}): AskApproval => ({
  id: ID,
  kind: 'send_job_sms',
  status: 'pending',
  title: 'Send a text to Dana (adjuster)',
  payload: { to: '+19725550142', body: 'Crew is back Tuesday.', recipient: 'Dana (adjuster)' },
  editable: true,
  result: null,
  decidedAt: null,
  createdAt: '2026-10-09T10:00:00Z',
  expiresAt: '2026-10-10T10:00:00Z',
  ...over,
});

describe('AskApprovalCard', () => {
  beforeEach(() => {
    askApproval.mockReset();
    approveAskApproval.mockReset();
    denyAskApproval.mockReset();
  });

  it('shows what will be sent and to whom; nothing goes until Send', async () => {
    askApproval.mockResolvedValue({ approval: sms() });
    render(<AskApprovalCard jobId="job-1" approvalId={ID} />);
    expect(await screen.findByText('Send a text to Dana (adjuster)')).toBeInTheDocument();
    expect(screen.getByText('To (972) 555-0142')).toBeInTheDocument();
    expect(screen.getByTestId('ask-approval-body')).toHaveTextContent('Crew is back Tuesday.');
    expect(screen.getByText('Nothing is sent until you press Send.')).toBeInTheDocument();
    expect(approveAskApproval).not.toHaveBeenCalled();
  });

  it('Edit, then Send: the edited text is what is approved, and the card becomes a receipt', async () => {
    askApproval.mockResolvedValue({ approval: sms() });
    approveAskApproval.mockResolvedValue({ approval: sms({ status: 'approved', result: 'Text sent to Dana (adjuster).', decidedAt: '2026-10-09T14:14:00Z' }) });
    const user = userEvent.setup();
    render(<AskApprovalCard jobId="job-1" approvalId={ID} />);
    await user.click(await screen.findByTestId('ask-approval-edit'));
    const box = screen.getByRole('textbox', { name: 'Edit the text' });
    await user.clear(box);
    await user.type(box, 'Crew is back Tuesday at 9.');
    await user.click(screen.getByTestId('ask-approval-approve'));
    await waitFor(() => expect(approveAskApproval).toHaveBeenCalledWith('job-1', ID, 'Crew is back Tuesday at 9.'));
    const receipt = await screen.findByTestId('ask-approval-receipt');
    expect(receipt).toHaveAttribute('data-status', 'approved');
    expect(receipt).toHaveTextContent('Text sent to Dana (adjuster).');
    expect(screen.queryByTestId('ask-approval-card')).not.toBeInTheDocument();
  });

  it('Send without editing approves the text as shown', async () => {
    askApproval.mockResolvedValue({ approval: sms() });
    approveAskApproval.mockResolvedValue({ approval: sms({ status: 'approved', result: 'Text sent.' }) });
    const user = userEvent.setup();
    render(<AskApprovalCard jobId="job-1" approvalId={ID} />);
    await user.click(await screen.findByTestId('ask-approval-approve'));
    await waitFor(() => expect(approveAskApproval).toHaveBeenCalledWith('job-1', ID, null));
  });

  it("Don't send: nothing is sent and the receipt says so", async () => {
    askApproval.mockResolvedValue({ approval: sms() });
    denyAskApproval.mockResolvedValue({ approval: sms({ status: 'denied', result: 'Not sent.' }) });
    const user = userEvent.setup();
    render(<AskApprovalCard jobId="job-1" approvalId={ID} />);
    await user.click(await screen.findByRole('button', { name: "Don't send" }));
    expect(await screen.findByTestId('ask-approval-receipt')).toHaveTextContent('Not sent.');
    expect(approveAskApproval).not.toHaveBeenCalled();
  });

  it('removing access reads as a confirmation, with no edit', async () => {
    askApproval.mockResolvedValue({
      approval: sms({ kind: 'revoke_access', title: "Remove Pat Homeowner's access to this job", payload: { personId: 'grant:g1', name: 'Pat Homeowner', email: 'pat@test.invalid' }, editable: false }),
    });
    render(<AskApprovalCard jobId="job-1" approvalId={ID} />);
    expect(await screen.findByRole('button', { name: 'Remove access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep access' })).toBeInTheDocument();
    expect(screen.queryByTestId('ask-approval-edit')).not.toBeInTheDocument();
  });

  it('an already decided or expired request shows only its receipt', async () => {
    askApproval.mockResolvedValue({ approval: sms({ status: 'expired', result: 'This request expired. Ask again to make a new one.' }) });
    render(<AskApprovalCard jobId="job-1" approvalId={ID} />);
    expect(await screen.findByTestId('ask-approval-receipt')).toHaveTextContent('This request expired');
    expect(screen.queryByTestId('ask-approval-approve')).not.toBeInTheDocument();
  });

  it('formats US phone numbers', () => {
    expect(displayPhone('+19725550142')).toBe('(972) 555-0142');
    expect(displayPhone('9725550142')).toBe('(972) 555-0142');
    expect(displayPhone('+447700900123')).toBe('+447700900123');
  });
});
