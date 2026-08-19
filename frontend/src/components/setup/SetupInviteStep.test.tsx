import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOrgInvite = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    createOrgInvite: (...args: unknown[]) => createOrgInvite(...args),
  },
  ApiError: class ApiError extends Error {
    status = 400;
    code = 'invite_failed';
  },
  ROLE_LABELS: {
    project_manager: 'Project Manager',
    field_technician: 'Field Technician',
    accountant: 'Accountant',
    office_manager: 'Office Manager',
    sales: 'Sales',
  },
}));

import { SetupInviteStep } from './SetupInviteStep';

describe('SetupInviteStep', () => {
  beforeEach(() => {
    createOrgInvite.mockReset();
    createOrgInvite.mockResolvedValue({
      emailed: true,
      joinCode: 'ABC123',
      invite: {
        id: 'inv-1',
        email: 'sam@shop.example',
        role: 'field_technician',
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
  });

  it('sends an email invite instead of showing a join code', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<SetupInviteStep onComplete={onComplete} />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByText(/join code/i)).toBeNull();
    expect(screen.queryByLabelText('Role')).toBeNull();

    await user.type(screen.getByLabelText('Email'), 'sam@shop.example');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(createOrgInvite).toHaveBeenCalledWith({
      email: 'sam@shop.example',
    });
    expect(await screen.findByText('sam@shop.example')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalled();
  });

  it('lets the founder skip invites', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<SetupInviteStep onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalled();
    expect(createOrgInvite).not.toHaveBeenCalled();
  });
});
