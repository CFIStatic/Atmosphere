import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformHomePage } from './PlatformHomePage';

vi.mock('../lib/api', () => ({
  api: {
    getJobs: vi.fn(async () => ({ jobs: [] })),
  },
}));

vi.mock('../hooks/useFeatureTimer', () => ({
  useFeatureTimer: () => {},
}));

describe('office Overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('describes the organization day, not a technician greeting', async () => {
    render(
      <MemoryRouter>
        <PlatformHomePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'The day across the office' })).toBeInTheDocument();
    expect(screen.getByText(/for the office, not one technician/i)).toBeInTheDocument();
    expect(screen.queryByText(/good to see you/i)).toBeNull();
    expect(screen.queryByText('Capture')).toBeNull();
  });
});
