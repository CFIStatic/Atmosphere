import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupHomeownerJobFiles, presentHomeownerJobFiles } from './MyJobFilesPage';

const progressShareGrants = vi.fn();
const logout = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ logout }),
}));

vi.mock('../lib/api', () => ({
  api: {
    progressShareGrants: (...args: unknown[]) => progressShareGrants(...args),
  },
}));

import { MyJobFilesPage } from './MyJobFilesPage';

describe('presentHomeownerJobFiles', () => {
  it('fills Job · Company labels from the grants API', () => {
    const files = presentHomeownerJobFiles([
      {
        orgId: 'org-1',
        jobId: 'job-1',
        path: '/job-progress?job=job-1',
        orgName: 'Ortiz Restoration',
        jobTitle: 'Cedar Ridge',
        status: 'in_progress',
      },
      {
        orgId: 'org-2',
        jobId: 'job-2',
        path: '/job-progress?job=job-2',
      },
    ]);
    expect(files[0]).toMatchObject({
      jobTitle: 'Cedar Ridge',
      orgName: 'Ortiz Restoration',
    });
    expect(files[1]).toMatchObject({ jobTitle: 'Job', orgName: 'Contractor' });
    expect(groupHomeownerJobFiles(files).map((g) => g.orgName)).toEqual([
      'Ortiz Restoration',
      'Contractor',
    ]);
  });
});

describe('MyJobFilesPage', () => {
  beforeEach(() => {
    logout.mockReset().mockResolvedValue(undefined);
    progressShareGrants.mockReset();
  });

  it('lists jobs from more than one vendor', async () => {
    progressShareGrants.mockResolvedValue({
      grants: [
        {
          orgId: 'org-1',
          jobId: 'job-1',
          path: '/job-progress?job=job-1',
          orgName: 'Ortiz Restoration',
          jobTitle: 'Cedar Ridge',
          status: 'in_progress',
        },
        {
          orgId: 'org-2',
          jobId: 'job-2',
          path: '/job-progress?job=job-2',
          orgName: 'Jettx LLC',
          jobTitle: 'Kitchen rebuild',
          status: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <MyJobFilesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('my-job-files')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your job files' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ortiz Restoration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jettx LLC' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cedar Ridge/ })).toHaveAttribute(
      'href',
      '/job-progress?job=job-1',
    );
    expect(screen.getByRole('link', { name: /Kitchen rebuild/ })).toHaveAttribute(
      'href',
      '/job-progress?job=job-2',
    );
    expect(screen.getByText(/This list is yours/)).toBeInTheDocument();
  });

  it('tells a grant-less account to open a share link', async () => {
    progressShareGrants.mockResolvedValue({ grants: [] });

    render(
      <MemoryRouter>
        <MyJobFilesPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Open a share link from your email/)).toBeInTheDocument();
  });
});
