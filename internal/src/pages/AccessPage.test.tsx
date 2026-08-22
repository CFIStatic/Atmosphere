import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPage } from './AccessPage';
import type { AccessRequest } from '../lib/types';

const loadAccess = vi.fn();
const accessRequests = vi.fn();
const approveAccessRequest = vi.fn();
const denyAccessRequest = vi.fn();
const approveAllAccessRequests = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin', email: 'jack@jettx.ai', createdAt: '2026-01-01T00:00:00.000Z' },
    access: { scope: 'internal', displayName: 'Jack', pendingAccessRequests: 2 },
    loading: false,
    loadAccess,
  }),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    api: {
      accessRequests,
      approveAccessRequest,
      denyAccessRequest,
      approveAllAccessRequests,
    },
  };
});

function request(partial: Partial<AccessRequest>): AccessRequest {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'alex@company.com',
    firstName: 'Alex',
    lastName: 'Rivera',
    status: 'pending',
    requestedAt: '2026-08-22T10:00:00.000Z',
    lastRequestedAt: '2026-08-22T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    userId: null,
    ...partial,
  };
}

describe('AccessPage', () => {
  beforeEach(() => {
    loadAccess.mockReset();
    accessRequests.mockReset();
    approveAccessRequest.mockReset();
    denyAccessRequest.mockReset();
    approveAllAccessRequests.mockReset();
    accessRequests.mockResolvedValue({
      pendingCount: 2,
      requests: [
        request({ id: 'req-1', firstName: 'Alex', lastName: 'Rivera', email: 'alex@company.com' }),
        request({
          id: 'req-2',
          firstName: 'Jordan',
          lastName: 'Lee',
          email: 'jordan@company.com',
        }),
      ],
    });
    approveAllAccessRequests.mockResolvedValue({ approved: [], pendingCount: 0 });
    approveAccessRequest.mockResolvedValue({ request: request({ status: 'approved' }), pendingCount: 1 });
  });

  it('lists employees waiting to join and can approve all of them', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AccessPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('alex@company.com')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Approve all (2)' }));
    await waitFor(() => expect(approveAllAccessRequests).toHaveBeenCalledTimes(1));
  });
});
