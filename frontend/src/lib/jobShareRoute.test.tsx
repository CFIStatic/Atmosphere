import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { JOB_SHARE_PAGE_ROUTE } from './jobSharePath';

const SLASH_TOKEN = '06mK2/nSHxdzmgX4Nd0R0Bow19Bb2gLG';

function InviteRoutes() {
  return (
    <Routes>
      <Route path={JOB_SHARE_PAGE_ROUTE} element={<div data-testid="invited-job">job</div>} />
      <Route path="/dashboard" element={<div data-testid="dashboard">dashboard</div>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

describe('invite email URL', () => {
  it('stays on the invited job when the token contains a slash', () => {
    render(
      <MemoryRouter initialEntries={[`/shared/${SLASH_TOKEN}?email=jack%40jettx.ai`]}>
        <InviteRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('invited-job')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('still sends unknown paths to the dashboard', () => {
    render(
      <MemoryRouter initialEntries={['/not-a-real-page']}>
        <InviteRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});
