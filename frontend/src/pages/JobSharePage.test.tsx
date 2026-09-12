import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_SHARE_PAGE_ROUTE } from '../lib/jobSharePath';
import { JobSharePage } from './JobSharePage';

describe('JobSharePage', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.stubGlobal('location', {
      ...originalLocation,
      replace: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a share token to classic Field Capture', () => {
    render(
      <MemoryRouter initialEntries={['/shared/tok?email=jack%40jettx.ai']}>
        <Routes>
          <Route path={JOB_SHARE_PAGE_ROUTE} element={<JobSharePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Opening Field Capture…')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open in Field Capture' });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('https://app.atmosphereteam.com/?token=tok'),
    );
    expect(link).toHaveAttribute('href', expect.stringContaining('email=jack%40jettx.ai'));
    expect(link).toHaveAttribute('href', expect.stringContaining('account=1'));
    expect(window.location.replace).toHaveBeenCalledWith(
      expect.stringContaining('https://app.atmosphereteam.com/?token=tok'),
    );
  });
});
