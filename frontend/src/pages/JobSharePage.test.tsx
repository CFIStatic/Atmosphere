import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { JOB_SHARE_PAGE_ROUTE } from '../lib/jobSharePath';
import { JobSharePage } from './JobSharePage';
import { crewInviteLoginHref, crewInvitePath } from '../lib/crewInvite';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

describe('JobSharePage', () => {
  it('sends an old sub invite link to the new invite page (real account, then the job)', () => {
    render(
      <MemoryRouter initialEntries={['/shared/tok?email=jack%40jettx.ai']}>
        <Routes>
          <Route path={JOB_SHARE_PAGE_ROUTE} element={<JobSharePage />} />
          <Route path="/invite/:token/*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('where').textContent).toBe('/invite/tok?email=jack%40jettx.ai');
  });
});

describe('crew invite links', () => {
  it('encode slash tokens and lowercase the email', () => {
    expect(crewInvitePath('a/b', 'Sub@X.com')).toBe('/invite/a%2Fb?email=sub%40x.com');
  });
  it('sign-in keeps the invite as next and prefills the email (no share= email-only mode)', () => {
    const href = crewInviteLoginHref('tok', 'sub@x.com');
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('next')).toBe('/invite/tok');
    expect(q.get('email')).toBe('sub@x.com');
    expect(q.get('share')).toBeNull();
  });
});
