import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => undefined,
}));

vi.mock('../hooks/useExperiment', () => ({
  useExperiment: () => ({
    variantKey: null,
    loading: false,
    track: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  api: {
    getMembers: () =>
      Promise.resolve({
        members: [
          {
            userId: 'u-marcus',
            email: 'marcus@example.com',
            fullName: 'Marcus Webb',
            role: 'field_technician',
            workType: 'mitigation',
            usageIntents: ['field_work'],
            status: 'active',
          },
        ],
      }),
    placesStatus: () => Promise.resolve({ configured: false }),
    approveIntake: vi.fn(),
  },
}));

import { JobIntakePage } from './JobIntakePage';

describe('JobIntakePage', () => {
  beforeEach(() => {
    document.title = 'Atmosphere';
  });

  it('puts name, address, situation, and invite list on one page', async () => {
    render(
      <MemoryRouter>
        <JobIntakePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Start a job' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Address' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Situation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite list' })).toBeInTheDocument();

    expect(screen.queryByText('1 · Address')).toBeNull();
    expect(screen.queryByText('2 · Review')).toBeNull();
    expect(screen.queryByText('Review before anyone sees it')).toBeNull();
    expect(screen.queryByText('Job title')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Next$/i })).toBeNull();

    const nameField = screen.getByRole('textbox', { name: /^Name$/i });
    const addressField = screen.getByRole('combobox', { name: /^Address$/i });
    expect(nameField.compareDocumentPosition(addressField)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(await screen.findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve & invite/i })).toBeInTheDocument();
  });
});
