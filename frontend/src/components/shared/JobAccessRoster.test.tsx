import { render, screen, waitFor, within } from '@testing-library/react';
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

const longEmailHomeowner: JobAccessPerson = {
  id: 'share:33333333-3333-4333-8333-333333333333',
  kind: 'homeowner',
  name: 'jackcyganiak@yahoo.com',
  email: 'jackcyganiak@yahoo.com',
  accessType: 'Homeowner',
  role: 'homeowner',
  displayLabel: 'Homeowner',
  serviceTitle: 'Homeowner',
  displayName: 'Homeowner',
  grantedByName: 'Alex Office',
  grantedByEmail: 'alex@contractor.com',
  grantedAt: '2026-09-01T00:00:00.000Z',
  lastAccessedAt: null,
  state: 'live',
};

const otherInvite: JobAccessPerson = {
  id: 'share:44444444-4444-4444-8444-444444444444',
  kind: 'homeowner',
  name: 'realjackcyganiak@gmail.com',
  email: 'realjackcyganiak@gmail.com',
  accessType: 'Other',
  role: 'other',
  displayLabel: 'Other',
  serviceTitle: 'Other',
  displayName: 'Other',
  grantedByName: 'Alex Office',
  grantedByEmail: 'alex@contractor.com',
  grantedAt: '2026-09-01T00:00:00.000Z',
  lastAccessedAt: null,
  state: 'live',
};

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
    expect(screen.getByText(/von@example\.com · Granted by Alex Office/)).toBeInTheDocument();
    expect(screen.getByText('Sam Rivera — Crew')).toBeInTheDocument();
    expect(screen.getByText(/sam@rivera\.test · Granted by Alex Office/)).toBeInTheDocument();
    expect(screen.getByText(/Last access never/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(jobAccessRoster).toHaveBeenCalledWith('job-1');
    });
  });

  it('does not repeat Homeowner in the subtitle when title is Homeowner', async () => {
    jobAccessRoster.mockResolvedValue({ people: [longEmailHomeowner] });
    render(<JobAccessRoster jobId="job-long" />);

    expect(await screen.findByText('Homeowner')).toBeInTheDocument();
    expect(screen.getByText(/jackcyganiak@yahoo\.com · Granted by Alex Office/)).toBeInTheDocument();
    expect(screen.queryByText(/Homeowner · Homeowner/)).not.toBeInTheDocument();
    // Role must not appear again next to the email when title already says Homeowner.
    expect(screen.queryByText(/jackcyganiak@yahoo\.com · Homeowner/)).not.toBeInTheDocument();
  });

  it('keeps meta + revoke on a stable right cluster for long emails', async () => {
    jobAccessRoster.mockResolvedValue({ people: [longEmailHomeowner, otherInvite] });
    render(<JobAccessRoster jobId="job-long" />);

    const rows = await screen.findAllByTestId('job-access-roster-row');
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.className).toMatch(/sm:flex-row/);
      expect(row.className).not.toMatch(/flex-wrap/);
      const left = row.querySelector('.min-w-0.flex-1');
      expect(left).not.toBeNull();
      expect(left?.querySelector('.truncate')).not.toBeNull();
      const revoke = within(row).getByRole('button', { name: /Revoke access/i });
      expect(revoke.closest('.shrink-0')).not.toBeNull();
    }

    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(
      screen.getByText(/realjackcyganiak@gmail\.com · Granted by Alex Office/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Field Capture')).not.toBeInTheDocument();
    expect(screen.getAllByText('invite')).toHaveLength(2);
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
