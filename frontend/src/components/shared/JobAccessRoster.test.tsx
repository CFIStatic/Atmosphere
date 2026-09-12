import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobAccessPerson } from '../../lib/api';

const jobAccessRoster = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    jobAccessRoster: (...args: unknown[]) => jobAccessRoster(...args),
  },
}));

import { JobAccessRoster } from './JobAccessRoster';

const people: JobAccessPerson[] = [
  {
    id: 'share:1',
    kind: 'homeowner',
    name: 'von@example.com',
    email: 'von@example.com',
    accessType: 'Homeowner',
    grantedByName: 'Alex Office',
    grantedByEmail: 'alex@contractor.com',
    grantedAt: '2026-09-01T00:00:00.000Z',
    lastAccessedAt: '2026-09-10T00:00:00.000Z',
    state: 'claimed',
  },
  {
    id: 'party:1',
    kind: 'field_capture',
    name: 'Sam Rivera',
    email: 'sam@rivera.test',
    accessType: 'drywall',
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
    jobAccessRoster.mockResolvedValue({ people });
  });

  it('lists people with grantor and last access', async () => {
    render(<JobAccessRoster jobId="job-1" />);

    expect(await screen.findByRole('heading', { name: 'Who has access' })).toBeInTheDocument();
    expect(screen.getByText('von@example.com')).toBeInTheDocument();
    expect(screen.getAllByText(/Granted by Alex Office/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
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
});
