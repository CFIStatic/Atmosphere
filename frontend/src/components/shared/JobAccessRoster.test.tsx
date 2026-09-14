import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobAccessPerson } from '../../lib/api';

const jobAccessRoster = vi.fn();
const revokeJobAccess = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    jobAccessRoster: (...args: unknown[]) => jobAccessRoster(...args),
    revokeJobAccess: (...args: unknown[]) => revokeJobAccess(...args),
  },
}));

import { JobAccessRoster } from './JobAccessRoster';

const people: JobAccessPerson[] = [
  {
    id: 'share:11111111-1111-4111-8111-111111111111',
    kind: 'homeowner',
    name: 'von@example.com',
    email: 'von@example.com',
    accessType: 'Homeowner',
    role: 'homeowner',
    displayLabel: 'Homeowner',
    serviceTitle: 'Homeowner',
    displayName: 'Homeowner',
    grantedByName: 'Alex Office',
    grantedByEmail: 'alex@contractor.com',
    grantedAt: '2026-09-01T00:00:00.000Z',
    lastAccessedAt: '2026-09-10T00:00:00.000Z',
    state: 'claimed',
  },
  {
    id: 'party:22222222-2222-4222-8222-222222222222',
    kind: 'field_capture',
    name: 'Sam Rivera',
    email: 'sam@rivera.test',
    accessType: 'Crew',
    role: 'crew',
    displayLabel: 'Crew',
    serviceTitle: 'Crew',
    displayName: 'Sam Rivera — Crew',
    grantedByName: 'Alex Office',
    grantedByEmail: 'alex@contractor.com',
    grantedAt: '2026-09-03T00:00:00.000Z',
    lastAccessedAt: null,
    state: 'live',
  },
];

describe('JobAccessRoster', () => {
  beforeEach(() => {
    jobAccessRoster.mockReset();
    revokeJobAccess.mockReset();
    jobAccessRoster.mockResolvedValue({ people });
    revokeJobAccess.mockResolvedValue({ ok: true, kind: 'share' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('lists people with grantor and last access', async () => {
    render(<JobAccessRoster jobId="job-1" />);

    expect(await screen.findByRole('heading', { name: 'Who has access' })).toBeInTheDocument();
    expect(screen.getByText('Homeowner')).toBeInTheDocument();
    expect(screen.getAllByText(/Granted by Alex Office/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sam Rivera — Crew')).toBeInTheDocument();
    expect(screen.getByText(/Last access never/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(jobAccessRoster).toHaveBeenCalledWith('job-1');
    });
  });

  it('shows empty copy when nobody has access', async () => {
    jobAccessRoster.mockResolvedValue({ people: [] });
    render(<JobAccessRoster jobId="job-empty" />);
    expect(await screen.findByText(/Nobody outside the office has access yet/i)).toBeInTheDocument();
  });

  it('revokes access from the trash control and refreshes the list', async () => {
    const user = userEvent.setup();
    jobAccessRoster
      .mockResolvedValueOnce({ people })
      .mockResolvedValueOnce({ people: [people[1]] });

    render(<JobAccessRoster jobId="job-1" />);
    const trash = await screen.findByRole('button', { name: /Revoke access for Homeowner/i });
    await user.click(trash);

    await waitFor(() => {
      expect(revokeJobAccess).toHaveBeenCalledWith(
        'job-1',
        'share:11111111-1111-4111-8111-111111111111',
      );
    });
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText('Homeowner')).toBeNull();
    });
    expect(screen.getByText('Sam Rivera — Crew')).toBeInTheDocument();
  });

  it('does not call revoke when confirm is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<JobAccessRoster jobId="job-1" />);
    const trash = await screen.findByRole('button', { name: /Revoke access for Homeowner/i });
    await user.click(trash);
    expect(revokeJobAccess).not.toHaveBeenCalled();
  });
});
