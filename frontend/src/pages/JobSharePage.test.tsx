import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_SHARE_PAGE_ROUTE } from '../lib/jobSharePath';
import { JobSharePage } from './JobSharePage';

const SHARE_VIEW = {
  you: { company: '', trade: 'field_capture', role: 'crew' },
  job: { jobNumber: 3, title: 'Meridian Ave', claimNumber: null, scheduledStart: null },
  brief: null,
  currentRevision: 1,
  acknowledgedRevision: 1,
  clear: true,
  because: 'Scope is signed.',
  scope: [],
  messages: [],
};

describe('JobSharePage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/proof') || url.includes('/capture-guide')) {
          return new Response(JSON.stringify({ days: [], guide: null }), { status: 200 });
        }
        return new Response(JSON.stringify(SHARE_VIEW), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not show the internal trade slug or job number under the title', async () => {
    render(
      <MemoryRouter initialEntries={['/shared/tok']}>
        <Routes>
          <Route path={JOB_SHARE_PAGE_ROUTE} element={<JobSharePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Meridian Ave' })).toBeInTheDocument();
    expect(screen.queryByText(/field_capture/)).not.toBeInTheDocument();
    expect(screen.queryByText(/job #3/i)).not.toBeInTheDocument();
    expect(screen.queryByText('You are clear to work')).not.toBeInTheDocument();
    expect(screen.queryByText(/Accepted revision/i)).not.toBeInTheDocument();
  });

  it('still asks them to accept when they are not clear to work', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes('/proof') || url.includes('/capture-guide')) {
          return new Response(JSON.stringify({ days: [], guide: null }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            ...SHARE_VIEW,
            clear: false,
            because: 'They accepted revision 1; the job is on 2.',
            currentRevision: 2,
            acknowledgedRevision: 1,
          }),
          { status: 200 },
        );
      }),
    );

    render(
      <MemoryRouter initialEntries={['/shared/tok']}>
        <Routes>
          <Route path={JOB_SHARE_PAGE_ROUTE} element={<JobSharePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Not clear to work yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });
});
